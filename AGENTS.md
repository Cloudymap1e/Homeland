# AGENTS.md

This file defines the operational contract for agents working in Homeland. Follow this file before running or changing anything.

## Project Status Snapshot

- Runtime of record: browser JS prototype under `web/`.
- Primary deploy target: Cloudflare Pages project `homeland-web` serving `dist/` plus `functions/`.
- Game type: river-route tower defense against pirate fleets.
- Live campaign scope: 5 playable maps (`map_01_river_bend` to `map_05_blackwater_lattice`), 50 tower levels, branching routes, map unlock progression.
- Legacy Python under `src/homeland` is reference-only and not the primary implementation path.
- Planning docs under `docs/*.md` are historical/supporting context; generated reports under `docs/perf/` are evidence, not runtime contracts. Runtime behavior must be taken from current source owners in this file.

## Source of Truth

- Gameplay/balance configs and map authored coordinates: `web/src/config.js`.
- Runtime game loop/state machine: `web/src/game-core.js`.
- Rendering/UI/HUD/persistence orchestration: `web/src/app.js`.
- Production progress API (Cloudflare Pages Functions + D1): `functions/api/progress.js`.
- Local dev progress API emulation + static server: `scripts/dev-server.mjs`.
- D1 schema: `schema/progress.sql`.
- Production bundle generation and cache headers: `scripts/build-web.mjs`.
- Static dist smoke preview (stubbed `/api/progress`): `scripts/preview-web.mjs`.
- Monte Carlo and balance validation: `scripts/balance-sim.mjs` + `scripts/fast-game-core.mjs`.
- CUDA wave backend: `scripts/cuda/wave_sim.cu`, `scripts/gpu-wave-runner.mjs`, `scripts/build-gpu-wave-sim.sh`.
- Load/startup performance harness: `scripts/perf/load-metrics.mjs`.
- Production config and bindings: `wrangler.toml`.
- Progress migration tooling: `scripts/migrate-progress-to-d1.mjs`.

Do not invent parallel gameplay configs or duplicate rule constants outside these owners. Do not hand-edit generated artifacts under `dist/`, local persistence under `.data/`, or perf outputs under `docs/perf/` unless the task explicitly targets those files.

## Execution Entry Points

- Local static + dev progress API (only when explicitly needed): `npm run dev` (`scripts/dev-server.mjs`, serves on `127.0.0.1:4173`).
- Build production web bundle: `npm run build:web`.
- Preview built bundle: `npm run preview:web` (static smoke only; `/api/progress` is a stub that returns `progress: null`).
- Preview built bundle with Pages runtime shim: `npm run pages:dev` (use this or deployed Pages for persistence/API validation; rebuild `dist/` first).
- Deploy to Cloudflare Pages: `npm run pages:deploy` (deploys the current `dist/`; do not skip a fresh `npm run build:web`).
- Run D1 progress migration: `npm run migrate:d1`.
- Run unit/system tests: `npm test`.
- Run E2E regression: `npm run test:e2e` (supports `HOMELAND_E2E_BASE_URL` override).
- Run load/perf harness: `npm run perf:load`.
- Build native GPU wave backend binary: `npm run build:gpu-wave`.
- Tunnel fallback commands: `npm run tunnel:quick`, `npm run tunnel:run`.

## Runtime Architecture (Current)

### Frontend Runtime

- `web/index.html` defines the command deck and HUD controls:
  - map select, reset run, start wave, speed toggle, fast-forward, auto waves,
  - report panel toggle, curve panel toggle, overlay HUD toggle.
- `web/src/app.js` owns:
  - frame loop and rendering layers,
  - fast/static terrain layer cache and deferred full-quality redraws,
  - slot-popout interactions (activate/build/upgrade/sell),
  - fast-forward wave compression and auto-continue flow,
  - draggable/closable report and curve windows plus overlay HUD visibility,
  - persistence bootstrap/merge across local + remote progress stores.
- `web/src/game-core.js` owns:
  - state machine (`build_phase`, `wave_running`, `wave_result`, `map_result`),
  - tower placement/upgrade/sell and slot activation,
  - wave spawn progression and route movement,
  - combat effects (bomb splash, fire zones + burn, wind slow multi-target, lightning chain),
  - campaign unlock/completion bookkeeping and carry-resource map switching,
  - leak penalties and map clear/defeat resolution,
  - import/export state contract for persistence and simulator parity.

### Persistence and Progress Contract

- Endpoint: `/api/progress` (GET/PUT/POST/DELETE).
- Persisted payload shape:
  - root fields: `version`, `updatedAt`, `autoContinueEnabled`, `selectedTowerId`, `selectedCurveTowerId`,
  - UI prefs: `reportPanelVisible`, `curvePanelVisible`, `overlayHudVisible`,
  - run state: nested `game` object from `HomelandGame.exportState()`.
- Request payload contract for PUT/POST:
  - body must be a JSON object (arrays/scalars rejected),
  - body size limit is `1,000,000` bytes (dev + Pages function parity).
- Session identity:
  - primary: `homeland_sid` cookie,
  - fallback mapping: client IP index.
