import { API_URL } from '../config.js';

const TOKEN_KEY = 'sereia_auth_token';
const USER_KEY = 'sereia_auth_user';
const SESSION_STARTED_KEY = 'sereia_auth_started_at';
const SESSION_LAST_SEEN_KEY = 'sereia_auth_last_seen_at';
const ACQ_VISITOR_KEY = 'sereia_acq_visitor_id';
const ACQ_ATTRIBUTION_KEY = 'sereia_acq_first_touch';
// Keep existing storage keys so the visual rebrand preserves sessions and attribution.
const SESSION_IDLE_MS = 30 * 60 * 1000;
const SESSION_MAX_AGE_MS = 4 * 60 * 60 * 1000;

function sessionStore() {
  return window.sessionStorage;
}

function trackingStore() {
  return window.localStorage;
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
  const { auth = true, ...fetchOptions } = options;
  const headers = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers || {}),
  };
  if (fetchOptions.headers) {
    delete fetchOptions.headers;
  }
  const token = auth ? getAuthToken() : null;
  if (auth && token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      cache: 'no-store',
      ...fetchOptions,
      headers,
    });
  } catch {
    throw new Error('Não foi possível conectar. Verifique sua conexão e tente novamente.');
  }
  const rawBody = await response.text();
  let data = {};
  try {
    data = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    data = {};
  }

  if (!response.ok) {
    const detail = data.detail || data.message;
    const message = response.status >= 500
      ? 'Serviço temporariamente indisponível. Tente novamente em instantes.'
      : typeof detail === 'string'
        ? detail
        : response.status === 422
          ? 'Confira os dados preenchidos e tente novamente.'
          : response.status === 401
            ? 'Acesso não autorizado. Entre novamente com seus dados.'
            : 'Não foi possível concluir a solicitação. Tente novamente.';
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return data;
}

function normalizeReferralCode(value) {
  const raw = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/[\s.]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');
  return /^[A-Z0-9_-]{3,40}$/.test(raw) ? raw : '';
}

function randomVisitorId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  const seed = `${Date.now()}-${Math.random()}-${navigator.userAgent || ''}`;
  return `visitor-${btoa(seed).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48)}`;
}

function safeLandingPath(params) {
  const safeParams = new URLSearchParams();
  ['ref', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content'].forEach((key) => {
    const value = params.get(key);
    if (value) safeParams.set(key, value);
  });
  const query = safeParams.toString();
  return `${window.location.pathname || '/'}${query ? `?${query}` : ''}`;
}

function safeReferrerUrl() {
  try {
    if (!document.referrer) return '';
    const url = new URL(document.referrer);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '';
  }
}

export function getVisitorId() {
  let visitorId = trackingStore().getItem(ACQ_VISITOR_KEY);
  if (!visitorId) {
    visitorId = randomVisitorId();
    trackingStore().setItem(ACQ_VISITOR_KEY, visitorId);
  }
  return visitorId;
}

export function getStoredAcquisition() {
  try {
    const stored = JSON.parse(trackingStore().getItem(ACQ_ATTRIBUTION_KEY) || 'null');
    if (!stored?.tracking_token || !stored?.click_id || !stored?.expires_at) return null;
    if (Date.parse(stored.expires_at) <= Date.now()) {
      trackingStore().removeItem(ACQ_ATTRIBUTION_KEY);
      return null;
    }
    return stored;
  } catch {
    trackingStore().removeItem(ACQ_ATTRIBUTION_KEY);
    return null;
  }
}

export async function initAcquisitionTracking() {
  const params = new URLSearchParams(window.location.search || '');
  const referralCode = normalizeReferralCode(params.get('ref'));
  if (!referralCode) {
    getStoredAcquisition();
    return null;
  }

  const existingFirstTouch = getStoredAcquisition();
  const visitorId = getVisitorId();

  try {
    const response = await request('/api/tracking/click', {
      auth: false,
      method: 'POST',
      body: JSON.stringify({
        referral_code: referralCode,
        visitor_id: visitorId,
        landing_path: safeLandingPath(params),
        referrer_url: safeReferrerUrl(),
        utm_source: params.get('utm_source') || '',
        utm_medium: params.get('utm_medium') || '',
        utm_campaign: params.get('utm_campaign') || '',
        utm_content: params.get('utm_content') || '',
      }),
    });

    if (response.success && !existingFirstTouch) {
      trackingStore().setItem(ACQ_ATTRIBUTION_KEY, JSON.stringify({
        click_id: response.click_id,
        campaign_id: response.campaign_id,
        referral_code: response.referral_code,
        tracking_token: response.tracking_token,
        visitor_id: visitorId,
        expires_at: response.expires_at,
      }));
    }
    return response;
  } catch {
    return null;
  }
}

export function getAcquisitionForRegistration() {
  const acquisition = getStoredAcquisition();
  if (!acquisition) return {};
  return {
    acquisition_click_id: acquisition.click_id,
    acquisition_tracking_token: acquisition.tracking_token,
    referral_code: acquisition.referral_code,
  };
}

function queryString(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, value);
    }
  });
  const text = search.toString();
  return text ? `?${text}` : '';
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

export function startBlockRound(bet, requestId) {
  return request('/api/block/rounds', {
    method: 'POST', body: JSON.stringify({ bet, request_id: requestId }),
  });
}

export function fetchBlockRound(roundId) {
  return request(`/api/block/rounds/${encodeURIComponent(roundId)}`);
}

export function placeBlockPiece(roundId, action) {
  return request(`/api/block/rounds/${encodeURIComponent(roundId)}/moves`, {
    method: 'POST', body: JSON.stringify(action),
  });
}

export function cashoutBlockRound(roundId, action) {
  return request(`/api/block/rounds/${encodeURIComponent(roundId)}/cashout`, {
    method: 'POST', body: JSON.stringify(action),
  });
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

export function listAdminAffiliates() {
  return request('/api/admin/affiliates');
}

export function createAdminAffiliate(payload) {
  return request('/api/admin/affiliates', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateAdminAffiliate(id, payload) {
  return request(`/api/admin/affiliates/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function listAdminCampaigns(params = {}) {
  return request(`/api/admin/campaigns${queryString(params)}`);
}

export function createAdminCampaign(payload) {
  return request('/api/admin/campaigns', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateAdminCampaign(id, payload) {
  return request(`/api/admin/campaigns/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function fetchAdminAcquisitionOverview(params = {}) {
  return request(`/api/admin/acquisition/overview${queryString(params)}`);
}

export function fetchAdminAcquisitionCampaigns(params = {}) {
  return request(`/api/admin/acquisition/campaigns${queryString(params)}`);
}
