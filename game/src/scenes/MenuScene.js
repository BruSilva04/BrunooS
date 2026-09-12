import Phaser from 'phaser';
import { W, H, BETS, state } from '../config.js';
import { BRAND, BRAND_COLORS as COLORS } from '../brand.js';

export default class MenuScene extends Phaser.Scene {
  constructor() {
    super({ key: 'Menu' });
  }

  create() {
    this.bet = BETS[0];
    this.betButtons = [];
    this.launchLocked = false;
    this._drawBackground();
    this._drawHeader();
    this._drawHero();
    this._drawDemoPanel();
    this._drawPlayButton();
    this.add.text(W / 2, H - 26, '18+ · Jogue com responsabilidade', {
      fontFamily: 'Arial, sans-serif', fontSize: '11px', color: '#a3aecb',
    }).setOrigin(0.5);
  }

  _drawBackground() {
    const g = this.add.graphics();
    g.fillGradientStyle(COLORS.panel, COLORS.background, COLORS.background, COLORS.panel, 1);
    g.fillRect(0, 0, W, H);
    for (let row = 0; row < 12; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        g.lineStyle(1, COLORS.primary, 0.045);
        g.strokeRoundedRect(col * 54 - 22, row * 62 + 76, 44, 44, 9);
      }
    }
  }

  _drawHeader() {
    this._button(62, 38, 88, 36, '‹ LOBBY', false, () => this.scene.start('Lobby'));
    this.add.text(W - 22, 25, 'SALDO DA CONTA', {
      fontFamily: 'Arial, sans-serif', fontSize: '9px', color: '#a3aecb',
    }).setOrigin(1, 0);
    this.add.text(W - 22, 41, this._money(state.balance), {
      fontFamily: 'Arial, sans-serif', fontSize: '15px', fontStyle: 'bold', color: '#f4f7ff',
    }).setOrigin(1, 0);
  }

  _drawHero() {
    const size = 31;
    const gap = 5;
    const startX = W / 2 - 52;
    const startY = 91;
    const blocks = [[0, 0], [0, 1], [1, 1], [2, 1], [2, 2]];
    const g = this.add.graphics();
    blocks.forEach(([col, row], index) => {
      const x = startX + col * (size + gap);
      const y = startY + row * (size + gap);
      g.fillStyle(index > 2 ? COLORS.accent : COLORS.primary, 1);
      g.fillRoundedRect(x, y, size, size, 7);
      g.fillStyle(0xffffff, 0.24);
      g.fillRoundedRect(x + 4, y + 3, size - 8, 5, 2);
    });
    this.add.text(W / 2, 222, BRAND.upperName, {
      fontSize: '30px', fontFamily: 'Arial, sans-serif', fontStyle: 'bold', color: '#f4f7ff',
    }).setOrigin(0.5);
    this.add.text(W / 2, 253, BRAND.tagline, {
      fontSize: '14px', fontFamily: 'Arial, sans-serif', color: '#a3aecb',
    }).setOrigin(0.5);
  }

  _drawDemoPanel() {
    const x = 22;
    const y = 291;
    const width = W - 44;
    const g = this.add.graphics();
    g.fillStyle(COLORS.panel, 1);
    g.fillRoundedRect(x, y, width, 196, 16);
    g.lineStyle(1, COLORS.primary, 0.22);
    g.strokeRoundedRect(x, y, width, 196, 16);
    this.add.text(x + 20, y + 21, 'VALOR SIMULADO', {
      fontSize: '11px', fontFamily: 'Arial, sans-serif', fontStyle: 'bold', color: '#a3aecb',
    });
    this.betText = this.add.text(x + 20, y + 43, this._money(this.bet), {
      fontSize: '29px', fontFamily: 'Arial, sans-serif', fontStyle: 'bold', color: '#f4f7ff',
    });
    this.add.text(x + width - 20, y + 23, 'DEMO', {
      fontSize: '10px', fontFamily: 'Arial, sans-serif', fontStyle: 'bold',
      color: '#67e8f9', backgroundColor: '#1a2340', padding: { x: 9, y: 6 },
    }).setOrigin(1, 0);
    BETS.forEach((value, index) => {
      const bx = x + 18 + index * 63;
      const by = y + 96;
      const bg = this.add.graphics();
      const label = this.add.text(bx + 28, by + 20, String(value), {
        fontSize: '14px', fontFamily: 'Arial, sans-serif', fontStyle: 'bold',
      }).setOrigin(0.5);
      const hit = this.add.zone(bx + 28, by + 20, 56, 42).setInteractive({ useHandCursor: true });
      hit.on('pointerdown', () => {
        this.bet = value;
        this.betText.setText(this._money(value));
        this._refreshChips();
      });
      this.betButtons.push({ value, bg, label, x: bx, y: by });
    });
    this._refreshChips();
    this.add.text(W / 2, y + 163, 'Valores fictícios. Seu saldo permanece igual.', {
      fontSize: '11px', fontFamily: 'Arial, sans-serif', color: '#a3aecb',
      align: 'center', wordWrap: { width: width - 32 },
    }).setOrigin(0.5);
  }

  _refreshChips() {
    this.betButtons.forEach((chip) => {
      const selected = chip.value === this.bet;
      chip.bg.clear();
      chip.bg.fillStyle(selected ? COLORS.primary : COLORS.panelRaised, 1);
      chip.bg.fillRoundedRect(chip.x, chip.y, 56, 40, 9);
      chip.bg.lineStyle(1, COLORS.primary, selected ? 1 : 0.16);
      chip.bg.strokeRoundedRect(chip.x, chip.y, 56, 40, 9);
      chip.label.setColor(selected ? '#090b1a' : '#f4f7ff');
    });
  }

  _drawPlayButton() {
    this._button(W / 2, 534, W - 44, 56, 'JOGAR DEMO  ›', true, () => {
      if (this.launchLocked) return;
      this.launchLocked = true;
      document.activeElement?.blur?.();
      window.syncAppViewport?.();
      this.scale.refresh();
      this.scene.start('Game', { bet: this.bet });
    });
    this.add.text(W / 2, 593, [
      'Arraste as peças e complete linhas ou colunas.',
      'Não é necessário depositar para experimentar.',
    ], {
      fontSize: '12px', fontFamily: 'Arial, sans-serif', color: '#a3aecb',
      align: 'center', lineSpacing: 7,
    }).setOrigin(0.5);
  }

  _button(x, y, width, height, text, primary, handler) {
    const bg = this.add.graphics();
    bg.fillStyle(primary ? COLORS.primary : COLORS.panelRaised, 1);
    bg.fillRoundedRect(x - width / 2, y - height / 2, width, height, 12);
    const label = this.add.text(x, y, text, {
      fontFamily: 'Arial, sans-serif', fontSize: primary ? '16px' : '11px',
      fontStyle: 'bold', color: primary ? '#090b1a' : '#f4f7ff',
    }).setOrigin(0.5);
    const hit = this.add.zone(x, y, width, height).setInteractive({ useHandCursor: true });
    hit.on('pointerover', () => label.setAlpha(0.75));
    hit.on('pointerout', () => label.setAlpha(1));
    hit.on('pointerdown', handler);
  }

  _money(value) {
    return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
}
