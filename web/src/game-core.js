import { MAPS, DEFAULT_MAP_ID, TOWER_CONFIG, ENEMIES, PROGRESSION } from './config.js';

const WORLD_SCALE = 10;
const CHAIN_RADIUS = 2.6;
const MAP_RENDER_WIDTH = 1100;
const MAP_RENDER_HEIGHT = 680;
const SLOT_RIVER_CLEARANCE_PX = 16;
const GAME_PERSISTENCE_VERSION = 1;
const VALID_GAME_STATES = new Set(['build_phase', 'wave_running', 'wave_result', 'map_result']);

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
    segments.push({ a, b, len });
    total += len;
  }
  return { points, segments, length: total };
}

function toRenderPoint(point) {
  return {
    x: point.x * MAP_RENDER_WIDTH,
    y: point.y * MAP_RENDER_HEIGHT,
  };
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

  for (const slot of mapConfig.buildSlots) {
    const slotDistance = slotToRouteDistancePx(slot, mapConfig.routes);
    if (slotDistance < SLOT_RIVER_CLEARANCE_PX) {
      blocked.push(slot);
      continue;
    }
    buildable.push(slot);
  }

  return { buildable, blocked };
}

function positionAtDistance(pathInfo, d) {
  const points = pathInfo.points;
  if (d <= 0) {
    return points[0];
  }
  if (d >= pathInfo.length) {
    return points[points.length - 1];
  }

  let remaining = d;
  for (const segment of pathInfo.segments) {
    if (remaining <= segment.len) {
      const t = segment.len === 0 ? 0 : remaining / segment.len;
      return {
        x: segment.a.x + (segment.b.x - segment.a.x) * t,
        y: segment.a.y + (segment.b.y - segment.a.y) * t,
      };
    }
    remaining -= segment.len;
  }
  return points[points.length - 1];
}

function pickWeightedIndex(weights) {
  const valid = Array.isArray(weights) && weights.length > 0
    ? weights
    : [1];
  const total = valid.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (total <= 0) {
    return 0;
  }
  let threshold = Math.random() * total;
  for (let i = 0; i < valid.length; i += 1) {
    threshold -= Math.max(0, valid[i]);
    if (threshold <= 0) {
      return i;
    }
  }
  return valid.length - 1;
}

function clampNumber(value, fallback, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}

function clonePlainObject(value, fallback = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallback;
  }
  return { ...value };
}

export class HomelandGame {
  constructor(options = {}) {
    const mapId = options.mapId || DEFAULT_MAP_ID;
    this.loadMap(mapId);
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
    this.buildSlotsById = new Map(this.buildSlots.map((slot) => [slot.id, slot]));
    this.blockedBuildSlotsById = new Map(this.blockedBuildSlots.map((slot) => [slot.id, slot]));
    this.routeInfos = next.routes.map((route, routeIndex) => ({
      routeId: route.id || `route_${routeIndex + 1}`,
      routeIndex,
      pathInfo: getPathSegments(route.waypoints),
    }));
  }

  reset(options = {}) {
    const previousCoins = this.coins ?? this.mapConfig.startingCoins;
    const previousXp = this.xp ?? this.mapConfig.startingXp;
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
    this.spawnQueue = [];
    this.enemies = [];
    this.nextEnemyId = 1;
    this.towers = new Map();
    this.fireZones = [];
    this.lastAttacks = [];
    this.result = null;
    this.events = [];
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
    this.reset({ mapId, ...options });
  }

  getNextMapId() {
    const nextMapId = this.mapConfig.unlockRequirement?.nextMap;
    if (!nextMapId || !MAPS[nextMapId]) {
      return null;
    }
    return nextMapId;
  }

