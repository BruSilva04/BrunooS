import Phaser from 'phaser';
import { H, W, MERMAID_GAME_CONFIG } from '../config.js';

export function laneToX(lane, z) {
  const progress = Phaser.Math.Clamp(1 - z, 0, 1);
  const spread = Phaser.Math.Linear(20, 124, progress);
  return W / 2 + lane * spread;
}

export function trackY(z) {
  const horizon = H * MERMAID_GAME_CONFIG.horizonYRatio;
  const playerY = H * MERMAID_GAME_CONFIG.playerYRatio;
  const progress = Phaser.Math.Clamp(1 - z, 0, 1);
  return horizon + (playerY - horizon) * Math.pow(progress, 1.62);
}

export function objectScale(z) {
  const progress = Phaser.Math.Clamp(1 - z, 0, 1);
  return Phaser.Math.Linear(0.18, 1.08, progress);
}

export class RunnerMermaid {
  constructor(scene) {
    this.scene = scene;
    this.lane = 0;
    this.targetLane = 0;
    this.visualLane = 0;
    this.verticalOffset = 0;
    this.dodgeAction = null;
    this.dodgeUntil = 0;
    this.animState = 'IDLE';
    this.hitRadius = 24;
    this.baseScale = 1.12;
    this.container = scene.add.container(W / 2, H * MERMAID_GAME_CONFIG.playerYRatio).setDepth(40);
    this.container.setScale(this.baseScale);
    this.aura = scene.add.graphics();
    this.body = scene.add.graphics();
    this.tail = scene.add.graphics();
    this.hair = scene.add.graphics();
    this.container.add([this.aura, this.tail, this.body, this.hair]);
    this._draw();
  }

