import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const sources = Object.fromEntries(await Promise.all([
  ['welcome', '../src/services/depositWelcome.js'],
  ['auth', '../src/scenes/AuthScene.js'],
  ['lobby', '../src/scenes/LobbyScene.js'],
].map(async ([key, path]) => [key, await readFile(new URL(path, import.meta.url), 'utf8')])));
const noop = () => {};
const entries = new Map();
const storage = {
  getItem: key => entries.get(key) ?? null,
  setItem: (key, value) => entries.set(key, value),
  removeItem: key => entries.delete(key),
};
const player = id => ({ id, username: id, role: 'player', has_kyc: true });
const newPlayer = player('new-player');
const acquisition = { referral_code: 'influencer-one', campaign_code: 'launch', visitor_id: 'visitor-one' };
const snapshot = user => ({ user, balance: 0, demo_mode: false, history: [] });

// Minimal DOM doubles exercise the real rendering and click handlers without Phaser.
function lobbyRoot() {
  let html = '', buttons = [];
  const modal = { dataset: { modal: 'deposit' }, querySelectorAll: () => [], querySelector: () => null, contains: () => false, focus: noop, addEventListener: noop };
  return {
    get innerHTML() { return html; },
    set innerHTML(value) {
      html = value;
      buttons = [...html.matchAll(/<button\b([^>]*)>/g)].map(([, attributes]) => {
        const handlers = {};
        const dataset = Object.fromEntries([...attributes.matchAll(/data-([\w-]+)="([^"]*)"/g)]
          .map(([, key, value]) => [key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value]));
        return { dataset, handlers, addEventListener: (name, fn) => { handlers[name] = fn; }, focus: noop };
      });
    },
    querySelector(selector) {
      if (selector === '.modal-card' || selector === '[data-modal="deposit"]') {
        return html.includes('data-modal="deposit"') ? modal : null;
      }
      return null;
    },
    querySelectorAll: selector => selector === '[data-action]' ? buttons.filter(button => button.dataset.action) : [],
    async click(action, amount) {
      const button = buttons.find(button => button.dataset.action === action && (amount === undefined || button.dataset.amount === String(amount)));
      assert.ok(button, `rendered button ${action} ${amount ?? ''}`);
      await button.handlers.click({ stopPropagation: noop });
    },
    remove: noop,
  };
}

async function page({ user = null, localStorage = storage } = {}) {
  const fixture = { user, nextUser: newPlayer, deposits: [], registrations: [], sessions: [], starts: [], registrationError: null };
  const state = {};
  fixture.fetch = async () => snapshot(fixture.user);
  const context = vm.createContext({
    window: { localStorage },
    document: { hidden: false, activeElement: null },
    FormData: class { constructor(form) { this.values = form.values; } entries() { return Object.entries(this.values); } },
  });
  function synthetic(exports) {
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context });
  }
  const api = synthetic({
    getStoredUser: () => fixture.user,
    getAcquisitionForRegistration: () => acquisition,
    register: async payload => {
      fixture.registrations.push(payload);
      if (fixture.registrationError) throw fixture.registrationError;
      return { token: 'new-token', user: fixture.nextUser };
    },
    login: async () => ({ token: 'login-token', user: fixture.nextUser }),
    setSession: (token, account) => { fixture.user = account; fixture.sessions.push({ token, user: account }); },
    clearSession: noop,
    fetchLobby: (...args) => fixture.fetch(...args),
    createDepositIntent: async amount => {
      fixture.deposits.push(amount);
      return { intent: { id: 'pix-one', amount, pix_copy_paste: 'pix-code' }, sandbox: false };
    },
    confirmSandboxDeposit: noop,
    requestWithdrawal: noop,
  });
  const welcome = new vm.SourceTextModule(sources.welcome, { context });
  await welcome.link(() => { throw Error('Unexpected dependency'); });
  const modules = {
    'phaser': synthetic({ default: { Scene: class {}, Scenes: { Events: { SHUTDOWN: 'shutdown' } } } }),
    '../config.js': synthetic({ W: 390, H: 844, state }),
    '../brand.js': synthetic({ BRAND: { name: 'Block Rush', upperName: 'BLOCK RUSH' } }),
    '../services/api.js': api,
    '../services/demoHistory.js': synthetic({ flushDemoHistory: async () => {} }),
    '../services/depositWelcome.js': welcome,
  };
  const auth = new vm.SourceTextModule(sources.auth, { context });
  const lobby = new vm.SourceTextModule(sources.lobby, { context });
  for (const module of [auth, lobby]) {
    await module.link(specifier => {
      if (!modules[specifier]) throw Error(specifier);
      return modules[specifier];
    });
    await module.evaluate();
  }
  fixture.welcome = welcome.namespace;
  fixture.auth = async mode => {
    const scene = new auth.namespace.default();
    const submit = {};
    const form = {
      values: { username: 'new-player', password: 'secure123', phone: '11999999999', email: 'player@example.com', legal_name: 'Novo Jogador', document: '12345678901' },
      querySelector: () => submit, querySelectorAll: () => [], setAttribute: noop, removeAttribute: noop,
    };
    scene.mode = mode;
    scene.root = { contains: target => target === form };
    scene._showError = message => { fixture.authError = message; };
    scene.scene = { start: name => fixture.starts.push(name) };
    await scene._submit({ preventDefault: noop, currentTarget: form });
    return scene;
  };
  fixture.lobby = () => {
    const scene = new lobby.namespace.default();
    scene.init();
    scene.root = lobbyRoot();
    scene.scene = { start: name => fixture.starts.push(name) };
    return scene;
  };
  return fixture;
}

