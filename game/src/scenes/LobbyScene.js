// game/src/scenes/LobbyScene.js
// ─────────────────────────────────────────────────────
//  Drop em: game/src/scenes/LobbyScene.js
//  Depois registrar em main.js (ver main_patch.js)
// ─────────────────────────────────────────────────────
import { W, H } from '../config.js';

// ── PALETA ───────────────────────────────────────────
const CLR = {
  bg:       0x000510,
  navy:     0x000e30,
  card:     0x000d28,
  border:   0x0d1f44,
  gold:     '#FFD700',
  green:    '#00ffaa',
  blue:     '#3399ff',
  muted:    '#334455',
  danger:   '#ff5555',
  textWeak: '#4d6680',
};

// ── DADOS MOCK (substituir por chamada à API) ─────────
const MOCK = {
  username:  'Bruno',
  balance:   250.00,
  stats: {
    rounds:  47,
    maxMult: 8.23,
    winRate: 61,      // %
  },
  history: [
    { mult: 6.82, won: true,  bet: 5,  payout: 34.10 },
    { mult: 1.00, won: false, bet: 10, payout: -10.00 },
    { mult: 3.45, won: true,  bet: 5,  payout: 17.25 },
  ],
};

// ─────────────────────────────────────────────────────
export default class LobbyScene extends Phaser.Scene {
  constructor() { super({ key: 'Lobby' }); }

  // ── init: recebe saldo/stats do backend via data ───
  init(data = {}) {
    this.data_  = { ...MOCK, ...data };
    this._subs  = [];  // tweens/timers para destruir no shutdown
  }

  // ── create ────────────────────────────────────────
  create() {
    this._drawOcean();
    this._buildHeader();
    this._buildBalanceCard();
    this._buildStatRow();
    this._buildHistory();
    this._buildPlayBtn();
    this._buildFooter();
    this._floatBubbles();
  }

  // ── OCEAN BACKGROUND ─────────────────────────────
  _drawOcean() {
    const g = this.add.graphics();

    // Gradiente: superfície clara → fundo mais fundo
    g.fillGradientStyle(0x001040, 0x001040, 0x000510, 0x000510, 1);
    g.fillRect(0, 0, W, H);

    // Raios de luz — superficiais, calmos (lobby = luz, não perigo)
    for (let i = 0; i < 5; i++) {
      g.fillStyle(0x2255cc, 0.022);
      const rx = 30 + i * 72;
      g.fillTriangle(rx - 14, 0, rx + 14, 0, rx + 22, H * 0.55);
    }

    // Linha do horizonte subaquático (sutil)
    g.lineStyle(1, 0x0a2040, 0.5);
    g.lineBetween(0, H * 0.52, W, H * 0.52);
  }

