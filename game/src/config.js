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
export const PLATFORM_MIN_DEPOSIT_CENTS = 2000;
export const MERMAID_MIN_BET_CENTS = 3000;
export const BETS = [30, 50, 100, 200, 500];
export const GRAVITY = 880;
export const FLAP = -430;
export const OBS_DELAY_START = 2000;
export const GEM_DELAY = 800;
export const MULT_TICK = 0.0085;
export const GEM_BONUS = 0.07;
export const CASHOUT_UNLOCK_MULT = 2.5;

export const ROUND_STATES = {
  IDLE: 'IDLE',
  BET_CONFIGURATION: 'BET_CONFIGURATION',
  READY: 'READY',
  COUNTDOWN: 'COUNTDOWN',
  PLAYING: 'PLAYING',
  HIT_STUN: 'HIT_STUN',
  SHARK_WARNING: 'SHARK_WARNING',
  CASHOUT_PENDING: 'CASHOUT_PENDING',
  CASHED_OUT: 'CASHED_OUT',
  LOST: 'LOST',
  ROUND_FINISHED: 'ROUND_FINISHED',
  ERROR: 'ERROR',
};

export const MERMAID_GAME_CONFIG = {
  minBetCents: MERMAID_MIN_BET_CENTS,
  lanes: [-1, 0, 1],
  laneChangeDurationMs: 190,
  dodgeDurationMs: 470,
  hitStunMs: 560,
  countdownStepMs: 620,
  multiplierPerSecond: 0.085,
  baseTravelSpeed: 0.255,
  maxTravelSpeed: 0.54,
  demoTravelSpeed: 0.285,
  spawnIntervalStartMs: 1320,
  spawnIntervalMinMs: 720,
  treasureIntervalMs: 930,
  depthPerSecond: 43,
  playerYRatio: 0.735,
  horizonYRatio: 0.185,
  cashoutUnlockMult: CASHOUT_UNLOCK_MULT,
  sharkSafeDistance: 1,
  sharkWarningDistance: 0.58,
  sharkDangerDistance: 0.25,
  sharkSoftPenalty: 0.34,
  sharkHardPenalty: 0.65,
  sharkRecoveryPerSecond: 0.15,
  softCollisionRecoveryMs: 1900,
  maxVisualObjects: 44,
  biomeThresholds: [
    { key: 'reef', label: 'RECIFE', depth: 0 },
    { key: 'wreck', label: 'NAUFRAGIO', depth: 100 },
    { key: 'ruins', label: 'RUINAS', depth: 300 },
    { key: 'abyss', label: 'ABISMO', depth: 600 },
  ],
};

export function moneyToCents(value) {
  return Math.round(Number(value || 0) * 100);
}

export function centsToMoney(cents) {
  return Number(cents || 0) / 100;
}

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
  balance: 0.00,
  history: []
};

export function addHistory(mult) {
  state.history.unshift(mult);
  if (state.history.length > 5) {
    state.history.pop();
  }
}
