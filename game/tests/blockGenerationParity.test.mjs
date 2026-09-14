import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PIECE_DEFS, createEmptyBoard, difficultyTierFor, generateThreePieces, hasAnyMove } from '../src/block/BlockPuzzleLogic.js';

// Compare the real Python generator with the admin's JavaScript generator.
// Fixed random draws make differences in shapes, weights, order or levels visible.
// Only Python's standard library is needed; no database or network is involved.
const checkerboard = Array.from({ length: 8 }, (_, row) => Array.from({ length: 8 }, (_, col) => (row + col) % 2));
const corridor = checkerboard.map((row, index) => index === 0 ? Array(8).fill(0) : row.slice());
const corner = checkerboard.map((row, r) => row.map((cell, c) => r < 3 && c < 3 ? 0 : cell));
const cases = [];
for (const board of [createEmptyBoard(), checkerboard, corridor, corner]) {
  for (const [moves, total_clears] of [[0, 0], [2, 0], [3, 0], [6, 0], [0, 3], [99, 30]]) {
    for (const draws of [[0, 0, 0, 0, 0], [0.999999, 0.999999, 0.999999, 0.999999, 0.999999], [0.14, 0.72, 0.36, 0.82, 0.45], [0.9, 0.1, 0.5, 0.3, 0.8]]) {
      cases.push({ board, moves, total_clears, draws });
    }
  }
}
const source = `
import json, sys
sys.path.insert(0, 'backend')
from services.block_puzzle import PIECE_DEFS, difficulty, generate_batch, has_move
output = []
for case in json.load(sys.stdin):
    draws = iter(case['draws'])
    tier = difficulty(case['total_clears'], case['moves'])
    pieces = generate_batch(case['board'], tier, randbelow=lambda size: int(next(draws) * size))
    output.append({'tier': tier, 'pieces': [{key: piece[key] for key in ('key', 'tier', 'coords', 'color', 'used')} for piece in pieces], 'can_play': has_move(case['board'], pieces)})
print(json.dumps({'cases': output, 'definitions': [{'key': key, 'tier': tier, 'coords': coords, 'color': color} for key, tier, coords, color in PIECE_DEFS]}))
`;
const result = spawnSync(process.env.PYTHON || 'python3', ['-c', source], {
  cwd: fileURLToPath(new URL('../../', import.meta.url)), input: JSON.stringify(cases), encoding: 'utf8',
});
assert.ifError(result.error);
assert.equal(result.status, 0, result.stderr);
const backend = JSON.parse(result.stdout);
assert.deepEqual(PIECE_DEFS.map(({ key, tier, coords, color }) => ({ key, tier, coords, color })), backend.definitions);
cases.forEach((test, index) => {
  const tier = difficultyTierFor({ moves: test.moves, totalClears: test.total_clears });
  let cursor = 0;
  const pieces = generateThreePieces({ board: test.board, difficultyTier: tier, rng: () => test.draws[cursor++] });
  assert.deepEqual({ tier, pieces: pieces.map(({ key, tier, coords, color, used }) => ({ key, tier, coords, color, used })), can_play: hasAnyMove(test.board, pieces) }, backend.cases[index], `admin/player generation differs in case ${index}`);
});
console.log(`Block generation parity: ${cases.length} scenarios match between admin and real accounts`);
