import { MAPS, DEFAULT_MAP_ID, TOWER_CONFIG, ENEMIES, PROGRESSION } from '../web/src/config.js';

const WORLD_SCALE = 10;
const CHAIN_RADIUS = 2.6;
const MAP_RENDER_WIDTH = 1100;
const MAP_RENDER_HEIGHT = 680;
const DEFAULT_SLOT_RIVER_CLEARANCE_PX = 12;
const TOWER_IDS = ['arrow', 'bone', 'magic_fire', 'magic_wind', 'magic_lightning'];
const TOWER_ID_TO_INDEX = new Map(TOWER_IDS.map((id, idx) => [id, idx]));
const ENEMY_IDS = ['scout', 'raider', 'barge', 'juggernaut'];
const ENEMY_ID_TO_INDEX = new Map(ENEMY_IDS.map((id, idx) => [id, idx]));

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function getPathSegments(points) {
  const segments = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const len = distance(a, b) * WORLD_SCALE;
    segments.push({
      ax: a.x,
      ay: a.y,
      bx: b.x,
      by: b.y,
      len,
      dx: b.x - a.x,
      dy: b.y - a.y,
    });
    total += len;
  }
  return { points, segments, length: total };
}

function pointToSegmentDistance(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const abLenSq = abx * abx + aby * aby;
  const t = abLenSq === 0 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLenSq));
  const closestX = ax + abx * t;
  const closestY = ay + aby * t;
  return Math.hypot(px - closestX, py - closestY);
}

function toRenderPoint(point) {
  return {
    x: point.x * MAP_RENDER_WIDTH,
    y: point.y * MAP_RENDER_HEIGHT,
  };
}

function slotToRouteDistancePx(slot, routes) {
  const slotPoint = toRenderPoint(slot);
  let minDistance = Number.POSITIVE_INFINITY;
  for (const route of routes) {
    const points = route.waypoints.map(toRenderPoint);
    for (let i = 0; i < points.length - 1; i += 1) {
      const start = points[i];
      const end = points[i + 1];
      const d = pointToSegmentDistance(slotPoint.x, slotPoint.y, start.x, start.y, end.x, end.y);
      if (d < minDistance) {
        minDistance = d;
      }
    }
  }
  return minDistance;
}

function partitionBuildSlots(mapConfig) {
  const buildable = [];
  const blocked = [];
  const clearancePx = Number.isFinite(mapConfig.slotRiverClearancePx)
    ? Math.max(0, mapConfig.slotRiverClearancePx)
    : DEFAULT_SLOT_RIVER_CLEARANCE_PX;

  for (const slot of mapConfig.buildSlots) {
    const slotDistance = slotToRouteDistancePx(slot, mapConfig.routes);
    if (slotDistance < clearancePx) {
      blocked.push(slot);
    } else {
      buildable.push(slot);
    }
  }

  return { buildable, blocked };
}

function pickWeightedIndex(weights, rand) {
  const valid = Array.isArray(weights) && weights.length > 0 ? weights : [1];
  let total = 0;
  for (let i = 0; i < valid.length; i += 1) {
    total += Math.max(0, valid[i]);
  }
  if (total <= 0) {
    return 0;
  }
  let threshold = rand() * total;
  for (let i = 0; i < valid.length; i += 1) {
    threshold -= Math.max(0, valid[i]);
    if (threshold <= 0) {
      return i;
    }
  }
  return valid.length - 1;
}

function maxEnemyCapacityForMap(mapConfig) {
  const boatsTotal = mapConfig.waves.reduce(
    (sum, wave) => sum + Object.values(wave.composition).reduce((wSum, count) => wSum + count, 0),
    0
  );
  return Math.max(512, boatsTotal + 64);
}

function maxFireZoneCapacityForMap(mapConfig) {
  return Math.max(256, mapConfig.waves.length * 64);
}

function ensureFloatCapacity(arr, minSize) {
  if (arr.length >= minSize) {
    return arr;
  }
  const out = new Float64Array(Math.max(minSize, arr.length * 2));
  out.set(arr);
  return out;
}

function ensureIntCapacity(arr, minSize) {
  if (arr.length >= minSize) {
    return arr;
  }
  const out = new Int32Array(Math.max(minSize, arr.length * 2));
  out.set(arr);
  return out;
}

