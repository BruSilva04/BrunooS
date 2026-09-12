import Phaser from 'phaser';
import { W, H } from '../config.js';
import { BRAND } from '../brand.js';
import { getAcquisitionForRegistration, login, register, setSession } from '../services/api.js';

export default class AuthScene extends Phaser.Scene {
  constructor() {
    super({ key: 'Auth' });
  }

  create() {
    this._submitting = false;
    this._drawBackdrop();
    this._mountAuthPanel();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this._destroyDom());
  }

  _drawBackdrop() {
    const g = this.add.graphics();
    g.fillGradientStyle(0x10142b, 0x10142b, 0x090b1a, 0x090b1a, 1);
    g.fillRect(0, 0, W, H);
    for (let row = 0; row < Math.ceil(H / 48); row++) {
      for (let col = 0; col < Math.ceil(W / 48); col++) {
        g.lineStyle(1, 0xa78bfa, 0.045);
        g.strokeRoundedRect(col * 48 + 5, row * 48 + 5, 38, 38, 7);
      }
    }
    g.fillStyle(0xa78bfa, 0.07);
    g.fillRoundedRect(W - 110, 30, 84, 84, 18);
    g.fillStyle(0x67e8f9, 0.05);
    g.fillRoundedRect(22, H - 120, 84, 84, 18);
  }

  _mountAuthPanel() {
    this.mode = 'login';
    this.root = document.createElement('div');
    this.root.className = 'block-auth-root';
    document.body.appendChild(this.root);
    this._renderAuthPanel();
  }

  _renderAuthPanel() {
    const previousForm = this.root.querySelector('form');
    const previousValues = previousForm ? Object.fromEntries(new FormData(previousForm).entries()) : {};
    const isLogin = this.mode === 'login';
    this.root.innerHTML = `
      <style>
        .block-auth-root, .block-auth-root * { box-sizing: border-box; }
        .block-auth-root {
          position: fixed;
          inset: 0;
          height: var(--app-height, 100dvh);
          z-index: 20;
          display: grid;
          place-items: center;
          padding: max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom));
          font-family: Arial, Helvetica, sans-serif;
          color: var(--color-text, #f4f7ff);
          pointer-events: none;
          overflow-y: auto;
          -webkit-overflow-scrolling: touch;
          scroll-padding: 18px 0;
        }
        .block-auth-root.keyboard-open {
          place-items: start center;
          padding-top: max(8px, env(safe-area-inset-top));
        }
        .block-auth-card {
          width: min(100%, 404px);
          max-height: calc(var(--app-height, 100dvh) - max(16px, env(safe-area-inset-top)) - max(16px, env(safe-area-inset-bottom)));
          overflow-y: auto;
          border: 1px solid var(--color-border, rgba(155,171,224,.18));
          background: radial-gradient(ellipse at 90% 0, rgba(167,139,250,.12), transparent 45%), var(--color-panel, #12172b);
          box-shadow: 0 24px 80px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.05);
          border-radius: 24px;
          padding: ${isLogin ? '28px 24px 22px' : '20px'};
          pointer-events: auto;
          scrollbar-width: thin;
          scrollbar-color: rgba(167,139,250,.35) transparent;
        }
        .block-auth-root.keyboard-open .block-auth-card {
          max-height: calc(var(--app-height, 100dvh) - 24px);
        }
        .block-auth-brand { text-align: center; margin-bottom: ${isLogin ? '24px' : '16px'}; }
        .block-auth-mark {
          display: grid;
          grid-template-columns: repeat(3, 16px);
          grid-template-rows: repeat(2, 16px);
          gap: 4px;
          width: max-content;
          margin: 0 auto ${isLogin ? '18px' : '12px'};
          transform: rotate(-7deg);
          filter: drop-shadow(0 6px 14px rgba(167,139,250,.22));
        }
        .block-auth-mark span { border-radius: 4px; background: var(--color-primary, #a78bfa); box-shadow: inset 0 2px 0 rgba(255,255,255,.25); }
        .block-auth-mark span:first-child { grid-column: 2; }
        .block-auth-mark span:nth-child(3) { grid-column: 1; }
        .block-auth-mark span:nth-child(3), .block-auth-mark span:last-child { background: var(--color-accent, #67e8f9); }
        .block-auth-title {
          margin: 0;
          font-size: ${isLogin ? '29px' : '25px'};
          font-weight: 900;
          line-height: 1.05;
          letter-spacing: -1px;
          color: var(--color-text, #f4f7ff);
        }
        .block-auth-tagline { margin: 9px 0 0; color: var(--color-accent, #67e8f9); font-size: 12px; line-height: 1.5; }
        .block-auth-tabs {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 4px;
          padding: 4px;
          border: 1px solid var(--color-border, rgba(155,171,224,.18));
          border-radius: 13px;
          background: var(--color-bg, #090b1a);
          margin-bottom: ${isLogin ? '22px' : '16px'};
        }
        .block-auth-tab {
          min-height: 42px;
          border: 0;
          border-radius: 9px;
          padding: 10px 8px;
          background: transparent;
          color: var(--color-muted, #a3aecb);
          font-weight: 700;
          font-size: 14px;
          cursor: pointer;
        }
        .block-auth-tab.active { color: var(--color-text, #f4f7ff); background: var(--color-panel-raised, #1a2340); box-shadow: 0 2px 8px rgba(0,0,0,.18); }
        .block-auth-heading { margin: 0 0 5px; font-size: 18px; letter-spacing: -.3px; }
        .block-auth-subtitle { margin: 0 0 18px; color: var(--color-muted, #a3aecb); font-size: 13px; line-height: 1.5; }
        .block-auth-fields { display: grid; grid-template-columns: 1fr 1fr; gap: ${isLogin ? '16px' : '12px'} 12px; }
        .block-auth-field { grid-column: 1 / -1; min-width: 0; }
        .block-auth-field.half { grid-column: auto; }
        .block-auth-field label { display: block; margin: 0 0 7px; color: var(--color-text, #f4f7ff); font-size: 12px; font-weight: 600; }
        .block-auth-field input {
          width: 100%;
          height: 48px;
          border: 1px solid var(--color-border, rgba(155,171,224,.18));
          border-radius: 10px;
          background: var(--color-bg, #090b1a);
          color: var(--color-text, #f4f7ff);
          font-family: inherit;
          font-size: 16px;
          outline: none;
          padding: 0 12px;
          transition: border-color .15s, box-shadow .15s;
        }
        .block-auth-field input::placeholder { color: var(--color-muted, #a3aecb); opacity: .72; font-size: 14px; }
        .block-auth-field input:focus { border-color: var(--color-primary, #a78bfa); box-shadow: 0 0 0 3px rgba(167,139,250,.14); }
        .block-auth-hint { margin: 6px 0 0; color: var(--color-muted, #a3aecb); font-size: 11px; }
        .block-auth-submit {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 12px;
          width: 100%;
          min-height: 52px;
          margin-top: 22px;
          border: 0;
          border-radius: 12px;
          background: linear-gradient(110deg, var(--color-primary, #a78bfa), #c4b5fd);
          color: #15112c;
          font: 800 15px Arial, Helvetica, sans-serif;
          cursor: pointer;
          box-shadow: 0 8px 22px rgba(167,139,250,.13);
          transition: filter .15s, transform .15s;
        }
        .block-auth-submit:hover:not(:disabled) { filter: brightness(1.08); }
        .block-auth-submit:active:not(:disabled) { transform: translateY(1px); }
        .block-auth-tab:focus-visible, .block-auth-submit:focus-visible { outline: 2px solid var(--color-accent, #67e8f9); outline-offset: 3px; }
        .block-auth-submit:disabled, .block-auth-tab:disabled { opacity: .65; cursor: wait; }
        .block-auth-error { margin: 0; color: var(--color-danger, #fda4af); font-size: 13px; line-height: 1.5; text-align: center; overflow-wrap: anywhere; }
        .block-auth-error:not(:empty) { margin-top: 14px; }
        .block-auth-footer {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          margin-top: 22px;
          padding-top: 16px;
          border-top: 1px solid var(--color-border, rgba(155,171,224,.18));
          color: var(--color-muted, #a3aecb);
          font-size: 11px;
          line-height: 1.5;
          text-align: center;
        }
        .block-auth-age { padding: 2px 5px; border: 1px solid var(--color-border, rgba(155,171,224,.18)); border-radius: 5px; font-weight: 700; }
        @media (max-width: 350px) {
          .block-auth-root { padding-left: 10px; padding-right: 10px; }
          .block-auth-card { padding-left: 17px; padding-right: 17px; }
          .block-auth-field.half { grid-column: 1 / -1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .block-auth-root * { transition: none; scroll-behavior: auto; }
        }
      </style>
      <form class="block-auth-card" aria-labelledby="block-auth-heading">
        <div class="block-auth-brand">
          <div class="block-auth-mark" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div>
          <h1 class="block-auth-title">${this._escapeHtml(BRAND.upperName)}</h1>
          <p class="block-auth-tagline">${this._escapeHtml(BRAND.tagline)}</p>
        </div>
        <div class="block-auth-tabs" role="group" aria-label="Acesso à conta">
          <button type="button" class="block-auth-tab ${isLogin ? 'active' : ''}" data-mode="login" aria-pressed="${isLogin}">Entrar</button>
          <button type="button" class="block-auth-tab ${!isLogin ? 'active' : ''}" data-mode="register" aria-pressed="${!isLogin}">Criar conta</button>
        </div>
        <h2 id="block-auth-heading" class="block-auth-heading">${isLogin ? 'Bom ter você de volta.' : 'Sua próxima jogada começa aqui.'}</h2>
        <p class="block-auth-subtitle">${isLogin ? 'Entre na sua conta para acessar o lobby.' : 'Preencha seus dados para criar sua conta.'}</p>
        <div class="block-auth-fields">
          ${isLogin ? '' : `
            <div class="block-auth-field">
              <label for="block-auth-name">Nome completo</label>
              <input id="block-auth-name" name="legal_name" autocomplete="name" placeholder="Seu nome completo" minlength="3" maxlength="120" required />
            </div>
            <div class="block-auth-field half">
              <label for="block-auth-phone">Celular com DDD</label>
              <input id="block-auth-phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" placeholder="11999999999" minlength="8" maxlength="24" required />
            </div>
            <div class="block-auth-field half">
              <label for="block-auth-document">CPF</label>
              <input id="block-auth-document" name="document" autocomplete="off" inputmode="numeric" placeholder="00000000000" minlength="11" maxlength="18" required />
            </div>
            <div class="block-auth-field">
              <label for="block-auth-email">E-mail</label>
              <input id="block-auth-email" name="email" type="email" autocomplete="email" inputmode="email" autocapitalize="none" spellcheck="false" placeholder="voce@email.com" maxlength="120" required />
            </div>
          `}
          <div class="block-auth-field">
            <label for="block-auth-username">Usuário</label>
            <input id="block-auth-username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="seu_usuario" minlength="3" maxlength="24" required />
          </div>
          <div class="block-auth-field">
            <label for="block-auth-password">Senha</label>
            <input id="block-auth-password" name="password" autocomplete="${isLogin ? 'current-password' : 'new-password'}" type="password" placeholder="${isLogin ? 'Sua senha' : 'Crie uma senha'}" minlength="${isLogin ? '1' : '6'}" maxlength="128" ${isLogin ? '' : 'aria-describedby="block-auth-password-hint"'} required />
            ${isLogin ? '' : '<p id="block-auth-password-hint" class="block-auth-hint">Use pelo menos 6 caracteres.</p>'}
          </div>
        </div>
        <button class="block-auth-submit" type="submit"><span>${isLogin ? 'Entrar no lobby' : 'Criar minha conta'}</span><span aria-hidden="true">→</span></button>
        <p class="block-auth-error" role="alert" aria-atomic="true"></p>
        <div class="block-auth-footer"><span class="block-auth-age">18+</span><span>Jogue com responsabilidade.</span></div>
      </form>
    `;

    this.root.querySelectorAll('[data-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        if (this._submitting || this.mode === button.dataset.mode) return;
        this.mode = button.dataset.mode;
        this._renderAuthPanel();
        this.root.querySelector(`[data-mode="${this.mode}"]`).focus();
      });
    });

    this.root.querySelectorAll('input').forEach((input) => {
      if (Object.hasOwn(previousValues, input.name)) input.value = previousValues[input.name];
      input.addEventListener('focus', () => this._handleInputFocus(input));
      input.addEventListener('blur', () => this._handleInputBlur());
    });
    this.root.querySelector('form').addEventListener('submit', (event) => this._submit(event));
  }

  _handleInputFocus(input) {
    this.root.classList.add('keyboard-open');
    window.setTimeout(() => {
      if (!input.isConnected) return;
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      input.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
    }, 90);
  }

  _handleInputBlur() {
    window.setTimeout(() => {
      if (!this.root?.querySelector('input:focus')) this.root?.classList.remove('keyboard-open');
    }, 140);
  }

  _showError(message) {
    const error = this.root?.querySelector('.block-auth-error');
    if (!error) return;
    error.textContent = message;
    if (message) error.scrollIntoView({ block: 'nearest' });
  }

  async _submit(event) {
    event.preventDefault();
    if (this._submitting) return;
    const form = event.currentTarget;
    const submit = form.querySelector('.block-auth-submit');
    const values = Object.fromEntries(new FormData(form).entries());
    const username = String(values.username || '').trim();
    const password = String(values.password || '');
    const phone = String(values.phone || '').replace(/[^\d+]/g, '').trim();
    const email = String(values.email || '').trim().toLowerCase();
    const legalName = String(values.legal_name || '').trim();
    const cpf = String(values.document || '').replace(/\D/g, '').trim();
    const isLogin = this.mode === 'login';
    this._showError('');

    if (!username || !password || (!isLogin && (!phone || !email || !legalName || !cpf))) {
      this._showError('Preencha todos os campos.');
      return;
    }
    if (!isLogin) {
      if (legalName.length < 3) {
        this._showError('Informe seu nome completo.');
        return;
      }
      if (phone.length < 8) {
        this._showError('Informe um telefone celular válido.');
        return;
      }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        this._showError('Informe um e-mail válido.');
        return;
      }
      if (password.length < 6) {
        this._showError('A senha precisa ter pelo menos 6 caracteres.');
        return;
      }
      if (cpf.length !== 11) {
        this._showError('Informe um CPF válido com 11 dígitos.');
        return;
      }
    }

    this._submitting = true;
    submit.disabled = true;
    submit.textContent = isLogin ? 'Entrando…' : 'Criando conta…';
    form.setAttribute('aria-busy', 'true');
    form.querySelectorAll('[data-mode]').forEach((button) => { button.disabled = true; });

    try {
      const response = isLogin
        ? await login(username, password)
        : await register({
          phone,
          email,
          username,
          legal_name: legalName,
          document: cpf,
          document_type: 'cpf',
          password,
          ...getAcquisitionForRegistration(),
        });
      if (!this.root?.contains(form)) return;
      setSession(response.token, response.user);
      document.activeElement?.blur?.();
      if (window.syncAppViewport) window.syncAppViewport();
      this.scene.start('Lobby');
    } catch (error) {
      if (this.root?.contains(form)) this._showError(error?.message || 'Não foi possível acessar. Tente novamente.');
    } finally {
      if (this.root?.contains(form)) {
        this._submitting = false;
        submit.disabled = false;
        submit.innerHTML = `<span>${isLogin ? 'Entrar no lobby' : 'Criar minha conta'}</span><span aria-hidden="true">→</span>`;
        form.removeAttribute('aria-busy');
        form.querySelectorAll('[data-mode]').forEach((button) => { button.disabled = false; });
      }
    }
  }

  _destroyDom() {
    this._submitting = false;
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
