export const MAP_CONFIG = {
  mapId: 'map_01_river_bend',
  startingCoins: 10000,
  startingXp: 0,
  leakPenalty: { coins: 120, xp: 6 },
  unlockRequirement: { nextMap: 'map_02', minXp: 650 },
  pathWaypoints: [
    { x: 0.02, y: 0.62 },
    { x: 0.18, y: 0.58 },
    { x: 0.33, y: 0.5 },
    { x: 0.49, y: 0.52 },
    { x: 0.66, y: 0.44 },
    { x: 0.81, y: 0.39 },
    { x: 0.96, y: 0.34 },
  ],
  buildSlots: [
    { id: 's01', x: 0.12, y: 0.47 },
    { id: 's02', x: 0.2, y: 0.69 },
    { id: 's03', x: 0.29, y: 0.4 },
    { id: 's04', x: 0.37, y: 0.63 },
    { id: 's05', x: 0.47, y: 0.39 },
    { id: 's06', x: 0.55, y: 0.64 },
    { id: 's07', x: 0.63, y: 0.33 },
    { id: 's08', x: 0.72, y: 0.58 },
    { id: 's09', x: 0.83, y: 0.31 },
    { id: 's10', x: 0.9, y: 0.52 },
  ],
};

export const TOWER_CONFIG = {
  arrow: {
    id: 'arrow',
    name: 'Arrow Tower',
    effectType: 'physical',
    levels: [
      { level: 1, cost: 500, damage: 32, range: 2.8, attackSpeed: 1.1 },
      { level: 2, cost: 450, damage: 48, range: 3.0, attackSpeed: 1.2 },
      { level: 3, cost: 700, damage: 70, range: 3.2, attackSpeed: 1.25 },
    ],
  },
  bone: {
    id: 'bone',
    name: 'Bone Tower',
    effectType: 'physical',
    levels: [
      { level: 1, cost: 700, damage: 95, range: 2.4, attackSpeed: 0.55 },
      { level: 2, cost: 600, damage: 130, range: 2.5, attackSpeed: 0.6 },
      { level: 3, cost: 900, damage: 180, range: 2.6, attackSpeed: 0.65 },
    ],
  },
  magic_fire: {
    id: 'magic_fire',
    name: 'Magic Fire',
    effectType: 'fire',
    levels: [
      { level: 1, cost: 800, damage: 26, range: 2.7, attackSpeed: 0.9, burnDps: 12, burnDuration: 2.5 },
      { level: 2, cost: 700, damage: 34, range: 2.9, attackSpeed: 0.95, burnDps: 18, burnDuration: 2.8 },
      { level: 3, cost: 1000, damage: 45, range: 3.0, attackSpeed: 1.0, burnDps: 24, burnDuration: 3.0 },
    ],
  },
  magic_wind: {
    id: 'magic_wind',
    name: 'Magic Wind',
    effectType: 'wind',
    levels: [
      { level: 1, cost: 760, damage: 20, range: 2.9, attackSpeed: 0.95, slowPercent: 22, slowDuration: 1.8 },
      { level: 2, cost: 650, damage: 28, range: 3.0, attackSpeed: 1.0, slowPercent: 28, slowDuration: 2.0 },
      { level: 3, cost: 980, damage: 36, range: 3.2, attackSpeed: 1.05, slowPercent: 34, slowDuration: 2.2 },
    ],
  },
  magic_lightning: {
    id: 'magic_lightning',
    name: 'Magic Lightning',
    effectType: 'lightning',
    levels: [
      { level: 1, cost: 900, damage: 58, range: 2.8, attackSpeed: 0.8, chainCount: 1, chainFalloff: 35 },
      { level: 2, cost: 800, damage: 78, range: 3.0, attackSpeed: 0.85, chainCount: 1, chainFalloff: 30 },
      { level: 3, cost: 1200, damage: 105, range: 3.1, attackSpeed: 0.9, chainCount: 1, chainFalloff: 25 },
    ],
  },
};

export const ENEMIES = {
  scout: { id: 'scout', hp: 180, speed: 1.35, coinReward: 70, xpReward: 6 },
  raider: { id: 'raider', hp: 320, speed: 1.0, coinReward: 105, xpReward: 10 },
  barge: { id: 'barge', hp: 560, speed: 0.78, coinReward: 160, xpReward: 16 },
};

export const WAVES = [
  { id: 1, spawnInterval: 1.0, composition: { scout: 5, raider: 5 } },
  { id: 2, spawnInterval: 0.95, composition: { scout: 5, raider: 6, barge: 1 } },
  { id: 3, spawnInterval: 0.9, composition: { scout: 6, raider: 6, barge: 2 } },
  { id: 4, spawnInterval: 0.85, composition: { scout: 8, raider: 6, barge: 2 } },
  { id: 5, spawnInterval: 0.8, composition: { scout: 8, raider: 8, barge: 2 } },
];

export const PROGRESSION = {
  xpPerWaveClear: 25,
  xpMapClear: 100,
};
