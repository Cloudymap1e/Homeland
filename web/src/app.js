import { HomelandGame, getEnemyPosition } from './game-core.js';
import {
  MAPS,
  DEFAULT_MAP_ID,
  TOWER_CONFIG,
  CAMPAIGN_INFO,
  CAMPAIGN_PASS_CRITERIA,
} from './config.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const elResult = document.getElementById('result');
const elMapSelect = document.getElementById('map-select');
const elMapMeta = document.getElementById('map-meta');
const elCoinsOverlay = document.getElementById('coins-overlay');
const elXpOverlay = document.getElementById('xp-overlay');
const elMapOverlay = document.getElementById('map-overlay');
const elWaveOverlay = document.getElementById('wave-overlay');
const elBoatsOverlay = document.getElementById('boats-overlay');
const elStateOverlay = document.getElementById('state-overlay');
const elCurveTower = document.getElementById('curve-tower');
const curveCanvas = document.getElementById('curve-chart');
const curveCtx = curveCanvas.getContext('2d');
const elCurveSummary = document.getElementById('curve-summary');
const elSlotPopout = document.getElementById('slot-popout');
const elResultWindow = document.getElementById('result-window');
const elCurveWindow = document.getElementById('curve-window');
const elResultHandle = document.getElementById('result-handle');
const elCurveHandle = document.getElementById('curve-handle');

const btnStartWave = document.getElementById('start-wave');
const btnToggleSpeed = document.getElementById('toggle-speed');
const btnFastForwardWave = document.getElementById('fast-forward-wave');
const btnToggleAutoContinue = document.getElementById('toggle-auto-continue');
const btnToggleReportPanel = document.getElementById('toggle-report-panel');
const btnToggleCurvePanel = document.getElementById('toggle-curve-panel');
const btnHideReportPanel = document.getElementById('hide-report-panel');
const btnHideCurvePanel = document.getElementById('hide-curve-panel');
const btnLoadMap = document.getElementById('load-map');

const game = new HomelandGame({ mapId: DEFAULT_MAP_ID });
let selectedTowerId = 'arrow';
let selectedCurveTowerId = 'arrow';
let selectedSlotId = null;
let rangePreviewTowerId = null;
let lastTime = performance.now();
let simTime = 0;
let autoContinueEnabled = false;
let fastForwardUntilMs = 0;
let curveDirty = true;
let slotPopoutNotice = '';
let slotPopoutRenderKey = '';
let reportPanelVisible = true;
let curvePanelVisible = true;
let mapSelectRenderKey = '';

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
const STATE_LABELS = {
  build_phase: 'Build',
  wave_running: 'Wave Live',
  wave_result: 'Wave Clear',
  map_result: 'Map Result',
};
const TOWER_RANGE_COLORS = {
  arrow: { fill: [245, 214, 131], edge: [252, 235, 171] },
  bone: { fill: [243, 171, 97], edge: [253, 205, 152] },
  magic_fire: { fill: [255, 124, 88], edge: [255, 188, 156] },
  magic_wind: { fill: [137, 235, 255], edge: [199, 244, 255] },
  magic_lightning: { fill: [255, 215, 109], edge: [255, 237, 162] },
};
const PROGRESS_ENDPOINT = '/api/progress';
const LOCAL_PROGRESS_KEY = 'homeland_progress_v1';
const SAVE_DEBOUNCE_MS = 420;
const PERIODIC_SAVE_MS = 1500;
const PERSISTENCE_VERSION = 1;

