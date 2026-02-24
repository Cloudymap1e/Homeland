const MAX_TOWER_LEVEL = 50;
const ANCHOR_LEVELS = [1, 10, 20, 30, 40, 50];

function roundTo(value, digits = 2) {
  return Number(value.toFixed(digits));
}

function interpolateAnchors(level, anchors) {
  if (anchors.length !== ANCHOR_LEVELS.length) {
    throw new Error('Anchor count must match ANCHOR_LEVELS count.');
  }

  if (level <= ANCHOR_LEVELS[0]) {
    return anchors[0];
  }

  for (let i = 1; i < ANCHOR_LEVELS.length; i += 1) {
    const leftLevel = ANCHOR_LEVELS[i - 1];
    const rightLevel = ANCHOR_LEVELS[i];
    if (level <= rightLevel) {
      const t = (level - leftLevel) / (rightLevel - leftLevel);
      return anchors[i - 1] + (anchors[i] - anchors[i - 1]) * t;
    }
  }

  return anchors[anchors.length - 1];
}

function intFromAnchors(level, anchors) {
  return Math.round(interpolateAnchors(level, anchors));
}

function floatFromAnchors(level, anchors, digits = 2) {
  return roundTo(interpolateAnchors(level, anchors), digits);
}

function costFromAnchors(level, anchors) {
  return Math.max(60, Math.round(intFromAnchors(level, anchors) / 5) * 5);
}

function createArrowLevels() {
  const levels = [];
  for (let level = 1; level <= MAX_TOWER_LEVEL; level += 1) {
    levels.push({
      level,
      cost: costFromAnchors(level, [460, 820, 1550, 2750, 4600, 7400]),
      damage: intFromAnchors(level, [40, 110, 206, 318, 455, 620]),
      range: floatFromAnchors(level, [2.86, 3.06, 3.26, 3.46, 3.64, 3.82]),
      attackSpeed: floatFromAnchors(level, [1.14, 1.5, 1.84, 2.18, 2.46, 2.8]),
    });
  }
  return levels;
}

function createBombLevels() {
  const levels = [];
  for (let level = 1; level <= MAX_TOWER_LEVEL; level += 1) {
    levels.push({
      level,
      cost: costFromAnchors(level, [780, 1560, 2940, 5300, 9200, 15600]),
      damage: intFromAnchors(level, [112, 198, 324, 486, 682, 890]),
      range: floatFromAnchors(level, [2.6, 2.75, 2.9, 3.05, 3.2, 3.35]),
      attackSpeed: floatFromAnchors(level, [0.5, 0.61, 0.72, 0.85, 0.98, 1.1]),
      splashRadius: floatFromAnchors(level, [1.34, 1.52, 1.74, 1.96, 2.18, 2.4]),
      splashFalloff: intFromAnchors(level, [46, 45, 43, 41, 39, 36]),
    });
  }
  return levels;
}

function createFireLevels() {
  const levels = [];
  for (let level = 1; level <= MAX_TOWER_LEVEL; level += 1) {
    levels.push({
      level,
      cost: costFromAnchors(level, [900, 2260, 4400, 8200, 14200, 23800]),
      damage: intFromAnchors(level, [42, 56, 82, 116, 156, 206]),
      range: floatFromAnchors(level, [2.8, 3.0, 3.2, 3.4, 3.6, 3.8]),
      attackSpeed: floatFromAnchors(level, [0.68, 0.81, 0.93, 1.04, 1.15, 1.26]),
      fireballDps: intFromAnchors(level, [40, 56, 84, 118, 162, 214]),
      fireballDuration: 3.0,
      fireballRadius: floatFromAnchors(level, [0.7, 0.78, 0.86, 0.94, 1.03, 1.12]),
    });
  }
  return levels;
}

function windTargetsByLevel(level) {
  if (level <= 17) {
    return 3;
  }
  if (level <= 34) {
    return 5;
  }
  return 6;
}

function createWindLevels() {
  const levels = [];
  for (let level = 1; level <= MAX_TOWER_LEVEL; level += 1) {
    levels.push({
      level,
      cost: costFromAnchors(level, [820, 1560, 2920, 5300, 9300, 15600]),
      damage: intFromAnchors(level, [17, 62, 124, 194, 278, 374]),
      range: floatFromAnchors(level, [3.05, 3.28, 3.5, 3.72, 3.94, 4.14]),
      attackSpeed: floatFromAnchors(level, [0.9, 1.15, 1.4, 1.66, 1.94, 2.16]),
      slowPercent: intFromAnchors(level, [39, 54, 64, 72, 80, 86]),
      slowDuration: floatFromAnchors(level, [2.1, 2.6, 3.1, 3.5, 3.9, 4.4]),
      windTargets: windTargetsByLevel(level),
    });
  }
  return levels;
}