  // ── HEADER BAR ───────────────────────────────────
  _buildHeader() {
    // Barra sólida
    const bar = this.add.graphics();
    bar.fillStyle(0x000820, 0.94);
    bar.fillRect(0, 0, W, 52);
    bar.lineStyle(1, 0x0d1f44);
    bar.lineBetween(0, 52, W, 52);

    // Logo: emoji + nome, centrados
    this.add.text(W / 2, 26, '🧜‍♀️  Sereia do Tesouro', {
      fontSize: '14px',
      fontFamily: '"Arial Black", sans-serif',
      color: CLR.gold,
      letterSpacing: 0.5,
    }).setOrigin(0.5);

    // Avatar à esquerda (placeholder — substituir por foto)
    const av = this.add.circle(26, 26, 15, 0x001234);
    this.add.text(26, 26, '👤', { fontSize: '15px' }).setOrigin(0.5);

    // Notificação à direita
    const bell = this.add.text(W - 18, 26, '🔔', {
      fontSize: '16px',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    bell.on('pointerdown', () => this._toast('Nenhuma notificação nova'));
  }

  // ── BALANCE CARD (herói) ──────────────────────────
  _buildBalanceCard() {
    const CX = W / 2, CY = 100, CW = W - 32, CH = 104;
    const PX = CX - CW / 2;

    // Cartão base
    const card = this.add.graphics();
    card.fillStyle(CLR.navy, 0.97);
    card.fillRoundedRect(PX, CY, CW, CH, 14);
    card.lineStyle(1, CLR.border);
    card.strokeRoundedRect(PX, CY, CW, CH, 14);

    // Brilho bioluminescente — o único pulso da tela
    const glow = this.add.graphics();
    glow.fillStyle(0x00ffaa, 0.035);
    glow.fillRoundedRect(PX, CY, CW, CH, 14);
    this._subs.push(
      this.tweens.add({ targets: glow, alpha: 0, duration: 1800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
    );

    // Label saldo
    this.add.text(PX + 18, CY + 14, 'Saldo disponível', {
      fontSize: '11px', color: CLR.textWeak, fontStyle: 'italic',
    });

    // Número do saldo — é o herói, grande e real
    this.add.text(PX + 18, CY + 34, `R$ ${this.data_.balance.toFixed(2)}`, {
      fontSize: '38px',
      fontFamily: '"Arial Black", sans-serif',
      color: CLR.green,
    });

    // Botão Depositar
    const dep = this.add.text(PX + CW - 14, CY + 28, '+ Depositar', {
      fontSize: '12px',
      fontFamily: '"Arial Black", sans-serif',
      color: '#ffffff',
      backgroundColor: '#003322',
      padding: { x: 10, y: 7 },
    }).setOrigin(1, 0.5).setInteractive({ useHandCursor: true });

    dep.on('pointerover', () => dep.setStyle({ backgroundColor: '#004d33' }));
    dep.on('pointerout',  () => dep.setStyle({ backgroundColor: '#003322' }));
    dep.on('pointerdown', () => this._openModal('deposit'));

    // Botão Sacar Pix
    const saq = this.add.text(PX + CW - 14, CY + 72, '↑ Sacar via Pix', {
      fontSize: '11px', color: CLR.blue,
      backgroundColor: '#001133',
      padding: { x: 8, y: 5 },
    }).setOrigin(1, 0.5).setInteractive({ useHandCursor: true });

    saq.on('pointerdown', () => this._openModal('withdraw'));
  }

  // ── FAIXA DE STATS ───────────────────────────────
  _buildStatRow() {
    const SY = 218;
    const stats = [
      { value: `${this.data_.stats.rounds}`,    label: 'partidas',   icon: '🎮' },
      { value: `${this.data_.stats.maxMult}×`,  label: 'maior mult', icon: '🚀' },
      { value: `${this.data_.stats.winRate}%`,  label: 'vitórias',   icon: '💎' },
    ];

    const gap = 8, n = stats.length;
    const cw  = (W - 32 - gap * (n - 1)) / n;

    stats.forEach((s, i) => {
      const cx = 16 + i * (cw + gap);

      const card = this.add.graphics();
      card.fillStyle(CLR.card, 0.9);
      card.fillRoundedRect(cx, SY, cw, 72, 10);
      card.lineStyle(1, CLR.border);
      card.strokeRoundedRect(cx, SY, cw, 72, 10);

      // Icon
      this.add.text(cx + cw / 2, SY + 16, s.icon, { fontSize: '16px' }).setOrigin(0.5);

      // Valor
      this.add.text(cx + cw / 2, SY + 38, s.value, {
        fontSize: '16px',
        fontFamily: '"Arial Black", sans-serif',
        color: '#ffffff',
      }).setOrigin(0.5);

      // Label
      this.add.text(cx + cw / 2, SY + 58, s.label, {
        fontSize: '9px', color: CLR.textWeak,
      }).setOrigin(0.5);
    });
  }

  // ── HISTÓRICO DE RODADAS ──────────────────────────
  _buildHistory() {
    const HY = 308;

    this.add.text(16, HY, 'Últimas rodadas', {
      fontSize: '11px', color: CLR.textWeak, fontStyle: 'italic',
    });

    const ROW_H = 50, GAP = 6;

    this.data_.history.forEach((r, i) => {
      const ry = HY + 20 + i * (ROW_H + GAP);
      const won = r.won;

      // Fundo do row
      const row = this.add.graphics();
      row.fillStyle(CLR.card, 0.85);
      row.fillRoundedRect(16, ry, W - 32, ROW_H, 9);
      row.lineStyle(1, won ? 0x004422 : 0x330000);
      row.strokeRoundedRect(16, ry, W - 32, ROW_H, 9);

      // Ícone de status
      this.add.text(40, ry + ROW_H / 2, won ? '💎' : '🦈', {
        fontSize: '18px',
      }).setOrigin(0.5);

      // Multiplicador
      this.add.text(66, ry + 14, `${r.mult.toFixed(2)}×`, {
        fontSize: '17px',
        fontFamily: '"Arial Black", sans-serif',
        color: won ? CLR.green : CLR.danger,
      });
      this.add.text(66, ry + 33, won ? 'Cash Out' : 'Capturada', {
        fontSize: '10px',
        color: won ? '#336655' : '#664444',
      });

      // Aposta
      this.add.text(W / 2, ry + ROW_H / 2, `aposta R$ ${r.bet.toFixed(2)}`, {
        fontSize: '10px', color: CLR.textWeak,
      }).setOrigin(0.5);

      // Resultado
      const resultStr = won
        ? `+R$ ${r.payout.toFixed(2)}`
        : `-R$ ${Math.abs(r.payout).toFixed(2)}`;

      this.add.text(W - 22, ry + ROW_H / 2, resultStr, {
        fontSize: '15px',
        fontFamily: '"Arial Black", sans-serif',
        color: won ? CLR.green : CLR.danger,
      }).setOrigin(1, 0.5);
    });
  }

  // ── BOTÃO PRINCIPAL ───────────────────────────────
  _buildPlayBtn() {
    const BY = H - 76;

    const btn = this.add.text(W / 2, BY, '  🌊  Mergulhar agora  ', {
      fontSize: '18px',
      fontFamily: '"Arial Black", sans-serif',
      color: '#ffffff',
      backgroundColor: '#004db3',
      padding: { x: 30, y: 15 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    // Apenas o botão pulsa — uma animação, deliberada
    this._subs.push(
      this.tweens.add({
        targets: btn,
        scaleX: 1.02, scaleY: 1.02,
        duration: 950, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      })
    );

    btn.on('pointerover', () => {
      btn.setStyle({ backgroundColor: '#0066ff' });
      this.tweens.getTweensOf(btn).forEach(t => t.pause());
      btn.setScale(1.04);
    });
    btn.on('pointerout', () => {
      btn.setStyle({ backgroundColor: '#004db3' });
      this.tweens.getTweensOf(btn).forEach(t => t.resume());
    });
    btn.on('pointerdown', () => {
      // Passa saldo atual para o MenuScene se necessário
      this.scene.start('Menu', { balance: this.data_.balance });
    });
  }

  // ── FOOTER ────────────────────────────────────────
  _buildFooter() {
    this.add.text(W / 2, H - 12, '18+  •  Jogue com responsabilidade', {
      fontSize: '9px', color: '#1a2233',
    }).setOrigin(0.5);
  }

  // ── BOLHAS FLUTUANTES ────────────────────────────
  _floatBubbles() {
    const bubbles = Array.from({ length: 9 }, () => {
      const b = this.add.circle(
        Phaser.Math.Between(0, W),
        Phaser.Math.Between(0, H),
        Phaser.Math.Between(2, 7),
        0x3366ff, 0.12
      );
      return { obj: b, vy: Phaser.Math.Between(22, 65) };
    });

    this._subs.push(
      this.time.addEvent({
        delay: 16, loop: true, callback: () => {
          bubbles.forEach(b => {
            b.obj.y -= b.vy * 0.016;
            if (b.obj.y < -10) {
              b.obj.x = Phaser.Math.Between(0, W);
              b.obj.y = H + 8;
            }
          });
        },
      })
    );
  }

  // ── MODAL (Depositar / Sacar) ─────────────────────
  _openModal(type) {
    const isDeposit = type === 'deposit';
    const title = isDeposit ? '💳 Depositar via Pix' : '↑ Sacar via Pix';
    const desc  = isDeposit
      ? 'Gere uma chave Pix\ne deposite instantaneamente.'
      : 'Solicite o saque.\nProcessado em até 24h.';

    // Overlay
    const ov = this.add.graphics();
    ov.fillStyle(0x000000, 0.72);
    ov.fillRect(0, 0, W, H);
    ov.setInteractive();  // bloqueia cliques atrás

    // Cartão do modal
    const MW = 320, MH = 220;
    const MX = W / 2 - MW / 2, MY = H / 2 - MH / 2;

    const modal = this.add.graphics();
    modal.fillStyle(0x000e30, 0.98);
    modal.fillRoundedRect(MX, MY, MW, MH, 16);
    modal.lineStyle(1, 0x1a3d7a);
    modal.strokeRoundedRect(MX, MY, MW, MH, 16);

    const tTitle = this.add.text(W / 2, MY + 30, title, {
      fontSize: '16px', fontFamily: '"Arial Black", sans-serif', color: CLR.gold,
    }).setOrigin(0.5);

    const tDesc = this.add.text(W / 2, MY + 90, desc, {
      fontSize: '13px', color: '#8899aa', align: 'center',
    }).setOrigin(0.5);

    const tBadge = this.add.text(W / 2, MY + 148, '🚧  Em desenvolvimento', {
      fontSize: '12px', color: CLR.textWeak,
    }).setOrigin(0.5);

    const btnClose = this.add.text(W / 2, MY + MH - 28, '  Fechar  ', {
      fontSize: '13px', color: '#ffffff',
      backgroundColor: '#112233',
      padding: { x: 22, y: 9 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    const destroy = () => [ov, modal, tTitle, tDesc, tBadge, btnClose].forEach(o => o.destroy());
    btnClose.on('pointerdown', destroy);
    ov.on('pointerdown', destroy);
  }

  // ── TOAST LEVE ───────────────────────────────────
  _toast(msg) {
    const t = this.add.text(W / 2, H - 100, msg, {
      fontSize: '12px', color: '#ffffff',
      backgroundColor: '#001133',
      padding: { x: 14, y: 8 },
    }).setOrigin(0.5).setAlpha(0);

    this.tweens.add({
      targets: t, alpha: 1, duration: 200, yoyo: true, hold: 1400,
      onComplete: () => t.destroy(),
    });
  }

  // ── CLEANUP ───────────────────────────────────────
  shutdown() {
    this._subs.forEach(s => {
      if (s && s.stop) s.stop();
      if (s && s.destroy) s.destroy();
    });
  }
}
