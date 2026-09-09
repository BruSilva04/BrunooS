import Phaser from 'phaser';
import { W, H, OBS_DELAY_START, GEM_DELAY, MULT_TICK, GEM_BONUS, CASHOUT_UNLOCK_MULT, WS_URL, state, addHistory } from '../config.js';
import Mermaid from '../objects/Mermaid.js';
import Obstacle from '../objects/Obstacle.js';
import Gem from '../objects/Gem.js';
import HUD from '../objects/HUD.js';
import SoundManager from '../utils/SoundManager.js';
import ParticleEffects from '../objects/ParticleEffects.js';
import { clearSession, getAuthToken } from '../services/api.js';

export default class GameScene extends Phaser.Scene {
  constructor() { 
    super({ key: 'Game' }); 
  }

  init(data) {
    this.bet    = data.bet;
    this.mult   = 1.00;
    this.dead   = false;
    this.cashed = false;
    this.baseSpeed = 170;
    this.speed  = this.baseSpeed;
    this.demoMode = false;
    this._obs   = [];
    this._gems  = [];
    this._bubs  = [];
    this.ws     = null;
    this.roundId = null;
    this.resultShown = false;
    this.betDebitedByServer = false;
    this.lossReason = 'crash';
    this.roundReady = false;
    this.gameplayStarted = false;
    this.startFailureShown = false;
    this._startTimeout = null;
    this._statusText = null;
    this._tObs = null;
    this._tGem = null;
    this._tBub = null;
    this._tMult = null;
  }

