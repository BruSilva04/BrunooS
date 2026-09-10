import Phaser from 'phaser';
import { MERMAID_GAME_CONFIG } from '../config.js';

const PATTERNS = [
  [-1],
  [0],
  [1],
  [-1, 1],
  [-1, 0],
  [0, 1],
];

const OBSTACLE_TYPES = [
  { key: 'CORAL', label: 'Coral cortante', severity: 'soft', avoid: 'lane', color: 0xff5f7a, accent: 0xffd1dc },
  { key: 'FISH_SCHOOL', label: 'Cardume denso', severity: 'soft', avoid: 'lane', color: 0x65d3ff, accent: 0xe0fbff },
  { key: 'JELLYFISH', label: 'Agua-viva', severity: 'soft', avoid: 'down', color: 0xb38cff, accent: 0xf3d8ff },
  { key: 'ANCHOR', label: 'Ancora suspensa', severity: 'hard', avoid: 'down', color: 0xb8c4cf, accent: 0xffffff },
  { key: 'ROCK', label: 'Rocha frontal', severity: 'hard', avoid: 'lane', color: 0x6d8292, accent: 0xd8eefc },
  { key: 'COLUMN', label: 'Coluna submersa', severity: 'hard', avoid: 'lane', color: 0xd7b46a, accent: 0xffe5a4 },
  { key: 'SEA_MINE', label: 'Mina antiga', severity: 'hard', avoid: 'lane', color: 0x472631, accent: 0xff7181 },
  { key: 'TENTACLE', label: 'Tentaculo', severity: 'soft', avoid: 'up', color: 0x8d5cff, accent: 0xe6d5ff },
  { key: 'SHIP_WRECK', label: 'Destroco', severity: 'hard', avoid: 'up', color: 0x8f5f3f, accent: 0xf3cf98 },
];

export default class ObstacleDirector {
  constructor(scene) {
    this.scene = scene;
    this.lastPatternKey = '';
  }

  difficulty(depth, multiplier, demoMode = false) {
    const depthFactor = Math.min(depth / 760, 1);
    const multFactor = Math.min(Math.max(multiplier - 1, 0) / 4.5, 1);
    const raw = demoMode ? depthFactor * 0.18 : Math.max(depthFactor, multFactor);
    return Phaser.Math.Clamp(raw, 0, 1);
  }

  travelSpeed(depth, multiplier, demoMode = false) {
    if (demoMode) return MERMAID_GAME_CONFIG.demoTravelSpeed;
    const difficulty = this.difficulty(depth, multiplier, false);
    return Phaser.Math.Linear(
      MERMAID_GAME_CONFIG.baseTravelSpeed,
      MERMAID_GAME_CONFIG.maxTravelSpeed,
      difficulty
    );
  }

  spawnInterval(depth, multiplier, demoMode = false) {
    if (demoMode) return MERMAID_GAME_CONFIG.spawnIntervalStartMs;
    const difficulty = this.difficulty(depth, multiplier, false);
    return Math.round(Phaser.Math.Linear(
      MERMAID_GAME_CONFIG.spawnIntervalStartMs,
      MERMAID_GAME_CONFIG.spawnIntervalMinMs,
      difficulty
    ));
  }

  biomeForDepth(depth) {
    return MERMAID_GAME_CONFIG.biomeThresholds.reduce((active, biome) => {
      return depth >= biome.depth ? biome : active;
    }, MERMAID_GAME_CONFIG.biomeThresholds[0]);
  }

  createWave(depth, multiplier, demoMode = false) {
    const difficulty = this.difficulty(depth, multiplier, demoMode);
    const availablePatterns = PATTERNS.filter((pattern) => {
      if (depth < 70) return pattern.length === 1;
      if (difficulty < 0.42) return pattern.length <= 1;
      return pattern.length <= 2;
    });
    const pattern = this._pickPattern(availablePatterns);
    const stagger = difficulty > 0.52 ? 0.045 : 0;

    return pattern.map((lane, index) => ({
      id: `${Date.now()}-${lane}-${index}-${Math.round(depth)}`,
      lane,
      z: 1.13 + index * stagger,
      type: this._pickType(depth, difficulty),
      resolved: false,
    }));
  }

  createTreasure(depth) {
    const lane = Phaser.Utils.Array.GetRandom(MERMAID_GAME_CONFIG.lanes);
    return {
      id: `treasure-${Date.now()}-${lane}-${Math.round(depth)}`,
      lane,
      z: 1.08,
      color: 0xffdf72,
      accent: 0x8fffe7,
      resolved: false,
    };
  }

  _pickPattern(patterns) {
    let pattern = Phaser.Utils.Array.GetRandom(patterns);
    const key = pattern.join(',');
    if (patterns.length > 1 && key === this.lastPatternKey) {
      pattern = Phaser.Utils.Array.GetRandom(patterns.filter((item) => item.join(',') !== this.lastPatternKey));
    }
    this.lastPatternKey = pattern.join(',');
    return pattern;
  }

  _pickType(depth, difficulty) {
    const biome = this.biomeForDepth(depth).key;
    const early = OBSTACLE_TYPES.filter((item) => item.severity === 'soft' || item.key === 'ROCK');
    const wreck = OBSTACLE_TYPES.filter((item) => ['CORAL', 'FISH_SCHOOL', 'JELLYFISH', 'ANCHOR', 'ROCK', 'SHIP_WRECK'].includes(item.key));
    const ruins = OBSTACLE_TYPES.filter((item) => ['COLUMN', 'ROCK', 'JELLYFISH', 'TENTACLE', 'SEA_MINE'].includes(item.key));
    const abyss = OBSTACLE_TYPES.filter((item) => ['SEA_MINE', 'TENTACLE', 'JELLYFISH', 'COLUMN', 'ROCK'].includes(item.key));
    const pool = biome === 'abyss' ? abyss : biome === 'ruins' ? ruins : biome === 'wreck' ? wreck : early;

    const weighted = pool.filter((item) => difficulty > 0.35 || item.severity === 'soft');
    return Phaser.Utils.Array.GetRandom(weighted.length ? weighted : pool);
  }
}
