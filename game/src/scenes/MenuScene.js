import Phaser from 'phaser';
import { W, H, BETS, MERMAID_GAME_CONFIG, centsToMoney, moneyToCents, state } from '../config.js';

export default class MenuScene extends Phaser.Scene {
  constructor() {
    super({ key: 'Menu' });
  }

  create() {
    this.bet = BETS[0];
    this.betButtons = [];
    this.bubbles = [];
    this.launchLocked = false;
    this.insufficientOverlay = null;

    this._drawOcean();
    this._drawReef();
    this._drawHeader();
    this._drawHero();
    this._drawBetPanel();
    this._drawPlayButton();
    this._drawFooter();
    this._animateAmbient();
  }

  _drawOcean() {
    const g = this.add.graphics();
    g.fillGradientStyle(0x062c68, 0x062c68, 0x010613, 0x010613, 1);
    g.fillRect(0, 0, W, H);

    for (let i = 0; i < 6; i++) {
      const x = 24 + i * 72;
      g.fillStyle(0x7ee7ff, 0.035);
      g.fillTriangle(x - 20, 0, x + 26, 0, x + Phaser.Math.Between(-24, 36), H * 0.68);
    }

    for (let i = 0; i < 22; i++) {
      const dot = this.add.circle(
        Phaser.Math.Between(0, W),
        Phaser.Math.Between(0, H),
        Phaser.Math.Between(2, 8),
        0x89dfff,
        Phaser.Math.FloatBetween(0.08, 0.24)
      );
      this.bubbles.push({ obj: dot, vy: Phaser.Math.Between(12, 48), sway: Phaser.Math.FloatBetween(0.4, 1.4) });
    }
  }

  _drawReef() {
    const g = this.add.graphics();
    g.fillStyle(0x02040b, 0.72);
    g.fillRect(0, H - 116, W, 116);

    const coralColors = [0x1fb7a6, 0xf25f7a, 0xf6c85f, 0x5e7ce2];
    for (let i = 0; i < 12; i++) {
      const x = i * 36 + Phaser.Math.Between(-10, 12);
      const h = Phaser.Math.Between(18, 58);
      g.lineStyle(3, Phaser.Utils.Array.GetRandom(coralColors), 0.45);
      g.beginPath();
      g.moveTo(x, H - 18);
      g.lineTo(x + Phaser.Math.Between(-10, 10), H - 18 - h);
      g.strokePath();
      g.fillStyle(0x02040b, 1);
      g.fillEllipse(x + 8, H - 8, 44, Phaser.Math.Between(16, 30));
    }
  }

  _drawHeader() {
    const balanceBox = this.add.graphics();
    balanceBox.fillStyle(0x00152f, 0.82);
    balanceBox.fillRoundedRect(18, 18, 150, 46, 8);
    balanceBox.lineStyle(1, 0x2de2c9, 0.32);
    balanceBox.strokeRoundedRect(18, 18, 150, 46, 8);

    this.add.text(30, 25, 'SALDO', {
      fontSize: '10px',
      fontFamily: 'Arial, sans-serif',
      color: '#7bd4ea'
    });
    this.add.text(30, 39, 'R$ ' + state.balance.toFixed(2), {
      fontSize: '17px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#ffffff'
    });

    this.add.text(W - 18, 30, '18+', {
      fontSize: '15px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#ffe08a',
      backgroundColor: '#241a05',
      padding: { x: 10, y: 6 }
    }).setOrigin(1, 0);
  }

