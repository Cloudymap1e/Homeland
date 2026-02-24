import os from 'node:os';
import { execSync } from 'node:child_process';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { HomelandGame } from '../web/src/game-core.js';
import { MAPS, DEFAULT_MAP_ID, TOWER_CONFIG } from '../web/src/config.js';

const DEFAULT_RUNS = 1000;
const DEFAULT_WORKERS = Math.max(1, Math.min(8, (os.cpus()?.length || 4) - 1));
const SEARCH_FRACTION = 0.22;

const TARGETS = {
  map_01_river_bend: {
    qualityMin: 0.7,
    qualityMax: 0.86,
    qualityCenter: 0.78,
    leaksMin: 2,
    leaksMax: 10,
    leaksCenter: 5.5,
    qualityLeakCap: 12,
  },
  map_02_split_delta: {
    qualityMin: 0.58,
    qualityMax: 0.78,
    qualityCenter: 0.68,
    leaksMin: 4,
    leaksMax: 16,
    leaksCenter: 9,
    qualityLeakCap: 18,
  },
  map_03_marsh_maze: {
    qualityMin: 0.45,
    qualityMax: 0.68,
    qualityCenter: 0.56,
    leaksMin: 7,
    leaksMax: 24,
    leaksCenter: 14,
    qualityLeakCap: 26,
  },
};

const SEARCH_GRID = {
  wind: [0.95, 1.0, 1.05, 1.1, 1.15, 1.2],
  bomb: [0.9, 1.0, 1.1, 1.2, 1.3],
  fire: [0.9, 1.0, 1.05, 1.1, 1.15],
};

function parseArgs(argv) {
  const args = {
    runs: DEFAULT_RUNS,
    maps: 'all',
    workers: DEFAULT_WORKERS,
    cuda: false,
    searchRuns: null,
    skipSearch: false,
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
    } else if (arg.startsWith('--search-runs=')) {
      args.searchRuns = Math.max(20, Number(arg.split('=')[1]));
    } else if (arg === '--skip-search') {
      args.skipSearch = true;
    }
  }
  return args;
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
  return game.mapConfig.buildSlots.filter((slot) => !game.getTower(slot.id));
}

function getBuiltTowers(game) {
  return game.mapConfig.buildSlots
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
  const counts = {
    arrow: 0,
    bone: 0,
    magic_fire: 0,
    magic_wind: 0,
    magic_lightning: 0,
  };
  for (const tower of getBuiltTowers(game)) {
    counts[tower.towerId] = (counts[tower.towerId] || 0) + 1;
  }
  return counts;
}

function desiredTowerCount(game, waveIndex) {
  const fraction = Math.min(1, waveIndex / Math.max(1, game.waves.length - 1));
  return Math.min(game.mapConfig.buildSlots.length, 5 + Math.floor(fraction * (game.mapConfig.buildSlots.length - 4)));
}

function desiredUpgradeLevel(game, waveIndex) {
  const fraction = Math.min(1, waveIndex / Math.max(1, game.waves.length - 1));
  return 2 + Math.floor(fraction * 24);
}

function buildWeights(waveIndex, counts, mapId) {
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
  if (waveIndex >= 3 && (counts.magic_wind || 0) === 0) {
    base.magic_wind += 0.9;
  }
  if (waveIndex >= 4 && (counts.magic_fire || 0) === 0) {
    base.magic_fire += 0.7;
  }
  if ((counts.bone || 0) === 0) {
    base.bone += 0.65;
  }
  if ((counts.arrow || 0) < 2) {
    base.arrow += 0.45;
  }
  return base;
}

