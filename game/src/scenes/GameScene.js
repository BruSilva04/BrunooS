import Phaser from 'phaser';
import { BRAND } from '../brand.js';
import {
  W,
  H,
  BLOCK_GAME_CONFIG,
  state,
  centsToMoney,
} from '../config.js';
import SoundManager from '../utils/SoundManager.js';
import { startBlockRound, fetchBlockRound, placeBlockPiece, cashoutBlockRound } from '../services/api.js';
import {
  canPlacePiece,
  createEmptyBoard,
  difficultyTierFor,
  generateThreePieces,
  getPieceBounds,
  hasAnyMove,
  resolvePlacement,
} from '../block/BlockPuzzleLogic.js';

const TUTORIAL_KEY = 'sereia_block_tutorial_seen';

const GAME_STATE = {
  STARTING: 'STARTING',
  PLAYING: 'PLAYING',
  MOVE_PENDING: 'MOVE_PENDING',
  CASHOUT_AVAILABLE: 'CASHOUT_AVAILABLE',
  CASHOUT_PENDING: 'CASHOUT_PENDING',
  CASHED_OUT: 'CASHED_OUT',
  GAME_OVER: 'GAME_OVER',
  ERROR: 'ERROR',
};

const THEME = {
  primary: 0xa78bfa,
  primaryStrong: 0x7c3aed,
  danger: 0xf43f5e,
  panelRaised: 0x1a2340,
  panel: 0x090b1a,
  panel2: 0x12172b,
  accent: 0x67e8f9,
  white: 0xffffff,
};

