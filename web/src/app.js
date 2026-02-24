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

const terrainLayer = document.createElement('canvas');
terrainLayer.width = canvas.width;
terrainLayer.height = canvas.height;

const riverLayer = document.createElement('canvas');
riverLayer.width = canvas.width;
riverLayer.height = canvas.height;

const TREE_CLUSTERS = [
  { x: 0.08, y: 0.14, r: 0.08, density: 34 },
  { x: 0.15, y: 0.83, r: 0.11, density: 42 },
  { x: 0.88, y: 0.16, r: 0.09, density: 30 },
  { x: 0.90, y: 0.74, r: 0.08, density: 26 },
  { x: 0.52, y: 0.93, r: 0.07, density: 24 },
];

const ROCKS = [
  { x: 0.25, y: 0.22, s: 1.0 },
  { x: 0.58, y: 0.27, s: 1.1 },
  { x: 0.82, y: 0.29, s: 1.25 },
  { x: 0.68, y: 0.70, s: 1.0 },
  { x: 0.36, y: 0.74, s: 1.1 },
  { x: 0.92, y: 0.57, s: 1.2 },
];

function normToPx(p) {
  return { x: p.x * canvas.width, y: p.y * canvas.height };
}

function seededNoise(n) {
  const x = Math.sin(n * 137.1 + 91.7) * 43758.5453123;
  return x - Math.floor(x);
}

function drawGrassTexture(target) {
  const g = target.createLinearGradient(0, 0, 0, canvas.height);
  g.addColorStop(0, '#507e3f');
  g.addColorStop(0.52, '#4b7538');
  g.addColorStop(1, '#3f662f');
  target.fillStyle = g;
  target.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 7600; i += 1) {
    const n = seededNoise(i + 1);
    const x = (seededNoise(i + 9) * canvas.width) | 0;
    const y = (seededNoise(i + 13) * canvas.height) | 0;
    const size = 1 + (seededNoise(i + 71) * 2.6);
    const alpha = 0.05 + (seededNoise(i + 41) * 0.16);

    target.fillStyle = n > 0.62
      ? `rgba(205,182,120,${alpha})`
      : `rgba(38,88,36,${alpha})`;
    target.fillRect(x, y, size, size);
  }

  for (let i = 0; i < 28; i += 1) {
    const cx = seededNoise(i * 3 + 21) * canvas.width;
    const cy = seededNoise(i * 7 + 51) * canvas.height;
    const rx = 36 + seededNoise(i * 5 + 19) * 84;
    const ry = 20 + seededNoise(i * 11 + 31) * 68;

    target.save();
    target.translate(cx, cy);
    target.rotate((seededNoise(i * 23 + 77) - 0.5) * 0.9);
    const patch = target.createRadialGradient(0, 0, 6, 0, 0, rx);
    patch.addColorStop(0, 'rgba(210,186,114,0.23)');
    patch.addColorStop(0.75, 'rgba(168,144,84,0.13)');
    patch.addColorStop(1, 'rgba(120,96,58,0.0)');
    target.fillStyle = patch;
    target.beginPath();
    target.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    target.fill();
    target.restore();
  }
}

function drawRock(target, x, y, scale) {
  const px = x * canvas.width;
  const py = y * canvas.height;

  target.save();
  target.translate(px, py);
  target.scale(scale, scale);

  target.fillStyle = 'rgba(18, 28, 20, 0.35)';
  target.beginPath();
  target.ellipse(0, 12, 17, 8, 0, 0, Math.PI * 2);
  target.fill();

  target.fillStyle = '#6f736c';
  target.beginPath();
  target.moveTo(-14, 8);
  target.lineTo(-8, -10);
  target.lineTo(4, -14);
  target.lineTo(14, -3);
  target.lineTo(10, 10);
  target.lineTo(-8, 12);
  target.closePath();
  target.fill();

  target.strokeStyle = '#9da299';
  target.lineWidth = 1;
  target.beginPath();
  target.moveTo(-6, -6);
  target.lineTo(6, -10);
  target.moveTo(-2, 2);
  target.lineTo(8, 0);
  target.stroke();

  target.restore();
}

