import Phaser from 'phaser';
import { W, H, state } from '../config.js';
import {
  clearSession,
  confirmSandboxDeposit,
  createDepositIntent,
  fetchLobby,
  getStoredUser,
  requestWithdrawal,
} from '../services/api.js';

const CLR = {
  deep: 0x080711,
  red: 0x9f1426,
  redDark: 0x4a0612,
  gold: 0xf4c84a,
};

const TABS = [
  { key: 'lobby', label: 'Lobby' },
  { key: 'promo', label: 'Promo&ccedil;&atilde;o' },
  { key: 'profile', label: 'Perfil' },
];

export default class LobbyScene extends Phaser.Scene {
  constructor() {
    super({ key: 'Lobby' });
  }

  init(data = {}) {
    this.fallbackBalance = data.balance;
    this.user = getStoredUser();
    this.snapshot = null;
    this.currentTab = data.tab || 'lobby';
    this.modal = null;
    this.walletMessage = '';
    this.walletBusy = false;
    this.currentDeposit = null;
    this._subs = [];
    this.root = null;
  }

  create() {
    this._drawBackground();
    this._mountLobby();
    this._renderLoading();
    this._floatGold();
    this._loadLobby();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this._cleanup());
  }

  async _loadLobby() {
    try {
      this.snapshot = await fetchLobby();
      this.user = this.snapshot.user;
      state.balance = Number(this.snapshot.balance || 0);
      state.history = (this.snapshot.history || []).map((round) => Number(round.mult || 1)).slice(0, 5);
      this.modal = null;
      this._render();
    } catch {
      clearSession();
      this.scene.start('Auth');
    }
  }

  _mountLobby() {
    this.root = document.createElement('div');
    this.root.className = 'sereia-lobby-root';
    document.body.appendChild(this.root);
  }

  _renderLoading() {
    if (!this.root) return;
    this.root.innerHTML = `
      ${this._style()}
      <main class="lobby-shell loading-shell">
        <section class="loading-card">
          <div class="brand-orb">S</div>
          <strong>Carregando lobby</strong>
          <span>Preparando sua conta...</span>
        </section>
      </main>
    `;
  }

  _render() {
    if (!this.root) return;
    this.root.innerHTML = `
      ${this._style()}
      <main class="lobby-shell">
        ${this._topBarHtml()}
        <section class="lobby-content">
          ${this.currentTab === 'promo' ? this._promoHtml() : ''}
          ${this.currentTab === 'profile' ? this._profileHtml() : ''}
          ${this.currentTab === 'lobby' ? this._lobbyHtml() : ''}
        </section>
        ${this._bottomNavHtml()}
      </main>
      ${this.modal ? this._modalHtml(this.modal) : ''}
    `;
    this._bindDom();
  }

  _topBarHtml() {
    const user = this.snapshot?.user || this.user || {};
    return `
      <header class="topbar">
        <div class="brand-lockup">
          <div class="brand-orb">S</div>
          <div>
            <h1>SEREIA PALACE</h1>
            <p>${this._escape(user.username || 'jogadora')} &middot; ${this._escape(user.role || 'player')}</p>
          </div>
        </div>
        <div class="top-actions">
          <button class="icon-btn" type="button" data-action="refresh" aria-label="Atualizar">&#8635;</button>
          <button class="icon-btn" type="button" data-action="logout" aria-label="Sair">&times;</button>
        </div>
      </header>
    `;
  }

  _lobbyHtml() {
    const stats = this.snapshot?.stats || { rounds: 0, maxMult: 1, winRate: 0 };
    const history = this.snapshot?.history || [];

    return `
      <section class="wallet-card">
        <span>SALDO DISPONIVEL</span>
        <strong>${this._money(state.balance)}</strong>
        <div class="wallet-actions">
          <button class="gold-btn" type="button" data-action="deposit">Depositar</button>
          <button class="dark-btn" type="button" data-action="withdraw">Sacar Pix</button>
        </div>
      </section>

      <button class="promo-strip" type="button" data-tab="promo">
        <span>EXCLUSIVO</span>
        <strong>Mergulho Premiado</strong>
        <em>95%<small>RTP</small></em>
      </button>

      <nav class="category-row" aria-label="Categorias">
        <span class="active">Hot</span>
        <span>Slots</span>
        <span>Crash</span>
        <span>VIP</span>
      </nav>

      <section class="game-card">
        <div class="game-art">
          <div class="art-glow"></div>
          <div class="mermaid-mark">S</div>
          <div class="gem-mark"></div>
        </div>
        <div class="game-info">
          <h2>Sereia do Tesouro</h2>
          <p>Runner crash &middot; Cash Out</p>
          <div class="badges">
            <span>AO VIVO</span>
            <span>UNICO JOGO</span>
          </div>
          <button class="play-btn" type="button" data-action="play">JOGAR AGORA</button>
        </div>
      </section>

      <section class="stats-grid">
        ${this._statHtml('Rodadas', stats.rounds || 0)}
        ${this._statHtml('Maior mult', `${Number(stats.maxMult || 1).toFixed(2)}x`)}
        ${this._statHtml('Vitorias', `${stats.winRate || 0}%`)}
      </section>

      <section class="history-panel">
        <h3>ULTIMAS RODADAS</h3>
        ${history.length ? history.slice(0, 5).map((round) => this._historyRowHtml(round)).join('') : '<p class="empty-state">Sem rodadas ainda</p>'}
      </section>
    `;
  }

  _promoHtml() {
    return `
      <section class="page-heading">
        <h2>PROMOCAO</h2>
        <p>Campanhas ativas da Sereia Palace</p>
      </section>

      <section class="bonus-banner">
        <div class="bonus-copy">
          <span>RECARGUE E GANHE</span>
          <strong>100%</strong>
          <p>DO VALOR EM <small>bonus</small></p>
        </div>
        <button type="button" data-action="deposit">RECARREGAR</button>
      </section>

      <section class="promo-ledger">
        <h3>COMO FICA NA CONTA</h3>
        ${this._promoLineHtml('Recarga', 'R$ 50,00')}
        ${this._promoLineHtml('Bonus', '+ R$ 50,00', true)}
        ${this._promoLineHtml('Total', 'R$ 100,00', true)}
        <p>Oferta valida para recargas selecionadas. Deposito real ainda nao esta conectado.</p>
      </section>
    `;
  }

  _profileHtml() {
    const user = this.snapshot?.user || this.user || {};
    const stats = this.snapshot?.stats || { rounds: 0, maxMult: 1, winRate: 0 };
    const initial = String(user.username || 'S').slice(0, 1).toUpperCase();

    return `
      <section class="page-heading">
        <h2>PERFIL</h2>
        <p>Dados da sua conta</p>
      </section>

      <section class="profile-card">
        <div class="profile-head">
          <div class="profile-avatar">${this._escape(initial)}</div>
          <div>
            <h2>${this._escape(user.username || 'jogadora')}</h2>
            <span>${this._escape(user.role || 'player')}</span>
          </div>
        </div>
        ${this._profileRowHtml('Email', user.email || '-')}
        ${this._profileRowHtml('Telefone', user.phone || '-')}
        ${this._profileRowHtml('Nome', user.legal_name || '-')}
        ${this._profileRowHtml('CPF/CNPJ', user.document_masked || '-')}
      </section>

      <section class="stats-grid profile-stats">
        ${this._statHtml('Rodadas', stats.rounds || 0)}
        ${this._statHtml('Maior mult', `${Number(stats.maxMult || 1).toFixed(2)}x`)}
        ${this._statHtml('Vitorias', `${stats.winRate || 0}%`)}
      </section>

      <section class="profile-actions">
        <button class="gold-btn" type="button" data-action="refresh">Atualizar</button>
        <button class="dark-btn" type="button" data-action="logout">Sair</button>
      </section>
    `;
  }

  _bottomNavHtml() {
    return `
      <nav class="bottom-nav">
        ${TABS.map((tab) => `
          <button class="${this.currentTab === tab.key ? 'active' : ''}" type="button" data-tab="${tab.key}">
            <span>${this.currentTab === tab.key ? '◆' : '◇'}</span>
            ${tab.label}
          </button>
        `).join('')}
      </nav>
    `;
  }

  _modalHtml(type) {
    const isDeposit = type === 'deposit';
    const title = isDeposit ? 'Depositar via Pix' : 'Sacar via Pix';
    const message = this.walletMessage
      ? `<span class="wallet-message">${this._escape(this.walletMessage)}</span>`
      : '';
    const deposit = this.currentDeposit?.intent;
    const user = this.snapshot?.user || this.user || {};
    const needsCustomer = isDeposit && !user.has_kyc;

    if (isDeposit) {
      return `
        <div class="modal-backdrop" data-action="close-modal">
          <section class="modal-card wallet-modal" role="dialog" aria-modal="true" aria-label="${title}">
            <h2>${title}</h2>
            <p>Escolha um valor para gerar um Pix. O saldo entra somente apos confirmacao do pagamento.</p>
            ${needsCustomer ? `
              <label>
                Nome completo
                <input name="deposit-customer-name" autocomplete="name" placeholder="Nome do titular" />
              </label>
              <label>
                CPF
                <input name="deposit-customer-document" inputmode="numeric" placeholder="00000000000" />
              </label>
            ` : ''}
            <div class="amount-grid">
              ${[20, 50, 100, 200].map((amount) => `<button type="button" data-action="deposit-create" data-amount="${amount}">R$ ${amount}</button>`).join('')}
            </div>
            ${deposit ? `
              <div class="pix-box">
                <strong>${this._money(deposit.amount)}</strong>
                <code>${this._escape(deposit.pix_copy_paste || '')}</code>
              </div>
              ${this.currentDeposit?.sandbox ? `<button type="button" data-action="deposit-confirm" data-intent-id="${this._escape(deposit.id)}">SIMULAR PIX PAGO</button>` : ''}
            ` : ''}
            ${message}
            <button type="button" data-action="close-modal">FECHAR</button>
          </section>
        </div>
      `;
    }

    return `
      <div class="modal-backdrop" data-action="close-modal">
        <section class="modal-card wallet-modal" role="dialog" aria-modal="true" aria-label="${title}">
          <h2>${title}</h2>
          <p>Solicite o saque para uma chave Pix. O valor fica reservado na carteira.</p>
          <label>
            Valor
            <input name="withdraw-amount" inputmode="decimal" value="20" />
          </label>
          <label>
            Chave Pix
            <input name="withdraw-key" placeholder="email, telefone, CPF ou aleatoria" />
          </label>
          <select name="withdraw-key-type">
            <option value="random">Aleatoria</option>
            <option value="email">Email</option>
            <option value="phone">Telefone</option>
            <option value="cpf">CPF</option>
            <option value="cnpj">CNPJ</option>
          </select>
          <label>
            Titular
            <input name="withdraw-owner-name" placeholder="Nome completo" />
          </label>
          <label>
            Documento do titular
            <input name="withdraw-owner-document" inputmode="numeric" placeholder="CPF ou CNPJ" />
          </label>
          <select name="withdraw-owner-document-type">
            <option value="cpf">CPF</option>
            <option value="cnpj">CNPJ</option>
          </select>
          <button type="button" data-action="withdraw-submit">SOLICITAR SAQUE</button>
          ${message}
          <button type="button" data-action="close-modal">FECHAR</button>
        </section>
      </div>
    `;
  }

  _statHtml(label, value) {
    return `
      <article>
        <span>${this._escape(label)}</span>
        <strong>${this._escape(value)}</strong>
      </article>
    `;
  }

  _historyRowHtml(round) {
    const won = !!round.won;
    const payout = Number(round.payout || 0);
    return `
      <div class="history-row ${won ? 'won' : 'lost'}">
        <span>${won ? 'WIN' : 'LOSS'}</span>
        <strong>${Number(round.mult || 1).toFixed(2)}x</strong>
        <em>${won ? '+' : ''}${this._money(payout)}</em>
      </div>
    `;
  }

  _promoLineHtml(label, value, strong = false) {
    return `
      <div class="promo-line ${strong ? 'strong' : ''}">
        <span>${this._escape(label)}</span>
        <strong>${this._escape(value)}</strong>
      </div>
    `;
  }

  _profileRowHtml(label, value) {
    return `
      <div class="profile-row">
        <span>${this._escape(label)}</span>
        <strong>${this._escape(value)}</strong>
      </div>
    `;
  }

  _bindDom() {
    this.root.querySelectorAll('[data-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        this.currentTab = button.dataset.tab;
        this.modal = null;
        this._render();
      });
    });

    this.root.querySelectorAll('[data-action]').forEach((button) => {
      button.addEventListener('click', async (event) => {
        const action = button.dataset.action;
        if (action === 'close-modal') {
          event.stopPropagation();
          this.modal = null;
          this.walletMessage = '';
          this.currentDeposit = null;
          this._render();
        } else if (action === 'deposit' || action === 'withdraw') {
          this.modal = action;
          this.walletMessage = '';
          this.currentDeposit = null;
          this._render();
        } else if (action === 'deposit-create') {
          event.stopPropagation();
          await this._createDeposit(Number(button.dataset.amount || 20));
        } else if (action === 'deposit-confirm') {
          event.stopPropagation();
          await this._confirmDeposit(button.dataset.intentId);
        } else if (action === 'withdraw-submit') {
          event.stopPropagation();
          await this._submitWithdrawal();
        } else if (action === 'refresh') {
          this._renderLoading();
          this._loadLobby();
        } else if (action === 'logout') {
          clearSession();
          this.scene.start('Auth');
        } else if (action === 'play') {
          this.scene.start('Menu', { balance: state.balance });
        }
      });
    });

    const modalCard = this.root.querySelector('.modal-card');
    if (modalCard) {
      modalCard.addEventListener('click', (event) => event.stopPropagation());
    }
  }

  async _createDeposit(amount) {
    if (this.walletBusy) return;
    const nameInput = this.root.querySelector('[name="deposit-customer-name"]');
    const documentInput = this.root.querySelector('[name="deposit-customer-document"]');
    const customerName = String(nameInput?.value || '').trim();
    const customerDocument = String(documentInput?.value || '').replace(/\D/g, '').trim();

    if ((nameInput || documentInput) && (customerName.length < 3 || customerDocument.length !== 11)) {
      this.walletMessage = 'Informe nome completo e CPF para gerar Pix.';
      this._render();
      return;
    }

    this.walletBusy = true;
    this.walletMessage = 'Gerando Pix...';
    this._render();

    try {
      this.currentDeposit = await createDepositIntent(amount, customerName, customerDocument, 'cpf');
      this.walletMessage = this.currentDeposit?.sandbox ? 'Pix sandbox criado.' : 'Pix real criado. Aguardando pagamento.';
    } catch (error) {
      this.walletMessage = error.message || 'Falha ao gerar deposito.';
    } finally {
      this.walletBusy = false;
      this._render();
    }
  }

  async _confirmDeposit(intentId) {
    if (this.walletBusy || !intentId) return;
    this.walletBusy = true;
    this.walletMessage = 'Confirmando pagamento sandbox...';
    this._render();

    try {
      await confirmSandboxDeposit(intentId);
      this.walletMessage = 'Deposito confirmado.';
      await this._loadLobby();
    } catch (error) {
      this.walletMessage = error.message || 'Falha ao confirmar deposito.';
      this._render();
    } finally {
      this.walletBusy = false;
    }
  }

  async _submitWithdrawal() {
    if (this.walletBusy) return;
    const amountInput = this.root.querySelector('[name="withdraw-amount"]');
    const keyInput = this.root.querySelector('[name="withdraw-key"]');
    const typeInput = this.root.querySelector('[name="withdraw-key-type"]');
    const ownerNameInput = this.root.querySelector('[name="withdraw-owner-name"]');
    const ownerDocumentInput = this.root.querySelector('[name="withdraw-owner-document"]');
    const ownerDocumentTypeInput = this.root.querySelector('[name="withdraw-owner-document-type"]');
    const amount = Number(String(amountInput?.value || '').replace(',', '.'));
    const pixKey = String(keyInput?.value || '').trim();
    const pixKeyType = String(typeInput?.value || 'random');
    const ownerName = String(ownerNameInput?.value || '').trim();
    const ownerDocument = String(ownerDocumentInput?.value || '').trim();
    const ownerDocumentType = String(ownerDocumentTypeInput?.value || 'cpf');

    if (!Number.isFinite(amount) || amount < 20) {
      this.walletMessage = 'Valor minimo para saque: R$ 20,00.';
      this._render();
      return;
    }
    if (pixKey.length < 5) {
      this.walletMessage = 'Informe uma chave Pix valida.';
      this._render();
      return;
    }
    if (ownerName.length < 3 || ownerDocument.length < 11) {
      this.walletMessage = 'Informe titular e CPF/CNPJ do saque.';
      this._render();
      return;
    }

    this.walletBusy = true;
    this.walletMessage = 'Solicitando saque...';
    this._render();

    try {
      await requestWithdrawal(amount, pixKey, pixKeyType, ownerName, ownerDocument, ownerDocumentType);
      this.walletMessage = 'Saque solicitado.';
      await this._loadLobby();
    } catch (error) {
      this.walletMessage = error.message || 'Falha ao solicitar saque.';
      this._render();
    } finally {
      this.walletBusy = false;
    }
  }

  _drawBackground() {
    const g = this.add.graphics();
    g.fillGradientStyle(CLR.redDark, CLR.redDark, CLR.deep, CLR.deep, 1);
    g.fillRect(0, 0, W, H);

    g.fillStyle(0x000000, 0.28);
    for (let y = 0; y < H; y += 46) {
      g.fillRect(0, y, W, 1);
    }

    for (let i = 0; i < 10; i++) {
      const x = -30 + i * 52;
      g.fillStyle(i % 2 ? CLR.gold : CLR.red, 0.10);
      g.fillTriangle(x, 0, x + 34, 0, x + 6, 260);
    }

    g.lineStyle(2, CLR.gold, 0.25);
    g.strokeCircle(W + 8, 42, 86);
    g.strokeCircle(-16, H - 26, 116);
  }

  _floatGold() {
    const dots = Array.from({ length: 18 }, () => {
      const dot = this.add.circle(
        Phaser.Math.Between(0, W),
        Phaser.Math.Between(0, H),
        Phaser.Math.Between(1, 3),
        CLR.gold,
        Phaser.Math.FloatBetween(0.10, 0.25),
      );
      return { dot, vy: Phaser.Math.Between(12, 30) };
    });

    this._subs.push(this.time.addEvent({
      delay: 33,
      loop: true,
      callback: () => {
        dots.forEach((item) => {
          item.dot.y -= item.vy * 0.033;
          if (item.dot.y < -8) {
            item.dot.x = Phaser.Math.Between(0, W);
            item.dot.y = H + 8;
          }
        });
      },
    }));
  }

  _style() {
    return `
      <style>
        .sereia-lobby-root {
          position: fixed;
          inset: 0;
          z-index: 18;
          color: #fff7dc;
          font-family: Arial, Helvetica, sans-serif;
          -webkit-font-smoothing: antialiased;
          text-rendering: geometricPrecision;
          pointer-events: auto;
          overflow-y: auto;
          overscroll-behavior: contain;
          -webkit-overflow-scrolling: touch;
        }
        .sereia-lobby-root * { box-sizing: border-box; }
        .lobby-shell {
          width: min(430px, 100vw);
          min-height: 100dvh;
          margin: 0 auto;
          padding: max(14px, env(safe-area-inset-top)) 14px calc(62px + env(safe-area-inset-bottom));
          pointer-events: auto;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .loading-shell {
          justify-content: center;
          align-items: center;
        }
        .loading-card {
          width: min(300px, calc(100vw - 36px));
          padding: 24px 20px;
          border-radius: 14px;
          border: 1px solid rgba(244, 200, 74, 0.58);
          background: linear-gradient(180deg, rgba(92, 8, 22, 0.95), rgba(8, 7, 17, 0.98));
          box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
          display: grid;
          justify-items: center;
          gap: 8px;
        }
        .loading-card strong {
          color: #ffdf72;
          font-size: 18px;
          font-weight: 900;
        }
        .loading-card span {
          color: #ffd0be;
          font-size: 13px;
        }
        .topbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          min-height: 46px;
        }
        .brand-lockup {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }
        .brand-orb {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          display: grid;
          place-items: center;
          flex: 0 0 auto;
          color: #ffeb9a;
          font: 900 22px/1 "Arial Black", Arial, sans-serif;
          background: radial-gradient(circle at 35% 24%, #e65b6a 0, #9f1426 50%, #4a0612 100%);
          border: 1px solid rgba(255, 229, 141, 0.75);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
        }
        h1, h2, h3, p { margin: 0; }
        .brand-lockup h1 {
          color: #ffdf72;
          font: 900 18px/1.05 "Arial Black", Arial, sans-serif;
          text-shadow: 0 2px 0 #5d1600;
        }
        .brand-lockup p {
          margin-top: 4px;
          color: #e0b39a;
          font-size: 12px;
          font-weight: 700;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 210px;
        }
        .top-actions {
          display: flex;
          gap: 8px;
        }
        button {
          font-family: inherit;
          border: 0;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }
        .icon-btn {
          width: 38px;
          height: 36px;
          border-radius: 10px;
          color: #ffdf72;
          font: 900 13px/1 "Arial Black", Arial, sans-serif;
          background: rgba(29, 19, 32, 0.92);
          border: 1px solid rgba(112, 66, 30, 0.82);
        }
        .lobby-content {
          display: flex;
          flex-direction: column;
          gap: 12px;
          min-height: 0;
        }
        .wallet-card,
        .game-card,
        .history-panel,
        .promo-ledger,
        .profile-card {
          border-radius: 12px;
          border: 1px solid rgba(244, 200, 74, 0.52);
          background: linear-gradient(180deg, rgba(45, 16, 20, 0.95), rgba(14, 11, 18, 0.96));
          box-shadow: 0 12px 34px rgba(0, 0, 0, 0.30), inset 0 1px 0 rgba(255, 255, 255, 0.08);
        }
        .wallet-card {
          position: relative;
          overflow: hidden;
          padding: 16px 16px 14px;
        }
        .wallet-card::after {
          content: "";
          position: absolute;
          width: 118px;
          height: 118px;
          right: -28px;
          top: -34px;
          border-radius: 50%;
          background: rgba(244, 200, 74, 0.16);
        }
        .wallet-card > span,
        .history-panel h3,
        .promo-ledger h3 {
          display: block;
          color: #f4c84a;
          font: 900 12px/1.1 "Arial Black", Arial, sans-serif;
          margin-bottom: 7px;
        }
        .wallet-card > strong {
          display: block;
          position: relative;
          z-index: 1;
          color: #fff7dc;
          font: 900 36px/1 "Arial Black", Arial, sans-serif;
          text-shadow: 0 3px 0 rgba(0, 0, 0, 0.35);
          margin-bottom: 12px;
        }
        .wallet-actions,
        .profile-actions {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }
        .gold-btn,
        .dark-btn,
        .play-btn,
        .bonus-banner button,
        .modal-card button {
          min-height: 42px;
          border-radius: 10px;
          font: 900 13px/1 "Arial Black", Arial, sans-serif;
        }
        .gold-btn {
          color: #2a070c;
          background: linear-gradient(180deg, #ffe58d, #d59d19 58%, #8d1c18);
          box-shadow: 0 7px 0 rgba(74, 0, 12, 0.58);
        }
        .dark-btn {
          color: #fff7dc;
          background: linear-gradient(180deg, #17233a, #101521);
          border: 1px solid rgba(84, 119, 177, 0.58);
        }
        .promo-strip {
          width: 100%;
          min-height: 72px;
          border-radius: 12px;
          padding: 12px 14px;
          display: grid;
          grid-template-columns: 1fr auto;
          align-items: center;
          text-align: left;
          color: #fff7dc;
          background: linear-gradient(180deg, #cf2038, #7c1021);
          border: 1px solid rgba(255, 229, 141, 0.62);
        }
        .promo-strip span {
          width: max-content;
          padding: 4px 8px;
          border-radius: 7px;
          color: #350006;
          background: #ffdf72;
          font: 900 11px/1 "Arial Black", Arial, sans-serif;
        }
        .promo-strip strong {
          display: block;
          margin-top: 8px;
          font: 900 21px/1 "Arial Black", Arial, sans-serif;
        }
        .promo-strip em {
          grid-row: 1 / span 2;
          grid-column: 2;
          color: #ffdf72;
          font: 900 22px/0.9 "Arial Black", Arial, sans-serif;
          text-align: right;
          font-style: normal;
        }
        .promo-strip small {
          display: block;
          margin-top: 4px;
          font-size: 12px;
        }
        .category-row {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 8px;
        }
        .category-row span {
          min-height: 34px;
          display: grid;
          place-items: center;
          border-radius: 999px;
          color: #ffdca0;
          background: rgba(33, 21, 33, 0.94);
          border: 1px solid rgba(112, 66, 30, 0.70);
          font: 900 13px/1 "Arial Black", Arial, sans-serif;
        }
        .category-row .active {
          color: #330009;
          background: linear-gradient(180deg, #ffe58d, #f4c84a);
          border-color: #ffe58d;
        }
        .game-card {
          display: grid;
          grid-template-columns: 132px 1fr;
          gap: 14px;
          padding: 12px;
        }
        .game-art {
          position: relative;
          min-height: 132px;
          border-radius: 12px;
          overflow: hidden;
          background: linear-gradient(180deg, #113251, #041120);
          border: 1px solid rgba(55, 217, 255, 0.35);
        }
        .art-glow,
        .mermaid-mark,
        .gem-mark {
          position: absolute;
        }
        .art-glow {
          width: 106px;
          height: 106px;
          left: 12px;
          top: 20px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(55, 217, 255, 0.28), rgba(55, 217, 255, 0.03) 64%);
        }
        .mermaid-mark {
          width: 70px;
          height: 70px;
          left: 31px;
          top: 30px;
          display: grid;
          place-items: center;
          border-radius: 50%;
          color: #ffdf72;
          font: 900 46px/1 "Arial Black", Arial, sans-serif;
          background: radial-gradient(circle at 35% 28%, #62f5e8, #1d7e9a 52%, #08243b);
          border: 2px solid rgba(255, 229, 141, 0.75);
        }
        .gem-mark {
          width: 28px;
          height: 28px;
          right: 18px;
          bottom: 20px;
          transform: rotate(45deg);
          background: linear-gradient(135deg, #d7fbff, #37d9ff 45%, #0d7490);
          border: 1px solid rgba(255, 255, 255, 0.70);
          box-shadow: 0 0 18px rgba(55, 217, 255, 0.55);
        }
        .game-info {
          min-width: 0;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }
        .game-info h2 {
          color: #ffdf72;
          font: 900 21px/1.05 "Arial Black", Arial, sans-serif;
        }
        .game-info p {
          color: #ffd0be;
          font-size: 13px;
          font-weight: 700;
        }
        .badges {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .badges span {
          padding: 6px 8px;
          border-radius: 7px;
          color: #80ffd7;
          background: #123d2d;
          font: 900 10px/1 "Arial Black", Arial, sans-serif;
        }
        .badges span + span {
          color: #ffdca0;
          background: #3f1420;
        }
        .play-btn {
          width: 100%;
          color: #330009;
          background: linear-gradient(180deg, #ffe58d, #d89819);
          box-shadow: 0 7px 0 rgba(74, 0, 12, 0.62);
        }
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
        }
        .stats-grid article {
          min-height: 62px;
          padding: 12px 10px;
          border-radius: 10px;
          background: rgba(23, 17, 29, 0.94);
          border: 1px solid rgba(112, 66, 30, 0.76);
        }
        .stats-grid span {
          display: block;
          color: #e0b39a;
          font-size: 12px;
          font-weight: 800;
          margin-bottom: 6px;
        }
        .stats-grid strong {
          color: #fff7dc;
          font: 900 19px/1 "Arial Black", Arial, sans-serif;
        }
        .history-panel {
          padding: 13px 12px;
        }
        .history-row {
          min-height: 32px;
          padding: 7px 10px;
          border-radius: 8px;
          display: grid;
          grid-template-columns: 62px 1fr auto;
          align-items: center;
          gap: 8px;
          background: rgba(48, 16, 24, 0.94);
          margin-top: 8px;
        }
        .history-row.won {
          background: rgba(13, 43, 36, 0.94);
        }
        .history-row span,
        .history-row strong,
        .history-row em {
          font: 900 13px/1 "Arial Black", Arial, sans-serif;
          font-style: normal;
        }
        .history-row span,
        .history-row em {
          color: #ff6b7b;
        }
        .history-row.won span,
        .history-row.won em {
          color: #80ffd7;
        }
        .history-row strong {
          color: #fff7dc;
        }
        .empty-state {
          min-height: 54px;
          display: grid;
          place-items: center;
          color: #e0b39a;
          font-size: 14px;
          font-weight: 700;
        }
        .page-heading {
          padding: 2px 2px 0;
        }
        .page-heading h2 {
          color: #ffdf72;
          font: 900 20px/1 "Arial Black", Arial, sans-serif;
        }
        .page-heading p {
          margin-top: 5px;
          color: #ffd0be;
          font-size: 13px;
          font-weight: 700;
        }
        .bonus-banner {
          min-height: 188px;
          border-radius: 14px;
          padding: 18px 20px;
          position: relative;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          background: linear-gradient(145deg, #f7c948 0%, #d79a21 42%, #b0162b 100%);
          border: 2px solid rgba(255, 240, 166, 0.78);
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.34);
        }
        .bonus-banner::before,
        .bonus-banner::after {
          content: "";
          position: absolute;
          border-radius: 50%;
          pointer-events: none;
        }
        .bonus-banner::before {
          width: 160px;
          height: 160px;
          right: -42px;
          top: -54px;
          background: rgba(74, 6, 18, 0.24);
        }
        .bonus-banner::after {
          width: 132px;
          height: 132px;
          left: -36px;
          bottom: -48px;
          background: rgba(255, 255, 255, 0.14);
        }
        .bonus-copy {
          position: relative;
          z-index: 1;
        }
        .bonus-copy span {
          color: #3a050f;
          font: 900 15px/1 "Arial Black", Arial, sans-serif;
        }
        .bonus-copy strong {
          display: block;
          color: #fff7dc;
          font: 900 62px/0.9 "Arial Black", Arial, sans-serif;
          text-shadow: 0 5px 0 rgba(100, 16, 23, 0.86);
          margin: 12px 0 6px;
        }
        .bonus-copy p {
          color: #ffe8ac;
          font: 900 14px/1 "Arial Black", Arial, sans-serif;
        }
        .bonus-copy small {
          font-size: 10px;
          opacity: 0.92;
        }
        .bonus-banner button {
          position: relative;
          z-index: 1;
          width: 150px;
          color: #fff7dc;
          background: linear-gradient(180deg, #2b0a12, #721521);
          border: 1px solid rgba(255, 240, 166, 0.42);
        }
        .promo-ledger {
          padding: 16px 16px 12px;
        }
        .promo-line,
        .profile-row {
          min-height: 36px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          border-top: 1px solid rgba(112, 66, 30, 0.45);
        }
        .promo-line span,
        .profile-row span {
          color: #e0b39a;
          font-size: 14px;
          font-weight: 800;
        }
        .promo-line strong,
        .profile-row strong {
          color: #fff7dc;
          font: 900 15px/1.1 "Arial Black", Arial, sans-serif;
          text-align: right;
          min-width: 0;
          word-break: break-word;
        }
        .promo-line.strong strong {
          color: #80ffd7;
        }
        .promo-ledger p {
          margin-top: 10px;
          color: #dca197;
          font-size: 12px;
          line-height: 1.35;
        }
        .profile-card {
          padding: 16px;
        }
        .profile-head {
          display: flex;
          align-items: center;
          gap: 14px;
          margin-bottom: 14px;
        }
        .profile-avatar {
          width: 66px;
          height: 66px;
          border-radius: 50%;
          display: grid;
          place-items: center;
          color: #ffeb9a;
          font: 900 32px/1 "Arial Black", Arial, sans-serif;
          background: radial-gradient(circle at 35% 24%, #e65b6a 0, #9f1426 50%, #4a0612 100%);
          border: 1px solid rgba(255, 229, 141, 0.75);
        }
        .profile-head h2 {
          color: #fff7dc;
          font: 900 24px/1.05 "Arial Black", Arial, sans-serif;
          word-break: break-word;
        }
        .profile-head span {
          width: max-content;
          display: inline-block;
          margin-top: 8px;
          padding: 6px 9px;
          border-radius: 7px;
          color: #ffe58d;
          background: #604000;
          font: 900 11px/1 "Arial Black", Arial, sans-serif;
          text-transform: uppercase;
        }
        .profile-stats,
        .profile-actions {
          margin-top: 2px;
        }
        .bottom-nav {
          position: fixed;
          left: 50%;
          bottom: 0;
          transform: translateX(-50%);
          width: min(430px, 100vw);
          padding: 8px 12px calc(8px + env(safe-area-inset-bottom));
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 8px;
          background: rgba(9, 7, 16, 0.98);
          border-top: 1px solid rgba(244, 200, 74, 0.34);
          box-shadow: 0 -12px 30px rgba(0, 0, 0, 0.35);
        }
        .bottom-nav button {
          min-height: 44px;
          border-radius: 10px;
          color: #b69085;
          background: transparent;
          font-size: 12px;
          font-weight: 900;
        }
        .bottom-nav span {
          display: block;
          margin-bottom: 3px;
          font-size: 13px;
        }
        .bottom-nav .active {
          color: #ffdf72;
          background: rgba(36, 21, 9, 0.90);
          border: 1px solid rgba(244, 200, 74, 0.58);
        }
        .modal-backdrop {
          position: fixed;
          inset: 0;
          z-index: 28;
          display: grid;
          place-items: center;
          padding: 18px;
          pointer-events: auto;
          background: rgba(0, 0, 0, 0.72);
        }
        .modal-card {
          width: min(332px, calc(100vw - 36px));
          border-radius: 14px;
          padding: 22px 18px 18px;
          text-align: center;
          background: linear-gradient(180deg, #190d16, #090710);
          border: 2px solid rgba(244, 200, 74, 0.58);
          box-shadow: 0 24px 70px rgba(0, 0, 0, 0.48);
        }
        .modal-card h2 {
          color: #ffdf72;
          font: 900 20px/1.1 "Arial Black", Arial, sans-serif;
        }
        .modal-card p {
          color: #ffc4aa;
          font-size: 14px;
          line-height: 1.35;
          margin: 18px 0 14px;
        }
        .modal-card span {
          display: block;
          color: #8d6c61;
          font: 900 12px/1 "Arial Black", Arial, sans-serif;
          margin-bottom: 18px;
        }
        .wallet-modal {
          display: grid;
          gap: 12px;
        }
        .wallet-modal p {
          margin: 0;
        }
        .wallet-modal label {
          display: grid;
          gap: 6px;
          text-align: left;
          color: #ffdf72;
          font-size: 12px;
          font-weight: 900;
        }
        .wallet-modal input,
        .wallet-modal select {
          width: 100%;
          min-height: 42px;
          border-radius: 10px;
          border: 1px solid rgba(244, 200, 74, 0.38);
          background: rgba(9, 7, 16, 0.95);
          color: #fff7dc;
          padding: 0 12px;
          font: 800 14px/1 Arial, sans-serif;
          outline: none;
        }
        .amount-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 8px;
        }
        .amount-grid button {
          min-height: 42px;
          color: #330009;
          background: linear-gradient(180deg, #ffe58d, #d59d19);
        }
        .pix-box {
          padding: 12px;
          border-radius: 10px;
          background: rgba(23, 17, 29, 0.96);
          border: 1px solid rgba(55, 217, 255, 0.30);
          display: grid;
          gap: 8px;
        }
        .pix-box strong {
          color: #80ffd7;
          font: 900 18px/1 "Arial Black", Arial, sans-serif;
        }
        .pix-box code {
          display: block;
          max-height: 70px;
          overflow: auto;
          color: #d7fbff;
          font: 700 11px/1.35 Consolas, monospace;
          word-break: break-all;
        }
        .wallet-message {
          margin: 0;
          color: #80ffd7 !important;
          line-height: 1.25 !important;
        }
        .modal-card button {
          min-width: 130px;
          color: #330009;
          background: linear-gradient(180deg, #ffe58d, #d59d19);
        }
        @media (max-height: 720px) {
          .lobby-shell {
            gap: 9px;
            padding-top: max(10px, env(safe-area-inset-top));
          }
          .wallet-card {
            padding: 13px 14px 12px;
          }
          .wallet-card > strong {
            font-size: 32px;
            margin-bottom: 10px;
          }
          .promo-strip {
            min-height: 64px;
          }
          .game-card {
            grid-template-columns: 116px 1fr;
          }
          .game-art {
            min-height: 118px;
          }
          .history-panel {
            padding: 11px 12px;
          }
          .history-row {
            min-height: 30px;
          }
        }
      </style>
    `;
  }

  _money(value) {
    return `R$ ${Number(value || 0).toFixed(2)}`;
  }

  _escape(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    })[char]);
  }

  _cleanup() {
    this._subs.forEach((item) => {
      if (item && item.destroy) item.destroy();
    });
    this._subs = [];
    if (this.root) {
      this.root.remove();
      this.root = null;
    }
  }
}