export class FastHomelandGame {
  constructor(options = {}) {
    this.rand = typeof options.rand === 'function' ? options.rand : Math.random;
    this.gpuWaveSim = typeof options.gpuWaveSim === 'function' ? options.gpuWaveSim : null;

    this.mapId = DEFAULT_MAP_ID;
    this.mapConfig = MAPS[this.mapId];
    this.pathInfos = [];
    this.routeWeights = [];
    this.buildSlots = [];
    this.blockedBuildSlots = [];
    this.slotIdToIndex = new Map();
    this.slotActivationCost = new Int32Array(0);
    this.slotX = new Float64Array(0);
    this.slotY = new Float64Array(0);

    this.enemyCap = 0;
    this.enemyCount = 0;
    this.enemyType = new Int32Array(0);
    this.enemyHp = new Float64Array(0);
    this.enemyMaxHp = new Float64Array(0);
    this.enemySpeed = new Float64Array(0);
    this.enemyCoinReward = new Int32Array(0);
    this.enemyXpReward = new Int32Array(0);
    this.enemyDistance = new Float64Array(0);
    this.enemyRouteIndex = new Int32Array(0);
    this.enemyRouteLength = new Float64Array(0);
    this.enemyBurnDps = new Float64Array(0);
    this.enemyBurnDuration = new Float64Array(0);
    this.enemySlowPercent = new Float64Array(0);
    this.enemySlowDuration = new Float64Array(0);
    this.enemyShockDuration = new Float64Array(0);
    this.enemyPosX = new Float64Array(0);
    this.enemyPosY = new Float64Array(0);

    this.fireCap = 0;
    this.fireCount = 0;
    this.fireX = new Float64Array(0);
    this.fireY = new Float64Array(0);
    this.fireRadius = new Float64Array(0);
    this.fireDps = new Float64Array(0);
    this.fireDuration = new Float64Array(0);

    this.towerTypeBySlot = new Int32Array(0);
    this.towerLevelBySlot = new Int32Array(0);
    this.towerCooldownBySlot = new Float64Array(0);
    this.slotActivated = new Uint8Array(0);

    this.targetScratch = new Int32Array(128);

    this.waves = [];
    this.waveIndex = -1;
    this.spawnCooldown = 0;
    this.spawnQueue = new Int32Array(0);
    this.spawnQueueLen = 0;
    this.spawnCursor = 0;

    this.speed = 1;
    this.state = 'build_phase';
    this.result = null;
    this.coins = 0;
    this.xp = 0;
    this.stats = { spawned: 0, killed: 0, leaked: 0 };

    this.lastAttacks = [];

    this.loadMap(options.mapId || DEFAULT_MAP_ID);
    this.reset();
  }

  loadMap(mapId) {
    const next = MAPS[mapId] || MAPS[DEFAULT_MAP_ID];
    this.mapId = next.mapId;
    this.mapConfig = next;
    this.waves = next.waves;

    const slotSets = partitionBuildSlots(next);
    this.buildSlots = slotSets.buildable;
    this.blockedBuildSlots = slotSets.blocked;
    this.slotIdToIndex = new Map(this.buildSlots.map((slot, idx) => [slot.id, idx]));

    const slotCount = this.buildSlots.length;
    this.slotActivationCost = new Int32Array(slotCount);
    this.slotX = new Float64Array(slotCount);
    this.slotY = new Float64Array(slotCount);
    for (let i = 0; i < slotCount; i += 1) {
      const slot = this.buildSlots[i];
      this.slotX[i] = slot.x;
      this.slotY[i] = slot.y;
      const baseCost = Number.isFinite(slot.activationCost)
        ? slot.activationCost
        : (Number.isFinite(next.slotActivationCost) ? next.slotActivationCost : 0);
      this.slotActivationCost[i] = Math.max(0, Math.round(baseCost));
    }

    this.towerTypeBySlot = new Int32Array(slotCount);
    this.towerTypeBySlot.fill(-1);
    this.towerLevelBySlot = new Int32Array(slotCount);
    this.towerCooldownBySlot = new Float64Array(slotCount);
    this.slotActivated = new Uint8Array(slotCount);

    this.pathInfos = next.routes.map((route) => getPathSegments(route.waypoints));
    this.routeWeights = next.defaultRouteWeights || [];

    this.enemyCap = maxEnemyCapacityForMap(next);
    this.enemyType = new Int32Array(this.enemyCap);
    this.enemyHp = new Float64Array(this.enemyCap);
    this.enemyMaxHp = new Float64Array(this.enemyCap);
    this.enemySpeed = new Float64Array(this.enemyCap);
    this.enemyCoinReward = new Int32Array(this.enemyCap);
    this.enemyXpReward = new Int32Array(this.enemyCap);
    this.enemyDistance = new Float64Array(this.enemyCap);
    this.enemyRouteIndex = new Int32Array(this.enemyCap);
    this.enemyRouteLength = new Float64Array(this.enemyCap);
    this.enemyBurnDps = new Float64Array(this.enemyCap);
    this.enemyBurnDuration = new Float64Array(this.enemyCap);
    this.enemySlowPercent = new Float64Array(this.enemyCap);
    this.enemySlowDuration = new Float64Array(this.enemyCap);
    this.enemyShockDuration = new Float64Array(this.enemyCap);
    this.enemyPosX = new Float64Array(this.enemyCap);
    this.enemyPosY = new Float64Array(this.enemyCap);

    this.fireCap = maxFireZoneCapacityForMap(next);
    this.fireX = new Float64Array(this.fireCap);
    this.fireY = new Float64Array(this.fireCap);
    this.fireRadius = new Float64Array(this.fireCap);
    this.fireDps = new Float64Array(this.fireCap);
    this.fireDuration = new Float64Array(this.fireCap);

    this.spawnQueue = new Int32Array(Math.max(64, this.mapConfig.fleetTarget + 64));
  }

  reset(options = {}) {
    const previousCoins = this.coins || this.mapConfig.startingCoins;
    const previousXp = this.xp || this.mapConfig.startingXp;
    const resetMapId = options.mapId || this.mapId;
    if (resetMapId !== this.mapId) {
      this.loadMap(resetMapId);
    }

    const carryResources = Boolean(options.carryResources);
    this.state = 'build_phase';
    this.coins = carryResources ? Math.max(0, previousCoins) : this.mapConfig.startingCoins;
    this.xp = carryResources ? Math.max(0, previousXp) : this.mapConfig.startingXp;
    this.waveIndex = -1;
    this.speed = 1;
    this.spawnCooldown = 0;
    this.spawnQueueLen = 0;
    this.spawnCursor = 0;

    this.enemyCount = 0;
    this.fireCount = 0;

    this.towerTypeBySlot.fill(-1);
    this.towerLevelBySlot.fill(0);
    this.towerCooldownBySlot.fill(0);
    this.slotActivated.fill(0);

    this.lastAttacks = [];
    this.result = null;
    this.stats = {
      spawned: 0,
      killed: 0,
      leaked: 0,
    };
  }

