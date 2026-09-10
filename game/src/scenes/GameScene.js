import Phaser from 'phaser';
import {
  W,
  H,
  WS_URL,
  ROUND_STATES,
  MERMAID_GAME_CONFIG,
  CASHOUT_UNLOCK_MULT,
  state as walletState,
  addHistory,
  centsToMoney,
  moneyToCents,
} from '../config.js';
import { clearSession, getAuthToken } from '../services/api.js';
import SoundManager from '../utils/SoundManager.js';
import ObstacleDirector from '../runner/ObstacleDirector.js';
import RunnerHUD from '../runner/RunnerHUD.js';
import {
  RunnerMermaid,
  RunnerObstacle,
  RunnerShark,
  RunnerTreasure,
  laneToX,
  trackY,
} from '../runner/RunnerActors.js';

const TUTORIAL_KEY = 'sereia_runner_tutorial_seen';
const START_TIMEOUT_MS = 9000;
const CASHOUT_TIMEOUT_MS = 9000;
const MAX_DT = 0.05;

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function isFinalState(stateName) {
  return [
    ROUND_STATES.CASHED_OUT,
    ROUND_STATES.LOST,
    ROUND_STATES.ROUND_FINISHED,
    ROUND_STATES.ERROR,
  ].includes(stateName);
}

