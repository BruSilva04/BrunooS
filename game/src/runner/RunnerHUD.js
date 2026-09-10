import { W, H, CASHOUT_UNLOCK_MULT } from '../config.js';

function money(value) {
  return `R$ ${Number(value || 0).toFixed(2)}`;
}

function reasonText(reason) {
  const messages = {
    crash: 'A mare virou antes do resgate.',
    obstacle: 'A rota fechou e o tubarao alcancou.',
    shark: 'O tubarao chegou perto demais.',
    connection: 'A conexao caiu durante a rodada.',
    boundary: 'A sereia saiu da rota segura.',
  };
  return messages[reason] || 'A rodada terminou.';
}

export default class RunnerHUD {
  constructor(scene, bet) {
    this.scene = scene;
    this.bet = bet;
    this.cashoutHandler = null;
    this.cashoutUnlocked = false;
    this.cashoutPending = false;
    this.resultOverlay = null;
    this.lastMultText = '';
    this.lastDepthText = '';
    this.lastValueText = '';
    this.lastCashoutValueText = '';
    this.lastStatusText = '';
    this.lastChromeBucket = null;

    this.root = scene.add.container(0, 0).setDepth(90);
    this.topGfx = scene.add.graphics();
    this.vignette = scene.add.graphics();
    this.multText = scene.add.text(W / 2, 66, '1.00x', {
      fontSize: '50px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#fff7dc',
      stroke: '#07111c',
      strokeThickness: 7,
    }).setOrigin(0.5);
    this.depthText = scene.add.text(W / 2, 119, '0 m  |  RECIFE', {
      fontSize: '13px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#8fffe7',
      stroke: '#07111c',
      strokeThickness: 4,
    }).setOrigin(0.5);
    this.valueText = scene.add.text(W / 2, 142, money(bet), {
      fontSize: '16px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#ffe08a',
      stroke: '#1a1103',
      strokeThickness: 4,
    }).setOrigin(0.5);
    this.statusText = scene.add.text(W / 2, 174, 'PREPARANDO MERGULHO', {
      fontSize: '11px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#bdefff',
      stroke: '#07111c',
      strokeThickness: 3,
    }).setOrigin(0.5);

    this.betText = scene.add.text(27, 28, 'APOSTA', {
      fontSize: '10px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#74e6ff',
    });
    this.betValueText = scene.add.text(27, 43, money(bet), {
      fontSize: '16px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#ffffff',
    });

    this.soundButton = this._makeIconButton(W - 54, 26, 'SOM');
    this.soundButton.zone.on('pointerdown', () => {
      if (this.soundToggleHandler) this.soundToggleHandler();
    });

    this.buttonGroup = scene.add.container(0, 0).setVisible(false);
    this.cashoutBg = scene.add.graphics();
    this.cashoutLabel = scene.add.text(W / 2, H - 74, 'RESGATAR', {
      fontSize: '19px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#102112',
    }).setOrigin(0.5);
    this.cashoutValue = scene.add.text(W / 2, H - 48, money(bet), {
      fontSize: '15px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#163322',
    }).setOrigin(0.5);
    this.cashoutZone = scene.add.zone(W / 2, H - 61, W - 42, 72)
      .setInteractive({ useHandCursor: true });
    this.cashoutZone.on('pointerdown', () => this._pressCashout());
    this.cashoutZone.on('pointerover', () => {
      if (this.cashoutUnlocked && !this.cashoutPending) this.buttonGroup.setScale(1.018);
    });
    this.cashoutZone.on('pointerout', () => this.buttonGroup.setScale(1));
    this.buttonGroup.add([this.cashoutBg, this.cashoutLabel, this.cashoutValue, this.cashoutZone]);

    this.bottomHint = scene.add.text(W / 2, H - 54, 'FUJA DO TUBARAO', {
      fontSize: '13px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#89e8ff',
      stroke: '#07111c',
      strokeThickness: 4,
    }).setOrigin(0.5).setAlpha(0.86);

    this.root.add([
      this.vignette,
      this.topGfx,
      this.multText,
      this.depthText,
      this.valueText,
      this.statusText,
      this.betText,
      this.betValueText,
      this.soundButton.bg,
      this.soundButton.label,
      this.soundButton.zone,
      this.bottomHint,
      this.buttonGroup,
    ]);

    this._drawChrome(1);
    this._drawCashoutButton();
  }

  onCashOut(handler) {
    this.cashoutHandler = handler;
  }

  onSoundToggle(handler) {
    this.soundToggleHandler = handler;
  }

