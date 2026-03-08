# AGENTS.md

This file is the operational contract for agents working in Homeland. Read it before running commands or editing code.

## Current Product State

- Runtime of record: browser JS implementation in `web/`.
- Game scope: river-route tower defense campaign against pirate fleets.
- Live content: 5 playable maps (`map_01_river_bend` through `map_05_blackwater_lattice`), 50 levels per tower, multi-route pathing, sequential map unlocks.
- Legacy Python under `src/homeland` is reference-only and not the feature delivery path.

## Canonical Ownership (Do Not Fork These Rules)

- Balance + authored map coordinates + progression constants: `web/src/config.js`.
- Runtime simulation + state machine + combat resolution: `web/src/game-core.js`.
- UI rendering + HUD + interactions + persistence orchestration: `web/src/app.js`.
- Local progress API emulator + static host: `scripts/dev-server.mjs`.
- Production progress API (Cloudflare Pages Function): `functions/api/progress.js`.
- D1 schema contract: `schema/progress.sql`.
- Monte Carlo + balancing harness: `scripts/balance-sim.mjs` and `scripts/fast-game-core.mjs`.
- GPU wave backend: `scripts/cuda/wave_sim.cu`, `scripts/gpu-wave-runner.mjs`, `scripts/build-gpu-wave-sim.sh`.
- Cloudflare config and bindings: `wrangler.toml`.
- D1 migration utility: `scripts/migrate-progress-to-d1.mjs`.

Never duplicate gameplay constants in `app.js`/tests/scripts if they already exist in `web/src/config.js`.

## Operational Commands

- `npm run build:web`: build optimized web bundle into `dist/` with hashed assets.
- `npm run preview:web`: preview built `dist/` on `127.0.0.1:4180`.
- `npm run pages:deploy`: deploy `dist/` to Cloudflare Pages project `homeland-web`.
- `npm run pages:dev`: run local Pages runtime against built assets.
- `npm run migrate:d1`: migrate progress payloads into D1 schema.
- `npm run test`: Node unit/system tests (`web/tests/*.test.mjs`).
- `npm run test:e2e`: Playwright e2e (`web/tests/slot-popout.e2e.spec.mjs`).
- `npm run perf:load`: Playwright load/interactive metrics capture to `docs/perf/`.
- `npm run balance:gs75`: CUDA-required full Monte Carlo suite.
- `npm run balance:standard`: criteria-only pass-rate/retention confirmation.
- `npm run balance:diversity`: mono/duo/mixed policy robustness sweep.
- `npm run balance:gpu-check`: native GPU wave binary quick check.
- `npm run balance:cuda-check`: CUDA-enabled quick balancing probe.
- `npm run balance:sim`: CPU fallback full suite (only when GS75/CUDA path unavailable).
- `npm run build:gpu-wave`: compile GPU wave simulator binary.
- `npm run tunnel:run` / `npm run tunnel:quick`: Cloudflare tunnel helpers.

Local server note:
- Avoid local long-running servers for routine validation.
- Do not run services on this machine unless required for the task; prefer deploy + validation on staging/production target and GS75 where applicable.

## Runtime Architecture

### `web/index.html` (UI Surface)

- Defines command deck and HUD toggles:
  - map select, reset run, start wave, speed toggle,
  - fast wave compression (`Fast 1s Fleet Run`),
  - auto wave progression toggle,
  - report window, curve window, top HUD strip visibility toggles.

### `web/src/app.js` (Orchestration Layer)

- Owns render loop and frame-step orchestration around `HomelandGame`.
- Handles slot-popout interactions: activate slot, build, upgrade, sell.
- Controls fast-forward compression and auto-continue map/wave flow.
- Maintains draggable report/curve panels and panel visibility persistence.
- Builds/uses cached static terrain + river layers (low-quality-first then full-quality refinement).
- Persistence strategy:
  - local storage key `homeland_progress_v1`,
  - remote endpoint `/api/progress`,
  - boot sequence = local snapshot first, fast remote fetch (timeout), then slow retry merge,
  - save strategy = debounced + periodic + unload keepalive.

### `web/src/game-core.js` (Simulation Core)

- Canonical game states: `build_phase`, `wave_running`, `wave_result`, `map_result`.
- Enforces authored-slot placement + river overlap blocking.
- Supports slot activation economics and in-wave build/upgrade.
- Implements tower sell with refund of 70% of invested tower cost.
- Resolves enemy spawning/pathing/combat/leaks/map results.
- Supports negative coins after leaks while preserving resumable run flow.
- Contains fresh-run soft-lock recovery: if fresh run has no towers and `coins <= 0`, reset to map starting coins.
- Handles campaign progression unlock logic and persistence import/export schema.

## Persistence Contract (`/api/progress`)

- Methods: `GET`, `PUT`, `POST`, `DELETE`.
- Session identity:
  - primary: `homeland_sid` cookie,
  - fallback: IP-to-session mapping.
- Payload contract: JSON object representing persisted app/game snapshot.
- Local dev implementation:
  - `scripts/dev-server.mjs`,
  - durable store `.data/player-progress.json`.