  setSpeed(multiplier) {
    this.speed = multiplier;
  }

  setMap(mapId, options = {}) {
    const targetMapId = MAPS[mapId] ? mapId : DEFAULT_MAP_ID;
    const carryResources = options.carryResources !== false;
    this.reset({ mapId: targetMapId, carryResources });
    return { ok: true };
  }

  getBuildSlots() {
    return this.buildSlots;
  }

  isSlotActivated(slotId) {
    const slotIndex = this.slotIdToIndex.get(slotId);
    if (!Number.isInteger(slotIndex)) {
      return false;
    }
    return this.slotActivated[slotIndex] === 1;
  }

  getSlotActivationCost(slotId) {
    const slotIndex = this.slotIdToIndex.get(slotId);
    if (!Number.isInteger(slotIndex)) {
      return 0;
    }
    if (this.slotActivated[slotIndex] === 1) {
      return 0;
    }
    return this.slotActivationCost[slotIndex];
  }

  activateSlot(slotId) {
    if (!['build_phase', 'wave_running', 'wave_result'].includes(this.state)) {
      return { ok: false, error: 'Cannot activate slot in current state.' };
    }
    const slotIndex = this.slotIdToIndex.get(slotId);
    if (!Number.isInteger(slotIndex)) {
      return { ok: false, error: 'Unknown slot.' };
    }
    if (this.slotActivated[slotIndex] === 1) {
      return { ok: false, error: 'Slot already activated.' };
    }
    const cost = this.slotActivationCost[slotIndex];
    if (this.coins < cost) {
      return { ok: false, error: 'Insufficient coins.' };
    }
    this.coins -= cost;
    this.slotActivated[slotIndex] = 1;
    return { ok: true, cost };
  }

  getTower(slotId) {
    const slotIndex = this.slotIdToIndex.get(slotId);
    if (!Number.isInteger(slotIndex)) {
      return null;
    }
    const typeIndex = this.towerTypeBySlot[slotIndex];
    if (typeIndex < 0) {
      return null;
    }
    const towerId = TOWER_IDS[typeIndex];
    return {
      id: `tower_${slotId}`,
      towerId,
      level: this.towerLevelBySlot[slotIndex],
      slotId,
      x: this.slotX[slotIndex],
      y: this.slotY[slotIndex],
      cooldown: this.towerCooldownBySlot[slotIndex],
    };
  }

  buildTower(slotId, towerId) {
    if (!['build_phase', 'wave_running', 'wave_result'].includes(this.state)) {
      return { ok: false, error: 'Cannot build in current state.' };
    }
    const slotIndex = this.slotIdToIndex.get(slotId);
    if (!Number.isInteger(slotIndex)) {
      return { ok: false, error: 'Unknown slot.' };
    }
    if (this.towerTypeBySlot[slotIndex] >= 0) {
      return { ok: false, error: 'Slot already occupied.' };
    }
    if (this.slotActivated[slotIndex] !== 1) {
      return { ok: false, error: 'Activate slot first.' };
    }

    const cfg = TOWER_CONFIG[towerId];
    if (!cfg) {
      return { ok: false, error: 'Unknown tower.' };
    }
    const cost = cfg.levels[0].cost;
    if (this.coins < cost) {
      return { ok: false, error: 'Insufficient coins.' };
    }

    this.coins -= cost;
    this.towerTypeBySlot[slotIndex] = TOWER_ID_TO_INDEX.get(towerId);
    this.towerLevelBySlot[slotIndex] = 1;
    this.towerCooldownBySlot[slotIndex] = 0;

    return { ok: true, cost: { tower: cost, slot: 0, total: cost } };
  }

  upgradeTower(slotId) {
    if (!['build_phase', 'wave_running', 'wave_result'].includes(this.state)) {
      return { ok: false, error: 'Cannot upgrade in current state.' };
    }
    const slotIndex = this.slotIdToIndex.get(slotId);
    if (!Number.isInteger(slotIndex)) {
      return { ok: false, error: 'No tower selected.' };
    }
    const towerType = this.towerTypeBySlot[slotIndex];
    if (towerType < 0) {
      return { ok: false, error: 'No tower selected.' };
    }

    const towerId = TOWER_IDS[towerType];
    const cfg = TOWER_CONFIG[towerId];
    const level = this.towerLevelBySlot[slotIndex];
    if (level >= cfg.levels.length) {
      return { ok: false, error: 'Tower at max level.' };
    }

    const nextLevel = level + 1;
    const cost = cfg.levels[nextLevel - 1].cost;
    if (this.coins < cost) {
      return { ok: false, error: 'Insufficient coins.' };
    }

    this.coins -= cost;
    this.towerLevelBySlot[slotIndex] = nextLevel;
    return { ok: true };
  }

  getEnemyTemplate(enemyTypeIdx) {
    const enemyType = ENEMY_IDS[enemyTypeIdx];
    const template = ENEMIES[enemyType];
    const scale = this.mapConfig.enemyScale || { hp: 1, speed: 1, rewards: 1 };
    return {
      hp: Math.round(template.hp * scale.hp),
      speed: template.speed * scale.speed,
      coinReward: Math.round(template.coinReward * scale.rewards),
      xpReward: Math.round(template.xpReward * scale.rewards),
    };
  }

