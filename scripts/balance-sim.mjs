import { HomelandGame } from '../web/src/game-core.js';
import { MAP_CONFIG, TOWER_CONFIG } from '../web/src/config.js';

const DEFAULT_RUNS = 1000;

const TARGET = {
  qualityMin: 0.65,
  qualityMax: 0.8,
  qualityCenter: 0.725,
  leaksMin: 1,
  leaksMax: 4,
  leaksCenter: 2.5,
};

function parseArgs(argv) {
  const args = { runs: DEFAULT_RUNS };
  for (const arg of argv) {
    if (arg.startsWith('--runs=')) {
      args.runs = Number(arg.split('=')[1]);
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

function levelConfigForTower(tower) {
  return TOWER_CONFIG[tower.towerId].levels[tower.level - 1];
}

function upgradeCost(tower) {
  const cfg = TOWER_CONFIG[tower.towerId];
  if (tower.level >= cfg.levels.length) {
    return Number.POSITIVE_INFINITY;
  }
  return cfg.levels[tower.level].cost;
}

function getEmptySlots(game) {
  return MAP_CONFIG.buildSlots.filter((slot) => !game.getTower(slot.id));
}

function getUpgradeableTowers(game) {
  return MAP_CONFIG.buildSlots
    .map((slot) => game.getTower(slot.id))
    .filter((tower) => tower !== null && tower.level < TOWER_CONFIG[tower.towerId].levels.length);
}

function getBuiltTowers(game) {
  return MAP_CONFIG.buildSlots
    .map((slot) => game.getTower(slot.id))
    .filter((tower) => tower !== null);
}

function getTowerCounts(game) {
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

function buildWeightsForWave(waveIndex) {
  if (waveIndex <= 1) {
    return {
      arrow: 0.28,
      bone: 0.24,
      magic_fire: 0.2,
      magic_wind: 0.2,
      magic_lightning: 0.08,
    };
  }
  return {
    arrow: 0.22,
    bone: 0.26,
    magic_fire: 0.23,
    magic_wind: 0.2,
    magic_lightning: 0.09,
  };
}

function tryBuildAction(game, rand, waveIndex, counts) {
  const emptySlots = getEmptySlots(game);
  if (emptySlots.length === 0) {
    return false;
  }

  const weights = buildWeightsForWave(waveIndex);
  if (waveIndex >= 2 && (counts.magic_wind || 0) === 0) {
    weights.magic_wind += 0.8;
  }
  if (waveIndex >= 2 && (counts.magic_fire || 0) === 0) {
    weights.magic_fire += 0.6;
  }
  if ((counts.bone || 0) === 0) {
    weights.bone += 0.6;
  }
  if ((counts.arrow || 0) < 2) {
    weights.arrow += 0.35;
  }
  if (waveIndex >= 4) {
    weights.bone += 0.25;
    weights.magic_fire += 0.2;
  }

  const affordable = Object.values(TOWER_CONFIG)
    .map((cfg) => ({ towerId: cfg.id, cost: cfg.levels[0].cost, weight: weights[cfg.id] || 0.1 }))
    .filter((cfg) => cfg.cost <= game.coins);

  if (affordable.length === 0) {
    return false;
  }

  const slot = pickRandom(rand, emptySlots);
  const choice = pickWeighted(rand, affordable);
  const result = game.buildTower(slot.id, choice.towerId);
  return result.ok;
}

function tryBuildSpecific(game, rand, towerId) {
  const cfg = TOWER_CONFIG[towerId];
  if (!cfg || game.coins < cfg.levels[0].cost) {
    return false;
  }
  const emptySlots = getEmptySlots(game);
  if (!emptySlots.length) {
    return false;
  }
  const slot = pickRandom(rand, emptySlots);
  return game.buildTower(slot.id, towerId).ok;
}

function tryUpgradeAction(game, rand, waveIndex) {
  const upgradeable = getUpgradeableTowers(game)
    .map((tower) => ({ tower, cost: upgradeCost(tower) }))
    .filter((entry) => entry.cost <= game.coins);

  if (upgradeable.length === 0) {
    return false;
  }

  // Priority for low-level core towers, still stochastic.
  const weighted = upgradeable.map((entry) => {
    const id = entry.tower.towerId;
    let weight = 1 + (3 - entry.tower.level) * 0.45;
    if (id === 'arrow') weight += 0.28;
    if (id === 'bone') weight += 0.34;
    if (id === 'magic_fire') weight += 0.3;
    if (id === 'magic_wind' && waveIndex >= 3) weight += 0.22;
    return { ...entry, weight };
  });

  const pick = pickWeighted(rand, weighted);
  const result = game.upgradeTower(pick.tower.slotId);
  return result.ok;
}

function runBuildPhase(game, rand) {
  const waveIndex = Math.max(0, game.waveIndex + 1);
  const actions = 2 + Math.floor(rand() * 3);
  const desiredTowerCount = Math.min(10, 2 + waveIndex * 2);

  for (let i = 0; i < actions; i += 1) {
    const built = getBuiltTowers(game);
    const counts = getTowerCounts(game);

    if (waveIndex >= 2 && counts.magic_wind === 0 && tryBuildSpecific(game, rand, 'magic_wind')) {
      continue;
    }
    if (waveIndex >= 2 && counts.magic_fire === 0 && tryBuildSpecific(game, rand, 'magic_fire')) {
      continue;
    }
    if (counts.bone === 0 && tryBuildSpecific(game, rand, 'bone')) {
      continue;
    }

    const shouldBuild = built.length < desiredTowerCount && getEmptySlots(game).length > 0;
    if (shouldBuild && tryBuildAction(game, rand, waveIndex, counts)) {
      continue;
    }

    if (tryUpgradeAction(game, rand, waveIndex)) {
      continue;
    }

    if (tryBuildAction(game, rand, waveIndex, counts)) {
      continue;
    }
    break;
  }
}

function runSingle(seed) {
  const rand = createRng(seed);
  const game = new HomelandGame();
  let guard = 0;

  while (game.state !== 'map_result' && guard < 180000) {
    if (game.state === 'build_phase' || game.state === 'wave_result') {
      runBuildPhase(game, rand);
      const started = game.startNextWave();
      if (!started.ok) {
        break;
      }
    }

    if (game.state === 'wave_running') {
      game.tick(0.05);
    }

    guard += 1;
  }

  const snap = game.getSnapshot();
  return {
    victory: Boolean(snap.result?.victory),
    leaked: snap.leaked,
    killed: snap.killed,
    spawned: snap.spawned,
    coins: snap.coins,
    xp: snap.xp,
  };
}

function summarize(results) {
  const runs = results.length;
  const wins = results.filter((r) => r.victory).length;
  const clearRate = wins / runs;
  const qualityWins = results.filter((r) => r.victory && r.leaked <= 4).length;
  const qualityRate = qualityWins / runs;
  const avgLeaks = results.reduce((s, r) => s + r.leaked, 0) / runs;
  const avgCoins = results.reduce((s, r) => s + r.coins, 0) / runs;
  const avgXp = results.reduce((s, r) => s + r.xp, 0) / runs;

  const winLeaks = results.filter((r) => r.victory).map((r) => r.leaked);
  const lossLeaks = results.filter((r) => !r.victory).map((r) => r.leaked);

  const avg = (arr) => (arr.length ? arr.reduce((s, n) => s + n, 0) / arr.length : 0);

  return {
    runs,
    wins,
    losses: runs - wins,
    clearRate,
    qualityRate,
    qualityWins,
    avgLeaks,
    avgWinLeaks: avg(winLeaks),
    avgLossLeaks: avg(lossLeaks),
    avgCoins,
    avgXp,
  };
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

function scoreSummary(summary, multipliers) {
  const qualityPenalty = clampPenalty(
    summary.qualityRate,
    TARGET.qualityMin,
    TARGET.qualityMax,
    TARGET.qualityCenter
  );
  const leaksPenalty = clampPenalty(summary.avgLeaks, TARGET.leaksMin, TARGET.leaksMax, TARGET.leaksCenter);
  const changePenalty =
    Math.abs(multipliers.windSlowMult - 1) * 0.25 +
    Math.abs(multipliers.bombSplashMult - 1) * 0.25 +
    Math.abs(multipliers.fireDpsMult - 1) * 0.25;

  return qualityPenalty * 3 + leaksPenalty * 1.5 + changePenalty;
}

function scoreWithinTarget(summary, multipliers) {
  const changePenalty =
    Math.abs(multipliers.windSlowMult - 1) * 0.25 +
    Math.abs(multipliers.bombSplashMult - 1) * 0.25 +
    Math.abs(multipliers.fireDpsMult - 1) * 0.25;
  return (
    Math.abs(summary.qualityRate - TARGET.qualityCenter) * 3 +
    Math.abs(summary.avgLeaks - TARGET.leaksCenter) * 1.5 +
    changePenalty
  );
}

function inTargetBand(summary) {
  return (
    summary.qualityRate >= TARGET.qualityMin &&
    summary.qualityRate <= TARGET.qualityMax &&
    summary.avgLeaks >= TARGET.leaksMin &&
    summary.avgLeaks <= TARGET.leaksMax
  );
}

function snapshotTowerTunables() {
  return {
    wind: TOWER_CONFIG.magic_wind.levels.map((lvl) => ({ slowPercent: lvl.slowPercent })),
    bomb: TOWER_CONFIG.bone.levels.map((lvl) => ({ splashRadius: lvl.splashRadius })),
    fire: TOWER_CONFIG.magic_fire.levels.map((lvl) => ({ fireballDps: lvl.fireballDps })),
  };
}

function restoreTowerTunables(snapshot) {
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

function applyMultipliers({ windSlowMult, bombSplashMult, fireDpsMult }) {
  TOWER_CONFIG.magic_wind.levels.forEach((lvl) => {
    lvl.slowPercent = Math.round(lvl.slowPercent * windSlowMult);
  });
  TOWER_CONFIG.bone.levels.forEach((lvl) => {
    lvl.splashRadius = Number((lvl.splashRadius * bombSplashMult).toFixed(2));
  });
  TOWER_CONFIG.magic_fire.levels.forEach((lvl) => {
    lvl.fireballDps = Math.round(lvl.fireballDps * fireDpsMult);
  });
}

function runMany(runs, seedStart = 1) {
  const results = [];
  for (let i = 0; i < runs; i += 1) {
    results.push(runSingle(seedStart + i));
  }
  return summarize(results);
}

function printSummary(label, summary, multipliers = null) {
  if (multipliers) {
    console.log(`\n${label} multipliers:`, multipliers);
  } else {
    console.log(`\n${label}`);
  }
  console.log(
    JSON.stringify(
      {
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
      },
      null,
      2
    )
  );
}

function runSearch(searchRuns) {
  const snapshot = snapshotTowerTunables();

  const windMults = [0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6];
  const bombMults = [0.9, 1.0, 1.1, 1.2, 1.3, 1.4];
  const fireMults = [0.9, 1.0, 1.1, 1.2, 1.3, 1.4];

  let best = null;
  let bestInBand = null;
  const top = [];

  for (const windSlowMult of windMults) {
    for (const bombSplashMult of bombMults) {
      for (const fireDpsMult of fireMults) {
        restoreTowerTunables(snapshot);
        const multipliers = { windSlowMult, bombSplashMult, fireDpsMult };
        applyMultipliers(multipliers);
        const summary = runMany(searchRuns, 1);
        const score = scoreSummary(summary, multipliers);

        top.push({ multipliers, summary, score });
        top.sort((a, b) => a.score - b.score);
        if (top.length > 5) {
          top.pop();
        }

        if (!best || score < best.score) {
          best = { multipliers, summary, score };
        }

        if (inTargetBand(summary)) {
          const bandScore = scoreWithinTarget(summary, multipliers);
          if (!bestInBand || bandScore < bestInBand.score) {
            bestInBand = { multipliers, summary, score: bandScore };
          }
        }
      }
    }
  }

  restoreTowerTunables(snapshot);
  best.top = top;
  best.bestInBand = bestInBand;
  return best;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log('Homeland Balance Simulation');
  console.log(`targetQualityRate=${Math.round(TARGET.qualityMin * 100)}-${Math.round(TARGET.qualityMax * 100)}%`);
  console.log(`targetAvgLeaks=${TARGET.leaksMin}-${TARGET.leaksMax}`);

  const baseline = runMany(args.runs, 1);
  printSummary('Baseline', baseline);

  const best = runSearch(args.runs);
  printSummary('Best candidate (search sample)', best.summary, best.multipliers);
  if (best.bestInBand) {
    printSummary(
      'Best candidate inside target band',
      best.bestInBand.summary,
      best.bestInBand.multipliers
    );
  }

  console.log('\\nTop candidates:');
  for (const candidate of best.top) {
    console.log(
      JSON.stringify(
        {
          multipliers: candidate.multipliers,
          score: Number(candidate.score.toFixed(3)),
          qualityRate: Number((candidate.summary.qualityRate * 100).toFixed(2)),
          avgLeaks: Number(candidate.summary.avgLeaks.toFixed(2)),
        },
        null,
        2
      )
    );
  }

  const snapshot = snapshotTowerTunables();
  const tunedChoice = best.bestInBand || best;
  applyMultipliers(tunedChoice.multipliers);
  const tuned = runMany(args.runs, 1);
  printSummary('Tuned (full verification)', tuned, tunedChoice.multipliers);

  // Emit exact tuned values for easy copy into config.
  console.log('\nTuned values preview:');
  console.log(
    JSON.stringify(
      {
        windSlowPercent: TOWER_CONFIG.magic_wind.levels.map((lvl) => lvl.slowPercent),
        bombSplashRadius: TOWER_CONFIG.bone.levels.map((lvl) => lvl.splashRadius),
        fireballDps: TOWER_CONFIG.magic_fire.levels.map((lvl) => lvl.fireballDps),
      },
      null,
      2
    )
  );

  restoreTowerTunables(snapshot);
}

main();
