import Phaser from 'phaser';
import { BRAND } from '../brand.js';
import { W, H } from '../config.js';
import { getAuthToken } from '../services/api.js';

export default class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'Boot' });
  }

  create() {
    this.add.text(W / 2, H / 2 - 18, BRAND.upperName, {
      fontFamily: 'Arial, sans-serif',
      fontSize: '26px',
      fontStyle: 'bold',
      color: '#f4f7ff'
    }).setOrigin(0.5);
    this.add.text(W / 2, H / 2 + 20, 'Preparando os blocos...', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '13px',
      color: '#a3aecb'
    }).setOrigin(0.5);

    this.time.delayedCall(500, () => {
      this.scene.start(getAuthToken() ? 'Lobby' : 'Auth');
    });
  }
}
