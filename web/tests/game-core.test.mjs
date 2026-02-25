import test from 'node:test';
import assert from 'node:assert/strict';

import { HomelandGame, getPathPosition } from '../src/game-core.js';
import { MAPS, TOWER_CONFIG } from '../src/config.js';

function advance(game, seconds, step = 0.1) {
  const loops = Math.ceil(seconds / step);
  for (let i = 0; i < loops; i += 1) {
    game.tick(step);
    if (game.state === 'map_result') {
      break;
    }
  }
}

function addEnemy(game, id, distance, hp = 600) {
  const routeLength = game.routeInfos[0].pathInfo.length;
  game.enemies.push({
    id,
    enemyType: 'raider',
    hp,
    maxHp: hp,
    speed: 0.0,
    coinReward: 0,
    xpReward: 0,
    distance,
    routeIndex: 0,
    routeLength,
    burnDps: 0,
    burnDurationLeft: 0,
    slowPercent: 0,
    slowDurationLeft: 0,
    shockDurationLeft: 0,
  });
}

function addTower(game, towerId, level, distance) {
  const p = getPathPosition(game, distance, 0);
  game.towers.set(`slot_${towerId}_${level}`, {
    id: `tower_${towerId}_${level}`,
    towerId,
    level,
    slotId: `slot_${towerId}_${level}`,
    x: p.x,
    y: p.y,
    cooldown: 0,
  });
}

test('build and upgrade deduct coins correctly', () => {
  const game = new HomelandGame();
  const level1Cost = TOWER_CONFIG.arrow.levels[0].cost;
  const level2Cost = TOWER_CONFIG.arrow.levels[1].cost;

  const buildRes = game.buildTower('s01', 'arrow');
  assert.equal(buildRes.ok, true);
  assert.equal(game.coins, game.mapConfig.startingCoins - level1Cost);

  const upRes = game.upgradeTower('s01');
  assert.equal(upRes.ok, true);
  assert.equal(game.coins, game.mapConfig.startingCoins - level1Cost - level2Cost);

  const tower = game.getTower('s01');
  assert.equal(tower.level, 2);
});

test('build and upgrade are allowed during active wave', () => {
  const game = new HomelandGame();
  const level1Cost = TOWER_CONFIG.arrow.levels[0].cost;
  const level2Cost = TOWER_CONFIG.arrow.levels[1].cost;

  const startRes = game.startNextWave();
  assert.equal(startRes.ok, true);
  assert.equal(game.state, 'wave_running');

  const buildRes = game.buildTower('s01', 'arrow');
  assert.equal(buildRes.ok, true);

  const upRes = game.upgradeTower('s01');
  assert.equal(upRes.ok, true);

  assert.equal(game.coins, game.mapConfig.startingCoins - level1Cost - level2Cost);
  assert.equal(game.getTower('s01')?.level, 2);
});

test('river-overlap slots are blocked for placement', () => {
  const game = new HomelandGame({ mapId: 'map_01_river_bend' });
  const buildableSlotIds = game.getBuildSlots().map((slot) => slot.id);

  assert.equal(buildableSlotIds.includes('s07'), false);

  const buildRes = game.buildTower('s07', 'arrow');
  assert.equal(buildRes.ok, false);
  assert.equal(buildRes.error, 'Cannot build in river.');
});

test('leaks apply penalties and XP floors at zero', () => {
  const game = new HomelandGame();
  game.xp = 3;
  game.startNextWave();

  // No towers built: enemies should leak.
  advance(game, 40);

  assert.ok(game.coins < 10000);
  assert.ok(game.xp >= 0);
});

test('wind tower slows 3/5/6 targets by level', () => {
  const game = new HomelandGame();

  for (let i = 0; i < 7; i += 1) {
    addEnemy(game, `e${i}`, 4.7 + i * 0.08, 800);
  }

  addTower(game, 'magic_wind', 1, 5.0);
  game.updateTowerAttacks(0.1);
  assert.equal(game.enemies.filter((e) => e.slowPercent > 0).length, 3);

  game.towers.clear();
  for (const enemy of game.enemies) {
    enemy.slowPercent = 0;
    enemy.slowDurationLeft = 0;
  }
  addTower(game, 'magic_wind', 18, 5.0);
  game.updateTowerAttacks(0.1);
  assert.equal(game.enemies.filter((e) => e.slowPercent > 0).length, 5);

  game.towers.clear();
  for (const enemy of game.enemies) {
    enemy.slowPercent = 0;
    enemy.slowDurationLeft = 0;
  }
  addTower(game, 'magic_wind', 40, 5.0);
  game.updateTowerAttacks(0.1);
  assert.equal(game.enemies.filter((e) => e.slowPercent > 0).length, 6);
});

