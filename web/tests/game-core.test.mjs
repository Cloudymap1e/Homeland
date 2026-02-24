import test from 'node:test';
import assert from 'node:assert/strict';

import { HomelandGame, getPathPosition } from '../src/game-core.js';

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
  game.enemies.push({
    id,
    enemyType: 'raider',
    hp,
    maxHp: hp,
    speed: 0.0,
    coinReward: 0,
    xpReward: 0,
    distance,
    burnDps: 0,
    burnDurationLeft: 0,
    slowPercent: 0,
    slowDurationLeft: 0,
  });
}

function addTower(game, towerId, level, distance) {
  const p = getPathPosition(game, distance);
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

  const buildRes = game.buildTower('s01', 'arrow');
  assert.equal(buildRes.ok, true);
  assert.equal(game.coins, 9500);

  const upRes = game.upgradeTower('s01');
  assert.equal(upRes.ok, true);
  assert.equal(game.coins, 9050);

  const tower = game.getTower('s01');
  assert.equal(tower.level, 2);
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
  addTower(game, 'magic_wind', 2, 5.0);
  game.updateTowerAttacks(0.1);
  assert.equal(game.enemies.filter((e) => e.slowPercent > 0).length, 5);

  game.towers.clear();
  for (const enemy of game.enemies) {
    enemy.slowPercent = 0;
    enemy.slowDurationLeft = 0;
  }
  addTower(game, 'magic_wind', 3, 5.0);
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

  const hpAfterImpact = game.enemies[0].hp;
  game.updateEffects(1.0);
  assert.ok(game.enemies[0].hp < hpAfterImpact);

  game.updateEffects(2.1);
  assert.equal(game.fireZones.length, 0);
});

test('bomb tower applies splash damage to nearby fleets', () => {
  const game = new HomelandGame();
  addEnemy(game, 'b_target', 5.1, 1200);
  addEnemy(game, 'b_near', 5.02, 1200);
  addEnemy(game, 'b_far', 0.5, 1200);
  addTower(game, 'bone', 1, 5.0);

  game.updateTowerAttacks(0.1);

  const target = game.enemies.find((e) => e.id === 'b_target');
  const near = game.enemies.find((e) => e.id === 'b_near');
  const far = game.enemies.find((e) => e.id === 'b_far');

  assert.ok(target.hp < 1200);
  assert.ok(near.hp < 1200);
  assert.equal(far.hp, 1200);
});

test('full run reaches map_result with deterministic build order', () => {
  const game = new HomelandGame();

  game.buildTower('s03', 'arrow');
  game.buildTower('s05', 'bone');
  game.buildTower('s08', 'magic_fire');
  game.buildTower('s07', 'magic_wind');

  let guard = 0;
  while (game.state !== 'map_result' && guard < 120000) {
    if (['build_phase', 'wave_result'].includes(game.state)) {
      game.upgradeTower('s03');
      game.startNextWave();
    }
    game.tick(0.05);
    guard += 1;
  }

  assert.equal(game.state, 'map_result');
  assert.ok(game.coins >= 0);
});
