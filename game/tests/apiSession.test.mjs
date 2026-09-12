import assert from 'node:assert/strict';

function memoryStorage() {
  const entries = new Map();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: (key) => entries.delete(key),
  };
}

globalThis.window = {
  sessionStorage: memoryStorage(),
  localStorage: memoryStorage(),
  location: { hostname: 'localhost', protocol: 'http:' },
};

const api = await import('../src/services/api.js');
const originalFetch = globalThis.fetch;

function respond(status, body) {
  globalThis.fetch = async () => new Response(JSON.stringify(body), { status });
}

try {
  // Existing users retain their session and acquisition data after the rebrand.
  window.localStorage.setItem('sereia_acq_first_touch', 'existing-attribution');
  api.setSession('test-session', { username: 'teste' });
  assert.equal(window.sessionStorage.getItem('sereia_auth_token'), 'test-session');
  assert.equal(api.getAuthToken({ touch: false }), 'test-session');
  assert.equal(api.getStoredUser().username, 'teste');

  globalThis.fetch = async (url, options) => {
    assert.ok(url.endsWith('/api/lobby/me'));
    assert.equal(options.headers.Authorization, 'Bearer test-session');
    assert.equal(options.cache, 'no-store');
    return new Response(JSON.stringify({ balance: 0 }));
  };
  assert.deepEqual(await api.fetchLobby(), { balance: 0 });

  // Screens can distinguish an expired session from a recoverable outage.
  respond(401, { detail: 'Usuário ou senha inválidos.' });
  await assert.rejects(api.login('teste', 'senha'), (error) => {
    assert.equal(error.status, 401);
    assert.equal(error.message, 'Usuário ou senha inválidos.');
    return true;
  });

  respond(503, { detail: 'Configure INTERNAL_DATABASE_SECRET at http://private-backend' });
  await assert.rejects(api.fetchLobby(), (error) => {
    assert.equal(error.status, 503);
    assert.match(error.message, /temporariamente indisponível/);
    assert.doesNotMatch(error.message, /SECRET|http|503/);
    return true;
  });
  assert.equal(api.getAuthToken({ touch: false }), 'test-session');

  respond(422, { detail: [{ loc: ['body', 'email'], msg: 'invalid' }] });
  await assert.rejects(api.register({}), /Confira os dados/);

  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(api.fetchLobby(), /Verifique sua conexão/);
  assert.equal(api.hasValidSession(), true);

  // Expired sessions are cleared without deleting persistent attribution.
  window.sessionStorage.setItem('sereia_auth_last_seen_at', Date.now() - 31 * 60 * 1000);
  assert.equal(api.hasValidSession(), false);
  assert.equal(window.sessionStorage.getItem('sereia_auth_token'), null);
  assert.equal(window.localStorage.getItem('sereia_acq_first_touch'), 'existing-attribution');
  console.log('API errors and session compatibility OK');
} finally {
  globalThis.fetch = originalFetch;
  delete globalThis.window;
}
