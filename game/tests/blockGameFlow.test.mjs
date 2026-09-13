import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import * as config from '../src/config.js';
import * as logic from '../src/block/BlockPuzzleLogic.js';

// Exercise the actual scene with controlled network completion and a renderer
// whose animations never finish. Gameplay must not depend on those callbacks.
const context = vm.createContext({ crypto: { randomUUID } });
let start, move, cashout, read;
const dependencies = {
  phaser: { default: { Scene: class {} } },
  '../brand.js': { BRAND: {} },
  '../config.js': config,
  '../block/BlockPuzzleLogic.js': logic,
  '../utils/SoundManager.js': { default: class {} },
  '../services/api.js': {
    startBlockRound: (...args) => start(...args),
    placeBlockPiece: (...args) => move(...args),
    cashoutBlockRound: (...args) => cashout(...args),
    fetchBlockRound: (...args) => read(...args),
  },
};
const module = new vm.SourceTextModule(await readFile(new URL('../src/scenes/GameScene.js', import.meta.url), 'utf8'), { context });
await module.link(specifier => {
  const exports = dependencies[specifier];
  assert.ok(exports, `unexpected dependency: ${specifier}`);
  return new vm.SyntheticModule(Object.keys(exports), function () {
    for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
  }, { context });
});
await module.evaluate();
const GameScene = module.namespace.default;
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
// Chainable Phaser display objects, without scheduling any completion callback.
function object() {
  const target = { destroyed: false };
  const proxy = new Proxy(target, { get: (item, key) => key in item ? item[key]
    : key === 'destroy' ? () => { item.destroyed = true; } : () => proxy });
  return proxy;
}
function scene(demo = false) {
  config.state.demoMode = demo;
  config.state.balance = 70;
  const game = new GameScene();
  game.init({ bet: 30 });
  game.roundId = 'round-test';
  game.gameState = 'PLAYING';
  game.sounds = object();
  game.add = { rectangle: object, graphics: object, container: object, zone: object };
  game.clearLayer = object();
  game.ghostGfx = object();
  game.animations = [];
  game.tweens = { add: animation => game.animations.push(animation) };
  game._cellRect = () => ({ cx: 1, cy: 1 });
  game.cellSize = 32;
  for (const method of ['_drawBlocks', '_updateHud', '_drawCashoutButton', '_updateModeLabels', '_haptic', '_showToast']) game[method] = () => {};
  game._tutorialSeen = () => true;
  game._showResult = won => { game.resultShown = true; game.won = won; };
  game._showRoundError = (message, retry) => { game.gameState = 'ERROR'; game.error = message; game.retry = retry; };
  return game;
}
function snapshot(overrides = {}) {
  return { demo_mode: false, round_id: 'round-test', version: 1, bet: 30, balance: 70,
    status: 'active', board: logic.createEmptyBoard(), pieces: [], moves: 1, total_clears: 1,
    best_combo: 1, difficulty_tier: 1, cashout_unlocked: false, payout: 0, ...overrides };
}
function prepareClear(game) {
  game.board[0].fill(1);
  game.board[0][0] = 0;
  for (let row = 1; row < 8; row++) game.board[row][0] = 1;
  const piece = { id: 'single', coords: [[0, 0]], used: false, color: 1 };
  game.availablePieces = [piece, { ...piece, id: 'next' }];
  return piece;
}

const demo = scene(true);
demo._placePiece(prepareClear(demo), 0, 0, { container: object() });
assert.equal(demo.totalClears, 2);
assert.equal(demo.board.flat().some(Boolean), false, 'row and column disappear synchronously');
assert.equal(demo._canPlayInput(), true, 'unfinished clear effects do not block the next move');
assert.equal(demo.animations.length, 1, 'all cells flash together');
assert.equal(demo.animations[0].targets.length, 15, 'intersection flashes only once');
assert.ok(demo.animations[0].duration <= 120);
assert.equal(demo.animations[0].delay, undefined, 'no per-cell stagger');
assert.equal(config.state.balance, 70, 'demo never modifies wallet balance');

const real = scene();
const pending = deferred();
let moveCalls = 0;
move = () => { moveCalls++; return pending.promise; };
real._placePiece(prepareClear(real), 0, 0, { container: object() });
assert.equal(real.board.flat().some(Boolean), false, 'real clear is visible before the HTTP response');
assert.equal(moveCalls, 1);
assert.equal(config.state.balance, 70, 'optimistic movement never credits money');
real._placePiece(real.availablePieces[1], 1, 1, { container: object() });
assert.equal(moveCalls, 1, 'only one unconfirmed action can be sent');
pending.resolve(snapshot({ total_clears: 2 }));
await flush();
assert.equal(real._canPlayInput(), true);
assert.equal(real.roundVersion, 1);

// A failed cashout cannot display success; retry sends the original action ID.
real.cashoutUnlocked = true;
const attempts = [];
cashout = async (id, payload) => { attempts.push({ id, ...payload }); throw new Error('connection lost'); };
real._cashOut();
await flush();
assert.equal(real.resultShown, false);
assert.equal(config.state.balance, 70);
cashout = async (id, payload) => {
  attempts.push({ id, ...payload });
  return snapshot({ status: 'won', payout: 64.8, balance: 134.8, version: 2 });
};
await real.retry();
assert.deepEqual(attempts[0], attempts[1], 'cashout retry cannot create a second payment');
assert.equal(real.won, true);
assert.equal(real.settledPayout, 64.8);
assert.equal(config.state.balance, 134.8);
assert.equal(config.state.activeBlockRound, null);

const starting = scene(true); // A stale local demo flag cannot authorize a demo.
start = async () => snapshot();
await starting._startRound();
assert.equal(starting.demoMode, false);
assert.equal(starting.roundId, 'round-test');
const unavailable = scene(false);
start = async () => { throw new Error('service unavailable'); };
await unavailable._startRound();
assert.equal(unavailable.gameState, 'ERROR');
assert.equal(unavailable.availablePieces.length, 0, 'no offline demo fallback for players');

const closed = scene(false);
const delayedStart = deferred();
start = () => delayedStart.promise;
const opening = closed._startRound();
closed.lifecycle = null;
delayedStart.resolve(snapshot({ balance: 999 }));
await opening;
assert.equal(config.state.balance, 70, 'response from a closed scene must not replace account balance');

const rack = scene();
rack.availablePieces = [{ id: 'used', used: true }, { id: 'available', coords: [[0, 0]], color: 1 }];
rack._renderPieces();
assert.equal(rack.pieceViews[0], undefined);
assert.equal(rack.pieceViews[1].piece.id, 'available', 'used pieces do not change the input slot mapping');
console.log('Block game flow: immediate clears, real settlement, retries, account mode and scene lifecycle OK');