  create() {
    if (document.activeElement && document.activeElement.blur) {
      document.activeElement.blur();
    }
    if (window.sereiaSyncViewport) {
      window.sereiaSyncViewport();
    }
    this.scale.refresh();
    [120, 360, 700].forEach((delay) => {
      this.time.delayedCall(delay, () => {
        if (window.sereiaSyncViewport) {
          window.sereiaSyncViewport();
        }
        this.scale.refresh();
      });
    });

    this.sounds = new SoundManager();
    this.particles = new ParticleEffects(this);

    this._bgGfx = this.add.graphics();
    this._floorGfx = this.add.graphics();
    this._drawBg(0);

    this.merm = new Mermaid(this);

    this.hud = new HUD(this, this.bet);
    this.hud.onCashOut(() => {
      if (!this.dead && !this.cashed) this._cashOut();
    });

    this.input.on('pointerdown', (p) => {
      if (this.roundReady && !this.dead && !this.cashed && p.y < H - 90) {
        this.merm.flap();
        this.sounds.playSwim();
      }
    });
    this._space = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    this._showStatus('CONECTANDO...');
    this._connectWS();
    this._startTimeout = this.time.delayedCall(9000, () => {
      if (!this.roundId && !this.resultShown) {
        this._handleServerError('Conexao com o jogo demorou demais. Tente novamente.');
      }
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this._cleanup());
  }

  _showStatus(message) {
    if (this._statusText) {
      this._statusText.setText(message);
      return;
    }
    this._statusText = this.add.text(W / 2, H / 2, message, {
      fontSize: '18px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#ffe08a',
      stroke: '#19070c',
      strokeThickness: 4,
    }).setOrigin(0.5).setDepth(50);
  }

  _clearStatus() {
    if (this._statusText) {
      this._statusText.destroy();
      this._statusText = null;
    }
  }

  _beginGameplay() {
    if (this.gameplayStarted) return;
    this.gameplayStarted = true;
    this.roundReady = true;
    this._clearStatus();

    this._tObs  = this.time.addEvent({ delay: OBS_DELAY_START, callback: this._spawnObs,  callbackScope: this, loop: true });
    this._tGem  = this.time.addEvent({ delay: GEM_DELAY,      callback: this._spawnGem,  callbackScope: this, loop: true });
    this._tBub  = this.time.addEvent({ delay: 260, callback: this._spawnBub,  callbackScope: this, loop: true });
    this._tMult = this.time.addEvent({ delay: 100, callback: this._tickMult,  callbackScope: this, loop: true });

    this.merm.flap();
  }
  
  _connectWS() {
    try {
      this.ws = new WebSocket(WS_URL);
      this.ws.onopen = () => {
        const token = getAuthToken();
        if (!token) {
          this._handleServerError('Sessao invalida');
          return;
        }
        this._showStatus('RESERVANDO APOSTA...');
        this.ws.send(JSON.stringify({ action: 'start_round', bet: this.bet, token }));
      };
      this.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'round_started') {
          this.roundId = data.round_id;
          this.betDebitedByServer = true;
          this.demoMode = !!data.demo_mode;
          if (Number.isFinite(data.balance)) state.balance = data.balance;
          if (this._startTimeout) {
            this._startTimeout.destroy();
            this._startTimeout = null;
          }
          this._beginGameplay();
        } else if (data.type === 'cash_out_result') {
          if (data.success) {
            this._applyCashOutResult(data.payout, data.multiplier, data.balance);
          } else {
            this._showCrashLoss(data.multiplier);
          }
        } else if (data.type === 'round_crashed') {
          this._serverCrash(data.multiplier);
        } else if (data.type === 'death_registered') {
          console.log('Crash point was: ' + data.crash_point + 'x');
          this._applyLossResult(this.mult, this.lossReason);
        } else if (data.type === 'error') {
          this._handleServerError(data.message);
        }
      };
      this.ws.onerror = () => {
        if (!this.resultShown && !this.roundId) {
          this._handleServerError('Falha na conexao WebSocket do jogo');
        }
      };
      this.ws.onclose = () => {
        if (this.resultShown) return;
        if (!this.roundId) {
          this._handleServerError('Conexao com o jogo fechada antes de iniciar');
        } else if (!this.dead && !this.cashed) {
          this._applyLossResult(this.mult, 'connection');
        }
      };
    } catch (e) {
      this._handleServerError('Nao foi possivel abrir o WebSocket do jogo');
    }
  }

  _drawBg(depth) {
    this._bgGfx.clear();
    this._floorGfx.clear();
    const t = Math.min(depth / 6, 1);

    const topHex = Phaser.Display.Color.Interpolate.ColorWithColor(
      { r: 0, g: 20, b: 80 }, { r: 0, g: 2, b: 10 }, 100, t * 100);
    const botHex = Phaser.Display.Color.Interpolate.ColorWithColor(
      { r: 0, g: 8, b: 32 }, { r: 0, g: 0, b: 5 }, 100, t * 100);

    const tc = Phaser.Display.Color.GetColor(topHex.r, topHex.g, topHex.b);
    const bc = Phaser.Display.Color.GetColor(botHex.r, botHex.g, botHex.b);

    this._bgGfx.fillGradientStyle(tc, tc, bc, bc, 1);
    this._bgGfx.fillRect(0, 0, W, H);

    if (t < 0.75) {
      const alpha = (0.75 - t) * 0.07;
      for (let i = 0; i < 4; i++) {
        this._bgGfx.fillStyle(0x2255ff, alpha);
        const rx = 50 + i * 85;
        const swing = Math.sin(this.time.now / 1600 + i) * 25;
        this._bgGfx.fillTriangle(rx - 18, 0, rx + 18, 0, rx + swing, H * 0.65);
      }
    }

    if (t > 0.4) {
      for (let i = 0; i < 6; i++) {
        const bx = (i * 67 + Math.sin(this.time.now / 900 + i) * 15) % W;
        const by = H * 0.7 + (i * 23) % (H * 0.28);
        this._bgGfx.fillStyle(0x00ffaa, (t - 0.4) * 0.07);
        this._bgGfx.fillCircle(bx, by, 3);
      }
    }

    this._floorGfx.fillStyle(0x00040b, 0.52);
    this._floorGfx.fillRect(0, H - 104, W, 104);
    this._floorGfx.lineStyle(1, 0x35e7cf, 0.12);
    this._floorGfx.lineBetween(0, H - 104, W, H - 104);
  }

  _spawnObs() {
    if (this.dead || this.cashed) return;
    const gapY  = Phaser.Math.Between(206, H - 206);
    this._obs.push(new Obstacle(this, gapY));
  }

  _spawnGem() {
    if (this.dead || this.cashed) return;
    this._gems.push(new Gem(this));
  }

  _spawnBub() {
    const b = this.add.circle(
      Phaser.Math.Between(0, W), H + 8,
      Phaser.Math.Between(2, 8), 0x66aaff, 0.2
    );
    this._bubs.push({ obj: b, vy: Phaser.Math.Between(35, 90) });
  }

  _tickMult() {
    if (!this.dead && !this.cashed) {
      this.mult = +(this.mult + MULT_TICK).toFixed(3);
    }
  }

  _cashOut() {
    if (this.mult < CASHOUT_UNLOCK_MULT) return;

    this.cashed = true;
    this._stopTimers();
    this.sounds.playCashout();
    this.particles.emitCashoutShower();

    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.roundId) {
      this.ws.send(JSON.stringify({ action: 'cash_out', round_id: this.roundId, client_mult: this.mult }));
    } else {
      this._handleServerError('Rodada sem confirmacao do servidor');
    }
  }

  _die(reason = 'obstacle') {
    if (this.dead || this.cashed) return;
    this.lossReason = reason;
    this.dead = true;
    this.sounds.playCrash();
    this.cameras.main.shake(280, 0.012);
    this._stopTimers();

    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.roundId) {
      this.ws.send(JSON.stringify({ action: 'death', round_id: this.roundId, client_mult: this.mult }));
      this.time.delayedCall(900, () => {
        if (!this.resultShown) this._applyLossResult(this.mult, this.lossReason);
      });
    } else {
      this._applyLossResult(this.mult, this.lossReason);
    }
  }

  _serverCrash(multiplier) {
    if (this.dead || this.cashed) return;
    this._showCrashLoss(multiplier);
  }

  _showCrashLoss(multiplier) {
    if (this.resultShown) return;
    if (Number.isFinite(multiplier)) {
      this.mult = multiplier;
    }
    this.dead = true;
    this.roundReady = false;
    this.sounds.playCrash();
    this.cameras.main.flash(150, 255, 80, 110);
    this.cameras.main.shake(280, 0.012);
    this._stopTimers();
    this._showCrashWave();
    this.time.delayedCall(420, () => this._applyLossResult(this.mult, 'crash'));
  }

  _showCrashWave() {
    const wave = this.add.graphics().setDepth(45);
    wave.fillStyle(0xff6675, 0.26);
    wave.fillRect(0, 0, 92, H);
    wave.fillStyle(0x7dd3fc, 0.18);
    wave.fillRect(92, 0, 44, H);
    wave.lineStyle(3, 0xffdf72, 0.55);
    wave.lineBetween(0, 0, 0, H);
    wave.x = W + 70;

    const label = this.add.text(W / 2, H / 2 - 78, 'MARE VIROU!', {
      fontSize: '20px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#ffdf72',
      stroke: '#27070b',
      strokeThickness: 5,
    }).setOrigin(0.5).setDepth(46);

    this.tweens.add({
      targets: wave,
      x: -160,
      duration: 420,
      ease: 'Cubic.easeOut',
      onComplete: () => wave.destroy(),
    });
    this.tweens.add({
      targets: label,
      alpha: 0,
      y: label.y - 22,
      delay: 220,
      duration: 280,
      onComplete: () => label.destroy(),
    });
  }

  _handleServerError(message) {
    console.warn('Game server error:', message);
    if (!this.roundId && !this.resultShown) {
      this.dead = true;
      this.cashed = true;
      this._stopTimers();
      if (message && message.toLowerCase().includes('sessao')) {
        clearSession();
        this.scene.start('Auth');
      } else {
        this._showStartFailure(message || 'Nao foi possivel iniciar a rodada. Tente novamente.');
      }
      return;
    }

    if ((this.dead || this.cashed) && !this.resultShown) {
      this._applyLossResult(this.mult, 'connection');
    }
  }

  _showStartFailure(message) {
    if (this.startFailureShown) return;
    this.startFailureShown = true;
    this.resultShown = true;
    this._clearStatus();

    this.add.rectangle(0, 0, W, H, 0x000000, 0.56).setOrigin(0).setDepth(80);
    const panel = this.add.graphics().setDepth(81);
    const px = 28;
    const py = H / 2 - 108;
    const pw = W - 56;
    const ph = 216;
    panel.fillStyle(0x19070c, 0.97);
    panel.fillRoundedRect(px, py, pw, ph, 8);
    panel.lineStyle(2, 0xff9da5, 0.62);
    panel.strokeRoundedRect(px, py, pw, ph, 8);

    this.add.text(W / 2, py + 44, 'CONEXAO DO JOGO', {
      fontSize: '18px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#ffe08a',
    }).setOrigin(0.5).setDepth(82);
    this.add.text(W / 2, py + 96, message, {
      fontSize: '13px',
      fontFamily: 'Arial, sans-serif',
      color: '#ffc0c7',
      align: 'center',
      wordWrap: { width: pw - 38 },
      lineSpacing: 5,
    }).setOrigin(0.5).setDepth(82);
    this.add.text(W / 2, py + 170, 'TOQUE PARA VOLTAR', {
      fontSize: '12px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#8eb8c7',
    }).setOrigin(0.5).setDepth(82);

    this.input.once('pointerdown', () => {
      this.scene.start('Lobby', { balance: state.balance, notice: message });
    });
  }

  _applyCashOutResult(payout, multiplier = this.mult, balance = null) {
    if (this.resultShown) return;
    if (Number.isFinite(multiplier)) this.mult = multiplier;
    const amount = Number.isFinite(payout) ? payout : +(this.bet * this.mult).toFixed(2);
    if (Number.isFinite(balance)) {
      state.balance = balance;
    } else if (this.betDebitedByServer) {
      state.balance += amount;
    } else {
      state.balance += (amount - this.bet);
    }
    addHistory(this.mult);
    this._showResult(true, amount, 'cashout');
  }

  _applyLossResult(multiplier = this.mult, reason = 'crash') {
    if (this.resultShown) return;
    if (Number.isFinite(multiplier)) this.mult = multiplier;
    if (!this.betDebitedByServer) {
      state.balance = Math.max(0, state.balance - this.bet);
    }
    addHistory(this.mult);
    this._showResult(false, 0, reason);
  }

  _stopTimers() {
    [this._tObs, this._tGem, this._tBub, this._tMult, this._startTimeout].forEach((timer) => {
      if (timer) timer.destroy();
    });
    this._tObs = null;
    this._tGem = null;
    this._tBub = null;
    this._tMult = null;
    this._startTimeout = null;
  }

  _cleanup() {
    this._stopTimers();
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
  }

  _showResult(won, amount, reason = 'crash') {
    if (this.resultShown) return;
    this.resultShown = true;
    this.hud.showResult(won, amount, this.mult, this.bet, reason);
    this.time.delayedCall(1800, () => {
      this.input.once('pointerdown', () => this.scene.start('Lobby', { balance: state.balance }));
    });
  }

  update(time, delta) {
    if (this.dead || this.cashed || !this.roundReady) return;
    const dt = delta / 1000;

    this.speed = this.demoMode ? this.baseSpeed : this.baseSpeed + (this.mult - 1) * 58;

    this._drawBg(-this.mult - 1);

    if (this.roundReady && Phaser.Input.Keyboard.JustDown(this._space)) {
      this.merm.flap();
      this.sounds.playSwim();
    }
    this.merm.update(dt);
    this.particles.emitBubbleTrail(this.merm.x, this.merm.y);

    if (this.merm.isOutOfBounds()) { this._die('boundary'); return; }

    for (let i = this._obs.length - 1; i >= 0; i--) {
      const o = this._obs[i];
      o.update(this.speed, dt);

      if (o.checkCollision(this.merm.x, this.merm.y, this.merm.hitRadius)) {
        this._die('obstacle'); return;
      }

      if (o.isOffScreen()) {
        o.destroy();
        this._obs.splice(i, 1);
      }
    }

    for (let i = this._gems.length - 1; i >= 0; i--) {
      const g = this._gems[i];
      g.update(this.speed, dt);

      if (g.checkCollect(this.merm.x, this.merm.y)) {
        this.mult = +(this.mult + GEM_BONUS).toFixed(3);
        this.sounds.playGem();
        this.cameras.main.flash(70, 30, 160, 80);
        this.particles.emitGemBurst(g.sprite.x, g.sprite.y);
        this._showBonus(g.sprite.x, g.sprite.y);
        g.destroy(); 
        this._gems.splice(i, 1);
        continue;
      }
      if (g.isOffScreen()) {
        g.destroy(); 
        this._gems.splice(i, 1); 
      }
    }

    for (let i = this._bubs.length - 1; i >= 0; i--) {
      const b = this._bubs[i];
      b.obj.y -= b.vy * dt;
      if (b.obj.y < -12) { b.obj.destroy(); this._bubs.splice(i, 1); }
    }

    this.hud.updateMult(this.mult, this.bet);

    if (!this.demoMode && this.mult > 2.5 && this._tObs.delay > 1400) this._tObs.delay = 1400;
    if (!this.demoMode && this.mult > 4.0 && this._tObs.delay > 1100) this._tObs.delay = 1100;
  }

  _showBonus(x, y) {
    const txt = this.add.text(x, y - 24, '+0.07x', {
      fontSize: '16px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#ffe08a',
      stroke: '#2f2100',
      strokeThickness: 3
    }).setOrigin(0.5);

    this.tweens.add({ targets: txt, y: y - 58, alpha: 0, duration: 620, ease: 'Sine.easeOut', onComplete: () => txt.destroy() });
  }
}
