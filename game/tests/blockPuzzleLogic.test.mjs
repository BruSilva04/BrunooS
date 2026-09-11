import assert from 'node:assert/strict';
import {
  CELL,
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

assert.equal(difficultyTierFor({ totalClears: 0, moves: 0 }), 1);
assert.equal(difficultyTierFor({ totalClears: 3, moves: 0 }), 2);
assert.equal(difficultyTierFor({ totalClears: 6, moves: 0 }), 3);
assert.equal(difficultyTierFor({ totalClears: 9, moves: 0 }), 4);

{
  const totalClears = 2;
  const placement = { clearCount: 1 };
  const cashoutUnlocked = totalClears + placement.clearCount >= 3;

  assert.equal(cashoutUnlocked, true);
}

console.log('Block puzzle rules OK');