function drawTreeCluster(target, cluster) {
  const cx = cluster.x * canvas.width;
  const cy = cluster.y * canvas.height;
  const radius = cluster.r * Math.min(canvas.width, canvas.height);

  for (let i = 0; i < cluster.density; i += 1) {
    const a = seededNoise(i * 17 + cx) * Math.PI * 2;
    const r = seededNoise(i * 29 + cy) * radius;
    const tx = cx + Math.cos(a) * r;
    const ty = cy + Math.sin(a) * r * 0.82;
    const h = 11 + seededNoise(i * 13 + r) * 13;

    target.fillStyle = 'rgba(20, 42, 25, 0.22)';
    target.beginPath();
    target.ellipse(tx, ty + h * 0.66, h * 0.6, h * 0.2, 0, 0, Math.PI * 2);
    target.fill();

    target.fillStyle = '#2f5933';
    target.beginPath();
    target.moveTo(tx, ty - h);
    target.lineTo(tx - h * 0.72, ty + h * 0.18);
    target.lineTo(tx + h * 0.72, ty + h * 0.18);
    target.closePath();
    target.fill();

    target.fillStyle = '#477a45';
    target.beginPath();
    target.moveTo(tx, ty - h * 0.86);
    target.lineTo(tx - h * 0.45, ty - h * 0.05);
    target.lineTo(tx + h * 0.45, ty - h * 0.05);
    target.closePath();
    target.fill();
  }
}

function traceRiverPath(target) {
  const points = MAP_CONFIG.pathWaypoints.map(normToPx);
  target.beginPath();
  target.moveTo(points[0].x, points[0].y);

  for (let i = 1; i < points.length - 1; i += 1) {
    const mx = (points[i].x + points[i + 1].x) * 0.5;
    const my = (points[i].y + points[i + 1].y) * 0.5;
    target.quadraticCurveTo(points[i].x, points[i].y, mx, my);
  }

  const end = points[points.length - 1];
  const prev = points[points.length - 2];
  target.quadraticCurveTo(prev.x, prev.y, end.x, end.y);
}

function drawRiverLayer(target) {
  target.clearRect(0, 0, canvas.width, canvas.height);

  target.save();
  target.lineCap = 'round';
  target.lineJoin = 'round';

  target.strokeStyle = '#9d915f';
  target.lineWidth = 86;
  traceRiverPath(target);
  target.stroke();

  const river = target.createLinearGradient(0, 0, 0, canvas.height);
  river.addColorStop(0, '#2a7cbe');
  river.addColorStop(0.5, '#19639a');
  river.addColorStop(1, '#2f87c6');
  target.strokeStyle = river;
  target.lineWidth = 68;
  traceRiverPath(target);
  target.stroke();

  target.strokeStyle = 'rgba(118,193,240,0.42)';
  target.lineWidth = 30;
  traceRiverPath(target);
  target.stroke();

  target.setLineDash([14, 16]);
  target.strokeStyle = 'rgba(230, 247, 255, 0.22)';
  target.lineWidth = 3;
  traceRiverPath(target);
  target.stroke();
  target.setLineDash([]);

  target.restore();
}

