export const W = 390;
export const H = 680;
export const BETS = [2, 5, 10, 20, 50];
export const GRAVITY = 880;
export const FLAP = -430;
export const OBS_DELAY_START = 2000;
export const GEM_DELAY = 800;
export const MULT_TICK = 0.012;
export const GEM_BONUS = 0.07;
export const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8000/ws/game';

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