  _drawHero() {
    const halo = this.add.circle(W / 2, 140, 68, 0x33d7ff, 0.14);
    const halo2 = this.add.circle(W / 2, 140, 92, 0xf8d66d, 0.05);
    this.tweens.add({ targets: halo, scale: 1.12, alpha: 0.22, duration: 1300, yoyo: true, repeat: -1 });
    this.tweens.add({ targets: halo2, scale: 1.08, alpha: 0.1, duration: 1800, yoyo: true, repeat: -1 });

    this._drawMermaidIcon(W / 2, 140);
    this.add.text(W / 2, 198, 'SEREIA DO TESOURO', {
      fontSize: '24px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#ffe08a',
      stroke: '#6f3e00',
      strokeThickness: 4
    }).setOrigin(0.5);

    this.add.text(W / 2, 226, 'Resgate antes da maré virar', {
      fontSize: '13px',
      fontFamily: 'Arial, sans-serif',
      color: '#a7eaff'
    }).setOrigin(0.5);

    state.history.forEach((multVal, index) => {
      const valStr = multVal.toFixed(2) + 'x';
      const x = 34 + index * 70;
      const box = this.add.graphics();

      const isLow = multVal < 1.5;
      const isMid = multVal >= 1.5 && multVal < 2.0;

      const bgCol = isLow ? 0x361214 : (isMid ? 0x092644 : 0x052c2b);
      const borderCol = isLow ? 0xff5e6c : (isMid ? 0x38bdf8 : 0x31f1c6);
      const textCol = isLow ? '#ff8790' : (isMid ? '#7dd3fc' : '#8fffe7');

      box.fillStyle(bgCol, 0.82);
      box.fillRoundedRect(x, 256, 56, 28, 7);
      box.lineStyle(1, borderCol, 0.45);
      box.strokeRoundedRect(x, 256, 56, 28, 7);
      this.add.text(x + 28, 262, valStr, {
        fontSize: '12px',
        fontFamily: '"Arial Black", Arial, sans-serif',
        color: textCol
      }).setOrigin(0.5, 0);
    });
  }

  _drawBetPanel() {
    const px = 22;
    const py = 316;
    const pw = W - 44;
    const ph = 150;

    this.panel = this.add.graphics();
    this.panel.fillStyle(0x001126, 0.9);
    this.panel.fillRoundedRect(px, py, pw, ph, 8);
    this.panel.lineStyle(1, 0x1bd8ff, 0.3);
    this.panel.strokeRoundedRect(px, py, pw, ph, 8);

    this.add.text(px + 18, py + 16, 'APOSTA', {
      fontSize: '11px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#68cde7'
    });
    this.betText = this.add.text(px + 18, py + 34, 'R$ ' + this.bet.toFixed(2), {
      fontSize: '32px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#ffffff'
    });

    this.add.text(px + pw - 18, py + 22, '95% RTP', {
      fontSize: '12px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#f8d66d'
    }).setOrigin(1, 0);

    this.add.text(px + 18, py + 76, 'Aposta minima da Sereia: R$ ' + centsToMoney(MERMAID_GAME_CONFIG.minBetCents).toFixed(2), {
      fontSize: '10px',
      fontFamily: 'Arial, sans-serif',
      color: '#9bdff0'
    });

    BETS.forEach((value, index) => this._createBetChip(value, px + 18 + index * 62, py + 96));
    this._refreshBetChips();
  }

  _createBetChip(value, x, y) {
    const bg = this.add.graphics();
    const label = this.add.text(x + 27, y + 14, '' + value, {
      fontSize: '15px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#bdefff'
    }).setOrigin(0.5);

    const hit = this.add.zone(x + 27, y + 14, 54, 34).setInteractive({ useHandCursor: true });
    hit.on('pointerdown', () => {
      if (state.balance < value) {
        this.cameras.main.shake(90, 0.004);
        return;
      }
      this.bet = value;
      this.betText.setText('R$ ' + this.bet.toFixed(2));
      this._refreshBetChips();
      this.cameras.main.flash(70, 16, 210, 255);
    });
    this.betButtons.push({ value, bg, label });
  }

  _refreshBetChips() {
    this.betButtons.forEach((chip) => {
      const active = chip.value === this.bet;
      const available = state.balance >= chip.value;
      chip.bg.clear();
      chip.bg.fillStyle(active ? 0xf2c94c : 0x031c3a, available ? (active ? 1 : 0.96) : 0.42);
      chip.bg.fillRoundedRect(chip.label.x - 27, chip.label.y - 14, 54, 34, 8);
      chip.bg.lineStyle(1, active ? 0xffffff : 0x1bd8ff, available ? (active ? 0.72 : 0.22) : 0.10);
      chip.bg.strokeRoundedRect(chip.label.x - 27, chip.label.y - 14, 54, 34, 8);
      chip.label.setColor(active ? '#111827' : (available ? '#bdefff' : '#64748b'));
    });
  }

