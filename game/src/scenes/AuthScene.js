import Phaser from 'phaser';
import { W, H } from '../config.js';
import { login, register, setSession } from '../services/api.js';

export default class AuthScene extends Phaser.Scene {
  constructor() {
    super({ key: 'Auth' });
  }

  create() {
    this._drawBackdrop();
    this._mountAuthPanel();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this._destroyDom());
  }

  _drawBackdrop() {
    const g = this.add.graphics();
    g.fillGradientStyle(0x210007, 0x210007, 0x02040f, 0x02040f, 1);
    g.fillRect(0, 0, W, H);

    for (let i = 0; i < 9; i++) {
      const x = 20 + i * 44;
      g.fillStyle(i % 2 ? 0xf2c94c : 0xb51f2b, 0.12);
      g.fillTriangle(x, 0, x + 24, 0, x + 6, H * 0.56);
    }

    g.fillStyle(0xf2c94c, 0.08);
    g.fillCircle(W - 46, 76, 92);
    g.fillStyle(0xe11d48, 0.10);
    g.fillCircle(42, H - 76, 118);
  }

  _mountAuthPanel() {
    this.mode = 'login';
    this.root = document.createElement('div');
    this.root.className = 'sereia-auth-root';
    document.body.appendChild(this.root);
    this._renderAuthPanel();
  }

  _renderAuthPanel(error = '') {
    const isLogin = this.mode === 'login';
    const safeError = this._escapeHtml(error);
    this.root.innerHTML = `
      <style>
        .sereia-auth-root {
          position: fixed;
          inset: 0;
          z-index: 20;
          display: grid;
          place-items: center;
          padding: max(14px, env(safe-area-inset-top)) 14px max(14px, env(safe-area-inset-bottom));
          font-family: Arial, Helvetica, sans-serif;
          color: #fff7d6;
          pointer-events: none;
          overflow-y: auto;
          -webkit-overflow-scrolling: touch;
        }
        .sereia-auth-card {
          width: min(366px, calc(100vw - 22px));
          max-height: calc(100dvh - 22px);
          overflow-y: auto;
          border: 1px solid rgba(242, 201, 76, 0.58);
          background:
            linear-gradient(180deg, rgba(92, 8, 22, 0.97), rgba(9, 8, 20, 0.98)),
            radial-gradient(circle at top right, rgba(242, 201, 76, 0.22), transparent 40%);
          box-shadow: 0 18px 60px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.12);
          border-radius: 18px;
          padding: ${isLogin ? '20px' : '16px'};
          pointer-events: auto;
          scrollbar-width: none;
        }
        .sereia-auth-card::-webkit-scrollbar { display: none; }
        .sereia-brand { text-align: center; margin-bottom: ${isLogin ? '16px' : '10px'}; }
        .sereia-brand-mark { font-size: ${isLogin ? '44px' : '34px'}; line-height: 1; filter: drop-shadow(0 8px 18px rgba(242,201,76,.24)); }
        .sereia-title {
          margin-top: ${isLogin ? '8px' : '5px'};
          font: 900 ${isLogin ? '25px' : '22px'}/1.05 "Arial Black", Arial, sans-serif;
          color: #ffd766;
          text-shadow: 0 2px 0 #5d1600;
        }
        .sereia-subtitle { margin-top: 6px; color: #ffd0be; font-size: 13px; }
        .sereia-tabs {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          padding: 4px;
          border-radius: 12px;
          background: rgba(0,0,0,.28);
          margin-bottom: ${isLogin ? '14px' : '10px'};
        }
        .sereia-tab {
          border: 0;
          border-radius: 9px;
          padding: 12px 8px;
          background: transparent;
          color: #ffdca0;
          font-weight: 800;
          font-size: 14px;
          cursor: pointer;
        }
        .sereia-tab.active {
          color: #230009;
          background: linear-gradient(180deg, #ffe58d, #e7ad27);
        }
        .sereia-field { margin: ${isLogin ? '10px' : '8px'} 0; }
        .sereia-field label {
          display: block;
          margin: 0 0 6px;
          color: #ffc4aa;
          font-size: 12px;
          font-weight: 800;
          text-transform: uppercase;
        }
        .sereia-field input {
          width: 100%;
          height: 48px;
          border: 1px solid rgba(255, 215, 102, .22);
          border-radius: 10px;
          background: rgba(5, 7, 18, .76);
          color: #fff;
          font-size: 16px;
          outline: none;
          padding: 0 12px;
          box-shadow: inset 0 1px 0 rgba(255,255,255,.06);
        }
        .sereia-field input:focus {
          border-color: #ffd766;
          box-shadow: 0 0 0 3px rgba(255, 215, 102, .14);
        }
        .sereia-submit {
          width: 100%;
          min-height: 52px;
          margin-top: 12px;
          border: 0;
          border-radius: 12px;
          background: linear-gradient(180deg, #ffdf72, #d49216 52%, #b4212b);
          color: #210007;
          font: 900 16px "Arial Black", Arial, sans-serif;
          cursor: pointer;
          box-shadow: 0 9px 0 rgba(74,0,12,.72), 0 18px 32px rgba(0,0,0,.35);
        }
        .sereia-submit:disabled { filter: grayscale(.6); opacity: .8; cursor: wait; }
        .sereia-error {
          min-height: 18px;
          margin-top: 10px;
          color: #ff9aa9;
          font-size: 13px;
          line-height: 1.3;
          text-align: center;
        }
        .sereia-footer {
          margin-top: 12px;
          color: #dca197;
          font-size: 12px;
          text-align: center;
        }
      </style>
      <form class="sereia-auth-card">
        <div class="sereia-brand">
          <div class="sereia-brand-mark">🧜‍♀️</div>
          <div class="sereia-title">SEREIA PALACE</div>
          <div class="sereia-subtitle">Acesse sua conta para entrar no lobby</div>
        </div>
        <div class="sereia-tabs">
          <button type="button" class="sereia-tab ${isLogin ? 'active' : ''}" data-mode="login">Login</button>
          <button type="button" class="sereia-tab ${!isLogin ? 'active' : ''}" data-mode="register">Cadastro</button>
        </div>
        ${isLogin ? '' : `
          <div class="sereia-field">
            <label>Telefone celular</label>
            <input name="phone" autocomplete="tel" inputmode="tel" placeholder="11999999999" minlength="8" maxlength="24" required />
          </div>
          <div class="sereia-field">
            <label>Email</label>
            <input name="email" autocomplete="email" inputmode="email" placeholder="voce@email.com" maxlength="120" required />
          </div>
        `}
        <div class="sereia-field">
          <label>Usuario</label>
          <input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="seu_usuario" minlength="3" maxlength="24" required />
        </div>
        <div class="sereia-field">
          <label>Senha</label>
          <input name="password" autocomplete="${isLogin ? 'current-password' : 'new-password'}" type="password" placeholder="Sua senha" minlength="${isLogin ? '1' : '6'}" maxlength="128" required />
        </div>
        <button class="sereia-submit" type="submit">${isLogin ? 'ENTRAR NO LOBBY' : 'CRIAR CONTA'}</button>
        <div class="sereia-error">${safeError}</div>
        <div class="sereia-footer">18+ Jogue com responsabilidade</div>
      </form>
    `;

    this.root.querySelectorAll('[data-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        this.mode = button.dataset.mode;
        this._renderAuthPanel();
      });
    });

    this.root.querySelector('form').addEventListener('submit', (event) => this._submit(event));
  }

  async _submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('.sereia-submit');
    const values = Object.fromEntries(new FormData(form).entries());
    const username = String(values.username || '').trim();
    const password = String(values.password || '');
    const phone = String(values.phone || '').replace(/[^\d+]/g, '').trim();
    const email = String(values.email || '').trim().toLowerCase();

    if (!username || !password || (this.mode !== 'login' && (!phone || !email))) {
      this._renderAuthPanel('Preencha todos os campos.');
      return;
    }

    if (this.mode === 'register') {
      if (phone.length < 8) {
        this._renderAuthPanel('Informe um telefone celular valido.');
        return;
      }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        this._renderAuthPanel('Informe um email valido.');
        return;
      }
      if (password.length < 6) {
        this._renderAuthPanel('A senha precisa ter pelo menos 6 caracteres.');
        return;
      }
    }

    submit.disabled = true;

    try {
      const response = this.mode === 'login'
        ? await login(username, password)
        : await register({
          phone,
          email,
          username,
          password,
        });

      setSession(response.token, response.user);
      this.scene.start('Lobby');
    } catch (error) {
      this._renderAuthPanel(error.message || 'Nao foi possivel acessar');
    }
  }

  _destroyDom() {
    if (this.root) {
      this.root.remove();
      this.root = null;
    }
  }

  _escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    })[char]);
  }
}
