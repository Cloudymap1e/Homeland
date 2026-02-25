import os from 'node:os';
import { execSync } from 'node:child_process';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { HomelandGame } from '../web/src/game-core.js';
import { MAPS, DEFAULT_MAP_ID, TOWER_CONFIG } from '../web/src/config.js';

const DEFAULT_RUNS = 1000;
const DEFAULT_WORKERS = Math.max(1, Math.min(8, (os.cpus()?.length || 4) - 1));
const SEARCH_FRACTION = 0.2;
const DEFAULT_RETENTION_RUNS = 100;
const DEFAULT_STANDARD_RUNS = 1000;

const TOWER_IDS = ['arrow', 'bone', 'magic_fire', 'magic_wind', 'magic_lightning'];
const MONO_POLICIES = ['mono_arrow', 'mono_bomb', 'mono_fire', 'mono_wind', 'mono_lightning'];
const MAP_ORDER = Object.keys(MAPS);
const MAP_INDEX = new Map(MAP_ORDER.map((mapId, index) => [mapId, index]));
const FAIL_RUN_PENALTY_EQUIVALENT = 2;
const RUN_TARGETS_BY_MAP_INDEX = [30, 50, 60, 90, 100, 120];
const PASS_RATE_TARGETS_BY_MAP_INDEX = [0.9, 0.85, 0.8, 0.77, 0.75, 0.7];

const BASE_TARGETS = {
  map_01_river_bend: {
    clearMin: 0.84,
    clearMax: 0.94,
    clearCenter: 0.9,
    qualityMin: 0.7,
    qualityMax: 0.9,
    qualityCenter: 0.8,
    leaksMin: 1,
    leaksMax: 10,
    leaksCenter: 4.5,
    qualityLeakCap: 12,
  },
  map_02_split_delta: {
    clearMin: 0.79,
    clearMax: 0.89,
    clearCenter: 0.85,
    qualityMin: 0.58,
    qualityMax: 0.82,
    qualityCenter: 0.7,
    leaksMin: 3,
    leaksMax: 16,
    leaksCenter: 8,
    qualityLeakCap: 18,
  },
  map_03_marsh_maze: {
    clearMin: 0.74,
    clearMax: 0.84,
    clearCenter: 0.8,
    qualityMin: 0.45,
    qualityMax: 0.72,
    qualityCenter: 0.58,
    leaksMin: 7,
    leaksMax: 26,
    leaksCenter: 14,
    qualityLeakCap: 28,
  },
  map_04_tide_lock: {
    clearMin: 0.72,
    clearMax: 0.82,
    clearCenter: 0.77,
    qualityMin: 0.37,
    qualityMax: 0.64,
    qualityCenter: 0.5,
    leaksMin: 11,
    leaksMax: 34,
    leaksCenter: 21,
    qualityLeakCap: 36,
  },
};

const SEARCH_GRID = {
  wind: [0.92, 1.0, 1.08, 1.16],
  bomb: [0.9, 1.0, 1.1, 1.2],
  fire: [0.9, 1.0, 1.1, 1.2],
};

const OAT_GRID = {
  windSlowMult: [0.9, 1.0, 1.1],
  bombSplashMult: [0.9, 1.0, 1.1],
  fireDpsMult: [0.9, 1.0, 1.1],
};

const POLICIES = {
  balanced: {
    id: 'balanced',
    label: 'Balanced Mix',
    allowed: TOWER_IDS,
    minimums: [
      { towerId: 'arrow', min: 1, wave: 1 },
      { towerId: 'bone', min: 1, wave: 1 },
      { towerId: 'magic_fire', min: 1, wave: 2 },
      { towerId: 'magic_wind', min: 1, wave: 2 },
      { towerId: 'magic_lightning', min: 1, wave: 4 },
    ],
    weightMult: {
      arrow: 0.86,
      bone: 1.14,
      magic_fire: 1.18,
      magic_wind: 1.04,
      magic_lightning: 1.12,
    },
    spreadTargets: {
      arrow: 0.18,
      bone: 0.26,
      magic_fire: 0.24,
      magic_wind: 0.18,
      magic_lightning: 0.14,
    },
    upgradeBias: {
      arrow: 0.95,
      bone: 1.2,
      magic_fire: 1.2,
      magic_wind: 1.08,
      magic_lightning: 1.18,
    },
  },
  random_all: {
    id: 'random_all',
    label: 'Random All Towers',
    allowed: TOWER_IDS,
    minimums: [],
    equalWeights: true,
    weightMult: {},
    spreadTargets: null,
    upgradeBias: {},
  },
  mono_arrow: {
    id: 'mono_arrow',
    label: 'Mono Arrow',
    allowed: ['arrow'],
    minimums: [{ towerId: 'arrow', min: 3, wave: 1 }],
    weightMult: { arrow: 1.2 },
    spreadTargets: null,
    upgradeBias: { arrow: 1.2 },
  },
  mono_bomb: {
    id: 'mono_bomb',
    label: 'Mono Bomb',
    allowed: ['bone'],
    minimums: [{ towerId: 'bone', min: 2, wave: 1 }],
    weightMult: { bone: 1.2 },
    spreadTargets: null,
    upgradeBias: { bone: 1.2 },
  },
  mono_fire: {
    id: 'mono_fire',
    label: 'Mono Fire',
    allowed: ['magic_fire'],
    minimums: [{ towerId: 'magic_fire', min: 2, wave: 1 }],
    weightMult: { magic_fire: 1.2 },
    spreadTargets: null,
    upgradeBias: { magic_fire: 1.2 },
  },
  mono_wind: {
    id: 'mono_wind',
    label: 'Mono Wind',
    allowed: ['magic_wind'],
    minimums: [{ towerId: 'magic_wind', min: 2, wave: 1 }],
    weightMult: { magic_wind: 1.2 },
    spreadTargets: null,
    upgradeBias: { magic_wind: 1.2 },
  },
  mono_lightning: {
    id: 'mono_lightning',
    label: 'Mono Lightning',
    allowed: ['magic_lightning'],
    minimums: [{ towerId: 'magic_lightning', min: 2, wave: 1 }],
    weightMult: { magic_lightning: 1.2 },
    spreadTargets: null,
    upgradeBias: { magic_lightning: 1.2 },
  },
  duo_bomb_fire: {
    id: 'duo_bomb_fire',
    label: 'Duo Bomb + Fire',
    allowed: ['bone', 'magic_fire'],
    minimums: [
      { towerId: 'bone', min: 2, wave: 1 },
      { towerId: 'magic_fire', min: 2, wave: 2 },
    ],
    weightMult: { bone: 1.15, magic_fire: 1.15 },
    spreadTargets: { bone: 0.5, magic_fire: 0.5 },
    upgradeBias: { bone: 1.1, magic_fire: 1.1 },
  },
  duo_arrow_wind: {
    id: 'duo_arrow_wind',
    label: 'Duo Arrow + Wind',
    allowed: ['arrow', 'magic_wind'],
    minimums: [
      { towerId: 'arrow', min: 2, wave: 1 },
      { towerId: 'magic_wind', min: 2, wave: 2 },
    ],
    weightMult: { arrow: 1.1, magic_wind: 1.2 },
    spreadTargets: { arrow: 0.55, magic_wind: 0.45 },
    upgradeBias: { arrow: 1.05, magic_wind: 1.12 },
  },
  duo_fire_lightning: {
    id: 'duo_fire_lightning',
    label: 'Duo Fire + Lightning',
    allowed: ['magic_fire', 'magic_lightning'],
    minimums: [
      { towerId: 'magic_fire', min: 2, wave: 1 },
      { towerId: 'magic_lightning', min: 1, wave: 3 },
    ],
    weightMult: { magic_fire: 1.1, magic_lightning: 1.1 },
    spreadTargets: { magic_fire: 0.6, magic_lightning: 0.4 },
    upgradeBias: { magic_fire: 1.1, magic_lightning: 1.12 },
  },
};

