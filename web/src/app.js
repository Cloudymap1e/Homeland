import { HomelandGame, getPathPosition } from './game-core.js';
import { MAP_CONFIG, TOWER_CONFIG, WAVES } from './config.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const elCoins = document.getElementById('coins');
const elXp = document.getElementById('xp');
const elWave = document.getElementById('wave');
const elBoatsLeft = document.getElementById('boats-left');
const elState = document.getElementById('state');
const elResult = document.getElementById('result');
const elSelection = document.getElementById('selection');
const elTowerButtons = document.getElementById('tower-buttons');

const btnStartWave = document.getElementById('start-wave');
const btnToggleSpeed = document.getElementById('toggle-speed');
const btnReset = document.getElementById('reset');
const btnUpgrade = document.getElementById('upgrade');

const game = new HomelandGame();
let selectedTowerId = 'arrow';
let selectedSlotId = null;
let lastTime = performance.now();

const SLOT_RADIUS = 16;

function normToPx(p) {
  return { x: p.x * canvas.width, y: p.y * canvas.height };
}

function rebuildTowerButtons() {
  elTowerButtons.innerHTML = '';
  for (const tower of Object.values(TOWER_CONFIG)) {
    const btn = document.createElement('button');
    btn.dataset.towerId = tower.id;
    btn.textContent = `${tower.name} (${tower.levels[0].cost})`;
    if (tower.id === selectedTowerId) {
      btn.classList.add('active');
    }
    btn.addEventListener('click', () => {
      selectedTowerId = tower.id;
      rebuildTowerButtons();
      updateSelectionText();
    });
    elTowerButtons.appendChild(btn);
  }
}

function updateSelectionText() {
  const slot = selectedSlotId ? MAP_CONFIG.buildSlots.find((s) => s.id === selectedSlotId) : null;
  if (!slot) {
    elSelection.textContent = `Build mode: ${TOWER_CONFIG[selectedTowerId].name}. Click a slot to place.`;
    btnUpgrade.disabled = true;
    return;
  }

  const tower = game.getTower(slot.id);
  if (!tower) {
    elSelection.textContent = `Slot ${slot.id} selected. Click again to build ${TOWER_CONFIG[selectedTowerId].name}.`;
    btnUpgrade.disabled = true;
    return;
  }

  const cfg = TOWER_CONFIG[tower.towerId];
  const levelCfg = cfg.levels[tower.level - 1];
  let text = `${cfg.name} at ${slot.id}\nLevel ${tower.level} | DMG ${levelCfg.damage} | RNG ${levelCfg.range}`;
  if (tower.level < cfg.levels.length) {
    const nextCost = cfg.levels[tower.level].cost;
    text += `\nUpgrade cost: ${nextCost}`;
    btnUpgrade.disabled = game.coins < nextCost || !['build_phase', 'wave_result'].includes(game.state);
  } else {
    text += '\nMax level reached';
    btnUpgrade.disabled = true;
  }
  elSelection.textContent = text;
}

function updateHud() {
  const snap = game.getSnapshot();
  elCoins.textContent = String(snap.coins);
  elXp.textContent = String(snap.xp);
  elWave.textContent = `${Math.max(snap.wave, 0)}/${snap.totalWaves}`;
  elBoatsLeft.textContent = String(snap.boatsLeft);
  elState.textContent = snap.state;

  if (snap.result) {
    if (snap.result.victory) {
      elResult.innerHTML = `Victory. Next map unlocked: <strong>${snap.result.nextMapUnlocked ? 'Yes' : 'No'}</strong>`;
    } else {
      elResult.innerHTML = 'Defeat. Coins dropped below zero.';
    }
  } else {
    elResult.textContent = 'In progress.';
  }

  btnStartWave.disabled = !['build_phase', 'wave_result'].includes(game.state);
  btnToggleSpeed.textContent = `Speed ${game.speed}x`;

  updateSelectionText();
}

function drawPath() {
  ctx.save();
  ctx.lineWidth = 66;
  ctx.strokeStyle = '#0f3b66';
  ctx.lineCap = 'round';
  ctx.beginPath();

  MAP_CONFIG.pathWaypoints.forEach((wp, idx) => {
    const p = normToPx(wp);
    if (idx === 0) {
      ctx.moveTo(p.x, p.y);
    } else {
      ctx.lineTo(p.x, p.y);
    }
  });
  ctx.stroke();

  ctx.lineWidth = 10;
  ctx.strokeStyle = '#5fb6ff';
  ctx.stroke();
  ctx.restore();
}