function buildStaticMapLayers() {
  const terrain = terrainLayer.getContext('2d');
  drawGrassTexture(terrain);

  for (const cluster of TREE_CLUSTERS) {
    drawTreeCluster(terrain, cluster);
  }

  for (const rock of ROCKS) {
    drawRock(terrain, rock.x, rock.y, rock.s);
  }

  const river = riverLayer.getContext('2d');
  drawRiverLayer(river);
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
  if (cfg.effectType === 'wind') {
    text += `\nSlow: ${levelCfg.slowPercent}% for ${levelCfg.slowDuration}s`;
    text += `\nTargets: ${levelCfg.windTargets}`;
  }
  if (cfg.effectType === 'fire') {
    text += `\nFireball: ${levelCfg.fireballDps}/s for ${levelCfg.fireballDuration}s`;
  }
  if (cfg.effectType === 'bomb') {
    text += `\nSplash radius: ${levelCfg.splashRadius}`;
  }
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

function drawMapBase() {
  ctx.drawImage(terrainLayer, 0, 0);
  ctx.drawImage(riverLayer, 0, 0);
}

function drawBuildSlot(slot, isSelected) {
  const p = normToPx(slot);
  const tower = game.getTower(slot.id);

  ctx.save();
  ctx.translate(p.x, p.y);

  ctx.fillStyle = tower ? 'rgba(14,26,18,0.40)' : 'rgba(31,57,29,0.30)';
  ctx.beginPath();
  ctx.ellipse(0, 8, 22, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = tower ? '#8f8466' : '#94886c';
  ctx.beginPath();
  ctx.arc(0, 0, SLOT_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = tower ? '#786e55' : '#7c7258';
  ctx.beginPath();
  ctx.arc(0, 0, SLOT_RADIUS - 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = isSelected ? '#a0f3ff' : 'rgba(250, 248, 225, 0.45)';
  ctx.lineWidth = isSelected ? 2.5 : 1;
  ctx.beginPath();
  ctx.arc(0, 0, SLOT_RADIUS - 2, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}

function towerRoofColor(towerId) {
  if (towerId === 'arrow') return '#a33d31';
  if (towerId === 'bone') return '#b37031';
  if (towerId === 'magic_fire') return '#d64c2d';
  if (towerId === 'magic_wind') return '#2587b4';
  if (towerId === 'magic_lightning') return '#b18329';
  return '#7f4a29';
}

function towerBodyColor(towerId) {
  if (towerId === 'arrow') return '#d0c8ad';
  if (towerId === 'bone') return '#cac4be';
  if (towerId === 'magic_fire') return '#bbb5d2';
  if (towerId === 'magic_wind') return '#afcbd1';
  if (towerId === 'magic_lightning') return '#c9c1a0';
  return '#c8c0aa';
}

function drawTowerSprite(tower, p) {
  const roof = towerRoofColor(tower.towerId);
  const body = towerBodyColor(tower.towerId);
  const h = 22 + (tower.level * 5);

  ctx.save();
  ctx.translate(p.x, p.y);

  ctx.fillStyle = 'rgba(19, 21, 16, 0.38)';
  ctx.beginPath();
  ctx.ellipse(0, 12, 14, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = body;
  ctx.fillRect(-7, -h + 5, 14, h);
  ctx.strokeStyle = '#6a6455';
  ctx.lineWidth = 1;
  ctx.strokeRect(-7, -h + 5, 14, h);

  ctx.fillStyle = roof;
  ctx.beginPath();
  ctx.moveTo(0, -h - 8);
  ctx.lineTo(-10, -h + 5);
  ctx.lineTo(10, -h + 5);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#f6e7a7';
  ctx.fillRect(-2, -h + 12, 4, 5);

  if (tower.towerId.startsWith('magic_')) {
    ctx.strokeStyle = tower.towerId === 'magic_fire'
      ? 'rgba(255,121,69,0.75)'
      : tower.towerId === 'magic_wind'
        ? 'rgba(129,237,255,0.75)'
        : 'rgba(255,234,138,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, -h - 2, 5, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = '#f5f0d5';
  ctx.beginPath();
  ctx.moveTo(9, -h + 4);
  ctx.lineTo(17, -h + 1);
  ctx.lineTo(9, -h - 2);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#20314c';
  ctx.font = 'bold 10px monospace';
  ctx.fillText(String(tower.level), -3, 3);

  ctx.restore();
}

function drawSlotsAndTowers() {
  for (const slot of MAP_CONFIG.buildSlots) {
    const p = normToPx(slot);
    drawBuildSlot(slot, selectedSlotId === slot.id);

    const tower = game.getTower(slot.id);
    if (tower) {
      drawTowerSprite(tower, p);
    }
  }
}

function drawFireZones() {
  for (const zone of game.fireZones || []) {
    const p = normToPx(zone);
    const radius = (zone.radius / 10) * canvas.width;
    const alpha = Math.min(0.42, 0.16 + (zone.durationLeft / 3) * 0.24);

    const ring = ctx.createRadialGradient(p.x, p.y, radius * 0.2, p.x, p.y, radius);
    ring.addColorStop(0, `rgba(255, 120, 60, ${alpha})`);
    ring.addColorStop(0.6, `rgba(242, 85, 40, ${alpha * 0.85})`);
    ring.addColorStop(1, 'rgba(145, 28, 20, 0)');

    ctx.fillStyle = ring;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBoat(enemy, p, angle) {
  const isScout = enemy.enemyType === 'scout';
  const isRaider = enemy.enemyType === 'raider';

  const hullColor = isScout ? '#4f7c36' : isRaider ? '#8a5c2b' : '#6b2b2b';
  const sailColor = isScout ? '#dee9c8' : isRaider ? '#f0e8d0' : '#f2cba8';
  const size = isScout ? 0.86 : isRaider ? 1.0 : 1.25;

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(angle);
  ctx.scale(size, size);

  ctx.fillStyle = 'rgba(16, 36, 60, 0.28)';
  ctx.beginPath();
  ctx.ellipse(-7, 8, 16, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(227, 248, 255, 0.21)';
  ctx.beginPath();
  ctx.ellipse(-13, 7, 6, 2, 0, 0, Math.PI * 2);
  ctx.ellipse(-17, 9, 4, 1.6, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = hullColor;
  ctx.beginPath();
  ctx.moveTo(13, 0);
  ctx.lineTo(-9, -6);
  ctx.lineTo(-18, 0);
  ctx.lineTo(-9, 6);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#302315';
  ctx.fillRect(-8, -8, 2, 16);

  ctx.fillStyle = sailColor;
  ctx.beginPath();
  ctx.moveTo(-6, -7);
  ctx.lineTo(6, -2);
  ctx.lineTo(-6, 2);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#9f1f1f';
  ctx.fillRect(1, -2, 4, 4);

  ctx.restore();
}

function drawEnemies() {
  for (const enemy of game.enemies) {
    const p = normToPx(getPathPosition(game, enemy.distance));
    const backP = normToPx(getPathPosition(game, Math.max(0, enemy.distance - 0.2)));
    const angle = Math.atan2(p.y - backP.y, p.x - backP.x);

    drawBoat(enemy, p, angle);

    const hpRatio = Math.max(0, enemy.hp / enemy.maxHp);
    ctx.fillStyle = 'rgba(7, 16, 22, 0.76)';
    ctx.fillRect(p.x - 16, p.y - 18, 32, 4);
    ctx.fillStyle = hpRatio > 0.45 ? '#35d06d' : '#f59e0b';
    ctx.fillRect(p.x - 16, p.y - 18, 32 * hpRatio, 4);
  }
}

function drawAttackTraces() {
  for (const attack of game.lastAttacks) {
    const from = normToPx(attack.from);
    const to = normToPx(attack.to);

    if (attack.effectType === 'lightning') {
      ctx.strokeStyle = 'rgba(255,229,120,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      const midX = (from.x + to.x) * 0.5;
      const midY = (from.y + to.y) * 0.5 + (Math.random() * 14 - 7);
      ctx.lineTo(midX, midY);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      continue;
    }

    ctx.lineWidth = attack.effectType === 'wind' ? 2.2 : 2.4;
    ctx.strokeStyle = attack.effectType === 'fire'
      ? 'rgba(255,123,87,0.82)'
      : attack.effectType === 'bomb'
        ? 'rgba(246,185,92,0.78)'
      : attack.effectType === 'wind'
        ? 'rgba(152,237,255,0.74)'
        : 'rgba(236,228,193,0.72)';

    if (attack.effectType === 'wind') {
      ctx.setLineDash([6, 4]);
    }

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    const curve = attack.effectType === 'fire' ? -14 : 8;
    ctx.quadraticCurveTo((from.x + to.x) * 0.5, (from.y + to.y) * 0.5 + curve, to.x, to.y);
    ctx.stroke();

    ctx.setLineDash([]);
  }
}

function drawWaveBanner() {
  if (game.state !== 'wave_running') {
    return;
  }

  const wave = WAVES[game.waveIndex];
  const x = canvas.width * 0.5 - 150;
  const y = 15;

  const band = ctx.createLinearGradient(0, y, 0, y + 42);
  band.addColorStop(0, 'rgba(26,37,51,0.84)');
  band.addColorStop(1, 'rgba(13,22,32,0.84)');

  ctx.fillStyle = band;
  ctx.strokeStyle = 'rgba(176, 205, 227, 0.35)';
  ctx.lineWidth = 1;
  ctx.fillRect(x, y, 300, 42);
  ctx.strokeRect(x, y, 300, 42);

  ctx.fillStyle = '#e7f2ff';
  ctx.font = 'bold 20px "Trebuchet MS", sans-serif';
  ctx.fillText(`Wave ${wave.id}/${WAVES.length}`, x + 98, y + 28);
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawMapBase();
  drawFireZones();
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
    if (Math.hypot(x - p.x, y - p.y) <= SLOT_RADIUS + 6) {
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

buildStaticMapLayers();
rebuildTowerButtons();
updateHud();
requestAnimationFrame(gameLoop);