  applyFireZoneSnapshot(zones) {
    const safe = Array.isArray(zones) ? zones : [];
    this.ensureFireCapacity(safe.length);
    this.fireCount = safe.length;
    for (let i = 0; i < safe.length; i += 1) {
      const zone = safe[i];
      this.fireX[i] = Number(zone.x) || 0;
      this.fireY[i] = Number(zone.y) || 0;
      this.fireRadius[i] = Number(zone.radius) || 0;
      this.fireDps[i] = Number(zone.dps) || 0;
      this.fireDuration[i] = Math.max(0, Number(zone.duration) || 0);
    }
  }

  buildGpuWavePayload(wave) {
    const routeWeights = wave.routeWeights || this.routeWeights;
    const enemyQueue = [];
    for (let i = 0; i < this.spawnQueueLen; i += 1) {
      const enemyTypeIdx = this.spawnQueue[i];
      const template = this.getEnemyTemplate(enemyTypeIdx);
      const chosenRoute = pickWeightedIndex(routeWeights, this.rand);
      enemyQueue.push({
        hp: template.hp,
        speed: template.speed,
        coinReward: template.coinReward,
        xpReward: template.xpReward,
        routeIndex: Math.min(chosenRoute, this.pathInfos.length - 1),
      });
    }

    const towers = [];
    for (let slotIndex = 0; slotIndex < this.buildSlots.length; slotIndex += 1) {
      const towerType = this.towerTypeBySlot[slotIndex];
      if (towerType < 0) {
        continue;
      }
      const towerId = TOWER_IDS[towerType];
      const towerCfg = TOWER_CONFIG[towerId];
      const level = this.towerLevelBySlot[slotIndex];
      const levelCfg = towerCfg.levels[Math.max(0, level - 1)] || towerCfg.levels[0];

      towers.push({
        slotIndex,
        type: towerType,
        x: this.slotX[slotIndex],
        y: this.slotY[slotIndex],
        cooldown: this.towerCooldownBySlot[slotIndex],
        range: levelCfg.range || 0,
        attackSpeed: levelCfg.attackSpeed || 0,
        damage: levelCfg.damage || 0,
        splashRadius: levelCfg.splashRadius || 0,
        splashFalloff: levelCfg.splashFalloff || 0,
        burnDps: levelCfg.burnDps || 0,
        burnDuration: levelCfg.burnDuration || 0,
        fireballRadius: levelCfg.fireballRadius || 0,
        fireballDps: levelCfg.fireballDps || 0,
        fireballDuration: levelCfg.fireballDuration || 0,
        slowPercent: levelCfg.slowPercent || 0,
        slowDuration: levelCfg.slowDuration || 0,
        windTargets: levelCfg.windTargets || 1,
        chainCount: levelCfg.chainCount || 0,
        chainFalloff: levelCfg.chainFalloff || 0,
        shockDuration: levelCfg.shockVisualDuration || 0.58,
      });
    }

    const fireZones = [];
    for (let i = 0; i < this.fireCount; i += 1) {
      fireZones.push({
        x: this.fireX[i],
        y: this.fireY[i],
        radius: this.fireRadius[i],
        dps: this.fireDps[i],
        duration: this.fireDuration[i],
      });
    }

    return {
      coins: this.coins,
      xp: this.xp,
      leakCoins: this.mapConfig.leakPenalty.coins,
      leakXp: this.mapConfig.leakPenalty.xp,
      dt: 0.06 * this.speed,
      spawnInterval: wave.spawnInterval,
      routes: this.pathInfos.map((path) => path.points.map((p) => ({ x: p.x, y: p.y }))),
      enemyQueue,
      towers,
      fireZones,
    };
  }