  moveLane(direction) {
    const nextLane = Phaser.Math.Clamp(this.targetLane + direction, -1, 1);
    if (nextLane === this.targetLane) return false;
    this.targetLane = nextLane;
    this.lane = nextLane;
    this.animState = direction < 0 ? 'DODGE_LEFT' : 'DODGE_RIGHT';
    this.scene.tweens.add({
      targets: this,
      visualLane: nextLane,
      duration: MERMAID_GAME_CONFIG.laneChangeDurationMs,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        if (this.animState === 'DODGE_LEFT' || this.animState === 'DODGE_RIGHT') {
          this.animState = 'SWIM';
        }
      },
    });
    this._pulse(0x8fffe7);
    return true;
  }

  dodge(action) {
    this.dodgeAction = action;
    this.dodgeUntil = this.scene.time.now + MERMAID_GAME_CONFIG.dodgeDurationMs;
    this.animState = action === 'up' ? 'DODGE_UP' : 'DODGE_DOWN';
    const offset = action === 'up' ? -54 : 46;
    this.scene.tweens.add({
      targets: this,
      verticalOffset: offset,
      duration: 110,
      ease: 'Cubic.easeOut',
      yoyo: true,
      hold: 120,
      onComplete: () => {
        this.verticalOffset = 0;
        this.dodgeAction = null;
        if (this.animState === 'DODGE_UP' || this.animState === 'DODGE_DOWN') {
          this.animState = 'SWIM';
        }
      },
    });
    this._pulse(action === 'up' ? 0xffdf72 : 0x65d3ff);
  }

  hit() {
    this.animState = 'HIT';
    this._pulse(0xff6675);
    this.scene.tweens.add({
      targets: this.container,
      angle: { from: -6, to: 0 },
      duration: 360,
      ease: 'Back.easeOut',
    });
  }

  cashout() {
    this.animState = 'CASHOUT';
    this._pulse(0xffdf72);
    this.scene.tweens.add({
      targets: this.container,
      scale: { from: this.baseScale * 1.12, to: this.baseScale },
      duration: 320,
      ease: 'Back.easeOut',
    });
  }

  update(time) {
    if (this.dodgeAction && time > this.dodgeUntil) {
      this.dodgeAction = null;
      this.verticalOffset = 0;
    }
    const bob = Math.sin(time / 170) * 4;
    const sway = Math.sin(time / 260) * 2;
    this.container.x = laneToX(this.visualLane, 0);
    this.container.y = H * MERMAID_GAME_CONFIG.playerYRatio + this.verticalOffset + bob;
    this.container.angle = (this.visualLane - this.targetLane) * -8 + sway;
    this.tail.angle = Math.sin(time / 110) * 7;
    this.hair.angle = Math.sin(time / 160) * -3;
    this.aura.alpha = 0.74 + Math.sin(time / 180) * 0.18;
  }

  _draw() {
    this.aura.clear();
    this.aura.fillStyle(0x6fffe9, 0.16);
    this.aura.fillEllipse(0, 0, 112, 134);
    this.aura.lineStyle(2, 0xffdf72, 0.12);
    this.aura.strokeEllipse(0, 0, 78, 108);

    this.tail.clear();
    this.tail.fillGradientStyle(0x73ffe8, 0x73ffe8, 0x087a9c, 0x0f3867, 1);
    this.tail.fillTriangle(-13, 6, 17, 8, 4, 78);
    this.tail.fillStyle(0x12b9aa, 0.96);
    this.tail.fillTriangle(-17, 23, -45, 48, -5, 36);
    this.tail.fillTriangle(18, 24, 45, 50, 7, 37);
    this.tail.fillStyle(0x98ffe5, 0.98);
    this.tail.fillTriangle(3, 72, -35, 101, -6, 79);
    this.tail.fillTriangle(4, 72, 36, 101, 10, 78);
    this.tail.lineStyle(2, 0xd7fff8, 0.48);
    this.tail.lineBetween(-5, 20, 1, 70);
    this.tail.lineBetween(8, 22, 5, 72);

    this.body.clear();
    this.body.fillStyle(0xf8c4b8, 1);
    this.body.fillEllipse(0, -32, 34, 48);
    this.body.fillStyle(0xf6b4aa, 1);
    this.body.fillEllipse(-20, -15, 12, 34);
    this.body.fillEllipse(20, -15, 12, 34);
    this.body.fillGradientStyle(0xff86b8, 0xff86b8, 0x8a36b6, 0x50237d, 1);
    this.body.fillRoundedRect(-20, -21, 40, 43, 13);
    this.body.fillStyle(0xffdf72, 0.9);
    this.body.fillCircle(-9, -14, 6);
    this.body.fillCircle(9, -14, 6);
    this.body.lineStyle(2, 0xffdf72, 0.72);
    this.body.strokeRoundedRect(-20, -21, 40, 43, 13);
    this.body.lineStyle(3, 0xf6b4aa, 0.8);
    this.body.lineBetween(-17, -18, -35, 5);
    this.body.lineBetween(17, -18, 35, 5);
    this.body.fillStyle(0xffffff, 0.22);
    this.body.fillEllipse(-7, -30, 7, 18);
    this.body.fillStyle(0xffdf72, 1);
    this.body.fillCircle(-11, -55, 3);
    this.body.fillCircle(0, -60, 4);
    this.body.fillCircle(11, -55, 3);
    this.body.lineStyle(2, 0xffdf72, 0.82);
    this.body.lineBetween(-13, -53, 0, -60);
    this.body.lineBetween(13, -53, 0, -60);

    this.hair.clear();
    this.hair.fillGradientStyle(0x7b184c, 0x7b184c, 0x2b0827, 0x2b0827, 1);
    this.hair.fillEllipse(0, -60, 54, 40);
    this.hair.fillEllipse(-20, -40, 18, 54);
    this.hair.fillEllipse(20, -42, 16, 48);
    this.hair.fillStyle(0xf8c4b8, 1);
    this.hair.fillCircle(0, -58, 22);
    this.hair.fillStyle(0x1c0615, 0.88);
    this.hair.fillEllipse(-7, -61, 3, 5);
    this.hair.fillEllipse(8, -61, 3, 5);
    this.hair.lineStyle(2, 0x8a184f, 0.55);
    this.hair.lineBetween(-16, -73, -2, -78);
    this.hair.lineBetween(2, -78, 18, -72);
    this.hair.fillStyle(0xffd6d0, 0.9);
    this.hair.fillCircle(0, -53, 2);
  }

  _pulse(color) {
    const ring = this.scene.add.circle(this.container.x, this.container.y, 54, color, 0.18).setDepth(39);
    this.scene.tweens.add({
      targets: ring,
      scale: 1.7,
      alpha: 0,
      duration: 360,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });
  }

  destroy() {
    this.container.destroy(true);
  }
}

