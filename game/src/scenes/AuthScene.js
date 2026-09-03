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
    this.root.innerHTML = `
      <style>
        .sereia-auth-root {
          position: fixed;
          inset: 0;
          z-index: 20;
          display: grid;
          place-items: center;
          padding: 18px;
          font-family: Arial, Helvetica, sans-serif;
          color: #fff7d6;
          pointer-events: none;
        }
        .sereia-auth-card {
          width: min(360px, calc(100vw - 30px));
          border: 1px solid rgba(242, 201, 76, 0.58);
          background:
            linear-gradient(180deg, rgba(92, 8, 22, 0.97), rgba(9, 8, 20, 0.98)),
            radial-gradient(circle at top right, rgba(242, 201, 76, 0.22), transparent 40%);
          box-shadow: 0 18px 60px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.12);
          border-radius: 18px;
          padding: 20px;
          pointer-events: auto;
        }
        .sereia-brand { text-align: center; margin-bottom: 16px; }
        .sereia-brand-mark { font-size: 44px; line-height: 1; filter: drop-shadow(0 8px 18px rgba(242,201,76,.24)); }
        .sereia-title {
          margin-top: 8px;
          font: 900 25px/1.05 "Arial Black", Arial, sans-serif;
          color: #ffd766;
          text-shadow: 0 2px 0 #5d1600;
        }
        .sereia-subtitle { margin-top: 6px; color: #f7b7a3; font-size: 12px; }
        .sereia-tabs {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          padding: 4px;
          border-radius: 12px;
          background: rgba(0,0,0,.28);
          margin-bottom: 14px;
        }
        .sereia-tab {
          border: 0;
          border-radius: 9px;
          padding: 11px 8px;
          background: transparent;
          color: #ffdca0;
          font-weight: 800;
          cursor: pointer;
        }
        .sereia-tab.active {
          color: #230009;
          background: linear-gradient(180deg, #ffe58d, #e7ad27);
        }
        .sereia-field { margin: 10px 0; }
        .sereia-field label {
          display: block;
          margin: 0 0 6px;
          color: #ffc4aa;
          font-size: 11px;
          font-weight: 800;
          text-transform: uppercase;
        }
        .sereia-field input {
          width: 100%;
          height: 46px;
          border: 1px solid rgba(255, 215, 102, .22);
          border-radius: 10px;
          background: rgba(5, 7, 18, .76);
          color: #fff;
          font-size: 15px;
          outline: none;
          padding: 0 12px;
        }
        .sereia-field input:focus {
          border-color: #ffd766;
          box-shadow: 0 0 0 3px rgba(255, 215, 102, .14);
        }
        .sereia-submit {
          width: 100%;
          height: 50px;
          margin-top: 12px;
          border: 0;
          border-radius: 12px;
          background: linear-gradient(180deg, #ffdf72, #d49216 52%, #b4212b);
          color: #210007;
          font: 900 15px "Arial Black", Arial, sans-serif;
          cursor: pointer;
          box-shadow: 0 9px 0 rgba(74,0,12,.72), 0 18px 32px rgba(0,0,0,.35);
        }
        .sereia-submit:disabled { filter: grayscale(.6); opacity: .8; cursor: wait; }
        .sereia-error {
          min-height: 18px;
          margin-top: 10px;
          color: #ff9aa9;
          font-size: 12px;
          text-align: center;
        }
        .sereia-footer {
          margin-top: 12px;
          color: #bd7b72;
          font-size: 11px;
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
            <input name="phone" autocomplete="tel" inputmode="tel" placeholder="11999999999" />
          </div>
          <div class="sereia-field">
            <label>Email</label>
            <input name="email" autocomplete="email" inputmode="email" placeholder="voce@email.com" />
          </div>
        `}
        <div class="sereia-field">
          <label>Usuario</label>
          <input name="username" autocomplete="username" placeholder="seu_usuario" />
        </div>
        <div class="sereia-field">
          <label>Senha</label>
          <input name="password" autocomplete="${isLogin ? 'current-password' : 'new-password'}" type="password" placeholder="Sua senha" />
        </div>
        <button class="sereia-submit" type="submit">${isLogin ? 'ENTRAR NO LOBBY' : 'CRIAR CONTA'}</button>
        <div class="sereia-error">${error}</div>
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
    submit.disabled = true;

    try {
      const response = this.mode === 'login'
        ? await login(values.username.trim(), values.password)
        : await register({
          phone: values.phone.trim(),
          email: values.email.trim(),
          username: values.username.trim(),
          password: values.password,
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
}