function lightningChainsByLevel(level) {
  if (level <= 20) {
    return 1;
  }
  if (level <= 35) {
    return 2;
  }
  if (level <= 45) {
    return 3;
  }
  return 4;
}

function createLightningLevels() {
  const levels = [];
  for (let level = 1; level <= MAX_TOWER_LEVEL; level += 1) {
    levels.push({
      level,
      cost: costFromAnchors(level, [960, 1760, 3340, 6260, 11400, 20500]),
      damage: intFromAnchors(level, [54, 112, 198, 318, 460, 648]),
      range: floatFromAnchors(level, [2.76, 2.96, 3.16, 3.36, 3.56, 3.76]),
      attackSpeed: floatFromAnchors(level, [0.76, 0.91, 1.06, 1.21, 1.36, 1.5]),
      chainCount: lightningChainsByLevel(level),
      chainFalloff: intFromAnchors(level, [38, 35, 32, 28, 24, 20]),
    });
  }
  return levels;
}

function createWavePlan(options) {
  const {
    totalWaves,
    spawnStart,
    spawnFloor,
    routeWeights,
    baseCounts,
    growth,
    surgeEvery,
    surgeBoost,
  } = options;

  const waves = [];
  for (let i = 1; i <= totalWaves; i += 1) {
    const t = i - 1;
    const surge = i % surgeEvery === 0 ? surgeBoost : 0;
    const scouts = Math.max(0, Math.round(baseCounts.scout + growth.scout * t + surge));
    const raiders = Math.max(0, Math.round(baseCounts.raider + growth.raider * t + surge * 0.8));
    const barges = Math.max(0, Math.round(baseCounts.barge + growth.barge * t + surge * 0.5));
    const juggernauts = Math.max(0, Math.round((baseCounts.juggernaut || 0) + (growth.juggernaut || 0) * t + surge * 0.22));

    const composition = {
      scout: scouts,
      raider: raiders,
      barge: barges,
    };

    if (juggernauts > 0) {
      composition.juggernaut = juggernauts;
    }

    waves.push({
      id: i,
      spawnInterval: roundTo(Math.max(spawnFloor, spawnStart - i * 0.018), 3),
      composition,
      routeWeights: routeWeights.slice(),
    });
  }
  return waves;
}

function fleetCount(waves) {
  return waves.reduce(
    (sum, wave) =>
      sum + Object.values(wave.composition).reduce((waveSum, count) => waveSum + count, 0),
    0
  );
}

const map01Waves = createWavePlan({
  totalWaves: 16,
  spawnStart: 1.0,
  spawnFloor: 0.48,
  routeWeights: [0.56, 0.44],
  baseCounts: { scout: 5, raider: 3, barge: 1, juggernaut: 0 },
  growth: { scout: 0.35, raider: 0.28, barge: 0.15, juggernaut: 0.03 },
  surgeEvery: 4,
  surgeBoost: 2,
});

const map02Waves = createWavePlan({
  totalWaves: 18,
  spawnStart: 0.94,
  spawnFloor: 0.4,
  routeWeights: [0.36, 0.42, 0.22],
  baseCounts: { scout: 6, raider: 4, barge: 1, juggernaut: 0 },
  growth: { scout: 0.45, raider: 0.35, barge: 0.18, juggernaut: 0.05 },
  surgeEvery: 3,
  surgeBoost: 2,
});

const map03Waves = createWavePlan({
  totalWaves: 20,
  spawnStart: 0.88,
  spawnFloor: 0.34,
  routeWeights: [0.31, 0.36, 0.18, 0.15],
  baseCounts: { scout: 6, raider: 5, barge: 2, juggernaut: 1 },
  growth: { scout: 0.5, raider: 0.42, barge: 0.22, juggernaut: 0.08 },
  surgeEvery: 3,
  surgeBoost: 3,
});