export class RunnerShark {
  constructor(scene) {
    this.scene = scene;
    this.distance = MERMAID_GAME_CONFIG.sharkSafeDistance;
    this.targetDistance = this.distance;
    this.container = scene.add.container(W / 2, H + 72).setDepth(28);
    this.shadow = scene.add.graphics();
    this.body = scene.add.graphics();
    this.container.add([this.shadow, this.body]);
    this._draw();
  }

  setDistance(value) {
    this.targetDistance = Phaser.Math.Clamp(value, 0, 1);
  }

  update(dt, time) {
    this.distance = Phaser.Math.Linear(this.distance, this.targetDistance, 1 - Math.pow(0.001, dt));
    const danger = 1 - this.distance;
    const y = Phaser.Math.Linear(H + 86, H * 0.80, danger);
    const scale = Phaser.Math.Linear(0.62, 1.32, danger);
    this.container.setPosition(W / 2 + Math.sin(time / 230) * 8 * danger, y);
    this.container.setScale(scale);
    this.body.alpha = Phaser.Math.Linear(0.44, 0.92, danger);
    this.shadow.alpha = Phaser.Math.Linear(0.08, 0.30, danger);
  }

  bite() {
    this.scene.tweens.add({
      targets: this.container,
      y: H * 0.72,
      scale: 1.62,
      duration: 260,
      ease: 'Cubic.easeIn',
    });
  }

  _draw() {
    this.shadow.clear();
    this.shadow.fillStyle(0x000000, 0.32);
    this.shadow.fillEllipse(0, 26, 162, 52);

    this.body.clear();
    this.body.fillGradientStyle(0x23495c, 0x23495c, 0x071824, 0x071824, 1);
    this.body.fillEllipse(0, 0, 156, 58);
    this.body.fillStyle(0x0b2532, 1);
    this.body.fillTriangle(-72, -4, -122, -36, -104, 18);
    this.body.fillTriangle(22, -28, 48, -78, 64, -24);
    this.body.fillStyle(0xd7fbff, 0.95);
    this.body.fillTriangle(42, 18, 50, 30, 58, 18);
    this.body.fillTriangle(58, 17, 66, 30, 74, 16);
    this.body.fillStyle(0xff6675, 1);
    this.body.fillCircle(50, -10, 4);
  }

  destroy() {
    this.container.destroy(true);
  }
}

export class RunnerObstacle {
  constructor(scene, data) {
    this.scene = scene;
    this.id = data.id;
    this.lane = data.lane;
    this.z = data.z;
    this.type = data.type;
    this.resolved = false;
    this.container = scene.add.container(0, 0).setDepth(24);
    this.shadow = scene.add.graphics();
    this.graphics = scene.add.graphics();
    this.label = scene.add.text(0, -42, this._avoidLabel(), {
      fontSize: '11px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#fff7dc',
      stroke: '#06111a',
      strokeThickness: 3,
    }).setOrigin(0.5);
    this.container.add([this.shadow, this.graphics, this.label]);
    this._draw();
    this.update(0);
  }

  _avoidLabel() {
    if (this.type.avoid === 'up') return 'SUBA';
    if (this.type.avoid === 'down') return 'MERGULHE';
    return this.type.severity === 'hard' ? 'DESVIE' : 'MUDE';
  }

