import assert from 'node:assert/strict';

function memoryStorage() {
  const entries = new Map();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: (key) => entries.delete(key),
    clear: () => entries.clear(),
  };
}

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalTimeout = AbortSignal.timeout;
globalThis.window = {
  sessionStorage: memoryStorage(),
  localStorage: memoryStorage(),
  location: { hostname: 'localhost', protocol: 'http:', pathname: '/', search: '' },
  crypto: { randomUUID: () => 'visitor-test-123' },
};
globalThis.document = { referrer: 'https://social.example/status?private=hidden' };

const api = await import('../src/services/api.js');
const attributionKey = 'sereia_acq_first_touch';
const tick = () => new Promise((resolve) => setImmediate(resolve));
const response = (body) => new Response(JSON.stringify(body), { status: 200 });
const clickResult = (code = 'ANA') => ({
  success: true,
  click_id: `click-${code}`,
  campaign_id: `campaign-${code}`,
  referral_code: code,
  tracking_token: `signed-${code}`,
  expires_at: new Date(Date.now() + 86400000).toISOString(),
});

function reset(search = '') {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.location.search = search;
}

try {
  // A registration submitted before the landing request returns keeps the campaign.
  reset('?ref=ana&utm_source=status&private=hidden');
  let finishClick;
  let clickCount = 0;
  let registrations = [];
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/api/tracking/click')) {
      clickCount += 1;
      const body = JSON.parse(options.body);
      assert.equal(body.referral_code, 'ANA');
      assert.equal(body.landing_path, '/?ref=ana&utm_source=status');
      assert.equal(body.referrer_url, 'https://social.example/status');
      assert.equal(options.headers.Authorization, undefined);
      assert.ok(options.signal instanceof AbortSignal);
      return new Promise((resolve) => { finishClick = () => resolve(response(clickResult())); });
    }
    assert.ok(url.endsWith('/api/auth/register'));
    registrations.push(JSON.parse(options.body));
    return response({ user: { id: 'new-user' } });
  };
  const startup = api.initAcquisitionTracking();
  assert.equal(api.initAcquisitionTracking(), startup, 'concurrent callers share the click request');
  const registration = api.register({ username: 'new-user', ...api.getAcquisitionForRegistration() });
  await tick();
  assert.equal(registrations.length, 0, 'registration waits for the pending click');
  finishClick();
  await Promise.all([startup, registration]);
  assert.equal(clickCount, 1);
  assert.deepEqual(registrations[0], {
    username: 'new-user',
    acquisition_click_id: 'click-ANA',
    acquisition_tracking_token: 'signed-ANA',
    referral_code: 'ANA',
  });

  // A second campaign records its click while the original campaign retains attribution.
  window.location.search = '?ref=BIA';
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/api/tracking/click')) {
      clickCount += 1;
      return response(clickResult('BIA'));
    }
    registrations.push(JSON.parse(options.body));
    return response({ user: { id: 'another-user' } });
  };
  await api.initAcquisitionTracking();
  await api.register({ username: 'another-user', referral_code: 'BIA' });
  assert.equal(clickCount, 2);
  assert.equal(registrations[1].referral_code, 'ANA');
  assert.equal(api.getStoredAcquisition().campaign_id, 'campaign-ANA');

  // Attribution survives a later direct visit without another referral parameter.
  window.location.search = '';
  await api.register({ username: 'returning-visitor' });
  assert.equal(clickCount, 2);
  assert.equal(registrations[2].acquisition_click_id, 'click-ANA');

  // Expired attribution is replaced by the new link's campaign.
  window.localStorage.setItem(attributionKey, JSON.stringify({
    ...clickResult(), expires_at: new Date(Date.now() - 1000).toISOString(),
  }));
  window.location.search = '?ref=BIA';
  await api.register({ username: 'expired-first-touch' });
  assert.equal(registrations[3].referral_code, 'BIA');
  assert.equal(api.getStoredAcquisition().campaign_id, 'campaign-BIA');

  // A failed startup tracking request is retried when the visitor registers.
  reset('?ref=ANA');
  let retryAttempts = 0;
  registrations = [];
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/api/tracking/click')) {
      retryAttempts += 1;
      if (retryAttempts === 1) throw new TypeError('offline');
      return response(clickResult());
    }
    registrations.push(JSON.parse(options.body));
    return response({ user: { id: 'retried-user' } });
  };
  assert.equal(await api.initAcquisitionTracking(), null);
  await api.register({ username: 'retried-user' });
  assert.equal(retryAttempts, 2);
  assert.equal(registrations[0].referral_code, 'ANA');

  // Tracking cannot hold registration indefinitely if the backend stalls.
  reset('?ref=ANA');
  let controller;
  AbortSignal.timeout = (milliseconds) => {
    assert.ok(milliseconds > 0 && milliseconds <= 10000);
    controller = new AbortController();
    return controller.signal;
  };
  registrations = [];
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/api/tracking/click')) {
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
      });
    }
    registrations.push(JSON.parse(options.body));
    return response({ user: { id: 'timeout-user' } });
  };
  const timedRegistration = api.register({ username: 'timeout-user' });
  await tick();
  assert.equal(registrations.length, 0);
  controller.abort(new DOMException('Tracking timed out', 'TimeoutError'));
  await timedRegistration;
  assert.deepEqual(registrations, [{ username: 'timeout-user' }]);
  AbortSignal.timeout = originalTimeout;

  // Direct visitors and invalid codes can register without a tracking request.
  globalThis.fetch = async (url, options) => {
    assert.ok(url.endsWith('/api/auth/register'));
    assert.deepEqual(JSON.parse(options.body), { username: 'direct-user' });
    return response({ user: { id: 'direct-user' } });
  };
  for (const search of ['', '?ref=ab', '?ref=bad%3Bcode']) {
    reset(search);
    await api.register({ username: 'direct-user' });
  }
  console.log('Acquisition first touch, registration timing, retries and timeout OK');
} finally {
  globalThis.fetch = originalFetch;
  AbortSignal.timeout = originalTimeout;
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
}
