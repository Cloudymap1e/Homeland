# AGENTS.md

This file defines the required workflow and architecture guardrails for agents/contributors working in this repository.

## 1. Repo Identity and Scope

- Project: Homeland (river-route tower defense).
- Primary implementation: web runtime in this repo root (`web/`, `scripts/`, `functions/`).
- Legacy implementation: Python prototype under `src/homeland/` is reference-only for current feature work.
- Objective for agents: preserve playable campaign behavior and keep balancing/deploy/test flows reproducible.

## 2. Source of Truth (Current Runtime)

Use these as authoritative for live behavior:

- Gameplay config and campaign data: `web/src/config.js`
- Gameplay state machine / combat / economy / progression: `web/src/game-core.js`
- UI/HUD and persistence orchestration: `web/src/app.js`
- Local dev HTTP server + local persistence API: `scripts/dev-server.mjs`
- Cloudflare Pages Function progress API (production): `functions/api/progress.js`
- D1 schema for progress storage: `schema/progress.sql`
- Monte Carlo and balancing runner: `scripts/balance-sim.mjs`
- CUDA/GPU fast wave backend bridge: `scripts/gpu-wave-runner.mjs`
- Data-oriented fast simulation engine: `scripts/fast-game-core.mjs`

Do not treat README text as authoritative when it conflicts with runtime code.

## 3. Product Rules and Runtime Invariants

- Starting map is `map_01_river_bend`.
- Starting coins are map-defined (`Map 1` is `10,000`).
- Towers can only be placed on authored build slots that are activated and not river-blocked.
- Build slot coordinates are authored design data and must remain exact.
  - Do not auto-generate/densify/offset slot positions from authored coordinates.
- Early maps have no enemy attacks on towers.
- Leak handling:
  - leaks deduct coins and XP,
  - XP floors at `0`,
  - coins may go negative,
  - non-final-wave leak does not hard-stop the run,
  - final-wave leaks resolve as map defeat.
- Campaign progression is sequential and gated by map completion + XP unlock requirements.

## 4. Current Content Snapshot (Code-Verified)

- Live campaign maps in `web/src/config.js`: `map_01` through `map_05`.
- Tower roster:
  - `arrow`
  - `bone` (bomb tower role)
  - `magic_fire`
  - `magic_wind`
  - `magic_lightning`
- Max tower level: `50`.
- Waves, route weights, leak penalties, unlock XP, map rewards, and enemy scaling are config-driven per map.

## 5. Architecture (How Things Work)

### 5.1 Gameplay Core

- `HomelandGame` in `web/src/game-core.js` owns:
  - game states (`build_phase`, `wave_running`, `wave_result`, `map_result`),
  - map loading and slot partitioning (buildable vs river-blocked),
  - slot activation, build/upgrade/sell,
  - wave spawn queue and route assignment,
  - combat/effects (fire zone, slow, lightning chain, splash),
  - rewards/penalties and progression unlock.

### 5.2 UI Layer

- `web/src/app.js` owns:
  - canvas render and visual effects,
  - HUD and slot popout interactions,
  - speed/fast-forward/auto-continue controls,
  - persistence scheduling and remote/local sync behavior.

### 5.3 Persistence Model

- Local dev (`npm run dev`): `scripts/dev-server.mjs`
  - serves `web/` static assets,
  - exposes `/api/progress`,
  - persists in `.data/player-progress.json` with cookie/IP session mapping.
- Production (Cloudflare Pages): `functions/api/progress.js`
  - same `/api/progress` contract,
  - D1-backed session persistence (`PROGRESS_DB` binding).

### 5.4 Build and Preview

- `npm run build:web` builds `dist/` via esbuild and hashed assets.
- `npm run preview:web` serves `dist/` with cache headers.
- `wrangler.toml` configures Pages + D1 binding placeholders.

## 6. Testing and Quality Gates

### 6.1 Required JS/Web Tests

- Run: `npm test`
- Covers core gameplay invariants in `web/tests/game-core.test.mjs`.

### 6.2 E2E Regression (when UI interactions are touched)

- Run: `npm run test:e2e`
- Playwright spec: `web/tests/slot-popout.e2e.spec.mjs`
- Use `HOMELAND_E2E_BASE_URL` if targeting non-default host.

### 6.3 Legacy Python Tests

- Python tests under `tests/` validate legacy prototype references.
- They are not part of default `npm test` for the active web runtime.

## 7. Balancing Workflow (Mandatory Rules)

### 7.1 GS75 CUDA-First Execution

- On machine `GS75`, CUDA Monte Carlo must be first choice.
- Off-GS75 hosts must attempt remote GS75 run first:
  - `ssh GS75 'cd /Users/rc/Project/Homeland && npm run balance:gs75'`
- Only if GS75/CUDA path is unavailable, run CPU fallback:
  - `npm run balance:sim`
- `balance:gs75` uses `--cuda-required` and must fail fast without CUDA runtime.

### 7.2 Coverage Requirements

A valid balancing cycle must include:

- random baseline (`random_all`),
- campaign retention baseline (`r[N]` chaining),
- fixed-budget pass-rate check,
- balanced mix comparison,
- mono tower scenarios,
- at least 3 duo tower scenarios,
- OAT sensitivity for:
  - `windSlowMult`
  - `bombSplashMult`
  - `fireDpsMult`

### 7.3 Standard Commands

- Full suite: `npm run balance:sim`
- Pass-standard only: `npm run balance:standard`
- Diversity/OAT rerun: `npm run balance:diversity`
- Optional CUDA quick check: `npm run balance:cuda-check`
- GPU engine smoke check: `npm run balance:gpu-check`

## 8. Deployment and Publish Workflow

### 8.1 Cloudflare Pages

- Build output directory: `dist`
- Deploy command: `npm run pages:deploy`

### 8.2 Cloudflare Tunnel (Required Hostname)

- Required public hostname: `homeland.secana.top`
- One-time setup script: `./scripts/cloudflare-tunnel-setup.sh`
- Run tunnel: `./scripts/cloudflare-tunnel-run.sh`
- Local app must run first: `npm run dev`

### 8.3 Publish Verification Minimum

After user-facing changes (unless explicitly skipped by user):

1. `curl -I https://homeland.secana.top` returns HTTP `200`.
2. Fetch HTML and verify expected marker for the shipped change.

## 9. Commit and Git Protocol

- Keep commits small and scoped.
- Commit messages must clearly state intent (`Fix: ...`, `Feature: ...`, `Docs: ...`, `Perf: ...`, `Test: ...`, `Deploy: ...`).
- Commit and push incrementally during longer tasks.
- Never rewrite/revert unrelated user changes.
- Never use destructive git commands (`reset --hard`, checkout file rollback) unless explicitly requested.

## 10. Agent Execution Rules for This Repo

- Prefer config-first changes for tuning.
- For new mechanics, always document:
  - player-facing behavior,
  - owning module/file,
  - required data fields,
  - at least one deterministic test scenario.
- If runtime rules change, update both:
  - `AGENTS.md` (operational contract)
  - relevant implementation docs (`README.md` and/or `docs/*`)
- When conflicts appear between docs and code, fix docs to match code immediately in the same task.

## 11. Quick Command Reference

- Dev server: `npm run dev` (serves on `http://127.0.0.1:4173`)
- Unit tests: `npm test`
- E2E tests: `npm run test:e2e`
- Build web: `npm run build:web`
- Preview build: `npm run preview:web`
- Full balance suite: `npm run balance:sim`
- GS75 CUDA-required suite: `npm run balance:gs75`
- Pages deploy: `npm run pages:deploy`
- D1 migration helper: `npm run migrate:d1`
