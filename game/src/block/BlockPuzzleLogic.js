import { BLOCK_GAME_CONFIG } from '../config.js';

let pieceCounter = 1;

export const CELL = {
  EMPTY: 0,
  FILLED: 1,
};

export const PIECE_DEFS = [
  { key: 'single', label: '1 BLOCO', tier: 1, coords: [[0, 0]], color: 0xffdf72 },
  { key: 'h2', label: '2 H', tier: 1, coords: [[0, 0], [0, 1]], color: 0x8fffe7 },
  { key: 'v2', label: '2 V', tier: 1, coords: [[0, 0], [1, 0]], color: 0x7dd3fc },
  { key: 'h3', label: '3 H', tier: 1, coords: [[0, 0], [0, 1], [0, 2]], color: 0xff9aa9 },
  { key: 'v3', label: '3 V', tier: 1, coords: [[0, 0], [1, 0], [2, 0]], color: 0xf4c84a },
  { key: 'square2', label: '2X2', tier: 1, coords: [[0, 0], [0, 1], [1, 0], [1, 1]], color: 0x25e0a7 },

  { key: 'l3', label: 'L', tier: 2, coords: [[0, 0], [1, 0], [1, 1]], color: 0xb38cff },
  { key: 'l3r', label: 'L R', tier: 2, coords: [[0, 1], [1, 0], [1, 1]], color: 0xff8bb7 },
  { key: 'h4', label: '4 H', tier: 2, coords: [[0, 0], [0, 1], [0, 2], [0, 3]], color: 0x65d3ff },
  { key: 'v4', label: '4 V', tier: 2, coords: [[0, 0], [1, 0], [2, 0], [3, 0]], color: 0x5dffd0 },
  { key: 'rect3x2', label: '3X2', tier: 2, coords: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]], color: 0xf6c85f },

  { key: 't', label: 'T', tier: 3, coords: [[0, 0], [0, 1], [0, 2], [1, 1]], color: 0xff6675 },
  { key: 'z', label: 'Z', tier: 3, coords: [[0, 0], [0, 1], [1, 1], [1, 2]], color: 0x9df8ff },
  { key: 'zi', label: 'Z I', tier: 3, coords: [[0, 1], [0, 2], [1, 0], [1, 1]], color: 0xffdf72 },
  { key: 'l4', label: 'L+', tier: 3, coords: [[0, 0], [1, 0], [2, 0], [2, 1]], color: 0x8d5cff },
  { key: 'h5', label: '5 H', tier: 3, coords: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]], color: 0xffa85c },

  { key: 'plus', label: 'PLUS', tier: 4, coords: [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]], color: 0xd7fbff },
  { key: 'bigL', label: 'L BIG', tier: 4, coords: [[0, 0], [1, 0], [2, 0], [3, 0], [3, 1]], color: 0xf472b6 },
  { key: 'corner5', label: 'CANTO', tier: 4, coords: [[0, 0], [0, 1], [0, 2], [1, 0], [2, 0]], color: 0x22d3ee },
  { key: 'v5', label: '5 V', tier: 3, coords: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]], color: 0xa78bfa },
  { key: 'square3', label: '3X3', tier: 3, coords: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]], color: 0x67e8f9 },
  { key: 'rect4x2', label: '4X2', tier: 4, coords: [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2], [1, 3]], color: 0xf472b6 },
];

export function createEmptyBoard(size = BLOCK_GAME_CONFIG.boardSize) {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => CELL.EMPTY));
}

export function cloneBoard(board) {
  return board.map((row) => row.slice());
}

export function getPieceBounds(piece) {
  const coords = piece?.coords || [];
  const maxRow = Math.max(0, ...coords.map(([row]) => row));
  const maxCol = Math.max(0, ...coords.map(([, col]) => col));
  return {
    rows: maxRow + 1,
    cols: maxCol + 1,
  };
}

export function canPlacePiece(board, piece, originRow, originCol) {
  if (!board?.length || !piece?.coords?.length) return false;
  const size = board.length;
  return piece.coords.every(([rowOffset, colOffset]) => {
    const row = originRow + rowOffset;
    const col = originCol + colOffset;
    return row >= 0
      && row < size
      && col >= 0
      && col < size
      && board[row][col] === CELL.EMPTY;
  });
}