function parseArgs(argv) {
  const args = {
    runs: DEFAULT_RUNS,
    maps: 'all',
    workers: DEFAULT_WORKERS,
    cuda: false,
    cudaRequired: false,
    searchRuns: null,
    skipSearch: false,
    suite: 'full',
    diversityRuns: null,
    oatRuns: null,
    policies: 'random_all',
    retentionRuns: DEFAULT_RETENTION_RUNS,
    standardRuns: DEFAULT_STANDARD_RUNS,
    retentionPolicy: 'random_all',
    skipStandard: false,
  };

  for (const arg of argv) {
    if (arg.startsWith('--runs=')) {
      args.runs = Math.max(20, Number(arg.split('=')[1]));
    } else if (arg.startsWith('--maps=')) {
      args.maps = arg.split('=')[1];
    } else if (arg.startsWith('--workers=')) {
      const raw = arg.split('=')[1];
      args.workers = raw === 'auto' ? DEFAULT_WORKERS : Math.max(1, Number(raw));
    } else if (arg === '--cuda') {
      args.cuda = true;
    } else if (arg === '--cuda-required') {
      args.cuda = true;
      args.cudaRequired = true;
    } else if (arg.startsWith('--search-runs=')) {
      args.searchRuns = Math.max(20, Number(arg.split('=')[1]));
    } else if (arg === '--skip-search') {
      args.skipSearch = true;
    } else if (arg.startsWith('--suite=')) {
      args.suite = arg.split('=')[1];
    } else if (arg.startsWith('--diversity-runs=')) {
      args.diversityRuns = Math.max(20, Number(arg.split('=')[1]));
    } else if (arg.startsWith('--oat-runs=')) {
      args.oatRuns = Math.max(20, Number(arg.split('=')[1]));
    } else if (arg.startsWith('--policies=')) {
      args.policies = arg.split('=')[1];
    } else if (arg.startsWith('--retention-runs=')) {
      args.retentionRuns = Math.max(20, Number(arg.split('=')[1]));
    } else if (arg.startsWith('--standard-runs=')) {
      args.standardRuns = Math.max(20, Number(arg.split('=')[1]));
    } else if (arg.startsWith('--retention-policy=')) {
      args.retentionPolicy = arg.split('=')[1];
    } else if (arg === '--skip-standard') {
      args.skipStandard = true;
    }
  }
  return args;
}

function parseMapIds(raw) {
  if (raw === 'all') {
    return MAP_ORDER;
  }
  const requested = raw.split(',').map((id) => id.trim()).filter(Boolean);
  if (!requested.length) {
    return [DEFAULT_MAP_ID];
  }
  return requested.filter((id) => Boolean(MAPS[id]));
}

function parsePolicyIds(raw) {
  if (raw === 'all') {
    return Object.keys(POLICIES);
  }
  const requested = raw.split(',').map((id) => id.trim()).filter(Boolean);
  if (!requested.length) {
    return ['random_all'];
  }
  return requested.filter((id) => Boolean(POLICIES[id]));
}

function getPolicy(policyId) {
  return POLICIES[policyId] || POLICIES.random_all;
}

function runTargetForMap(mapId) {
  const index = MAP_INDEX.get(mapId);
  if (!Number.isInteger(index) || index < 0) {
    return RUN_TARGETS_BY_MAP_INDEX[0];
  }
  if (index < RUN_TARGETS_BY_MAP_INDEX.length) {
    return RUN_TARGETS_BY_MAP_INDEX[index];
  }
  const lastTarget = RUN_TARGETS_BY_MAP_INDEX[RUN_TARGETS_BY_MAP_INDEX.length - 1];
  const previousTarget = RUN_TARGETS_BY_MAP_INDEX[RUN_TARGETS_BY_MAP_INDEX.length - 2] || lastTarget;
  const growthStep = Math.max(10, lastTarget - previousTarget);
  return lastTarget + growthStep * (index - RUN_TARGETS_BY_MAP_INDEX.length + 1);
}

function passRateTargetForMap(mapId) {
  const index = MAP_INDEX.get(mapId);
  if (!Number.isInteger(index) || index < 0) {
    return PASS_RATE_TARGETS_BY_MAP_INDEX[0];
  }
  if (index < PASS_RATE_TARGETS_BY_MAP_INDEX.length) {
    return PASS_RATE_TARGETS_BY_MAP_INDEX[index];
  }
  const lastTarget = PASS_RATE_TARGETS_BY_MAP_INDEX[PASS_RATE_TARGETS_BY_MAP_INDEX.length - 1];
  const previousTarget = PASS_RATE_TARGETS_BY_MAP_INDEX[PASS_RATE_TARGETS_BY_MAP_INDEX.length - 2] || lastTarget;
  const reductionStep = Math.max(0.02, previousTarget - lastTarget);
  const extended = lastTarget - reductionStep * (index - PASS_RATE_TARGETS_BY_MAP_INDEX.length + 1);
  return Math.max(0.5, Number(extended.toFixed(2)));
}

function targetForMap(mapId) {
  if (BASE_TARGETS[mapId]) {
    return BASE_TARGETS[mapId];
  }

  const clearCenter = passRateTargetForMap(mapId);
  const qualityCenter = Math.max(0.24, clearCenter - 0.2);
  const mapIndex = MAP_INDEX.get(mapId);
  const leaksCenter = 4 + Math.max(0, Number.isInteger(mapIndex) ? mapIndex : MAP_ORDER.length) * 5;
  return {
    clearMin: Math.max(0.45, clearCenter - 0.05),
    clearMax: Math.min(0.98, clearCenter + 0.05),
    clearCenter,
    qualityMin: Math.max(0.16, qualityCenter - 0.12),
    qualityMax: Math.min(0.95, qualityCenter + 0.12),
    qualityCenter,
    leaksMin: Math.max(1, leaksCenter - 9),
    leaksMax: leaksCenter + 11,
    leaksCenter,
    qualityLeakCap: leaksCenter + 13,
  };
}