  simulateCurrentWaveWithGpu(wave) {
    if (!this.gpuWaveSim) {
      return { ok: false, error: 'GPU wave simulator is unavailable.' };
    }

    try {
      const payload = this.buildGpuWavePayload(wave);
      const result = this.gpuWaveSim(payload);

      this.coins = Number(result.coins) || 0;
      this.xp = Math.max(0, Number(result.xp) || 0);
      this.stats.spawned += payload.enemyQueue.length;
      this.stats.killed += Math.max(0, Math.round(Number(result.killed) || 0));
      this.stats.leaked += Math.max(0, Math.round(Number(result.leaked) || 0));

      if (Array.isArray(result.towerCooldowns)) {
        for (const item of result.towerCooldowns) {
          const slotIndex = Number(item.slotIndex);
          if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= this.buildSlots.length) {
            continue;
          }
          this.towerCooldownBySlot[slotIndex] = Math.max(0, Number(item.cooldown) || 0);
        }
      }

      this.applyFireZoneSnapshot(result.fireZones || []);

      this.enemyCount = 0;
      this.spawnCursor = this.spawnQueueLen;
      this.lastAttacks = [];

      if (result.defeat || this.coins < 0) {
        this.state = 'map_result';
        this.result = {
          victory: false,
          mapId: this.mapConfig.mapId,
          nextMapUnlocked: false,
        };
        return { ok: true };
      }

      this.state = 'wave_running';
      this.resolveWaveState();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  startNextWave() {
    if (!['build_phase', 'wave_result'].includes(this.state)) {
      return { ok: false, error: 'Cannot start wave in this state.' };
    }
    if (this.waveIndex + 1 >= this.waves.length) {
      return { ok: false, error: 'No more waves.' };
    }

    this.waveIndex += 1;
    const wave = this.waves[this.waveIndex];

    let totalCount = 0;
    for (const count of Object.values(wave.composition)) {
      totalCount += count;
    }

    if (totalCount > this.spawnQueue.length) {
      this.spawnQueue = ensureIntCapacity(this.spawnQueue, totalCount);
    }

    let cursor = 0;
    for (const [enemyType, count] of Object.entries(wave.composition)) {
      const typeIdx = ENEMY_ID_TO_INDEX.get(enemyType);
      for (let i = 0; i < count; i += 1) {
        this.spawnQueue[cursor] = typeIdx;
        cursor += 1;
      }
    }

    this.spawnQueueLen = cursor;
    this.spawnCursor = 0;
    this.spawnCooldown = 0;
    this.state = 'wave_running';

    if (this.gpuWaveSim) {
      const gpuResult = this.simulateCurrentWaveWithGpu(wave);
      if (!gpuResult.ok) {
        this.gpuWaveSim = null;
      }
    }

    return { ok: true };
  }

  tick(dtRaw) {
    if (this.state !== 'wave_running') {
      return;
    }
    const dt = dtRaw * this.speed;
    this.lastAttacks = [];

    this.updateSpawns(dt);
    this.refreshEnemyPositions();
    this.updateEffects(dt);
    this.updateTowerAttacks(dt);
    this.updateMovement(dt);
    this.resolveWaveState();
  }

  updateSpawns(dt) {
    const wave = this.waves[this.waveIndex];
    this.spawnCooldown -= dt;
    const routeWeights = wave.routeWeights || this.routeWeights;

    while (this.spawnCursor < this.spawnQueueLen && this.spawnCooldown <= 0) {
      const typeIdx = this.spawnQueue[this.spawnCursor];
      this.spawnCursor += 1;
      this.spawnEnemy(typeIdx, routeWeights);
      this.spawnCooldown += wave.spawnInterval;
    }
  }

  ensureEnemyCapacity(minSize) {
    if (this.enemyCap >= minSize) {
      return;
    }
    const nextSize = Math.max(minSize, this.enemyCap * 2);
    this.enemyType = ensureIntCapacity(this.enemyType, nextSize);
    this.enemyHp = ensureFloatCapacity(this.enemyHp, nextSize);
    this.enemyMaxHp = ensureFloatCapacity(this.enemyMaxHp, nextSize);
    this.enemySpeed = ensureFloatCapacity(this.enemySpeed, nextSize);
    this.enemyCoinReward = ensureIntCapacity(this.enemyCoinReward, nextSize);
    this.enemyXpReward = ensureIntCapacity(this.enemyXpReward, nextSize);
    this.enemyDistance = ensureFloatCapacity(this.enemyDistance, nextSize);
    this.enemyRouteIndex = ensureIntCapacity(this.enemyRouteIndex, nextSize);
    this.enemyRouteLength = ensureFloatCapacity(this.enemyRouteLength, nextSize);
    this.enemyBurnDps = ensureFloatCapacity(this.enemyBurnDps, nextSize);
    this.enemyBurnDuration = ensureFloatCapacity(this.enemyBurnDuration, nextSize);
    this.enemySlowPercent = ensureFloatCapacity(this.enemySlowPercent, nextSize);
    this.enemySlowDuration = ensureFloatCapacity(this.enemySlowDuration, nextSize);
    this.enemyShockDuration = ensureFloatCapacity(this.enemyShockDuration, nextSize);
    this.enemyPosX = ensureFloatCapacity(this.enemyPosX, nextSize);
    this.enemyPosY = ensureFloatCapacity(this.enemyPosY, nextSize);
    this.enemyCap = nextSize;
  }

  ensureFireCapacity(minSize) {
    if (this.fireCap >= minSize) {
      return;
    }
    const nextSize = Math.max(minSize, this.fireCap * 2);
    this.fireX = ensureFloatCapacity(this.fireX, nextSize);
    this.fireY = ensureFloatCapacity(this.fireY, nextSize);
    this.fireRadius = ensureFloatCapacity(this.fireRadius, nextSize);
    this.fireDps = ensureFloatCapacity(this.fireDps, nextSize);
    this.fireDuration = ensureFloatCapacity(this.fireDuration, nextSize);
    this.fireCap = nextSize;
  }

  spawnEnemy(enemyTypeIdx, routeWeights) {
    this.ensureEnemyCapacity(this.enemyCount + 1);

    const template = this.getEnemyTemplate(enemyTypeIdx);
    const chosenRoute = pickWeightedIndex(routeWeights, this.rand);
    const routeIndex = Math.min(chosenRoute, this.pathInfos.length - 1);
    const pathInfo = this.pathInfos[routeIndex];

    const idx = this.enemyCount;
    this.enemyCount += 1;

    this.enemyType[idx] = enemyTypeIdx;
    this.enemyHp[idx] = template.hp;
    this.enemyMaxHp[idx] = template.hp;
    this.enemySpeed[idx] = template.speed;
    this.enemyCoinReward[idx] = template.coinReward;
    this.enemyXpReward[idx] = template.xpReward;
    this.enemyDistance[idx] = 0;
    this.enemyRouteIndex[idx] = routeIndex;
    this.enemyRouteLength[idx] = pathInfo.length;
    this.enemyBurnDps[idx] = 0;
    this.enemyBurnDuration[idx] = 0;
    this.enemySlowPercent[idx] = 0;
    this.enemySlowDuration[idx] = 0;
    this.enemyShockDuration[idx] = 0;
    this.enemyPosX[idx] = pathInfo.points[0].x;
    this.enemyPosY[idx] = pathInfo.points[0].y;

    this.stats.spawned += 1;
  }

  positionAtDistance(routeIndex, dist) {
    const pathInfo = this.pathInfos[routeIndex] || this.pathInfos[0];
    if (dist <= 0) {
      const p = pathInfo.points[0];
      return { x: p.x, y: p.y };
    }
    if (dist >= pathInfo.length) {
      const p = pathInfo.points[pathInfo.points.length - 1];
      return { x: p.x, y: p.y };
    }

    let remaining = dist;
    const segments = pathInfo.segments;
    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i];
      if (remaining <= seg.len) {
        const t = seg.len === 0 ? 0 : remaining / seg.len;
        return {
          x: seg.ax + seg.dx * t,
          y: seg.ay + seg.dy * t,
        };
      }
      remaining -= seg.len;
    }

