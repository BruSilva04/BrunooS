import Phaser from 'phaser';
import { W, H, state } from '../config.js';
import { BRAND } from '../brand.js';
import {
  clearSession,
  confirmSandboxDeposit,
  createDepositIntent,
  fetchLobby,
  getStoredUser,
  requestWithdrawal,
} from '../services/api.js';

const TABS = [
  { key: 'lobby', label: 'Lobby', icon: '▦' },
  { key: 'promo', label: 'Carteira', icon: '▤' },
  { key: 'profile', label: 'Perfil', icon: '○' },
];

export default class LobbyScene extends Phaser.Scene {
  constructor() {
    super({ key: 'Lobby' });
  }

  init(data = {}) {
    this.fallbackBalance = data.balance;
    this.user = getStoredUser();
    this.snapshot = null;
    this.currentTab = TABS.some((tab) => tab.key === data.tab) ? data.tab : 'lobby';
    this.modal = null;
    this.notice = data.notice || '';
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
    this._loadLobby();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this._cleanup());
  }

  async _loadLobby() {
    const mountedRoot = this.root;
    try {
      const snapshot = await fetchLobby();
      if (!mountedRoot || this.root !== mountedRoot) return;
      this.snapshot = snapshot;
      this.user = this.snapshot.user;
      state.balance = Number(this.snapshot.balance || 0);
      state.demoMode = this.snapshot.demo_mode === true;
      state.activeBlockRound = this.snapshot.active_block_round || null;
      state.history = (this.snapshot.history || []).map((round) => Number(round.mult || 1)).slice(0, 5);
      this.modal = null;
      this._render();
    } catch (error) {
      if (!mountedRoot || this.root !== mountedRoot) return;
      if (error.status === 401) {
        clearSession();
        this.scene.start('Auth');
      } else if (this.snapshot) {
        this.notice = error.message || 'Não foi possível atualizar a conta. Tente novamente.';
        this._render();
      } else {
        this.root.innerHTML = `
          ${this._style()}
          <main class="lobby-shell loading-shell">
            <section class="loading-card" role="alert">
              ${this._brandMarkHtml()}
              <strong>Não foi possível carregar</strong>
              <span>${this._escape(error.message || 'Tente novamente em instantes.')}</span>
              <button type="button" class="primary-btn" data-action="refresh">Tentar novamente</button>
              <button type="button" class="dark-btn" data-action="logout">Voltar ao acesso</button>
            </section>
          </main>`;
        this._bindDom();
      }
    }
  }

  _mountLobby() {
    this.root = document.createElement('div');
    this.root.className = 'block-lobby-root';
    this.root.addEventListener('keydown', (event) => this._onKeyDown(event));
    document.body.appendChild(this.root);
  }

  _renderLoading() {
    if (!this.root) return;
    this.root.innerHTML = `
      ${this._style()}
      <main class="lobby-shell loading-shell">
        <section class="loading-card" role="status">
          ${this._brandMarkHtml()}
          <strong>Carregando seu lobby</strong>
          <span>Buscando os dados da sua conta…</span>
        </section>
      </main>
    `;
  }

  _render() {
    if (!this.root) return;
    const previousModal = this.root.querySelector('.modal-card');
    const formValues = previousModal && previousModal.dataset.modal === this.modal
      ? [...previousModal.querySelectorAll('input, select')].map((input) => [input.name, input.value])
      : [];
    const focusedName = previousModal?.contains(document.activeElement) ? document.activeElement.name : '';
    this.root.innerHTML = `
      ${this._style()}
      <main class="lobby-shell" ${this.modal ? 'inert' : ''}>
        ${this._topBarHtml()}
        <section class="lobby-content">
          ${this.notice ? `<section class="lobby-notice" role="status">${this._escape(this.notice)}</section>` : ''}
          ${this.currentTab === 'promo' ? this._promoHtml() : ''}
          ${this.currentTab === 'profile' ? this._profileHtml() : ''}
          ${this.currentTab === 'lobby' ? this._lobbyHtml() : ''}
        </section>
        ${this._bottomNavHtml()}
      </main>
      ${this.modal ? this._modalHtml(this.modal) : ''}
    `;
    formValues.forEach(([name, value]) => {
      const field = this.root.querySelector(`[name="${name}"]`);
      if (field) field.value = value;
    });
    this._bindDom();
    if (this.modal) {
      const modal = this.root.querySelector('.modal-card');
      const focusTarget = focusedName
        ? modal.querySelector(`[name="${focusedName}"]`)
        : modal;
      (focusTarget || modal)?.focus({ preventScroll: true });
    }
  }

  _brandMarkHtml() {
    return '<div class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></div>';
  }

  _topBarHtml() {
    const user = this.snapshot?.user || this.user || {};
    return `
      <header class="topbar">
        <div class="brand-lockup">
          ${this._brandMarkHtml()}
          <div>
            <h1>${this._escape(BRAND.upperName)}</h1>
            <p>Olá, ${this._escape(user.username || 'jogador')}</p>
          </div>
        </div>
        <div class="top-actions">
          <button class="icon-btn" type="button" data-action="refresh" aria-label="Atualizar conta" title="Atualizar conta">&#8635;</button>
          <button class="icon-btn" type="button" data-action="logout" aria-label="Sair da conta" title="Sair da conta">&#8618;</button>
        </div>
      </header>
    `;
  }

  _lobbyHtml() {
    const history = this.snapshot?.history || [];

    return `
      <section class="lobby-intro">
        <span class="eyebrow">SEU ESPAÇO PARA JOGAR</span>
        <h2>Cada bloco, uma possibilidade.</h2>
        <p>Escolha seu próximo movimento.</p>
      </section>
      <div class="lobby-grid">
        <div class="lobby-main">
          <section class="game-card">
            <div class="game-art" aria-hidden="true">
              <span class="art-label">ENCAIXE. COMPLETE. REPITA.</span>
              ${this._blockBoardHtml()}
              <span class="art-caption">8 × 8 <i></i> INFINITAS POSSIBILIDADES</span>
            </div>
            <div class="game-info">
              <div class="badges"><span>PUZZLE DE BLOCOS</span><span>${state.demoMode ? 'DEMO ADMIN' : 'SALDO REAL'}</span></div>
              <h2>${this._escape(BRAND.name)}</h2>
              <p>Encaixe as peças, complete linhas e colunas e encontre a sua melhor sequência.</p>
              <button class="play-btn" type="button" data-action="play">${state.activeBlockRound ? 'Retomar rodada' : state.demoMode ? 'Jogar demo' : 'Jogar'} <span aria-hidden="true">↗</span></button>
              <span class="demo-caption">${state.demoMode ? 'Demonstração exclusiva da conta administradora.' : state.activeBlockRound ? 'Sua rodada está salva. Retome sem uma nova aposta.' : 'A aposta usa o saldo disponível da sua conta.'}</span>
            </div>
          </section>
          <section class="how-to-panel" aria-labelledby="how-to-title">
            <div class="section-title"><h3 id="how-to-title">Seu próximo desafio</h3><span>COMO JOGAR</span></div>
            <ol class="how-to-grid">
              <li><span>01</span><div><strong>Encaixe as peças</strong><p>Encontre espaço no tabuleiro de 8 × 8.</p></div></li>
              <li><span>02</span><div><strong>Complete linhas</strong><p>Preencha linhas e colunas para liberar espaço.</p></div></li>
              <li><span>03</span><div><strong>Planeje a sequência</strong><p>Continue enquanto houver jogadas possíveis.</p></div></li>
            </ol>
          </section>
        </div>
        <aside class="lobby-sidebar" aria-label="Sua conta">
          ${this._walletCardHtml()}
          ${this._rolloverHtml()}
          ${this._adminEntryHtml()}
          <section class="history-panel">
            <div class="section-title"><h3>Registros da conta</h3></div>
            <p class="panel-description">${state.demoMode ? 'Partidas demo não movimentam o histórico financeiro.' : 'Apostas e resgates registrados na sua conta.'}</p>
            ${history.length ? history.slice(0, 5).map((round) => this._historyRowHtml(round)).join('') : '<div class="empty-state"><span aria-hidden="true">▤</span><strong>Nenhuma rodada registrada</strong><p>Suas rodadas aparecerão aqui.</p></div>'}
          </section>
        </aside>
      </div>
    `;
  }

  _blockBoardHtml() {
    const rows = [
      '........',
      '...vv...',
      '.ccvv...',
      '.c...pp.',
      '.c...p..',
      'vv...p..',
      '.v.ccc..',
      '.v....pp',
    ];
    return `<div class="block-board">${rows.join('').split('').map((cell) => `<i class="block-cell ${cell === '.' ? '' : `filled block-${cell}`}"></i>`).join('')}</div>`;
  }

  _walletCardHtml() {
    const bonusBalance = Number(this.snapshot?.bonus_balance || 0);
    return `
      <section class="wallet-card">
        <div class="wallet-heading"><span>${state.demoMode ? 'CARTEIRA DEMO' : 'MINHA CARTEIRA'}</span><span aria-hidden="true">▤</span></div>
        <span class="balance-label">Saldo disponível</span>
        <strong>${this._money(state.balance)}</strong>
        ${bonusBalance > 0 ? `<p class="bonus-balance">Bônus ativo: ${this._money(bonusBalance)}</p>` : ''}
        <div class="wallet-actions">
          <button class="primary-btn" type="button" data-action="deposit">Depositar</button>
          <button class="dark-btn" type="button" data-action="withdraw">Sacar Pix</button>
        </div>
        <p class="wallet-note">${state.demoMode ? 'Saldo de demonstração. Não representa dinheiro real.' : 'Saldo real da sua conta.'}</p>
      </section>
    `;
  }

  _promoHtml() {
    return `
      <section class="page-heading">
        <span class="eyebrow">SUA CONTA</span>
        <h2>Carteira</h2>
        <p>Acompanhe o saldo e as condições da sua conta.</p>
      </section>
      <div class="wallet-page-grid">
        <div class="lobby-sidebar">
          ${this._walletCardHtml()}
          ${this._rolloverHtml()}
        </div>
        <section class="promo-ledger">
          <h3>Regras da carteira</h3>
          <p>O saldo é creditado após a confirmação do Pix. Estas são as regras atuais para depósitos:</p>
          ${this._promoLineHtml('Depósitos abaixo de R$ 100', 'Sem bônus')}
          ${this._promoLineHtml('Depósitos a partir de R$ 100', '100% de bônus')}
          ${this._promoLineHtml('Movimentação exigida para saque', '2× o crédito total')}
          <p class="rules-example">Exemplo: um depósito de R$ 100 gera R$ 200 de crédito total e exige R$ 400 de movimentação.</p>
          <div class="demo-note"><strong>${state.demoMode ? 'Conta demo' : 'Partidas com saldo real'}</strong><p>${state.demoMode ? 'Somente a conta administradora joga em demonstração, sem apostas reais.' : 'A aposta é debitada ao iniciar a rodada. Resgates confirmados retornam para sua carteira; apostas contam para o rollover.'}</p></div>
        </section>
      </div>
    `;
  }

  _profileHtml() {
    const user = this.snapshot?.user || this.user || {};
    const stats = this.snapshot?.stats || { rounds: 0, maxMult: 1, winRate: 0 };
    const rollover = this._rollover();
    const initial = String(user.username || 'B').slice(0, 1).toUpperCase();

    return `
      <section class="page-heading">
        <span class="eyebrow">SUA CONTA</span><h2>Perfil</h2>
        <p>Dados da sua conta</p>
      </section>

      <section class="profile-card">
        <div class="profile-head">
          <div class="profile-avatar">${this._escape(initial)}</div>
          <div>
            <h2>${this._escape(user.username || 'jogador')}</h2>
            <span>${this._isAdmin() ? 'Administrador' : 'Jogador'}</span>
          </div>
        </div>
        ${this._profileRowHtml('E-mail', user.email || '-')}
        ${this._profileRowHtml('Telefone', user.phone || '-')}
        ${this._profileRowHtml('Nome', user.legal_name || '-')}
        ${this._profileRowHtml('CPF/CNPJ', user.document_masked || '-')}
        ${this._profileRowHtml('Origem', user.referral_code || '-')}
        ${this._profileRowHtml('Saldo', this._money(state.balance))}
        ${this._profileRowHtml('Bônus', this._money(this.snapshot?.bonus_balance || 0))}
        ${this._profileRowHtml('Rollover restante', this._money(rollover.remaining || 0))}
      </section>

      <p class="panel-description">Estatísticas dos registros da conta. Não incluem partidas demo.</p>
      <section class="stats-grid profile-stats">
        ${this._statHtml('Rodadas registradas', stats.rounds || 0)}
        ${this._statHtml('Maior multiplicador', `${Number(stats.maxMult || 1).toFixed(2)}x`)}
        ${this._statHtml('Vitórias', `${stats.winRate || 0}%`)}
      </section>

      <section class="profile-actions">
        ${this._isAdmin() ? '<button class="primary-btn" type="button" data-action="admin">Painel administrativo</button>' : ''}
        <button class="primary-btn" type="button" data-action="refresh">Atualizar</button>
        <button class="dark-btn" type="button" data-action="logout">Sair</button>
      </section>
    `;
  }

  _isAdmin() {
    const user = this.snapshot?.user || this.user || {};
    const permissions = user.permissions || {};
    return user.role === 'admin' || !!permissions.admin;
  }

  _adminEntryHtml() {
    if (!this._isAdmin()) return '';
    return `
      <button class="admin-entry" type="button" data-action="admin">
        <span>ADMINISTRAÇÃO</span>
        <strong>Painel administrativo</strong>
        <em>Aquisição, influenciadores e campanhas</em>
      </button>
    `;
  }

  _bottomNavHtml() {
    return `
      <nav class="bottom-nav" aria-label="Navegação principal">
        ${TABS.map((tab) => `
          <button class="${this.currentTab === tab.key ? 'active' : ''}" type="button" data-tab="${tab.key}" ${this.currentTab === tab.key ? 'aria-current="page"' : ''}>
            <span aria-hidden="true">${tab.icon}</span>
            ${tab.label}
          </button>
        `).join('')}
      </nav>
    `;
  }

  _modalHtml(type) {
    const isDeposit = type === 'deposit';
    const title = state.demoMode ? (isDeposit ? 'Depósito de demonstração' : 'Saque de demonstração')
      : isDeposit ? 'Depositar via Pix' : 'Sacar via Pix';
    const message = this.walletMessage
      ? `<span class="wallet-message" role="status">${this._escape(this.walletMessage)}</span>`
      : '';
    const deposit = this.currentDeposit?.intent;
    const user = this.snapshot?.user || this.user || {};
    const needsCustomer = isDeposit && !user.has_kyc;
    const rollover = this._rollover();
    const canWithdraw = rollover.complete;

    if (isDeposit) {
      return `
        <div class="modal-backdrop" data-action="close-modal">
          <section class="modal-card wallet-modal" data-modal="${type}" tabindex="-1" role="dialog" aria-modal="true" aria-label="${title}">
            <h2>${title}</h2>
            <p>${state.demoMode ? 'Simule um depósito na sua carteira demo. Nenhum pagamento real será gerado.' : 'Escolha um valor para gerar um Pix. O saldo entra somente após a confirmação do pagamento.'}</p>
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
              ${[20, 50, 100, 200].map((amount) => `<button type="button" data-action="deposit-create" data-amount="${amount}" ${this.walletBusy ? 'disabled' : ''}>R$ ${amount}</button>`).join('')}
            </div>
            ${deposit ? `
              <div class="pix-box">
                <strong>${this._money(deposit.amount)}</strong>
                <span>${this._depositPreviewText(deposit.amount)}</span>
                <code>${this._escape(deposit.pix_copy_paste || '')}</code>
              </div>
              ${state.demoMode && this.currentDeposit?.sandbox ? `<button type="button" data-action="deposit-confirm" data-intent-id="${this._escape(deposit.id)}" ${this.walletBusy ? 'disabled' : ''}>Simular Pix pago</button>` : ''}
            ` : ''}
            ${message}
            <button type="button" data-action="close-modal" ${this.walletBusy ? 'disabled' : ''}>Fechar</button>
          </section>
        </div>
      `;
    }

    return `
      <div class="modal-backdrop" data-action="close-modal">
        <section class="modal-card wallet-modal" data-modal="${type}" tabindex="-1" role="dialog" aria-modal="true" aria-label="${title}">
          <h2>${title}</h2>
          <p>${state.demoMode ? 'Operação de demonstração, sem transferência de dinheiro real.' : canWithdraw ? 'Solicite o saque para uma chave Pix. O valor fica reservado na carteira.' : `Movimente mais ${this._money(rollover.remaining || 0)} antes de sacar.`}</p>
          ${!canWithdraw ? this._rolloverHtml(true) : ''}
          <label>
            Valor
            <input name="withdraw-amount" inputmode="decimal" value="20" />
          </label>
          <label>
            Chave Pix
            <input name="withdraw-key" placeholder="E-mail, telefone, CPF ou aleatória" />
          </label>
          <select name="withdraw-key-type" aria-label="Tipo de chave Pix">
            <option value="random">Aleatória</option>
            <option value="email">E-mail</option>
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
          <select name="withdraw-owner-document-type" aria-label="Tipo de documento do titular">
            <option value="cpf">CPF</option>
            <option value="cnpj">CNPJ</option>
          </select>
          <button type="button" data-action="withdraw-submit" ${canWithdraw && !this.walletBusy ? '' : 'disabled'}>Solicitar saque</button>
          ${message}
          <button type="button" data-action="close-modal" ${this.walletBusy ? 'disabled' : ''}>Fechar</button>
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
        <span>${won ? 'Vitória' : 'Perda'}</span>
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

  _rollover() {
    return this.snapshot?.rollover || {
      required: 0,
      progress: 0,
      remaining: 0,
      complete: true,
      percent: 100,
    };
  }

  _rolloverHtml(compact = false) {
    const rollover = this._rollover();
    if (!rollover.required || rollover.complete) {
      return compact ? '' : `
        <section class="rollover-card complete">
          <div>
            <span>ROLLOVER DA CONTA</span>
            <strong>Sem movimentação pendente</strong>
          </div>
        </section>
      `;
    }

    const progress = Math.min(100, Math.max(0, Number(rollover.percent || 0)));
    return `
      <section class="rollover-card ${compact ? 'compact' : ''}">
        <div class="rollover-head">
          <span>ROLLOVER</span>
          <strong>${progress}%</strong>
        </div>
        <div class="rollover-progress">
          <i style="width: ${progress}%"></i>
        </div>
        <div class="rollover-lines">
          <span>${this._money(rollover.progress || 0)} / ${this._money(rollover.required || 0)}</span>
          <strong>Falta ${this._money(rollover.remaining || 0)}</strong>
        </div>
        <p class="panel-description">${state.demoMode ? 'A demo não conta para o rollover.' : 'As apostas confirmadas contam para o rollover.'}</p>
      </section>
    `;
  }

  _depositPreviewText(amount) {
    const value = Number(amount || 0);
    const bonus = value >= 100 ? value : 0;
    const credit = value + bonus;
    const rollover = credit * 2;
    if (bonus > 0) {
      return `Crédito ${this._money(credit)} com bônus. Rollover ${this._money(rollover)}.`;
    }
    return `Crédito ${this._money(value)}. Rollover ${this._money(rollover)}.`;
  }

  _bindDom() {
    this.root.querySelectorAll('[data-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        this.currentTab = button.dataset.tab;
        this.root.scrollTop = 0;
        this.modal = null;
        this._render();
        this.root.querySelector(`[data-tab="${this.currentTab}"]`)?.focus({ preventScroll: true });
      });
    });

    this.root.querySelectorAll('[data-action]').forEach((button) => {
      button.addEventListener('click', async (event) => {
        const action = button.dataset.action;
        if (action === 'close-modal') {
          event.stopPropagation();
          this._closeModal();
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
        } else if (action === 'admin') {
          this.scene.start('AdminDashboard');
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
    const mountedRoot = this.root;
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
      const deposit = await createDepositIntent(amount, customerName, customerDocument, 'cpf');
      if (this.root !== mountedRoot) return;
      this.currentDeposit = deposit;
      this.walletMessage = this.currentDeposit?.sandbox ? 'Pix sandbox criado.' : 'Pix real criado. Aguardando pagamento.';
    } catch (error) {
      if (this.root !== mountedRoot) return;
      this.walletMessage = error.message || 'Falha ao gerar depósito.';
    } finally {
      if (this.root === mountedRoot) {
        this.walletBusy = false;
        this._render();
      }
    }
  }

  async _confirmDeposit(intentId) {
    if (this.walletBusy || !intentId) return;
    const mountedRoot = this.root;
    this.walletBusy = true;
    this.walletMessage = 'Confirmando pagamento sandbox...';
    this._render();

    try {
      await confirmSandboxDeposit(intentId);
      if (this.root !== mountedRoot) return;
      this.notice = 'Depósito confirmado.';
      this.walletMessage = '';
      await this._loadLobby();
    } catch (error) {
      if (this.root !== mountedRoot) return;
      this.walletMessage = error.message || 'Falha ao confirmar depósito.';
      this._render();
    } finally {
      if (this.root === mountedRoot) {
        this.walletBusy = false;
        this._render();
      }
    }
  }

  async _submitWithdrawal() {
    if (this.walletBusy) return;
    const mountedRoot = this.root;
    const rollover = this._rollover();
    if (!rollover.complete) {
      this.walletMessage = `Movimente mais ${this._money(rollover.remaining || 0)} antes de sacar.`;
      this._render();
      return;
    }

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
      this.walletMessage = 'Valor mínimo para saque: R$ 20,00.';
      this._render();
      return;
    }
    if (pixKey.length < 5) {
      this.walletMessage = 'Informe uma chave Pix válida.';
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
      if (this.root !== mountedRoot) return;
      this.notice = 'Saque solicitado. O valor está reservado na carteira.';
      this.walletMessage = '';
      await this._loadLobby();
    } catch (error) {
      if (this.root !== mountedRoot) return;
      this.walletMessage = error.message || 'Falha ao solicitar saque.';
      this._render();
    } finally {
      if (this.root === mountedRoot) {
        this.walletBusy = false;
        this._render();
      }
    }
  }

  _onKeyDown(event) {
    if (!this.modal) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this._closeModal();
      return;
    }
    if (event.key !== 'Tab') return;
    const modal = this.root.querySelector('.modal-card');
    const focusable = [...modal.querySelectorAll('button:not(:disabled), input, select')];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === modal)) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  _closeModal() {
    if (this.walletBusy) return;
    const action = this.modal;
    this.modal = null;
    this.walletMessage = '';
    this.currentDeposit = null;
    this._render();
    this.root?.querySelector(`[data-action="${action}"]`)?.focus({ preventScroll: true });
  }

  _drawBackground() {
    const g = this.add.graphics();
    g.fillStyle(0x090b1a);
    g.fillRect(0, 0, W, H);
  }

  _style() {
    return `
      <style>
        .block-lobby-root {
          position: fixed;
          inset: 0;
          height: var(--app-height, 100dvh);
          z-index: 18;
          overflow-y: auto;
          overscroll-behavior: contain;
          -webkit-overflow-scrolling: touch;
          color: var(--color-text);
          background: radial-gradient(ellipse at 10% 0%, #201b403b, transparent 50%), var(--color-bg);
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          -webkit-font-smoothing: antialiased;
        }
        .block-lobby-root *, .block-lobby-root *::before, .block-lobby-root *::after { box-sizing: border-box; }
        .block-lobby-root :is(h1, h2, h3, p) { margin: 0; }
        .block-lobby-root :is(button, input, select) { font: inherit; }
        .block-lobby-root button { cursor: pointer; border: 0; -webkit-tap-highlight-color: transparent; }
        .block-lobby-root button:disabled { opacity: .5; cursor: not-allowed; }
        .block-lobby-root :is(button, input, select):focus-visible { outline: 2px solid var(--color-accent); outline-offset: 4px; }
        .block-lobby-root .lobby-shell {
          width: min(1080px, 100%);
          min-height: var(--app-height, 100dvh);
          margin: 0 auto;
          padding: max(24px, env(safe-area-inset-top)) 28px calc(108px + env(safe-area-inset-bottom));
          display: flex;
          flex-direction: column;
          gap: 32px;
        }
        .block-lobby-root .loading-shell { justify-content: center; align-items: center; }
        .block-lobby-root .loading-card {
          width: min(360px, 100%);
          padding: 36px 24px;
          border: 1px solid var(--color-border);
          border-radius: 24px;
          background: var(--color-panel);
          display: grid;
          justify-items: center;
          gap: 16px;
        }
        .block-lobby-root .loading-card strong { font-size: 18px; }
        .block-lobby-root .loading-card > span { color: var(--color-muted); font-size: 14px; }
        .block-lobby-root .topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .block-lobby-root .brand-lockup { display: flex; align-items: center; gap: 12px; min-width: 0; }
        .block-lobby-root .brand-lockup > div:last-child { min-width: 0; }
        .block-lobby-root .brand-mark {
          width: 42px;
          height: 42px;
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          grid-template-rows: repeat(2, 1fr);
          gap: 4px;
          flex: 0 0 auto;
          transform: rotate(-5deg);
        }
        .block-lobby-root .brand-mark i { border-radius: 5px; background: var(--color-primary); box-shadow: inset 0 2px 0 #ffffff38; }
        .block-lobby-root .brand-mark i:first-child { grid-column: 2; background: var(--color-accent); }
        .block-lobby-root .brand-lockup h1 { font-size: 18px; font-weight: 850; letter-spacing: .07em; }
        .block-lobby-root .brand-lockup p { margin-top: 4px; color: var(--color-muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 280px; }
        .block-lobby-root .top-actions { display: flex; gap: 8px; flex-shrink: 0; }
        .block-lobby-root .icon-btn { width: 42px; height: 42px; border-radius: 13px; font-size: 23px; color: var(--color-muted); background: var(--color-panel); border: 1px solid var(--color-border); }
        .block-lobby-root .lobby-content { display: flex; flex-direction: column; gap: 24px; }
        .block-lobby-root .eyebrow { color: var(--color-accent); font-size: 10px; font-weight: 750; letter-spacing: .18em; }
        .block-lobby-root :is(.lobby-intro, .page-heading) h2 { margin-top: 9px; font-size: clamp(25px, 3vw, 34px); font-weight: 750; line-height: 1.2; letter-spacing: -.04em; }
        .block-lobby-root :is(.lobby-intro, .page-heading) p { margin-top: 9px; font-size: 14px; color: var(--color-muted); line-height: 1.5; }
        .block-lobby-root .lobby-grid { display: grid; grid-template-columns: minmax(0, 1fr) 296px; gap: 20px; align-items: start; }
        .block-lobby-root :is(.lobby-main, .lobby-sidebar) { min-width: 0; display: flex; flex-direction: column; gap: 18px; }
        .block-lobby-root :is(.wallet-card, .rollover-card, .admin-entry, .game-card, .how-to-panel, .history-panel, .promo-ledger, .profile-card) { border: 1px solid var(--color-border); border-radius: 20px; background: var(--color-panel); }
        .block-lobby-root .game-card { overflow: hidden; display: grid; grid-template-columns: .95fr 1.05fr; border-color: #a78bfa40; }
        .block-lobby-root .game-art {
          min-width: 0;
          padding: 26px 16px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 24px;
          background: radial-gradient(ellipse at 50% 40%, #5140965c, transparent 70%), linear-gradient(145deg, #252041, #151b33);
        }
        .block-lobby-root .art-label { color: #d3c7f4; font-size: 8px; font-weight: 700; letter-spacing: .13em; text-align: center; }
        .block-lobby-root .block-board {
          width: min(210px, 100%);
          aspect-ratio: 1;
          padding: 9px;
          display: grid;
          grid-template-columns: repeat(8, 1fr);
          gap: 4px;
          background: #0d1225;
          border: 1px solid #9da8f237;
          border-radius: 14px;
          transform: rotate(-5deg);
          box-shadow: 9px 14px 0 #080c1b55, 0 18px 40px #090b1a44;
        }
        .block-lobby-root .block-cell { min-width: 0; aspect-ratio: 1; background: #20283f; border-radius: 3px; }
        .block-lobby-root .block-cell.filled { box-shadow: inset 0 2px 0 #ffffff3d, inset 0 -2px 0 #00000026; }
        .block-lobby-root .block-v { background: var(--color-primary); }
        .block-lobby-root .block-c { background: var(--color-accent); }
        .block-lobby-root .block-p { background: #f9a8d4; }
        .block-lobby-root .art-caption { display: flex; align-items: center; gap: 7px; font-size: 7px; letter-spacing: .06em; color: #b0bad8; white-space: nowrap; }
        .block-lobby-root .art-caption i { width: 3px; height: 3px; border-radius: 50%; background: var(--color-accent); }
        .block-lobby-root .game-info { min-width: 0; padding: 30px 24px; display: flex; flex-direction: column; align-items: flex-start; gap: 15px; }
        .block-lobby-root .badges { display: flex; flex-wrap: wrap; gap: 6px; }
        .block-lobby-root .badges span { padding: 5px 7px; border-radius: 5px; font-size: 8px; font-weight: 800; letter-spacing: .06em; color: #d3c3ff; background: #a78bfa17; }
        .block-lobby-root .badges span + span { background: #67e8f914; color: var(--color-accent); }
        .block-lobby-root .game-info h2 { font-size: clamp(28px, 3vw, 38px); font-weight: 800; letter-spacing: -.05em; line-height: 1; }
        .block-lobby-root .game-info p { color: var(--color-muted); font-size: 13px; line-height: 1.65; }
        .block-lobby-root .play-btn { width: 100%; min-height: 49px; border-radius: 12px; margin-top: 8px; padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; color: #131128; background: var(--color-primary); font-size: 14px; font-weight: 800; box-shadow: 0 8px 24px #a78bfa1c; }
        .block-lobby-root .play-btn span { font-size: 20px; line-height: 1; }
        .block-lobby-root .demo-caption { color: var(--color-muted); font-size: 10px; line-height: 1.5; }
        .block-lobby-root .how-to-panel { padding: 22px; }
        .block-lobby-root .section-title { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .block-lobby-root :is(.section-title h3, .promo-ledger h3) { font-size: 14px; font-weight: 700; }
        .block-lobby-root .section-title > span { color: var(--color-muted); font-size: 8px; letter-spacing: .1em; font-weight: 600; }
        .block-lobby-root .how-to-grid { list-style: none; padding: 0; margin: 22px 0 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
        .block-lobby-root .how-to-grid li { min-width: 0; }
        .block-lobby-root .how-to-grid li > span { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 8px; margin-bottom: 12px; color: var(--color-primary); background: #a78bfa14; font-size: 10px; font-weight: 700; }
        .block-lobby-root .how-to-grid strong { font-size: 11px; }
        .block-lobby-root .how-to-grid p { margin-top: 6px; font-size: 11px; line-height: 1.6; color: var(--color-muted); }
        .block-lobby-root .wallet-card { padding: 20px; background: linear-gradient(130deg, #252340, var(--color-panel) 80%); }
        .block-lobby-root .wallet-heading { display: flex; align-items: center; justify-content: space-between; color: var(--color-muted); font-size: 9px; letter-spacing: .12em; font-weight: 700; margin-bottom: 22px; }
        .block-lobby-root .wallet-heading span + span { font-size: 18px; color: var(--color-primary); }
        .block-lobby-root .balance-label { display: block; color: var(--color-muted); font-size: 12px; }
        .block-lobby-root .wallet-card > strong { display: block; font-size: 31px; font-weight: 750; letter-spacing: -.04em; margin: 5px 0 20px; overflow-wrap: anywhere; }
        .block-lobby-root .bonus-balance { color: var(--color-success); font-size: 12px; margin: -8px 0 16px; }
        .block-lobby-root :is(.wallet-actions, .profile-actions) { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
        .block-lobby-root :is(.primary-btn, .dark-btn) { min-height: 43px; padding: 11px 12px; border-radius: 10px; font-size: 12px; font-weight: 750; }
        .block-lobby-root .primary-btn { background: var(--color-primary); color: #131128; }
        .block-lobby-root .dark-btn { background: var(--color-panel-raised); color: var(--color-text); border: 1px solid var(--color-border); }
        .block-lobby-root .wallet-note { margin-top: 14px; color: var(--color-muted); font-size: 10px; line-height: 1.5; }
        .block-lobby-root .rollover-card { padding: 16px 18px; display: grid; gap: 10px; }
        .block-lobby-root :is(.rollover-card.complete span, .rollover-head span) { display: block; color: var(--color-muted); font-size: 9px; font-weight: 650; letter-spacing: .08em; }
        .block-lobby-root .rollover-card.complete strong { display: block; margin-top: 7px; color: var(--color-success); font-size: 12px; font-weight: 600; }
        .block-lobby-root .rollover-head { display: flex; justify-content: space-between; gap: 10px; align-items: center; }
        .block-lobby-root .rollover-head strong { font-size: 12px; color: var(--color-accent); }
        .block-lobby-root .rollover-progress { height: 6px; border-radius: 99px; overflow: hidden; background: var(--color-panel-raised); }
        .block-lobby-root .rollover-progress i { display: block; height: 100%; border-radius: inherit; background: var(--color-primary); }
        .block-lobby-root .rollover-lines { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px; color: var(--color-muted); font-size: 10px; line-height: 1.5; }
        .block-lobby-root .rollover-lines strong { color: var(--color-text); font-weight: 500; }
        .block-lobby-root .lobby-notice { padding: 14px 18px; border: 1px solid #a78bfa44; border-radius: 12px; color: var(--color-text); background: #a78bfa14; font-size: 13px; line-height: 1.5; }
        .block-lobby-root .admin-entry { display: grid; gap: 6px; width: 100%; padding: 18px; text-align: left; color: var(--color-text); }
        .block-lobby-root .admin-entry span { color: var(--color-accent); font-size: 9px; font-weight: 700; letter-spacing: .09em; }
        .block-lobby-root .admin-entry strong { font-size: 15px; }
        .block-lobby-root .admin-entry em { color: var(--color-muted); font-size: 11px; font-style: normal; line-height: 1.5; }
        .block-lobby-root .history-panel { padding: 20px; }
        .block-lobby-root .panel-description { margin-top: 8px; color: var(--color-muted); font-size: 11px; line-height: 1.6; }
        .block-lobby-root .history-row { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 12px; padding: 12px 0; margin-top: 6px; border-top: 1px solid var(--color-border); font-size: 11px; }
        .block-lobby-root .history-row :is(span, em) { color: var(--color-danger); font-style: normal; }
        .block-lobby-root .history-row.won :is(span, em) { color: var(--color-success); }
        .block-lobby-root .empty-state { display: grid; justify-items: center; gap: 8px; padding: 26px 0 8px; text-align: center; }
        .block-lobby-root .empty-state > span { font-size: 28px; color: #617197; margin-bottom: 4px; }
        .block-lobby-root .empty-state strong { font-size: 11px; font-weight: 600; }
        .block-lobby-root .empty-state p { color: var(--color-muted); font-size: 10px; }
        .block-lobby-root .wallet-page-grid { display: grid; grid-template-columns: 320px minmax(0, 1fr); gap: 20px; align-items: start; }
        .block-lobby-root .promo-ledger { padding: 24px; }
        .block-lobby-root .promo-ledger > p { margin: 12px 0 20px; color: var(--color-muted); font-size: 13px; line-height: 1.7; }
        .block-lobby-root :is(.promo-line, .profile-row) { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 15px 0; border-top: 1px solid var(--color-border); font-size: 13px; }
        .block-lobby-root :is(.promo-line, .profile-row) > span { color: var(--color-muted); }
        .block-lobby-root :is(.promo-line, .profile-row) > strong { min-width: 0; text-align: right; font-weight: 600; overflow-wrap: anywhere; }
        .block-lobby-root .rules-example { padding: 14px; border-radius: 12px; background: var(--color-panel-raised); font-size: 12px; }
        .block-lobby-root .demo-note { padding: 16px; border: 1px solid #67e8f930; border-radius: 12px; background: #67e8f909; }
        .block-lobby-root .demo-note strong { color: var(--color-accent); font-size: 12px; }
        .block-lobby-root .demo-note p { margin-top: 6px; color: var(--color-muted); font-size: 12px; line-height: 1.6; }
        .block-lobby-root .profile-card { padding: 24px; }
        .block-lobby-root .profile-head { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; }
        .block-lobby-root .profile-avatar { width: 60px; height: 60px; display: grid; place-items: center; flex-shrink: 0; border-radius: 18px; color: var(--color-primary); background: #a78bfa1c; border: 1px solid #a78bfa38; font-size: 24px; font-weight: 750; }
        .block-lobby-root .profile-head > div:last-child { min-width: 0; }
        .block-lobby-root .profile-head h2 { font-size: 23px; overflow-wrap: anywhere; }
        .block-lobby-root .profile-head span { display: inline-block; margin-top: 5px; color: var(--color-muted); font-size: 12px; }
        .block-lobby-root .stats-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
        .block-lobby-root .stats-grid article { padding: 20px; border: 1px solid var(--color-border); border-radius: 16px; background: var(--color-panel); }
        .block-lobby-root .stats-grid span { display: block; color: var(--color-muted); font-size: 11px; line-height: 1.5; margin-bottom: 8px; }
        .block-lobby-root .stats-grid strong { font-size: 24px; font-weight: 750; }
        .block-lobby-root .bottom-nav { position: fixed; z-index: 20; bottom: 18px; left: 50%; transform: translateX(-50%); width: min(460px, calc(100% - 40px)); display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; padding: 7px; border: 1px solid var(--color-border); border-radius: 20px; background: #12172bf5; box-shadow: 0 16px 45px #0000004d; backdrop-filter: blur(16px); }
        .block-lobby-root .bottom-nav button { min-height: 50px; display: flex; align-items: center; justify-content: center; gap: 10px; border-radius: 13px; color: var(--color-muted); background: transparent; font-size: 12px; font-weight: 650; }
        .block-lobby-root .bottom-nav span { font-size: 22px; line-height: 1; }
        .block-lobby-root .bottom-nav .active { color: var(--color-primary); background: #a78bfa18; }
        .block-lobby-root .modal-backdrop { position: fixed; inset: 0; z-index: 28; display: grid; place-items: center; padding: 20px; background: #050714cc; backdrop-filter: blur(6px); }
        .block-lobby-root .modal-card { width: min(420px, 100%); max-height: calc(var(--app-height, 100dvh) - 40px); overflow-y: auto; overscroll-behavior: contain; padding: 26px; border: 1px solid var(--color-border); border-radius: 22px; background: var(--color-panel); box-shadow: 0 28px 80px #00000066; outline: none; }
        .block-lobby-root .wallet-modal { display: grid; gap: 16px; }
        .block-lobby-root .wallet-modal h2 { font-size: 22px; letter-spacing: -.03em; }
        .block-lobby-root .wallet-modal p { font-size: 12px; line-height: 1.6; color: var(--color-muted); }
        .block-lobby-root .wallet-modal label { display: grid; gap: 8px; color: var(--color-text); font-size: 12px; font-weight: 550; }
        .block-lobby-root .wallet-modal :is(input, select) { width: 100%; min-height: 45px; border: 1px solid var(--color-border); border-radius: 10px; padding: 10px 12px; color: var(--color-text); background: var(--color-bg); font-size: 16px; color-scheme: dark; }
        .block-lobby-root .wallet-modal input::placeholder { color: var(--color-muted); opacity: .8; }
        .block-lobby-root .amount-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
        .block-lobby-root .modal-card button { min-height: 44px; border-radius: 10px; padding: 10px 12px; font-size: 12px; font-weight: 750; background: var(--color-primary); color: #131128; }
        .block-lobby-root .modal-card button[data-action="close-modal"] { background: var(--color-panel-raised); color: var(--color-muted); border: 1px solid var(--color-border); }
        .block-lobby-root .pix-box { display: grid; gap: 12px; padding: 16px; border-radius: 12px; background: var(--color-bg); border: 1px solid #67e8f930; }
        .block-lobby-root .pix-box strong { color: var(--color-accent); font-size: 22px; }
        .block-lobby-root .pix-box span { font-size: 12px; color: var(--color-muted); line-height: 1.5; }
        .block-lobby-root .pix-box code { max-height: 90px; overflow-y: auto; word-break: break-all; font-size: 11px; line-height: 1.7; color: var(--color-text); }
        .block-lobby-root .wallet-message { color: var(--color-accent); font-size: 12px; line-height: 1.6; }
        @media (hover: hover) {
          .block-lobby-root button:not(:disabled):hover { filter: brightness(1.12); }
        }
        @media (max-width: 960px) {
          .block-lobby-root .lobby-grid { grid-template-columns: minmax(0, 1fr) 268px; gap: 16px; }
          .block-lobby-root .game-card { grid-template-columns: 1fr; }
          .block-lobby-root .game-art { gap: 18px; padding: 20px; }
          .block-lobby-root .block-board { width: 178px; }
          .block-lobby-root .game-info { padding: 24px; }
          .block-lobby-root .game-info h2 { font-size: 34px; }
          .block-lobby-root .how-to-grid { grid-template-columns: 1fr; }
          .block-lobby-root .how-to-grid li { display: flex; align-items: flex-start; gap: 12px; }
          .block-lobby-root .how-to-grid li > span { flex-shrink: 0; margin: 0; }
          .block-lobby-root .how-to-grid p { margin-top: 3px; }
        }
        @media (max-width: 680px) {
          .block-lobby-root .lobby-shell { padding: max(20px, env(safe-area-inset-top)) 18px calc(100px + env(safe-area-inset-bottom)); gap: 28px; }
          .block-lobby-root .lobby-content { gap: 20px; }
          .block-lobby-root .brand-lockup { gap: 10px; }
          .block-lobby-root .brand-lockup h1 { font-size: 15px; letter-spacing: .05em; }
          .block-lobby-root .brand-lockup p { max-width: 160px; }
          .block-lobby-root .brand-mark { width: 36px; height: 36px; }
          .block-lobby-root .icon-btn { width: 38px; height: 38px; }
          .block-lobby-root .top-actions { gap: 6px; }
          .block-lobby-root :is(.lobby-grid, .wallet-page-grid) { grid-template-columns: 1fr; }
          .block-lobby-root .game-info { padding: 23px; gap: 13px; }
          .block-lobby-root .game-art { padding: 20px 24px; gap: 17px; }
          .block-lobby-root .block-board { width: 165px; gap: 3px; padding: 8px; }
          .block-lobby-root .art-label { font-size: 8px; }
          .block-lobby-root .demo-caption { width: 100%; text-align: center; font-size: 11px; }
          .block-lobby-root .game-info h2 { font-size: 34px; }
          .block-lobby-root .game-info p { font-size: 13px; }
          .block-lobby-root .play-btn { margin-top: 4px; }
          .block-lobby-root .wallet-card { padding: 22px; }
          .block-lobby-root .wallet-heading { margin-bottom: 16px; }
          .block-lobby-root .wallet-note { font-size: 11px; }
          .block-lobby-root .bottom-nav { bottom: 0; width: 100%; padding: 8px 18px calc(8px + env(safe-area-inset-bottom)); border-radius: 0; border-width: 1px 0 0; }
          .block-lobby-root .bottom-nav button { min-height: 48px; font-size: 11px; }
          .block-lobby-root .profile-card { padding: 20px; }
          .block-lobby-root .profile-row { font-size: 12px; gap: 12px; }
          .block-lobby-root .stats-grid { gap: 8px; }
          .block-lobby-root .stats-grid article { padding: 14px 11px; }
          .block-lobby-root .stats-grid strong { font-size: 20px; }
          .block-lobby-root .stats-grid span { font-size: 10px; min-height: 30px; }
          .block-lobby-root .promo-ledger { padding: 20px; }
          .block-lobby-root .promo-line { font-size: 12px; gap: 18px; }
          .block-lobby-root .modal-card { padding: 22px; }
        }
        @media (max-width: 360px) {
          .block-lobby-root .lobby-shell { padding-left: 14px; padding-right: 14px; }
          .block-lobby-root .brand-lockup h1 { font-size: 13px; }
          .block-lobby-root .brand-lockup p { max-width: 135px; font-size: 11px; }
          .block-lobby-root .game-info { padding: 20px; }
          .block-lobby-root .section-title > span { display: none; }
        }
      </style>
    `;
  }

  _money(value) {
    return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
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