function towerColor(towerId) {
  if (towerId === 'arrow') return '#d2b48c';
  if (towerId === 'bone') return '#e5e7eb';
  if (towerId === 'magic_fire') return '#ef4444';
  if (towerId === 'magic_wind') return '#22d3ee';
  if (towerId === 'magic_lightning') return '#fde047';
  return '#cbd5e1';
}

function drawSlotsAndTowers() {
  for (const slot of MAP_CONFIG.buildSlots) {
    const p = normToPx(slot);
    const tower = game.getTower(slot.id);

    ctx.beginPath();
    ctx.arc(p.x, p.y, SLOT_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = tower ? '#1e293b' : '#334155';
    ctx.fill();
    ctx.lineWidth = selectedSlotId === slot.id ? 3 : 1;
    ctx.strokeStyle = selectedSlotId === slot.id ? '#7dd3fc' : '#94a3b8';
    ctx.stroke();

    if (tower) {
      ctx.fillStyle = towerColor(tower.towerId);
      ctx.fillRect(p.x - 10, p.y - 10, 20, 20);
      ctx.fillStyle = '#0f172a';
      ctx.font = '12px sans-serif';
      ctx.fillText(String(tower.level), p.x - 3, p.y + 4);
    }
  }
}

function drawEnemies() {
  for (const enemy of game.enemies) {
    const p = normToPx(getPathPosition(game, enemy.distance));

    ctx.beginPath();
    ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
    ctx.fillStyle = enemy.enemyType === 'barge' ? '#f97316' : enemy.enemyType === 'raider' ? '#facc15' : '#86efac';
    ctx.fill();

    const hpRatio = Math.max(0, enemy.hp / enemy.maxHp);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(p.x - 14, p.y - 18, 28, 4);
    ctx.fillStyle = '#22c55e';
    ctx.fillRect(p.x - 14, p.y - 18, 28 * hpRatio, 4);
  }
}

function drawAttackTraces() {
  for (const attack of game.lastAttacks) {
    const from = normToPx(attack.from);
    const to = normToPx(attack.to);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.lineWidth = 2;
    ctx.strokeStyle = attack.effectType === 'fire'
      ? 'rgba(239,68,68,0.7)'
      : attack.effectType === 'wind'
        ? 'rgba(34,211,238,0.7)'
        : attack.effectType === 'lightning'
          ? 'rgba(253,224,71,0.8)'
          : 'rgba(229,231,235,0.7)';
    ctx.stroke();
  }
}

function drawWaveBanner() {
  if (game.state !== 'wave_running') {
    return;
  }
  const wave = WAVES[game.waveIndex];
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(canvas.width / 2 - 120, 14, 240, 34);
  ctx.fillStyle = '#e5e7eb';
  ctx.font = '18px sans-serif';
  ctx.fillText(`Wave ${wave.id}/${WAVES.length}`, canvas.width / 2 - 54, 37);
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawPath();
  drawSlotsAndTowers();
  drawEnemies();
  drawAttackTraces();
  drawWaveBanner();
}

function gameLoop(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.06);
  lastTime = now;

  game.tick(dt);
  render();
  updateHud();

  requestAnimationFrame(gameLoop);
}

function pickSlotFromMouse(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * canvas.width;
  const y = ((clientY - rect.top) / rect.height) * canvas.height;

  for (const slot of MAP_CONFIG.buildSlots) {
    const p = normToPx(slot);
    if (Math.hypot(x - p.x, y - p.y) <= SLOT_RADIUS + 4) {
      return slot;
    }
  }
  return null;
}

canvas.addEventListener('click', (event) => {
  const slot = pickSlotFromMouse(event.clientX, event.clientY);
  if (!slot) {
    selectedSlotId = null;
    updateSelectionText();
    return;
  }

  selectedSlotId = slot.id;
  const tower = game.getTower(slot.id);

  if (!tower && ['build_phase', 'wave_result'].includes(game.state)) {
    game.buildTower(slot.id, selectedTowerId);
  }

  updateSelectionText();
});

btnStartWave.addEventListener('click', () => {
  game.startNextWave();
  updateHud();
});

btnToggleSpeed.addEventListener('click', () => {
  game.setSpeed(game.speed === 1 ? 2 : 1);
  updateHud();
});

btnUpgrade.addEventListener('click', () => {
  if (!selectedSlotId) {
    return;
  }
  game.upgradeTower(selectedSlotId);
  updateHud();
});

btnReset.addEventListener('click', () => {
  game.reset();
  selectedSlotId = null;
  updateHud();
});

rebuildTowerButtons();
updateHud();
requestAnimationFrame(gameLoop);