export const MAPS = {
  map_01_river_bend: {
    mapId: 'map_01_river_bend',
    name: 'Map 1 - River Bend',
    seed: 101,
    startingCoins: 10000,
    startingXp: 0,
    leakPenalty: { coins: 235, xp: 8 },
    unlockRequirement: { nextMap: 'map_02_split_delta', minXp: 2200 },
    enemyScale: { hp: 1.18, speed: 1.08, rewards: 0.74 },
    xpWaveBonus: 14,
    xpMapBonus: 190,
    routes: [
      {
        id: 'main',
        waypoints: [
          { x: 0.03, y: 0.66 },
          { x: 0.15, y: 0.62 },
          { x: 0.29, y: 0.52 },
          { x: 0.46, y: 0.47 },
          { x: 0.62, y: 0.44 },
          { x: 0.78, y: 0.39 },
          { x: 0.96, y: 0.35 },
        ],
      },
      {
        id: 'detour',
        waypoints: [
          { x: 0.03, y: 0.66 },
          { x: 0.12, y: 0.58 },
          { x: 0.25, y: 0.4 },
          { x: 0.43, y: 0.35 },
          { x: 0.58, y: 0.42 },
          { x: 0.74, y: 0.49 },
          { x: 0.96, y: 0.35 },
        ],
      },
    ],
    defaultRouteWeights: [0.56, 0.44],
    buildSlots: [
      { id: 's01', x: 0.1, y: 0.48 },
      { id: 's02', x: 0.12, y: 0.77 },
      { id: 's03', x: 0.2, y: 0.54 },
      { id: 's04', x: 0.26, y: 0.68 },
      { id: 's05', x: 0.33, y: 0.44 },
      { id: 's06', x: 0.39, y: 0.62 },
      { id: 's07', x: 0.48, y: 0.36 },
      { id: 's08', x: 0.54, y: 0.56 },
      { id: 's09', x: 0.62, y: 0.33 },
      { id: 's10', x: 0.68, y: 0.57 },
      { id: 's11', x: 0.77, y: 0.31 },
      { id: 's12', x: 0.82, y: 0.51 },
      { id: 's13', x: 0.9, y: 0.27 },
      { id: 's14', x: 0.92, y: 0.47 },
    ],
    waves: map01Waves,
    fleetTarget: fleetCount(map01Waves),
  },
  map_02_split_delta: {
    mapId: 'map_02_split_delta',
    name: 'Map 2 - Split Delta',
    seed: 209,
    startingCoins: 12000,
    startingXp: 0,
    leakPenalty: { coins: 235, xp: 10 },
    unlockRequirement: { nextMap: 'map_03_marsh_maze', minXp: 3600 },
    enemyScale: { hp: 1.2, speed: 1.06, rewards: 0.82 },
    xpWaveBonus: 20,
    xpMapBonus: 300,
    routes: [
      {
        id: 'north',
        waypoints: [
          { x: 0.03, y: 0.71 },
          { x: 0.16, y: 0.64 },
          { x: 0.25, y: 0.51 },
          { x: 0.35, y: 0.38 },
          { x: 0.52, y: 0.31 },
          { x: 0.72, y: 0.25 },
          { x: 0.95, y: 0.23 },
        ],
      },
      {
        id: 'center',
        waypoints: [
          { x: 0.03, y: 0.71 },
          { x: 0.18, y: 0.66 },
          { x: 0.34, y: 0.6 },
          { x: 0.5, y: 0.52 },
          { x: 0.67, y: 0.46 },
          { x: 0.82, y: 0.42 },
          { x: 0.95, y: 0.39 },
        ],
      },
      {
        id: 'south_detour',
        waypoints: [
          { x: 0.03, y: 0.71 },
          { x: 0.14, y: 0.78 },
          { x: 0.28, y: 0.82 },
          { x: 0.47, y: 0.75 },
          { x: 0.63, y: 0.64 },
          { x: 0.78, y: 0.53 },
          { x: 0.95, y: 0.39 },
        ],
      },
    ],
    defaultRouteWeights: [0.36, 0.42, 0.22],
    buildSlots: [
      { id: 's01', x: 0.09, y: 0.56 },
      { id: 's02', x: 0.11, y: 0.84 },
      { id: 's03', x: 0.19, y: 0.47 },
      { id: 's04', x: 0.23, y: 0.74 },
      { id: 's05', x: 0.29, y: 0.36 },
      { id: 's06', x: 0.33, y: 0.66 },
      { id: 's07', x: 0.41, y: 0.29 },
      { id: 's08', x: 0.45, y: 0.59 },
      { id: 's09', x: 0.53, y: 0.24 },
      { id: 's10', x: 0.57, y: 0.56 },
      { id: 's11', x: 0.65, y: 0.3 },
      { id: 's12', x: 0.69, y: 0.61 },
      { id: 's13', x: 0.77, y: 0.25 },
      { id: 's14', x: 0.81, y: 0.57 },
      { id: 's15', x: 0.88, y: 0.28 },
      { id: 's16', x: 0.9, y: 0.52 },
    ],
    waves: map02Waves,
    fleetTarget: fleetCount(map02Waves),
  },
  map_03_marsh_maze: {
    mapId: 'map_03_marsh_maze',
    name: 'Map 3 - Marsh Maze',
    seed: 317,
    startingCoins: 19000,
    startingXp: 0,
    leakPenalty: { coins: 275, xp: 14 },
    unlockRequirement: { nextMap: 'map_04_future', minXp: 6200 },
    enemyScale: { hp: 1.27, speed: 1.09, rewards: 0.81 },
    xpWaveBonus: 28,
    xpMapBonus: 460,
    routes: [
      {
        id: 'north_channel',
        waypoints: [
          { x: 0.03, y: 0.57 },
          { x: 0.12, y: 0.45 },
          { x: 0.25, y: 0.33 },
          { x: 0.42, y: 0.27 },
          { x: 0.58, y: 0.23 },
          { x: 0.78, y: 0.22 },
          { x: 0.96, y: 0.19 },
        ],
      },
      {
        id: 'center_channel',
        waypoints: [
          { x: 0.03, y: 0.57 },
          { x: 0.16, y: 0.55 },
          { x: 0.28, y: 0.5 },
          { x: 0.4, y: 0.47 },
          { x: 0.57, y: 0.44 },
          { x: 0.74, y: 0.42 },
          { x: 0.96, y: 0.4 },
        ],
      },
      {
        id: 'south_wide',
        waypoints: [
          { x: 0.03, y: 0.57 },
          { x: 0.13, y: 0.69 },
          { x: 0.28, y: 0.78 },
          { x: 0.47, y: 0.74 },
          { x: 0.65, y: 0.66 },
          { x: 0.82, y: 0.56 },
          { x: 0.96, y: 0.4 },
        ],
      },
      {
        id: 'deep_detour',
        waypoints: [
          { x: 0.03, y: 0.57 },
          { x: 0.09, y: 0.78 },
          { x: 0.2, y: 0.89 },
          { x: 0.39, y: 0.88 },
          { x: 0.56, y: 0.8 },
          { x: 0.74, y: 0.66 },
          { x: 0.96, y: 0.4 },
        ],
      },
    ],
    defaultRouteWeights: [0.31, 0.36, 0.18, 0.15],
    buildSlots: [
      { id: 's01', x: 0.07, y: 0.37 },
      { id: 's02', x: 0.09, y: 0.69 },
      { id: 's03', x: 0.16, y: 0.29 },
      { id: 's04', x: 0.19, y: 0.63 },
      { id: 's05', x: 0.26, y: 0.24 },
      { id: 's06', x: 0.3, y: 0.58 },
      { id: 's07', x: 0.37, y: 0.21 },
      { id: 's08', x: 0.41, y: 0.55 },
      { id: 's09', x: 0.5, y: 0.19 },
      { id: 's10', x: 0.53, y: 0.53 },
      { id: 's11', x: 0.62, y: 0.19 },
      { id: 's12', x: 0.65, y: 0.52 },
      { id: 's13', x: 0.74, y: 0.2 },
      { id: 's14', x: 0.77, y: 0.51 },
      { id: 's15', x: 0.84, y: 0.23 },
      { id: 's16', x: 0.87, y: 0.5 },
      { id: 's17', x: 0.93, y: 0.27 },
      { id: 's18', x: 0.94, y: 0.48 },
    ],
    waves: map03Waves,
    fleetTarget: fleetCount(map03Waves),
  },
};