export function placePiece(board, piece, originRow, originCol) {
  if (!canPlacePiece(board, piece, originRow, originCol)) return null;
  const nextBoard = cloneBoard(board);
  piece.coords.forEach(([rowOffset, colOffset]) => {
    nextBoard[originRow + rowOffset][originCol + colOffset] = CELL.FILLED;
  });
  return nextBoard;
}

export function findCompletedRows(board) {
  return board
    .map((row, index) => (row.every((cell) => cell === CELL.FILLED) ? index : -1))
    .filter((index) => index >= 0);
}

export function findCompletedColumns(board) {
  const size = board.length;
  const columns = [];
  for (let col = 0; col < size; col += 1) {
    let filled = true;
    for (let row = 0; row < size; row += 1) {
      if (board[row][col] !== CELL.FILLED) {
        filled = false;
        break;
      }
    }
    if (filled) columns.push(col);
  }
  return columns;
}

export function clearCompletedLines(board, rows = [], columns = []) {
  const nextBoard = cloneBoard(board);
  rows.forEach((row) => {
    for (let col = 0; col < nextBoard.length; col += 1) {
      nextBoard[row][col] = CELL.EMPTY;
    }
  });
  columns.forEach((col) => {
    for (let row = 0; row < nextBoard.length; row += 1) {
      nextBoard[row][col] = CELL.EMPTY;
    }
  });
  return nextBoard;
}

export function resolvePlacement(board, piece, originRow, originCol) {
  const placedBoard = placePiece(board, piece, originRow, originCol);
  if (!placedBoard) {
    return {
      ok: false,
      board,
      placedBoard: board,
      rows: [],
      columns: [],
      clearCount: 0,
    };
  }

  const rows = findCompletedRows(placedBoard);
  const columns = findCompletedColumns(placedBoard);
  const clearCount = rows.length + columns.length;
  return {
    ok: true,
    board: clearCount > 0 ? clearCompletedLines(placedBoard, rows, columns) : placedBoard,
    placedBoard,
    rows,
    columns,
    clearCount,
  };
}

export function hasValidPlacement(board, piece) {
  if (!board?.length || !piece) return false;
  const size = board.length;
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (canPlacePiece(board, piece, row, col)) return true;
    }
  }
  return false;
}

export function hasAnyMove(board, availablePieces) {
  return (availablePieces || [])
    .filter(Boolean)
    .some((piece) => !piece.used && hasValidPlacement(board, piece));
}

export function difficultyTierFor({ totalClears = 0, moves = 0 } = {}) {
  const { startTier, movesPerTier, clearsPerTier } = BLOCK_GAME_CONFIG.difficulty;
  return Math.min(4, startTier + Math.max(
    Math.floor(moves / movesPerTier), Math.floor(totalClears / clearsPerTier),
  ));
}

function poolForTier(tier) {
  // Small rescue pieces are no longer generated. Existing racks remain valid.
  return PIECE_DEFS.filter((piece) => piece.tier <= tier && piece.coords.length >= 3);
}

function makePiece(def) {
  return {
    id: `piece-${pieceCounter++}`,
    key: def.key,
    label: def.label,
    coords: def.coords.map(([row, col]) => [row, col]),
    color: def.color,
    tier: def.tier,
    used: false,
  };
}

function pickFromPool(pool, rng) {
  const weight = (piece) => piece.coords.length * (1 + piece.tier);
  let ticket = Math.floor(rng() * pool.reduce((sum, piece) => sum + weight(piece), 0));
  for (const piece of pool) {
    ticket -= weight(piece);
    if (ticket < 0) return piece;
  }
  return pool[pool.length - 1];
}

export function generateThreePieces({ board, difficultyTier = difficultyTierFor(), rng = Math.random } = {}) {
  const tier = Math.max(BLOCK_GAME_CONFIG.difficulty.startTier, Math.min(4, difficultyTier));
  const pool = poolForTier(tier);
  const blocked = pool.filter((piece) => !hasValidPlacement(board, piece));
  // Include an initially blocked shape when one exists, then draw without
  // replacement. Do not reroll an unplayable rack or inject a rescue piece.
  const selected = [pickFromPool(blocked.length ? blocked : pool, rng)];
  while (selected.length < BLOCK_GAME_CONFIG.piecesPerBatch) {
    selected.push(pickFromPool(pool.filter((piece) => !selected.includes(piece)), rng));
  }
  for (let index = selected.length - 1; index > 0; index -= 1) {
    const other = Math.floor(rng() * (index + 1));
    [selected[index], selected[other]] = [selected[other], selected[index]];
  }
  return selected.map(makePiece);
}
