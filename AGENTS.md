# AGENTS.md

This file is the operating contract for coding agents and contributors in this repository.

## Mission and Scope

- Product: browser-based tower defense prototype (river routes vs pirate fleets).
- Primary runtime: `web/` JavaScript implementation.
- Legacy Python prototype in `src/homeland/` is reference-only; do not treat it as the default gameplay path.
- Current playable scope includes campaign progression through Map 5, tower placement/upgrades/selling, combat, leaks/penalties, and progress persistence.

## Source-of-Truth Files

Gameplay and balance
- `web/src/config.js`: canonical map, wave, tower, enemy, and campaign criteria data.
- `web/src/game-core.js`: simulation rules (economy, progression, spawning, combat, wave/map transitions).
- `web/src/app.js`: UI/HUD flow, persistence hydration/sync, panel visibility, rendering.

Persistence and deployment
- `functions/api/progress.js`: Pages Function for session + progress API.
- `schema/progress.sql`: D1 schema for `sessions` and `ip_index`.
- `wrangler.toml`: Cloudflare Pages + D1 binding configuration.

Tooling and validation
- `scripts/balance-sim.mjs`: Monte Carlo balancing and pass-standard workflow.
- `scripts/gpu-wave-runner.mjs` and `scripts/cuda/wave_sim.cu`: GPU wave simulation path.
- `web/tests/game-core.test.mjs`: core simulation regression tests.
- `web/tests/slot-popout.e2e.spec.mjs`: Playwright UI regression.

## Runtime and Commands

Run from repository root (`/Users/rc/Project/Homeland` in primary environment):

- Dev: `npm run dev`
- Unit tests: `npm test`
- E2E: `npm run test:e2e`
- Build: `npm run build:web`
- Preview: `npm run preview:web`
- Pages deploy: `npm run pages:deploy`
- D1 migration: `npm run migrate:d1`

Balancing
- Full balancing cycle: `npm run balance:sim`
- Pass-standard only: `npm run balance:standard`
- Diversity/OAT rerun: `npm run balance:diversity`
- GS75 CUDA-required run: `npm run balance:gs75`

## Current Gameplay Contracts (from code)

Maps and progression
- Implemented maps: `map_01_river_bend` through `map_05_blackwater_lattice`.
- Default map: `map_01_river_bend`.
- Sequential unlock logic is enforced; previous maps must be completed.
- Campaign pass criteria are embedded in map config (`passCriteria`) and global campaign metadata.

Economy and failure model
- Starting map coins are map-specific (Map 1 starts at `10000`); not globally fixed across all maps.
- Slots require activation payment before tower build.
- Towers can be built/upgraded during active waves.
- Coins can go negative after leaks.
- If a fresh run has no towers and coins drop to `<= 0`, economy auto-recovers to map starting coins (`recoverFreshRunEconomy`).
- Tower selling is enabled with `70%` refund of cumulative tower investment.
- Leak penalties affect both coins and XP; XP is floored at zero.
- Intermediate wave leaks do not hard-stop map progression; final-wave leaks can end map as defeat.

Towers and enemies
- Tower IDs: `arrow`, `bone` (Bomb Tower), `magic_fire`, `magic_wind`, `magic_lightning`.
- Max tower level: 50.
- Enemies include `scout`, `raider`, `barge`, `juggernaut` with map-level enemy scaling.
- Build slots are authored coordinates. Do not auto-generate or offset slots.

## UI and Persistence Contracts

HUD and UI
- Top overlay HUD supports hide/show toggle (`toggle-overlay-hud`).
- Report and curve panels are draggable/closable and persist visibility in saved progress.
- Fast wave compression and auto-continue behavior are persisted.

Progress persistence
- Client persists to localStorage plus server endpoint `/api/progress`.
- Server session resolution uses `homeland_sid` cookie with IP fallback mapping.
- Boot hydration uses fast remote fetch timeout (`REMOTE_PROGRESS_TIMEOUT_MS`) then slow-path retry.
- Keep persistence payloads backward-safe and guarded by version fields.

## Architecture Expectations for New Work

When adding or changing mechanics, update all relevant layers:

1. Data/config
- Add fields in `web/src/config.js` first.
- Avoid hardcoded balance values in `game-core` or UI when data can be config-driven.

2. Simulation
- Implement behavior in `web/src/game-core.js`.
- Keep state transitions explicit (`build_phase`, `wave_running`, `wave_result`, `map_result`).

3. UI
- Reflect new state/actions in `web/src/app.js` and `web/index.html`.
- Keep HUD text and controls aligned with simulation truth.

4. Persistence
- Include new UI/game fields in export/import payload paths.
- Ensure local and remote progress remain compatible.

5. Tests
- Add/adjust tests in `web/tests/` for gameplay regressions.
- Add E2E only where UI interaction risks regressions.

## Balancing Protocol (Required)

GS75 CUDA-first rule
- On `GS75`, CUDA path must be attempted first for Monte Carlo.
- On non-GS75 hosts, first attempt remote GS75 execution via SSH:
  - `ssh GS75 'cd /Users/rc/Project/Homeland && npm run balance:gs75'`
- CPU fallback is allowed only after GS75/CUDA path is unavailable and must be documented.

Coverage rule
- A balancing cycle must include:
  - random baseline (`random_all`)
  - retained-coins campaign chaining baseline (`r[N]`)
  - fixed-budget pass-rate checks
  - mixed policy baseline (`balanced`)
  - mono tower scenarios
  - at least 3 duo scenarios
  - OAT sensitivity for `windSlowMult`, `bombSplashMult`, `fireDpsMult`

Difficulty targets
- Random-policy clear-rate trend target:
  - Map 1: ~90%
  - Map 2: ~85%
  - Map 3: ~80%
  - Map 4: ~77%
  - Map 5: `58% +/- 5%`

## Cloudflare Publish Rules

Required hostname
- `https://homeland.secana.top`

Default publish expectation
- After meaningful code changes, publish unless the user explicitly says not to.
- Minimum verification:
  - `curl -I https://homeland.secana.top` returns HTTP `200`
  - HTML includes expected new marker/content

Tunnel scripts
- Setup: `scripts/cloudflare-tunnel-setup.sh`
- Run: `scripts/cloudflare-tunnel-run.sh`

## Git Workflow Requirements

- Make small, incremental commits.
- Commit messages must be explicit and descriptive.
- Push frequently; do not batch large undocumented changes.
- Do not rewrite unrelated history.

## Execution Constraints

- Never run destructive git commands unless explicitly requested.
- Do not move authored build-slot coordinates.
- Keep docs in sync when rules/workflows change.
- If running heavy or environment-coupled operations, prefer target machine workflows (GS75 / deployed staging) over local-only assumptions.
- Per project rule: avoid running long-lived server processes on this machine unless strictly required for macOS-only work; otherwise run/deploy on GS75.

## Definition of Done for Gameplay Changes

- Mechanic works in playable web runtime.
- Behavior is config-driven where practical.
- Edge cases covered by tests.
- `README.md` and/or `AGENTS.md` updated when contracts change.
