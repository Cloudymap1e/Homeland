import { HomelandGame, getEnemyPosition } from './game-core.js';
import { MAPS, DEFAULT_MAP_ID, TOWER_CONFIG, CAMPAIGN_INFO } from './config.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const elMapName = document.getElementById('map-name');
const elCoins = document.getElementById('coins');
const elXp = document.getElementById('xp');
const elWave = document.getElementById('wave');
const elBoatsLeft = document.getElementById('boats-left');
const elState = document.getElementById('state');
const elResult = document.getElementById('result');
const elSelection = document.getElementById('selection');
const elTowerButtons = document.getElementById('tower-buttons');
const elMapSelect = document.getElementById('map-select');
const elMapMeta = document.getElementById('map-meta');
const elCurveTower = document.getElementById('curve-tower');
const curveCanvas = document.getElementById('curve-chart');
const curveCtx = curveCanvas.getContext('2d');
const elCurveSummary = document.getElementById('curve-summary');

const btnStartWave = document.getElementById('start-wave');
const btnToggleSpeed = document.getElementById('toggle-speed');
const btnFastForwardWave = document.getElementById('fast-forward-wave');
const btnToggleAutoContinue = document.getElementById('toggle-auto-continue');
const btnReset = document.getElementById('reset');
const btnUpgrade = document.getElementById('upgrade');
const btnLoadMap = document.getElementById('load-map');

const game = new HomelandGame({ mapId: DEFAULT_MAP_ID });
let selectedTowerId = 'arrow';
let selectedCurveTowerId = 'arrow';
let selectedSlotId = null;
let lastTime = performance.now();
let simTime = 0;
let autoContinueEnabled = false;
let fastForwardUntilMs = 0;
let curveDirty = true;

const SLOT_RADIUS = 16;
const WORLD_SCALE = 10;
const EFFECT_LIMIT = 520;
const FAST_FORWARD_STEP_DT = 0.2;
const FAST_FORWARD_STEPS_PER_FRAME = 120;
const CURVE_COLORS = {
  damage: '#ff875f',
  dps: '#f6c65b',
  range: '#6fd2ff',
  special: '#8be39f',
  cost: '#c5a8ff',
};

const visualEffects = [];

const terrainLayer = document.createElement('canvas');
terrainLayer.width = canvas.width;
terrainLayer.height = canvas.height;

const riverLayer = document.createElement('canvas');
riverLayer.width = canvas.width;
riverLayer.height = canvas.height;

function normToPx(p) {
  return { x: p.x * canvas.width, y: p.y * canvas.height };
}

function hashNoise(seed) {
  return (value) => {
    const x = Math.sin((value + seed * 0.37) * 127.1 + 91.7) * 43758.5453123;
    return x - Math.floor(x);
  };
}

function drawGrassTexture(target, seed) {
  const noise = hashNoise(seed);
  const g = target.createLinearGradient(0, 0, 0, canvas.height);
  g.addColorStop(0, '#5e8b44');
  g.addColorStop(0.48, '#4f7a38');
  g.addColorStop(1, '#3f652d');
  target.fillStyle = g;
  target.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 9800; i += 1) {
    const n = noise(i + 1);
    const x = (noise(i + 9) * canvas.width) | 0;
    const y = (noise(i + 13) * canvas.height) | 0;
    const size = 1 + noise(i + 71) * 2.8;
    const alpha = 0.05 + noise(i + 41) * 0.18;

    target.fillStyle = n > 0.62 ? `rgba(207,188,121,${alpha})` : `rgba(37,86,35,${alpha})`;
    target.fillRect(x, y, size, size);
  }

  for (let i = 0; i < 34; i += 1) {
    const cx = noise(i * 3 + 21) * canvas.width;
    const cy = noise(i * 7 + 51) * canvas.height;
    const rx = 30 + noise(i * 5 + 19) * 96;
    const ry = 20 + noise(i * 11 + 31) * 80;

    target.save();
    target.translate(cx, cy);
    target.rotate((noise(i * 23 + 77) - 0.5) * 1.1);
    const patch = target.createRadialGradient(0, 0, 5, 0, 0, rx);
    patch.addColorStop(0, 'rgba(218,196,130,0.24)');
    patch.addColorStop(0.75, 'rgba(172,148,88,0.14)');
    patch.addColorStop(1, 'rgba(120,96,58,0)');
    target.fillStyle = patch;
    target.beginPath();
    target.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    target.fill();
    target.restore();
  }
}