test('fireball zone persists for 3 seconds and deals area damage', () => {
  const game = new HomelandGame();
  addEnemy(game, 'f1', 5.0, 2000);
  addTower(game, 'magic_fire', 1, 5.0);

  game.updateTowerAttacks(0.1);
  assert.equal(game.fireZones.length, 1);
  assert.ok(game.fireZones[0].durationLeft <= 3.0 && game.fireZones[0].durationLeft > 2.8);
  assert.ok(game.enemies[0].burnDurationLeft > 0);
  assert.ok(game.enemies[0].burnDps > 0);

  const hpAfterImpact = game.enemies[0].hp;
  game.enemies[0].distance = 0.1; // move outside the fire zone to isolate burn damage.
  game.updateEffects(1.0);
  assert.ok(game.enemies[0].hp < hpAfterImpact);

  game.updateEffects(2.1);
  assert.equal(game.fireZones.length, 0);
});

test('lightning applies shock state to primary and chained boats', () => {
  const game = new HomelandGame();
  addEnemy(game, 'l1', 5.1, 1400);
  addEnemy(game, 'l2', 5.2, 1400);
  addTower(game, 'magic_lightning', 1, 5.0);

  game.updateTowerAttacks(0.1);

  const primary = game.enemies.find((enemy) => enemy.id === 'l1');
  const chained = game.enemies.find((enemy) => enemy.id === 'l2');
  assert.ok(primary.shockDurationLeft > 0);
  assert.ok(chained.shockDurationLeft > 0);
  assert.ok(game.lastAttacks.some((attack) => attack.effectType === 'lightning_chain'));

  const primaryShockBefore = primary.shockDurationLeft;
  game.updateEffects(0.3);
  assert.ok(primary.shockDurationLeft < primaryShockBefore);
});

test('bomb tower applies splash damage to nearby fleets', () => {
  const game = new HomelandGame();
  addEnemy(game, 'b_target', 5.1, 1200);
  addEnemy(game, 'b_near', 5.02, 1200);
  addEnemy(game, 'b_far', 0.5, 1200);
  addTower(game, 'bomb', 1, 5.0);

  game.updateTowerAttacks(0.1);

  const target = game.enemies.find((e) => e.id === 'b_target');
  const near = game.enemies.find((e) => e.id === 'b_near');
  const far = game.enemies.find((e) => e.id === 'b_far');

  assert.ok(target.hp < 1200);
  assert.ok(near.hp < 1200);
  assert.equal(far.hp, 1200);
});

test('campaign includes branched maps with large fleet counts', () => {
  for (const map of Object.values(MAPS)) {
    assert.ok(map.routes.length >= 2);
    assert.ok(map.fleetTarget >= 200);
  }
});

test('all towers support 50 levels', () => {
  for (const tower of Object.values(TOWER_CONFIG)) {
    assert.equal(tower.levels.length, 50);
  }
});

test('map switching resets state and applies selected map settings', () => {
  const game = new HomelandGame();
  game.setMap('map_02_split_delta');

  assert.equal(game.mapConfig.mapId, 'map_02_split_delta');
  assert.equal(game.state, 'build_phase');
  assert.equal(game.waveIndex, -1);
  assert.equal(game.coins, game.mapConfig.startingCoins);
});

test('map switching can carry coins and xp for auto-continue', () => {
  const game = new HomelandGame();
  game.coins = 5432;
  game.xp = 987;

  game.setMap('map_02_split_delta', { carryResources: true });

  assert.equal(game.mapConfig.mapId, 'map_02_split_delta');
  assert.equal(game.coins, 5432);
  assert.equal(game.xp, 987);
  assert.equal(game.getNextMapId(), 'map_03_marsh_maze');
});