export const DEFAULT_MAP_ID = 'map_01_river_bend';
export const MAP_CONFIG = MAPS[DEFAULT_MAP_ID];
export const WAVES = MAP_CONFIG.waves;

export const TOWER_CONFIG = {
  arrow: {
    id: 'arrow',
    name: 'Arrow Tower',
    effectType: 'physical',
    levels: createArrowLevels(),
  },
  bone: {
    id: 'bone',
    name: 'Bomb Tower',
    effectType: 'bomb',
    levels: createBombLevels(),
  },
  magic_fire: {
    id: 'magic_fire',
    name: 'Magic Fire',
    effectType: 'fire',
    levels: createFireLevels(),
  },
  magic_wind: {
    id: 'magic_wind',
    name: 'Magic Wind',
    effectType: 'wind',
    levels: createWindLevels(),
  },
  magic_lightning: {
    id: 'magic_lightning',
    name: 'Magic Lightning',
    effectType: 'lightning',
    levels: createLightningLevels(),
  },
};

export const ENEMIES = {
  scout: { id: 'scout', hp: 220, speed: 1.4, coinReward: 75, xpReward: 7 },
  raider: { id: 'raider', hp: 390, speed: 1.07, coinReward: 115, xpReward: 11 },
  barge: { id: 'barge', hp: 690, speed: 0.82, coinReward: 175, xpReward: 17 },
  juggernaut: { id: 'juggernaut', hp: 1100, speed: 0.66, coinReward: 280, xpReward: 26 },
};

export const PROGRESSION = {
  xpPerWaveClear: 28,
  xpMapClear: 140,
};

export const CAMPAIGN_INFO = {
  maxTowerLevel: MAX_TOWER_LEVEL,
  mapCount: Object.keys(MAPS).length,
  minFleetPerMap: 200,
};
