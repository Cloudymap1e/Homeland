import test from 'node:test';
import assert from 'node:assert/strict';

import { HomelandGame } from '../src/game-core.js';

function advance(game, seconds, step = 0.1) {
  const loops = Math.ceil(seconds / step);
  for (let i = 0; i < loops; i += 1) {
    game.tick(step);
    if (game.state === 'map_result') {
      break;
    }
  }
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