- Local dev persistence:
  - file-backed JSON at `.data/player-progress.json`,
  - top-level store shape mirrors the production session lookup entities (`sessions`, `ip_index`), with local JSON using `ipIndex` for the IP map.
  - served by `scripts/dev-server.mjs`.
- Production persistence:
  - Cloudflare Pages Function at `functions/api/progress.js`,
  - D1 binding `PROGRESS_DB`,
  - tables `sessions` and `ip_index` from `schema/progress.sql`.
- Client behavior (`web/src/app.js`):
  - loads local snapshot first, then remote with timeout-retry merge,
  - keeps local fallback if remote save fails,
  - debounced + periodic save, plus visibility/unload keepalive save (`sendBeacon` first, `POST` fallback).
- DELETE behavior:
  - clears saved progress to `null`,
  - keeps the session row/session cookie intact instead of deleting the identity record.
- `npm run preview:web` does not validate this contract; it only serves static assets with a fake `/api/progress` response.

### Build and Deploy Path

- Build: `npm run build:web` (esbuild bundles app, fingerprints JS/CSS, and writes `dist/_headers` cache policy).
- Preview dist: `npm run preview:web` (static artifact smoke only).
- Preview Pages runtime: `npm run pages:dev` (functions + bindings shim over current `dist/` output).
- Cloudflare Pages deploy: `npm run pages:deploy` (publishes current `dist/` output).
- Tunnel publish hostname requirement: `homeland.secana.top`.
- Tunnel scripts:
  - setup: `scripts/cloudflare-tunnel-setup.sh`
  - run: `scripts/cloudflare-tunnel-run.sh`
- `wrangler.toml` ships placeholder D1 IDs; live deploys require real `database_id` / `preview_database_id` values before persistence validation.
- `dist/` is disposable output. Regenerate it from source rather than editing built files.
- Avoid long-lived local serving for routine validation; prefer deploying to active staging/production target and verifying there.

## Gameplay Rules (Current Contract)

- Starting map: `Map 1`.
- Starting coins map 1: `10,000`.
- Towers: `arrow`, `bone` (bomb), `magic_fire`, `magic_wind`, `magic_lightning`.
- Towers can only be built on authored build slots that are not river-blocked.
- Build slot coordinates are authoritative map data:
  - never auto-generate, densify, offset, or "fix up" slot coordinates at runtime.
- Slot activation is required before building towers.
- Slot activation, build, upgrade, and tower selling are allowed during active waves; `map_result` is the lockout state.
- Tower selling refund is `70%` of total invested tower cost.
- Boats do not attack towers in current scope.
- Leak penalties reduce coins and XP (XP floors at 0).
- Coins are allowed to go negative during failed waves; run remains resumable.
- Recovery guard exists for fresh-run soft lock:
  - browser runtime behavior: if run is fresh, no towers, and coins `<= 0`, economy resets to map starting coins.
- Final-wave leaks force map defeat (`reason: leaks`); no-leak full clear grants map rewards and unlock checks.

## Config-First Balancing Rules

- Keep balancing parameters in `web/src/config.js`, not hardcoded in gameplay logic.
- Preferred tuning levers for progression difficulty:
  - `enemyScale` (hp/speed/rewards),
  - wave composition/spawn interval,
  - map leak penalties and slot activation economics.
- Avoid frequent tower-curve rewrites unless a tower role is fundamentally broken.

## Simulation Parity Contract

- `scripts/fast-game-core.mjs` is the data-oriented simulation mirror for combat/economy/wave-resolution semantics from `web/src/game-core.js` used by Monte Carlo runs; it is not a full clone of browser UI, persistence, or import/export plumbing.
- `scripts/balance-sim.mjs` supports `--engine=classic|fast|gpu`:
  - `classic`: browser `HomelandGame` reference path,
  - `fast`: default data-oriented simulator,
  - `gpu`: fast simulator with native CUDA wave-resolution sidecar.
- `scripts/gpu-wave-runner.mjs` and `scripts/cuda/wave_sim.cu` are the optional native wave-resolution path used by `--engine=gpu`.
- Fresh-run zero-coin recovery is currently a browser runtime guard in `web/src/game-core.js`; current Monte Carlo flows start from map starting coins and do not depend on it. If a simulator path can enter that state, port the rule deliberately.
- When changing combat math, wave resolution, leak penalties, slot rules, economy flow, or map unlock semantics, explicitly decide whether the change affects:
  - browser runtime only,
  - fast simulator parity,
  - GPU engine parity.
- If gameplay semantics change, keep `web/src/game-core.js` and `scripts/fast-game-core.mjs` aligned in the same work stream unless the change is intentionally runtime-only and documented.
- If the GPU engine remains supported for the affected path, update `scripts/cuda/wave_sim.cu` / `scripts/gpu-wave-runner.mjs` or explicitly avoid GPU validation until parity is restored.

## Monte Carlo Balancing (GS75 CUDA-First)

- First attempt must be on `GS75` with CUDA-required mode:
  - `ssh GS75 'cd /Users/rc/Project/Homeland && npm run balance:gs75'`