function createRng(seed) {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function pickRandom(rand, arr) {
  return arr[Math.floor(rand() * arr.length)];
}

function pickWeighted(rand, candidates) {
  const total = candidates.reduce((sum, c) => sum + c.weight, 0);
  if (total <= 0) {
    return candidates[0];
  }
  let r = rand() * total;
  for (const c of candidates) {
    r -= c.weight;
    if (r <= 0) {
      return c;
    }
  }
  return candidates[candidates.length - 1];
}

function getMapById(mapId) {
  return MAPS[mapId] || MAPS[DEFAULT_MAP_ID];
}

function getEmptySlots(game) {
  return game.getBuildSlots().filter(
    (slot) => game.isSlotActivated(slot.id) && !game.getTower(slot.id)
  );
}

function getLockedSlots(game) {
  return game.getBuildSlots().filter((slot) => !game.isSlotActivated(slot.id));
}

function getBuiltTowers(game) {
  return game.getBuildSlots()
    .map((slot) => game.getTower(slot.id))
    .filter((tower) => tower !== null);
}

function getUpgradeableTowers(game) {
  return getBuiltTowers(game).filter((tower) => tower.level < TOWER_CONFIG[tower.towerId].levels.length);
}

function upgradeCost(tower) {
  const cfg = TOWER_CONFIG[tower.towerId];
  if (tower.level >= cfg.levels.length) {
    return Number.POSITIVE_INFINITY;
  }
  return cfg.levels[tower.level].cost;
}

function towerCounts(game) {
  const counts = {};
  for (const towerId of TOWER_IDS) {
    counts[towerId] = 0;
  }
  for (const tower of getBuiltTowers(game)) {
    counts[tower.towerId] += 1;
  }
  return counts;
}

function desiredTowerCount(game, waveIndex) {
  const fraction = Math.min(1, waveIndex / Math.max(1, game.waves.length - 1));
  const slotCount = game.getBuildSlots().length;
  return Math.min(
    slotCount,
    5 + Math.floor(fraction * Math.max(0, slotCount - 4))
  );
}

function desiredUpgradeLevel(game, waveIndex) {
  const fraction = Math.min(1, waveIndex / Math.max(1, game.waves.length - 1));
  return 2 + Math.floor(fraction * 24);
}

function baseWeightsForMap(mapId) {
  const base = {
    arrow: 0.28,
    bone: 0.25,
    magic_fire: 0.2,
    magic_wind: 0.19,
    magic_lightning: 0.08,
  };
  if (mapId !== 'map_01_river_bend') {
    base.bone += 0.04;
    base.magic_lightning += 0.05;
  }
  return base;
}

function buildWeights(waveIndex, counts, mapId, policy) {
  const weights = baseWeightsForMap(mapId);
  const allowedSet = new Set(policy.allowed);
  const totalBuilt = TOWER_IDS.reduce((sum, id) => sum + counts[id], 0);

  if (waveIndex >= 3 && counts.magic_wind === 0 && allowedSet.has('magic_wind')) {
    weights.magic_wind += 0.8;
  }
  if (waveIndex >= 4 && counts.magic_fire === 0 && allowedSet.has('magic_fire')) {
    weights.magic_fire += 0.7;
  }
  if (counts.bone === 0 && allowedSet.has('bone')) {
    weights.bone += 0.6;
  }
  if (counts.arrow < 2 && allowedSet.has('arrow')) {
    weights.arrow += 0.4;
  }

  if (policy.equalWeights) {
    for (const id of TOWER_IDS) {
      weights[id] = allowedSet.has(id) ? 1 : 0;
    }
  }

  if (policy.spreadTargets && totalBuilt > 0) {
    for (const id of policy.allowed) {
      const currentShare = counts[id] / totalBuilt;
      const targetShare = policy.spreadTargets[id] || 0;
      if (currentShare < targetShare - 0.06) {
        weights[id] += 0.35;
      }
    }
  }

  for (const id of TOWER_IDS) {
    if (!allowedSet.has(id)) {
      weights[id] = 0;
    } else {
      weights[id] = Math.max(0.01, weights[id] * (policy.weightMult[id] || 1));
    }
  }

  return weights;
}

function tryBuildSpecific(game, rand, towerId, policy) {
  if (!policy.allowed.includes(towerId)) {
    return false;
  }
  const cfg = TOWER_CONFIG[towerId];
  if (!cfg || game.coins < cfg.levels[0].cost) {
    return false;
  }
  const empty = getEmptySlots(game);
  if (!empty.length) {
    return false;
  }
  const slot = pickRandom(rand, empty);
  return game.buildTower(slot.id, towerId).ok;
}

function tryActivateAction(game, rand) {
  const locked = getLockedSlots(game)
    .map((slot) => ({ slot, cost: game.getSlotActivationCost(slot.id) }))
    .filter((entry) => entry.cost <= game.coins);
  if (!locked.length) {
    return null;
  }
  const pick = pickRandom(rand, locked);
  return game.activateSlot(pick.slot.id).ok ? pick.slot.id : null;
}

function tryBuildOnSpecificSlot(game, rand, slotId, policy) {
  const affordable = Object.values(TOWER_CONFIG)
    .filter((cfg) => policy.allowed.includes(cfg.id) && cfg.levels[0].cost <= game.coins);
  if (!affordable.length) {
    return false;
  }
  const cfg = pickRandom(rand, affordable);
  return game.buildTower(slotId, cfg.id).ok;
}

function enforceMinimumComposition(game, rand, policy, waveIndex, counts) {
  for (const rule of policy.minimums || []) {
    if (waveIndex < rule.wave) {
      continue;
    }
    if (counts[rule.towerId] < rule.min && tryBuildSpecific(game, rand, rule.towerId, policy)) {
      return true;
    }
  }
  return false;
}

function tryBuildAction(game, rand, waveIndex, counts, mapId, policy) {
  const emptySlots = getEmptySlots(game);
  if (emptySlots.length === 0) {
    return false;
  }

  const weights = buildWeights(waveIndex, counts, mapId, policy);
  const affordable = Object.values(TOWER_CONFIG)
    .map((cfg) => ({ towerId: cfg.id, cost: cfg.levels[0].cost, weight: weights[cfg.id] || 0 }))
    .filter((entry) => entry.cost <= game.coins && entry.weight > 0);

  if (!affordable.length) {
    return false;
  }

  const slot = pickRandom(rand, emptySlots);
  const pick = pickWeighted(rand, affordable);
  return game.buildTower(slot.id, pick.towerId).ok;
}

function tryUpgradeAction(game, rand, waveIndex, policy) {
  const targetLevel = desiredUpgradeLevel(game, waveIndex);
  const allowedSet = new Set(policy.allowed);

  const upgradeable = getUpgradeableTowers(game)
    .filter((tower) => allowedSet.has(tower.towerId))
    .map((tower) => ({ tower, cost: upgradeCost(tower) }))
    .filter((entry) => entry.cost <= game.coins);

  if (!upgradeable.length) {
    return false;
  }

  const weighted = upgradeable.map((entry) => {
    const id = entry.tower.towerId;
    let weight = 1;
    if (entry.tower.level < targetLevel) {
      weight += 1.3;
    }
    weight *= policy.upgradeBias[id] || 1;
    return { ...entry, weight };
  });

  const pick = pickWeighted(rand, weighted);
  return game.upgradeTower(pick.tower.slotId).ok;
}

function affordableBuilds(game, policy) {
  return Object.values(TOWER_CONFIG)
    .filter((cfg) => policy.allowed.includes(cfg.id) && cfg.levels[0].cost <= game.coins)
    .map((cfg) => cfg.id);
}

function affordableUpgrades(game, policy) {
  return getUpgradeableTowers(game)
    .filter((tower) => policy.allowed.includes(tower.towerId))
    .filter((tower) => upgradeCost(tower) <= game.coins);
}

function affordableActivations(game) {
  return getLockedSlots(game).filter((slot) => game.getSlotActivationCost(slot.id) <= game.coins);
}

function runRandomBuildPhase(game, rand, policy) {
  const actions = 3 + Math.floor(rand() * 8);
  for (let i = 0; i < actions; i += 1) {
    const hasEmptySlot = getEmptySlots(game).length > 0;
    const buildChoices = hasEmptySlot ? affordableBuilds(game, policy) : [];
    const upgradeChoices = affordableUpgrades(game, policy);
    const activationChoices = affordableActivations(game);
    const canActivate = activationChoices.length > 0;
    const canBuild = buildChoices.length > 0;
    const canUpgrade = upgradeChoices.length > 0;

    if (!canBuild && !canUpgrade && !canActivate) {
      break;
    }

    const activateBias = getBuiltTowers(game).length < 6 ? 0.45 : 0.16;
    if (canActivate && (!canBuild || rand() < activateBias)) {
      const activatedSlotId = tryActivateAction(game, rand);
      if (activatedSlotId) {
        if (rand() < 0.38) {
          tryBuildOnSpecificSlot(game, rand, activatedSlotId, policy);
        }
        continue;
      }
    }

    const buildBias = getBuiltTowers(game).length < 9 ? 0.62 : 0.45;
    const wantBuild = canBuild && (!canUpgrade || rand() < buildBias);

    if (wantBuild) {
      const towerId = pickRandom(rand, buildChoices);
      if (tryBuildSpecific(game, rand, towerId, policy)) {
        continue;
      }
    }

    if (canUpgrade) {
      const tower = pickRandom(rand, upgradeChoices);
      if (game.upgradeTower(tower.slotId).ok) {
        continue;
      }
    }

    if (canBuild) {
      const towerId = pickRandom(rand, buildChoices);
      if (tryBuildSpecific(game, rand, towerId, policy)) {
        continue;
      }
    }

    if (canActivate) {
      const activatedSlotId = tryActivateAction(game, rand);
      if (activatedSlotId) {
        if (rand() < 0.3) {
          tryBuildOnSpecificSlot(game, rand, activatedSlotId, policy);
        }
        continue;
      }
    }
  }
}

function runBuildPhase(game, rand, mapId, policy) {
  if (policy.id === 'random_all') {
    runRandomBuildPhase(game, rand, policy);
    return;
  }

  const waveIndex = Math.max(0, game.waveIndex + 1);
  const actions = 3 + Math.floor(rand() * 5);
  const wantedTowers = desiredTowerCount(game, waveIndex);

  for (let i = 0; i < actions; i += 1) {
    const built = getBuiltTowers(game);
    const counts = towerCounts(game);

    if (enforceMinimumComposition(game, rand, policy, waveIndex, counts)) {
      continue;
    }

    const shouldBuild = built.length < wantedTowers && getEmptySlots(game).length > 0;
    if (!shouldBuild && tryActivateAction(game, rand)) {
      continue;
    }
    if (shouldBuild && tryBuildAction(game, rand, waveIndex, counts, mapId, policy)) {
      continue;
    }
    if (tryUpgradeAction(game, rand, waveIndex, policy)) {
      continue;
    }
    if (tryActivateAction(game, rand)) {
      continue;
    }
    if (tryBuildAction(game, rand, waveIndex, counts, mapId, policy)) {
      continue;
    }
    break;
  }
}

function captureTowerLayout(game) {
  const counts = {};
  const levelSums = {};
  for (const id of TOWER_IDS) {
    counts[id] = 0;
    levelSums[id] = 0;
  }
  for (const tower of getBuiltTowers(game)) {
    counts[tower.towerId] += 1;
    levelSums[tower.towerId] += tower.level;
  }
  return { counts, levelSums };
}

function runCurrentMap(game, rand, mapId, policyId) {
  const policy = getPolicy(policyId);
  let guard = 0;

  while (game.state !== 'map_result' && guard < 500000) {
    if (game.state === 'build_phase' || game.state === 'wave_result') {
      runBuildPhase(game, rand, mapId, policy);
      const started = game.startNextWave();
      if (!started.ok) {
        break;
      }
    }
    if (game.state === 'wave_running') {
      game.tick(0.06);
    }
    guard += 1;
  }

  const snap = game.getSnapshot();
  const layout = captureTowerLayout(game);
  return {
    victory: Boolean(snap.result?.victory),
    leaked: snap.leaked,
    coins: snap.coins,
    xp: snap.xp,
    towerCounts: layout.counts,
    towerLevelSums: layout.levelSums,
  };
}

function runSingle(seed, mapId, policyId, options = {}) {
  const rand = createRng(seed);
  const game = new HomelandGame();
  const carryResources = Boolean(options.carryResources);
  game.setMap(mapId, { ignoreUnlock: true, carryResources });

  if (Number.isFinite(options.startingCoinsOverride)) {
    game.coins = Math.max(0, Math.round(options.startingCoinsOverride));
  }
  if (Number.isFinite(options.startingXpOverride)) {
    game.xp = Math.max(0, Math.round(options.startingXpOverride));
  }

  return runCurrentMap(game, rand, mapId, policyId);
}

function runCampaignRetentionBaseline(seed, targetMapId, policyId = 'random_all') {
  const targetIndex = MAP_INDEX.get(targetMapId);
  if (!Number.isInteger(targetIndex) || targetIndex < 0) {
    return {
      reachedTarget: false,
      failedMapId: targetMapId,
      retainedCoins: 0,
      retainedXp: 0,
    };
  }

  const rand = createRng(seed);
  const game = new HomelandGame();
  for (let mapIndex = 0; mapIndex < targetIndex; mapIndex += 1) {
    const mapId = MAP_ORDER[mapIndex];
    const switched = game.setMap(mapId, { ignoreUnlock: true, carryResources: mapIndex > 0 });
    if (!switched.ok) {
      return {
        reachedTarget: false,
        failedMapId: mapId,
        retainedCoins: game.coins,
        retainedXp: game.xp,
      };
    }

    const outcome = runCurrentMap(game, rand, mapId, policyId);
    if (!outcome.victory) {
      return {
        reachedTarget: false,
        failedMapId: mapId,
        retainedCoins: outcome.coins,
        retainedXp: outcome.xp,
      };
    }
  }

  const switchedToTarget = game.setMap(targetMapId, {
    ignoreUnlock: true,
    carryResources: targetIndex > 0,
  });
  if (!switchedToTarget.ok) {
    return {
      reachedTarget: false,
      failedMapId: targetMapId,
      retainedCoins: game.coins,
      retainedXp: game.xp,
    };
  }
  return {
    reachedTarget: true,
    failedMapId: null,
    retainedCoins: game.coins,
    retainedXp: game.xp,
  };
}

function emptyTowerObject() {
  const base = {};
  for (const id of TOWER_IDS) {
    base[id] = 0;
  }
  return base;
}

function emptyAggregate() {
  return {
    runs: 0,
    wins: 0,
    qualityWins: 0,
    leaksSum: 0,
    coinsSum: 0,
    xpSum: 0,
    winCoinsSum: 0,
    winLeakSum: 0,
    winCount: 0,
    lossLeakSum: 0,
    lossCount: 0,
    towerBuiltTotals: emptyTowerObject(),
    towerLevelTotals: emptyTowerObject(),
  };
}

function emptyRetentionAggregate() {
  return {
    attempts: 0,
    reachedTarget: 0,
    retainedCoinsSum: 0,
    retainedXpSum: 0,
    blockedByMap: {},
  };
}

function mergeBlockedByMap(a, b) {
  const merged = { ...a };
  for (const [mapId, count] of Object.entries(b)) {
    merged[mapId] = (merged[mapId] || 0) + count;
  }
  return merged;
}

function mergeTowerObjects(a, b) {
  const merged = {};
  for (const id of TOWER_IDS) {
    merged[id] = a[id] + b[id];
  }
  return merged;
}

function mergeAggregate(a, b) {
  return {
    runs: a.runs + b.runs,
    wins: a.wins + b.wins,
    qualityWins: a.qualityWins + b.qualityWins,
    leaksSum: a.leaksSum + b.leaksSum,
    coinsSum: a.coinsSum + b.coinsSum,
    xpSum: a.xpSum + b.xpSum,
    winCoinsSum: a.winCoinsSum + b.winCoinsSum,
    winLeakSum: a.winLeakSum + b.winLeakSum,
    winCount: a.winCount + b.winCount,
    lossLeakSum: a.lossLeakSum + b.lossLeakSum,
    lossCount: a.lossCount + b.lossCount,
    towerBuiltTotals: mergeTowerObjects(a.towerBuiltTotals, b.towerBuiltTotals),
    towerLevelTotals: mergeTowerObjects(a.towerLevelTotals, b.towerLevelTotals),
  };
}

function mergeRetentionAggregate(a, b) {
  return {
    attempts: a.attempts + b.attempts,
    reachedTarget: a.reachedTarget + b.reachedTarget,
    retainedCoinsSum: a.retainedCoinsSum + b.retainedCoinsSum,
    retainedXpSum: a.retainedXpSum + b.retainedXpSum,
    blockedByMap: mergeBlockedByMap(a.blockedByMap, b.blockedByMap),
  };
}

function diversityStats(towerBuiltTotals) {
  const total = TOWER_IDS.reduce((sum, id) => sum + towerBuiltTotals[id], 0);
  if (total <= 0) {
    return { entropy: 0, topTowerShare: 0 };
  }
  let entropy = 0;
  let topTowerShare = 0;
  for (const id of TOWER_IDS) {
    const share = towerBuiltTotals[id] / total;
    if (share > 0) {
      entropy -= share * Math.log(share);
      topTowerShare = Math.max(topTowerShare, share);
    }
  }
  const normalizedEntropy = entropy / Math.log(TOWER_IDS.length);
  return {
    entropy: normalizedEntropy,
    topTowerShare,
  };
}

function finalizeAggregate(agg) {
  const avg = (sum, count) => (count ? sum / count : 0);
  const avgTowerBuilt = {};
  const avgTowerLevel = {};
  for (const id of TOWER_IDS) {
    avgTowerBuilt[id] = avg(agg.towerBuiltTotals[id], agg.runs);
    avgTowerLevel[id] = agg.towerBuiltTotals[id] > 0
      ? agg.towerLevelTotals[id] / agg.towerBuiltTotals[id]
      : 0;
  }
  const diversity = diversityStats(agg.towerBuiltTotals);

  return {
    runs: agg.runs,
    wins: agg.wins,
    losses: agg.runs - agg.wins,
    clearRate: agg.wins / agg.runs,
    qualityRate: agg.qualityWins / agg.runs,
    qualityWins: agg.qualityWins,
    avgLeaks: avg(agg.leaksSum, agg.runs),
    avgCoins: avg(agg.coinsSum, agg.runs),
    avgWinCoins: avg(agg.winCoinsSum, agg.winCount),
    avgXp: avg(agg.xpSum, agg.runs),
    avgWinLeaks: avg(agg.winLeakSum, agg.winCount),
    avgLossLeaks: avg(agg.lossLeakSum, agg.lossCount),
    avgTowerBuilt,
    avgTowerLevel,
    diversityEntropy: diversity.entropy,
    topTowerShare: diversity.topTowerShare,
  };
}

function finalizeRetentionAggregate(agg) {
  const reached = agg.reachedTarget;
  return {
    attempts: agg.attempts,
    reachedTarget: reached,
    reachRate: agg.attempts ? reached / agg.attempts : 0,
    avgRetainedCoins: reached ? agg.retainedCoinsSum / reached : 0,
    avgRetainedXp: reached ? agg.retainedXpSum / reached : 0,
    blockedByMap: agg.blockedByMap,
  };
}

function snapshotTunables() {
  return {
    wind: TOWER_CONFIG.magic_wind.levels.map((lvl) => ({ slowPercent: lvl.slowPercent })),
    bomb: TOWER_CONFIG.bone.levels.map((lvl) => ({ splashRadius: lvl.splashRadius })),
    fire: TOWER_CONFIG.magic_fire.levels.map((lvl) => ({ fireballDps: lvl.fireballDps })),
  };
}

function restoreTunables(snapshot) {
  TOWER_CONFIG.magic_wind.levels.forEach((lvl, idx) => {
    lvl.slowPercent = snapshot.wind[idx].slowPercent;
  });
  TOWER_CONFIG.bone.levels.forEach((lvl, idx) => {
    lvl.splashRadius = snapshot.bomb[idx].splashRadius;
  });
  TOWER_CONFIG.magic_fire.levels.forEach((lvl, idx) => {
    lvl.fireballDps = snapshot.fire[idx].fireballDps;
  });
}

function applyMultipliers(multipliers) {
  TOWER_CONFIG.magic_wind.levels.forEach((lvl) => {
    lvl.slowPercent = Math.round(lvl.slowPercent * multipliers.windSlowMult);
  });
  TOWER_CONFIG.bone.levels.forEach((lvl) => {
    lvl.splashRadius = Number((lvl.splashRadius * multipliers.bombSplashMult).toFixed(2));
  });
  TOWER_CONFIG.magic_fire.levels.forEach((lvl) => {
    lvl.fireballDps = Math.round(lvl.fireballDps * multipliers.fireDpsMult);
  });
}

function clampPenalty(value, min, max, center) {
  if (value < min) {
    return (min - value) * 4;
  }
  if (value > max) {
    return (value - max) * 4;
  }
  return Math.abs(value - center);
}

function mapScore(summary, target) {
  const clearPenalty = clampPenalty(
    summary.clearRate,
    target.clearMin,
    target.clearMax,
    target.clearCenter
  );
  const qualityPenalty = clampPenalty(
    summary.qualityRate,
    target.qualityMin,
    target.qualityMax,
    target.qualityCenter
  );
  const leaksPenalty = clampPenalty(
    summary.avgLeaks,
    target.leaksMin,
    target.leaksMax,
    target.leaksCenter
  );
  return clearPenalty * 4.2 + qualityPenalty * 2.8 + leaksPenalty * 1.5;
}

function scoreCandidate(byMap, multipliers, mapIds) {
  const baseScore = mapIds.reduce((sum, mapId) => {
    return sum + mapScore(byMap[mapId], targetForMap(mapId));
  }, 0) / mapIds.length;

  const changePenalty =
    Math.abs(multipliers.windSlowMult - 1) * 0.24 +
    Math.abs(multipliers.bombSplashMult - 1) * 0.24 +
    Math.abs(multipliers.fireDpsMult - 1) * 0.24;
  return baseScore + changePenalty;
}

function inTarget(summary, target) {
  return (
    summary.clearRate >= target.clearMin &&
    summary.clearRate <= target.clearMax &&
    summary.qualityRate >= target.qualityMin &&
    summary.qualityRate <= target.qualityMax &&
    summary.avgLeaks >= target.leaksMin &&
    summary.avgLeaks <= target.leaksMax
  );
}

function scoreInBand(byMap, multipliers, mapIds) {
  const centerScore = mapIds.reduce((sum, mapId) => {
    const target = targetForMap(mapId);
    const summary = byMap[mapId];
    return (
      sum +
      Math.abs(summary.clearRate - target.clearCenter) * 4.2 +
      Math.abs(summary.qualityRate - target.qualityCenter) * 3 +
      Math.abs(summary.avgLeaks - target.leaksCenter) * 1.4
    );
  }, 0) / mapIds.length;

  const changePenalty =
    Math.abs(multipliers.windSlowMult - 1) * 0.24 +
    Math.abs(multipliers.bombSplashMult - 1) * 0.24 +
    Math.abs(multipliers.fireDpsMult - 1) * 0.24;
  return centerScore + changePenalty;
}

function isCudaAvailable() {
  try {
    execSync('nvidia-smi -L', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

async function runManyParallel({
  mapId,
  runs,
  seedStart,
  workers,
  multipliers,
  policyId,
  startingCoinsOverride = null,
  startingXpOverride = null,
}) {
  if (runs <= 0) {
    return finalizeAggregate(emptyAggregate());
  }

  const workerCount = Math.min(workers, runs);
  const base = Math.floor(runs / workerCount);
  const remainder = runs % workerCount;
  let cursor = seedStart;

  const jobs = [];
  for (let i = 0; i < workerCount; i += 1) {
    const count = base + (i < remainder ? 1 : 0);
    jobs.push(
      new Promise((resolve, reject) => {
        const worker = new Worker(new URL(import.meta.url), {
          workerData: {
            mode: 'batch',
            mapId,
            runs: count,
            seedStart: cursor,
            multipliers,
            policyId,
            startingCoinsOverride,
            startingXpOverride,
          },
        });
        cursor += count;

        worker.on('message', (result) => resolve(result));
        worker.on('error', reject);
        worker.on('exit', (code) => {
          if (code !== 0) {
            reject(new Error(`Worker exited with code ${code}`));
          }
        });
      })
    );
  }

  const parts = await Promise.all(jobs);
  let merged = emptyAggregate();
  for (const part of parts) {
    merged = mergeAggregate(merged, part);
  }
  return finalizeAggregate(merged);
}

async function runRetentionParallel({
  targetMapId,
  runs,
  seedStart,
  workers,
  multipliers,
  policyId,
}) {
  if (runs <= 0) {
    return finalizeRetentionAggregate(emptyRetentionAggregate());
  }

  const workerCount = Math.min(workers, runs);
  const base = Math.floor(runs / workerCount);
  const remainder = runs % workerCount;
  let cursor = seedStart;

  const jobs = [];
  for (let i = 0; i < workerCount; i += 1) {
    const count = base + (i < remainder ? 1 : 0);
    jobs.push(
      new Promise((resolve, reject) => {
        const worker = new Worker(new URL(import.meta.url), {
          workerData: {
            mode: 'retention_batch',
            targetMapId,
            runs: count,
            seedStart: cursor,
            multipliers,
            policyId,
          },
        });
        cursor += count;

        worker.on('message', (result) => resolve(result));
        worker.on('error', reject);
        worker.on('exit', (code) => {
          if (code !== 0) {
            reject(new Error(`Worker exited with code ${code}`));
          }
        });
      })
    );
  }

  const parts = await Promise.all(jobs);
  let merged = emptyRetentionAggregate();
  for (const part of parts) {
    merged = mergeRetentionAggregate(merged, part);
  }
  return finalizeRetentionAggregate(merged);
}

function compactTowerSummary(summary) {
  return {
    avgBuilt: Object.fromEntries(
      Object.entries(summary.avgTowerBuilt).map(([k, v]) => [k, Number(v.toFixed(2))])
    ),
    avgLevel: Object.fromEntries(
      Object.entries(summary.avgTowerLevel).map(([k, v]) => [k, Number(v.toFixed(1))])
    ),
    entropy: Number(summary.diversityEntropy.toFixed(3)),
    topTowerShare: Number(summary.topTowerShare.toFixed(3)),
  };
}

function formatSummary(summary) {
  return {
    runs: summary.runs,
    wins: summary.wins,
    losses: summary.losses,
    clearRate: Number((summary.clearRate * 100).toFixed(2)),
    qualityRate: Number((summary.qualityRate * 100).toFixed(2)),
    qualityWins: summary.qualityWins,
    avgLeaks: Number(summary.avgLeaks.toFixed(2)),
    avgWinLeaks: Number(summary.avgWinLeaks.toFixed(2)),
    avgLossLeaks: Number(summary.avgLossLeaks.toFixed(2)),
    avgCoins: Number(summary.avgCoins.toFixed(0)),
    avgWinCoins: Number(summary.avgWinCoins.toFixed(0)),
    avgXp: Number(summary.avgXp.toFixed(0)),
    towers: compactTowerSummary(summary),
  };
}

async function runCandidate({ mapIds, runs, workers, multipliers, seedStart, policyId }) {
  const byMap = {};
  for (const mapId of mapIds) {
    byMap[mapId] = await runManyParallel({
      mapId,
      runs,
      seedStart,
      workers,
      multipliers,
      policyId,
    });
  }
  return byMap;
}

async function runSearch({ mapIds, searchRuns, workers, policyId }) {
  let best = null;
  let bestInBand = null;
  const top = [];

  for (const windSlowMult of SEARCH_GRID.wind) {
    for (const bombSplashMult of SEARCH_GRID.bomb) {
      for (const fireDpsMult of SEARCH_GRID.fire) {
        const multipliers = { windSlowMult, bombSplashMult, fireDpsMult };
        const byMap = await runCandidate({
          mapIds,
          runs: searchRuns,
          workers,
          multipliers,
          seedStart: 1,
          policyId,
        });
        const score = scoreCandidate(byMap, multipliers, mapIds);
        const entry = { multipliers, byMap, score };

        top.push(entry);
        top.sort((a, b) => a.score - b.score);
        if (top.length > 5) {
          top.pop();
        }

        if (!best || entry.score < best.score) {
          best = entry;
        }

        const inBand = mapIds.every((mapId) => inTarget(byMap[mapId], targetForMap(mapId)));
        if (inBand) {
          const bandScore = scoreInBand(byMap, multipliers, mapIds);
          if (!bestInBand || bandScore < bestInBand.score) {
            bestInBand = { ...entry, score: bandScore };
          }
        }
      }
    }
  }
  return { best, bestInBand, top };
}

async function runScenarioMatrix({ mapIds, scenarioIds, runs, workers, multipliers }) {
  const matrix = {};
  for (const policyId of scenarioIds) {
    matrix[policyId] = await runCandidate({
      mapIds,
      runs,
      workers,
      multipliers,
      seedStart: 101,
      policyId,
    });
  }
  return matrix;
}

function summarizeDiversityFindings(matrix, mapIds) {
  const findings = [];
  for (const mapId of mapIds) {
    const balanced = matrix.balanced?.[mapId];
    if (!balanced) {
      continue;
    }
    for (const policyId of MONO_POLICIES) {
      const mono = matrix[policyId]?.[mapId];
      if (!mono) {
        continue;
      }
      const clearDelta = mono.clearRate - balanced.clearRate;
      const leaksDelta = mono.avgLeaks - balanced.avgLeaks;
      if (clearDelta > 0.12 || leaksDelta < -4.0) {
        findings.push(
          `[Imbalance] ${mapId}: ${policyId} appears overpowered vs balanced ` +
          `(clearDelta=${(clearDelta * 100).toFixed(1)}pp leaksDelta=${leaksDelta.toFixed(2)}).`
        );
      }
      if ((clearDelta < -0.5 && mono.clearRate < 0.25) || mono.clearRate < 0.02) {
        findings.push(
          `[Imbalance] ${mapId}: ${policyId} appears underpowered vs balanced ` +
          `(clearRate=${(mono.clearRate * 100).toFixed(1)}%).`
        );
      }
    }
  }
  return findings;
}

async function runOatSensitivity({ mapIds, runs, workers, baseMultipliers, policyId }) {
  const results = {};
  for (const [factor, values] of Object.entries(OAT_GRID)) {
    results[factor] = [];
    for (const value of values) {
      const multipliers = { ...baseMultipliers, [factor]: value };
      const byMap = await runCandidate({
        mapIds,
        runs,
        workers,
        multipliers,
        seedStart: 501,
        policyId,
      });
      const aggregate = mapIds.reduce(
        (acc, mapId) => {
          acc.clearRate += byMap[mapId].clearRate;
          acc.avgLeaks += byMap[mapId].avgLeaks;
          return acc;
        },
        { clearRate: 0, avgLeaks: 0 }
      );
      aggregate.clearRate /= mapIds.length;
      aggregate.avgLeaks /= mapIds.length;
      results[factor].push({
        value,
        clearRate: Number((aggregate.clearRate * 100).toFixed(2)),
        avgLeaks: Number(aggregate.avgLeaks.toFixed(2)),
      });
    }
  }
  return results;
}

function estimateAttemptsForRunTarget(runTarget, clearRate, failRunPenaltyEquivalent) {
  const netRunsPerAttempt = clearRate - (1 - clearRate) * failRunPenaltyEquivalent;
  if (netRunsPerAttempt <= 0) {
    return { netRunsPerAttempt, expectedAttempts: null };
  }
  return {
    netRunsPerAttempt,
    expectedAttempts: Math.ceil(runTarget / netRunsPerAttempt),
  };
}

async function runPassCriteriaStandard({
  mapIds,
  workers,
  multipliers,
  retentionRuns,
  standardRuns,
  retentionPolicyId,
  evaluationPolicyId,
}) {
  const rows = [];
  const orderedMaps = MAP_ORDER.filter((mapId) => mapIds.includes(mapId));
  for (const mapId of orderedMaps) {
    const retention = await runRetentionParallel({
      targetMapId: mapId,
      runs: retentionRuns,
      seedStart: 6001 + (MAP_INDEX.get(mapId) || 0) * 10000,
      workers,
      multipliers,
      policyId: retentionPolicyId,
    });

    const baseCoins = retention.reachedTarget
      ? Math.round(retention.avgRetainedCoins)
      : getMapById(mapId).startingCoins;

    const summary = await runManyParallel({
      mapId,
      runs: standardRuns,
      seedStart: 9001 + (MAP_INDEX.get(mapId) || 0) * 10000,
      workers,
      multipliers,
      policyId: evaluationPolicyId,
      startingCoinsOverride: baseCoins,
    });

    const passRateTarget = passRateTargetForMap(mapId);
    const runTarget = runTargetForMap(mapId);
    const attemptsEstimate = estimateAttemptsForRunTarget(
      runTarget,
      summary.clearRate,
      FAIL_RUN_PENALTY_EQUIVALENT
    );
    const topBlocker = Object.entries(retention.blockedByMap).sort((a, b) => b[1] - a[1])[0] || null;

    rows.push({
      mapId,
      mapName: getMapById(mapId).name,
      retentionRuns,
      retentionReachRate: retention.reachRate,
      retentionReached: retention.reachedTarget,
      retentionAvgCoins: baseCoins,
      retentionAvgXp: Math.round(retention.avgRetainedXp),
      topRetentionBlocker: topBlocker ? { mapId: topBlocker[0], count: topBlocker[1] } : null,
      standardRuns,
      clearRate: summary.clearRate,
      qualityRate: summary.qualityRate,
      avgLeaks: summary.avgLeaks,
      passRateTarget,
      runTarget,
      failRunPenaltyEquivalent: FAIL_RUN_PENALTY_EQUIVALENT,
      netRunsPerAttempt: attemptsEstimate.netRunsPerAttempt,
      expectedAttemptsToPass: attemptsEstimate.expectedAttempts,
      meetsPassRateTarget: summary.clearRate >= passRateTarget,
    });
  }
  return rows;
}

function printPassCriteriaStandard(rows) {
  console.log('\nCampaign pass criteria standard (retention baseline -> fixed-budget MC pass rate)');
  for (const row of rows) {
    const payload = {
      mapId: row.mapId,
      mapName: row.mapName,
      unlockRunsTarget: row.runTarget,
      failPenaltyRuns: row.failRunPenaltyEquivalent,
      retentionProbeRuns: row.retentionRuns,
      retentionReachRate: Number((row.retentionReachRate * 100).toFixed(2)),
      retentionReached: row.retentionReached,
      retainedCoinsBase: row.retentionAvgCoins,
      retainedXpBase: row.retentionAvgXp,
      topRetentionBlocker: row.topRetentionBlocker,
      standardRuns: row.standardRuns,
      mcPassRate: Number((row.clearRate * 100).toFixed(2)),
      mcPassRateTarget: Number((row.passRateTarget * 100).toFixed(2)),
      qualityRate: Number((row.qualityRate * 100).toFixed(2)),
      avgLeaks: Number(row.avgLeaks.toFixed(2)),
      netRunsPerAttempt: Number(row.netRunsPerAttempt.toFixed(3)),
      expectedAttemptsToPass: row.expectedAttemptsToPass,
      meetsPassRateTarget: row.meetsPassRateTarget,
    };
    console.log(JSON.stringify(payload, null, 2));
  }
}

function printMapSet(label, byMap, mapIds) {
  console.log(`\n${label}`);
  for (const mapId of mapIds) {
    console.log(`\n${getMapById(mapId).name}`);
    console.log(JSON.stringify(formatSummary(byMap[mapId]), null, 2));
  }
}

function configuredWorkers(args, cudaDetected) {
  if (cudaDetected) {
    return Math.max(args.workers, Math.min(16, os.cpus()?.length || args.workers));
  }
  return args.workers;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mapIds = parseMapIds(args.maps);
  const primaryPolicyIds = parsePolicyIds(args.policies);
  const policyId = primaryPolicyIds[0] || 'random_all';
  const retentionPolicyIds = parsePolicyIds(args.retentionPolicy);
  const retentionPolicyId = retentionPolicyIds[0] || 'random_all';
  const baselineMultipliers = { windSlowMult: 1, bombSplashMult: 1, fireDpsMult: 1 };
  const searchRuns = args.searchRuns || Math.max(80, Math.round(args.runs * SEARCH_FRACTION));

  let cudaDetected = false;
  if (args.cuda) {
    cudaDetected = isCudaAvailable();
    if (!cudaDetected && args.cudaRequired) {
      throw new Error('CUDA required but no NVIDIA runtime detected (nvidia-smi unavailable).');
    }
  }
  const workers = configuredWorkers(args, cudaDetected);

  console.log('Homeland Monte Carlo Balance Simulation');
  console.log(`runs=${args.runs} searchRuns=${searchRuns} workers=${workers}`);
  console.log(`maps=${mapIds.join(', ')}`);
  console.log(`policy=${policyId}`);
  console.log(`suite=${args.suite}`);
  if (args.cuda) {
    if (cudaDetected) {
      console.log('CUDA detected: using high-throughput mode with expanded worker parallelism.');
    } else {
      console.log('CUDA not detected: falling back to CPU worker-thread parallelism.');
    }
  }

  const baseline = await runCandidate({
    mapIds,
    runs: args.runs,
    workers,
    multipliers: baselineMultipliers,
    seedStart: 1,
    policyId,
  });
  printMapSet('Baseline (current tower values)', baseline, mapIds);

  let selectedMultipliers = baselineMultipliers;
  if (!args.skipSearch) {
    console.log('\nSearching multipliers...');
    const search = await runSearch({ mapIds, searchRuns, workers, policyId });
    const selected = search.bestInBand || search.best;
    selectedMultipliers = selected.multipliers;

    console.log('\nBest candidate multipliers:', search.best.multipliers);
    console.log('Selected tuned multipliers:', selectedMultipliers);
    if (search.bestInBand) {
      console.log('Selection rule: in-target-band candidate closest to center.');
    } else {
      console.log('Selection rule: no full in-band candidate; chose global best score.');
    }

    console.log('\nTop candidates (aggregate score):');
    for (const candidate of search.top) {
      const mapMetrics = {};
      for (const mapId of mapIds) {
        mapMetrics[mapId] = {
          qualityRate: Number((candidate.byMap[mapId].qualityRate * 100).toFixed(2)),
          avgLeaks: Number(candidate.byMap[mapId].avgLeaks.toFixed(2)),
        };
      }
      console.log(
        JSON.stringify(
          {
            multipliers: candidate.multipliers,
            score: Number(candidate.score.toFixed(3)),
            maps: mapMetrics,
          },
          null,
          2
        )
      );
    }
  } else {
    console.log('\nSearch skipped by --skip-search. Baseline values are active.');
  }

  const verified = await runCandidate({
    mapIds,
    runs: args.runs,
    workers,
    multipliers: selectedMultipliers,
    seedStart: 1,
    policyId,
  });
  printMapSet('Full verification (selected multipliers)', verified, mapIds);

  const shouldRunPassStandard = args.suite !== 'quick' && !args.skipStandard;
  if (shouldRunPassStandard) {
    console.log(
      `\nCampaign pass standard (retentionRuns=${args.retentionRuns} standardRuns=${args.standardRuns} ` +
      `retentionPolicy=${retentionPolicyId} failPenaltyRuns=${FAIL_RUN_PENALTY_EQUIVALENT})...`
    );
    const criteriaRows = await runPassCriteriaStandard({
      mapIds,
      workers,
      multipliers: selectedMultipliers,
      retentionRuns: args.retentionRuns,
      standardRuns: args.standardRuns,
      retentionPolicyId,
      evaluationPolicyId: policyId,
    });
    printPassCriteriaStandard(criteriaRows);
  } else if (args.skipStandard) {
    console.log('\nCampaign pass standard skipped by --skip-standard.');
  } else if (args.suite === 'quick') {
    console.log('\nCampaign pass standard skipped for quick suite.');
  }

  if (args.suite === 'full') {
    const diversityRuns = args.diversityRuns || Math.max(180, Math.round(args.runs * 0.35));
    const oatRuns = args.oatRuns || Math.max(140, Math.round(args.runs * 0.28));
    const scenarioIds = [
      'balanced',
      ...MONO_POLICIES,
      'duo_bomb_fire',
      'duo_arrow_wind',
      'duo_fire_lightning',
      'random_all',
    ];

    console.log(`\nDiversity suite (runs=${diversityRuns}, scenarios=${scenarioIds.length})...`);
    const matrix = await runScenarioMatrix({
      mapIds,
      scenarioIds,
      runs: diversityRuns,
      workers,
      multipliers: selectedMultipliers,
    });

    for (const scenarioId of scenarioIds) {
      console.log(`\nScenario: ${POLICIES[scenarioId].label}`);
      for (const mapId of mapIds) {
        const summary = matrix[scenarioId][mapId];
        console.log(
          JSON.stringify(
            {
              mapId,
              clearRate: Number((summary.clearRate * 100).toFixed(2)),
              qualityRate: Number((summary.qualityRate * 100).toFixed(2)),
              avgLeaks: Number(summary.avgLeaks.toFixed(2)),
              entropy: Number(summary.diversityEntropy.toFixed(3)),
              topTowerShare: Number(summary.topTowerShare.toFixed(3)),
              avgBuilt: Object.fromEntries(
                Object.entries(summary.avgTowerBuilt).map(([k, v]) => [k, Number(v.toFixed(2))])
              ),
            },
            null,
            2
          )
        );
      }
    }

    const findings = summarizeDiversityFindings(matrix, mapIds);
    console.log('\nDiversity findings:');
    if (!findings.length) {
      console.log('No major mono-tower dominance or collapse flags detected in this run.');
    } else {
      for (const finding of findings) {
        console.log(finding);
      }
    }

    console.log(`\nControlled OAT sensitivity (runs=${oatRuns})...`);
    const oat = await runOatSensitivity({
      mapIds,
      runs: oatRuns,
      workers,
      baseMultipliers: selectedMultipliers,
      policyId,
    });
    console.log(JSON.stringify(oat, null, 2));
  }

  const snapshot = snapshotTunables();
  applyMultipliers(selectedMultipliers);
  console.log('\nTuned values preview:');
  console.log(
    JSON.stringify(
      {
        windSlowPercent: {
          level1: TOWER_CONFIG.magic_wind.levels[0].slowPercent,
          level25: TOWER_CONFIG.magic_wind.levels[24].slowPercent,
          level50: TOWER_CONFIG.magic_wind.levels[49].slowPercent,
        },
        bombSplashRadius: {
          level1: TOWER_CONFIG.bone.levels[0].splashRadius,
          level25: TOWER_CONFIG.bone.levels[24].splashRadius,
          level50: TOWER_CONFIG.bone.levels[49].splashRadius,
        },
        fireballDps: {
          level1: TOWER_CONFIG.magic_fire.levels[0].fireballDps,
          level25: TOWER_CONFIG.magic_fire.levels[24].fireballDps,
          level50: TOWER_CONFIG.magic_fire.levels[49].fireballDps,
        },
      },
      null,
      2
    )
  );
  restoreTunables(snapshot);
}

function runWorkerBatch() {
  const {
    mapId,
    runs,
    seedStart,
    multipliers,
    policyId,
    startingCoinsOverride,
    startingXpOverride,
  } = workerData;
  const target = targetForMap(mapId);
  const snapshot = snapshotTunables();
  applyMultipliers(multipliers);

  let agg = emptyAggregate();
  for (let i = 0; i < runs; i += 1) {
    const result = runSingle(seedStart + i, mapId, policyId, {
      startingCoinsOverride,
      startingXpOverride,
    });
    agg.runs += 1;
    agg.wins += result.victory ? 1 : 0;
    agg.leaksSum += result.leaked;
    agg.coinsSum += result.coins;
    agg.xpSum += result.xp;

    for (const id of TOWER_IDS) {
      agg.towerBuiltTotals[id] += result.towerCounts[id];
      agg.towerLevelTotals[id] += result.towerLevelSums[id];
    }

    if (result.victory && result.leaked <= target.qualityLeakCap) {
      agg.qualityWins += 1;
    }
    if (result.victory) {
      agg.winCount += 1;
      agg.winCoinsSum += result.coins;
      agg.winLeakSum += result.leaked;
    } else {
      agg.lossCount += 1;
      agg.lossLeakSum += result.leaked;
    }
  }
  restoreTunables(snapshot);
  parentPort.postMessage(agg);
}

function runRetentionWorkerBatch() {
  const { targetMapId, runs, seedStart, multipliers, policyId } = workerData;
  const snapshot = snapshotTunables();
  applyMultipliers(multipliers);

  let agg = emptyRetentionAggregate();
  for (let i = 0; i < runs; i += 1) {
    const result = runCampaignRetentionBaseline(seedStart + i, targetMapId, policyId);
    agg.attempts += 1;
    if (result.reachedTarget) {
      agg.reachedTarget += 1;
      agg.retainedCoinsSum += result.retainedCoins;
      agg.retainedXpSum += result.retainedXp;
    } else if (result.failedMapId) {
      agg.blockedByMap[result.failedMapId] = (agg.blockedByMap[result.failedMapId] || 0) + 1;
    }
  }

  restoreTunables(snapshot);
  parentPort.postMessage(agg);
}

if (isMainThread) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
} else if (workerData?.mode === 'batch') {
  runWorkerBatch();
} else if (workerData?.mode === 'retention_batch') {
  runRetentionWorkerBatch();
}