- Production implementation:
  - `functions/api/progress.js` with D1 binding `PROGRESS_DB`,
  - schema tables `sessions` + `ip_index`.
- Alignment rule: any contract change must be applied to both local emulator and Pages Function in the same change set.

## Build and Deploy Workflow

- Build output is `dist/` with cache headers (`_headers`) generated by `scripts/build-web.mjs`.
- Cloudflare target is defined in `wrangler.toml` (`homeland-web`, D1 binding `PROGRESS_DB`).
- Primary published host expectation: `homeland.secana.top`.
- Tunnel helpers:
  - setup: `scripts/cloudflare-tunnel-setup.sh`
  - run: `scripts/cloudflare-tunnel-run.sh`

Pipeline is: local changes -> GitHub push -> CI/CD deploy to Pages target.

## Gameplay Contract (Enforced)

- Start map: `Map 1` (`map_01_river_bend`).
- Start coins map 1: `10,000`.
- Towers: `arrow`, `bone`, `magic_fire`, `magic_wind`, `magic_lightning`.
- Build slots are authored data. Never auto-generate/shift/densify slot coordinates.
- Only non-river-blocked authored slots are buildable.
- Slot activation is required before building.
- Build and upgrade during active wave are valid behaviors.
- Selling is enabled; refund = 70% of cumulative tower spend.
- Enemy boats currently do not attack towers.
- Leak penalties deduct coins and XP (XP floors at 0).
- Coins can go negative and run must remain resumable.
- Final-wave leaks force map defeat (`reason: leaks`).
- Leak-free full clear grants map rewards and unlock checks.

## Balancing Policy (Config-First)

- Keep gameplay tuning in `web/src/config.js`.
- Prefer tuning levers:
  - enemy scaling (`hp`, speed, rewards),
  - wave composition and spawn pacing,
  - map leak penalties and slot activation economics.
- Avoid ad-hoc runtime constants in `game-core.js` unless they are true engine invariants.

## Monte Carlo and GPU Workflow

GS75-first requirement:
- First attempt always on GS75 with CUDA required:
  - `ssh GS75 'cd /Users/rc/Project/Homeland && npm run balance:gs75'`
- If CUDA unavailable or GS75 unreachable, use CPU fallback:
  - `npm run balance:sim`

Required balancing coverage per cycle:
- random baseline (`random_all`),
- retention baseline (`~100` runs/map),
- fixed-budget pass-rate check (`~1000` runs/map),
- mixed policy baseline (`balanced`),
- mono policy scenarios (all five tower monos),
- at least three duo policy scenarios,
- OAT checks for:
  - `windSlowMult`,
  - `bombSplashMult`,
  - `fireDpsMult`.

Recommended command order:
- `npm run balance:gs75`
- `npm run balance:standard`
- `npm run balance:diversity`
- `npm run balance:gpu-check`

Campaign targets:
- fail penalty budget: ~2 run-equivalents.
- unlock run targets trend: `30, 50, 60, 90, 100, 120`.
- random-policy pass-rate trend:
  - Map 1 `~90%`
  - Map 2 `~85%`
  - Map 3 `~80%`
  - Map 4 `~77%`
  - Map 5 `58% +/- 5%` (active target)
  - Map 6+ derived from retained-coins chaining.

## Testing and Verification

- Unit/system: `npm test`.
- E2E regression: `npm run test:e2e` (supports `HOMELAND_E2E_BASE_URL`).
- Perf/load: `npm run perf:load` (writes dated JSON under `docs/perf/`).
- For persistence changes, verify both:
  - local flow (`scripts/dev-server.mjs`),
  - production flow (`functions/api/progress.js` + D1 schema).
- Legacy Python tests in `tests/*.py` are non-blocking reference checks only.

## Commit and Workflow Rules

- Keep commits small, focused, and frequent.
- Push frequently to keep local/remote/deployed states aligned.
- Commit message prefixes must be explicit:
  - `Fix:`, `Feature:`, `Docs:`, `Perf:`, `Test:`, `Deploy:`, `Chore:`.
- Diagnose failures before patching by classifying root cause:
  - local runtime bug,
  - CI/CD/deploy bug,
  - local-vs-server sync bug.
- Do not modify legacy Python runtime for gameplay feature work unless explicitly requested.
- If gameplay architecture/rules contracts change, update `AGENTS.md` and `README.md` in the same work stream.

## Recent Commit Signal (High Priority Drift Guard)

Recent history shows the active direction:
- docs tightened around operational workflow + runtime architecture,
- HUD controls/panel visibility adjustments,
- resumable progression fixes (negative coins, reset guard, persistence retry),
- server progress migration to Pages Functions + D1,
- fast Monte Carlo engine + CUDA/GPU backend integration,
- authored-slot protection (no runtime slot densification),
- campaign pass-standard formalization and Map 5 target stabilization.

Future changes should not regress these trajectories without explicit product direction.

## Definition of Done (Per System/Gameplay Change)

- Behavior works in browser runtime.
- Rules remain config-driven and centralized.
- Tests or explicit manual checks cover changed edge cases.
- Docs updated when contracts change.
- Changes committed with clear message and pushed.
