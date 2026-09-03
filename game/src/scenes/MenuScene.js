import Phaser from 'phaser';
import { W, H, BETS, state } from '../config.js';

export default class MenuScene extends Phaser.Scene {
  constructor() {
    super({ key: 'Menu' });
  }

  create() {
    this.bet = 10;
    this.betButtons = [];
    this.bubbles = [];

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

    this.add.text(W / 2, 124, '🧜‍♀️', { fontSize: '74px' }).setOrigin(0.5);
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
      chip.bg.clear();
      chip.bg.fillStyle(active ? 0xf2c94c : 0x031c3a, active ? 1 : 0.96);
      chip.bg.fillRoundedRect(chip.label.x - 27, chip.label.y - 14, 54, 34, 8);
      chip.bg.lineStyle(1, active ? 0xffffff : 0x1bd8ff, active ? 0.72 : 0.22);
      chip.bg.strokeRoundedRect(chip.label.x - 27, chip.label.y - 14, 54, 34, 8);
      chip.label.setColor(active ? '#111827' : '#bdefff');
    });
  }

  _drawPlayButton() {
    const y = 520;
    const shadow = this.add.graphics();
    shadow.fillStyle(0x000000, 0.35);
    shadow.fillRoundedRect(54, y + 9, W - 108, 58, 8);

    const bg = this.add.graphics();
    bg.fillGradientStyle(0x22d3ee, 0x22d3ee, 0x16a34a, 0x16a34a, 1);
    bg.fillRoundedRect(44, y, W - 88, 60, 8);
    bg.lineStyle(2, 0xffffff, 0.35);
    bg.strokeRoundedRect(44, y, W - 88, 60, 8);

    const label = this.add.text(W / 2, y + 30, 'MERGULHAR', {
      fontSize: '20px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#ffffff',
      stroke: '#064e3b',
      strokeThickness: 4
    }).setOrigin(0.5);

    const hit = this.add.zone(W / 2, y + 30, W - 88, 60).setInteractive({ useHandCursor: true });
    hit.on('pointerover', () => label.setScale(1.04));
    hit.on('pointerout', () => label.setScale(1));
    hit.on('pointerdown', () => this.scene.start('Game', { bet: this.bet }));

    this.tweens.add({ targets: [bg, label], y: '-=4', duration: 900, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
  }

  _drawFooter() {
    this.add.text(W / 2, H - 28, 'Jogue com responsabilidade', {
      fontSize: '11px',
      fontFamily: 'Arial, sans-serif',
      color: '#5f7f96'
    }).setOrigin(0.5);
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