export default class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'Game' });
  }

  init(data = {}) {
    const minBet = centsToMoney(MERMAID_GAME_CONFIG.minBetCents);
    this.bet = Math.max(minBet, Number(data.bet || minBet));
    this.mult = 1;
    this.depth = 0;
    this.roundState = ROUND_STATES.IDLE;
    this.demoMode = false;
    this.ws = null;
    this.roundId = null;
    this.serverSeedHash = null;
    this.roundStartedAt = null;
    this.resultShown = false;
    this.betDebitedByServer = false;
    this.cashoutPending = false;
    this.lossReason = 'crash';
    this.sharkDistance = MERMAID_GAME_CONFIG.sharkSafeDistance;
    this.lastSoftHitAt = -Infinity;
    this.lastDangerSoundAt = 0;
    this.lastWorldDrawAt = -Infinity;
    this.lastWorldBiome = '';
    this.lastSpeedLineDrawAt = -Infinity;
    this.speedLinesActive = false;
    this.spawnAccumulator = 0;
    this.treasureAccumulator = 0;
    this.bubbleAccumulator = 0;
    this.roundTimers = [];
    this.obstacles = [];
    this.treasures = [];
    this.ambientBubbles = [];
    this.pointerStart = null;
    this.startFailureShown = false;
    this.reducedMotion = typeof window !== 'undefined'
      && window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  create() {
    this._syncViewport();
    [120, 360, 700].forEach((delay) => {
      this.time.delayedCall(delay, () => this._syncViewport());
    });

    this.sounds = new SoundManager();
    this.director = new ObstacleDirector(this);
    this._createWorld();

    this.shark = new RunnerShark(this);
    this.player = new RunnerMermaid(this);
    this.hud = new RunnerHUD(this, this.bet);
    this.hud.onCashOut(() => this._cashOut());
    this.hud.onSoundToggle(() => {
      const enabled = this.sounds.toggle();
      this.hud.setSoundEnabled(enabled);
    });
    this.hud.setSoundEnabled(this.sounds.enabled);

    this._installInput();
    this._installGestureLock();
    this._setRoundState(ROUND_STATES.READY, 'PRONTO PARA MERGULHAR');

    if (!window.localStorage.getItem(TUTORIAL_KEY)) {
      this._showTutorial(() => this._startServerRound());
    } else {
      this._startServerRound();
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this._cleanup());
  }

  update(time, delta) {
    const dt = Math.min(delta / 1000, MAX_DT);
    const activeVisual = !isFinalState(this.roundState);

    this._drawWorld(time);
    this._updateAmbient(time, dt, activeVisual);
    this._updateControls();

    if (this.roundStartedAt && [
      ROUND_STATES.COUNTDOWN,
      ROUND_STATES.PLAYING,
      ROUND_STATES.HIT_STUN,
      ROUND_STATES.SHARK_WARNING,
      ROUND_STATES.CASHOUT_PENDING,
    ].includes(this.roundState)) {
      this._syncMultiplierFromServerClock(time);
    }

    const biome = this.director.biomeForDepth(this.depth);
    this.hud.update({
      mult: this.mult,
      depth: this.depth,
      biome,
      sharkDistance: this.sharkDistance,
      stateName: this.roundState,
    });

    this.player?.update(time);
    this.shark?.setDistance(this.sharkDistance);
    this.shark?.update(dt, time);

    if (![ROUND_STATES.PLAYING, ROUND_STATES.HIT_STUN, ROUND_STATES.SHARK_WARNING, ROUND_STATES.CASHOUT_PENDING].includes(this.roundState)) {
      return;
    }

    const speed = this.director.travelSpeed(this.depth, this.mult, this.demoMode);
    const gameplayActive = [ROUND_STATES.PLAYING, ROUND_STATES.SHARK_WARNING].includes(this.roundState);

    if (gameplayActive) {
      this.depth += MERMAID_GAME_CONFIG.depthPerSecond * dt * (0.88 + speed);
      this.sharkDistance = clamp01(this.sharkDistance + MERMAID_GAME_CONFIG.sharkRecoveryPerSecond * dt);
      this._spawnRunnerObjects(dt);
    }

    this._updateRunnerObjects(time, dt, speed, gameplayActive);
    this._updateSharkPressure(time);
  }

  _syncViewport() {
    if (document.activeElement && document.activeElement.blur) {
      document.activeElement.blur();
    }
    if (window.sereiaSyncViewport) {
      window.sereiaSyncViewport();
    }
    this.scale.refresh();
  }

  _setRoundState(nextState, message = '') {
    if (this.roundState === nextState) return;
    this.roundState = nextState;
    if (message && this.hud) {
      this.hud.setStatus(message);
    }
  }

  _createWorld() {
    this.bg = this.add.graphics().setDepth(0);
    this.mid = this.add.graphics().setDepth(2);
    this.track = this.add.graphics().setDepth(5);
    this.speedLines = this.add.graphics().setDepth(70);
    this._createAmbientBubbles();
  }

  _createAmbientBubbles() {
    for (let i = 0; i < MERMAID_GAME_CONFIG.ambientBubbleCount; i++) {
      const bubble = this.add.circle(
        Phaser.Math.Between(0, W),
        Phaser.Math.Between(0, H),
        Phaser.Math.Between(2, 7),
        0x8fffe7,
        Phaser.Math.FloatBetween(0.08, 0.22)
      ).setDepth(4);
      this.ambientBubbles.push({
        obj: bubble,
        vy: Phaser.Math.FloatBetween(18, 58),
        sway: Phaser.Math.FloatBetween(0.6, 1.8),
        phase: Phaser.Math.FloatBetween(0, Math.PI * 2),
      });
    }
  }

  _drawWorld(time) {
    const biome = this.director.biomeForDepth(this.depth).key;
    const palette = {
      reef: { top: 0x0757a8, mid: 0x033767, bottom: 0x020c24, glow: 0x6fffe9 },
      wreck: { top: 0x04375d, mid: 0x05233f, bottom: 0x030815, glow: 0xffdf72 },
      ruins: { top: 0x062b55, mid: 0x063342, bottom: 0x020711, glow: 0x8fffe7 },
      abyss: { top: 0x021329, mid: 0x010917, bottom: 0x000308, glow: 0x8d5cff },
    }[biome] || { top: 0x0757a8, mid: 0x033767, bottom: 0x020c24, glow: 0x6fffe9 };

    const shouldRedrawWorld = biome !== this.lastWorldBiome
      || time - this.lastWorldDrawAt >= MERMAID_GAME_CONFIG.worldRedrawIntervalMs;

    if (shouldRedrawWorld) {
      this.lastWorldBiome = biome;
      this.lastWorldDrawAt = time;

      this.bg.clear();
      this.bg.fillGradientStyle(palette.top, palette.top, palette.mid, palette.bottom, 1);
      this.bg.fillRect(0, 0, W, H);

      const horizon = H * MERMAID_GAME_CONFIG.horizonYRatio;
      if (biome === 'reef') {
        for (let i = 0; i < 5; i++) {
          const x = 18 + i * 88 + Math.sin(time / 1800 + i) * 12;
          this.bg.fillStyle(0x9df8ff, 0.035);
          this.bg.fillTriangle(x - 18, 0, x + 30, 0, x + Math.sin(time / 1000 + i) * 45, H * 0.7);
        }
      }

      this.mid.clear();
      this._drawBiomeSilhouettes(time, biome, palette);

      this.track.clear();
      const leftFar = W / 2 - 34;
      const rightFar = W / 2 + 34;
      const leftNear = laneToX(-1, 0) - 96;
      const rightNear = laneToX(1, 0) + 96;
      this.track.fillStyle(0x07263a, 0.38);
      this.track.beginPath();
      this.track.moveTo(leftFar, horizon + 10);
      this.track.lineTo(rightFar, horizon + 10);
      this.track.lineTo(rightNear, H + 40);
      this.track.lineTo(leftNear, H + 40);
      this.track.closePath();
      this.track.fillPath();

      [-0.5, 0.5].forEach((lane, index) => {
        const pulse = 0.18 + Math.sin(time / 360 + index) * 0.045;
        this.track.lineStyle(2, palette.glow, pulse);
        this.track.lineBetween(laneToX(lane, 0.94), trackY(0.94), laneToX(lane, -0.02), H + 12);
      });

      for (let z = 0.15; z <= 0.92; z += 0.18) {
        const y = trackY(z);
        const spread = 138 * (1 - z);
        this.track.lineStyle(1, palette.glow, 0.08);
        this.track.lineBetween(W / 2 - spread, y, W / 2 + spread, y);
      }
    }

    this._drawSpeedLines(time);
  }

  _drawSpeedLines(time) {
    if (!this.reducedMotion && [ROUND_STATES.PLAYING, ROUND_STATES.SHARK_WARNING].includes(this.roundState)) {
      if (time - this.lastSpeedLineDrawAt < MERMAID_GAME_CONFIG.speedLineIntervalMs) return;
      this.lastSpeedLineDrawAt = time;
      this.speedLinesActive = true;
      this.speedLines.clear();
      const intensity = Phaser.Math.Clamp((this.mult - 1) / 3, 0.12, 0.48);
      this.speedLines.lineStyle(1, 0xd7fbff, intensity);
      for (let i = 0; i < 9; i++) {
        const x = 24 + ((i * 43 + time / 18) % (W - 48));
        const y = H * 0.2 + ((i * 61 + time / 6) % (H * 0.66));
        this.speedLines.lineBetween(x, y, x - 8, y + 38);
      }
    } else if (this.speedLinesActive) {
      this.speedLinesActive = false;
      this.speedLines.clear();
    }
  }

  _drawBiomeSilhouettes(time, biome, palette) {
    const offset = (time / 36) % 120;
    if (biome === 'wreck') {
      this.mid.fillStyle(0x090b0d, 0.34);
      for (let i = -1; i < 4; i++) {
        const x = i * 138 - offset;
        this.mid.fillRoundedRect(x, H * 0.56, 116, 42, 5);
        this.mid.lineStyle(3, 0x4d3828, 0.18);
        this.mid.lineBetween(x + 18, H * 0.55, x + 92, H * 0.49);
      }
      return;
    }

    if (biome === 'ruins') {
      this.mid.fillStyle(0x081116, 0.36);
      for (let i = -1; i < 5; i++) {
        const x = i * 96 - offset * 0.7;
        this.mid.fillRoundedRect(x, H * 0.5, 34, H * 0.28, 5);
        this.mid.fillRect(x - 7, H * 0.49, 48, 8);
      }
      return;
    }

    if (biome === 'abyss') {
      this.mid.fillStyle(palette.glow, 0.08);
      for (let i = 0; i < 12; i++) {
        const x = (i * 41 + Math.sin(time / 950 + i) * 12) % W;
        const y = H * 0.33 + ((i * 59 + time / 20) % (H * 0.5));
        this.mid.fillCircle(x, y, 2 + (i % 2));
      }
      return;
    }

    this.mid.lineStyle(5, 0xff5f7a, 0.20);
    for (let i = -1; i < 8; i++) {
      const x = i * 62 - offset * 0.32;
      const baseY = H - 26;
      this.mid.lineBetween(x, baseY, x + 12, baseY - 62);
      this.mid.lineBetween(x + 12, baseY - 42, x - 8, baseY - 70);
      this.mid.lineBetween(x + 12, baseY - 30, x + 34, baseY - 54);
    }
  }

  _installInput() {
    this.input.on('pointerdown', this._onPointerDown, this);
    this.input.on('pointerup', this._onPointerUp, this);
    this.input.on('pointercancel', () => {
      this.pointerStart = null;
    });

    if (this.input.keyboard) {
      this.keys = this.input.keyboard.addKeys({
        left: Phaser.Input.Keyboard.KeyCodes.LEFT,
        right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
        up: Phaser.Input.Keyboard.KeyCodes.UP,
        down: Phaser.Input.Keyboard.KeyCodes.DOWN,
        a: Phaser.Input.Keyboard.KeyCodes.A,
        d: Phaser.Input.Keyboard.KeyCodes.D,
        w: Phaser.Input.Keyboard.KeyCodes.W,
        s: Phaser.Input.Keyboard.KeyCodes.S,
      });
    }
  }

  _installGestureLock() {
    this._preventTouchMove = (event) => {
      if (this.scene.isActive('Game')) event.preventDefault();
    };
    this.game.canvas.addEventListener('touchmove', this._preventTouchMove, { passive: false });
  }

  _updateControls() {
    if (!this.keys || !this._acceptsMovementInput()) return;
    const JustDown = Phaser.Input.Keyboard.JustDown;
    if (JustDown(this.keys.left) || JustDown(this.keys.a)) this._requestLane(-1);
    if (JustDown(this.keys.right) || JustDown(this.keys.d)) this._requestLane(1);
    if (JustDown(this.keys.up) || JustDown(this.keys.w)) this._requestDodge('up');
    if (JustDown(this.keys.down) || JustDown(this.keys.s)) this._requestDodge('down');
  }

  _onPointerDown(pointer) {
    if (!this._acceptsMovementInput()) return;
    if (pointer.y > H - 132) return;
    this.pointerStart = { x: pointer.x, y: pointer.y, time: this.time.now };
  }

  _onPointerUp(pointer) {
    if (!this.pointerStart || !this._acceptsMovementInput()) return;
    const start = this.pointerStart;
    this.pointerStart = null;
    const dx = pointer.x - start.x;
    const dy = pointer.y - start.y;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    const elapsed = this.time.now - start.time;
    if (elapsed > 780 || Math.max(absX, absY) < 24) return;

    if (absX > absY) {
      this._requestLane(dx < 0 ? -1 : 1);
      return;
    }
    this._requestDodge(dy < 0 ? 'up' : 'down');
  }

  _acceptsMovementInput() {
    return [ROUND_STATES.PLAYING, ROUND_STATES.SHARK_WARNING].includes(this.roundState);
  }

  _requestLane(direction) {
    if (!this._acceptsMovementInput()) return;
    if (this.player.moveLane(direction)) {
      this.sounds.playSwim();
      this._haptic(8);
    }
  }

  _requestDodge(action) {
    if (!this._acceptsMovementInput()) return;
    if (this.player.dodgeAction) return;
    this.player.dodge(action);
    this.sounds.playSwim();
    this._haptic(8);
  }

  _showTutorial(onDone) {
    const overlay = this.add.container(0, 0).setDepth(140);
    const dim = this.add.rectangle(0, 0, W, H, 0x000712, 0.78).setOrigin(0);
    const panel = this.add.graphics();
    const px = 24;
    const py = Math.max(120, H / 2 - 176);
    const pw = W - 48;
    const ph = 352;
    panel.fillGradientStyle(0x073b54, 0x073b54, 0x081425, 0x081425, 1);
    panel.fillRoundedRect(px, py, pw, ph, 8);
    panel.lineStyle(2, 0x8fffe7, 0.56);
    panel.strokeRoundedRect(px, py, pw, ph, 8);

    const title = this.add.text(W / 2, py + 44, 'SEREIA RUNNER', {
      fontSize: '24px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#ffe08a',
      stroke: '#07111c',
      strokeThickness: 5,
    }).setOrigin(0.5);
    const body = this.add.text(W / 2, py + 112, [
      'DESLIZE PARA OS LADOS',
      'troque de caminho',
      '',
      'DESLIZE PARA CIMA OU BAIXO',
      'escape de obstaculos especiais',
      '',
      'RESGATE DEPOIS DE 2.50x',
    ].join('\n'), {
      fontSize: '14px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#d7fbff',
      align: 'center',
      lineSpacing: 8,
      wordWrap: { width: pw - 48 },
    }).setOrigin(0.5);
    const btn = this._makeOverlayButton(W / 2, py + 292, W - 96, 56, 'ENTENDI', () => {
      window.localStorage.setItem(TUTORIAL_KEY, 'true');
      overlay.destroy(true);
      onDone();
    });
    overlay.add([dim, panel, title, body, btn.bg, btn.label, btn.zone]);
  }

  _startServerRound() {
    if (this.startingRound) return;
    this.startingRound = true;
    this._setRoundState(ROUND_STATES.READY, 'CONECTANDO...');

    const localBalanceCents = moneyToCents(walletState.balance);
    if (Number.isFinite(localBalanceCents) && walletState.balance > 0 && localBalanceCents < MERMAID_GAME_CONFIG.minBetCents) {
      this._showStartFailure('Saldo insuficiente para este jogo. A aposta minima e R$ 30,00.');
      return;
    }

    this._connectWS();
    this.startTimeout = this.time.delayedCall(START_TIMEOUT_MS, () => {
      if (!this.roundId && !this.resultShown) {
        this._handleServerError('Conexao com o jogo demorou demais. Tente novamente.');
      }
    });
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
        this.hud.setStatus('RESERVANDO APOSTA...');
        this.ws.send(JSON.stringify({ action: 'start_round', bet: roundMoney(this.bet), token }));
      };
      this.ws.onmessage = (event) => this._handleWSMessage(event);
      this.ws.onerror = () => {
        if (!this.resultShown && !this.roundId) {
          this._handleServerError('Falha na conexao WebSocket do jogo.');
        }
      };
      this.ws.onclose = () => {
        if (this.resultShown || isFinalState(this.roundState)) return;
        if (!this.roundId) {
          this._handleServerError('Conexao fechada antes de iniciar.');
          return;
        }
        if (this.cashoutPending) {
          this._handleServerError('Resgate enviado, mas a conexao caiu antes da confirmacao.');
          return;
        }
        this._applyLossResult(this.mult, 'connection');
      };
    } catch (error) {
      this._handleServerError('Nao foi possivel abrir o WebSocket do jogo.');
    }
  }

  _handleWSMessage(event) {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      this._handleServerError('Resposta invalida do servidor.');
      return;
    }

    if (data.type === 'round_started') {
      this.roundId = data.round_id;
      this.serverSeedHash = data.server_seed_hash;
      this.betDebitedByServer = !!data.bet_reserved;
      this.demoMode = !!data.demo_mode;
      if (Number.isFinite(data.balance)) walletState.balance = data.balance;
      if (this.startTimeout) {
        this.startTimeout.destroy();
        this.startTimeout = null;
      }
      this._beginCountdown();
      return;
    }

    if (data.type === 'play_started') {
      if (data.round_id && data.round_id !== this.roundId) {
        this._handleServerError('Rodada invalida recebida do servidor.');
        return;
      }
      this.betDebitedByServer = true;
      if (Number.isFinite(data.balance)) walletState.balance = data.balance;
      this.roundStartedAt = this.time.now;
      this._beginGameplay();
      return;
    }

    if (data.type === 'round_canceled') {
      this._handleServerError(data.message || 'Rodada cancelada antes de iniciar.');
      return;
    }

    if (data.type === 'cash_out_result') {
      this._clearCashoutTimeout();
      if (data.success) {
        this._applyCashOutResult(data.payout, data.multiplier, data.balance);
      } else {
        this._showCrashLoss(data.multiplier);
      }
      return;
    }

    if (data.type === 'round_crashed') {
      this._showCrashLoss(data.multiplier);
      return;
    }

    if (data.type === 'death_registered') {
      this._applyLossResult(this.mult, this.lossReason);
      return;
    }

    if (data.type === 'error') {
      this._handleServerError(data.message || 'Erro no servidor do jogo.');
    }
  }

  _beginCountdown() {
    this._setRoundState(ROUND_STATES.COUNTDOWN, 'AGUARDE O SINAL');
    const steps = ['3', '2', '1', 'MERGULHAR'];
    steps.forEach((label, index) => {
      this.roundTimers.push(this.time.delayedCall(index * MERMAID_GAME_CONFIG.countdownStepMs, () => {
        if (this.roundState !== ROUND_STATES.COUNTDOWN) return;
        this.hud.showCountdown(label);
        if (index === 0) this.sounds.playSwim();
      }));
    });
    this.roundTimers.push(this.time.delayedCall(steps.length * MERMAID_GAME_CONFIG.countdownStepMs, () => {
      if (this.roundState !== ROUND_STATES.COUNTDOWN) return;
      this.hud.hideCountdown();
      this._requestPlayStart();
    }));
  }

  _requestPlayStart() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.roundId) {
      this._handleServerError('Rodada sem confirmacao do servidor.');
      return;
    }
    this.hud.setStatus('SINCRONIZANDO...');
    this.ws.send(JSON.stringify({
      action: 'begin_play',
      round_id: this.roundId,
    }));
  }

  _beginGameplay() {
    if (this.roundState === ROUND_STATES.PLAYING || this.resultShown) return;
    this.spawnAccumulator = 380;
    this.treasureAccumulator = 260;
    this._setRoundState(ROUND_STATES.PLAYING, this.demoMode ? 'CONTA DEMO' : 'FUJA DO TUBARAO');
    this.player.animState = 'SWIM';
    this.sounds.playSwim();
  }

  _syncMultiplierFromServerClock(time) {
    const elapsed = Math.max(0, (time - this.roundStartedAt) / 1000);
    const visualMult = 1 + elapsed * MERMAID_GAME_CONFIG.multiplierPerSecond;
    this.mult = Math.max(this.mult, Number(visualMult.toFixed(3)));
  }

  _spawnRunnerObjects(dt) {
    this.spawnAccumulator += dt * 1000;
    this.treasureAccumulator += dt * 1000;

    const interval = this.director.spawnInterval(this.depth, this.mult, this.demoMode);
    if (this.spawnAccumulator >= interval) {
      this.spawnAccumulator = 0;
      const wave = this.director.createWave(this.depth, this.mult, this.demoMode);
      wave.forEach((data) => this.obstacles.push(new RunnerObstacle(this, data)));
    }

    if (this.treasureAccumulator >= MERMAID_GAME_CONFIG.treasureIntervalMs) {
      this.treasureAccumulator = 0;
      this.treasures.push(new RunnerTreasure(this, this.director.createTreasure(this.depth)));
    }
  }

  _updateRunnerObjects(time, dt, speed, resolveCollisions) {
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const obstacle = this.obstacles[i];
      obstacle.z -= speed * dt;
      obstacle.update(time);

      if (resolveCollisions && obstacle.shouldResolve()) {
        this._resolveObstacle(obstacle);
      }

      if (obstacle.isOffscreen()) {
        obstacle.destroy();
        this.obstacles.splice(i, 1);
      }
    }

    for (let i = this.treasures.length - 1; i >= 0; i--) {
      const treasure = this.treasures[i];
      treasure.z -= speed * dt;
      treasure.update(time);

      if (resolveCollisions && treasure.shouldCollect(this.player.lane, this.player.dodgeAction)) {
        treasure.resolved = true;
        this._collectTreasure(treasure);
        treasure.destroy();
        this.treasures.splice(i, 1);
        continue;
      }

      if (treasure.isOffscreen()) {
        treasure.destroy();
        this.treasures.splice(i, 1);
      }
    }

    while (this.obstacles.length + this.treasures.length > MERMAID_GAME_CONFIG.maxVisualObjects) {
      const item = this.obstacles.shift() || this.treasures.shift();
      item?.destroy();
    }
  }

  _resolveObstacle(obstacle) {
    obstacle.resolved = true;
    if (obstacle.lane !== this.player.lane) return;

    const avoid = obstacle.type.avoid;
    const dodged = avoid === 'up'
      ? this.player.dodgeAction === 'up'
      : avoid === 'down'
        ? this.player.dodgeAction === 'down'
        : false;

    if (dodged) {
      this._showDodgeSuccess(obstacle);
      return;
    }

    if (obstacle.type.severity === 'hard') {
      this._die('obstacle');
      return;
    }

    this._softHit(obstacle);
  }

  _showDodgeSuccess(obstacle) {
    const text = this.add.text(obstacle.container.x, obstacle.container.y - 36, 'ESCAPOU', {
      fontSize: '12px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#8fffe7',
      stroke: '#07111c',
      strokeThickness: 4,
    }).setOrigin(0.5).setDepth(72);
    this.tweens.add({
      targets: text,
      y: text.y - 28,
      alpha: 0,
      duration: 420,
      ease: 'Sine.easeOut',
      onComplete: () => text.destroy(),
    });
  }

  _softHit(obstacle) {
    const wasCritical = this.sharkDistance <= MERMAID_GAME_CONFIG.sharkDangerDistance
      || (this.time.now - this.lastSoftHitAt < MERMAID_GAME_CONFIG.softCollisionRecoveryMs
        && this.sharkDistance <= MERMAID_GAME_CONFIG.sharkWarningDistance);
    this.lastSoftHitAt = this.time.now;
    this.sharkDistance = clamp01(this.sharkDistance - MERMAID_GAME_CONFIG.sharkSoftPenalty);
    this.player.hit();
    this.sounds.playImpact();
    this._haptic(18);

    if (!this.reducedMotion) {
      this.cameras.main.shake(150, 0.006);
    }
    this._emitImpact(obstacle.container.x, obstacle.container.y);

    if (wasCritical) {
      this._die('shark');
      return;
    }

    this._setRoundState(ROUND_STATES.HIT_STUN, 'O TUBARAO APROXIMOU');
    this.roundTimers.push(this.time.delayedCall(MERMAID_GAME_CONFIG.hitStunMs, () => {
      if (this.roundState !== ROUND_STATES.HIT_STUN) return;
      const warning = this.sharkDistance <= MERMAID_GAME_CONFIG.sharkWarningDistance;
      this._setRoundState(warning ? ROUND_STATES.SHARK_WARNING : ROUND_STATES.PLAYING, warning ? 'PERIGO PERTO' : 'FUJA DO TUBARAO');
    }));
  }

  _updateSharkPressure(time) {
    if (![ROUND_STATES.PLAYING, ROUND_STATES.SHARK_WARNING].includes(this.roundState)) return;
    if (this.sharkDistance <= MERMAID_GAME_CONFIG.sharkWarningDistance && this.roundState !== ROUND_STATES.SHARK_WARNING) {
      this._setRoundState(ROUND_STATES.SHARK_WARNING, 'PERIGO PERTO');
    } else if (this.sharkDistance > MERMAID_GAME_CONFIG.sharkWarningDistance && this.roundState === ROUND_STATES.SHARK_WARNING) {
      this._setRoundState(ROUND_STATES.PLAYING, 'FUJA DO TUBARAO');
    }

    if (this.sharkDistance <= MERMAID_GAME_CONFIG.sharkWarningDistance && time - this.lastDangerSoundAt > 1800) {
      this.lastDangerSoundAt = time;
      this.sounds.playDanger();
      if (!this.reducedMotion) this.cameras.main.shake(90, 0.0025);
    }
  }

  _collectTreasure(treasure) {
    this.sounds.playGem();
    this._emitTreasureBurst(treasure.container.x, treasure.container.y);
    this.hud.showToast('TESOURO', '#ffe08a');
  }

  _cashOut() {
    if (this.cashoutPending || this.resultShown) return;
    if (![ROUND_STATES.PLAYING, ROUND_STATES.SHARK_WARNING, ROUND_STATES.HIT_STUN].includes(this.roundState)) return;
    if (this.mult < CASHOUT_UNLOCK_MULT) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.roundId) {
      this._handleServerError('Rodada sem confirmacao do servidor.');
      return;
    }

    this.cashoutPending = true;
    this._setRoundState(ROUND_STATES.CASHOUT_PENDING, 'CONFIRMANDO RESGATE...');
    this.hud.setCashoutPending(true);
    this.player.cashout();
    this._haptic(12);
    this.ws.send(JSON.stringify({
      action: 'cash_out',
      round_id: this.roundId,
      client_mult: Number(this.mult.toFixed(3)),
    }));
    this.cashoutTimeout = this.time.delayedCall(CASHOUT_TIMEOUT_MS, () => {
      if (!this.resultShown && this.cashoutPending) {
        this._handleServerError('Resgate enviado, mas o servidor nao confirmou a tempo.');
      }
    });
  }

  _die(reason = 'obstacle') {
    if (this.resultShown || this.cashoutPending || isFinalState(this.roundState)) return;
    this.lossReason = reason;
    this._setRoundState(ROUND_STATES.LOST, 'FIM DO MERGULHO');
    this._stopRoundTimers();
    this.sounds.playCrash();
    this.sharkDistance = 0;
    this.shark.bite();
    this._haptic([40, 30, 70]);
    if (!this.reducedMotion) {
      this.cameras.main.shake(280, 0.012);
      this.cameras.main.flash(120, 255, 80, 110);
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.roundId) {
      this.ws.send(JSON.stringify({
        action: 'death',
        round_id: this.roundId,
        client_mult: Number(this.mult.toFixed(3)),
      }));
      this.roundTimers.push(this.time.delayedCall(900, () => {
        if (!this.resultShown) this._applyLossResult(this.mult, this.lossReason);
      }));
      return;
    }
    this._applyLossResult(this.mult, this.lossReason);
  }

  _showCrashLoss(multiplier) {
    if (this.resultShown || isFinalState(this.roundState)) return;
    if (Number.isFinite(multiplier)) this.mult = multiplier;
    this.lossReason = 'crash';
    this._setRoundState(ROUND_STATES.LOST, 'MARE VIROU');
    this._stopRoundTimers();
    this.sounds.playCrash();
    this.sharkDistance = 0.08;
    this.shark.bite();
    this._showCrashWave();
    this._haptic([30, 20, 60]);
    if (!this.reducedMotion) {
      this.cameras.main.shake(260, 0.01);
      this.cameras.main.flash(140, 255, 80, 110);
    }
    this.roundTimers.push(this.time.delayedCall(420, () => this._applyLossResult(this.mult, 'crash')));
  }

  _showCrashWave() {
    const wave = this.add.graphics().setDepth(86);
    wave.fillStyle(0xff6675, 0.26);
    wave.fillRect(0, 0, 92, H);
    wave.fillStyle(0x7dd3fc, 0.18);
    wave.fillRect(92, 0, 44, H);
    wave.lineStyle(3, 0xffdf72, 0.55);
    wave.lineBetween(0, 0, 0, H);
    wave.x = W + 70;

    this.tweens.add({
      targets: wave,
      x: -160,
      duration: 420,
      ease: 'Cubic.easeOut',
      onComplete: () => wave.destroy(),
    });
  }

  _applyCashOutResult(payout, multiplier = this.mult, balance = null) {
    if (this.resultShown) return;
    this.resultShown = true;
    this.cashoutPending = false;
    this._clearCashoutTimeout();
    this._stopRoundTimers();
    this._setRoundState(ROUND_STATES.CASHED_OUT, 'TESOURO RESGATADO');
    if (Number.isFinite(multiplier)) this.mult = multiplier;
    const amount = Number.isFinite(payout) ? roundMoney(payout) : roundMoney(this.bet * this.mult);
    if (Number.isFinite(balance)) {
      walletState.balance = balance;
    } else if (this.betDebitedByServer) {
      walletState.balance = roundMoney(walletState.balance + amount);
    } else {
      walletState.balance = roundMoney(walletState.balance + amount - this.bet);
    }
    addHistory(this.mult);
    this.sounds.playCashout();
    this._emitCashoutShower();
    this.hud.showResult({
      won: true,
      amount,
      multiplier: this.mult,
      bet: this.bet,
      reason: 'cashout',
      depth: this.depth,
      onReplay: () => this._tryReplay(),
      onLobby: () => this._goLobby(),
    });
    this._finishSocket();
  }

  _applyLossResult(multiplier = this.mult, reason = 'crash') {
    if (this.resultShown) return;
    this.resultShown = true;
    this.cashoutPending = false;
    this._clearCashoutTimeout();
    this._stopRoundTimers();
    this._setRoundState(ROUND_STATES.ROUND_FINISHED, 'RODADA FINALIZADA');
    if (Number.isFinite(multiplier)) this.mult = multiplier;
    if (!this.betDebitedByServer) {
      walletState.balance = roundMoney(Math.max(0, walletState.balance - this.bet));
    }
    addHistory(this.mult);
    this.hud.showResult({
      won: false,
      amount: 0,
      multiplier: this.mult,
      bet: this.bet,
      reason,
      depth: this.depth,
      onReplay: () => this._tryReplay(),
      onLobby: () => this._goLobby(),
    });
    this._finishSocket();
  }

  _handleServerError(message) {
    if (this.resultShown) return;
    const text = String(message || 'Erro no servidor do jogo.');
    if (text.toLowerCase().includes('sessao')) {
      clearSession();
      this._cleanup();
      this.scene.start('Auth');
      return;
    }

    if (!this.roundId) {
      this._showStartFailure(text);
      return;
    }

    if (this.cashoutPending) {
      this.cashoutPending = false;
      this.hud.setCashoutPending(false);
      this._showStartFailure(text);
      return;
    }

    this._applyLossResult(this.mult, 'connection');
  }

  _showStartFailure(message) {
    if (this.startFailureShown || this.resultShown) return;
    this.startFailureShown = true;
    this.resultShown = true;
    this._setRoundState(ROUND_STATES.ERROR, 'ERRO DE CONEXAO');
    this._stopRoundTimers();
    this._clearCashoutTimeout();
    this.hud.showError(message, () => this._goLobby(message));
    this._finishSocket();
  }

  _tryReplay() {
    if (roundMoney(walletState.balance) + 0.001 < this.bet) {
      this.scene.start('Lobby', {
        tab: 'promo',
        notice: 'Saldo insuficiente para este jogo. A aposta minima e R$ 30,00.',
      });
      return;
    }
    this.scene.start('Game', { bet: this.bet });
  }

  _goLobby(notice = '') {
    this.scene.start('Lobby', {
      balance: walletState.balance,
      notice,
    });
  }

  _stopRoundTimers() {
    this.roundTimers.forEach((timer) => timer?.destroy());
    this.roundTimers = [];
    if (this.startTimeout) {
      this.startTimeout.destroy();
      this.startTimeout = null;
    }
  }

  _clearCashoutTimeout() {
    if (this.cashoutTimeout) {
      this.cashoutTimeout.destroy();
      this.cashoutTimeout = null;
    }
  }

  _finishSocket() {
    if (!this.ws) return;
    this.ws.onopen = null;
    this.ws.onmessage = null;
    this.ws.onerror = null;
    this.ws.onclose = null;
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close();
    }
    this.ws = null;
  }

  _cleanup() {
    this._stopRoundTimers();
    this._clearCashoutTimeout();
    this._finishSocket();
    if (this._preventTouchMove && this.game?.canvas) {
      this.game.canvas.removeEventListener('touchmove', this._preventTouchMove);
      this._preventTouchMove = null;
    }
    this.obstacles.forEach((item) => item.destroy());
    this.treasures.forEach((item) => item.destroy());
    this.obstacles = [];
    this.treasures = [];
  }

  _updateAmbient(time, dt, activeVisual) {
    const lift = activeVisual ? 1 : 0.28;
    this.ambientBubbles.forEach((bubble) => {
      bubble.obj.y -= bubble.vy * dt * lift;
      bubble.obj.x += Math.sin(time / 600 + bubble.phase) * bubble.sway * 0.06;
      if (bubble.obj.y < -14) {
        bubble.obj.x = Phaser.Math.Between(0, W);
        bubble.obj.y = H + 18;
      }
    });

    if ([ROUND_STATES.PLAYING, ROUND_STATES.SHARK_WARNING].includes(this.roundState)) {
      this.bubbleAccumulator += dt * 1000;
      if (this.bubbleAccumulator > MERMAID_GAME_CONFIG.bubbleTrailIntervalMs) {
        this.bubbleAccumulator = 0;
        this._emitBubbleTrail(this.player.container.x, this.player.container.y + 28);
      }
    }
  }

  _emitBubbleTrail(x, y) {
    const bubble = this.add.circle(
      x + Phaser.Math.Between(-18, 18),
      y + Phaser.Math.Between(0, 14),
      Phaser.Math.Between(2, 6),
      0x8fffe7,
      0.36
    ).setDepth(36);
    this.tweens.add({
      targets: bubble,
      x: bubble.x + Phaser.Math.Between(-20, 20),
      y: bubble.y - Phaser.Math.Between(36, 72),
      alpha: 0,
      scale: 0.25,
      duration: this.reducedMotion ? 360 : Phaser.Math.Between(460, 780),
      ease: 'Sine.easeOut',
      onComplete: () => bubble.destroy(),
    });
  }

  _emitImpact(x, y) {
    const count = MERMAID_GAME_CONFIG.impactParticleCount;
    for (let i = 0; i < count; i++) {
      const particle = this.add.circle(x, y, Phaser.Math.Between(2, 5), 0xff9da5, 0.75).setDepth(80);
      const angle = (Math.PI * 2 / count) * i;
      const dist = Phaser.Math.Between(28, 68);
      this.tweens.add({
        targets: particle,
        x: x + Math.cos(angle) * dist,
        y: y + Math.sin(angle) * dist,
        alpha: 0,
        scale: 0.3,
        duration: this.reducedMotion ? 260 : 420,
        ease: 'Cubic.easeOut',
        onComplete: () => particle.destroy(),
      });
    }
  }

  _emitTreasureBurst(x, y) {
    const count = MERMAID_GAME_CONFIG.treasureParticleCount;
    for (let i = 0; i < count; i++) {
      const gem = this.add.graphics().setDepth(78);
      gem.fillStyle(i % 2 ? 0xffdf72 : 0x8fffe7, 0.84);
      gem.fillTriangle(0, -7, 7, 0, 0, 8);
      gem.fillTriangle(0, -7, 0, 8, -7, 0);
      gem.x = x;
      gem.y = y;
      const angle = (Math.PI * 2 / count) * i;
      const dist = Phaser.Math.Between(36, 82);
      this.tweens.add({
        targets: gem,
        x: x + Math.cos(angle) * dist,
        y: y + Math.sin(angle) * dist,
        alpha: 0,
        scale: 0.35,
        rotation: Phaser.Math.FloatBetween(-1.4, 1.4),
        duration: this.reducedMotion ? 280 : 560,
        ease: 'Cubic.easeOut',
        onComplete: () => gem.destroy(),
      });
    }
  }

  _emitCashoutShower() {
    if (this.reducedMotion) return;
    for (let i = 0; i < MERMAID_GAME_CONFIG.cashoutParticleCount; i++) {
      this.time.delayedCall(i * 28, () => {
        const x = Phaser.Math.Between(34, W - 34);
        const coin = this.add.graphics().setDepth(136);
        coin.fillStyle(0xffdf72, 0.92);
        coin.fillCircle(0, 0, Phaser.Math.Between(5, 9));
        coin.lineStyle(1, 0xffffff, 0.5);
        coin.strokeCircle(0, 0, 9);
        coin.x = x;
        coin.y = -20;
        this.tweens.add({
          targets: coin,
          y: H + 26,
          x: x + Phaser.Math.Between(-44, 44),
          rotation: Phaser.Math.FloatBetween(-3, 3),
          duration: Phaser.Math.Between(850, 1280),
          ease: 'Sine.easeIn',
          onComplete: () => coin.destroy(),
        });
      });
    }
  }

  _makeOverlayButton(x, y, width, height, text, handler) {
    const bg = this.add.graphics();
    bg.fillGradientStyle(0xffdf72, 0xffdf72, 0x25e0a7, 0x25e0a7, 1);
    bg.fillRoundedRect(x - width / 2, y - height / 2, width, height, 8);
    bg.lineStyle(2, 0xffffff, 0.42);
    bg.strokeRoundedRect(x - width / 2, y - height / 2, width, height, 8);
    const label = this.add.text(x, y, text, {
      fontSize: '17px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#102112',
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

  _haptic(pattern) {
    if (!window.navigator?.vibrate) return;
    try {
      window.navigator.vibrate(pattern);
    } catch {
      // Some mobile browsers expose vibrate but ignore calls.
    }
  }
}
