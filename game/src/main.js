import Phaser from 'phaser';
import { W, H } from './config.js';
import BootScene from './scenes/BootScene.js';
import AuthScene from './scenes/AuthScene.js';
import LobbyScene from './scenes/LobbyScene.js';
import MenuScene from './scenes/MenuScene.js';
import GameScene from './scenes/GameScene.js';
import { clearSession, hasValidSession, markSessionActivity } from './services/api.js';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: W,
  height: H,
  parent: 'game',
  backgroundColor: '#000510',
  scene: [BootScene, AuthScene, LobbyScene, MenuScene, GameScene],
  resolution: Math.min(Math.max(window.devicePixelRatio || 1, 2), 3),
  antialias: true,
  render: {
    antialias: true,
    antialiasGL: true,
    pixelArt: false,
    roundPixels: false
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  fps: { target: 60 }
});

function refreshScale() {
  if (game?.scale) {
    game.scale.refresh();
  }
}

window.addEventListener('resize', refreshScale, { passive: true });
window.addEventListener('orientationchange', () => {
  window.setTimeout(refreshScale, 140);
}, { passive: true });
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', refreshScale, { passive: true });
  window.visualViewport.addEventListener('scroll', refreshScale, { passive: true });
}

function forceLoginWhenSessionExpires() {
  if (game.scene.isActive('Auth')) return;
  if (hasValidSession()) return;

  clearSession();
  ['Game', 'Menu', 'Lobby'].forEach((key) => {
    if (game.scene.isActive(key)) game.scene.stop(key);
  });
  game.scene.start('Auth');
}

['pointerdown', 'touchstart', 'keydown'].forEach((eventName) => {
  window.addEventListener(eventName, markSessionActivity, { passive: true });
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) forceLoginWhenSessionExpires();
});
window.addEventListener('focus', forceLoginWhenSessionExpires);
window.addEventListener('pageshow', forceLoginWhenSessionExpires);
window.setInterval(forceLoginWhenSessionExpires, 60 * 1000);
