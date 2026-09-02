import Phaser from 'phaser';
import { W, H } from '../config.js';

export default class Obstacle {
  constructor(scene, gapY) {
    this.scene = scene;
    this.x = W + 34;
    this.GAP = 144;
    this.gapY = gapY;
    this.kind = Phaser.Utils.Array.GetRandom([
      { icon: '🦈', color: 0xff6675 },
      { icon: '🕸️', color: 0xb5d2ff },
      { icon: '🪤', color: 0xffc15a },
      { icon: '🦑', color: 0xd68cff }
    ]);

    this.topZone = scene.add.graphics();
    this.bottomZone = scene.add.graphics();
    this.top = scene.add.text(this.x, gapY - this.GAP / 2 - 34, this.kind.icon, { fontSize: '38px' }).setOrigin(0.5);
    this.bot = scene.add.text(this.x, gapY + this.GAP / 2 + 34, this.kind.icon, { fontSize: '38px' }).setOrigin(0.5);
    this._paint();
  }

  _paint() {
    const width = 56;
    const topH = Math.max(92, this.gapY - this.GAP / 2);
    const botY = this.gapY + this.GAP / 2;
    const bottomH = Math.max(0, H - 104 - botY);

    this.topZone.clear();
    this.topZone.fillStyle(this.kind.color, 0.09);
    this.topZone.fillRoundedRect(this.x - width / 2, 92, width, Math.max(0, topH - 92), 8);
    this.topZone.lineStyle(1, this.kind.color, 0.28);
    this.topZone.strokeRoundedRect(this.x - width / 2, 92, width, Math.max(0, topH - 92), 8);

    this.bottomZone.clear();
    this.bottomZone.fillStyle(this.kind.color, 0.09);
    this.bottomZone.fillRoundedRect(this.x - width / 2, botY, width, bottomH, 8);
    this.bottomZone.lineStyle(1, this.kind.color, 0.28);
    this.bottomZone.strokeRoundedRect(this.x - width / 2, botY, width, bottomH, 8);
  }

  update(speed, dt) {
    this.x -= speed * dt;
    this.top.x = this.x;
    this.bot.x = this.x;
    this.top.setAngle(Math.sin(this.scene.time.now / 260) * 5);
    this.bot.setAngle(Math.sin(this.scene.time.now / 260 + 1) * -5);
    this._paint();
  }

  checkCollision(mermaidX, mermaidY) {
    if (Math.abs(this.x - mermaidX) < 28) {
      const inGap = mermaidY > this.gapY - this.GAP / 2 && mermaidY < this.gapY + this.GAP / 2;
      return !inGap;
    }
    return false;
  }

  isOffScreen() {
    return this.x < -70;
  }

  destroy() {
    this.topZone.destroy();
    this.bottomZone.destroy();
    this.top.destroy();
    this.bot.destroy();
  }
}