  setSoundEnabled(enabled) {
    this.soundButton.label.setText(enabled ? 'SOM' : 'MUDO');
    this.soundButton.label.setFontSize(enabled ? '9px' : '8px');
  }

  update({ mult, depth, biome, sharkDistance, stateName }) {
    const potential = this.bet * mult;
    const multText = `${Number(mult || 1).toFixed(2)}x`;
    const depthText = `${Math.max(0, Math.round(depth || 0))} m  |  ${(biome?.label || 'RECIFE')}`;
    const valueText = money(potential);
    if (multText !== this.lastMultText) {
      this.lastMultText = multText;
      this.multText.setText(multText);
    }
    if (depthText !== this.lastDepthText) {
      this.lastDepthText = depthText;
      this.depthText.setText(depthText);
    }
    if (valueText !== this.lastValueText) {
      this.lastValueText = valueText;
      this.valueText.setText(valueText);
    }
    if (valueText !== this.lastCashoutValueText) {
      this.lastCashoutValueText = valueText;
      this.cashoutValue.setText(valueText);
    }

    const danger = 1 - Math.max(0, Math.min(1, sharkDistance));
    const chromeBucket = Math.round(danger * 12);
    if (chromeBucket !== this.lastChromeBucket) {
      this.lastChromeBucket = chromeBucket;
      this._drawChrome(sharkDistance);
    }

    const unlocked = mult >= CASHOUT_UNLOCK_MULT;
    if (unlocked && !this.cashoutUnlocked) {
      this.cashoutUnlocked = true;
      this.buttonGroup.setVisible(true).setAlpha(0).setScale(0.96);
      this.bottomHint.setVisible(false);
      this.scene.tweens.add({
        targets: this.buttonGroup,
        alpha: 1,
        scale: 1,
        duration: 220,
        ease: 'Back.easeOut',
      });
    }

    if (!unlocked) {
      this._setStatusText(stateName === 'COUNTDOWN' ? 'AGUARDE O SINAL' : 'MANTENHA A ROTA');
    } else if (this.cashoutPending) {
      this._setStatusText('CONFIRMANDO RESGATE...');
    }
  }

  setStatus(message) {
    this._setStatusText(message || '');
  }

  _setStatusText(message) {
    if (message === this.lastStatusText) return;
    this.lastStatusText = message;
    this.statusText.setText(message);
  }

  setCashoutPending(pending) {
    this.cashoutPending = !!pending;
    this._drawCashoutButton();
    if (pending) {
      this.cashoutLabel.setText('CONFIRMANDO');
      this.cashoutZone.disableInteractive();
      return;
    }
    this.cashoutLabel.setText('RESGATAR');
    if (this.cashoutUnlocked) this.cashoutZone.setInteractive({ useHandCursor: true });
  }

  showCountdown(value) {
    if (!this.countdownText) {
      this.countdownText = this.scene.add.text(W / 2, H * 0.46, value, {
        fontSize: '76px',
        fontFamily: '"Arial Black", Arial, sans-serif',
        color: '#fff7dc',
        stroke: '#07111c',
        strokeThickness: 9,
      }).setOrigin(0.5).setDepth(110);
    }
    this.countdownText.setFontSize(String(value).length > 2 ? '42px' : '76px');
    this.countdownText.setText(value).setAlpha(1).setScale(0.72);
    this.scene.tweens.add({
      targets: this.countdownText,
      scale: 1.08,
      alpha: 0,
      duration: 520,
      ease: 'Cubic.easeOut',
    });
  }

  hideCountdown() {
    if (this.countdownText) {
      this.countdownText.destroy();
      this.countdownText = null;
    }
  }

  showToast(message, color = '#ffe08a') {
    if (this.toast) this.toast.destroy();
    this.toast = this.scene.add.text(W / 2, H * 0.56, message, {
      fontSize: '15px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color,
      align: 'center',
      stroke: '#07111c',
      strokeThickness: 5,
      wordWrap: { width: W - 70 },
    }).setOrigin(0.5).setDepth(112);
    this.scene.tweens.add({
      targets: this.toast,
      y: this.toast.y - 30,
      alpha: 0,
      delay: 560,
      duration: 430,
      ease: 'Sine.easeOut',
      onComplete: () => {
        if (this.toast) this.toast.destroy();
        this.toast = null;
      },
    });
  }

