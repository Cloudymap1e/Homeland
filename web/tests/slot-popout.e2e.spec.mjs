import { test, expect } from '@playwright/test';

const BASE_URL = process.env.HOMELAND_E2E_BASE_URL || 'http://127.0.0.1:4173';

test('slot popout tower button responds to real click', async ({ page }) => {
  await page.request.delete(`${BASE_URL}/api/progress`);
  await page.goto(BASE_URL);

  const coinTextBefore = await page.locator('#coins-overlay').innerText();
  const coinsBefore = Number(coinTextBefore.replaceAll(',', ''));

  const canvas = page.locator('#game');
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) {
    throw new Error('Canvas is not visible for interaction.');
  }

  const slotX = canvasBox.x + canvasBox.width * 0.1;
  const slotY = canvasBox.y + canvasBox.height * 0.48;
  await page.mouse.click(slotX, slotY);

  await expect(page.locator('#slot-popout')).toBeVisible();

  const activateButton = page.locator('#slot-popout .slot-option').first();
  await expect(activateButton).toContainText('Activate Slot');
  const activateLabel = await activateButton.innerText();
  const activateCost = Number((activateLabel.match(/-\s*([\d,]+)c/i)?.[1] || '0').replaceAll(',', ''));
  await activateButton.click();

  const coinTextAfterActivate = await page.locator('#coins-overlay').innerText();
  const coinsAfterActivate = Number(coinTextAfterActivate.replaceAll(',', ''));
  expect(coinsBefore - coinsAfterActivate).toBe(activateCost);

  const firstTowerButton = page.locator('#slot-popout .slot-option').first();
  await expect(firstTowerButton).toBeVisible();
  const buildLabel = await firstTowerButton.innerText();
  const buildCost = Number((buildLabel.match(/-\s*([\d,]+)c/i)?.[1] || '0').replaceAll(',', ''));
  await firstTowerButton.click();

  await expect(page.locator('#slot-popout h3')).toHaveText(/Tower Slot/);

  const coinTextAfter = await page.locator('#coins-overlay').innerText();
  const coinsAfter = Number(coinTextAfter.replaceAll(',', ''));

  expect(coinsAfter).toBeLessThan(coinsBefore);
  expect(coinsAfterActivate - coinsAfter).toBe(buildCost);
  expect(coinsBefore - coinsAfter).toBe(activateCost + buildCost);
});

test('can build and upgrade from slot popout during active wave', async ({ page }) => {
  await page.request.delete(`${BASE_URL}/api/progress`);
  await page.goto(BASE_URL);
  await page.locator('#start-wave').click();

  const canvas = page.locator('#game');
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) {
    throw new Error('Canvas is not visible for interaction.');
  }

  const slotX = canvasBox.x + canvasBox.width * 0.1;
  const slotY = canvasBox.y + canvasBox.height * 0.48;
  await page.mouse.click(slotX, slotY);

  await expect(page.locator('#slot-popout')).toBeVisible();

  const coinTextBefore = await page.locator('#coins-overlay').innerText();
  const coinsBefore = Number(coinTextBefore.replaceAll(',', ''));

  const activateButton = page.locator('#slot-popout .slot-option').first();
  await expect(activateButton).toContainText('Activate Slot');
  const activateLabel = await activateButton.innerText();
  const activateCost = Number((activateLabel.match(/-\s*([\d,]+)c/i)?.[1] || '0').replaceAll(',', ''));
  await activateButton.click();

  const coinTextAfterActivate = await page.locator('#coins-overlay').innerText();
  const coinsAfterActivate = Number(coinTextAfterActivate.replaceAll(',', ''));
  expect(coinsBefore - coinsAfterActivate).toBe(activateCost);

  const buildButton = page.locator('#slot-popout .slot-option').first();
  await expect(buildButton).toBeEnabled();
  const buildLabel = await buildButton.innerText();
  const buildCost = Number((buildLabel.match(/-\s*([\d,]+)c/i)?.[1] || '0').replaceAll(',', ''));
  await buildButton.click();

  await expect(page.locator('#slot-popout h3')).toHaveText(/Tower Slot/);
  await expect(page.locator('#slot-popout .slot-meta')).toContainText('Level 1/');

  const coinTextAfterBuild = await page.locator('#coins-overlay').innerText();
  const coinsAfterBuild = Number(coinTextAfterBuild.replaceAll(',', ''));
  expect(coinsAfterActivate - coinsAfterBuild).toBe(buildCost);

  const upgradeButton = page.locator('#slot-popout .slot-option').first();
  await expect(upgradeButton).toBeEnabled();
  await upgradeButton.click();

  await expect(page.locator('#slot-popout .slot-meta')).toContainText('Level 2/');
  const coinTextAfterUpgrade = await page.locator('#coins-overlay').innerText();
  const coinsAfterUpgrade = Number(coinTextAfterUpgrade.replaceAll(',', ''));
  expect(coinsAfterUpgrade).toBeLessThan(coinsAfterBuild);
});