  _draw() {
    const c = this.type.color;
    const a = this.type.accent;
    const hard = this.type.severity === 'hard';
    this.shadow.clear();
    this.shadow.fillStyle(hard ? 0xff334a : 0x8fffe7, hard ? 0.18 : 0.12);
    this.shadow.fillEllipse(0, 20, 96, 46);
    this.shadow.lineStyle(2, hard ? 0xffdf72 : 0xd7fbff, hard ? 0.28 : 0.18);
    this.shadow.strokeEllipse(0, 20, 106, 52);

    this.graphics.clear();

    if (this.type.key === 'JELLYFISH') {
      this.graphics.fillStyle(c, 0.90);
      this.graphics.fillEllipse(0, -11, 66, 44);
      this.graphics.fillStyle(0xffffff, 0.24);
      this.graphics.fillEllipse(-10, -20, 22, 10);
      this.graphics.lineStyle(3, a, 0.65);
      [-22, -9, 6, 21].forEach((x) => {
        this.graphics.beginPath();
        this.graphics.moveTo(x, 8);
        this.graphics.lineTo(x - 8, 42);
        this.graphics.strokePath();
      });
      return;
    }

    if (this.type.key === 'ANCHOR') {
      this.graphics.lineStyle(8, c, 0.98);
      this.graphics.lineBetween(0, -52, 0, 24);
      this.graphics.lineBetween(-33, 22, 33, 22);
      this.graphics.strokeCircle(0, -56, 9);
      this.graphics.lineStyle(4, a, 0.72);
      this.graphics.strokeCircle(0, 24, 31);
      this.graphics.fillStyle(0xffdf72, 0.8);
      this.graphics.fillCircle(0, -9, 4);
      return;
    }

    if (this.type.key === 'TENTACLE') {
      this.graphics.lineStyle(15, c, 0.94);
      this.graphics.beginPath();
      this.graphics.moveTo(-38, 48);
      this.graphics.quadraticCurveTo(-8, 2, 30, -23);
      this.graphics.strokePath();
      this.graphics.fillStyle(a, 0.8);
      this.graphics.fillCircle(10, 6, 4);
      this.graphics.fillCircle(-4, 22, 3);
      return;
    }

    if (this.type.key === 'FISH_SCHOOL') {
      [-28, -4, 25, 13, -15].forEach((x, index) => {
        const y = -18 + index * 10;
        this.graphics.fillStyle(index % 2 ? c : a, 0.86);
        this.graphics.fillEllipse(x, y, 30, 14);
        this.graphics.fillTriangle(x - 16, y, x - 28, y - 9, x - 28, y + 9);
        this.graphics.fillStyle(0x06111a, 0.65);
        this.graphics.fillCircle(x + 8, y - 2, 2);
      });
      return;
    }

    if (this.type.key === 'COLUMN') {
      this.graphics.fillGradientStyle(c, c, 0x3d2f29, 0x3d2f29, 1);
      this.graphics.fillRoundedRect(-31, -62, 62, 124, 8);
      this.graphics.fillStyle(a, 0.70);
      this.graphics.fillRect(-38, -66, 76, 13);
      this.graphics.fillRect(-38, 53, 76, 13);
      this.graphics.lineStyle(2, 0xffffff, 0.18);
      this.graphics.lineBetween(-14, -48, -14, 44);
      this.graphics.lineBetween(14, -48, 14, 44);
      return;
    }

    if (this.type.key === 'SEA_MINE') {
      this.graphics.fillStyle(c, 0.96);
      this.graphics.fillCircle(0, 0, 37);
      this.graphics.fillStyle(0xff7181, 0.22);
      this.graphics.fillCircle(-9, -12, 15);
      this.graphics.lineStyle(4, a, 0.86);
      for (let i = 0; i < 8; i++) {
        const angle = (Math.PI * 2 / 8) * i;
        this.graphics.lineBetween(Math.cos(angle) * 31, Math.sin(angle) * 31, Math.cos(angle) * 51, Math.sin(angle) * 51);
      }
      return;
    }

    if (this.type.key === 'SHIP_WRECK') {
      this.graphics.fillStyle(c, 0.96);
      this.graphics.fillRoundedRect(-48, -20, 96, 52, 8);
      this.graphics.fillStyle(0x2a1510, 0.72);
      this.graphics.fillRect(-34, -6, 68, 9);
      this.graphics.lineStyle(4, a, 0.66);
      this.graphics.lineBetween(-40, -22, 30, -52);
      this.graphics.lineBetween(8, -50, 52, -12);
      return;
    }

    if (this.type.key === 'CORAL') {
      this.graphics.lineStyle(11, c, 0.96);
      this.graphics.lineBetween(0, 50, 0, -34);
      this.graphics.lineBetween(0, 7, -31, -20);
      this.graphics.lineBetween(0, 20, 33, -6);
      this.graphics.lineStyle(4, a, 0.62);
      this.graphics.lineBetween(-31, -20, -40, -38);
      this.graphics.lineBetween(33, -6, 45, -22);
      return;
    }

    this.graphics.fillGradientStyle(c, c, 0x14232c, 0x14232c, 1);
    this.graphics.fillRoundedRect(-42, -36, 84, 72, 14);
    this.graphics.lineStyle(3, a, 0.52);
    this.graphics.strokeRoundedRect(-42, -36, 84, 72, 14);
  }