  exportState() {
    return {
      version: GAME_PERSISTENCE_VERSION,
      mapId: this.mapId,
      state: this.state,
      coins: this.coins,
      xp: this.xp,
      waveIndex: this.waveIndex,
      speed: this.speed,
      spawnCooldown: this.spawnCooldown,
      spawnQueue: [...this.spawnQueue],
      enemies: this.enemies.map((enemy) => ({ ...enemy })),
      nextEnemyId: this.nextEnemyId,
      towers: Array.from(this.towers.values()).map((tower) => ({ ...tower })),
      fireZones: this.fireZones.map((zone) => ({ ...zone })),
      result: this.result ? { ...this.result } : null,
      stats: { ...this.stats },
    };
  }

  importState(payload) {
    if (!payload || typeof payload !== 'object') {
      return false;
    }

    const mapId = typeof payload.mapId === 'string' && payload.mapId in MAPS
      ? payload.mapId
      : this.mapId;
    this.reset({ mapId });

    if (typeof payload.state === 'string' && VALID_GAME_STATES.has(payload.state)) {
      this.state = payload.state;
    }

    this.coins = clampNumber(payload.coins, this.coins);
    this.xp = clampNumber(payload.xp, this.xp, 0);
    this.waveIndex = clampNumber(payload.waveIndex, this.waveIndex, -1, this.waves.length - 1);
    this.speed = clampNumber(payload.speed, this.speed, 0.25, 4);
    this.spawnCooldown = clampNumber(payload.spawnCooldown, this.spawnCooldown, 0);
    this.nextEnemyId = Math.max(1, Math.floor(clampNumber(payload.nextEnemyId, this.nextEnemyId, 1)));

    if (Array.isArray(payload.spawnQueue)) {
      this.spawnQueue = payload.spawnQueue.filter(
        (enemyType) => typeof enemyType === 'string' && enemyType in ENEMIES
      );
    }

    if (Array.isArray(payload.towers)) {
      this.towers.clear();
      for (const tower of payload.towers) {
        if (!tower || typeof tower !== 'object') {
          continue;
        }
        const slotId = tower.slotId;
        const towerId = tower.towerId;
        if (typeof slotId !== 'string' || !this.buildSlotsById.has(slotId)) {
          continue;
        }
        if (typeof towerId !== 'string' || !(towerId in TOWER_CONFIG)) {
          continue;
        }
        const slot = this.buildSlotsById.get(slotId);
        const maxLevel = TOWER_CONFIG[towerId].levels.length;
        const level = Math.floor(clampNumber(tower.level, 1, 1, maxLevel));
        this.towers.set(slotId, {
          id: typeof tower.id === 'string' ? tower.id : `tower_${slotId}`,
          towerId,
          level,
          slotId,
          x: slot.x,
          y: slot.y,
          cooldown: clampNumber(tower.cooldown, 0, 0),
        });
      }
    }

    if (Array.isArray(payload.enemies)) {
      this.enemies = [];
      for (const enemy of payload.enemies) {
        if (!enemy || typeof enemy !== 'object') {
          continue;
        }
        if (typeof enemy.enemyType !== 'string' || !(enemy.enemyType in ENEMIES)) {
          continue;
        }
        const routeIndex = Math.floor(
          clampNumber(enemy.routeIndex, 0, 0, Math.max(0, this.routeInfos.length - 1))
        );
        const routeInfo = this.routeInfos[routeIndex];
        const routeLength = routeInfo ? routeInfo.pathInfo.length : 0;
        const safeEnemy = {
          id: typeof enemy.id === 'string' ? enemy.id : `enemy_${this.nextEnemyId}`,
          enemyType: enemy.enemyType,
          hp: clampNumber(enemy.hp, ENEMIES[enemy.enemyType].hp, 0),
          maxHp: clampNumber(enemy.maxHp, ENEMIES[enemy.enemyType].hp, 1),
          speed: clampNumber(enemy.speed, ENEMIES[enemy.enemyType].speed, 0),
          coinReward: Math.round(clampNumber(enemy.coinReward, ENEMIES[enemy.enemyType].coinReward, 0)),
          xpReward: Math.round(clampNumber(enemy.xpReward, ENEMIES[enemy.enemyType].xpReward, 0)),
          distance: clampNumber(enemy.distance, 0, 0, routeLength),
          routeIndex,
          routeLength,
          burnDps: clampNumber(enemy.burnDps, 0, 0),
          burnDurationLeft: clampNumber(enemy.burnDurationLeft, 0, 0),
          slowPercent: clampNumber(enemy.slowPercent, 0, 0, 95),
          slowDurationLeft: clampNumber(enemy.slowDurationLeft, 0, 0),
          shockDurationLeft: clampNumber(enemy.shockDurationLeft, 0, 0),
        };
        if (safeEnemy.maxHp < safeEnemy.hp) {
          safeEnemy.maxHp = safeEnemy.hp;
        }
        this.enemies.push(safeEnemy);
      }
    }

    if (Array.isArray(payload.fireZones)) {
      this.fireZones = payload.fireZones
        .filter((zone) => zone && typeof zone === 'object')
        .map((zone) => ({
          x: clampNumber(zone.x, 0),
          y: clampNumber(zone.y, 0),
          radius: clampNumber(zone.radius, 1, 0),
          dps: clampNumber(zone.dps, 0, 0),
          durationLeft: clampNumber(zone.durationLeft, 0, 0),
        }))
        .filter((zone) => zone.durationLeft > 0);
    }

    this.result = clonePlainObject(payload.result, null);

    const stats = clonePlainObject(payload.stats, {});
    this.stats = {
      spawned: Math.max(0, Math.floor(clampNumber(stats.spawned, this.stats.spawned, 0))),
      killed: Math.max(0, Math.floor(clampNumber(stats.killed, this.stats.killed, 0))),
      leaked: Math.max(0, Math.floor(clampNumber(stats.leaked, this.stats.leaked, 0))),
    };

    this.lastAttacks = [];
    this.events = [];
    return true;
  }