  showResult({ won, amount, multiplier, bet, reason, depth, onReplay, onLobby }) {
    this.setCashoutPending(false);
    this.cashoutZone.disableInteractive();
    this.buttonGroup.setVisible(false);
    this.bottomHint.setVisible(false);

    if (this.resultOverlay) this.resultOverlay.destroy(true);
    const overlay = this.scene.add.container(0, 0).setDepth(130);
    const dim = this.scene.add.rectangle(0, 0, W, H, won ? 0x031b20 : 0x130611, 0.74).setOrigin(0);
    const panel = this.scene.add.graphics();
    const px = 22;
    const py = Math.max(118, H / 2 - 178);
    const pw = W - 44;
    const ph = 356;

    panel.fillGradientStyle(
      won ? 0x073b34 : 0x2a1018,
      won ? 0x073b34 : 0x2a1018,
      won ? 0x061421 : 0x090814,
      won ? 0x061421 : 0x090814,
      1
    );
    panel.fillRoundedRect(px, py, pw, ph, 8);
    panel.lineStyle(2, won ? 0xffdf72 : 0xff6675, 0.72);
    panel.strokeRoundedRect(px, py, pw, ph, 8);

    const title = this.scene.add.text(W / 2, py + 42, won ? 'TESOURO RESGATADO' : 'FIM DO MERGULHO', {
      fontSize: won ? '21px' : '20px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: won ? '#ffe08a' : '#ff9da5',
      stroke: '#07111c',
      strokeThickness: 5,
    }).setOrigin(0.5);
    const amountText = this.scene.add.text(W / 2, py + 92, won ? money(amount) : money(0), {
      fontSize: won ? '38px' : '32px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: won ? '#ffffff' : '#e9f7ff',
      stroke: '#07111c',
      strokeThickness: 6,
    }).setOrigin(0.5);
    const details = this.scene.add.text(W / 2, py + 146, [
      `Aposta ${money(bet)}`,
      `Multiplicador ${Number(multiplier || 1).toFixed(2)}x`,
      `Profundidade ${Math.round(depth || 0)} m`,
    ].join('\n'), {
      fontSize: '12px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#bdefff',
      align: 'center',
      stroke: '#07111c',
      strokeThickness: 3,
      wordWrap: { width: pw - 34 },
      lineSpacing: 5,
    }).setOrigin(0.5);
    const message = this.scene.add.text(W / 2, py + 188, won ? 'Saldo atualizado pelo servidor.' : reasonText(reason), {
      fontSize: '13px',
      fontFamily: 'Arial, sans-serif',
      color: won ? '#abfff1' : '#ffc0c7',
      align: 'center',
      wordWrap: { width: pw - 42 },
      lineSpacing: 4,
    }).setOrigin(0.5);

    const replayButton = this._makePanelButton(W / 2, py + 252, W - 96, 54, `JOGAR ${money(bet)}`, true, onReplay);
    const lobbyButton = this._makePanelButton(W / 2, py + 314, W - 96, 44, 'LOBBY', false, onLobby);

    overlay.add([
      dim,
      panel,
      title,
      amountText,
      details,
      message,
      replayButton.bg,
      replayButton.label,
      replayButton.zone,
      lobbyButton.bg,
      lobbyButton.label,
      lobbyButton.zone,
    ]);
    this.resultOverlay = overlay;
  }

  showError(message, onLobby) {
    this.setCashoutPending(false);
    this.cashoutZone.disableInteractive();
    this.buttonGroup.setVisible(false);
    this.bottomHint.setVisible(false);

    if (this.resultOverlay) this.resultOverlay.destroy(true);
    const overlay = this.scene.add.container(0, 0).setDepth(130);
    const dim = this.scene.add.rectangle(0, 0, W, H, 0x090814, 0.74).setOrigin(0);
    const panel = this.scene.add.graphics();
    const px = 24;
    const py = Math.max(156, H / 2 - 126);
    const pw = W - 48;
    const ph = 252;

    panel.fillGradientStyle(0x2a1018, 0x2a1018, 0x061421, 0x061421, 1);
    panel.fillRoundedRect(px, py, pw, ph, 8);
    panel.lineStyle(2, 0xff6675, 0.66);
    panel.strokeRoundedRect(px, py, pw, ph, 8);

    const title = this.scene.add.text(W / 2, py + 44, 'CONEXAO DO JOGO', {
      fontSize: '20px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#ffdf72',
      stroke: '#07111c',
      strokeThickness: 5,
    }).setOrigin(0.5);
    const body = this.scene.add.text(W / 2, py + 108, message || 'Nao foi possivel iniciar a rodada.', {
      fontSize: '13px',
      fontFamily: 'Arial, sans-serif',
      color: '#ffc0c7',
      align: 'center',
      wordWrap: { width: pw - 42 },
      lineSpacing: 5,
    }).setOrigin(0.5);
    const lobbyButton = this._makePanelButton(W / 2, py + 194, W - 96, 52, 'VOLTAR AO LOBBY', true, onLobby);

    overlay.add([dim, panel, title, body, lobbyButton.bg, lobbyButton.label, lobbyButton.zone]);
    this.resultOverlay = overlay;
  }