  update(time) {
    const scale = objectScale(this.z);
    this.container.setPosition(laneToX(this.lane, this.z), trackY(this.z));
    this.container.setScale(scale);
    this.container.setDepth(18 + Math.round((1 - this.z) * 20));
    this.container.angle = Math.sin(time / 260 + this.lane) * 2;
    this.label.setVisible(this.z < 0.42 && this.z > 0.02);
  }

  shouldResolve() {
    return !this.resolved && this.z <= 0.07 && this.z >= -0.035;
  }

  isOffscreen() {
    return this.z < -0.16;
  }

  destroy() {
    this.container.destroy(true);
  }
}

export class RunnerTreasure {
  constructor(scene, data) {
    this.scene = scene;
    this.id = data.id;
    this.lane = data.lane;
    this.z = data.z;
    this.resolved = false;
    this.container = scene.add.container(0, 0).setDepth(20);
    this.glow = scene.add.graphics();
    this.gem = scene.add.graphics();
    this.container.add([this.glow, this.gem]);
    this._draw();
    this.update(0);
  }

  _draw() {
    this.glow.clear();
    this.glow.fillStyle(0xffdf72, 0.20);
    this.glow.fillCircle(0, 0, 38);

    this.gem.clear();
    this.gem.fillGradientStyle(0xd7fbff, 0xd7fbff, 0x37d9ff, 0x0d7490, 1);
    this.gem.fillTriangle(0, -30, 28, 0, 0, 34);
    this.gem.fillTriangle(0, -30, 0, 34, -28, 0);
    this.gem.lineStyle(2, 0xffffff, 0.65);
    this.gem.strokeTriangle(0, -30, 28, 0, 0, 34);
    this.gem.strokeTriangle(0, -30, 0, 34, -28, 0);
  }

  update(time) {
    const scale = objectScale(this.z) * 0.78;
    this.container.setPosition(laneToX(this.lane, this.z), trackY(this.z) - 20 * scale);
    this.container.setScale(scale);
    this.container.setDepth(22 + Math.round((1 - this.z) * 18));
    this.container.angle = Math.sin(time / 180) * 9;
    this.glow.alpha = 0.68 + Math.sin(time / 150) * 0.22;
  }

  shouldCollect(playerLane, action) {
    return !this.resolved && this.lane === playerLane && this.z <= 0.11 && this.z >= -0.08 && action !== 'down';
  }

  isOffscreen() {
    return this.z < -0.16;
  }

  destroy() {
    this.container.destroy(true);
  }
}