  buildTower(slotId, towerId) {
    if (!['build_phase', 'wave_running', 'wave_result'].includes(this.state)) {
      return { ok: false, error: 'Cannot build in current state.' };
    }
    if (this.towers.has(slotId)) {
      return { ok: false, error: 'Slot already occupied.' };
    }
    const towerConfig = TOWER_CONFIG[towerId];
    if (!towerConfig) {
      return { ok: false, error: 'Unknown tower.' };
    }
    const cost = towerConfig.levels[0].cost;
    if (this.coins < cost) {
      return { ok: false, error: 'Insufficient coins.' };
    }

    const slot = this.buildSlotsById.get(slotId);
    if (!slot) {
      if (this.blockedBuildSlotsById.has(slotId)) {
        return { ok: false, error: 'Cannot build in river.' };
      }
      return { ok: false, error: 'Unknown slot.' };
    }

    this.coins -= cost;
    this.towers.set(slotId, {
      id: `tower_${slotId}`,
      towerId,
      level: 1,
      slotId,
      x: slot.x,
      y: slot.y,
      cooldown: 0,
    });

    return { ok: true };
  }

  upgradeTower(slotId) {
    if (!['build_phase', 'wave_running', 'wave_result'].includes(this.state)) {
      return { ok: false, error: 'Cannot upgrade in current state.' };
    }
    const tower = this.towers.get(slotId);
    if (!tower) {
      return { ok: false, error: 'No tower selected.' };
    }
    const config = TOWER_CONFIG[tower.towerId];
    if (tower.level >= config.levels.length) {
      return { ok: false, error: 'Tower at max level.' };
    }

    const nextLevel = tower.level + 1;
    const cost = config.levels[nextLevel - 1].cost;
    if (this.coins < cost) {
      return { ok: false, error: 'Insufficient coins.' };
    }

    this.coins -= cost;
    tower.level = nextLevel;
    return { ok: true };
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
    this.spawnQueue = Object.entries(wave.composition).flatMap(([enemyType, count]) =>
      Array(count).fill(enemyType)
    );
    this.spawnCooldown = 0;
    this.state = 'wave_running';
    return { ok: true };
  }

  tick(dtRaw) {
    const dt = dtRaw * this.speed;
    if (this.state !== 'wave_running') {
      return;
    }

    this.lastAttacks = [];

    this.updateSpawns(dt);
    this.updateEffects(dt);
    this.updateTowerAttacks(dt);
    this.updateMovement(dt);
    this.resolveWaveState();
  }