function drawRock(target, x, y, scale, tint) {
  const px = x * canvas.width;
  const py = y * canvas.height;

  target.save();
  target.translate(px, py);
  target.scale(scale, scale);

  target.fillStyle = 'rgba(18, 28, 20, 0.35)';
  target.beginPath();
  target.ellipse(0, 12, 17, 8, 0, 0, Math.PI * 2);
  target.fill();

  target.fillStyle = tint;
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

function drawTreeCluster(target, cluster, seed) {
  const noise = hashNoise(seed);
  const cx = cluster.x * canvas.width;
  const cy = cluster.y * canvas.height;
  const radius = cluster.r * Math.min(canvas.width, canvas.height);

  for (let i = 0; i < cluster.density; i += 1) {
    const a = noise(i * 17 + cx) * Math.PI * 2;
    const r = noise(i * 29 + cy) * radius;
    const tx = cx + Math.cos(a) * r;
    const ty = cy + Math.sin(a) * r * 0.82;
    const h = 10 + noise(i * 13 + r) * 15;

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

function traceRoute(target, waypoints) {
  const points = waypoints.map(normToPx);
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
  const map = game.mapConfig;
  target.clearRect(0, 0, canvas.width, canvas.height);
  target.save();
  target.lineCap = 'round';
  target.lineJoin = 'round';

  for (let i = 0; i < map.routes.length; i += 1) {
    const route = map.routes[i];
    const widthSkew = 1 + i * 0.04;
    target.strokeStyle = 'rgba(158, 147, 105, 0.86)';
    target.lineWidth = 78 * widthSkew;
    traceRoute(target, route.waypoints);
    target.stroke();
  }

  for (let i = 0; i < map.routes.length; i += 1) {
    const route = map.routes[i];
    const widthSkew = 1 + i * 0.03;
    const river = target.createLinearGradient(0, 0, 0, canvas.height);
    river.addColorStop(0, '#2a7cbe');
    river.addColorStop(0.5, '#19639a');
    river.addColorStop(1, '#2f87c6');
    target.strokeStyle = river;
    target.lineWidth = 60 * widthSkew;
    traceRoute(target, route.waypoints);
    target.stroke();

    target.strokeStyle = 'rgba(118,193,240,0.36)';
    target.lineWidth = 24 * widthSkew;
    traceRoute(target, route.waypoints);
    target.stroke();

    target.setLineDash([14, 16]);
    target.strokeStyle = 'rgba(230, 247, 255, 0.2)';
    target.lineWidth = 2.5;
    traceRoute(target, route.waypoints);
    target.stroke();
    target.setLineDash([]);
  }
  target.restore();
}

function buildStaticMapLayers() {
  const map = game.mapConfig;
  const seed = map.seed || 1;
  const terrain = terrainLayer.getContext('2d');
  terrain.clearRect(0, 0, canvas.width, canvas.height);
  drawGrassTexture(terrain, seed);

  const noise = hashNoise(seed + 33);
  const treeClusters = 5 + map.routes.length;
  for (let i = 0; i < treeClusters; i += 1) {
    drawTreeCluster(
      terrain,
      {
        x: 0.06 + noise(i * 7 + 1) * 0.88,
        y: 0.06 + noise(i * 11 + 2) * 0.88,
        r: 0.06 + noise(i * 13 + 9) * 0.06,
        density: 20 + Math.floor(noise(i * 17 + 3) * 22),
      },
      seed + i * 9
    );
  }

  const rockCount = 6 + map.routes.length * 3;
  for (let i = 0; i < rockCount; i += 1) {
    drawRock(
      terrain,
      0.06 + noise(i * 3 + 31) * 0.88,
      0.05 + noise(i * 5 + 41) * 0.9,
      0.75 + noise(i * 7 + 53) * 0.85,
      i % 2 === 0 ? '#6f736c' : '#666a64'
    );
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
      selectedCurveTowerId = tower.id;
      elCurveTower.value = selectedCurveTowerId;
      markCurveDirty();
      rebuildTowerButtons();
      updateSelectionText();
    });
    elTowerButtons.appendChild(btn);
  }
}

function rebuildMapSelect() {
  elMapSelect.innerHTML = '';
  for (const map of Object.values(MAPS)) {
    const option = document.createElement('option');
    option.value = map.mapId;
    option.textContent = `${map.name} (${map.waves.length} waves / ${map.fleetTarget} boats)`;
    elMapSelect.appendChild(option);
  }
  elMapSelect.value = game.mapId;
}

function updateMapMeta() {
  const map = game.mapConfig;
  elMapMeta.textContent = [
    `Routes: ${map.routes.length}`,
    `Waves: ${map.waves.length}`,
    `Fleet: ${map.fleetTarget}+ boats`,
    `Unlock XP: ${map.unlockRequirement.minXp}`,
    `Tower cap: ${CAMPAIGN_INFO.maxTowerLevel}`,
  ].join(' | ');
}

function markCurveDirty() {
  curveDirty = true;
}

function specialCurveValue(tower, levelCfg) {
  if (tower.effectType === 'bomb') return levelCfg.splashRadius || 0;
  if (tower.effectType === 'fire') return levelCfg.fireballDps || 0;
  if (tower.effectType === 'wind') return levelCfg.slowPercent || 0;
  if (tower.effectType === 'lightning') return levelCfg.chainCount || 0;
  return 0;
}

function specialCurveLabel(tower) {
  if (tower.effectType === 'bomb') return 'Splash Radius';
  if (tower.effectType === 'fire') return 'Fireball DPS';
  if (tower.effectType === 'wind') return 'Slow Percent';
  if (tower.effectType === 'lightning') return 'Chain Count';
  return 'Special';
}

function towerCurveData(towerId) {
  const tower = TOWER_CONFIG[towerId];
  const levels = tower.levels.map((_, index) => index + 1);
  const damage = tower.levels.map((levelCfg) => levelCfg.damage);
  const dps = tower.levels.map((levelCfg) => levelCfg.damage * levelCfg.attackSpeed);
  const range = tower.levels.map((levelCfg) => levelCfg.range);
  const special = tower.levels.map((levelCfg) => specialCurveValue(tower, levelCfg));
  const cost = tower.levels.map((levelCfg) => levelCfg.cost);
  return { tower, levels, damage, dps, range, special, cost };
}

function drawCurvePanel(panel, title) {
  curveCtx.strokeStyle = 'rgba(120, 164, 218, 0.3)';
  curveCtx.lineWidth = 1;
  curveCtx.strokeRect(panel.x, panel.y, panel.w, panel.h);

  curveCtx.fillStyle = '#c5d9f5';
  curveCtx.font = '12px "Segoe UI", sans-serif';
  curveCtx.fillText(title, panel.x, panel.y - 6);

  curveCtx.strokeStyle = 'rgba(120, 164, 218, 0.15)';
  for (let i = 1; i <= 4; i += 1) {
    const y = panel.y + (panel.h * i) / 4;
    curveCtx.beginPath();
    curveCtx.moveTo(panel.x, y);
    curveCtx.lineTo(panel.x + panel.w, y);
    curveCtx.stroke();
  }
}

function drawCurveSeries(panel, values, color, maxValue) {
  if (values.length < 2) return;
  const safeMax = maxValue > 0 ? maxValue : 1;
  curveCtx.strokeStyle = color;
  curveCtx.lineWidth = 2;
  curveCtx.beginPath();
  for (let i = 0; i < values.length; i += 1) {
    const x = panel.x + (panel.w * i) / (values.length - 1);
    const y = panel.y + panel.h - (Math.max(0, values[i]) / safeMax) * panel.h;
    if (i === 0) {
      curveCtx.moveTo(x, y);
    } else {
      curveCtx.lineTo(x, y);
    }
  }
  curveCtx.stroke();
}

function drawCurveLegend(entries, startX, y) {
  let x = startX;
  for (const entry of entries) {
    curveCtx.fillStyle = entry.color;
    curveCtx.fillRect(x, y - 8, 8, 8);
    curveCtx.fillStyle = '#d9e7ff';
    curveCtx.font = '11px "Segoe UI", sans-serif';
    curveCtx.fillText(entry.label, x + 12, y);
    x += 64;
  }
}

function updateCurveVisualization(force = false) {
  if (!force && !curveDirty) {
    return;
  }
  const towerId = selectedCurveTowerId in TOWER_CONFIG ? selectedCurveTowerId : selectedTowerId;
  const data = towerCurveData(towerId);
  const { tower, levels, damage, dps, range, special, cost } = data;

  curveCtx.clearRect(0, 0, curveCanvas.width, curveCanvas.height);
  curveCtx.fillStyle = '#0e1829';
  curveCtx.fillRect(0, 0, curveCanvas.width, curveCanvas.height);

  const topPanel = { x: 30, y: 24, w: 236, h: 84 };
  const bottomPanel = { x: 30, y: 136, w: 236, h: 62 };

  drawCurvePanel(topPanel, 'Capability Growth (normalized)');
  drawCurvePanel(bottomPanel, 'Cost Growth');

  drawCurveSeries(topPanel, damage, CURVE_COLORS.damage, Math.max(...damage));
  drawCurveSeries(topPanel, dps, CURVE_COLORS.dps, Math.max(...dps));
  drawCurveSeries(topPanel, range, CURVE_COLORS.range, Math.max(...range));
  drawCurveSeries(topPanel, special, CURVE_COLORS.special, Math.max(...special));

  const costMax = Math.max(...cost);
  drawCurveSeries(bottomPanel, cost, CURVE_COLORS.cost, costMax);
  curveCtx.fillStyle = '#c3d6f5';
  curveCtx.font = '10px "Segoe UI", sans-serif';
  curveCtx.fillText(`max ${Math.round(costMax)}`, bottomPanel.x + bottomPanel.w - 58, bottomPanel.y - 6);

  const tickIndices = [0, 9, 24, 49];
  curveCtx.fillStyle = '#9eb8dc';
  curveCtx.font = '10px "Segoe UI", sans-serif';
  for (const idx of tickIndices) {
    const x = bottomPanel.x + (bottomPanel.w * idx) / (levels.length - 1);
    curveCtx.beginPath();
    curveCtx.moveTo(x, bottomPanel.y + bottomPanel.h);
    curveCtx.lineTo(x, bottomPanel.y + bottomPanel.h + 4);
    curveCtx.strokeStyle = 'rgba(158, 184, 220, 0.6)';
    curveCtx.lineWidth = 1;
    curveCtx.stroke();
    curveCtx.fillText(`L${levels[idx]}`, x - 8, bottomPanel.y + bottomPanel.h + 16);
  }

  drawCurveLegend(
    [
      { label: 'Damage', color: CURVE_COLORS.damage },
      { label: 'DPS', color: CURVE_COLORS.dps },
      { label: 'Range', color: CURVE_COLORS.range },
      { label: 'Special', color: CURVE_COLORS.special },
    ],
    10,
    123
  );

  const sampleAt = (arr, level) => arr[level - 1];
  const specialLabel = specialCurveLabel(tower);
  elCurveSummary.textContent = [
    `${tower.name} curve snapshot`,
    `Cost L1/L25/L50: ${Math.round(sampleAt(cost, 1))} / ${Math.round(sampleAt(cost, 25))} / ${Math.round(sampleAt(cost, 50))}`,
    `Damage L1/L25/L50: ${Math.round(sampleAt(damage, 1))} / ${Math.round(sampleAt(damage, 25))} / ${Math.round(sampleAt(damage, 50))}`,
    `DPS L1/L25/L50: ${sampleAt(dps, 1).toFixed(1)} / ${sampleAt(dps, 25).toFixed(1)} / ${sampleAt(dps, 50).toFixed(1)}`,
    `${specialLabel} L1/L25/L50: ${sampleAt(special, 1)} / ${sampleAt(special, 25)} / ${sampleAt(special, 50)}`,
    'Scaling rule: keep tower curves stable; scale difficulty by fleet HP/speed/rewards.',
  ].join('\n');

  curveDirty = false;
}

function rebuildCurveTowerSelect() {
  elCurveTower.innerHTML = '';
  for (const tower of Object.values(TOWER_CONFIG)) {
    const option = document.createElement('option');
    option.value = tower.id;
    option.textContent = tower.name;
    elCurveTower.appendChild(option);
  }
  elCurveTower.value = selectedCurveTowerId;
  markCurveDirty();
}

function updateSelectionText() {
  const map = game.mapConfig;
  const slot = selectedSlotId ? map.buildSlots.find((candidate) => candidate.id === selectedSlotId) : null;
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
  let text = `${cfg.name} at ${slot.id}\nLevel ${tower.level}/${cfg.levels.length} | DMG ${levelCfg.damage} | RNG ${levelCfg.range}`;
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
  elMapName.textContent = snap.mapName;
  elCoins.textContent = String(snap.coins);
  elXp.textContent = String(snap.xp);
  elWave.textContent = `${Math.max(snap.wave, 0)}/${snap.totalWaves}`;
  elBoatsLeft.textContent = String(snap.boatsLeft);
  elState.textContent = snap.state;

  if (snap.result) {
    if (snap.result.victory) {
      elResult.innerHTML = `Victory on ${snap.mapName}. Next unlock reached: <strong>${snap.result.nextMapUnlocked ? 'Yes' : 'No'}</strong>`;
    } else {
      elResult.textContent = `Defeat on ${snap.mapName}. Coins dropped below zero.`;
    }
  } else {
    elResult.textContent = 'In progress.';
  }

  btnStartWave.disabled = !['build_phase', 'wave_result'].includes(game.state);
  btnToggleSpeed.textContent = `Speed ${game.speed}x`;
  btnFastForwardWave.textContent = fastForwardUntilMs > 0 ? 'Fast 1s Fleet Run (Active)' : 'Fast 1s Fleet Run';
  btnToggleAutoContinue.textContent = `Auto Continue: ${autoContinueEnabled ? 'On' : 'Off'}`;
  updateSelectionText();
  updateCurveVisualization();
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

  ctx.fillStyle = tower ? 'rgba(14,26,18,0.40)' : 'rgba(31,57,29,0.32)';
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
  const h = 22 + Math.min(44, tower.level * 1.7);

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

  ctx.fillStyle = '#20314c';
  ctx.font = 'bold 10px monospace';
  ctx.fillText(String(tower.level), -8, 3);

  ctx.restore();
}

function drawSlotsAndTowers() {
  for (const slot of game.mapConfig.buildSlots) {
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
    const radius = (zone.radius / WORLD_SCALE) * canvas.width;
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

function boatProfile(enemyType) {
  if (enemyType === 'scout') {
    return {
      hull: '#4f7c36',
      sail: '#dee9c8',
      trim: '#99bf6f',
      pennant: '#284d18',
      size: 0.86,
    };
  }
  if (enemyType === 'raider') {
    return {
      hull: '#8a5c2b',
      sail: '#f0e8d0',
      trim: '#d5a765',
      pennant: '#8a2323',
      size: 1.0,
    };
  }
  if (enemyType === 'juggernaut') {
    return {
      hull: '#4d2020',
      sail: '#d4b696',
      trim: '#a56f57',
      pennant: '#f0b13a',
      size: 1.42,
    };
  }
  return {
    hull: '#6b2b2b',
    sail: '#f2cba8',
    trim: '#9a4f41',
    pennant: '#e0a130',
    size: 1.18,
  };
}

function drawBoat(enemy, p, angle) {
  const profile = boatProfile(enemy.enemyType);
  const bob = Math.sin(simTime * 3.2 + enemy.distance * 0.13) * 1.3;

  ctx.save();
  ctx.translate(p.x, p.y + bob);
  ctx.rotate(angle);
  ctx.scale(profile.size, profile.size);

  ctx.fillStyle = 'rgba(16, 36, 60, 0.25)';
  ctx.beginPath();
  ctx.ellipse(-9, 11, 18, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(227, 248, 255, 0.2)';
  ctx.beginPath();
  ctx.ellipse(-15, 8, 6, 2, 0, 0, Math.PI * 2);
  ctx.ellipse(-20, 10, 4, 1.4, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = profile.hull;
  ctx.beginPath();
  ctx.moveTo(14, 0);
  ctx.lineTo(-12, -7);
  ctx.lineTo(-21, 0);
  ctx.lineTo(-12, 7);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = profile.trim;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(11, -0.8);
  ctx.lineTo(-14, -5.5);
  ctx.moveTo(11, 0.8);
  ctx.lineTo(-14, 5.5);
  ctx.stroke();

  ctx.fillStyle = '#302315';
  ctx.fillRect(-7.5, -9, 2.6, 18);
  ctx.fillRect(-1.5, -6.5, 1.8, 14);

  ctx.fillStyle = profile.sail;
  ctx.beginPath();
  ctx.moveTo(-5.5, -8);
  ctx.lineTo(7.5, -2.6);
  ctx.lineTo(-5.5, 2.6);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = 'rgba(252,247,232,0.78)';
  ctx.beginPath();
  ctx.moveTo(0.6, -6.1);
  ctx.lineTo(7, -3.6);
  ctx.lineTo(0.6, -1.2);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = profile.pennant;
  ctx.fillRect(2, -3, 5, 4);

  ctx.restore();
}

function drawEnemies() {
  for (const enemy of game.enemies) {
    const p = normToPx(getEnemyPosition(game, enemy));
    const backPosition = getEnemyPosition(game, {
      ...enemy,
      distance: Math.max(0, enemy.distance - 0.18),
    });
    const backP = normToPx(backPosition);
    const angle = Math.atan2(p.y - backP.y, p.x - backP.x);

    drawBoat(enemy, p, angle);

    const hpRatio = Math.max(0, enemy.hp / enemy.maxHp);
    ctx.fillStyle = 'rgba(7, 16, 22, 0.78)';
    ctx.fillRect(p.x - 18, p.y - 22, 36, 5);
    ctx.fillStyle = hpRatio > 0.45 ? '#35d06d' : '#f59e0b';
    ctx.fillRect(p.x - 18, p.y - 22, 36 * hpRatio, 5);
  }
}

function createLightningPoints(from, to) {
  const points = [{ ...from }];
  const segments = 5;
  for (let i = 1; i < segments; i += 1) {
    const t = i / segments;
    const mx = from.x + (to.x - from.x) * t + (Math.random() * 20 - 10);
    const my = from.y + (to.y - from.y) * t + (Math.random() * 16 - 8);
    points.push({ x: mx, y: my });
  }
  points.push({ ...to });
  return points;
}

function pushVisualEffect(effect) {
  visualEffects.push(effect);
  if (visualEffects.length > EFFECT_LIMIT) {
    visualEffects.shift();
  }
}

function ingestAttackVisuals() {
  for (const attack of game.lastAttacks) {
    const from = normToPx(attack.from);
    const to = normToPx(attack.to);
    if (attack.effectType === 'fire') {
      pushVisualEffect({ kind: 'fireball', from, to, ttl: 0.32, life: 0.32 });
      continue;
    }
    if (attack.effectType === 'bomb') {
      pushVisualEffect({ kind: 'bomb', from, to, ttl: 0.44, life: 0.44 });
      continue;
    }
    if (attack.effectType === 'wind') {
      pushVisualEffect({ kind: 'wind', from, to, ttl: 0.34, life: 0.34 });
      continue;
    }
    if (attack.effectType === 'lightning') {
      pushVisualEffect({
        kind: 'lightning',
        points: createLightningPoints(from, to),
        ttl: 0.12,
        life: 0.12,
      });
      continue;
    }
    pushVisualEffect({ kind: 'arrow', from, to, ttl: 0.2, life: 0.2 });
  }
}

function updateVisualEffects(dt) {
  for (const effect of visualEffects) {
    effect.ttl -= dt;
  }
  while (visualEffects.length && visualEffects[0].ttl <= 0) {
    visualEffects.shift();
  }
}

function drawVisualEffects() {
  for (const effect of visualEffects) {
    const progress = 1 - effect.ttl / effect.life;
    const alpha = Math.max(0, Math.min(1, effect.ttl / effect.life));

    if (effect.kind === 'arrow') {
      const x = effect.from.x + (effect.to.x - effect.from.x) * progress;
      const y = effect.from.y + (effect.to.y - effect.from.y) * progress;
      ctx.strokeStyle = `rgba(245,231,190,${alpha})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(effect.from.x, effect.from.y);
      ctx.lineTo(x, y);
      ctx.stroke();

      ctx.fillStyle = `rgba(251,242,214,${alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }

    if (effect.kind === 'fireball') {
      const arcHeight = -26 * (1 - Math.abs(0.5 - progress) * 2);
      const x = effect.from.x + (effect.to.x - effect.from.x) * progress;
      const y = effect.from.y + (effect.to.y - effect.from.y) * progress + arcHeight;

      ctx.fillStyle = `rgba(255,146,74,${alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, 6 - progress * 1.6, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = `rgba(255,225,120,${alpha * 0.8})`;
      ctx.beginPath();
      ctx.arc(x, y, 2.2, 0, Math.PI * 2);
      ctx.fill();

      const blast = 22 * progress;
      ctx.strokeStyle = `rgba(255,118,62,${(1 - progress) * 0.56})`;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(effect.to.x, effect.to.y, blast, 0, Math.PI * 2);
      ctx.stroke();
      continue;
    }

    if (effect.kind === 'bomb') {
      const x = effect.from.x + (effect.to.x - effect.from.x) * progress;
      const y = effect.from.y + (effect.to.y - effect.from.y) * progress - 18 * (1 - Math.abs(0.5 - progress) * 2);

      ctx.fillStyle = `rgba(204,130,67,${alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();

      const ring = 34 * progress;
      ctx.strokeStyle = `rgba(255,182,91,${(1 - progress) * 0.66})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(effect.to.x, effect.to.y, ring, 0, Math.PI * 2);
      ctx.stroke();
      continue;
    }

    if (effect.kind === 'wind') {
      ctx.strokeStyle = `rgba(164,244,255,${alpha * 0.86})`;
      ctx.lineWidth = 2.2;
      ctx.setLineDash([8, 5]);
      ctx.beginPath();
      const cx = (effect.from.x + effect.to.x) * 0.5;
      const cy = (effect.from.y + effect.to.y) * 0.5 - 8;
      ctx.moveTo(effect.from.x, effect.from.y);
      ctx.quadraticCurveTo(cx, cy, effect.to.x, effect.to.y);
      ctx.stroke();
      ctx.setLineDash([]);
      continue;
    }

    if (effect.kind === 'lightning') {
      ctx.save();
      ctx.strokeStyle = `rgba(255,228,121,${alpha})`;
      ctx.shadowColor = 'rgba(255,228,121,0.65)';
      ctx.shadowBlur = 9;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(effect.points[0].x, effect.points[0].y);
      for (let i = 1; i < effect.points.length; i += 1) {
        ctx.lineTo(effect.points[i].x, effect.points[i].y);
      }
      ctx.stroke();
      ctx.restore();
    }
  }
}

function drawWaveBanner() {
  if (game.state !== 'wave_running') {
    return;
  }

  const wave = game.waves[game.waveIndex];
  const x = canvas.width * 0.5 - 190;
  const y = 15;

  const band = ctx.createLinearGradient(0, y, 0, y + 46);
  band.addColorStop(0, 'rgba(26,37,51,0.84)');
  band.addColorStop(1, 'rgba(13,22,32,0.84)');

  ctx.fillStyle = band;
  ctx.strokeStyle = 'rgba(176, 205, 227, 0.35)';
  ctx.lineWidth = 1;
  ctx.fillRect(x, y, 380, 46);
  ctx.strokeRect(x, y, 380, 46);

  ctx.fillStyle = '#e7f2ff';
  ctx.font = 'bold 19px "Trebuchet MS", sans-serif';
  ctx.fillText(`${game.mapConfig.name}  |  Wave ${wave.id}/${game.waves.length}`, x + 18, y + 29);
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawMapBase();
  drawFireZones();
  drawSlotsAndTowers();
  drawEnemies();
  drawVisualEffects();
  drawWaveBanner();
}

function gameLoop(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.06);
  lastTime = now;
  handleAutoContinue();

  const fastForwardActive = fastForwardUntilMs > 0 && game.state === 'wave_running';
  if (fastForwardActive) {
    for (let i = 0; i < FAST_FORWARD_STEPS_PER_FRAME && game.state === 'wave_running'; i += 1) {
      game.tick(FAST_FORWARD_STEP_DT);
    }
    simTime += FAST_FORWARD_STEP_DT * FAST_FORWARD_STEPS_PER_FRAME;
    visualEffects.length = 0;
    if (game.state !== 'wave_running' || now >= fastForwardUntilMs) {
      fastForwardUntilMs = 0;
    }
  } else {
    simTime += dt;
    if (fastForwardUntilMs > 0 && game.state !== 'wave_running') {
      fastForwardUntilMs = 0;
    }
    game.tick(dt);
    ingestAttackVisuals();
    updateVisualEffects(dt);
  }

  render();
  updateHud();

  requestAnimationFrame(gameLoop);
}

function pickSlotFromMouse(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * canvas.width;
  const y = ((clientY - rect.top) / rect.height) * canvas.height;

  for (const slot of game.mapConfig.buildSlots) {
    const p = normToPx(slot);
    if (Math.hypot(x - p.x, y - p.y) <= SLOT_RADIUS + 6) {
      return slot;
    }
  }
  return null;
}

function loadSelectedMap() {
  game.setMap(elMapSelect.value);
  selectedSlotId = null;
  fastForwardUntilMs = 0;
  buildStaticMapLayers();
  updateMapMeta();
  updateHud();
}

function triggerFastForwardWave() {
  if (['build_phase', 'wave_result'].includes(game.state)) {
    game.startNextWave();
  }
  if (game.state !== 'wave_running') {
    fastForwardUntilMs = 0;
    return;
  }
  fastForwardUntilMs = performance.now() + 1000;
}

function maybeAutoAdvanceMap() {
  if (game.state !== 'map_result' || !game.result?.victory) {
    return;
  }
  const nextMapId = game.getNextMapId();
  if (!nextMapId || !game.result.nextMapUnlocked) {
    return;
  }
  game.setMap(nextMapId, { carryResources: true });
  selectedSlotId = null;
  visualEffects.length = 0;
  fastForwardUntilMs = 0;
  elMapSelect.value = game.mapId;
  buildStaticMapLayers();
  updateMapMeta();
}

function handleAutoContinue() {
  if (!autoContinueEnabled) {
    return;
  }
  if (game.state === 'map_result') {
    maybeAutoAdvanceMap();
    return;
  }
  if (['build_phase', 'wave_result'].includes(game.state)) {
    game.startNextWave();
  }
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

btnFastForwardWave.addEventListener('click', () => {
  triggerFastForwardWave();
  updateHud();
});

btnToggleAutoContinue.addEventListener('click', () => {
  autoContinueEnabled = !autoContinueEnabled;
  handleAutoContinue();
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
  visualEffects.length = 0;
  fastForwardUntilMs = 0;
  updateHud();
});

btnLoadMap.addEventListener('click', loadSelectedMap);

elMapSelect.addEventListener('change', updateMapMeta);
elCurveTower.addEventListener('change', () => {
  selectedCurveTowerId = elCurveTower.value;
  markCurveDirty();
  updateCurveVisualization(true);
});

rebuildMapSelect();
rebuildTowerButtons();
rebuildCurveTowerSelect();
buildStaticMapLayers();
updateMapMeta();
updateHud();
requestAnimationFrame(gameLoop);
