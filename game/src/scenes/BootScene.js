import Phaser from 'phaser';
import { W, H } from '../config.js';
import { getAuthToken } from '../services/api.js';

export default class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'Boot' });
  }

  create() {
    const text = this.add.text(W / 2, H / 2, 'Carregando...', {
      fontSize: '24px',
      color: '#ffffff'
    }).setOrigin(0.5);

    this.time.delayedCall(500, () => {
      this.scene.start(getAuthToken() ? 'Lobby' : 'Auth');
    });
  }
}