const registration = await page();
await registration.auth('register');
assert.equal(registration.starts[0], 'Lobby');
assert.equal(registration.sessions[0].token, 'new-token');
assert.equal(registration.welcome.hasPendingWelcomeDeposit(newPlayer), true);
for (const [key, value] of Object.entries(acquisition)) assert.equal(registration.registrations[0][key], value, 'registration retains acquisition attribution');
assert.equal(registration.deposits.length, 0, 'registration does not create a charge');

// Reload after registration, then retry a failed lobby load before displaying.
const reloaded = await page({ user: newPlayer });
const firstLobby = reloaded.lobby();
reloaded.fetch = async () => { throw Error('offline'); };
await firstLobby._loadLobby();
assert.equal(firstLobby.modal, null);
assert.equal(reloaded.welcome.hasPendingWelcomeDeposit(newPlayer), true, 'load failures do not consume the welcome');
reloaded.fetch = async () => snapshot(newPlayer);
await firstLobby._loadLobby();
assert.equal(firstLobby.modal, 'deposit');
assert.match(firstLobby.root.innerHTML, /R\$ 40<span>Recomendado<\/span>/);
assert.match(firstLobby.root.innerHTML, /Agora não/);
for (const amount of [20, 50, 100, 200]) assert.match(firstLobby.root.innerHTML, new RegExp(`data-amount="${amount}"`));
assert.equal(reloaded.welcome.hasPendingWelcomeDeposit(newPlayer), false, 'the rendered welcome consumes its marker');
assert.equal(reloaded.deposits.length, 0, 'opening the modal never generates a Pix');
await firstLobby.root.click('deposit-create', 40);
assert.deepEqual(reloaded.deposits, [40], 'only an explicit click creates the recommended Pix');
await firstLobby.root.click('close-modal');
assert.equal(firstLobby.modal, null);
await firstLobby._loadLobby({ background: true });
await firstLobby._loadLobby();
assert.equal(firstLobby.modal, null, 'polling and manual refresh do not reopen the modal');
const returning = reloaded.lobby();
await returning._loadLobby();
assert.equal(returning.modal, null, 'returning from a game does not reopen the modal');
const afterDisplayReload = await page({ user: newPlayer });
const afterDisplayLobby = afterDisplayReload.lobby();
await afterDisplayLobby._loadLobby();
assert.equal(afterDisplayLobby.modal, null, 'reloading after display does not reopen the modal');

const ordinaryLogin = await page();
ordinaryLogin.nextUser = player('existing-player');
await ordinaryLogin.auth('login');
assert.equal(ordinaryLogin.welcome.hasPendingWelcomeDeposit(ordinaryLogin.nextUser), false, 'ordinary logins do not enqueue a deposit');
const failedRegistration = await page();
failedRegistration.nextUser = player('failed-registration');
failedRegistration.registrationError = Error('duplicate username');
await failedRegistration.auth('register');
assert.equal(failedRegistration.welcome.hasPendingWelcomeDeposit(failedRegistration.nextUser), false);
assert.equal(failedRegistration.sessions.length, 0);
assert.equal(failedRegistration.starts.length, 0);

const isolated = await page({ user: player('other-account') });
const pendingPlayer = player('pending-player');
isolated.welcome.queueWelcomeDeposit(pendingPlayer);
const otherLobby = isolated.lobby();
await otherLobby._loadLobby();
assert.equal(otherLobby.modal, null, 'another account never sees the pending welcome');
assert.equal(isolated.welcome.hasPendingWelcomeDeposit(pendingPlayer), true);
isolated.nextUser = pendingPlayer;
await isolated.auth('login');
const pendingLobby = isolated.lobby();
await pendingLobby._loadLobby();
assert.equal(pendingLobby.modal, 'deposit', 'a pending welcome survives leaving and logging back in');
pendingLobby._onKeyDown({ key: 'Escape', preventDefault: noop });
assert.equal(pendingLobby.modal, null, 'the welcome can be dismissed with Escape');

const admin = { ...player('admin-one'), role: 'admin' };
const adminPage = await page({ user: admin });
adminPage.welcome.queueWelcomeDeposit(admin);
assert.equal(adminPage.welcome.hasPendingWelcomeDeposit(admin), false);
adminPage.welcome.queueWelcomeDeposit({ ...admin, role: 'player' });
adminPage.fetch = async () => ({ ...snapshot(admin), balance: 100, demo_mode: true });
const adminLobby = adminPage.lobby();
await adminLobby._loadLobby();
assert.equal(adminLobby.modal, null, 'the admin demo ignores even an old pending welcome');
assert.equal(adminPage.deposits.length, 0);

const unavailableStorage = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); }, removeItem() { throw Error('blocked'); } };
const restricted = await page({ localStorage: unavailableStorage });
await restricted.auth('register');
assert.equal(restricted.starts[0], 'Lobby', 'unavailable storage must not break registration');
const restrictedLobby = restricted.lobby();
await restrictedLobby._loadLobby();
assert.equal(restrictedLobby.modal, 'deposit');
await restrictedLobby.root.click('close-modal');
await restrictedLobby._loadLobby();
assert.equal(restrictedLobby.modal, null, 'memory fallback prevents reopening during the same visit');
console.log('Welcome deposit: registration, account isolation, reload/retry, dismissal and explicit R$40 Pix OK');
