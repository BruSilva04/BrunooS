import Phaser from 'phaser';
import { W, H } from '../config.js';

export default class Gem {
  constructor(scene) {
    this.scene = scene;
    const y = Phaser.Math.Between(116, H - 130);
    this.glow = scene.add.circle(W + 14, y, 18, 0xffdf6d, 0.16);
    this.sprite = scene.add.text(W + 14, y, '💎', { fontSize: '25px' }).setOrigin(0.5);
    this.spin = Phaser.Math.FloatBetween(-0.08, 0.08);

    scene.tweens.add({
      targets: this.glow,
      scale: 1.25,
      alpha: 0.28,
      yoyo: true,
      repeat: -1,
      duration: 700
    });
  }

  update(speed, dt) {
    this.sprite.x -= speed * dt;
    this.glow.x = this.sprite.x;
    this.glow.y = this.sprite.y;
    this.sprite.y += Math.sin(this.scene.time.now / 180) * this.spin;
    this.sprite.setAngle(Math.sin(this.scene.time.now / 260) * 8);
  }

  checkCollect(mermaidX, mermaidY) {
    return Math.abs(this.sprite.x - mermaidX) < 34 && Math.abs(this.sprite.y - mermaidY) < 34;
  }

  isOffScreen() {
    return this.sprite.x < -34;
  }

  destroy() {
    this.glow.destroy();
    this.sprite.destroy();
  }
}