const visualEffects = [];
let persistenceReady = false;
let persistTimerId = null;
let lastPersistedFingerprint = '';
let nextPeriodicPersistAt = 0;
let persistQueue = Promise.resolve();

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
  g.addColorStop(0, '#5f8f46');
  g.addColorStop(0.42, '#4f7c38');
  g.addColorStop(1, '#3c612b');
  target.fillStyle = g;
  target.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 12800; i += 1) {
    const n = noise(i + 1);
    const x = (noise(i + 9) * canvas.width) | 0;
    const y = (noise(i + 13) * canvas.height) | 0;
    const size = 0.8 + noise(i + 71) * 2.4;
    const alpha = 0.04 + noise(i + 41) * 0.17;

    target.fillStyle = n > 0.62 ? `rgba(207,188,121,${alpha})` : `rgba(37,86,35,${alpha})`;
    target.fillRect(x, y, size, size);
  }

  for (let i = 0; i < 3400; i += 1) {
    const x = noise(i * 5 + 120) * canvas.width;
    const y = noise(i * 7 + 171) * canvas.height;
    const len = 2.2 + noise(i * 11 + 211) * 5.6;
    const angle = (noise(i * 13 + 271) - 0.5) * 1.45;
    const sway = (noise(i * 17 + 307) - 0.5) * 1.8;
    target.strokeStyle = `rgba(96,136,72,${0.05 + noise(i * 19 + 353) * 0.12})`;
    target.lineWidth = 0.6 + noise(i * 23 + 401) * 0.85;
    target.beginPath();
    target.moveTo(x, y);
    target.lineTo(x + Math.cos(angle) * len + sway, y - Math.sin(angle) * len);
    target.stroke();
  }

  for (let i = 0; i < 46; i += 1) {
    const cx = noise(i * 3 + 21) * canvas.width;
    const cy = noise(i * 7 + 51) * canvas.height;
    const rx = 42 + noise(i * 5 + 19) * 126;
    const ry = 24 + noise(i * 11 + 31) * 92;

    target.save();
    target.translate(cx, cy);
    target.rotate((noise(i * 23 + 77) - 0.5) * 1.1);
    const patch = target.createRadialGradient(0, 0, 8, 0, 0, rx);
    patch.addColorStop(0, 'rgba(218,196,130,0.23)');
    patch.addColorStop(0.72, 'rgba(172,148,88,0.12)');
    patch.addColorStop(1, 'rgba(120,96,58,0)');
    target.fillStyle = patch;
    target.beginPath();
    target.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    target.fill();
    target.restore();
  }

  for (let i = 0; i < 480; i += 1) {
    const x = noise(i * 29 + 612) * canvas.width;
    const y = noise(i * 31 + 641) * canvas.height;
    const size = 0.9 + noise(i * 37 + 673) * 1.7;
    target.fillStyle = i % 5 === 0 ? 'rgba(233,213,143,0.23)' : 'rgba(165,204,122,0.16)';
    target.beginPath();
    target.arc(x, y, size, 0, Math.PI * 2);
    target.fill();
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
  const visual = map.riverVisual || {};
  const bankWidth = Number.isFinite(visual.bankWidth) ? visual.bankWidth : 56;
  const waterWidth = Number.isFinite(visual.waterWidth) ? visual.waterWidth : 40;
  const highlightWidth = Number.isFinite(visual.highlightWidth) ? visual.highlightWidth : 13;
  const laneDashWidth = Number.isFinite(visual.laneDashWidth) ? visual.laneDashWidth : 2.1;
  target.clearRect(0, 0, canvas.width, canvas.height);
  target.save();
  target.lineCap = 'round';
  target.lineJoin = 'round';

  for (let i = 0; i < map.routes.length; i += 1) {
    const route = map.routes[i];
    const widthSkew = 1 + i * 0.02;
    target.strokeStyle = 'rgba(150, 138, 95, 0.82)';
    target.lineWidth = bankWidth * widthSkew;
    traceRoute(target, route.waypoints);
    target.stroke();

    target.strokeStyle = 'rgba(119, 108, 69, 0.32)';
    target.lineWidth = Math.max(1, (bankWidth - 10) * widthSkew);
    traceRoute(target, route.waypoints);
    target.stroke();
  }

  for (let i = 0; i < map.routes.length; i += 1) {
    const route = map.routes[i];
    const widthSkew = 1 + i * 0.018;
    const river = target.createLinearGradient(0, 0, 0, canvas.height);
    river.addColorStop(0, '#2f87c7');
    river.addColorStop(0.52, '#1a649d');
    river.addColorStop(1, '#3b95ce');
    target.strokeStyle = river;
    target.lineWidth = waterWidth * widthSkew;
    traceRoute(target, route.waypoints);
    target.stroke();

    target.strokeStyle = 'rgba(26, 104, 164, 0.28)';
    target.lineWidth = Math.max(1, waterWidth * 0.62 * widthSkew);
    traceRoute(target, route.waypoints);
    target.stroke();

    target.strokeStyle = 'rgba(138,206,245,0.38)';
    target.lineWidth = highlightWidth * widthSkew;
    traceRoute(target, route.waypoints);
    target.stroke();

    target.setLineDash([12, 14]);
    target.strokeStyle = 'rgba(230, 247, 255, 0.2)';
    target.lineWidth = laneDashWidth;
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

function resizeCanvasToViewport() {
  const nextWidth = Math.max(320, Math.floor(window.innerWidth));
  const nextHeight = Math.max(320, Math.floor(window.innerHeight));
  if (canvas.width === nextWidth && canvas.height === nextHeight) {
    return;
  }
  canvas.width = nextWidth;
  canvas.height = nextHeight;
  terrainLayer.width = nextWidth;
  terrainLayer.height = nextHeight;
  riverLayer.width = nextWidth;
  riverLayer.height = nextHeight;
  buildStaticMapLayers();
  refreshSlotPopout();
}

function updatePanelButtons() {
  btnToggleReportPanel.textContent = reportPanelVisible ? 'Hide Report' : 'Show Report';
  btnToggleCurvePanel.textContent = curvePanelVisible ? 'Hide Curves' : 'Show Curves';
  btnToggleReportPanel.classList.toggle('active', reportPanelVisible);
  btnToggleCurvePanel.classList.toggle('active', curvePanelVisible);
}

function setPanelVisibility(panelId, visible) {
  if (panelId === 'report') {
    reportPanelVisible = visible;
    elResultWindow.classList.toggle('hidden-window', !visible);
  } else if (panelId === 'curve') {
    curvePanelVisible = visible;
    elCurveWindow.classList.toggle('hidden-window', !visible);
  }
  updatePanelButtons();
}

function makeWindowDraggable(windowEl, handleEl) {
  let dragState = null;

  const stopDrag = (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }
    handleEl.releasePointerCapture(event.pointerId);
    windowEl.classList.remove('dragging');
    dragState = null;
  };

  handleEl.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      return;
    }
    if (event.target.closest('button, select, input')) {
      return;
    }

    const rect = windowEl.getBoundingClientRect();
    windowEl.style.left = `${Math.round(rect.left)}px`;
    windowEl.style.top = `${Math.round(rect.top)}px`;
    windowEl.style.right = 'auto';
    windowEl.style.bottom = 'auto';

    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originLeft: rect.left,
      originTop: rect.top,
    };
    handleEl.setPointerCapture(event.pointerId);
    windowEl.classList.add('dragging');
    event.preventDefault();
  });

  handleEl.addEventListener('pointermove', (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }
    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    const maxLeft = Math.max(0, window.innerWidth - windowEl.offsetWidth);
    const maxTop = Math.max(0, window.innerHeight - windowEl.offsetHeight);
    const left = Math.max(0, Math.min(maxLeft, dragState.originLeft + dx));
    const top = Math.max(0, Math.min(maxTop, dragState.originTop + dy));
    windowEl.style.left = `${Math.round(left)}px`;
    windowEl.style.top = `${Math.round(top)}px`;
  });

  handleEl.addEventListener('pointerup', stopDrag);
  handleEl.addEventListener('pointercancel', stopDrag);
}

function clampHudWindowsToViewport() {
  for (const windowEl of [elResultWindow, elCurveWindow]) {
    if (windowEl.classList.contains('hidden-window')) {
      continue;
    }
    if (!windowEl.style.left || !windowEl.style.top) {
      continue;
    }
    const maxLeft = Math.max(0, window.innerWidth - windowEl.offsetWidth);
    const maxTop = Math.max(0, window.innerHeight - windowEl.offsetHeight);
    const left = Math.max(0, Math.min(maxLeft, Number.parseFloat(windowEl.style.left)));
    const top = Math.max(0, Math.min(maxTop, Number.parseFloat(windowEl.style.top)));
    windowEl.style.left = `${Math.round(left)}px`;
    windowEl.style.top = `${Math.round(top)}px`;
  }
}

function mapSelectKey() {
  return [
    game.mapId,
    game.getUnlockedMapIds().join(','),
    game.getCompletedMapIds().join(','),
  ].join('|');
}