  _drawPlayButton() {
    const y = 520;
    const canPlay = moneyToCents(state.balance) >= MERMAID_GAME_CONFIG.minBetCents && state.balance >= this.bet;
    const shadow = this.add.graphics();
    shadow.fillStyle(0x000000, 0.35);
    shadow.fillRoundedRect(54, y + 9, W - 108, 58, 8);

    const bg = this.add.graphics();
    bg.fillGradientStyle(
      canPlay ? 0x22d3ee : 0x45404d,
      canPlay ? 0x22d3ee : 0x45404d,
      canPlay ? 0x16a34a : 0x24202c,
      canPlay ? 0x16a34a : 0x24202c,
      1
    );
    bg.fillRoundedRect(44, y, W - 88, 60, 8);
    bg.lineStyle(2, 0xffffff, 0.35);
    bg.strokeRoundedRect(44, y, W - 88, 60, 8);

    const label = this.add.text(W / 2, y + 30, canPlay ? 'JOGAR R$ ' + this.bet.toFixed(2) : 'SALDO INSUFICIENTE', {
      fontSize: '20px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#ffffff',
      stroke: '#064e3b',
      strokeThickness: 4
    }).setOrigin(0.5);

    const hit = this.add.zone(W / 2, y + 30, W - 88, 60).setInteractive({ useHandCursor: true });
    hit.on('pointerover', () => label.setScale(1.04));
    hit.on('pointerout', () => label.setScale(1));
    hit.on('pointerdown', () => {
      if (this.launchLocked) return;
      if (moneyToCents(state.balance) < MERMAID_GAME_CONFIG.minBetCents || state.balance < this.bet) {
        this._showInsufficientBalance();
        return;
      }
      this.launchLocked = true;
      if (document.activeElement && document.activeElement.blur) {
        document.activeElement.blur();
      }
      if (window.sereiaSyncViewport) {
        window.sereiaSyncViewport();
      }
      this.scale.refresh();
      this.scene.start('Game', { bet: this.bet });
    });

    this.tweens.add({ targets: [bg, label], y: '-=4', duration: 900, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
  }

  _drawFooter() {
    this.add.text(W / 2, H - 28, 'Jogue com responsabilidade', {
      fontSize: '11px',
      fontFamily: 'Arial, sans-serif',
      color: '#5f7f96'
    }).setOrigin(0.5);
  }

  _drawMermaidIcon(cx, cy) {
    const g = this.add.graphics();
    g.fillStyle(0x33d7ff, 0.16);
    g.fillEllipse(cx, cy + 2, 132, 152);
    g.fillStyle(0x5d183f, 1);
    g.fillEllipse(cx, cy - 42, 58, 46);
    g.fillStyle(0xf8c4b8, 1);
    g.fillCircle(cx, cy - 42, 24);
    g.fillGradientStyle(0xff7fb0, 0xff7fb0, 0x7434a6, 0x7434a6, 1);
    g.fillRoundedRect(cx - 23, cy - 18, 46, 50, 16);
    g.lineStyle(2, 0xffdf72, 0.78);
    g.strokeRoundedRect(cx - 23, cy - 18, 46, 50, 16);
    g.fillGradientStyle(0x45f0dd, 0x45f0dd, 0x106c89, 0x106c89, 1);
    g.fillTriangle(cx - 16, cy + 24, cx + 16, cy + 24, cx, cy + 94);
    g.fillStyle(0x5dffd0, 0.96);
    g.fillTriangle(cx, cy + 90, cx - 34, cy + 116, cx - 4, cy + 100);
    g.fillTriangle(cx, cy + 90, cx + 34, cy + 116, cx + 4, cy + 100);
    g.fillStyle(0xffdf72, 1);
    g.fillCircle(cx - 11, cy - 70, 3);
    g.fillCircle(cx, cy - 74, 4);
    g.fillCircle(cx + 11, cy - 70, 3);
    g.fillStyle(0x27070b, 0.8);
    g.fillCircle(cx - 7, cy - 46, 2);
    g.fillCircle(cx + 7, cy - 46, 2);
  }

  _showInsufficientBalance() {
    if (this.insufficientOverlay) return;
    const minBet = centsToMoney(MERMAID_GAME_CONFIG.minBetCents);
    const overlay = this.add.container(0, 0).setDepth(120);
    const dim = this.add.rectangle(0, 0, W, H, 0x000510, 0.72).setOrigin(0);
    const panel = this.add.graphics();
    const px = 28;
    const py = Math.max(140, H / 2 - 132);
    const pw = W - 56;
    const ph = 264;
    panel.fillGradientStyle(0x10243a, 0x10243a, 0x060b18, 0x060b18, 1);
    panel.fillRoundedRect(px, py, pw, ph, 8);
    panel.lineStyle(2, 0xffdf72, 0.54);
    panel.strokeRoundedRect(px, py, pw, ph, 8);

    const title = this.add.text(W / 2, py + 44, 'SALDO INSUFICIENTE', {
      fontSize: '20px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#ffe08a',
      stroke: '#07111c',
      strokeThickness: 5,
    }).setOrigin(0.5);
    const body = this.add.text(W / 2, py + 104, [
      'Saldo insuficiente para este jogo.',
      'A aposta minima da Sereia e R$ ' + minBet.toFixed(2) + '.',
    ].join('\n'), {
      fontSize: '14px',
      fontFamily: 'Arial, sans-serif',
      color: '#d7fbff',
      align: 'center',
      lineSpacing: 7,
      wordWrap: { width: pw - 42 },
    }).setOrigin(0.5);
    const deposit = this._makeModalButton(W / 2, py + 176, W - 102, 50, 'ADICIONAR SALDO', true, () => {
      this.scene.start('Lobby', {
        tab: 'promo',
        notice: 'Saldo insuficiente para este jogo. A aposta minima e R$ 30,00.',
      });
    });
    const close = this._makeModalButton(W / 2, py + 231, W - 102, 38, 'VOLTAR', false, () => {
      overlay.destroy(true);
      this.insufficientOverlay = null;
    });

    overlay.add([dim, panel, title, body, deposit.bg, deposit.label, deposit.zone, close.bg, close.label, close.zone]);
    this.insufficientOverlay = overlay;
  }

  _makeModalButton(x, y, width, height, text, primary, handler) {
    const bg = this.add.graphics();
    bg.fillGradientStyle(
      primary ? 0xffdf72 : 0x0b2138,
      primary ? 0xffdf72 : 0x0b2138,
      primary ? 0x25e0a7 : 0x061421,
      primary ? 0x25e0a7 : 0x061421,
      1
    );
    bg.fillRoundedRect(x - width / 2, y - height / 2, width, height, 8);
    bg.lineStyle(1, primary ? 0xffffff : 0x7dd3fc, primary ? 0.48 : 0.26);
    bg.strokeRoundedRect(x - width / 2, y - height / 2, width, height, 8);
    const label = this.add.text(x, y, text, {
      fontSize: primary ? '15px' : '12px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: primary ? '#102112' : '#d7fbff',
    }).setOrigin(0.5);
    const zone = this.add.zone(x, y, width, height).setInteractive({ useHandCursor: true });
    let locked = false;
    zone.on('pointerdown', () => {
      if (locked) return;
      locked = true;
      handler();
    });
    return { bg, label, zone };
  }

  _animateAmbient() {
    this.time.addEvent({
      delay: 16,
      loop: true,
      callback: () => {
        this.bubbles.forEach((bubble, index) => {
          bubble.obj.y -= bubble.vy * 0.016;
          bubble.obj.x += Math.sin(this.time.now / 700 + index) * bubble.sway * 0.08;
          if (bubble.obj.y < -12) {
            bubble.obj.x = Phaser.Math.Between(0, W);
            bubble.obj.y = H + 14;
          }
        });
      }
    });
  }
}