    const tail = pathInfo.points[pathInfo.points.length - 1];
    return { x: tail.x, y: tail.y };
  }

  refreshEnemyPositions() {
    for (let i = 0; i < this.enemyCount; i += 1) {
      const pos = this.positionAtDistance(this.enemyRouteIndex[i], this.enemyDistance[i]);
      this.enemyPosX[i] = pos.x;
      this.enemyPosY[i] = pos.y;
    }
  }

  removeEnemyAt(index) {
    const last = this.enemyCount - 1;
    if (index !== last) {
      this.enemyType[index] = this.enemyType[last];
      this.enemyHp[index] = this.enemyHp[last];
      this.enemyMaxHp[index] = this.enemyMaxHp[last];
      this.enemySpeed[index] = this.enemySpeed[last];
      this.enemyCoinReward[index] = this.enemyCoinReward[last];
      this.enemyXpReward[index] = this.enemyXpReward[last];
      this.enemyDistance[index] = this.enemyDistance[last];
      this.enemyRouteIndex[index] = this.enemyRouteIndex[last];
      this.enemyRouteLength[index] = this.enemyRouteLength[last];
      this.enemyBurnDps[index] = this.enemyBurnDps[last];
      this.enemyBurnDuration[index] = this.enemyBurnDuration[last];
      this.enemySlowPercent[index] = this.enemySlowPercent[last];
      this.enemySlowDuration[index] = this.enemySlowDuration[last];
      this.enemyShockDuration[index] = this.enemyShockDuration[last];
      this.enemyPosX[index] = this.enemyPosX[last];
      this.enemyPosY[index] = this.enemyPosY[last];
    }
    this.enemyCount -= 1;
  }

  updateEffects(dt) {
    for (let z = 0; z < this.fireCount; z += 1) {
      this.fireDuration[z] = Math.max(0, this.fireDuration[z] - dt);
      const zx = this.fireX[z];
      const zy = this.fireY[z];
      const zr = this.fireRadius[z];
      const zd = this.fireDps[z];
      for (let i = 0; i < this.enemyCount; i += 1) {
        const dx = (this.enemyPosX[i] - zx) * WORLD_SCALE;
        const dy = (this.enemyPosY[i] - zy) * WORLD_SCALE;
        if (Math.hypot(dx, dy) <= zr) {
          this.enemyHp[i] -= zd * dt;
        }
      }
    }

    // Compact fire zones.
    let write = 0;
    for (let z = 0; z < this.fireCount; z += 1) {
      if (this.fireDuration[z] > 0) {
        if (write !== z) {
          this.fireX[write] = this.fireX[z];
          this.fireY[write] = this.fireY[z];
          this.fireRadius[write] = this.fireRadius[z];
          this.fireDps[write] = this.fireDps[z];
          this.fireDuration[write] = this.fireDuration[z];
        }
        write += 1;
      }
    }
    this.fireCount = write;

    for (let i = 0; i < this.enemyCount; i += 1) {
      if (this.enemyBurnDuration[i] > 0) {
        this.enemyHp[i] -= this.enemyBurnDps[i] * dt;
        this.enemyBurnDuration[i] = Math.max(0, this.enemyBurnDuration[i] - dt);
        if (this.enemyBurnDuration[i] === 0) {
          this.enemyBurnDps[i] = 0;
        }
      }
      if (this.enemySlowDuration[i] > 0) {
        this.enemySlowDuration[i] = Math.max(0, this.enemySlowDuration[i] - dt);
        if (this.enemySlowDuration[i] === 0) {
          this.enemySlowPercent[i] = 0;
        }
      }
      if (this.enemyShockDuration[i] > 0) {
        this.enemyShockDuration[i] = Math.max(0, this.enemyShockDuration[i] - dt);
      }
    }

    let idx = 0;
    while (idx < this.enemyCount) {
      if (this.enemyHp[idx] <= 0) {
        this.coins += this.enemyCoinReward[idx];
        this.xp += this.enemyXpReward[idx];
        this.stats.killed += 1;
        this.removeEnemyAt(idx);
      } else {
        idx += 1;
      }
    }
  }

  bestTargetInRange(towerX, towerY, rangeUnits) {
    let bestIndex = -1;
    let bestProgress = -1;

    for (let i = 0; i < this.enemyCount; i += 1) {
      const dx = (towerX - this.enemyPosX[i]) * WORLD_SCALE;
      const dy = (towerY - this.enemyPosY[i]) * WORLD_SCALE;
      const d = Math.hypot(dx, dy);
      if (d > rangeUnits) {
        continue;
      }
      const progress = this.enemyRouteLength[i] === 0 ? 0 : this.enemyDistance[i] / this.enemyRouteLength[i];
      if (progress > bestProgress) {
        bestProgress = progress;
        bestIndex = i;
      }
    }

    return bestIndex;
  }

  topTargetsInRange(towerX, towerY, rangeUnits, maxTargets) {
    if (maxTargets > this.targetScratch.length) {
      this.targetScratch = ensureIntCapacity(this.targetScratch, maxTargets * 2);
    }

    let count = 0;
    for (let i = 0; i < this.enemyCount; i += 1) {
      const dx = (towerX - this.enemyPosX[i]) * WORLD_SCALE;
      const dy = (towerY - this.enemyPosY[i]) * WORLD_SCALE;
      const d = Math.hypot(dx, dy);
      if (d > rangeUnits) {
        continue;
      }

      const progress = this.enemyRouteLength[i] === 0 ? 0 : this.enemyDistance[i] / this.enemyRouteLength[i];
      let insertAt = count;
      while (insertAt > 0) {
        const prevEnemy = this.targetScratch[insertAt - 1];
        const prevProgress = this.enemyRouteLength[prevEnemy] === 0
          ? 0
          : this.enemyDistance[prevEnemy] / this.enemyRouteLength[prevEnemy];
        if (progress <= prevProgress) {
          break;
        }
        if (insertAt < maxTargets) {
          this.targetScratch[insertAt] = this.targetScratch[insertAt - 1];
        }
        insertAt -= 1;
      }

      if (insertAt < maxTargets) {
        this.targetScratch[insertAt] = i;
        if (count < maxTargets) {
          count += 1;
        }
      }
    }

    return this.targetScratch.subarray(0, Math.max(0, Math.min(count, maxTargets)));
  }

  applyLightningChain(sourceIndex, baseDamage, falloffPercent, chainCount, shockDuration) {
    if (chainCount <= 0 || sourceIndex < 0 || sourceIndex >= this.enemyCount) {
      return;
    }
    const sx = this.enemyPosX[sourceIndex];
    const sy = this.enemyPosY[sourceIndex];

    // Build nearest neighbor list by simple insertion sort on distances.
    const candidates = [];
    for (let i = 0; i < this.enemyCount; i += 1) {
      if (i === sourceIndex) {
        continue;
      }
      const dx = (sx - this.enemyPosX[i]) * WORLD_SCALE;
      const dy = (sy - this.enemyPosY[i]) * WORLD_SCALE;
      candidates.push({ i, d: Math.hypot(dx, dy) });
    }
    candidates.sort((a, b) => a.d - b.d);

    let hits = 0;
    for (let idx = 0; idx < candidates.length && hits < chainCount; idx += 1) {
      const c = candidates[idx];
      if (c.d > CHAIN_RADIUS) {
        continue;
      }
      this.enemyHp[c.i] -= baseDamage * (1 - falloffPercent / 100);
      if (shockDuration > 0) {
        this.enemyShockDuration[c.i] = Math.max(this.enemyShockDuration[c.i], shockDuration);
      }
      hits += 1;
    }
  }

  applyFireball(towerX, towerY, targetIndex, levelCfg) {
    this.enemyHp[targetIndex] -= levelCfg.damage;

    const burnDps = levelCfg.burnDps || 0;
    if (burnDps > 0) {
      this.enemyBurnDps[targetIndex] = Math.max(this.enemyBurnDps[targetIndex], burnDps);
      this.enemyBurnDuration[targetIndex] = Math.max(
        this.enemyBurnDuration[targetIndex],
        levelCfg.burnDuration || 0
      );
    }

    this.ensureFireCapacity(this.fireCount + 1);
    const fi = this.fireCount;
    this.fireCount += 1;

    this.fireX[fi] = this.enemyPosX[targetIndex];
    this.fireY[fi] = this.enemyPosY[targetIndex];
    this.fireRadius[fi] = levelCfg.fireballRadius || 1;
    this.fireDps[fi] = levelCfg.fireballDps || 0;
    this.fireDuration[fi] = levelCfg.fireballDuration || 3;

    this.lastAttacks.push({
      from: { x: towerX, y: towerY },
      to: { x: this.enemyPosX[targetIndex], y: this.enemyPosY[targetIndex] },
      effectType: 'fire',
    });
  }

  applyWindControl(towerX, towerY, levelCfg) {
    const targets = this.topTargetsInRange(towerX, towerY, levelCfg.range, levelCfg.windTargets || 1);
    for (let i = 0; i < targets.length; i += 1) {
      const target = targets[i];
      this.enemyHp[target] -= levelCfg.damage;
      this.enemySlowPercent[target] = Math.max(this.enemySlowPercent[target], levelCfg.slowPercent || 0);
      this.enemySlowDuration[target] = Math.max(this.enemySlowDuration[target], levelCfg.slowDuration || 0);
      this.lastAttacks.push({
        from: { x: towerX, y: towerY },
        to: { x: this.enemyPosX[target], y: this.enemyPosY[target] },
        effectType: 'wind',
      });
    }
  }

  applyBombSplash(towerX, towerY, targetIndex, levelCfg) {
    this.enemyHp[targetIndex] -= levelCfg.damage;
    const tx = this.enemyPosX[targetIndex];
    const ty = this.enemyPosY[targetIndex];

    this.lastAttacks.push({
      from: { x: towerX, y: towerY },
      to: { x: tx, y: ty },
      effectType: 'bomb',
    });

    const splashRadius = levelCfg.splashRadius || 0;
    const splashDamage = levelCfg.damage * (1 - (levelCfg.splashFalloff || 0) / 100);
    if (splashRadius <= 0 || splashDamage <= 0) {
      return;
    }

    for (let i = 0; i < this.enemyCount; i += 1) {
      if (i === targetIndex) {
        continue;
      }
      const dx = (this.enemyPosX[i] - tx) * WORLD_SCALE;
      const dy = (this.enemyPosY[i] - ty) * WORLD_SCALE;
      if (Math.hypot(dx, dy) <= splashRadius) {
        this.enemyHp[i] -= splashDamage;
      }
    }
  }

  updateTowerAttacks(dt) {
    const slotCount = this.buildSlots.length;
    for (let slotIndex = 0; slotIndex < slotCount; slotIndex += 1) {
      const towerTypeIdx = this.towerTypeBySlot[slotIndex];
      if (towerTypeIdx < 0) {
        continue;
      }

      const cooldown = Math.max(0, this.towerCooldownBySlot[slotIndex] - dt);
      this.towerCooldownBySlot[slotIndex] = cooldown;
      if (cooldown > 0) {
        continue;
      }

      const towerId = TOWER_IDS[towerTypeIdx];
      const cfg = TOWER_CONFIG[towerId];
      const levelCfg = cfg.levels[this.towerLevelBySlot[slotIndex] - 1];
      const towerX = this.slotX[slotIndex];
      const towerY = this.slotY[slotIndex];

      const target = this.bestTargetInRange(towerX, towerY, levelCfg.range);
      if (target < 0) {
        continue;
      }

      this.towerCooldownBySlot[slotIndex] = 1 / levelCfg.attackSpeed;

      if (cfg.effectType === 'fire') {
        this.applyFireball(towerX, towerY, target, levelCfg);
        continue;
      }

      if (cfg.effectType === 'wind') {
        this.applyWindControl(towerX, towerY, levelCfg);
        continue;
      }

      if (cfg.effectType === 'bomb') {
        this.applyBombSplash(towerX, towerY, target, levelCfg);
        continue;
      }

      this.enemyHp[target] -= levelCfg.damage;
      this.lastAttacks.push({
        from: { x: towerX, y: towerY },
        to: { x: this.enemyPosX[target], y: this.enemyPosY[target] },
        effectType: cfg.effectType,
      });

      if (cfg.effectType === 'lightning') {
        const shockDuration = levelCfg.shockVisualDuration || 0.58;
        this.enemyShockDuration[target] = Math.max(this.enemyShockDuration[target], shockDuration);
        this.applyLightningChain(
          target,
          levelCfg.damage,
          levelCfg.chainFalloff || 0,
          levelCfg.chainCount || 0,
          shockDuration
        );
      }
    }
  }

  updateMovement(dt) {
    let i = 0;
    while (i < this.enemyCount) {
      const slowMultiplier = 1 - Math.min(this.enemySlowPercent[i] / 100, 0.84);
      this.enemyDistance[i] += this.enemySpeed[i] * slowMultiplier * dt;
      if (this.enemyDistance[i] >= this.enemyRouteLength[i]) {
        this.coins -= this.mapConfig.leakPenalty.coins;
        this.xp = Math.max(0, this.xp - this.mapConfig.leakPenalty.xp);
        this.stats.leaked += 1;
        this.removeEnemyAt(i);
      } else {
        i += 1;
      }
    }

    if (this.coins < 0) {
      this.state = 'map_result';
      this.result = {
        victory: false,
        mapId: this.mapConfig.mapId,
        nextMapUnlocked: false,
      };
    }
  }

  resolveWaveState() {
    if (this.state !== 'wave_running') {
      return;
    }

    const waveDone = this.spawnCursor >= this.spawnQueueLen && this.enemyCount === 0;
    if (!waveDone) {
      return;
    }

    this.xp += PROGRESSION.xpPerWaveClear + (this.mapConfig.xpWaveBonus || 0);
    this.state = 'wave_result';

    if (this.waveIndex === this.waves.length - 1) {
      const reward = this.mapConfig.mapClearReward || {};
      const rewardCoins = Math.max(0, Math.round(Number(reward.coins) || 0));
      const rewardXp = Math.max(0, Math.round(Number(reward.xp) || 0));
      this.coins += rewardCoins;
      this.xp += rewardXp;
      this.xp += PROGRESSION.xpMapClear + (this.mapConfig.xpMapBonus || 0);

      this.state = 'map_result';
      this.result = {
        victory: true,
        mapId: this.mapConfig.mapId,
        nextMapUnlocked: false,
      };
    }
  }

  getSnapshot() {
    return {
      mapId: this.mapId,
      coins: this.coins,
      xp: this.xp,
      state: this.state,
      waveIndex: this.waveIndex,
      leaked: this.stats.leaked,
      result: this.result,
      stats: { ...this.stats },
      boatsLeft: (this.spawnQueueLen - this.spawnCursor) + this.enemyCount,
    };
  }
}