function rebuildMapSelect() {
  const nextKey = mapSelectKey();
  if (nextKey === mapSelectRenderKey && elMapSelect.options.length === Object.keys(MAPS).length) {
    return;
  }
  const previousValue = elMapSelect.value || game.mapId;
  const unlockedSet = new Set(game.getUnlockedMapIds());
  const completedSet = new Set(game.getCompletedMapIds());
  elMapSelect.innerHTML = '';
  for (const map of Object.values(MAPS)) {
    const unlocked = unlockedSet.has(map.mapId);
    const completed = completedSet.has(map.mapId);
    const status = completed ? 'Cleared' : unlocked ? 'Open' : 'Locked';
    const option = document.createElement('option');
    option.value = map.mapId;
    option.disabled = !unlocked;
    option.textContent = `${map.name} (${map.waves.length} waves / ${map.fleetTarget} boats) [${status}]`;
    elMapSelect.appendChild(option);
  }
  const fallback = unlockedSet.has(previousValue) ? previousValue : game.mapId;
  elMapSelect.value = fallback;
  mapSelectRenderKey = nextKey;
}

function updateMapMeta() {
  const map = game.mapConfig;
  const mapIndex = Math.max(0, Object.keys(MAPS).indexOf(map.mapId));
  const passCriteria = map.passCriteria || {
    unlockRunsTarget:
      CAMPAIGN_PASS_CRITERIA.unlockRunsByMapIndex[
        Math.min(mapIndex, CAMPAIGN_PASS_CRITERIA.unlockRunsByMapIndex.length - 1)
      ],
    failRunPenaltyEquivalent: CAMPAIGN_PASS_CRITERIA.failRunPenaltyEquivalent,
    retentionProbeRuns: CAMPAIGN_PASS_CRITERIA.retentionProbeRuns,
    passRateProbeRuns: CAMPAIGN_PASS_CRITERIA.passRateProbeRuns,
    mcPassRateTarget:
      CAMPAIGN_PASS_CRITERIA.mcPassRateByMapIndex[
        Math.min(mapIndex, CAMPAIGN_PASS_CRITERIA.mcPassRateByMapIndex.length - 1)
      ],
  };
  const unlockText = map.unlockRequirement?.nextMap
    ? `Unlock XP: ${map.unlockRequirement.minXp}`
    : 'Final map';
  const slotFee = Number(map.slotActivationCost) || 0;
  const clearReward = Number(map.mapClearReward?.coins) || 0;
  const passRateTarget = Number(passCriteria.mcPassRateTarget) || 0;
  const passRateTargetPct = Math.round(passRateTarget * 100);
  elMapMeta.textContent = [
    `Routes: ${map.routes.length}`,
    `Waves: ${map.waves.length}`,
    `Fleet: ${map.fleetTarget}+ boats`,
    `Slot unlock: ${formatNumber(slotFee)}c`,
    `Clear reward: +${formatNumber(clearReward)}c`,
    `Pass standard: ${formatNumber(passCriteria.unlockRunsTarget)} runs @ ${passRateTargetPct}% MC`,
    `Fail penalty: ~${passCriteria.failRunPenaltyEquivalent} run XP`,
    `MC probes: ${passCriteria.retentionProbeRuns}/${passCriteria.passRateProbeRuns}`,
    unlockText,
    `Tower cap: ${CAMPAIGN_INFO.maxTowerLevel}`,
  ].join(' | ');
}

function formatNumber(value) {
  return Number(value).toLocaleString('en-US');
}

function stateLabel(stateId) {
  return STATE_LABELS[stateId] || stateId;
}