  updateSpawns(dt) {
    const wave = this.waves[this.waveIndex];
    this.spawnCooldown -= dt;
    while (this.spawnQueue.length > 0 && this.spawnCooldown <= 0) {
      const enemyType = this.spawnQueue.shift();
      this.spawnEnemy(enemyType, wave.routeWeights || this.mapConfig.defaultRouteWeights);
      this.spawnCooldown += wave.spawnInterval;
    }
  }

  getEnemyTemplate(enemyType) {
    const template = ENEMIES[enemyType];
    const scale = this.mapConfig.enemyScale || { hp: 1, speed: 1, rewards: 1 };
    return {
      hp: Math.round(template.hp * scale.hp),
      speed: template.speed * scale.speed,
      coinReward: Math.round(template.coinReward * scale.rewards),
      xpReward: Math.round(template.xpReward * scale.rewards),
    };
  }

  spawnEnemy(enemyType, routeWeights) {
    const template = this.getEnemyTemplate(enemyType);
    const chosenRoute = pickWeightedIndex(routeWeights);
    const routeIndex = Math.min(chosenRoute, this.routeInfos.length - 1);
    const routeInfo = this.routeInfos[routeIndex];

    this.enemies.push({
      id: `enemy_${this.nextEnemyId}`,
      enemyType,
      hp: template.hp,
      maxHp: template.hp,
      speed: template.speed,
      coinReward: template.coinReward,
      xpReward: template.xpReward,
      distance: 0,
      routeIndex,
      routeLength: routeInfo.pathInfo.length,
      burnDps: 0,
      burnDurationLeft: 0,
      slowPercent: 0,
      slowDurationLeft: 0,
      shockDurationLeft: 0,
    });
    this.nextEnemyId += 1;
    this.stats.spawned += 1;
  }

  getEnemyWorldPosition(enemy) {
    const routeInfo = this.routeInfos[enemy.routeIndex] || this.routeInfos[0];
    return positionAtDistance(routeInfo.pathInfo, enemy.distance);
  }

  updateEffects(dt) {
    for (const zone of this.fireZones) {
      zone.durationLeft = Math.max(0, zone.durationLeft - dt);
      for (const enemy of this.enemies) {
        const enemyPos = this.getEnemyWorldPosition(enemy);
        const d = Math.hypot(
          (enemyPos.x - zone.x) * WORLD_SCALE,
          (enemyPos.y - zone.y) * WORLD_SCALE
        );
        if (d <= zone.radius) {
          enemy.hp -= zone.dps * dt;
        }
      }
    }

    this.fireZones = this.fireZones.filter((zone) => zone.durationLeft > 0);

    for (const enemy of this.enemies) {
      if (enemy.burnDurationLeft > 0) {
        enemy.hp -= enemy.burnDps * dt;
        enemy.burnDurationLeft = Math.max(0, enemy.burnDurationLeft - dt);
        if (enemy.burnDurationLeft === 0) {
          enemy.burnDps = 0;
        }
      }
      if (enemy.slowDurationLeft > 0) {
        enemy.slowDurationLeft = Math.max(0, enemy.slowDurationLeft - dt);
        if (enemy.slowDurationLeft === 0) {
          enemy.slowPercent = 0;
        }
      }
      if (enemy.shockDurationLeft > 0) {
        enemy.shockDurationLeft = Math.max(0, enemy.shockDurationLeft - dt);
      }
    }

    this.enemies = this.enemies.filter((enemy) => {
      if (enemy.hp <= 0) {
        this.coins += enemy.coinReward;
        this.xp += enemy.xpReward;
        this.stats.killed += 1;
        return false;
      }
      return true;
    });
  }