test('failed wave keeps campaign run resumable without reset wipe', async ({ page }) => {
  const seededProgress = {
    updatedAt: Date.now(),
    autoContinueEnabled: false,
    selectedTowerId: 'arrow',
    selectedCurveTowerId: 'arrow',
    reportPanelVisible: true,
    curvePanelVisible: true,
    game: {
      version: 1,
      mapId: 'map_03_marsh_maze',
      unlockedMapIds: ['map_01_river_bend', 'map_02_split_delta', 'map_03_marsh_maze'],
      completedMapIds: ['map_01_river_bend', 'map_02_split_delta'],
      paidSlotIds: [],
      state: 'build_phase',
      coins: 120,
      xp: 5000,
      waveIndex: -1,
      speed: 1,
      spawnCooldown: 0,
      spawnQueue: [],
      currentWaveLeaks: 0,
      enemies: [],
      nextEnemyId: 1,
      towers: [],
      fireZones: [],
      result: null,
      stats: { spawned: 0, killed: 0, leaked: 0 },
    },
  };

  await page.request.put(`${BASE_URL}/api/progress`, { data: seededProgress });
  await page.goto(BASE_URL);

  await expect(page.locator('#map-overlay')).toContainText('Map 3');
  await page.locator('#start-wave').click();

  for (let i = 0; i < 40; i += 1) {
    const state = await page.locator('#state-overlay').innerText();
    if (state !== 'Wave Live') {
      break;
    }
    await page.locator('#fast-forward-wave').click();
    await page.waitForTimeout(80);
  }

  const coinsAfterFailText = await page.locator('#coins-overlay').innerText();
  const coinsAfterFail = Number(coinsAfterFailText.replaceAll(',', ''));
  expect(coinsAfterFail).toBeLessThan(0);
  await expect(page.locator('#state-overlay')).toHaveText('Build');
  await expect(page.locator('#wave-overlay')).toHaveText('1/20');

  await page.locator('#start-wave').click();
  await expect(page.locator('#wave-overlay')).toHaveText('2/20');
  await expect(page.locator('#state-overlay')).toHaveText('Wave Live');
});

test('tower can be sold for 70 percent refund from slot popout', async ({ page }) => {
  await page.request.delete(`${BASE_URL}/api/progress`);
  await page.goto(BASE_URL);

  const canvas = page.locator('#game');
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) {
    throw new Error('Canvas is not visible for interaction.');
  }

  const slotX = canvasBox.x + canvasBox.width * 0.1;
  const slotY = canvasBox.y + canvasBox.height * 0.48;
  await page.mouse.click(slotX, slotY);

  await expect(page.locator('#slot-popout')).toBeVisible();
  const coinTextBefore = await page.locator('#coins-overlay').innerText();
  const coinsBefore = Number(coinTextBefore.replaceAll(',', ''));

  const activateButton = page.locator('#slot-popout .slot-option').first();
  const activateLabel = await activateButton.innerText();
  const activateCost = Number((activateLabel.match(/-\s*([\d,]+)c/i)?.[1] || '0').replaceAll(',', ''));
  await activateButton.click();

  const buildButton = page.locator('#slot-popout .slot-option').first();
  const buildLabel = await buildButton.innerText();
  const buildCost = Number((buildLabel.match(/-\s*([\d,]+)c/i)?.[1] || '0').replaceAll(',', ''));
  await buildButton.click();

  const sellButton = page.locator('#slot-popout .slot-option').filter({ hasText: 'Sell Tower' }).first();
  const sellLabel = await sellButton.innerText();
  const sellValue = Number((sellLabel.match(/\+\s*([\d,]+)c/i)?.[1] || '0').replaceAll(',', ''));
  await sellButton.click();

  await expect(page.locator('#slot-popout h3')).toHaveText(/Build Slot/);
  const coinTextAfterSell = await page.locator('#coins-overlay').innerText();
  const coinsAfterSell = Number(coinTextAfterSell.replaceAll(',', ''));

  expect(sellValue).toBe(Math.round(buildCost * 0.7));
  expect(coinsAfterSell).toBe(coinsBefore - activateCost - buildCost + sellValue);
});
