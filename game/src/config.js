export const W = 390;

function getMobileHeight() {
  if (typeof window === 'undefined') return 760;

  const viewport = window.visualViewport || window;
  const width = Math.max(1, viewport.width || window.innerWidth || W);
  const height = Math.max(1, viewport.height || window.innerHeight || 760);
  const ratio = clamp(height / width, 1.74, 2.24);

  return Math.round(W * ratio);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export const H = getMobileHeight();
export const BETS = [2, 5, 10, 20, 50];
export const GRAVITY = 880;
export const FLAP = -430;
export const OBS_DELAY_START = 2000;
export const GEM_DELAY = 800;
export const MULT_TICK = 0.012;
export const GEM_BONUS = 0.07;

const runtimeHost = window.location.hostname || 'localhost';
const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';

function normalizeEnvUrl(value, envName) {
  const rawValue = String(value || '').trim();
  const assignmentPrefix = `${envName}=`;
  const url = rawValue.startsWith(assignmentPrefix)
    ? rawValue.slice(assignmentPrefix.length).trim()
    : rawValue;

  return url.replace(/\/+$/, '');
}

export const API_URL = normalizeEnvUrl(
  import.meta.env.VITE_API_URL,
  'VITE_API_URL'
) || `${window.location.protocol}//${runtimeHost}:8000`;

export const WS_URL = normalizeEnvUrl(
  import.meta.env.VITE_WS_URL,
  'VITE_WS_URL'
) || `${wsProtocol}://${runtimeHost}:8000/ws/game`;

// Global Wallet & iGaming History State
export const state = {
  balance: 250.00,
  history: [1.28, 2.14, 1.03, 5.76, 1.92]
};

export function addHistory(mult) {
  state.history.unshift(mult);
  if (state.history.length > 5) {
    state.history.pop();
  }
}
