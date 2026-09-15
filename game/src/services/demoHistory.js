import { getStoredUser, recordDemoRound } from './api.js';

const PREFIX = 'block_rush_pending_demo:';
let activeFlush = null;

function keysFor(userId) {
  const prefix = `${PREFIX}${userId}:`;
  return Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index))
    .filter(key => key?.startsWith(prefix));
}

export function queueDemoResult(result) {
  const user = getStoredUser();
  if (!user?.id) throw new Error('Entre novamente para sincronizar o histórico.');
  // One key per match prevents separate tabs from overwriting each other's queue.
  window.localStorage.setItem(`${PREFIX}${user.id}:${result.request_id}`, JSON.stringify(result));
}

export async function flushDemoHistory() {
  const userId = getStoredUser()?.id;
  if (!userId) return;
  if (activeFlush?.userId === userId) {
    await activeFlush.promise;
    if (getStoredUser()?.id === userId && keysFor(userId).length) return flushDemoHistory();
    return;
  }
  if (!keysFor(userId).length) return;
  const entry = { userId };
  entry.promise = (async () => {
    while (getStoredUser()?.id === userId) {
      const key = keysFor(userId)[0];
      if (!key) return;
      const result = JSON.parse(window.localStorage.getItem(key));
      const response = await recordDemoRound(result);
      if (response?.saved !== true || response.round_id !== result.request_id) {
        throw new Error('Não foi possível confirmar o histórico desta partida.');
      }
      window.localStorage.removeItem(key);
    }
  })().finally(() => { if (activeFlush === entry) activeFlush = null; });
  activeFlush = entry;
  return entry.promise;
}