function money(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function uniqueCells(rows, columns, size) {
  const cells = new Map();
  rows.forEach((row) => {
    for (let col = 0; col < size; col += 1) {
      cells.set(`${row}:${col}`, [row, col]);
    }
  });
  columns.forEach((col) => {
    for (let row = 0; row < size; row += 1) {
      cells.set(`${row}:${col}`, [row, col]);
    }
  });
  return [...cells.values()];
}

export default class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'Game' });
  }

  init(data = {}) {
    const minBet = centsToMoney(BLOCK_GAME_CONFIG.minimumBetCents);
    this.bet = Math.max(minBet, Number(data.bet || minBet));
    this.demoMode = state.demoMode === true;
    this.startRequestId = crypto.randomUUID();
    this.roundId = null;
    this.roundVersion = 0;
    this.pendingAction = null;
    this.inFlight = false;
    this.lifecycle = {};
    this.errorOverlay = null;
    this.settledPayout = 0;
    this.board = createEmptyBoard();
    this.availablePieces = [];
    this.pieceViews = [];
    this.drag = null;
    this.totalClears = 0;
    this.bestCombo = 0;
    this.moves = 0;
    this.difficultyTier = 1;
    this.cashoutUnlocked = false;
    this.gameState = GAME_STATE.STARTING;
    this.resultShown = false;
    this.toast = null;
  }

  create() {
    this._syncViewport();
    [120, 360, 700].forEach((delay) => {
      this.time.delayedCall(delay, () => this._syncViewport());
    });

    this.sounds = new SoundManager();
    this._createLayout();
    this._drawBackground();
    this._createHud();
    this._createBoard();
    this._createPieceLayer();
    this._createCashoutButton();
    this._installInput();
    this._startRound();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this._cleanup());
  }

  _syncViewport() {
    if (document.activeElement && document.activeElement.blur) {
      document.activeElement.blur();
    }
    if (window.syncAppViewport) {
      window.syncAppViewport();
    }
    this.scale.refresh();
  }

  _createLayout() {
    const boardMax = Math.min(W - 28, Math.round(H * 0.49));
    this.boardPx = clamp(boardMax, 316, W - 28);
    this.boardX = Math.round((W - this.boardPx) / 2);
    this.boardY = Math.round(clamp(H * 0.155, 130, 146));

    if (this.boardY + this.boardPx > H - 214) {
      this.boardY = Math.max(102, Math.round(H - 214 - this.boardPx));
    }

    this.cellGap = 4;
    this.cellSize = (this.boardPx - this.cellGap * (BLOCK_GAME_CONFIG.boardSize + 1)) / BLOCK_GAME_CONFIG.boardSize;
    this.cellStep = this.cellSize + this.cellGap;
    this.pieceUnit = clamp(Math.round(W / 17), 20, 24);
    this.pieceY = Math.min(H - 142, this.boardY + this.boardPx + 54);
    this.cashoutY = H - 62;
  }

  _drawBackground() {
    const g = this.add.graphics();
    g.fillGradientStyle(0x090b1a, 0x090b1a, 0x090b1a, 0x090b1a, 1);
    g.fillRect(0, 0, W, H);

    g.fillStyle(0x7c3aed, 0.18);
    g.fillCircle(W - 42, 78, 86);
    g.fillStyle(0x164e63, 0.24);
    g.fillCircle(28, H * 0.42, 98);
    g.fillStyle(0x7c3aed, 0.08);
    g.fillCircle(W / 2, H - 68, 148);

    for (let i = 0; i < 18; i += 1) {
      const x = Phaser.Math.Between(14, W - 14);
      const y = Phaser.Math.Between(20, H - 84);
      const size = Phaser.Math.Between(1, 3);
      const dot = this.add.circle(x, y, size, THEME.accent, Phaser.Math.FloatBetween(0.07, 0.18));
      this.tweens.add({
        targets: dot,
        y: y - Phaser.Math.Between(12, 34),
        alpha: Phaser.Math.FloatBetween(0.04, 0.20),
        duration: Phaser.Math.Between(1500, 3200),
        yoyo: true,
        repeat: -1,
        ease: 'Sine.inOut',
      });
    }
  }

  _createHud() {
    const panel = this.add.graphics();
    panel.fillGradientStyle(0x1a2340, 0x1a2340, 0x12172b, 0x12172b, 1);
    panel.fillRoundedRect(12, 12, W - 24, 90, 10);
    panel.lineStyle(1, THEME.primary, 0.38);
    panel.strokeRoundedRect(12, 12, W - 24, 90, 10);

    this.add.text(28, 24, 'SALDO', {
      fontSize: '10px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#a3aecb',
    });
    this.balanceText = this.add.text(28, 40, money(state.balance), {
      fontSize: '17px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#f4f7ff',
    });

    this.betCaption = this.add.text(W - 28, 24, '', {
      fontSize: '10px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#a3aecb',
    }).setOrigin(1, 0);
    this.betText = this.add.text(W - 28, 40, money(this.bet), {
      fontSize: '17px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#f4f7ff',
    }).setOrigin(1, 0);

    this.valueCaption = this.add.text(W / 2, 26, '', {
      fontSize: '10px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#67e8f9',
    }).setOrigin(0.5, 0);
    this.valueText = this.add.text(W / 2, 42, money(this._currentValue()), {
      fontSize: '24px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#a78bfa',
      stroke: '#1a2340',
      strokeThickness: 4,
    }).setOrigin(0.5, 0);

    this.progressText = this.add.text(W / 2, 76, '', {
      fontSize: '12px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#e0e7ff',
    }).setOrigin(0.5, 0);

    this.modeText = this.add.text(W / 2, 106, 'Carregando rodada…', {
      fontSize: '10px',
      fontFamily: 'Arial, sans-serif',
      color: '#a3aecb',
    }).setOrigin(0.5, 0);
  }

  _createBoard() {
    this.boardBaseGfx = this.add.graphics();
    this.blockGfx = this.add.graphics().setDepth(12);
    this.ghostGfx = this.add.graphics().setDepth(14);
    this.clearLayer = this.add.container(0, 0).setDepth(18);
    this._drawBoardBase();
    this._drawBlocks();
  }

  _drawBoardBase() {
    const g = this.boardBaseGfx;
    const pad = 8;
    g.clear();
    g.fillStyle(0x000000, 0.24);
    g.fillRoundedRect(this.boardX - 4, this.boardY + 8, this.boardPx + 8, this.boardPx + 8, 12);
    g.fillGradientStyle(0x12172b, 0x12172b, 0x090b1a, 0x090b1a, 1);
    g.fillRoundedRect(this.boardX - pad, this.boardY - pad, this.boardPx + pad * 2, this.boardPx + pad * 2, 12);
    g.lineStyle(2, THEME.primary, 0.52);
    g.strokeRoundedRect(this.boardX - pad, this.boardY - pad, this.boardPx + pad * 2, this.boardPx + pad * 2, 12);

    for (let row = 0; row < BLOCK_GAME_CONFIG.boardSize; row += 1) {
      for (let col = 0; col < BLOCK_GAME_CONFIG.boardSize; col += 1) {
        const { x, y } = this._cellRect(row, col);
        const tint = (row + col) % 2 === 0 ? 0x1a2340 : 0x202a49;
        g.fillStyle(tint, 0.98);
        g.fillRoundedRect(x, y, this.cellSize, this.cellSize, 6);
        g.lineStyle(1, 0xa78bfa, 0.06);
        g.strokeRoundedRect(x, y, this.cellSize, this.cellSize, 6);
      }
    }
  }

  _createPieceLayer() {
    this.rackGfx = this.add.graphics();
    this.rackGfx.fillStyle(0x090b1a, 0.84);
    this.rackGfx.fillRoundedRect(14, this.pieceY - 58, W - 28, 116, 10);
    this.rackGfx.lineStyle(1, 0xa78bfa, 0.62);
    this.rackGfx.strokeRoundedRect(14, this.pieceY - 58, W - 28, 116, 10);
    this.add.text(W / 2, this.pieceY - 50, 'PECAS DISPONIVEIS', {
      fontSize: '11px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#a78bfa',
    }).setOrigin(0.5, 0);
  }

  _createCashoutButton() {
    this.cashoutGfx = this.add.graphics().setDepth(30);
    this.cashoutLabel = this.add.text(W / 2, this.cashoutY - 8, '', {
      fontSize: '17px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#f4f7ff',
      stroke: '#1a2340',
      strokeThickness: 4,
    }).setOrigin(0.5).setDepth(31);
    this.cashoutSub = this.add.text(W / 2, this.cashoutY + 14, '', {
      fontSize: '10px',
      fontFamily: 'Arial, sans-serif',
      color: '#ffe8ac',
    }).setOrigin(0.5).setDepth(31);
    this.cashoutZone = this.add.zone(W / 2, this.cashoutY, W - 40, 58)
      .setInteractive({ useHandCursor: true })
      .setDepth(32);
    this.cashoutZone.on('pointerdown', () => this._cashOut());
    this._drawCashoutButton();
  }

  _installInput() {
    this.input.on('pointermove', (pointer) => this._updateDrag(pointer));
    this.input.on('pointerup', (pointer) => this._endDrag(pointer));
    this.input.on('pointerupoutside', (pointer) => this._endDrag(pointer));
    this.input.on('gameout', () => this._endDrag(null));
  }

  async _startRound() {
    if (this.inFlight) return;
    this.inFlight = true;
    const lifecycle = this.lifecycle;
    this.gameState = GAME_STATE.STARTING;
    this._updateModeLabels();
    this._drawCashoutButton();
    try {
      const response = await startBlockRound(this.bet, this.startRequestId);
      if (this.lifecycle !== lifecycle) return;
      this.demoMode = response.demo_mode === true;
      state.demoMode = this.demoMode;
      state.balance = Number(response.balance);
      this.bet = Number(response.bet);
      if (this.demoMode) {
        state.activeBlockRound = null;
        this._startDemoRound();
      } else {
        this._acceptRound(response);
      }
      this._updateModeLabels();
      if (!this.resultShown && !this._tutorialSeen()) this._showTutorial();
    } catch (error) {
      if (this.lifecycle !== lifecycle) return;
      this._showRoundError(error.message, () => this._startRound());
    } finally {
      if (this.lifecycle === lifecycle) this.inFlight = false;
    }
  }

  _updateModeLabels() {
    this.betCaption?.setText(this.demoMode ? 'VALOR SIMULADO' : 'APOSTA');
    this.valueCaption?.setText(this.demoMode ? 'VALOR DEMO' : 'RESGATE');
    this.betText?.setText(money(this.bet));
    this.balanceText?.setText(money(state.balance));
    this.modeText?.setText(this.gameState === GAME_STATE.STARTING ? 'Carregando rodada…'
      : this.demoMode ? 'DEMO ADMIN · sem movimentação de saldo real' : 'SALDO REAL · rodada salva automaticamente');
  }

  _acceptRound(response) {
    if (!response.round_id || response.demo_mode !== false) throw new Error('Resposta inválida da rodada.');
    this.roundId = response.round_id;
    this.roundVersion = response.version;
    this.bet = response.bet;
    this.board = response.board;
    this.availablePieces = response.pieces;
    this.moves = response.moves;
    this.totalClears = response.total_clears;
    this.bestCombo = response.best_combo;
    this.difficultyTier = response.difficulty_tier;
    this.cashoutUnlocked = response.cashout_unlocked;
    this.settledPayout = response.payout;
    state.balance = response.balance;
    state.activeBlockRound = response.status === 'active' ? { round_id: this.roundId, bet: this.bet } : null;
    this.pendingAction = null;
    this.gameState = response.status === 'won' ? GAME_STATE.CASHED_OUT
      : response.status === 'lost' ? GAME_STATE.GAME_OVER
        : this.cashoutUnlocked ? GAME_STATE.CASHOUT_AVAILABLE : GAME_STATE.PLAYING;
    this._drawBlocks();
    this._renderPieces();
    this._updateHud();
    this._updateModeLabels();
    this._drawCashoutButton();
    if (response.status === 'won') {
      this.sounds.playCashout();
      this._showResult(true);
    } else if (response.status === 'lost') {
      this.sounds.playGameOver();
      this._showResult(false);
    }
  }

  async _sendPendingAction() {
    if (this.inFlight || !this.pendingAction) return;
    const lifecycle = this.lifecycle;
    const action = this.pendingAction;
    this.inFlight = true;
    this.gameState = action.kind === 'move' ? GAME_STATE.MOVE_PENDING : GAME_STATE.CASHOUT_PENDING;
    this._drawCashoutButton();
    try {
      const send = action.kind === 'move' ? placeBlockPiece : cashoutBlockRound;
      const response = await send(this.roundId, action.payload);
      if (this.lifecycle !== lifecycle) return;
      this._acceptRound(response);
    } catch (error) {
      if (this.lifecycle !== lifecycle) return;
      this._showRoundError(error.message, error.status === 409 || error.status === 422
        ? () => this._syncRound() : () => this._sendPendingAction());
    } finally {
      if (this.lifecycle === lifecycle) this.inFlight = false;
    }
  }

  async _syncRound() {
    const lifecycle = this.lifecycle;
    try {
      const response = await fetchBlockRound(this.roundId);
      if (this.lifecycle === lifecycle) this._acceptRound(response);
    } catch (error) {
      if (this.lifecycle === lifecycle) this._showRoundError(error.message, () => this._syncRound());
    }
  }

  _showRoundError(message, retry) {
    this.gameState = GAME_STATE.ERROR;
    this._clearDrag();
    this.errorOverlay?.destroy(true);
    const overlay = this.add.container(0, 0).setDepth(110);
    const py = Math.max(110, H / 2 - 145);
    const dim = this.add.rectangle(0, 0, W, H, 0x000000, 0.8).setOrigin(0).setInteractive();
    const panel = this.add.rectangle(W / 2, py + 145, W - 40, 290, THEME.panelRaised);
    const title = this.add.text(W / 2, py + 34, 'RODADA PAUSADA', {
      fontSize: '19px', fontFamily: 'Arial, sans-serif', color: '#f4f7ff', fontStyle: 'bold',
    }).setOrigin(0.5);
    const body = this.add.text(W / 2, py + 108, message, {
      fontSize: '14px', fontFamily: 'Arial, sans-serif', color: '#a3aecb',
      wordWrap: { width: W - 82 }, align: 'center', lineSpacing: 5,
    }).setOrigin(0.5);
    const retryButton = this._makePanelButton(W / 2, py + 200, W - 80, 45, 'TENTAR NOVAMENTE', true, () => {
      overlay.destroy(true); this.errorOverlay = null; retry();
    });
    const lobby = this._makePanelButton(W / 2, py + 250, W - 80, 38, 'VOLTAR AO LOBBY', false, () => this.scene.start('Lobby'));
    overlay.add([dim, panel, title, body, retryButton, lobby]);
    this.errorOverlay = overlay;
    this._drawCashoutButton();
  }

  _startDemoRound() {
    this.board = createEmptyBoard();
    this.totalClears = 0;
    this.bestCombo = 0;
    this.moves = 0;
    this.cashoutUnlocked = false;
    this.resultShown = false;
    this.gameState = GAME_STATE.PLAYING;
    this._generateBatch();
    this._updateHud();
    this._drawCashoutButton();
  }

  _generateBatch() {
    this.difficultyTier = difficultyTierFor({
      totalClears: this.totalClears,
      moves: this.moves,
    });
    this.availablePieces = generateThreePieces({
      board: this.board,
      difficultyTier: this.difficultyTier,
    });
    this._renderPieces();
    return this.availablePieces.length > 0 && hasAnyMove(this.board, this.availablePieces);
  }

  _renderPieces() {
    this.pieceViews.forEach((view) => {
      if (view?.container) view.container.destroy(true);
    });
    this.pieceViews = [];

    const slotWidth = W / BLOCK_GAME_CONFIG.piecesPerBatch;
    this.availablePieces.forEach((piece, index) => {
      if (piece.used) return;
      const homeX = Math.round(slotWidth * (index + 0.5));
      const homeY = this.pieceY + 14;
      const container = this.add.container(homeX, homeY).setDepth(22);
      const shadow = this.add.graphics();
      shadow.setPosition(4, 7);
      this._drawPieceGraphic(shadow, piece, this.pieceUnit, 0x000000, 0.26);

      const gfx = this.add.graphics();
      this._drawPieceGraphic(gfx, piece, this.pieceUnit);

      const zone = this.add.zone(0, 0, 116, 96)
        .setInteractive({ useHandCursor: true });
      container.add([shadow, gfx, zone]);

      const view = {
        piece,
        container,
        gfx,
        shadow,
        zone,
        homeX,
        homeY,
      };
      zone.on('pointerdown', (pointer) => this._startDrag(pointer, index));
      this.pieceViews[index] = view;
    });
  }

  _drawPieceGraphic(graphics, piece, unit, overrideColor = null, alpha = 1) {
    const gap = 4;
    const bounds = getPieceBounds(piece);
    const width = bounds.cols * unit + Math.max(0, bounds.cols - 1) * gap;
    const height = bounds.rows * unit + Math.max(0, bounds.rows - 1) * gap;
    const startX = -width / 2;
    const startY = -height / 2;

    graphics.clear();
    piece.coords.forEach(([row, col]) => {
      const x = startX + col * (unit + gap);
      const y = startY + row * (unit + gap);
      graphics.fillStyle(overrideColor || piece.color, alpha);
      graphics.fillRoundedRect(x, y, unit, unit, 6);
      if (!overrideColor) {
        graphics.fillStyle(0xffffff, 0.18);
        graphics.fillRoundedRect(x + 3, y + 3, unit - 6, Math.max(4, unit * 0.28), 4);
        graphics.lineStyle(1, 0xffffff, 0.24);
        graphics.strokeRoundedRect(x, y, unit, unit, 6);
      }
    });
  }

  _startDrag(pointer, index) {
    if (!this._canPlayInput()) return;
    const view = this.pieceViews[index];
    if (!view || view.piece.used) return;

    this.drag = {
      view,
      pointerId: pointer.id,
      offset: clamp(Math.round(H * 0.078), BLOCK_GAME_CONFIG.dragOffsetMin, BLOCK_GAME_CONFIG.dragOffsetMax),
      candidate: null,
    };

    view.container.setDepth(42);
    view.container.setScale(1.12);
    this.sounds.playPickPiece();
    this._haptic(8);
    this._updateDrag(pointer);
  }

  _updateDrag(pointer) {
    if (!this.drag || !pointer || pointer.id !== this.drag.pointerId) return;
    const { view, offset } = this.drag;
    view.container.setPosition(pointer.x, pointer.y - offset);

    const candidate = this._candidateForPiece(view.piece, view.container.x, view.container.y);
    this.drag.candidate = candidate;
    this._drawGhost(view.piece, candidate);
  }

  _endDrag(pointer) {
    if (!this.drag) return;
    if (pointer && pointer.id !== this.drag.pointerId) return;

    const { view, candidate } = this.drag;
    this._clearDrag();

    if (candidate?.valid) {
      this._placePiece(view.piece, candidate.row, candidate.col, view);
      return;
    }

    this.sounds.playInvalidPlace();
    this._haptic(12);
    this.tweens.add({
      targets: view.container,
      x: view.homeX,
      y: view.homeY,
      scale: 1,
      duration: 180,
      ease: 'Cubic.easeOut',
      onComplete: () => view.container.setDepth(22),
    });
  }

  _candidateForPiece(piece, centerX, centerY) {
    const bounds = getPieceBounds(piece);
    const pieceWidth = bounds.cols * this.cellStep - this.cellGap;
    const pieceHeight = bounds.rows * this.cellStep - this.cellGap;
    const topLeftX = centerX - pieceWidth / 2;
    const topLeftY = centerY - pieceHeight / 2;
    const col = Math.round((topLeftX - (this.boardX + this.cellGap)) / this.cellStep);
    const row = Math.round((topLeftY - (this.boardY + this.cellGap)) / this.cellStep);
    return {
      row,
      col,
      valid: canPlacePiece(this.board, piece, row, col),
    };
  }

  _drawGhost(piece, candidate) {
    this.ghostGfx.clear();
    if (!candidate) return;

    const color = candidate.valid ? THEME.accent : THEME.danger;
    const alpha = candidate.valid ? 0.42 : 0.28;
    piece.coords.forEach(([rowOffset, colOffset]) => {
      const row = candidate.row + rowOffset;
      const col = candidate.col + colOffset;
      if (row < 0 || col < 0 || row >= BLOCK_GAME_CONFIG.boardSize || col >= BLOCK_GAME_CONFIG.boardSize) return;
      const { x, y } = this._cellRect(row, col);
      this.ghostGfx.fillStyle(color, alpha);
      this.ghostGfx.fillRoundedRect(x, y, this.cellSize, this.cellSize, 6);
      this.ghostGfx.lineStyle(2, color, 0.75);
      this.ghostGfx.strokeRoundedRect(x + 1, y + 1, this.cellSize - 2, this.cellSize - 2, 6);
    });
  }

  _placePiece(piece, row, col, view) {
    if (!this._canPlayInput()) return;
    const placement = resolvePlacement(this.board, piece, row, col);
    if (!placement.ok) return;
    if (!this.demoMode) {
      this.pendingAction = { kind: 'move', payload: {
        action_id: crypto.randomUUID(), version: this.roundVersion, piece_id: piece.id, row, col,
      } };
    }
    piece.used = true;
    this.moves += 1;
    this.bestCombo = Math.max(this.bestCombo, placement.clearCount);
    this.totalClears += placement.clearCount;
    // Commit the visual clear immediately. Effects never lock the board.
    this.board = placement.board;
    view.container.destroy(true);
    view.container = null;
    this.sounds.playPlacePiece();
    this._haptic(10);
    this._drawBlocks();
    this._updateHud();
    if (placement.clearCount > 0) {
      this.sounds.playClearLine();
      this._haptic(18);
      this._animateClear(placement.rows, placement.columns);
      this._showToast(placement.clearCount >= 2 ? `${placement.clearCount} LINHAS!` : 'BOA!');
    }
    if (this.demoMode) this._afterMove(placement.clearCount);
    else this._sendPendingAction();
  }

  _afterMove(clearCount) {
    if (!this.cashoutUnlocked && this.totalClears >= BLOCK_GAME_CONFIG.clearsToUnlockCashout) {
      this.cashoutUnlocked = true;
      this.gameState = GAME_STATE.CASHOUT_AVAILABLE;
      this.sounds.playCashoutUnlocked();
      this._haptic([18, 28, 18]);
      this._showToast('RESGATE LIBERADO');
    } else if (this.cashoutUnlocked) {
      this.gameState = GAME_STATE.CASHOUT_AVAILABLE;
    } else {
      this.gameState = GAME_STATE.PLAYING;
    }

    if (this.availablePieces.every((piece) => piece.used)) {
      if (!this._generateBatch()) {
        this._gameOver();
        return;
      }
    } else if (!hasAnyMove(this.board, this.availablePieces)) {
      this._gameOver();
      return;
    }

    this._updateHud();
    this._drawCashoutButton();
  }

  _animateClear(rows, columns) {
    const cells = uniqueCells(rows, columns, BLOCK_GAME_CONFIG.boardSize);
    if (!cells.length) return;
    const flashes = cells.map(([row, col]) => {
      const { cx, cy } = this._cellRect(row, col);
      const flash = this.add.rectangle(cx, cy, this.cellSize, this.cellSize, THEME.primary, 0.74).setDepth(19);
      this.clearLayer.add(flash);
      return flash;
    });
    this.tweens.add({
      targets: flashes, scale: 1.12, alpha: 0,
      duration: BLOCK_GAME_CONFIG.clearAnimationMs, ease: 'Cubic.easeOut',
      onComplete: () => flashes.forEach((flash) => flash.destroy()),
    });
  }

  _drawBlocks() {
    this.blockGfx.clear();
    for (let row = 0; row < BLOCK_GAME_CONFIG.boardSize; row += 1) {
      for (let col = 0; col < BLOCK_GAME_CONFIG.boardSize; col += 1) {
        if (!this.board[row][col]) continue;
        const { x, y } = this._cellRect(row, col);
        const color = (row + col) % 3 === 0 ? THEME.primary : ((row + col) % 3 === 1 ? THEME.accent : THEME.accent);
        this.blockGfx.fillStyle(0x000000, 0.22);
        this.blockGfx.fillRoundedRect(x + 2, y + 3, this.cellSize, this.cellSize, 6);
        this.blockGfx.fillStyle(color, 1);
        this.blockGfx.fillRoundedRect(x, y, this.cellSize, this.cellSize, 6);
        this.blockGfx.fillStyle(0xffffff, 0.16);
        this.blockGfx.fillRoundedRect(x + 4, y + 4, this.cellSize - 8, Math.max(5, this.cellSize * 0.25), 4);
        this.blockGfx.lineStyle(1, 0xffffff, 0.22);
        this.blockGfx.strokeRoundedRect(x, y, this.cellSize, this.cellSize, 6);
      }
    }
  }

  _cellRect(row, col) {
    const x = this.boardX + this.cellGap + col * this.cellStep;
    const y = this.boardY + this.cellGap + row * this.cellStep;
    return {
      x,
      y,
      cx: x + this.cellSize / 2,
      cy: y + this.cellSize / 2,
    };
  }

  _currentMultiplier() {
    const value = BLOCK_GAME_CONFIG.baseValueMultiplier
      + this.totalClears * BLOCK_GAME_CONFIG.clearValueStep
      + this.moves * BLOCK_GAME_CONFIG.moveValueStep;
    return Math.min(BLOCK_GAME_CONFIG.maxMultiplier, Math.round(Math.round(value * 1000) / 10) / 100);
  }

  _currentValue() {
    return Number((this.bet * this._currentMultiplier()).toFixed(2));
  }

  _updateHud() {
    if (!this.valueText || !this.progressText) return;
    const progress = Math.min(this.totalClears, BLOCK_GAME_CONFIG.clearsToUnlockCashout);
    this.valueText.setText(money(this._currentValue()));
    this.progressText.setText(`RESGATE ${progress}/${BLOCK_GAME_CONFIG.clearsToUnlockCashout}  |  NÍVEL ${this.difficultyTier}  |  ${this.moves} JOGADAS`);
  }

  _drawCashoutButton() {
    if (!this.cashoutGfx) return;
    const unlocked = this.cashoutUnlocked;
    const pending = [GAME_STATE.STARTING, GAME_STATE.MOVE_PENDING, GAME_STATE.CASHOUT_PENDING, GAME_STATE.ERROR].includes(this.gameState);
    const done = this.resultShown || this.gameState === GAME_STATE.GAME_OVER;
    const x = 20;
    const y = this.cashoutY - 29;
    const width = W - 40;
    const height = 58;

    this.cashoutGfx.clear();
    if (unlocked && !pending && !done) {
      this.cashoutGfx.fillGradientStyle(0xa78bfa, 0xa78bfa, 0x67e8f9, 0x67e8f9, 1);
      this.cashoutGfx.fillRoundedRect(x, y, width, height, 10);
      this.cashoutGfx.lineStyle(2, 0xffffff, 0.36);
      this.cashoutGfx.strokeRoundedRect(x, y, width, height, 10);
      this.cashoutLabel.setText(`RESGATAR ${money(this._currentValue())}`);
      this.cashoutLabel.setColor('#090b1a');
      this.cashoutSub.setText(this.demoMode ? 'modo demo admin' : 'crédito no saldo após confirmação');
      return;
    }

    this.cashoutGfx.fillGradientStyle(0x1a2340, 0x1a2340, 0x12172b, 0x12172b, 1);
    this.cashoutGfx.fillRoundedRect(x, y, width, height, 10);
    this.cashoutGfx.lineStyle(1, 0xa78bfa, 0.24);
    this.cashoutGfx.strokeRoundedRect(x, y, width, height, 10);

    if (pending) {
      this.cashoutLabel.setText('CONFIRMANDO...');
      this.cashoutSub.setText(this.gameState === GAME_STATE.ERROR ? 'aguardando reconexão' : 'aguarde a confirmação da rodada');
    } else if (done) {
      this.cashoutLabel.setText('RODADA FINALIZADA');
      this.cashoutSub.setText('veja o resultado');
    } else {
      const remaining = Math.max(0, BLOCK_GAME_CONFIG.clearsToUnlockCashout - this.totalClears);
      this.cashoutLabel.setText(`RESGATE LIBERA EM ${remaining}`);
      this.cashoutSub.setText('complete linhas ou colunas');
    }
    this.cashoutLabel.setColor('#f4f7ff');
  }

  _cashOut() {
    if (this.resultShown || !this._canPlayInput()) return;
    if (!this.cashoutUnlocked) {
      this.sounds.playInvalidPlace();
      this._showToast('COMPLETE 3 LINHAS OU COLUNAS');
      return;
    }
    this._clearDrag();
    if (this.demoMode) {
      this.gameState = GAME_STATE.CASHED_OUT;
      this.sounds.playCashout();
      this._showResult(true);
      return;
    }
    this.pendingAction = { kind: 'cashout', payload: {
      action_id: crypto.randomUUID(), version: this.roundVersion,
    } };
    this._sendPendingAction();
  }

  _gameOver() {
    if (this.resultShown) return;
    this._clearDrag();
    this.gameState = GAME_STATE.GAME_OVER;
    this.sounds.playGameOver();
    this._haptic([28, 44, 28]);
    this.cameras.main.shake(180, 0.006);
    this._drawCashoutButton();
    this._showResult(false);
  }

  _showResult(won) {
    if (this.resultShown) return;
    this.resultShown = true;
    this._clearDrag();
    this._drawCashoutButton();

    const overlay = this.add.container(0, 0).setDepth(80);
    const dim = this.add.rectangle(0, 0, W, H, 0x000000, 0.72).setOrigin(0).setInteractive();
    const px = 24;
    const py = Math.max(118, H / 2 - 176);
    const pw = W - 48;
    const ph = 352;
    const panel = this.add.graphics();
    panel.fillGradientStyle(0x1a2340, 0x1a2340, 0x090b1a, 0x090b1a, 1);
    panel.fillRoundedRect(px, py, pw, ph, 12);
    panel.lineStyle(2, won ? THEME.primary : THEME.danger, 0.62);
    panel.strokeRoundedRect(px, py, pw, ph, 12);

    const title = this.add.text(W / 2, py + 42, won ? 'RESGATE CONCLUIDO' : 'FIM DA RODADA', {
      fontSize: '20px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: won ? '#a78bfa' : '#ff9aa9',
      stroke: '#090b1a',
      strokeThickness: 5,
    }).setOrigin(0.5);

    const value = this.add.text(W / 2, py + 92, won ? money(this.demoMode ? this._currentValue() : this.settledPayout) : money(0), {
      fontSize: '34px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: won ? '#67e8f9' : '#f4f7ff',
      stroke: '#12172b',
      strokeThickness: won ? 5 : 0,
    }).setOrigin(0.5);

    const details = this.add.text(W / 2, py + 154, [
      `Linhas/colunas: ${this.totalClears}`,
      `Melhor combo: ${this.bestCombo}`,
      `Jogadas: ${this.moves}`,
      `Tier: ${this.difficultyTier}`,
    ].join('\n'), {
      fontSize: '14px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#f4f7ff',
      align: 'center',
      lineSpacing: 7,
    }).setOrigin(0.5);

    const note = this.add.text(W / 2, py + 218, this.demoMode
      ? 'Modo demo admin: nenhum saldo real foi debitado ou creditado.'
      : won ? `Resgate creditado. Saldo: ${money(state.balance)}` : `Aposta encerrada sem resgate. Saldo: ${money(state.balance)}`, {
      fontSize: '12px',
      fontFamily: 'Arial, sans-serif',
      color: '#a3aecb',
      align: 'center',
      wordWrap: { width: pw - 42 },
      lineSpacing: 4,
    }).setOrigin(0.5);

    const replay = this._makePanelButton(W / 2, py + 274, pw - 50, 46, 'JOGAR NOVAMENTE', true, () => {
      this.scene.restart({ bet: this.bet });
    });
    const lobby = this._makePanelButton(W / 2, py + 326, pw - 50, 40, 'VOLTAR AO LOBBY', false, () => {
      this.scene.start('Lobby', { balance: state.balance });
    });

    overlay.add([dim, panel, title, value, details, note, replay, lobby]);
  }

  _makePanelButton(x, y, width, height, text, primary, handler) {
    const container = this.add.container(x, y);
    const bg = this.add.graphics();
    bg.fillGradientStyle(
      primary ? 0xa78bfa : 0x17233a,
      primary ? 0xa78bfa : 0x17233a,
      primary ? 0xc4b5fd : 0x12172b,
      primary ? 0xc4b5fd : 0x12172b,
      1
    );
    bg.fillRoundedRect(-width / 2, -height / 2, width, height, 8);
    bg.lineStyle(1, primary ? 0xffffff : 0x67e8f9, primary ? 0.42 : 0.26);
    bg.strokeRoundedRect(-width / 2, -height / 2, width, height, 8);
    const label = this.add.text(0, 0, text, {
      fontSize: primary ? '15px' : '12px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: primary ? '#090b1a' : '#e0e7ff',
    }).setOrigin(0.5);
    const zone = this.add.zone(0, 0, width, height).setInteractive({ useHandCursor: true });
    zone.on('pointerdown', handler);
    container.add([bg, label, zone]);
    return container;
  }

  _showTutorial() {
    const overlay = this.add.container(0, 0).setDepth(90);
    const dim = this.add.rectangle(0, 0, W, H, 0x000000, 0.76).setOrigin(0).setInteractive();
    const px = 24;
    const py = Math.max(104, H / 2 - 192);
    const pw = W - 48;
    const ph = 384;
    const panel = this.add.graphics();
    panel.fillGradientStyle(0x1a2340, 0x1a2340, 0x090b1a, 0x090b1a, 1);
    panel.fillRoundedRect(px, py, pw, ph, 12);
    panel.lineStyle(2, THEME.primary, 0.58);
    panel.strokeRoundedRect(px, py, pw, ph, 12);

    const title = this.add.text(W / 2, py + 42, BRAND.upperName, {
      fontSize: '22px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#a78bfa',
      stroke: '#1a2340',
      strokeThickness: 5,
    }).setOrigin(0.5);

    const body = this.add.text(W / 2, py + 142, [
      'Arraste as pecas para o tabuleiro.',
      'Complete linhas ou colunas para limpar.',
      this.demoMode ? 'Com 3 limpezas, o resgate demo libera.' : 'Com 3 limpezas, você pode resgatar.',
      'Se nenhuma peca couber, a rodada termina.',
    ].join('\n'), {
      fontSize: '14px',
      fontFamily: 'Arial, sans-serif',
      color: '#f4f7ff',
      align: 'center',
      lineSpacing: 10,
      wordWrap: { width: pw - 42 },
    }).setOrigin(0.5);

    const button = this._makePanelButton(W / 2, py + 320, pw - 70, 48, 'ENTENDI', true, () => {
      try {
        window.localStorage.setItem(TUTORIAL_KEY, 'true');
      } catch {}
      overlay.destroy(true);
    });

    overlay.add([dim, panel, title, body, button]);
  }

  _tutorialSeen() {
    try {
      return window.localStorage.getItem(TUTORIAL_KEY) === 'true';
    } catch {
      return false;
    }
  }

  _showToast(message) {
    if (this.toast) this.toast.destroy();
    const y = Math.max(118, this.boardY - 28);
    const toast = this.add.text(W / 2, y, message, {
      fontSize: '13px',
      fontFamily: '"Arial Black", Arial, sans-serif',
      color: '#090b1a',
      backgroundColor: '#a78bfa',
      padding: { x: 12, y: 8 },
    }).setOrigin(0.5).setDepth(70);
    this.toast = toast;
    this.tweens.add({
      targets: toast,
      y: y - 16,
      alpha: 0,
      delay: 760,
      duration: 260,
      ease: 'Sine.easeOut',
      onComplete: () => {
        toast.destroy();
        if (this.toast === toast) this.toast = null;
      },
    });
  }

  _canPlayInput() {
    return this.gameState === GAME_STATE.PLAYING || this.gameState === GAME_STATE.CASHOUT_AVAILABLE;
  }

  _clearDrag() {
    this.ghostGfx?.clear();
    if (this.drag?.view?.container) {
      this.drag.view.container.setScale(1);
      this.drag.view.container.setDepth(22);
    }
    this.drag = null;
  }

  _haptic(pattern) {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(pattern);
    }
  }

  _cleanup() {
    this.lifecycle = null;
    this._clearDrag();
    this.pieceViews.forEach((view) => {
      if (view?.container) view.container.destroy(true);
    });
    this.pieceViews = [];
  }
}
