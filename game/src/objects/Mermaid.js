import Phaser from 'phaser';
import { H, FLAP, GRAVITY } from '../config.js';

export default class Mermaid {
  constructor(scene) {
    this.scene = scene;
    this.trail = [];
    this.glow = scene.add.circle(75, H / 2, 30, 0x6fffe9, 0.16);
    this.sprite = scene.add.text(75, H / 2, '🧜‍♀️', { fontSize: '42px' }).setOrigin(0.5);
    this.vy = 0;
  }

  flap() {
    this.vy = FLAP;
    this.scene.tweens.add({
      targets: this.glow,
      scale: { from: 1.25, to: 1 },
      alpha: { from: 0.28, to: 0.16 },
      duration: 220
    });
  }

  update(dt) {
    this.vy += GRAVITY * dt;
    this.sprite.y += this.vy * dt;
    this.sprite.setAngle(Phaser.Math.Clamp(this.vy * 0.04, -22, 40));

    this.glow.setPosition(this.sprite.x, this.sprite.y);
    this._spawnTrail();
    this._updateTrail(dt);
  }

  _spawnTrail() {
    if (this.scene.time.now % 4 > 1) return;

    const bubble = this.scene.add.circle(
      this.sprite.x - 26,
      this.sprite.y + Phaser.Math.Between(-12, 14),
      Phaser.Math.Between(3, 7),
      0xb6fff3,
      0.22
    );
    this.trail.push({ obj: bubble, life: 0.5 });
  }

  _updateTrail(dt) {
    for (let i = this.trail.length - 1; i >= 0; i--) {
      const item = this.trail[i];
      item.life -= dt;
      item.obj.x -= 34 * dt;
      item.obj.y -= 18 * dt;
      item.obj.setAlpha(Math.max(0, item.life * 0.38));
      if (item.life <= 0) {
        item.obj.destroy();
        this.trail.splice(i, 1);
      }
    }
  }

  isOutOfBounds() {
    return this.sprite.y < 92 || this.sprite.y > H - 104;
  }

  get x() {
    return this.sprite.x;
  }

  get y() {
    return this.sprite.y;
  }
}
