import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function parseArgs(argv) {
  const args = {
    runs: 10,
    urls: ['http://127.0.0.1:4173', 'https://homeland.secana.top'],
    timeoutMs: 60000,
    outDir: 'docs/perf',
    writeBaseline: true,
  };
  for (const arg of argv) {
    if (arg.startsWith('--runs=')) {
      args.runs = Math.max(1, Number(arg.slice('--runs='.length)) || args.runs);
    } else if (arg.startsWith('--urls=')) {
      const parsed = arg
        .slice('--urls='.length)
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      if (parsed.length > 0) {
        args.urls = parsed;
      }
    } else if (arg.startsWith('--timeout-ms=')) {
      args.timeoutMs = Math.max(1000, Number(arg.slice('--timeout-ms='.length)) || args.timeoutMs);
    } else if (arg === '--no-baseline') {
      args.writeBaseline = false;
    } else if (arg.startsWith('--out-dir=')) {
      args.outDir = arg.slice('--out-dir='.length) || args.outDir;
    }
  }
  return args;
}

function percentile(values, p) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[idx].toFixed(1));
}

function summarizeRuns(runs) {
  const interactive = runs.map((run) => run.interactiveMs);
  const loadMs = runs.map((run) => run.loadMs);
  const hudReady = runs.map((run) => run.hudReadyMs);
  return {
    sampleSize: runs.length,
    interactive: {
      min: percentile(interactive, 0),
      p50: percentile(interactive, 50),
      p95: percentile(interactive, 95),
      max: percentile(interactive, 100),
    },
    load: {
      p50: percentile(loadMs, 50),
      p95: percentile(loadMs, 95),
    },
    hudReady: {
      p50: percentile(hudReady, 50),
      p95: percentile(hudReady, 95),
    },
  };
}

async function measureOne(url, runId, timeoutMs) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const startWall = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
  await page.waitForSelector('#coins-overlay', { timeout: timeoutMs });
  await page.waitForSelector('#map-overlay', { timeout: timeoutMs });
  await page.waitForSelector('#state-overlay', { timeout: timeoutMs });
  const stats = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const paints = performance.getEntriesByType('paint').reduce((acc, entry) => {
      acc[entry.name] = Number(entry.startTime.toFixed(1));
      return acc;
    }, {});
    const wanted = ['/src/app.js', '/src/game-core.js', '/src/config.js', '/api/progress', '/styles.css', '/assets/'];
    const resources = performance
      .getEntriesByType('resource')
      .filter((entry) => wanted.some((probe) => entry.name.includes(probe)))
      .map((entry) => ({
        name: entry.name,
        startMs: Number(entry.startTime.toFixed(1)),
        durationMs: Number(entry.duration.toFixed(1)),
        transferSize: entry.transferSize,
      }));
    return {
      domInteractiveMs: Number(nav.domInteractive.toFixed(1)),
      domContentLoadedMs: Number(nav.domContentLoadedEventEnd.toFixed(1)),
      loadMs: Number(nav.loadEventEnd.toFixed(1)),
      fcpMs: paints['first-contentful-paint'] ?? null,
      fpMs: paints['first-paint'] ?? null,
      hud: {
        coins: document.getElementById('coins-overlay')?.textContent || '',
        map: document.getElementById('map-overlay')?.textContent || '',
        state: document.getElementById('state-overlay')?.textContent || '',
      },
      resources,
      nowMs: Number(performance.now().toFixed(1)),
    };
  });
  const wallElapsed = Date.now() - startWall;
  const hudReadyMs = stats.nowMs;
  const interactiveMs = Number(Math.max(stats.domInteractiveMs, hudReadyMs).toFixed(1));
  await context.close();
  await browser.close();
  return {
    runId,
    url,
    wallElapsedMs: wallElapsed,
    hudReadyMs,
    interactiveMs,
    ...stats,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const result = {
    startedAt,
    runsPerUrl: args.runs,
    timeoutMs: args.timeoutMs,
    urls: {},
  };

  for (const url of args.urls) {
    const runs = [];
    for (let i = 1; i <= args.runs; i += 1) {
      const run = await measureOne(url, i, args.timeoutMs);
      runs.push(run);
      console.log(`[perf] ${url} run ${i}/${args.runs} interactive=${run.interactiveMs}ms load=${run.loadMs}ms hud=${run.hudReadyMs}ms`);
    }
    result.urls[url] = {
      summary: summarizeRuns(runs),
      runs,
    };
  }

  const endedAt = new Date().toISOString();
  result.endedAt = endedAt;

  const outDir = resolve(args.outDir);
  await mkdir(outDir, { recursive: true });
  const stamp = startedAt.slice(0, 10).replaceAll('-', '');
  const runPath = resolve(outDir, `load-metrics-${stamp}.json`);
  await writeFile(runPath, JSON.stringify(result, null, 2));
  console.log(`[perf] wrote run metrics to ${runPath}`);

  if (args.writeBaseline) {
    const baselinePath = resolve(outDir, `baseline-${stamp}.json`);
    await writeFile(baselinePath, JSON.stringify(result, null, 2));
    console.log(`[perf] wrote baseline metrics to ${baselinePath}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