  _pressCashout() {
    if (!this.cashoutUnlocked || this.cashoutPending || !this.cashoutHandler) return;
    this.buttonGroup.setScale(0.985);
    this.scene.time.delayedCall(80, () => this.buttonGroup.setScale(1));
    this.cashoutHandler();
  }

  _drawChrome(sharkDistance = 1) {
    const danger = 1 - Math.max(0, Math.min(1, sharkDistance));
    this.topGfx.clear();
    this.topGfx.fillGradientStyle(0x020d24, 0x020d24, 0x000612, 0x000612, 0.72);
    this.topGfx.fillRect(0, 0, W, 162);
    this.topGfx.fillStyle(0x00152f, 0.76);
    this.topGfx.fillRoundedRect(16, 18, 120, 48, 8);
    this.topGfx.lineStyle(1, 0x2de2c9, 0.28);
    this.topGfx.strokeRoundedRect(16, 18, 120, 48, 8);
    this.topGfx.lineStyle(1, 0x8fffe7, 0.16);
    this.topGfx.lineBetween(46, 166, W / 2, 192);
    this.topGfx.lineBetween(W - 46, 166, W / 2, 192);

    this.vignette.clear();
    if (danger > 0.38) {
      this.vignette.fillStyle(0xff334a, (danger - 0.38) * 0.34);
      this.vignette.fillRect(0, 0, W, H);
    }
  }

  _drawCashoutButton() {
    this.cashoutBg.clear();
    const y = H - 95;
    const h = 76;
    this.cashoutBg.fillStyle(0x000000, 0.32);
    this.cashoutBg.fillRoundedRect(27, y + 7, W - 54, h, 8);
    this.cashoutBg.fillGradientStyle(
      this.cashoutPending ? 0xaeb7bd : 0xffdf72,
      this.cashoutPending ? 0xaeb7bd : 0xffdf72,
      this.cashoutPending ? 0x59636d : 0x25e0a7,
      this.cashoutPending ? 0x59636d : 0x25e0a7,
      1
    );
    this.cashoutBg.fillRoundedRect(21, y, W - 42, h, 8);
    this.cashoutBg.lineStyle(2, 0xffffff, 0.52);
    this.cashoutBg.strokeRoundedRect(21, y, W - 42, h, 8);
  }

  _makeIconButton(x, y, text) {
    const bg = this.scene.add.graphics();
    bg.fillStyle(0x00152f, 0.72);
    bg.fillRoundedRect(x, y, 45, 36, 8);
    bg.lineStyle(1, 0x2de2c9, 0.25);
    bg.strokeRoundedRect(x, y, 45, 36, 8);
    const label = this.scene.add.text(x + 22.5, y + 18, text, {
      fontSize: '9px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#d7fbff',
    }).setOrigin(0.5);
    const zone = this.scene.add.zone(x + 22.5, y + 18, 45, 36).setInteractive({ useHandCursor: true });
    return { bg, label, zone };
  }

  _makePanelButton(x, y, width, height, text, primary, handler) {
    const bg = this.scene.add.graphics();
    bg.fillGradientStyle(
      primary ? 0xffdf72 : 0x10243a,
      primary ? 0xffdf72 : 0x10243a,
      primary ? 0x25e0a7 : 0x061421,
      primary ? 0x25e0a7 : 0x061421,
      1
    );
    bg.fillRoundedRect(x - width / 2, y - height / 2, width, height, 8);
    bg.lineStyle(1, primary ? 0xffffff : 0x7dd3fc, primary ? 0.5 : 0.28);
    bg.strokeRoundedRect(x - width / 2, y - height / 2, width, height, 8);
    const label = this.scene.add.text(x, y, text, {
      fontSize: primary ? '16px' : '13px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: primary ? '#102112' : '#d7fbff',
    }).setOrigin(0.5);
    const zone = this.scene.add.zone(x, y, width, height).setInteractive({ useHandCursor: true });
    let locked = false;
    zone.on('pointerdown', () => {
      if (locked) return;
      locked = true;
      if (handler) handler();
    });
    return { bg, label, zone };
  }
}
