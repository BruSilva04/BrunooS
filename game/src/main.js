import Phaser from 'phaser';
import { W, H } from './config.js';
import BootScene from './scenes/BootScene.js';
import AuthScene from './scenes/AuthScene.js';
import LobbyScene from './scenes/LobbyScene.js';
import MenuScene from './scenes/MenuScene.js';
import GameScene from './scenes/GameScene.js';

new Phaser.Game({
  type: Phaser.AUTO,
  width: W,
  height: H,
  parent: 'game',
  backgroundColor: '#000510',
  scene: [BootScene, AuthScene, LobbyScene, MenuScene, GameScene],
  resolution: Math.min(window.devicePixelRatio || 1, 2),
  antialias: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  fps: { target: 60 }
});