- `balance:gs75` fails fast if CUDA runtime is unavailable.
- Only if GS75 path is unavailable or CUDA runtime missing, run CPU fallback:
  - `npm run balance:sim`
- Optional fast CUDA availability smoke (non-required): `npm run balance:cuda-check`

### Required Coverage in a Balancing Cycle

- random baseline (`random_all`),
- campaign retention baseline (`~100` runs/map),
- fixed-budget pass-rate check (`~1000` runs/map),
- mixed baseline (`balanced`),
- mono scenarios (arrow, bomb, fire, wind, lightning),
- at least 3 duo scenarios,
- OAT sensitivity for:
  - `windSlowMult`,
  - `bombSplashMult`,
  - `fireDpsMult`.
- Preferred command sequence:
  - `npm run balance:gs75` (primary full CUDA-required suite),
  - `npm run balance:standard` (criteria-only confirmation),
  - `npm run balance:diversity` (mono/duo/mixed robustness),
  - `npm run balance:verify` (quick random-all confirmation without search),
  - `npm run balance:gpu-check` (quick native GPU sanity when CUDA path changes).

### Campaign Targets

- Fail penalty budget: about 2 run-equivalents of XP progress.
- Unlock run targets trend: `30`, `50`, `60`, `90`, `100`, `120`.
- Random-policy pass-rate targets trend:
  - Map 1: ~90%
  - Map 2: ~85%
  - Map 3: ~80%
  - Map 4: ~77%
  - Map 5: `58% +/- 5%` (active)
  - Map 6+: derive from retained-coins chaining after map 5 stabilizes.

## Tests and Verification

- Unit/system tests: `npm test` (Node test runner over `web/tests/*.test.mjs`).
- E2E regression: `npm run test:e2e` (Playwright against a real runtime surface).
- E2E base URL override supported with `HOMELAND_E2E_BASE_URL`.
- Prefer deployed/staging targets via `HOMELAND_E2E_BASE_URL` for runtime verification; only fall back to the local dev server when explicitly necessary.
- Performance/load metrics: `npm run perf:load`.
  - default comparison targets: `http://127.0.0.1:4173` and `https://homeland.secana.top`,
  - override with `--urls=<comma-separated URLs>` when validating specific environments.
- `npm run preview:web` is not a persistence/API test surface; use `npm run pages:dev` or deployed Pages when the request touches `/api/progress`.
- For persistence changes, validate both:
  - local dev API flow (`scripts/dev-server.mjs`),
  - Pages Function + D1 flow (`functions/api/progress.js` + migrated schema).
- For gameplay changes that affect simulation semantics, validate browser tests plus at least one balance/simulator path (`npm run balance:verify`; add `npm run balance:gpu-check` when GPU path is affected).
- Legacy Python tests under `tests/*.py` cover reference prototype behavior only; do not treat them as the primary gameplay validation gate.

## Agent Workflow Rules

- Keep commits small and focused; commit and push frequently.
- Use `<Type>: <summary>` commit messages.
- Preferred prefixes for new work: `Fix`, `Feature`, `Docs`, `Perf`, `Deploy`, `Test`, `Balance`.
- Historical history also contains `UI`, `UX`, `Visual`, `Tooling`, `Chore`, `Plan`, `Prototype`, and `Improve`; do not rewrite old commits, but prefer the canonical set above for new work unless another prefix is materially clearer.
- Validate commit-message hygiene against recent history before finalizing a docs/process-only run.
- Do not run long-lived local servers unless explicitly necessary for the requested task.
- Prefer deployed target verification for runtime checks; do not rely on prolonged local-host sessions.
- Do not modify legacy Python prototype for gameplay features unless user explicitly asks.
- Treat `docs/prototype-design.md`, `docs/action-plan.md`, `docs/task-list.md`, and `docs/design-graphics-plan.md` as planning references, not runtime contracts.
- When changing gameplay rules or architecture contracts:
  - update this file and `README.md` in the same work stream.
- When modifying persistence contract:
  - keep `scripts/dev-server.mjs` and `functions/api/progress.js` behavior aligned.
- When modifying persisted payload shape:
  - keep localStorage merge/bootstrap behavior backward compatible or bump the persistence version deliberately across client and server code paths.
- When modifying gameplay semantics used by Monte Carlo:
  - keep `scripts/fast-game-core.mjs` aligned with `web/src/game-core.js`,
  - touch GPU parity files when `--engine=gpu` should continue to represent the same rules.
- When modifying map slots:
  - validate blocked-slot behavior and no-river-placement tests.
- Diagnose failures by source before fixing:
  - local runtime bug,
  - CI/CD/deploy pipeline issue,
  - local-vs-server sync discrepancy.

## Definition of Done (Per Gameplay/System Change)

- Behavior works in playable web runtime.
- Data remains config-driven (no hidden constants in runtime logic).
- Core edge cases covered by automated tests or clearly documented manual checks.
- Fast simulator / GPU parity updated or explicitly scoped when affected.
- Docs updated (`AGENTS.md` + relevant runtime docs).
- Changes committed with clear message and pushed.
