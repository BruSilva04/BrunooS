import Phaser from 'phaser';
import { W, H } from '../config.js';

export default class HUD {
  constructor(scene, bet) {
    this.scene = scene;
    this.bet = bet;
    this.cashOutCallback = null;

    this._drawTopBar(bet);
    this._drawCashOutButton();
  }

  _drawTopBar(bet) {
    const top = this.scene.add.graphics();
    top.fillGradientStyle(0x001126, 0x001126, 0x000714, 0x000714, 0.92);
    top.fillRect(0, 0, W, 92);
    top.lineStyle(1, 0x2de2c9, 0.18);
    top.lineBetween(0, 92, W, 92);

    this.scene.add.text(18, 18, 'APOSTA', {
      fontSize: '10px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#67c7e5'
    });
    this.scene.add.text(18, 36, `R$ ${bet.toFixed(2)}`, {
      fontSize: '17px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#ffffff'
    });

    this.multTxt = this.scene.add.text(W / 2, 12, '1.00x', {
      fontSize: '40px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#7cffd6',
      stroke: '#04241f',
      strokeThickness: 4
    }).setOrigin(0.5, 0);

    this.scene.add.text(W - 18, 18, 'POTENCIAL', {
      fontSize: '10px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#eacb61'
    }).setOrigin(1, 0);
    this.gainTxt = this.scene.add.text(W - 18, 36, `R$ ${bet.toFixed(2)}`, {
      fontSize: '17px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#ffe08a'
    }).setOrigin(1, 0);

    this.depthTxt = this.scene.add.text(W / 2, 69, 'PROFUNDIDADE 0M', {
      fontSize: '10px',
      fontFamily: 'Arial, sans-serif',
      color: '#5e90a7'
    }).setOrigin(0.5, 0);
  }

  _drawCashOutButton() {
    this.cashShadow = this.scene.add.graphics();
    this.cashBg = this.scene.add.graphics();
    this.cashText = this.scene.add.text(W / 2, H - 56, 'CASH OUT', {
      fontSize: '20px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#ffffff',
      stroke: '#2b1200',
      strokeThickness: 3
    }).setOrigin(0.5);

    this.cashValue = this.scene.add.text(W / 2, H - 30, `R$ ${this.bet.toFixed(2)}`, {
      fontSize: '13px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#fff4b8'
    }).setOrigin(0.5);

    this.cashHit = this.scene.add.zone(W / 2, H - 45, W - 74, 72).setInteractive({ useHandCursor: true });
    this.cashHit.on('pointerdown', () => {
      if (this.cashOutCallback) this.cashOutCallback();
    });
    this.cashHit.on('pointerover', () => this._setCashScale(1.03));
    this.cashHit.on('pointerout', () => this._setCashScale(1));

    this._paintCashButton(0x9a5a05, 0xf59e0b);
  }

  _paintCashButton(topColor, bottomColor) {
    const x = 37;
    const y = H - 82;
    const w = W - 74;
    const h = 70;

    this.cashShadow.clear();
    this.cashShadow.fillStyle(0x000000, 0.38);
    this.cashShadow.fillRoundedRect(x + 8, y + 8, w - 16, h, 8);

    this.cashBg.clear();
    this.cashBg.fillGradientStyle(topColor, topColor, bottomColor, bottomColor, 1);
    this.cashBg.fillRoundedRect(x, y, w, h, 8);
    this.cashBg.lineStyle(2, 0xffffff, 0.28);
    this.cashBg.strokeRoundedRect(x, y, w, h, 8);
  }

  _setCashScale(scale) {
    this.cashText.setScale(scale);
    this.cashValue.setScale(scale);
  }

  updateMult(mult, bet) {
    const gain = +(bet * mult).toFixed(2);
    this.multTxt.setText(`${mult.toFixed(2)}x`);
    this.gainTxt.setText(`R$ ${gain.toFixed(2)}`);
    this.cashValue.setText(`R$ ${gain.toFixed(2)}`);
    this.depthTxt.setText(`PROFUNDIDADE ${Math.floor((mult - 1) * 80)}M`);

    if (mult >= 3) {
      this.multTxt.setColor('#ffde73');
      this._paintCashButton(0x16a34a, 0x047857);
    } else if (mult >= 1.7) {
      this.multTxt.setColor('#a7ff83');
      this._paintCashButton(0xd97706, 0x65a30d);
    }
  }

  onCashOut(callback) {
    this.cashOutCallback = callback;
  }

  hideCashOut() {
    [this.cashShadow, this.cashBg, this.cashText, this.cashValue, this.cashHit].forEach((item) => {
      if (item) item.setVisible(false);
    });
  }

  showResult(won, amount, mult, bet) {
    this.hideCashOut();

    const overlay = this.scene.add.rectangle(0, 0, W, H, 0x000000, 0.42).setOrigin(0);
    const px = 30;
    const py = H / 2 - 116;
    const pw = W - 60;
    const ph = 232;

    const panel = this.scene.add.graphics();
    panel.fillStyle(won ? 0x03251c : 0x27070b, 0.96);
    panel.fillRoundedRect(px, py, pw, ph, 8);
    panel.lineStyle(2, won ? 0x2df3bf : 0xff6675, 0.65);
    panel.strokeRoundedRect(px, py, pw, ph, 8);

    const icon = won ? '💰' : '🌊';
    const title = won ? 'RESGATE FEITO' : 'A MARÉ VIROU';
    const main = won ? `R$ ${amount.toFixed(2)}` : `- R$ ${bet.toFixed(2)}`;
    const color = won ? '#5dffd0' : '#ff7d87';

    this.scene.add.text(W / 2, py + 36, icon, { fontSize: '34px' }).setOrigin(0.5);
    this.scene.add.text(W / 2, py + 78, title, {
      fontSize: '20px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: won ? '#ffe08a' : '#ff9da5'
    }).setOrigin(0.5);
    this.scene.add.text(W / 2, py + 118, main, {
      fontSize: '40px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color
    }).setOrigin(0.5);
    this.scene.add.text(W / 2, py + 164, `${mult.toFixed(2)}x`, {
      fontSize: '20px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#ffffff'
    }).setOrigin(0.5);
    this.scene.add.text(W / 2, py + 202, 'TOQUE PARA JOGAR', {
      fontSize: '12px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#8eb8c7'
    }).setOrigin(0.5);

    this.scene.tweens.add({
      targets: [overlay, panel],
      alpha: { from: 0, to: 1 },
      duration: 160
    });
  }
}