function readLocalProgress() {
  try {
    const raw = localStorage.getItem(LOCAL_PROGRESS_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeLocalProgress(payload) {
  try {
    localStorage.setItem(LOCAL_PROGRESS_KEY, JSON.stringify(payload));
  } catch {
    // Ignore local storage failures (private mode/quota).
  }
}

function createProgressPayload() {
  return {
    version: PERSISTENCE_VERSION,
    updatedAt: Date.now(),
    autoContinueEnabled,
    selectedTowerId,
    selectedCurveTowerId,
    reportPanelVisible,
    curvePanelVisible,
    game: game.exportState(),
  };
}

function createProgressFingerprint(payload) {
  const stable = {
    autoContinueEnabled: payload.autoContinueEnabled,
    selectedTowerId: payload.selectedTowerId,
    selectedCurveTowerId: payload.selectedCurveTowerId,
    reportPanelVisible: payload.reportPanelVisible,
    curvePanelVisible: payload.curvePanelVisible,
    game: payload.game,
  };
  return JSON.stringify(stable);
}

async function fetchServerProgress() {
  try {
    const response = await fetch(PROGRESS_ENDPOINT, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (!response.ok) {
      return null;
    }
    const body = await response.json();
    if (!body || typeof body !== 'object') {
      return null;
    }
    return body.progress && typeof body.progress === 'object' ? body.progress : null;
  } catch {
    return null;
  }
}

async function persistServerProgress(payload, keepalive = false) {
  const response = await fetch(PROGRESS_ENDPOINT, {
    method: 'PUT',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    keepalive,
    body: JSON.stringify(payload),
  });
  return response.ok;
}

function applyPersistedProgress(payload) {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  if (!payload.game || typeof payload.game !== 'object') {
    return false;
  }
  const imported = game.importState(payload.game);
  if (!imported) {
    return false;
  }

  if (typeof payload.selectedTowerId === 'string' && payload.selectedTowerId in TOWER_CONFIG) {
    selectedTowerId = payload.selectedTowerId;
  }
  if (typeof payload.selectedCurveTowerId === 'string' && payload.selectedCurveTowerId in TOWER_CONFIG) {
    selectedCurveTowerId = payload.selectedCurveTowerId;
  }
  autoContinueEnabled = Boolean(payload.autoContinueEnabled);
  reportPanelVisible = payload.reportPanelVisible !== false;
  curvePanelVisible = payload.curvePanelVisible !== false;

  selectedSlotId = null;
  slotPopoutNotice = '';
  rangePreviewTowerId = null;
  closeSlotPopout();
  visualEffects.length = 0;
  fastForwardUntilMs = 0;
  simTime = 0;
  lastTime = performance.now();

  rebuildMapSelect();
  elMapSelect.value = game.mapId;
  elCurveTower.value = selectedCurveTowerId;
  markCurveDirty();
  setPanelVisibility('report', reportPanelVisible);
  setPanelVisibility('curve', curvePanelVisible);
  buildStaticMapLayers();
  updateMapMeta();
  updateHud();
  return true;
}

function pickNewestProgress(remote, local) {
  const remoteTs = Number(remote?.updatedAt) || 0;
  const localTs = Number(local?.updatedAt) || 0;
  if (!remote && !local) {
    return null;
  }
  if (!remote) {
    return local;
  }
  if (!local) {
    return remote;
  }
  return remoteTs >= localTs ? remote : local;
}

async function hydrateProgress() {
  const [remote, local] = await Promise.all([fetchServerProgress(), Promise.resolve(readLocalProgress())]);
  const payload = pickNewestProgress(remote, local);
  if (!payload) {
    return;
  }
  if (!applyPersistedProgress(payload)) {
    return;
  }
  const fingerprint = createProgressFingerprint(payload);
  lastPersistedFingerprint = fingerprint;
}

async function persistProgressNow(keepalive = false) {
  const payload = createProgressPayload();
  const fingerprint = createProgressFingerprint(payload);
  if (fingerprint === lastPersistedFingerprint) {
    return;
  }

  writeLocalProgress(payload);
  try {
    await persistServerProgress(payload, keepalive);
    lastPersistedFingerprint = fingerprint;
  } catch {
    // Keep local backup if network persistence is unavailable.
  }
}

function queueProgressPersist(keepalive = false) {
  if (!persistenceReady) {
    return;
  }
  persistQueue = persistQueue
    .then(() => persistProgressNow(keepalive))
    .catch(() => {});
}

function scheduleProgressPersist() {
  if (!persistenceReady || persistTimerId !== null) {
    return;
  }
  persistTimerId = window.setTimeout(() => {
    persistTimerId = null;
    queueProgressPersist(false);
  }, SAVE_DEBOUNCE_MS);
}

function flushProgressOnUnload() {
  if (!persistenceReady) {
    return;
  }
  const payload = createProgressPayload();
  writeLocalProgress(payload);
  const body = JSON.stringify(payload);
  if (navigator.sendBeacon) {
    const blob = new Blob([body], { type: 'application/json' });
    navigator.sendBeacon(PROGRESS_ENDPOINT, blob);
    return;
  }
  fetch(PROGRESS_ENDPOINT, {
    method: 'POST',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    keepalive: true,
    body,
  }).catch(() => {});
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

function canModifyTowers() {
  return ['build_phase', 'wave_running', 'wave_result'].includes(game.state);
}

function closeSlotPopout() {
  rangePreviewTowerId = null;
  elSlotPopout.classList.add('hidden');
  elSlotPopout.innerHTML = '';
  slotPopoutRenderKey = '';
}

function slotSpecialLines(cfg, levelCfg) {
  if (cfg.effectType === 'wind') {
    return [
      `Slow: ${levelCfg.slowPercent}% for ${levelCfg.slowDuration}s`,
      `Targets: ${levelCfg.windTargets}`,
    ];
  }
  if (cfg.effectType === 'fire') {
    return [
      `Fireball DPS: ${levelCfg.fireballDps}`,
      `Fire zone: ${levelCfg.fireballDuration}s`,
    ];
  }
  if (cfg.effectType === 'bomb') {
    return [`Splash radius: ${levelCfg.splashRadius}`];
  }
  if (cfg.effectType === 'lightning') {
    return [
      `Chain count: ${levelCfg.chainCount}`,
      `Chain falloff: ${levelCfg.chainFalloff}%`,
    ];
  }
  return [];
}

function positionSlotPopout(slot) {
  const p = normToPx(slot);
  const margin = 10;
  const width = elSlotPopout.offsetWidth || 300;
  const height = elSlotPopout.offsetHeight || 220;

  let left = p.x + 26;
  if (left + width > canvas.width - margin) {
    left = p.x - width - 26;
  }
  left = Math.max(margin, Math.min(canvas.width - width - margin, left));

  let top = p.y - height * 0.48;
  if (top + height > canvas.height - margin) {
    top = canvas.height - height - margin;
  }
  top = Math.max(margin, top);

  elSlotPopout.style.left = `${Math.round(left)}px`;
  elSlotPopout.style.top = `${Math.round(top)}px`;
}

function createPopoutAction(label, detail, onClick, disabled = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'slot-option';
  button.disabled = disabled;
  button.textContent = label;
  if (detail) {
    const extra = document.createElement('small');
    extra.textContent = detail;
    button.appendChild(extra);
  }
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

function slotPopoutStateKey(slotId = selectedSlotId) {
  const slot = slotId ? game.getBuildSlots().find((candidate) => candidate.id === slotId) : null;
  if (!slot) {
    return '';
  }
  const tower = game.getTower(slot.id);
  const activationKey = game.isSlotActivated(slot.id) ? 'active' : 'locked';
  const towerKey = tower ? `${tower.towerId}:${tower.level}` : 'empty';
  const coinsKey = canModifyTowers() ? game.coins : 'locked';
  return [slot.id, activationKey, towerKey, game.state, coinsKey, slotPopoutNotice].join('|');
}

function renderSlotPopout(slotId = selectedSlotId) {
  const slot = slotId ? game.getBuildSlots().find((candidate) => candidate.id === slotId) : null;
  if (!slot) {
    closeSlotPopout();
    return;
  }

  selectedSlotId = slot.id;
  const tower = game.getTower(slot.id);
  const buildPhase = canModifyTowers();
  const slotActivated = game.isSlotActivated(slot.id);
  const slotActivationCost = game.getSlotActivationCost(slot.id);
  rangePreviewTowerId = null;

  elSlotPopout.innerHTML = '';
  elSlotPopout.classList.remove('hidden');

  const title = document.createElement('h3');
  title.textContent = tower ? `Tower Slot ${slot.id}` : `Build Slot ${slot.id}`;
  elSlotPopout.appendChild(title);

  const helper = document.createElement('p');
  helper.textContent = tower
    ? 'Upgrade or inspect this tower.'
    : !slotActivated
      ? `Activate this slot for ${formatNumber(slotActivationCost)}c, then place towers.`
    : buildPhase
      ? 'Pick a tower to build on this activated slot. Hover an option to preview range.'
      : 'Building is locked right now.';
  elSlotPopout.appendChild(helper);

  const meta = document.createElement('div');
  meta.className = 'slot-meta';
  if (tower) {
    const cfg = TOWER_CONFIG[tower.towerId];
    const levelCfg = cfg.levels[tower.level - 1];
    const lines = [
      `${cfg.name}`,
      `Level ${tower.level}/${cfg.levels.length} | DMG ${levelCfg.damage} | RNG ${levelCfg.range}`,
      ...slotSpecialLines(cfg, levelCfg),
    ];
    meta.textContent = lines.join('\n');
  } else {
    if (slotActivated) {
      meta.textContent = [
        'Slot activated and ready for towers.',
        `Coins available: ${formatNumber(game.coins)}`,
      ].join('\n');
    } else {
      meta.textContent = [
        'Locked build ground.',
        `Activation fee: ${formatNumber(slotActivationCost)}c`,
        `Coins available: ${formatNumber(game.coins)}`,
      ].join('\n');
    }
  }
  elSlotPopout.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'slot-options';
  elSlotPopout.appendChild(actions);

  if (!tower) {
    if (!slotActivated) {
      const disabled = !buildPhase || game.coins < slotActivationCost;
      actions.appendChild(
        createPopoutAction(
          `Activate Slot - ${formatNumber(slotActivationCost)}c`,
          'Pay once for this map run, then tower builds use tower-only costs.',
          () => {
            const result = game.activateSlot(slot.id);
            slotPopoutNotice = result.ok ? '' : result.error;
            updateHud();
            scheduleProgressPersist();
          },
          disabled
        )
      );
    } else {
      for (const cfg of Object.values(TOWER_CONFIG)) {
        const towerCost = cfg.levels[0].cost;
        const disabled = !buildPhase || game.coins < towerCost;
        const action = createPopoutAction(
          `${cfg.name} - ${formatNumber(towerCost)}c`,
          `L1 DMG ${cfg.levels[0].damage} | RNG ${cfg.levels[0].range}`,
          () => {
            const result = game.buildTower(slot.id, cfg.id);
            slotPopoutNotice = result.ok ? '' : result.error;
            rangePreviewTowerId = null;
            if (result.ok) {
              selectedTowerId = cfg.id;
              selectedCurveTowerId = cfg.id;
              elCurveTower.value = selectedCurveTowerId;
              markCurveDirty();
            }
            updateHud();
            scheduleProgressPersist();
          },
          disabled
        );
        action.addEventListener('pointerenter', () => {
          rangePreviewTowerId = cfg.id;
        });
        action.addEventListener('pointerleave', () => {
          if (rangePreviewTowerId === cfg.id) {
            rangePreviewTowerId = null;
          }
        });
        action.addEventListener('focus', () => {
          rangePreviewTowerId = cfg.id;
        });
        action.addEventListener('blur', () => {
          if (rangePreviewTowerId === cfg.id) {
            rangePreviewTowerId = null;
          }
        });
        actions.appendChild(action);
      }
    }
  } else {
    const cfg = TOWER_CONFIG[tower.towerId];
    const canUpgrade = tower.level < cfg.levels.length;
    const nextCost = canUpgrade ? cfg.levels[tower.level].cost : 0;
    const disabled = !canUpgrade || !buildPhase || game.coins < nextCost;

    selectedTowerId = tower.towerId;
    selectedCurveTowerId = tower.towerId;
    elCurveTower.value = selectedCurveTowerId;

    actions.appendChild(
      createPopoutAction(
        canUpgrade ? `Upgrade to L${tower.level + 1} - ${formatNumber(nextCost)}c` : 'Max level reached',
        canUpgrade ? 'Upgrade anytime except map-result state.' : 'This tower is already at level cap.',
        () => {
          const result = game.upgradeTower(slot.id);
          slotPopoutNotice = result.ok ? '' : result.error;
          updateHud();
          scheduleProgressPersist();
        },
        disabled
      )
    );
  }

  if (slotPopoutNotice) {
    const notice = document.createElement('p');
    notice.textContent = slotPopoutNotice;
    elSlotPopout.appendChild(notice);
  }

  const footer = document.createElement('div');
  footer.className = 'slot-actions';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'slot-close';
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    selectedSlotId = null;
    slotPopoutNotice = '';
    closeSlotPopout();
  });
  footer.appendChild(closeBtn);
  elSlotPopout.appendChild(footer);

  markCurveDirty();
  positionSlotPopout(slot);
  slotPopoutRenderKey = slotPopoutStateKey(slot.id);
}

function refreshSlotPopout() {
  if (elSlotPopout.classList.contains('hidden')) {
    return;
  }
  const nextKey = slotPopoutStateKey(selectedSlotId);
  if (!nextKey || nextKey === slotPopoutRenderKey) {
    return;
  }
  renderSlotPopout(selectedSlotId);
}

function updateHud() {
  const snap = game.getSnapshot();
  rebuildMapSelect();
  elCoinsOverlay.textContent = formatNumber(snap.coins);
  elXpOverlay.textContent = formatNumber(snap.xp);
  elMapOverlay.textContent = snap.mapName;
  elWaveOverlay.textContent = `${Math.max(snap.wave, 0)}/${snap.totalWaves}`;
  elBoatsOverlay.textContent = formatNumber(snap.boatsLeft);
  elStateOverlay.textContent = stateLabel(snap.state);

  if (snap.result) {
    if (snap.result.victory) {
      const nextMapId = game.getNextMapId();
      const rewardCoins = Number(snap.result.mapRewardCoins || 0);
      const rewardXp = Number(snap.result.mapRewardXp || 0);
      const rewardText = rewardCoins > 0 || rewardXp > 0
        ? ` Clear reward: <strong>+${formatNumber(rewardCoins)}c / +${formatNumber(rewardXp)}xp</strong>.`
        : '';
      const unlockText = nextMapId
        ? ` Next map unlocked: <strong>${game.isMapUnlocked(nextMapId) ? 'Yes' : 'No'}</strong>.`
        : ' Campaign sequence complete.';
      elResult.innerHTML = `Victory on ${snap.mapName}.${rewardText}${unlockText}`;
    } else {
      elResult.textContent = `Defeat on ${snap.mapName}. Treasury exhausted.`;
    }
  } else {
    elResult.textContent = 'Fleet in progress. Reinforce river chokepoints and upgrade efficiently.';
  }

  btnStartWave.disabled = !['build_phase', 'wave_result'].includes(game.state);
  btnToggleSpeed.textContent = `Speed ${game.speed}x`;
  btnFastForwardWave.textContent = fastForwardUntilMs > 0 ? 'Fast 1s Fleet Run (Active)' : 'Fast 1s Fleet Run';
  btnToggleAutoContinue.textContent = `Auto Continue: ${autoContinueEnabled ? 'On' : 'Off'}`;
  refreshSlotPopout();
  updateCurveVisualization();
}

function drawMapBase() {
  ctx.drawImage(terrainLayer, 0, 0);
  ctx.drawImage(riverLayer, 0, 0);
}

function drawBuildSlot(slot, isSelected) {
  const p = normToPx(slot);
  const tower = game.getTower(slot.id);
  const slotActivated = game.isSlotActivated(slot.id);
  const activationCost = game.getSlotActivationCost(slot.id);

  ctx.save();
  ctx.translate(p.x, p.y);

  ctx.fillStyle = tower ? 'rgba(14,26,18,0.40)' : slotActivated ? 'rgba(31,57,29,0.32)' : 'rgba(24,31,23,0.34)';
  ctx.beginPath();
  ctx.ellipse(0, 8, 22, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = tower ? '#8f8466' : slotActivated ? '#94886c' : '#756a52';
  ctx.beginPath();
  ctx.arc(0, 0, SLOT_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = tower ? '#786e55' : slotActivated ? '#7c7258' : '#5f5642';
  ctx.beginPath();
  ctx.arc(0, 0, SLOT_RADIUS - 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = isSelected ? '#a0f3ff' : slotActivated ? 'rgba(250, 248, 225, 0.45)' : 'rgba(214, 192, 145, 0.4)';
  ctx.lineWidth = isSelected ? 2.5 : 1;
  ctx.beginPath();
  ctx.arc(0, 0, SLOT_RADIUS - 2, 0, Math.PI * 2);
  ctx.stroke();

  if (!tower && !slotActivated) {
    ctx.fillStyle = 'rgba(45, 33, 22, 0.9)';
    ctx.fillRect(-3, -6, 6, 8);
    ctx.fillRect(-6, -1, 12, 7);
    if (activationCost > 0) {
      const label = String(activationCost);
      ctx.fillStyle = 'rgba(248, 226, 152, 0.9)';
      ctx.font = 'bold 9px monospace';
      ctx.fillText(label, -10, 14);
    }
  }

  ctx.restore();
}

function rgba(rgb, alpha) {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

function selectedRangeData() {
  if (!selectedSlotId) {
    return null;
  }

  const slot = game.getBuildSlots().find((candidate) => candidate.id === selectedSlotId);
  if (!slot) {
    return null;
  }

  const tower = game.getTower(slot.id);
  if (tower) {
    const cfg = TOWER_CONFIG[tower.towerId];
    const levelCfg = cfg?.levels[tower.level - 1];
    if (!levelCfg) {
      return null;
    }
    return {
      slot,
      towerId: tower.towerId,
      range: levelCfg.range,
      preview: false,
      label: `${cfg.name} L${tower.level}`,
    };
  }

  const towerId = rangePreviewTowerId && TOWER_CONFIG[rangePreviewTowerId]
    ? rangePreviewTowerId
    : selectedTowerId in TOWER_CONFIG
      ? selectedTowerId
      : 'arrow';
  if (!game.isSlotActivated(slot.id)) {
    return null;
  }
  const cfg = TOWER_CONFIG[towerId];
  if (!cfg) {
    return null;
  }
  return {
    slot,
    towerId,
    range: cfg.levels[0].range,
    preview: true,
    label: `${cfg.name} L1`,
  };
}

function drawSelectedTowerRange() {
  const data = selectedRangeData();
  if (!data) {
    return;
  }

  const p = normToPx(data.slot);
  const radius = (data.range / WORLD_SCALE) * canvas.width;
  const palette = TOWER_RANGE_COLORS[data.towerId] || TOWER_RANGE_COLORS.arrow;
  const alphaScale = data.preview ? 0.82 : 1;

  ctx.save();

  const spread = ctx.createRadialGradient(p.x, p.y, Math.max(8, radius * 0.18), p.x, p.y, radius);
  spread.addColorStop(0, rgba(palette.fill, 0.04 * alphaScale));
  spread.addColorStop(0.7, rgba(palette.fill, 0.17 * alphaScale));
  spread.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = spread;
  ctx.beginPath();
  ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.setLineDash([10, 6]);
  ctx.strokeStyle = rgba(palette.edge, 0.9 * alphaScale);
  ctx.lineWidth = data.preview ? 2.2 : 2.9;
  ctx.beginPath();
  ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = rgba(palette.fill, 0.4 * alphaScale);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(p.x, p.y, Math.max(12, radius - 6), 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = rgba(palette.edge, 0.88 * alphaScale);
  ctx.beginPath();
  ctx.arc(p.x, p.y, 2.8, 0, Math.PI * 2);
  ctx.fill();

  const label = `${data.label} RNG ${data.range.toFixed(2)}`;
  ctx.font = 'bold 11px monospace';
  const textWidth = ctx.measureText(label).width;
  const boxWidth = Math.ceil(textWidth) + 14;
  const boxHeight = 18;
  const x = Math.max(8, Math.min(canvas.width - boxWidth - 8, p.x - boxWidth * 0.5));
  const y = Math.max(12, p.y - radius - boxHeight - 8);

  ctx.fillStyle = `rgba(8, 14, 24, ${0.78 * alphaScale})`;
  ctx.fillRect(x, y, boxWidth, boxHeight);
  ctx.strokeStyle = rgba(palette.edge, 0.95 * alphaScale);
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, boxWidth - 1, boxHeight - 1);

  ctx.fillStyle = `rgba(243, 247, 255, ${0.98 * alphaScale})`;
  ctx.fillText(label, x + 7, y + 12.5);
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
  for (const slot of game.getBuildSlots()) {
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

function enemyPhase(enemy) {
  const key = `${enemy.id}:${enemy.enemyType}`;
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 33 + key.charCodeAt(i)) % 100000;
  }
  return hash / 100000;
}

function drawWindTornadoOverlay(enemy, p, angle, phase) {
  const slowDuration = enemy.slowDurationLeft || 0;
  const slowPercent = enemy.slowPercent || 0;
  if (slowDuration <= 0 || slowPercent <= 0) {
    return;
  }

  const slowStrength = Math.min(1, slowPercent / 86);
  const durationStrength = Math.min(1, slowDuration / 2.6);
  const intensity = (0.72 + slowStrength * 0.28) * (0.78 + durationStrength * 0.22);

  ctx.save();
  ctx.translate(p.x, p.y + 3);
  ctx.rotate(angle * 0.14 + simTime * (2.2 + slowStrength * 1.5) + phase);

  const cone = ctx.createLinearGradient(0, -28, 0, 12);
  cone.addColorStop(0, `rgba(194,249,255,${0.18 * intensity})`);
  cone.addColorStop(0.45, `rgba(157,231,250,${0.13 * intensity})`);
  cone.addColorStop(1, 'rgba(130,206,238,0)');
  ctx.fillStyle = cone;
  ctx.beginPath();
  ctx.moveTo(-10, 10);
  ctx.quadraticCurveTo(0, -26, 10, 10);
  ctx.closePath();
  ctx.fill();

  for (let i = 0; i < 5; i += 1) {
    const t = i / 4;
    const y = 8 - t * 26;
    const radiusX = 8 + t * 11 + Math.sin(simTime * 8 + phase * 11 + i * 1.7) * 1.4;
    const radiusY = 2.8 + t * 1.8;
    ctx.strokeStyle = `rgba(166,244,255,${(0.32 + t * 0.4) * intensity})`;
    ctx.lineWidth = 1.2 + t * 0.75;
    ctx.beginPath();
    ctx.ellipse(0, y, radiusX, radiusY, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

function drawBurnOverlay(enemy, p, angle, phase) {
  const burnDuration = enemy.burnDurationLeft || 0;
  const burnDps = enemy.burnDps || 0;
  if (burnDuration <= 0 || burnDps <= 0) {
    return;
  }

  const heatStrength = Math.min(1, burnDps / 120);
  const durationStrength = Math.min(1, burnDuration / 3.2);
  const intensity = (0.62 + heatStrength * 0.38) * (0.76 + durationStrength * 0.24);

  ctx.save();
  ctx.translate(p.x, p.y - 2);
  ctx.rotate(angle);

  const glow = ctx.createRadialGradient(-3, 0, 2, -3, 0, 20);
  glow.addColorStop(0, `rgba(255,203,92,${0.4 * intensity})`);
  glow.addColorStop(0.55, `rgba(255,124,58,${0.24 * intensity})`);
  glow.addColorStop(1, 'rgba(255,95,40,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(-3, 0, 20, 0, Math.PI * 2);
  ctx.fill();

  for (let i = 0; i < 4; i += 1) {
    const x = -11 + i * 6.5;
    const flicker = Math.sin(simTime * (9.5 + i) + phase * 17 + i * 0.9);
    const tipY = -11 - intensity * 8 - flicker * 2.6;
    const flameGradient = ctx.createLinearGradient(x, 4, x, tipY);
    flameGradient.addColorStop(0, `rgba(255,126,52,${0.58 * intensity})`);
    flameGradient.addColorStop(0.5, `rgba(255,184,72,${0.82 * intensity})`);
    flameGradient.addColorStop(1, 'rgba(255,250,176,0)');
    ctx.fillStyle = flameGradient;
    ctx.beginPath();
    ctx.moveTo(x - 2.4, 4);
    ctx.quadraticCurveTo(x - 1.2, tipY * 0.45, x, tipY);
    ctx.quadraticCurveTo(x + 1.5, tipY * 0.35, x + 2.4, 4);
    ctx.closePath();
    ctx.fill();
  }

  for (let i = 0; i < 3; i += 1) {
    const lift = (simTime * 32 + phase * 53 + i * 13) % 22;
    const px = -8 + i * 7 + Math.sin(simTime * 5 + i + phase * 6) * 1.4;
    const py = 4 - lift;
    ctx.fillStyle = `rgba(255,208,120,${0.3 * intensity})`;
    ctx.beginPath();
    ctx.arc(px, py, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawLightningStroke(points, alpha, lineWidth = 2.4) {
  if (points.length < 2 || alpha <= 0) {
    return;
  }
  ctx.save();
  ctx.strokeStyle = `rgba(255,228,121,${alpha})`;
  ctx.shadowColor = `rgba(255,228,121,${Math.min(0.7, alpha)})`;
  ctx.shadowBlur = 9;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawShockOverlay(enemy, p, phase) {
  const shockDuration = enemy.shockDurationLeft || 0;
  if (shockDuration <= 0) {
    return;
  }

  const intensity = Math.min(1, shockDuration / 0.95);
  ctx.save();
  ctx.translate(p.x, p.y - 1);

  const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 22);
  glow.addColorStop(0, `rgba(255,251,186,${0.34 + intensity * 0.24})`);
  glow.addColorStop(0.6, `rgba(255,230,118,${0.2 + intensity * 0.18})`);
  glow.addColorStop(1, 'rgba(255,218,92,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, 22, 0, Math.PI * 2);
  ctx.fill();

  const arcCount = intensity > 0.72 ? 3 : 2;
  for (let i = 0; i < arcCount; i += 1) {
    const start = simTime * (13 + i * 1.7) + phase * 13 + i * 1.9;
    const points = [];
    const steps = 4;
    for (let j = 0; j <= steps; j += 1) {
      const t = j / steps;
      const a = start + t * (0.78 + i * 0.16);
      const radius = 9 + t * 8.5;
      const jitterX = Math.sin(simTime * 31 + phase * 29 + j * 1.8 + i) * (1.1 + intensity * 1.2);
      const jitterY = Math.cos(simTime * 27 + phase * 17 + j * 1.6 + i * 1.4) * (1.0 + intensity);
      points.push({
        x: Math.cos(a) * radius + jitterX,
        y: Math.sin(a) * radius + jitterY,
      });
    }
    drawLightningStroke(points, 0.46 + intensity * 0.38, 1.7 + intensity * 0.9);
  }

  ctx.restore();
}

function drawEnemyStatusEffects(enemy, p, angle) {
  const phase = enemyPhase(enemy);
  drawWindTornadoOverlay(enemy, p, angle, phase);
  drawBurnOverlay(enemy, p, angle, phase);
  drawShockOverlay(enemy, p, phase);
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
    drawEnemyStatusEffects(enemy, p, angle);

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
    if (attack.effectType === 'lightning' || attack.effectType === 'lightning_chain') {
      pushVisualEffect({
        kind: attack.effectType === 'lightning_chain' ? 'lightning_chain' : 'lightning',
        points: createLightningPoints(from, to),
        ttl: attack.effectType === 'lightning_chain' ? 0.1 : 0.14,
        life: attack.effectType === 'lightning_chain' ? 0.1 : 0.14,
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
  for (let i = visualEffects.length - 1; i >= 0; i -= 1) {
    if (visualEffects[i].ttl <= 0) {
      visualEffects.splice(i, 1);
    }
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

    if (effect.kind === 'lightning' || effect.kind === 'lightning_chain') {
      const lineWidth = effect.kind === 'lightning_chain' ? 1.9 : 2.4;
      const chainAlpha = effect.kind === 'lightning_chain' ? alpha * 0.84 : alpha;
      drawLightningStroke(effect.points, chainAlpha, lineWidth);
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
  drawSelectedTowerRange();
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
  if (persistenceReady && now >= nextPeriodicPersistAt) {
    nextPeriodicPersistAt = now + PERIODIC_SAVE_MS;
    queueProgressPersist(false);
  }

  requestAnimationFrame(gameLoop);
}

function pickSlotFromMouse(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * canvas.width;
  const y = ((clientY - rect.top) / rect.height) * canvas.height;

  for (const slot of game.getBuildSlots()) {
    const p = normToPx(slot);
    if (Math.hypot(x - p.x, y - p.y) <= SLOT_RADIUS + 6) {
      return slot;
    }
  }
  return null;
}

function loadSelectedMap() {
  const mapRes = game.setMap(elMapSelect.value, { carryResources: true });
  if (!mapRes.ok) {
    elResult.textContent = mapRes.error;
    elMapSelect.value = game.mapId;
    return;
  }
  selectedSlotId = null;
  fastForwardUntilMs = 0;
  slotPopoutNotice = '';
  closeSlotPopout();
  buildStaticMapLayers();
  updateMapMeta();
  updateHud();
  scheduleProgressPersist();
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
  if (!nextMapId || !game.isMapUnlocked(nextMapId)) {
    return;
  }
  const mapRes = game.setMap(nextMapId, { carryResources: true });
  if (!mapRes.ok) {
    return;
  }
  selectedSlotId = null;
  slotPopoutNotice = '';
  closeSlotPopout();
  visualEffects.length = 0;
  fastForwardUntilMs = 0;
  elMapSelect.value = game.mapId;
  buildStaticMapLayers();
  updateMapMeta();
  scheduleProgressPersist();
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
    slotPopoutNotice = '';
    closeSlotPopout();
    return;
  }

  selectedSlotId = slot.id;
  slotPopoutNotice = '';
  renderSlotPopout(slot.id);
  updateHud();
});

document.addEventListener('pointerdown', (event) => {
  if (elSlotPopout.classList.contains('hidden')) {
    return;
  }
  if (event.target === canvas || elSlotPopout.contains(event.target)) {
    return;
  }
  selectedSlotId = null;
  slotPopoutNotice = '';
  closeSlotPopout();
});

btnStartWave.addEventListener('click', () => {
  game.startNextWave();
  updateHud();
  scheduleProgressPersist();
});

btnToggleSpeed.addEventListener('click', () => {
  game.setSpeed(game.speed === 1 ? 2 : 1);
  updateHud();
  scheduleProgressPersist();
});

btnFastForwardWave.addEventListener('click', () => {
  triggerFastForwardWave();
  updateHud();
  scheduleProgressPersist();
});

btnToggleAutoContinue.addEventListener('click', () => {
  autoContinueEnabled = !autoContinueEnabled;
  handleAutoContinue();
  updateHud();
  scheduleProgressPersist();
});

btnToggleReportPanel.addEventListener('click', () => {
  setPanelVisibility('report', !reportPanelVisible);
  scheduleProgressPersist();
});

btnToggleCurvePanel.addEventListener('click', () => {
  setPanelVisibility('curve', !curvePanelVisible);
  scheduleProgressPersist();
});

btnHideReportPanel.addEventListener('click', (event) => {
  event.stopPropagation();
  setPanelVisibility('report', false);
  scheduleProgressPersist();
});

btnHideCurvePanel.addEventListener('click', (event) => {
  event.stopPropagation();
  setPanelVisibility('curve', false);
  scheduleProgressPersist();
});

btnLoadMap.addEventListener('click', loadSelectedMap);

elMapSelect.addEventListener('change', updateMapMeta);
elCurveTower.addEventListener('change', () => {
  selectedCurveTowerId = elCurveTower.value;
  markCurveDirty();
  updateCurveVisualization(true);
  scheduleProgressPersist();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (!elSlotPopout.classList.contains('hidden')) {
      selectedSlotId = null;
      slotPopoutNotice = '';
      closeSlotPopout();
      return;
    }
    if (curvePanelVisible) {
      setPanelVisibility('curve', false);
      return;
    }
    if (reportPanelVisible) {
      setPanelVisibility('report', false);
    }
  }
});

window.addEventListener('resize', () => {
  resizeCanvasToViewport();
  clampHudWindowsToViewport();
});

window.addEventListener('beforeunload', flushProgressOnUnload);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    flushProgressOnUnload();
  }
});

async function bootstrap() {
  rebuildMapSelect();
  rebuildCurveTowerSelect();
  makeWindowDraggable(elResultWindow, elResultHandle);
  makeWindowDraggable(elCurveWindow, elCurveHandle);
  updatePanelButtons();
  updateMapMeta();
  updateHud();

  await hydrateProgress();

  resizeCanvasToViewport();
  clampHudWindowsToViewport();
  updateMapMeta();
  updateHud();

  persistenceReady = true;
  nextPeriodicPersistAt = performance.now() + PERIODIC_SAVE_MS;
  queueProgressPersist(false);
  requestAnimationFrame(gameLoop);
}

bootstrap();
