import Phaser from 'phaser';
import './brand.css';
import { BRAND, BRAND_COLORS } from './brand.js';
import { W, H } from './config.js';
import BootScene from './scenes/BootScene.js';
import AuthScene from './scenes/AuthScene.js';
import LobbyScene from './scenes/LobbyScene.js';
import AdminDashboardScene from './scenes/AdminDashboardScene.js';
import MenuScene from './scenes/MenuScene.js';
import GameScene from './scenes/GameScene.js';
import { clearSession, hasValidSession, initAcquisitionTracking, markSessionActivity } from './services/api.js';

initAcquisitionTracking();
document.title = BRAND.name;

const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: W,
  height: H,
  parent: 'game',
  backgroundColor: BRAND_COLORS.background,
  scene: [BootScene, AuthScene, LobbyScene, AdminDashboardScene, MenuScene, GameScene],
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
  if (window.syncAppViewport) {
    window.syncAppViewport();
  }
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
}

function forceLoginWhenSessionExpires({ allowDuringGame = false } = {}) {
  const authenticatedScenes = ['Game', 'Menu', 'Lobby', 'AdminDashboard'];
  if (!authenticatedScenes.some((key) => game.scene.isActive(key))) return;
  if (game.scene.isActive('Auth')) return;
  if (game.scene.isActive('Game') && !allowDuringGame) return;
  if (hasValidSession()) return;

  clearSession();
  authenticatedScenes.forEach((key) => {
    if (game.scene.isActive(key)) game.scene.stop(key);
  });
  game.scene.start('Auth');
}

['pointerdown', 'touchstart', 'keydown'].forEach((eventName) => {
  window.addEventListener(eventName, markSessionActivity, { passive: true });
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) forceLoginWhenSessionExpires({ allowDuringGame: true });
});
window.addEventListener('focus', () => forceLoginWhenSessionExpires({ allowDuringGame: true }));
window.addEventListener('pageshow', () => forceLoginWhenSessionExpires({ allowDuringGame: true }));
window.setInterval(forceLoginWhenSessionExpires, 60 * 1000);
