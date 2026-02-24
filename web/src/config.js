const MAX_TOWER_LEVEL = 50;
const BALANCE_TUNING = {
  windSlowMult: 1.452,
  bombSplashMult: 1.427,
  fireDpsMult: 1.144,
};

function roundTo(value, digits = 2) {
  return Number(value.toFixed(digits));
}

function intGrowth(base, level, linear, curved, power = 1.2) {
  const t = level - 1;
  return Math.round(base * (1 + linear * t + curved * Math.pow(t, power)));
}

function costGrowth(base, level, multiplier) {
  const t = level - 1;
  const cost = base * Math.pow(1 + multiplier, t);
  return Math.max(60, Math.round(cost / 5) * 5);
}

function createArrowLevels() {
  const levels = [];
  for (let level = 1; level <= MAX_TOWER_LEVEL; level += 1) {
    levels.push({
      level,
      cost: costGrowth(500, level, 0.064),
      damage: intGrowth(32, level, 0.082, 0.0105),
      range: roundTo(2.8 + Math.min(0.95, (level - 1) * 0.018)),
      attackSpeed: roundTo(1.1 + Math.min(1.65, (level - 1) * 0.034)),
    });
  }
  return levels;
}

function createBombLevels() {
  const levels = [];
  for (let level = 1; level <= MAX_TOWER_LEVEL; level += 1) {
    levels.push({
      level,
      cost: costGrowth(700, level, 0.067),
      damage: intGrowth(120, level, 0.096, 0.013),
      range: roundTo(2.6 + Math.min(0.9, (level - 1) * 0.017)),
      attackSpeed: roundTo(0.52 + Math.min(0.88, (level - 1) * 0.018)),
      splashRadius: roundTo((1.4 + Math.min(1.65, (level - 1) * 0.034)) * BALANCE_TUNING.bombSplashMult),
      splashFalloff: Math.max(12, Math.round(45 - (level - 1) * 0.68)),
    });
  }
  return levels;
}

function createFireLevels() {
  const levels = [];
  for (let level = 1; level <= MAX_TOWER_LEVEL; level += 1) {
    levels.push({
      level,
      cost: costGrowth(800, level, 0.068),
      damage: intGrowth(48, level, 0.084, 0.011),
      range: roundTo(2.8 + Math.min(1.05, (level - 1) * 0.019)),
      attackSpeed: roundTo(0.82 + Math.min(0.98, (level - 1) * 0.020)),
      fireballDps: Math.round(intGrowth(70, level, 0.088, 0.012) * BALANCE_TUNING.fireDpsMult),
      fireballDuration: 3.0,
      fireballRadius: roundTo(0.9 + Math.min(0.8, (level - 1) * 0.016)),
    });
  }
  return levels;
}

function windTargetsByLevel(level) {
  if (level <= 16) {
    return 3;
  }
  if (level <= 33) {
    return 5;
  }
  return 6;
}

function windSlowByLevel(level) {
  if (level <= 16) {
    return Math.min(90, Math.round((30 + Math.floor((level - 1) * 0.8)) * BALANCE_TUNING.windSlowMult));
  }
  if (level <= 33) {
    return Math.min(90, Math.round((43 + Math.floor((level - 17) * 0.75)) * BALANCE_TUNING.windSlowMult));
  }
  return Math.min(90, Math.round((56 + Math.floor((level - 34) * 0.8)) * BALANCE_TUNING.windSlowMult));
}

function createWindLevels() {
  const levels = [];
  for (let level = 1; level <= MAX_TOWER_LEVEL; level += 1) {
    levels.push({
      level,
      cost: costGrowth(760, level, 0.066),
      damage: intGrowth(14, level, 0.082, 0.012),
      range: roundTo(3.0 + Math.min(1.2, (level - 1) * 0.02)),
      attackSpeed: roundTo(0.92 + Math.min(0.9, (level - 1) * 0.018)),
      slowPercent: windSlowByLevel(level),
      slowDuration: roundTo(2.2 + Math.min(1.4, (level - 1) * 0.03)),
      windTargets: windTargetsByLevel(level),
    });
  }
  return levels;
}

function lightningChainsByLevel(level) {
  if (level <= 20) {
    return 1;
  }
  if (level <= 40) {
    return 2;
  }
  return 3;
}

function createLightningLevels() {
  const levels = [];
  for (let level = 1; level <= MAX_TOWER_LEVEL; level += 1) {
    levels.push({
      level,
      cost: costGrowth(900, level, 0.069),
      damage: intGrowth(58, level, 0.09, 0.012),
      range: roundTo(2.8 + Math.min(1.0, (level - 1) * 0.018)),
      attackSpeed: roundTo(0.8 + Math.min(1.02, (level - 1) * 0.021)),
      chainCount: lightningChainsByLevel(level),
      chainFalloff: Math.max(12, Math.round(35 - (level - 1) * 0.45)),
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
    leakPenalty: { coins: 145, xp: 8 },
    unlockRequirement: { nextMap: 'map_02_split_delta', minXp: 2200 },
    enemyScale: { hp: 1.0, speed: 1.0, rewards: 1.0 },
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
    leakPenalty: { coins: 170, xp: 10 },
    unlockRequirement: { nextMap: 'map_03_marsh_maze', minXp: 3600 },
    enemyScale: { hp: 1.13, speed: 1.04, rewards: 1.22 },
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
    startingCoins: 14000,
    startingXp: 0,
    leakPenalty: { coins: 220, xp: 14 },
    unlockRequirement: { nextMap: 'map_04_future', minXp: 6200 },
    enemyScale: { hp: 1.25, speed: 1.09, rewards: 1.4 },
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