function tryBuildSpecific(game, rand, towerId) {
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

function tryBuildAction(game, rand, waveIndex, counts, mapId) {
  const emptySlots = getEmptySlots(game);
  if (emptySlots.length === 0) {
    return false;
  }
  const weights = buildWeights(waveIndex, counts, mapId);
  const affordable = Object.values(TOWER_CONFIG)
    .map((cfg) => ({ towerId: cfg.id, cost: cfg.levels[0].cost, weight: weights[cfg.id] || 0.1 }))
    .filter((entry) => entry.cost <= game.coins);
  if (!affordable.length) {
    return false;
  }
  const slot = pickRandom(rand, emptySlots);
  const pick = pickWeighted(rand, affordable);
  return game.buildTower(slot.id, pick.towerId).ok;
}

function tryUpgradeAction(game, rand, waveIndex) {
  const targetLevel = desiredUpgradeLevel(game, waveIndex);
  const upgradeable = getUpgradeableTowers(game)
    .map((tower) => ({ tower, cost: upgradeCost(tower) }))
    .filter((entry) => entry.cost <= game.coins);

  if (!upgradeable.length) {
    return false;
  }

  const weighted = upgradeable.map((entry) => {
    const id = entry.tower.towerId;
    let weight = 1;
    if (entry.tower.level < targetLevel) {
      weight += 1.4;
    }
    if (id === 'arrow') weight += 0.34;
    if (id === 'bone') weight += 0.42;
    if (id === 'magic_fire') weight += 0.38;
    if (id === 'magic_wind' && waveIndex >= 4) weight += 0.3;
    if (id === 'magic_lightning' && waveIndex >= 7) weight += 0.2;
    return { ...entry, weight };
  });

  const pick = pickWeighted(rand, weighted);
  return game.upgradeTower(pick.tower.slotId).ok;
}

function runBuildPhase(game, rand, mapId) {
  const waveIndex = Math.max(0, game.waveIndex + 1);
  const actions = 3 + Math.floor(rand() * 5);
  const wantedTowers = desiredTowerCount(game, waveIndex);

  for (let i = 0; i < actions; i += 1) {
    const built = getBuiltTowers(game);
    const counts = towerCounts(game);

    if (waveIndex >= 2 && counts.magic_wind === 0 && tryBuildSpecific(game, rand, 'magic_wind')) {
      continue;
    }
    if (waveIndex >= 3 && counts.magic_fire === 0 && tryBuildSpecific(game, rand, 'magic_fire')) {
      continue;
    }
    if (counts.bone === 0 && tryBuildSpecific(game, rand, 'bone')) {
      continue;
    }

    const shouldBuild = built.length < wantedTowers && getEmptySlots(game).length > 0;
    if (shouldBuild && tryBuildAction(game, rand, waveIndex, counts, mapId)) {
      continue;
    }
    if (tryUpgradeAction(game, rand, waveIndex)) {
      continue;
    }
    if (tryBuildAction(game, rand, waveIndex, counts, mapId)) {
      continue;
    }
    break;
  }
}

function runSingle(seed, mapId) {
  const rand = createRng(seed);
  const game = new HomelandGame({ mapId });
  let guard = 0;

  while (game.state !== 'map_result' && guard < 500000) {
    if (game.state === 'build_phase' || game.state === 'wave_result') {
      runBuildPhase(game, rand, mapId);
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
  return {
    victory: Boolean(snap.result?.victory),
    leaked: snap.leaked,
    coins: snap.coins,
    xp: snap.xp,
  };
}

function emptyAggregate() {
  return {
    runs: 0,
    wins: 0,
    qualityWins: 0,
    leaksSum: 0,
    coinsSum: 0,
    xpSum: 0,
    winLeakSum: 0,
    winCount: 0,
    lossLeakSum: 0,
    lossCount: 0,
  };
}

function mergeAggregate(a, b) {
  return {
    runs: a.runs + b.runs,
    wins: a.wins + b.wins,
    qualityWins: a.qualityWins + b.qualityWins,
    leaksSum: a.leaksSum + b.leaksSum,
    coinsSum: a.coinsSum + b.coinsSum,
    xpSum: a.xpSum + b.xpSum,
    winLeakSum: a.winLeakSum + b.winLeakSum,
    winCount: a.winCount + b.winCount,
    lossLeakSum: a.lossLeakSum + b.lossLeakSum,
    lossCount: a.lossCount + b.lossCount,
  };
}

function finalizeAggregate(agg) {
  const avg = (sum, count) => (count ? sum / count : 0);
  return {
    runs: agg.runs,
    wins: agg.wins,
    losses: agg.runs - agg.wins,
    clearRate: agg.wins / agg.runs,
    qualityRate: agg.qualityWins / agg.runs,
    qualityWins: agg.qualityWins,
    avgLeaks: avg(agg.leaksSum, agg.runs),
    avgCoins: avg(agg.coinsSum, agg.runs),
    avgXp: avg(agg.xpSum, agg.runs),
    avgWinLeaks: avg(agg.winLeakSum, agg.winCount),
    avgLossLeaks: avg(agg.lossLeakSum, agg.lossCount),
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
  const qualityPenalty = clampPenalty(summary.qualityRate, target.qualityMin, target.qualityMax, target.qualityCenter);
  const leaksPenalty = clampPenalty(summary.avgLeaks, target.leaksMin, target.leaksMax, target.leaksCenter);
  return qualityPenalty * 3.2 + leaksPenalty * 1.5;
}

function inTarget(summary, target) {
  return (
    summary.qualityRate >= target.qualityMin &&
    summary.qualityRate <= target.qualityMax &&
    summary.avgLeaks >= target.leaksMin &&
    summary.avgLeaks <= target.leaksMax
  );
}

function scoreCandidate(byMap, multipliers, mapIds) {
  const baseScore = mapIds.reduce((sum, mapId) => sum + mapScore(byMap[mapId], TARGETS[mapId]), 0) / mapIds.length;
  const changePenalty =
    Math.abs(multipliers.windSlowMult - 1) * 0.24 +
    Math.abs(multipliers.bombSplashMult - 1) * 0.24 +
    Math.abs(multipliers.fireDpsMult - 1) * 0.24;
  return baseScore + changePenalty;
}

function scoreInBand(byMap, multipliers, mapIds) {
  const centerScore = mapIds.reduce((sum, mapId) => {
    const target = TARGETS[mapId];
    const summary = byMap[mapId];
    return (
      sum +
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

async function runManyParallel({ mapId, runs, seedStart, workers, multipliers }) {
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
    avgXp: Number(summary.avgXp.toFixed(0)),
  };
}

async function runCandidate({ mapIds, runs, workers, multipliers, seedStart }) {
  const byMap = {};
  for (const mapId of mapIds) {
    byMap[mapId] = await runManyParallel({
      mapId,
      runs,
      seedStart,
      workers,
      multipliers,
    });
  }
  return byMap;
}

async function runSearch({ mapIds, searchRuns, workers }) {
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

        const inBand = mapIds.every((mapId) => inTarget(byMap[mapId], TARGETS[mapId]));
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

function parseMapIds(raw) {
  if (raw === 'all') {
    return Object.keys(MAPS);
  }
  const requested = raw.split(',').map((id) => id.trim()).filter(Boolean);
  if (!requested.length) {
    return [DEFAULT_MAP_ID];
  }
  return requested.filter((id) => Boolean(MAPS[id]));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mapIds = parseMapIds(args.maps);
  const baselineMultipliers = { windSlowMult: 1, bombSplashMult: 1, fireDpsMult: 1 };
  const searchRuns = args.searchRuns || Math.max(80, Math.round(args.runs * SEARCH_FRACTION));

  console.log('Homeland Monte Carlo Balance Simulation');
  console.log(`runs=${args.runs} searchRuns=${searchRuns} workers=${args.workers}`);
  console.log(`maps=${mapIds.join(', ')}`);

  if (args.cuda) {
    const cudaDetected = isCudaAvailable();
    if (cudaDetected) {
      console.log('CUDA detected, but JS prototype uses worker-thread CPU Monte Carlo path.');
    } else {
      console.log('CUDA not detected. Using worker-thread CPU Monte Carlo path.');
    }
  }

  console.log('\nBaseline (current tower values)');
  const baseline = await runCandidate({
    mapIds,
    runs: args.runs,
    workers: args.workers,
    multipliers: baselineMultipliers,
    seedStart: 1,
  });
  for (const mapId of mapIds) {
    console.log(`\n${getMapById(mapId).name}`);
    console.log(JSON.stringify(formatSummary(baseline[mapId]), null, 2));
  }

  if (args.skipSearch) {
    console.log('\nSearch skipped by --skip-search. Baseline values are the active tuned values.');
    return;
  }

  console.log('\nSearching multipliers...');
  const search = await runSearch({ mapIds, searchRuns, workers: args.workers });

  const selected = search.bestInBand || search.best;
  console.log('\nBest candidate multipliers:', search.best.multipliers);
  console.log('Selected tuned multipliers:', selected.multipliers);
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

  console.log('\nFull verification with selected multipliers');
  const tuned = await runCandidate({
    mapIds,
    runs: args.runs,
    workers: args.workers,
    multipliers: selected.multipliers,
    seedStart: 1,
  });
  for (const mapId of mapIds) {
    console.log(`\n${getMapById(mapId).name}`);
    console.log(JSON.stringify(formatSummary(tuned[mapId]), null, 2));
  }

  const snapshot = snapshotTunables();
  applyMultipliers(selected.multipliers);
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
  const { mapId, runs, seedStart, multipliers } = workerData;
  const target = TARGETS[mapId] || TARGETS[DEFAULT_MAP_ID];
  const snapshot = snapshotTunables();
  applyMultipliers(multipliers);

  let agg = emptyAggregate();
  for (let i = 0; i < runs; i += 1) {
    const result = runSingle(seedStart + i, mapId);
    agg.runs += 1;
    agg.wins += result.victory ? 1 : 0;
    agg.leaksSum += result.leaked;
    agg.coinsSum += result.coins;
    agg.xpSum += result.xp;

    if (result.victory && result.leaked <= target.qualityLeakCap) {
      agg.qualityWins += 1;
    }
    if (result.victory) {
      agg.winCount += 1;
      agg.winLeakSum += result.leaked;
    } else {
      agg.lossCount += 1;
      agg.lossLeakSum += result.leaked;
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
}
