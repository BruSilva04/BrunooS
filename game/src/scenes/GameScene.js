import Phaser from 'phaser';
import { W, H, OBS_DELAY_START, GEM_DELAY, MULT_TICK, GEM_BONUS, WS_URL, state, addHistory } from '../config.js';
import Mermaid from '../objects/Mermaid.js';
import Obstacle from '../objects/Obstacle.js';
import Gem from '../objects/Gem.js';
import HUD from '../objects/HUD.js';
import SoundManager from '../utils/SoundManager.js';
import ParticleEffects from '../objects/ParticleEffects.js';

export default class GameScene extends Phaser.Scene {
  constructor() { 
    super({ key: 'Game' }); 
  }

  init(data) {
    this.bet    = data.bet;
    this.mult   = 1.00;
    this.dead   = false;
    this.cashed = false;
    this.speed  = 170;
    this._obs   = [];
    this._gems  = [];
    this._bubs  = [];
    this.ws     = null;
    this.roundId = null;
  }

  create() {
    this.sounds = new SoundManager();
    this.particles = new ParticleEffects(this);

    this._bgGfx = this.add.graphics();
    this._floorGfx = this.add.graphics();
    this._drawBg(0);

    this.merm = new Mermaid(this);

    this._tObs  = this.time.addEvent({ delay: OBS_DELAY_START, callback: this._spawnObs,  callbackScope: this, loop: true });
    this._tGem  = this.time.addEvent({ delay: GEM_DELAY,      callback: this._spawnGem,  callbackScope: this, loop: true });
    this._tBub  = this.time.addEvent({ delay: 260, callback: this._spawnBub,  callbackScope: this, loop: true });
    this._tMult = this.time.addEvent({ delay: 100, callback: this._tickMult,  callbackScope: this, loop: true });

    this.hud = new HUD(this, this.bet);
    this.hud.onCashOut(() => {
      if (!this.dead && !this.cashed) this._cashOut();
    });

    this.input.on('pointerdown', (p) => {
      if (!this.dead && !this.cashed && p.y < H - 90) {
        this.merm.flap();
        this.sounds.playSwim();
      }
    });
    this._space = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    this._connectWS();
  }
  
  _connectWS() {
    try {
      this.ws = new WebSocket(WS_URL);
      this.ws.onopen = () => {
        this.ws.send(JSON.stringify({ action: 'start_round', bet: this.bet }));
      };
      this.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'round_started') {
          this.roundId = data.round_id;
          this.crashPoint = data.crash_point;
        } else if (data.type === 'cash_out_result') {
          if (data.success) {
            this._showResult(true, data.payout);
          } else {
            this._showResult(false, 0);
          }
        } else if (data.type === 'death_registered') {
          console.log('Crash point was: ' + data.crash_point + 'x');
        }
      };
      this.ws.onerror = () => {};
      this.ws.onclose = () => {};
    } catch (e) {}
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
    const gapY  = Phaser.Math.Between(188, H - 188);
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
    this.cashed = true;
    this._stopTimers();
    this.sounds.playCashout();
    this.particles.emitCashoutShower();

    const won = +(this.bet * this.mult).toFixed(2);
    state.balance += (won - this.bet);
    addHistory(this.mult);

    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.roundId) {
      this.ws.send(JSON.stringify({ action: 'cash_out', round_id: this.roundId, client_mult: this.mult }));
    } else {
      this._showResult(true, won);
    }
  }

  _die() {
    if (this.dead || this.cashed) return;
    this.dead = true;
    this.sounds.playCrash();
    this.cameras.main.shake(280, 0.012);
    this._stopTimers();

    state.balance = Math.max(0, state.balance - this.bet);
    addHistory(this.mult);

    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.roundId) {
      this.ws.send(JSON.stringify({ action: 'death', round_id: this.roundId, client_mult: this.mult }));
    }
    
    this._showResult(false, 0);
  }

  _stopTimers() {
    [this._tObs, this._tGem, this._tBub, this._tMult].forEach(t => {
 if (t) t.destroy(); });
  }

  _showResult(won, amount) {
    this.hud.showResult(won, amount, this.mult, this.bet);
    this.time.delayedCall(500, () => {
      this.input.once('pointerdown', () => this.scene.start('Lobby', { balance: novoSaldo }));
    });
  }

  update(time, delta) {
    if (this.dead || this.cashed) return;
    const dt = delta / 1000;

    this.speed = 170 + (this.mult - 1) * 58;

    if (this.crashPoint && this.mult >= this.crashPoint) {
      this._die();
      return;
    }

    this._drawBg(-this.mult - 1);

    if (Phaser.Input.Keyboard.JustDown(this._space)) {
      this.merm.flap();
      this.sounds.playSwim();
    }
    this.merm.update(dt);
    this.particles.emitBubbleTrail(this.merm.x, this.merm.y);

    if (this.merm.isOutOfBounds()) { this._die(); return; }

    for (let i = this._obs.length - 1; i >= 0; i--) {
      const o = this._obs[i];
      o.update(this.speed, dt);

      if (o.checkCollision(this.merm.x, this.merm.y)) {
        this._die(); return;
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

    if (this.mult > 2.5 && this._TObs.delay > 1400) this._tObs.delay = 1400;
    if (this.mult > 4.0 && this._tObs.delay > 1100) this._tObs.delay = 1100;
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