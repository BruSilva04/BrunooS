import { API_URL } from '../config.js';

const TOKEN_KEY = 'sereia_auth_token';
const USER_KEY = 'sereia_auth_user';
const SESSION_STARTED_KEY = 'sereia_auth_started_at';
const SESSION_LAST_SEEN_KEY = 'sereia_auth_last_seen_at';
const SESSION_IDLE_MS = 30 * 60 * 1000;
const SESSION_MAX_AGE_MS = 4 * 60 * 60 * 1000;

function sessionStore() {
  return window.sessionStorage;
}

function clearLegacyStorage() {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
}

function isSessionExpired() {
  const now = Date.now();
  const startedAt = Number(sessionStore().getItem(SESSION_STARTED_KEY) || 0);
  const lastSeenAt = Number(sessionStore().getItem(SESSION_LAST_SEEN_KEY) || 0);
  if (!startedAt || !lastSeenAt) return true;
  return now - startedAt > SESSION_MAX_AGE_MS || now - lastSeenAt > SESSION_IDLE_MS;
}

function touchSession() {
  sessionStore().setItem(SESSION_LAST_SEEN_KEY, String(Date.now()));
}

export function getAuthToken({ touch = true } = {}) {
  clearLegacyStorage();
  const token = sessionStore().getItem(TOKEN_KEY);
  if (!token) return null;
  if (isSessionExpired()) {
    clearSession();
    return null;
  }
  if (touch) touchSession();
  return token;
}

export function hasValidSession() {
  return !!getAuthToken({ touch: false });
}

export function markSessionActivity() {
  if (getAuthToken({ touch: false })) {
    touchSession();
  }
}

export function getStoredUser() {
  clearLegacyStorage();
  if (isSessionExpired()) {
    clearSession();
    return null;
  }
  try {
    return JSON.parse(sessionStore().getItem(USER_KEY) || 'null');
  } catch {
    return null;
  }
}

export function setSession(token, user) {
  clearLegacyStorage();
  const now = String(Date.now());
  sessionStore().setItem(TOKEN_KEY, token);
  sessionStore().setItem(USER_KEY, JSON.stringify(user));
  sessionStore().setItem(SESSION_STARTED_KEY, now);
  sessionStore().setItem(SESSION_LAST_SEEN_KEY, now);
}

export function clearSession() {
  sessionStore().removeItem(TOKEN_KEY);
  sessionStore().removeItem(USER_KEY);
  sessionStore().removeItem(SESSION_STARTED_KEY);
  sessionStore().removeItem(SESSION_LAST_SEEN_KEY);
  clearLegacyStorage();
}

async function request(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  const token = getAuthToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      cache: 'no-store',
      ...options,
      headers,
    });
  } catch (error) {
    throw new Error(`Falha ao conectar com o backend em ${API_URL}`);
  }
  const rawBody = await response.text();
  let data = {};
  try {
    data = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    data = {};
  }

  if (!response.ok) {
    const detail = data.detail || data.message || rawBody.slice(0, 120) || response.statusText;
    throw new Error(`HTTP ${response.status} em ${API_URL}${path}: ${detail}`);
  }
  return data;
}

export function login(username, password) {
  return request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export function register(payload) {
  return request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function fetchLobby() {
  return request('/api/lobby/me');
}

export function fetchWallet() {
  return request('/api/wallet/me');
}

export function createDepositIntent(amount, customerName = '', customerDocument = '', customerDocumentType = 'cpf') {
  return request('/api/wallet/deposit-intents', {
    method: 'POST',
    body: JSON.stringify({
      amount,
      customer_name: customerName || undefined,
      customer_document: customerDocument || undefined,
      customer_document_type: customerDocumentType || 'cpf',
    }),
  });
}

export function confirmSandboxDeposit(intentId) {
  return request(`/api/wallet/deposit-intents/${intentId}/sandbox-confirm`, {
    method: 'POST',
  });
}

export function requestWithdrawal(amount, pixKey, pixKeyType = 'random', ownerName = '', ownerDocument = '', ownerDocumentType = 'cpf') {
  return request('/api/wallet/withdrawals', {
    method: 'POST',
    body: JSON.stringify({
      amount,
      pix_key: pixKey,
      pix_key_type: pixKeyType,
      owner_name: ownerName,
      owner_document: ownerDocument,
      owner_document_type: ownerDocumentType,
    }),
  });
}
