import Phaser from 'phaser';
import { W, H, state } from '../config.js';
import { clearSession, fetchLobby, getStoredUser } from '../services/api.js';

const CLR = {
  deep: 0x080711,
  red: 0x9f1426,
  redDark: 0x4a0612,
  gold: 0xf4c84a,
  goldLight: 0xffe58d,
  jade: 0x21d6a2,
  cyan: 0x37d9ff,
  panel: 0x17111d,
  line: 0x70421e,
  muted: '#e0b39a',
  white: '#fff7dc',
  danger: '#ff6b7b',
};

const FONT_BODY = 'Arial, Helvetica, sans-serif';
const TEXT_RESOLUTION = 4;

export default class LobbyScene extends Phaser.Scene {
  constructor() {
    super({ key: 'Lobby' });
  }

  init(data = {}) {
    this.fallbackBalance = data.balance;
    this.user = getStoredUser();
    this.snapshot = null;
    this._subs = [];
    this.currentTab = data.tab || 'lobby';
  }

  create() {
    this._drawLoading();
    this._loadLobby();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this._cleanup());
  }

  async _loadLobby() {
    try {
      this.snapshot = await fetchLobby();
      this.user = this.snapshot.user;
      state.balance = Number(this.snapshot.balance || 0);
      state.history = (this.snapshot.history || []).map((round) => Number(round.mult || 1)).slice(0, 5);
      this._render();
    } catch {
      clearSession();
      this.scene.start('Auth');
    }
  }

  _drawLoading() {
    this._drawBackground();
    this._text(W / 2, H / 2, 'Carregando lobby...', {
      fontSize: '18px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#ffdf72',
    }).setOrigin(0.5);
  }

  _render() {
    this._cleanup();
    this.children.removeAll(true);
    this._drawBackground();
    this._drawTopBar();
    if (this.currentTab === 'promo') {
      this._drawPromotionPage();
    } else if (this.currentTab === 'profile') {
      this._drawProfilePage();
    } else {
      this._drawLobbyContent();
    }
    this._drawBottomNav();
    this._floatGold();
  }

  _drawLobbyContent() {
    this._drawWallet();
    this._drawPromoStrip();
    this._drawCategories();
    this._drawGameCard();
    this._drawStats();
    this._drawHistory();
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

  _drawTopBar() {
    const y = 14;
    this._pill(14, y, 38, 38, CLR.red, CLR.gold, 0.95);
    this._text(33, y + 19, 'S', {
      fontSize: '22px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#ffeb9a',
    }).setOrigin(0.5);

    this._text(62, y + 2, 'SEREIA PALACE', {
      fontSize: '18px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#ffdf72',
    });
    this._text(63, y + 24, `${this.user?.username || 'jogadora'} · ${this.user?.role || 'player'}`, {
      fontSize: '10px',
      color: CLR.muted,
    });

    this._iconButton(W - 92, y + 2, '⟳', () => this._loadLobby());
    this._iconButton(W - 48, y + 2, '⎋', () => {
      clearSession();
      this.scene.start('Auth');
    });
  }

  _drawWallet() {
    const x = 14;
    const y = 68;
    const w = W - 28;
    const h = 96;
    const g = this.add.graphics();
    g.fillGradientStyle(0x2d1014, 0x2d1014, 0x0e0b12, 0x0e0b12, 1);
    g.fillRoundedRect(x, y, w, h, 10);
    g.lineStyle(1, CLR.gold, 0.50);
    g.strokeRoundedRect(x, y, w, h, 10);

    g.fillStyle(CLR.gold, 0.18);
    g.fillCircle(x + w - 36, y + 28, 54);

    this._text(x + 16, y + 13, 'SALDO DISPONIVEL', {
      fontSize: '10px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#eebc6b',
    });
    this._text(x + 16, y + 32, `R$ ${state.balance.toFixed(2)}`, {
      fontSize: '34px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: CLR.white,
    });

    this._smallButton(x + 18, y + 70, 102, 28, '+ Depositar', 0xd59d19, 0x6d120e, () => this._openModal('deposit'));
    this._smallButton(x + 130, y + 70, 96, 28, 'Sacar Pix', 0x17233a, 0x385a90, () => this._openModal('withdraw'));
  }

  _drawPromoStrip() {
    const y = 176;
    const g = this.add.graphics();
    g.fillGradientStyle(0xcf2038, 0xcf2038, 0x7c1021, 0x7c1021, 1);
    g.fillRoundedRect(14, y, W - 28, 68, 10);
    g.lineStyle(1, CLR.goldLight, 0.56);
    g.strokeRoundedRect(14, y, W - 28, 68, 10);

    this._text(30, y + 11, 'EXCLUSIVO', {
      fontSize: '10px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#350006',
      backgroundColor: '#ffdf72',
      padding: { x: 8, y: 3 },
    });
    this._text(30, y + 34, 'Mergulho Premiado', {
      fontSize: '20px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: CLR.white,
    });
    this._text(W - 24, y + 18, '95%\nRTP', {
      fontSize: '18px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#ffdf72',
      align: 'right',
    }).setOrigin(1, 0);
  }

  _drawCategories() {
    const labels = ['Hot', 'Slots', 'Crash', 'VIP'];
    labels.forEach((label, index) => {
      const x = 14 + index * 92;
      const active = index === 0;
      const bg = active ? CLR.gold : 0x211521;
      const border = active ? CLR.goldLight : CLR.line;
      this._pill(x, 256, 82, 32, bg, border, active ? 1 : 0.86);
      this._text(x + 41, 272, label, {
        fontSize: '12px',
        fontFamily: '"Arial Black", Arial, sans-serif',
        color: active ? '#330009' : '#ffdca0',
      }).setOrigin(0.5);
    });
  }

  _drawGameCard() {
    const x = 14;
    const y = 302;
    const w = W - 28;
    const h = 156;
    const g = this.add.graphics();
    g.fillGradientStyle(0x201019, 0x201019, 0x080c18, 0x080c18, 1);
    g.fillRoundedRect(x, y, w, h, 12);
    g.lineStyle(2, CLR.gold, 0.72);
    g.strokeRoundedRect(x, y, w, h, 12);

    g.fillGradientStyle(0x113251, 0x113251, 0x041120, 0x041120, 1);
    g.fillRoundedRect(x + 12, y + 14, 132, 128, 10);
    g.lineStyle(1, CLR.cyan, 0.28);
    g.strokeRoundedRect(x + 12, y + 14, 132, 128, 10);

    g.fillStyle(0x37d9ff, 0.12);
    g.fillCircle(x + 80, y + 66, 54);
    g.fillStyle(CLR.gold, 0.16);
    g.fillCircle(x + 112, y + 40, 22);
    this._text(x + 78, y + 62, '🧜‍♀️', { fontSize: '52px' }).setOrigin(0.5);
    this._text(x + 118, y + 106, '💎', { fontSize: '25px' }).setOrigin(0.5);

    this._text(x + 160, y + 18, 'Sereia do Tesouro', {
      fontSize: '21px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#ffdf72',
    });
    this._text(x + 160, y + 48, 'Runner crash · Cash Out', {
      fontSize: '11px',
      color: '#e3a992',
    });

    this._badge(x + 160, y + 75, 'AO VIVO', 0x123d2d, '#80ffd7');
    this._badge(x + 232, y + 75, 'UNICO JOGO', 0x3f1420, '#ffdca0');

    this._playButton(x + 160, y + 108, w - 174, 38);
  }

  _drawStats() {
    const stats = this.snapshot?.stats || { rounds: 0, maxMult: 1, winRate: 0 };
    const items = [
      { label: 'Rodadas', value: String(stats.rounds || 0) },
      { label: 'Maior mult', value: `${Number(stats.maxMult || 1).toFixed(2)}x` },
      { label: 'Vitorias', value: `${stats.winRate || 0}%` },
    ];

    items.forEach((item, index) => {
      const x = 14 + index * 122;
      const g = this.add.graphics();
      g.fillStyle(CLR.panel, 0.92);
      g.fillRoundedRect(x, 472, 112, 58, 8);
      g.lineStyle(1, CLR.line, 0.7);
      g.strokeRoundedRect(x, 472, 112, 58, 8);
      this._text(x + 12, 483, item.label, {
        fontSize: '9px',
        color: CLR.muted,
      });
      this._text(x + 12, 500, item.value, {
        fontSize: '18px',
        fontFamily: '"Arial Black", Arial, sans-serif',
        color: CLR.white,
      });
    });
  }

  _drawHistory() {
    const y = 536;
    const history = this.snapshot?.history || [];
    this._text(16, y, 'ULTIMAS RODADAS', {
      fontSize: '10px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#eebc6b',
    });

    if (!history.length) {
      this._text(W / 2, y + 38, 'Sem rodadas ainda', {
        fontSize: '12px',
        color: CLR.muted,
      }).setOrigin(0.5);
      return;
    }

    history.slice(0, 3).forEach((round, index) => {
      const rowY = y + 18 + index * 26;
      const won = !!round.won;
      const g = this.add.graphics();
      g.fillStyle(won ? 0x0d2b24 : 0x301018, 0.94);
      g.fillRoundedRect(14, rowY, W - 28, 24, 6);
      this._text(26, rowY + 12, won ? 'WIN' : 'LOSS', {
        fontSize: '9px',
        fontFamily: '"Arial Black", Arial, sans-serif',
        color: won ? '#80ffd7' : CLR.danger,
      }).setOrigin(0, 0.5);
      this._text(86, rowY + 12, `${Number(round.mult || 1).toFixed(2)}x`, {
        fontSize: '12px',
        fontFamily: '"Arial Black", Arial, sans-serif',
        color: CLR.white,
      }).setOrigin(0, 0.5);
      this._text(W - 22, rowY + 12, `${won ? '+' : ''}R$ ${Number(round.payout || 0).toFixed(2)}`, {
        fontSize: '12px',
        fontFamily: '"Arial Black", Arial, sans-serif',
        color: won ? '#80ffd7' : CLR.danger,
      }).setOrigin(1, 0.5);
    });
  }

  _drawPromotionPage() {
    const x = 14;
    const y = 76;
    const w = W - 28;

    this._text(x + 2, y - 20, 'PROMOCAO', {
      fontSize: '18px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#ffdf72',
    });

    const banner = this.add.graphics();
    banner.fillGradientStyle(0xf7c948, 0xf7c948, 0xb0162b, 0xb0162b, 1);
    banner.fillRoundedRect(x, y, w, 176, 12);
    banner.lineStyle(2, 0xfff0a6, 0.72);
    banner.strokeRoundedRect(x, y, w, 176, 12);
    banner.fillStyle(0x4a0612, 0.24);
    banner.fillCircle(x + w - 46, y + 46, 82);
    banner.fillStyle(0xffffff, 0.13);
    banner.fillCircle(x + 46, y + 136, 74);

    this._text(x + 22, y + 18, 'RECARGUE E GANHE', {
      fontSize: '15px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#3a050f',
    });
    this._text(x + 22, y + 44, '100%', {
      fontSize: '58px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#fff7dc',
      stroke: '#641017',
      strokeThickness: 5,
    });
    this._text(x + 176, y + 76, 'DO VALOR EM', {
      fontSize: '13px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#ffe8ac',
    });
    this._text(x + 176, y + 98, 'bonus', {
      fontSize: '10px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#ffe8ac',
      minFontSize: 10,
    });
    this._text(x + 22, y + 126, 'Oferta valida para recargas selecionadas', {
      fontSize: '12px',
      color: '#fff0c6',
    });

    this._smallButton(x + 216, y + 128, 124, 34, 'RECARREGAR', 0x2b0a12, 0x721521, () => this._openModal('deposit'));

    const detailsY = y + 200;
    const details = this.add.graphics();
    details.fillStyle(0x17111d, 0.94);
    details.fillRoundedRect(x, detailsY, w, 174, 10);
    details.lineStyle(1, CLR.line, 0.82);
    details.strokeRoundedRect(x, detailsY, w, 174, 10);

    this._text(x + 18, detailsY + 18, 'COMO FICA NA CONTA', {
      fontSize: '14px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#ffdf72',
    });

    this._promoLine(x + 18, detailsY + 56, 'Recarga', 'R$ 50,00');
    this._promoLine(x + 18, detailsY + 88, 'Bonus', '+ R$ 50,00', '#80ffd7');
    this._promoLine(x + 18, detailsY + 120, 'Total', 'R$ 100,00', CLR.white);
  }

  _promoLine(x, y, label, value, color = CLR.muted) {
    this._text(x, y, label, {
      fontSize: '13px',
      color,
    }).setOrigin(0, 0.5);
    this._text(W - 32, y, value, {
      fontSize: '15px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color,
    }).setOrigin(1, 0.5);
  }

  _drawProfilePage() {
    const user = this.snapshot?.user || this.user || {};
    const stats = this.snapshot?.stats || { rounds: 0, maxMult: 1, winRate: 0 };
    const x = 14;
    const y = 76;
    const w = W - 28;

    this._text(x + 2, y - 20, 'PERFIL', {
      fontSize: '18px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#ffdf72',
    });

    const card = this.add.graphics();
    card.fillGradientStyle(0x2d1014, 0x2d1014, 0x0d0b15, 0x0d0b15, 1);
    card.fillRoundedRect(x, y, w, 184, 12);
    card.lineStyle(2, CLR.gold, 0.54);
    card.strokeRoundedRect(x, y, w, 184, 12);

    this._pill(x + 20, y + 20, 64, 64, CLR.red, CLR.goldLight, 0.94);
    this._text(x + 52, y + 52, String(user.username || 'S').slice(0, 1).toUpperCase(), {
      fontSize: '30px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#ffeb9a',
    }).setOrigin(0.5);

    this._text(x + 102, y + 22, user.username || 'jogadora', {
      fontSize: '23px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: CLR.white,
    });
    this._badge(x + 102, y + 58, (user.role || 'player').toUpperCase(), user.role === 'admin' ? 0x604000 : 0x123d2d, '#ffe58d');
    this._profileRow(x + 20, y + 106, 'Email', user.email || '-');
    this._profileRow(x + 20, y + 136, 'Telefone', user.phone || '-');

    const statsY = y + 206;
    const items = [
      { label: 'Rodadas', value: String(stats.rounds || 0) },
      { label: 'Maior mult', value: `${Number(stats.maxMult || 1).toFixed(2)}x` },
      { label: 'Vitorias', value: `${stats.winRate || 0}%` },
    ];

    items.forEach((item, index) => {
      const sx = x + index * 122;
      const g = this.add.graphics();
      g.fillStyle(CLR.panel, 0.94);
      g.fillRoundedRect(sx, statsY, 112, 66, 8);
      g.lineStyle(1, CLR.line, 0.76);
      g.strokeRoundedRect(sx, statsY, 112, 66, 8);
      this._text(sx + 12, statsY + 13, item.label, {
        fontSize: '12px',
        color: CLR.muted,
      });
      this._text(sx + 12, statsY + 34, item.value, {
        fontSize: '20px',
        fontFamily: '"Arial Black", Arial, sans-serif',
        color: CLR.white,
      });
    });

    this._smallButton(x + 20, statsY + 96, 134, 36, 'Atualizar', 0xd59d19, 0x6d120e, () => this._loadLobby());
    this._smallButton(x + 170, statsY + 96, 134, 36, 'Sair', 0x20263a, 0x101521, () => {
      clearSession();
      this.scene.start('Auth');
    });
  }

  _profileRow(x, y, label, value) {
    this._text(x, y, label, {
      fontSize: '12px',
      color: CLR.muted,
    }).setOrigin(0, 0.5);
    this._text(x + 82, y, value, {
      fontSize: '13px',
      color: '#fff0c6',
      wordWrap: { width: W - x - 108 },
    }).setOrigin(0, 0.5);
  }

  _drawBottomNav() {
    const g = this.add.graphics();
    const navHeight = 44;
    const navTop = H - navHeight;
    g.fillStyle(0x090710, 0.97);
    g.fillRect(0, navTop, W, navHeight);
    g.lineStyle(1, CLR.gold, 0.30);
    g.lineBetween(0, navTop, W, navTop);

    const nav = [
      ['Lobby', 64, 'lobby'],
      ['Promocao', W / 2, 'promo'],
      ['Perfil', W - 64, 'profile'],
    ];
    nav.forEach(([label, x, tab]) => {
      const active = this.currentTab === tab;
      if (active) {
        this._pill(x - 43, H - 39, 86, 32, 0x241509, CLR.gold, 0.78);
      }
      this._text(x, H - 27, active ? '◆' : '◇', {
        fontSize: '13px',
        color: active ? '#ffdf72' : '#b69085',
      }).setOrigin(0.5);
      this._text(x, H - 10, label, {
        fontSize: '10px',
        color: active ? '#ffdf72' : '#b69085',
      }).setOrigin(0.5);
      this.add.zone(x, H - 22, 104, 42)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this._switchTab(tab));
    });
  }

  _switchTab(tab) {
    if (this.currentTab === tab) return;
    this.currentTab = tab;
    this._render();
  }

  _playButton(x, y, w, h) {
    const g = this.add.graphics();
    g.fillGradientStyle(CLR.goldLight, CLR.goldLight, 0xd89819, 0xd89819, 1);
    g.fillRoundedRect(x, y, w, h, 8);
    g.lineStyle(1, 0xffffff, 0.35);
    g.strokeRoundedRect(x, y, w, h, 8);
    this._text(x + w / 2, y + h / 2, 'JOGAR AGORA', {
      fontSize: '14px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#330009',
    }).setOrigin(0.5);
    this.add.zone(x + w / 2, y + h / 2, w, h)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.scene.start('Menu', { balance: state.balance }));
  }

  _smallButton(x, y, w, h, label, topColor, bottomColor, callback) {
    const g = this.add.graphics();
    g.fillGradientStyle(topColor, topColor, bottomColor, bottomColor, 1);
    g.fillRoundedRect(x, y, w, h, 7);
    g.lineStyle(1, 0xffffff, 0.18);
    g.strokeRoundedRect(x, y, w, h, 7);
    this._text(x + w / 2, y + h / 2, label, {
      fontSize: '11px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: CLR.white,
    }).setOrigin(0.5);
    this.add.zone(x + w / 2, y + h / 2, w, h)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', callback);
  }

  _iconButton(x, y, label, callback) {
    this._pill(x, y, 36, 34, 0x1d1320, CLR.line, 0.9);
    this._text(x + 18, y + 17, label, {
      fontSize: '17px',
      color: '#ffdf72',
    }).setOrigin(0.5);
    this.add.zone(x + 18, y + 17, 36, 34)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', callback);
  }

  _pill(x, y, w, h, fill, stroke, alpha = 1) {
    const g = this.add.graphics();
    g.fillStyle(fill, alpha);
    g.fillRoundedRect(x, y, w, h, h / 2);
    g.lineStyle(1, stroke, 0.45);
    g.strokeRoundedRect(x, y, w, h, h / 2);
  }

  _badge(x, y, label, fill, color) {
    const width = label.length * 8 + 24;
    const g = this.add.graphics();
    g.fillStyle(fill, 0.96);
    g.fillRoundedRect(x, y, width, 22, 6);
    this._text(x + width / 2, y + 11, label, {
      fontSize: '9px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color,
    }).setOrigin(0.5);
  }

  _openModal(type) {
    const isDeposit = type === 'deposit';
    const overlay = this.add.rectangle(0, 0, W, H, 0x000000, 0.72).setOrigin(0).setInteractive();
    const x = 34;
    const y = 222;
    const w = W - 68;
    const h = 210;
    const g = this.add.graphics();
    g.fillStyle(0x190d16, 0.98);
    g.fillRoundedRect(x, y, w, h, 12);
    g.lineStyle(2, CLR.gold, 0.58);
    g.strokeRoundedRect(x, y, w, h, 12);

    const title = this._text(W / 2, y + 34, isDeposit ? 'Depositar via Pix' : 'Sacar via Pix', {
      fontSize: '18px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#ffdf72',
    }).setOrigin(0.5);
    const desc = this._text(W / 2, y + 94, isDeposit
      ? 'Integracao Pix entra na proxima etapa.'
      : 'Saque Pix sera liberado apos wallet real.', {
      fontSize: '13px',
      color: '#ffc4aa',
      align: 'center',
      wordWrap: { width: w - 42 },
    }).setOrigin(0.5);
    const status = this._text(W / 2, y + 136, 'EM DESENVOLVIMENTO', {
      fontSize: '11px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#8d6c61',
    }).setOrigin(0.5);

    const closeText = this._text(W / 2, y + h - 34, 'FECHAR', {
      fontSize: '13px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#330009',
      backgroundColor: '#ffdf72',
      padding: { x: 28, y: 8 },
    }).setOrigin(0.5);
    const closeHit = this.add.zone(W / 2, y + h - 34, 118, 40).setInteractive({ useHandCursor: true });
    const close = () => [overlay, g, title, desc, status, closeText, closeHit].forEach((item) => item.destroy());
    closeHit.on('pointerdown', close);
    overlay.on('pointerdown', close);
  }

  _floatGold() {
    const dots = Array.from({ length: 16 }, () => {
      const dot = this.add.circle(
        Phaser.Math.Between(0, W),
        Phaser.Math.Between(0, H),
        Phaser.Math.Between(1, 3),
        CLR.gold,
        Phaser.Math.FloatBetween(0.10, 0.28),
      );
      return { dot, vy: Phaser.Math.Between(12, 34) };
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

  _cleanup() {
    this._subs.forEach((item) => {
      if (item && item.destroy) item.destroy();
    });
    this._subs = [];
  }

  _text(x, y, text, style = {}) {
    const fontSize = parseInt(style.fontSize || '14', 10);
    const { minFontSize = 12, ...textStyle } = style;
    const crispStyle = {
      fontFamily: FONT_BODY,
      resolution: TEXT_RESOLUTION,
      ...textStyle,
      fontSize: `${Math.max(fontSize, minFontSize)}px`,
    };
    const obj = this.add.text(x, y, text, crispStyle);

    if (!style.backgroundColor && !style.shadow) {
      const shadowBlur = fontSize >= 18 ? 3 : 1;
      obj.setShadow(0, 1, 'rgba(0, 0, 0, 0.65)', shadowBlur);
    }

    return obj;
  }
}
