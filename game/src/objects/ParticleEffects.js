import Phaser from 'phaser';
import { W, H } from '../config.js';

export default class ParticleEffects {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];
  }

  // Create bubble behind mermaid tail
  emitBubbleTrail(x, y) {
    const b = this.scene.add.circle(
      x - 24 + Phaser.Math.Between(-4, 4),
      y + Phaser.Math.Between(-6, 6),
      Phaser.Math.Between(2, 6),
      0x77ccff,
      0.4
    );
    this.scene.tweens.add({
      targets: b,
      x: b.x - 30,
      y: b.y + Phaser.Math.Between(-15, -45),
      alpha: 0,
      scale: 0.2,
      duration: Phaser.Math.Between(400, 800),
      onComplete: () => b.destroy()
    });
  }

  // Sparkle burst when collecting a gem
  emitGemBurst(x, y) {
    const sparkles = ['?', '??', '?'];
    for (let i = 0; i < 8; i++) {
      const char = Phaser.Utils.Array.GetRandom(sparkles);
      const txt = this.scene.add.text(x, y, char, { fontSize: '18px' }).setOrigin(0.5);
      const angle = (Math.PI * 2 / 8) * i;
      const dist = Phaser.Math.Between(35, 75);

      this.scene.tweens.add({
        targets: txt,
        x: x + Math.cos(angle) * dist,
        y: y + Math.sin(angle) * dist,
        alpha: 0,
        scale: 0.4,
        duration: 500,
        ease: 'Cubic.easeOut',
        onComplete: () => txt.destroy()
      });
    }
  }

  // Coin shower on Cashout win
  emitCashoutShower() {
    const items = ['??', '??', '??', '??', '?'];
    for (let i = 0; i < 24; i++) {
      this.scene.time.delayedCall(i * 35, () => {
        const char = Phaser.Utils.Array.GetRandom(items);
        const itemX = Phaser.Math.Between(30, W - 30);
        const txt = this.scene.add.text(itemX, -20, char, { fontSize: '24px' }).setOrigin(0.5);
        
        this.scene.tweens.add({
          targets: txt,
          y: H + 30,
          x: itemX + Phaser.Math.Between(-40, 40),
          rotation: Phaser.Math.FloatBetween(-2, 2),
          duration: Phaser.Math.Between(800, 1400),
          ease: 'Sine.easeIn',
          onComplete: () => txt.destroy()
        });
      });
    }
  }
}
