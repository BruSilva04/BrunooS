const PREFIX = 'block_rush_welcome_deposit:';
const storageFallback = new Map();

function userKey(user) {
  return user?.id ? `${PREFIX}${user.id}` : null;
}

// Only a completed registration queues the welcome dialog. Keep it across a
// reload until the lobby can display it, isolated from other accounts.
export function queueWelcomeDeposit(user) {
  const key = userKey(user);
  if (!key || user.role === 'admin' || user.permissions?.admin) return;
  storageFallback.delete(key);
  try { window.localStorage.setItem(key, 'pending'); } catch { storageFallback.set(key, true); }
}

export function hasPendingWelcomeDeposit(user) {
  const key = userKey(user);
  if (!key) return false;
  if (storageFallback.has(key)) return storageFallback.get(key);
  try { return window.localStorage.getItem(key) === 'pending'; } catch { return false; }
}

export function consumeWelcomeDeposit(user) {
  const key = userKey(user);
  if (!key) return;
  storageFallback.delete(key);
  try { window.localStorage.removeItem(key); } catch { storageFallback.set(key, false); }
}