  updateTowerAttacks(dt) {
    const towers = Array.from(this.towers.values());
    for (const tower of towers) {
      tower.cooldown = Math.max(0, tower.cooldown - dt);
      if (tower.cooldown > 0) {
        continue;
      }

      const cfg = TOWER_CONFIG[tower.towerId];
      const levelCfg = cfg.levels[tower.level - 1];
      const target = this.pickTarget(tower, levelCfg.range);
      if (!target) {
        continue;
      }

      tower.cooldown = 1 / levelCfg.attackSpeed;
      if (cfg.effectType === 'fire') {
        this.applyFireball(tower, target, levelCfg);
        continue;
      }

      if (cfg.effectType === 'wind') {
        this.applyWindControl(tower, levelCfg);
        continue;
      }

      if (cfg.effectType === 'bomb') {
        this.applyBombSplash(tower, target, levelCfg);
        continue;
      }

      target.hp -= levelCfg.damage;
      this.lastAttacks.push({
        from: { x: tower.x, y: tower.y },
        to: this.getEnemyWorldPosition(target),
        effectType: cfg.effectType,
      });

      if (cfg.effectType === 'lightning') {
        const shockDuration = levelCfg.shockVisualDuration || 0.58;
        target.shockDurationLeft = Math.max(target.shockDurationLeft || 0, shockDuration);
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

  applyFireball(tower, target, levelCfg) {
    target.hp -= levelCfg.damage;
    const burnDps = levelCfg.burnDps || 0;
    if (burnDps > 0) {
      target.burnDps = Math.max(target.burnDps || 0, burnDps);
      target.burnDurationLeft = Math.max(target.burnDurationLeft || 0, levelCfg.burnDuration || 0);
    }
    const targetPos = this.getEnemyWorldPosition(target);
    this.lastAttacks.push({
      from: { x: tower.x, y: tower.y },
      to: targetPos,
      effectType: 'fire',
    });
    this.fireZones.push({
      x: targetPos.x,
      y: targetPos.y,
      radius: levelCfg.fireballRadius || 1.0,
      dps: levelCfg.fireballDps || 0,
      durationLeft: levelCfg.fireballDuration || 3.0,
    });
  }

  applyWindControl(tower, levelCfg) {
    const targets = this.getTargetsInRange(tower, levelCfg.range, levelCfg.windTargets || 1);
    for (const target of targets) {
      target.hp -= levelCfg.damage;
      target.slowPercent = Math.max(target.slowPercent, levelCfg.slowPercent || 0);
      target.slowDurationLeft = Math.max(target.slowDurationLeft, levelCfg.slowDuration || 0);
      this.lastAttacks.push({
        from: { x: tower.x, y: tower.y },
        to: this.getEnemyWorldPosition(target),
        effectType: 'wind',
      });
    }
  }

  applyBombSplash(tower, target, levelCfg) {
    target.hp -= levelCfg.damage;
    const targetPos = this.getEnemyWorldPosition(target);
    const splashRadius = levelCfg.splashRadius || 0;
    const splashDamage = levelCfg.damage * (1 - (levelCfg.splashFalloff || 0) / 100);

    this.lastAttacks.push({
      from: { x: tower.x, y: tower.y },
      to: targetPos,
      effectType: 'bomb',
    });

    if (splashRadius <= 0 || splashDamage <= 0) {
      return;
    }

    for (const enemy of this.enemies) {
      if (enemy.id === target.id) {
        continue;
      }
      const enemyPos = this.getEnemyWorldPosition(enemy);
      const d = Math.hypot(
        (enemyPos.x - targetPos.x) * WORLD_SCALE,
        (enemyPos.y - targetPos.y) * WORLD_SCALE
      );
      if (d <= splashRadius) {
        enemy.hp -= splashDamage;
      }
    }
  }

  pickTarget(tower, rangeUnits) {
    const targets = this.getTargetsInRange(tower, rangeUnits, 1);
    return targets[0] || null;
  }

  getTargetsInRange(tower, rangeUnits, maxTargets = 1) {
    const inRange = this.enemies.filter((enemy) => {
      const pos = this.getEnemyWorldPosition(enemy);
      const d = Math.hypot((tower.x - pos.x) * WORLD_SCALE, (tower.y - pos.y) * WORLD_SCALE);
      return d <= rangeUnits;
    });
    inRange.sort((a, b) => {
      const ap = a.routeLength === 0 ? 0 : a.distance / a.routeLength;
      const bp = b.routeLength === 0 ? 0 : b.distance / b.routeLength;
      return bp - ap;
    });
    return inRange.slice(0, Math.max(1, maxTargets));
  }

  applyLightningChain(sourceEnemy, baseDamage, falloffPercent, chainCount, shockDuration = 0) {
    if (chainCount <= 0) {
      return;
    }
    const sourcePos = this.getEnemyWorldPosition(sourceEnemy);
    const available = this.enemies
      .filter((enemy) => enemy.id !== sourceEnemy.id)
      .map((enemy) => {
        const pos = this.getEnemyWorldPosition(enemy);
        const d = Math.hypot((sourcePos.x - pos.x) * WORLD_SCALE, (sourcePos.y - pos.y) * WORLD_SCALE);
        return { enemy, d };
      })
      .sort((a, b) => a.d - b.d);

    let hits = 0;
    for (const candidate of available) {
      if (hits >= chainCount) {
        break;
      }
      if (candidate.d > CHAIN_RADIUS) {
        continue;
      }
      const chainDamage = baseDamage * (1 - falloffPercent / 100);
      candidate.enemy.hp -= chainDamage;
      if (shockDuration > 0) {
        candidate.enemy.shockDurationLeft = Math.max(candidate.enemy.shockDurationLeft || 0, shockDuration);
      }
      this.lastAttacks.push({
        from: sourcePos,
        to: this.getEnemyWorldPosition(candidate.enemy),
        effectType: 'lightning_chain',
      });
      hits += 1;
    }
  }

  updateMovement(dt) {
    const survivors = [];
    for (const enemy of this.enemies) {
      const slowMultiplier = 1 - Math.min(enemy.slowPercent / 100, 0.84);
      enemy.distance += enemy.speed * slowMultiplier * dt;

      if (enemy.distance >= enemy.routeLength) {
        this.coins -= this.mapConfig.leakPenalty.coins;
        this.xp = Math.max(0, this.xp - this.mapConfig.leakPenalty.xp);
        this.stats.leaked += 1;
      } else {
        survivors.push(enemy);
      }
    }
    this.enemies = survivors;

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
    const waveDone = this.spawnQueue.length === 0 && this.enemies.length === 0;
    if (!waveDone) {
      return;
    }

    this.xp += PROGRESSION.xpPerWaveClear + (this.mapConfig.xpWaveBonus || 0);
    this.state = 'wave_result';

    if (this.waveIndex === this.waves.length - 1) {
      this.xp += PROGRESSION.xpMapClear + (this.mapConfig.xpMapBonus || 0);
      this.state = 'map_result';
      this.result = {
        victory: true,
        mapId: this.mapConfig.mapId,
        nextMapUnlocked: this.xp >= this.mapConfig.unlockRequirement.minXp,
      };
    } else {
      this.state = 'build_phase';
    }
  }

  getSnapshot() {
    return {
      mapId: this.mapConfig.mapId,
      mapName: this.mapConfig.name,
      state: this.state,
      coins: this.coins,
      xp: this.xp,
      wave: this.waveIndex + 1,
      totalWaves: this.waves.length,
      boatsLeft: this.spawnQueue.length + this.enemies.length,
      result: this.result,
      nextMapUnlocked: this.xp >= this.mapConfig.unlockRequirement.minXp,
      leaked: this.stats.leaked,
      killed: this.stats.killed,
      spawned: this.stats.spawned,
    };
  }

  getTower(slotId) {
    return this.towers.get(slotId) || null;
  }

  getBuildSlots() {
    return this.buildSlots;
  }
}

export function getPathPosition(game, distanceValue, routeIndex = 0) {
  const route = game.routeInfos[routeIndex] || game.routeInfos[0];
  return positionAtDistance(route.pathInfo, distanceValue);
}

export function getEnemyPosition(game, enemy) {
  return game.getEnemyWorldPosition(enemy);
}
