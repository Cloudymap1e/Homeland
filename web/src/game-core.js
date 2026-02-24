import { MAP_CONFIG, TOWER_CONFIG, ENEMIES, WAVES, PROGRESSION } from './config.js';

const WORLD_SCALE = 10;
const CHAIN_RADIUS = 2.4;

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
  return { segments, length: total };
}

function positionAtDistance(pathInfo, d) {
  const points = MAP_CONFIG.pathWaypoints;
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

export class HomelandGame {
  constructor() {
    this.pathInfo = getPathSegments(MAP_CONFIG.pathWaypoints);
    this.reset();
  }

  reset() {
    this.state = 'build_phase';
    this.coins = MAP_CONFIG.startingCoins;
    this.xp = MAP_CONFIG.startingXp;
    this.waveIndex = -1;
    this.speed = 1;
    this.spawnCooldown = 0;
    this.spawnQueue = [];
    this.enemies = [];
    this.nextEnemyId = 1;
    this.towers = new Map();
    this.lastAttacks = [];
    this.result = null;
    this.events = [];
  }

  setSpeed(multiplier) {
    this.speed = multiplier;
  }

  buildTower(slotId, towerId) {
    if (!['build_phase', 'wave_result'].includes(this.state)) {
      return { ok: false, error: 'Can only build in build phase.' };
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

    const slot = MAP_CONFIG.buildSlots.find((s) => s.id === slotId);
    if (!slot) {
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
    if (!['build_phase', 'wave_result'].includes(this.state)) {
      return { ok: false, error: 'Can only upgrade in build phase.' };
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
    if (this.waveIndex + 1 >= WAVES.length) {
      return { ok: false, error: 'No more waves.' };
    }
    this.waveIndex += 1;
    const wave = WAVES[this.waveIndex];
    this.spawnQueue = Object.entries(wave.composition)
      .flatMap(([enemyType, count]) => Array(count).fill(enemyType));
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
    const wave = WAVES[this.waveIndex];
    this.spawnCooldown -= dt;
    while (this.spawnQueue.length > 0 && this.spawnCooldown <= 0) {
      const enemyType = this.spawnQueue.shift();
      this.spawnEnemy(enemyType);
      this.spawnCooldown += wave.spawnInterval;
    }
  }

  spawnEnemy(enemyType) {
    const template = ENEMIES[enemyType];
    this.enemies.push({
      id: `enemy_${this.nextEnemyId}`,
      enemyType,
      hp: template.hp,
      maxHp: template.hp,
      speed: template.speed,
      coinReward: template.coinReward,
      xpReward: template.xpReward,
      distance: 0,
      burnDps: 0,
      burnDurationLeft: 0,
      slowPercent: 0,
      slowDurationLeft: 0,
    });
    this.nextEnemyId += 1;
  }

  updateEffects(dt) {
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
    }

    this.enemies = this.enemies.filter((enemy) => {
      if (enemy.hp <= 0) {
        this.coins += enemy.coinReward;
        this.xp += enemy.xpReward;
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
      target.hp -= levelCfg.damage;
      this.lastAttacks.push({
        from: { x: tower.x, y: tower.y },
        to: positionAtDistance(this.pathInfo, target.distance),
        effectType: cfg.effectType,
      });

      if (cfg.effectType === 'fire') {
        target.burnDps = Math.max(target.burnDps, levelCfg.burnDps || 0);
        target.burnDurationLeft = levelCfg.burnDuration || 0;
      }

      if (cfg.effectType === 'wind') {
        target.slowPercent = Math.max(target.slowPercent, levelCfg.slowPercent || 0);
        target.slowDurationLeft = Math.max(target.slowDurationLeft, levelCfg.slowDuration || 0);
      }

      if (cfg.effectType === 'lightning') {
        this.applyLightningChain(target, levelCfg.damage, levelCfg.chainFalloff || 0, levelCfg.chainCount || 0);
      }
    }
  }

  pickTarget(tower, rangeUnits) {
    let best = null;
    let bestDistance = -Infinity;
    for (const enemy of this.enemies) {
      const pos = positionAtDistance(this.pathInfo, enemy.distance);
      const d = Math.hypot((tower.x - pos.x) * WORLD_SCALE, (tower.y - pos.y) * WORLD_SCALE);
      if (d <= rangeUnits && enemy.distance > bestDistance) {
        best = enemy;
        bestDistance = enemy.distance;
      }
    }
    return best;
  }

  applyLightningChain(sourceEnemy, baseDamage, falloffPercent, chainCount) {
    if (chainCount <= 0) {
      return;
    }
    const sourcePos = positionAtDistance(this.pathInfo, sourceEnemy.distance);
    const available = this.enemies
      .filter((enemy) => enemy.id !== sourceEnemy.id)
      .map((enemy) => {
        const pos = positionAtDistance(this.pathInfo, enemy.distance);
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
      hits += 1;
    }
  }

  updateMovement(dt) {
    const survivors = [];
    for (const enemy of this.enemies) {
      const slowMultiplier = 1 - Math.min(enemy.slowPercent / 100, 0.8);
      enemy.distance += enemy.speed * slowMultiplier * dt;

      if (enemy.distance >= this.pathInfo.length) {
        this.coins -= MAP_CONFIG.leakPenalty.coins;
        this.xp = Math.max(0, this.xp - MAP_CONFIG.leakPenalty.xp);
      } else {
        survivors.push(enemy);
      }
    }
    this.enemies = survivors;

    if (this.coins < 0) {
      this.state = 'map_result';
      this.result = { victory: false, nextMapUnlocked: false };
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

    this.xp += PROGRESSION.xpPerWaveClear;
    this.state = 'wave_result';

    if (this.waveIndex === WAVES.length - 1) {
      this.xp += PROGRESSION.xpMapClear;
      this.state = 'map_result';
      this.result = {
        victory: true,
        nextMapUnlocked: this.xp >= MAP_CONFIG.unlockRequirement.minXp,
      };
    } else {
      this.state = 'build_phase';
    }
  }

  getSnapshot() {
    return {
      state: this.state,
      coins: this.coins,
      xp: this.xp,
      wave: this.waveIndex + 1,
      totalWaves: WAVES.length,
      boatsLeft: this.spawnQueue.length + this.enemies.length,
      result: this.result,
      nextMapUnlocked: this.xp >= MAP_CONFIG.unlockRequirement.minXp,
    };
  }

  getTower(slotId) {
    return this.towers.get(slotId) || null;
  }
}

export function getPathPosition(game, distanceValue) {
  return positionAtDistance(game.pathInfo, distanceValue);
}
