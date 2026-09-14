import assert from 'node:assert/strict';
import {
  CELL,
  PIECE_DEFS,
  canPlacePiece,
  clearCompletedLines,
  createEmptyBoard,
  difficultyTierFor,
  findCompletedColumns,
  findCompletedRows,
  generateThreePieces,
  hasAnyMove,
  hasValidPlacement,
  placePiece,
  resolvePlacement,
} from '../src/block/BlockPuzzleLogic.js';

const single = { coords: [[0, 0]], used: false };
const h2 = { coords: [[0, 0], [0, 1]], used: false };
const h3 = { coords: [[0, 0], [0, 1], [0, 2]], used: false };
const square2 = { coords: [[0, 0], [0, 1], [1, 0], [1, 1]], used: false };

function fillRow(board, row, exceptCol = null) {
  for (let col = 0; col < board.length; col += 1) {
    if (col !== exceptCol) board[row][col] = CELL.FILLED;
  }
}

function fillCol(board, col, exceptRow = null) {
  for (let row = 0; row < board.length; row += 1) {
    if (row !== exceptRow) board[row][col] = CELL.FILLED;
  }
}

{
  const board = createEmptyBoard();
  fillRow(board, 2, 7);
  const placement = resolvePlacement(board, single, 2, 7);

  assert.equal(placement.ok, true);
  assert.deepEqual(placement.rows, [2]);
  assert.deepEqual(placement.columns, []);
  assert.equal(placement.clearCount, 1);
  assert.equal(placement.board[2].every((cell) => cell === CELL.EMPTY), true);
}

{
  const board = createEmptyBoard();
  fillRow(board, 0, 0);
  fillCol(board, 0, 0);
  const placement = resolvePlacement(board, single, 0, 0);

  assert.equal(placement.ok, true);
  assert.deepEqual(placement.rows, [0]);
  assert.deepEqual(placement.columns, [0]);
  assert.equal(placement.clearCount, 2);
  assert.equal(findCompletedRows(placement.board).length, 0);
  assert.equal(findCompletedColumns(placement.board).length, 0);
}

{
  const board = createEmptyBoard();
  board[1][1] = CELL.FILLED;

  assert.equal(canPlacePiece(board, single, 1, 1), false);
  assert.equal(placePiece(board, single, 1, 1), null);
  assert.equal(canPlacePiece(board, h2, 7, 7), false);
  assert.equal(canPlacePiece(board, h2, -1, 0), false);
}

{
  const board = createEmptyBoard();
  fillRow(board, 4);
  fillCol(board, 6);
  const cleared = clearCompletedLines(board, [4], [6]);

  assert.equal(cleared[4].every((cell) => cell === CELL.EMPTY), true);
  assert.equal(cleared.every((row) => row[6] === CELL.EMPTY), true);
}

{
  const board = createEmptyBoard();
  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board.length; col += 1) {
      board[row][col] = CELL.FILLED;
    }
  }
  board[7][7] = CELL.EMPTY;

  assert.equal(hasAnyMove(board, [square2, h3, single]), true);
  assert.equal(hasAnyMove(board, [square2, h3]), false);
}

{
  const board = createEmptyBoard();
  const pieces = generateThreePieces({ board, difficultyTier: 1, rng: () => 0 });

  assert.equal(pieces.length, 3);
  assert.equal(pieces.every((piece) => Array.isArray(piece.coords)), true);
  assert.equal(hasAnyMove(board, pieces), true);
  assert.equal(hasValidPlacement(board, pieces[0]), true);
}

assert.equal(difficultyTierFor({ totalClears: 0, moves: 0 }), 2);
assert.equal(difficultyTierFor({ totalClears: 0, moves: 2 }), 2);
assert.equal(difficultyTierFor({ totalClears: 0, moves: 3 }), 3);
assert.equal(difficultyTierFor({ totalClears: 0, moves: 6 }), 4);
assert.equal(difficultyTierFor({ totalClears: 3, moves: 0 }), 3);
assert.equal(difficultyTierFor({ totalClears: 6, moves: 0 }), 4);
assert.equal(difficultyTierFor({ totalClears: 90, moves: 300 }), 4);

{
  // A horizontal corridor can fit some shapes, but each rack includes a blocked one.
  const board = Array.from({ length: 8 }, (_, row) => Array.from({ length: 8 }, (_, col) => row === 0 ? 0 : (row + col) % 2));
  for (let trial = 0; trial < 100; trial += 1) {
    const pieces = generateThreePieces({ board, difficultyTier: 4, rng: () => trial / 100 });
    assert.equal(pieces.length, 3);
    assert.equal(new Set(pieces.map(piece => piece.key)).size, 3, 'rack has three distinct shapes');
    assert.ok(pieces.some(piece => !hasValidPlacement(board, piece)), 'every rack includes an initially blocked shape');
    assert.ok(pieces.every(piece => piece.coords.length >= 3), 'no tiny rescue shapes');
  }
}

{
  const board = Array.from({ length: 8 }, (_, row) => Array.from({ length: 8 }, (_, col) => (row + col) % 2));
  const before = JSON.stringify(board);
  let draws = 0;
  const pieces = generateThreePieces({ board, rng: () => { draws++; return 0.5; } });
  assert.equal(pieces.length, 3);
  assert.equal(hasAnyMove(board, pieces), false, 'an unplayable rack is not replaced with a rescue piece');
  assert.ok(draws < 10, 'no repeated searches for a playable rack');
  assert.equal(JSON.stringify(board), before);
}

{
  const board = createEmptyBoard();
  for (const tier of [2, 3, 4]) {
    const offered = new Set();
    for (let trial = 0; trial < 100; trial += 1) {
      const pieces = generateThreePieces({ board, difficultyTier: tier, rng: () => trial / 100 });
      assert.ok(hasAnyMove(board, pieces), 'empty board always allows an opening move');
      assert.ok(pieces.every(piece => piece.tier <= tier));
      pieces.forEach(piece => offered.add(piece.key));
    }
    for (const shape of PIECE_DEFS.filter(piece => piece.tier <= tier && piece.coords.length >= 3)) {
      assert.ok(offered.has(shape.key), `eligible shape can be drawn: ${shape.key}`);
    }
  }
}

{
  const totalClears = 2;
  const placement = { clearCount: 1 };
  const cashoutUnlocked = totalClears + placement.clearCount >= 3;

  assert.equal(cashoutUnlocked, true);
}

console.log('Block puzzle rules OK');
