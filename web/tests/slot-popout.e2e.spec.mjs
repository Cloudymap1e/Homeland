import { test, expect } from '@playwright/test';

const BASE_URL = process.env.HOMELAND_E2E_BASE_URL || 'http://127.0.0.1:4173';

test('slot popout tower button responds to real click', async ({ page }) => {
  await page.goto(BASE_URL);

  await page.locator('#reset').click();

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

  const firstTowerButton = page.locator('#slot-popout .slot-option').first();
  await expect(firstTowerButton).toBeVisible();
  await firstTowerButton.click();

  await expect(page.locator('#slot-popout h3')).toHaveText(/Tower Slot/);

  const coinTextAfter = await page.locator('#coins-overlay').innerText();
  const coinsAfter = Number(coinTextAfter.replaceAll(',', ''));

  expect(coinsAfter).toBeLessThan(coinsBefore);
  expect(coinsBefore - coinsAfter).toBe(460);
});

test('can build and upgrade from slot popout during active wave', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.locator('#reset').click();
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

  const buildButton = page.locator('#slot-popout .slot-option').first();
  await expect(buildButton).toBeEnabled();
  await buildButton.click();

  await expect(page.locator('#slot-popout h3')).toHaveText(/Tower Slot/);
  await expect(page.locator('#slot-popout .slot-meta')).toContainText('Level 1/');

  const coinTextAfterBuild = await page.locator('#coins-overlay').innerText();
  const coinsAfterBuild = Number(coinTextAfterBuild.replaceAll(',', ''));
  expect(coinsAfterBuild).toBeLessThan(coinsBefore);

  const upgradeButton = page.locator('#slot-popout .slot-option').first();
  await expect(upgradeButton).toBeEnabled();
  await upgradeButton.click();

  await expect(page.locator('#slot-popout .slot-meta')).toContainText('Level 2/');
  const coinTextAfterUpgrade = await page.locator('#coins-overlay').innerText();
  const coinsAfterUpgrade = Number(coinTextAfterUpgrade.replaceAll(',', ''));
  expect(coinsAfterUpgrade).toBeLessThan(coinsAfterBuild);
});
