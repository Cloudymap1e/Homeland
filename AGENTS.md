# AGENTS.md

This file defines the operational contract for agents working in Homeland. Follow this file before running or changing anything.

## Project Status Snapshot

- Runtime of record: browser JS prototype under `web/`.
- Game type: river-route tower defense against pirate fleets.
- Live campaign scope: 5 playable maps (`map_01_river_bend` to `map_05_blackwater_lattice`), 50 tower levels, branching routes, map unlock progression.
- Legacy Python under `src/homeland` is reference-only and not the primary implementation path.

## Source of Truth

- Gameplay/balance configs and map authored coordinates: `web/src/config.js`.
- Runtime game loop/state machine: `web/src/game-core.js`.
- Rendering/UI/HUD/persistence orchestration: `web/src/app.js`.
- Runtime shell and control surface markup: `web/index.html`.
- Runtime visual language and layout contracts: `web/styles.css`.
- Production progress API (Cloudflare Pages Functions + D1): `functions/api/progress.js`.
- Local dev progress API emulation + static server: `scripts/dev-server.mjs`.
- D1 schema: `schema/progress.sql`.
- Monte Carlo and balance validation: `scripts/balance-sim.mjs` + `scripts/fast-game-core.mjs`.
- CUDA wave backend: `scripts/cuda/wave_sim.cu`, `scripts/gpu-wave-runner.mjs`, `scripts/build-gpu-wave-sim.sh`.
- Production config and bindings: `wrangler.toml`.
- Progress migration tooling: `scripts/migrate-progress-to-d1.mjs`.

Do not invent parallel gameplay configs or duplicate rule constants outside these owners.

## Execution Entry Points

- Local static + dev progress API (only when explicitly needed): `npm run dev` (`scripts/dev-server.mjs`, serves on `127.0.0.1:4173`).
- Build production web bundle: `npm run build:web`.
- Preview built bundle: `npm run preview:web`.
- Preview built bundle with Pages runtime shim: `npm run pages:dev`.
- Deploy to Cloudflare Pages: `npm run pages:deploy`.
- Run D1 progress migration: `npm run migrate:d1`.
- Run unit/system tests: `npm test`.
- Run E2E regression: `npm run test:e2e` (supports `HOMELAND_E2E_BASE_URL` override).
- Run load/perf harness: `npm run perf:load`.
- Run full GS75 CUDA-required balance cycle: `npm run balance:gs75`.
- Run criteria-only balance confirmation: `npm run balance:standard`.
- Run policy-diversity robustness suite: `npm run balance:diversity`.
- Run quick random-all verification: `npm run balance:verify`.
- Run CUDA availability smoke: `npm run balance:cuda-check`.
- Run native GPU backend sanity suite: `npm run balance:gpu-check`.
- CPU fallback balance sweep: `npm run balance:sim`.
- Build native GPU wave backend binary: `npm run build:gpu-wave`.
- Quick ephemeral tunnel to local runtime: `npm run tunnel:quick`.
- Named tunnel run using `.cloudflared/config.yml`: `npm run tunnel:run`.

## Runtime Architecture (Current)

### Frontend Runtime

- `web/index.html` defines the command deck and HUD controls:
  - map select, reset run, start wave, speed toggle, fast-forward, auto waves,
  - report panel toggle, curve panel toggle, top HUD strip toggle.
- `web/styles.css` defines:
  - top control deck layout and responsive behavior,
  - HUD chips/panels and slot-popout presentation,
  - draggable panel visual styles and visibility classes.
- `web/src/app.js` owns:
  - frame loop and rendering layers,
  - slot-popout interactions (activate/build/upgrade/sell),
  - fast-forward wave compression and auto-continue flow,
  - draggable/closable report and curve windows,
  - top HUD strip visibility toggle,
  - persistence bootstrap/merge across local + remote progress stores.
- `web/src/game-core.js` owns:
  - state machine (`build_phase`, `wave_running`, `wave_result`, `map_result`),
  - map unlock gating and campaign completion state,
  - tower placement/upgrade/sell and slot activation,
  - blocked-slot detection using route clearance,
  - wave spawn progression and route movement,
  - combat effects (bomb splash, fire zones + burn, wind slow multi-target, lightning chain),
  - leak penalties and map clear/defeat resolution,
  - import/export state contract for persistence.

### Persistence and Progress Contract

- Endpoint: `/api/progress` (GET/PUT/POST/DELETE).
- Request payload contract for PUT/POST:
  - body must be a JSON object (arrays/scalars rejected),
  - body size limit is `1,000,000` bytes (dev + Pages function parity).
- Session identity:
  - primary: `homeland_sid` cookie,
  - fallback mapping: client IP index.
- Local dev persistence:
  - file-backed JSON at `.data/player-progress.json`,
  - served by `scripts/dev-server.mjs`.
- Production persistence:
  - Cloudflare Pages Function at `functions/api/progress.js`,
  - D1 binding `PROGRESS_DB`,
  - tables `sessions` and `ip_index` from `schema/progress.sql`.
- Client behavior (`web/src/app.js`):
  - loads local snapshot first, then remote with timeout-retry merge,
  - keeps local fallback if remote save fails,
  - debounced + periodic save, plus unload keepalive save.

### Build and Deploy Path

- Build: `npm run build:web` (esbuild bundles app + hashed assets into `dist/`).
- Preview dist: `npm run preview:web`.
- Cloudflare Pages deploy: `npm run pages:deploy`.
- Tunnel publish hostname requirement: `homeland.secana.top`.
- Tunnel scripts:
  - setup: `scripts/cloudflare-tunnel-setup.sh`
  - run: `scripts/cloudflare-tunnel-run.sh`
- Avoid long-lived local serving for routine validation; prefer deploying to active staging/production target and verifying there.

## Gameplay Rules (Current Contract)

- Starting map: `Map 1`.
- Starting coins map 1: `10,000`.
- Towers: `arrow`, `bone` (bomb), `magic_fire`, `magic_wind`, `magic_lightning`.
- Towers can only be built on authored build slots that are not river-blocked.
- Build slot coordinates are authoritative map data:
  - never auto-generate, densify, offset, or "fix up" slot coordinates at runtime.
- Slot activation is required before building towers.
- Build and upgrade are allowed during active waves.
- Tower selling is enabled; refund is `70%` of total invested tower cost.
- Boats do not attack towers in current scope.
- Leak penalties reduce coins and XP (XP floors at 0).
- Coins are allowed to go negative during failed waves; run remains resumable.
- Recovery guard exists for fresh-run soft lock:
  - if run is fresh, no towers, and coins `<= 0`, economy resets to map starting coins.
- Final-wave leaks force map defeat (`reason: leaks`); no-leak full clear grants map rewards and unlock checks.

## Config-First Balancing Rules

- Keep balancing parameters in `web/src/config.js`, not hardcoded in gameplay logic.
- Preferred tuning levers for progression difficulty:
  - `enemyScale` (hp/speed/rewards),
  - wave composition/spawn interval,
  - map leak penalties and slot activation economics.
- Avoid frequent tower-curve rewrites unless a tower role is fundamentally broken.

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
- E2E regression: `npm run test:e2e` (Playwright).
- E2E base URL override supported with `HOMELAND_E2E_BASE_URL`.
- Performance/load metrics: `npm run perf:load`.
  - default comparison targets: `http://127.0.0.1:4173` and `https://homeland.secana.top`,
  - override with `--urls=<comma-separated URLs>` when validating specific environments.
- For persistence changes, validate both:
  - local dev API flow (`scripts/dev-server.mjs`),
  - Pages Function + D1 flow (`functions/api/progress.js` + migrated schema).
- Legacy Python tests under `tests/*.py` cover reference prototype behavior only; do not treat them as the primary gameplay validation gate.

## Agent Workflow Rules

- Keep commits small and focused; commit and push frequently.
- Every commit message must clearly describe intent (`Fix: ...`, `Feature: ...`, `Docs: ...`, `Perf: ...`, `Deploy: ...`, `Test: ...`, `Balance: ...`, `Tooling: ...`, `UI: ...`, `UX: ...`, `Visual: ...`, `Plan: ...`, `Chore: ...`).
- Validate commit-message hygiene against recent history before finalizing a docs/process-only run.
- Do not run long-lived local servers unless explicitly necessary for the requested task.
- This machine should not host routine runtime sessions; prefer deployed target checks or GS75 execution unless local runtime is mandatory for Mac-only reproduction.
- Prefer deployed target verification for runtime checks; do not rely on prolonged local-host sessions.
- Do not modify legacy Python prototype for gameplay features unless user explicitly asks.
- If README and runtime behavior conflict, treat `web/src/*` + this file as source of truth and patch README in the same change stream.
- When changing gameplay rules or architecture contracts:
  - update this file and `README.md` in the same work stream.
- When modifying persistence contract:
  - keep `scripts/dev-server.mjs` and `functions/api/progress.js` behavior aligned.
- When modifying map slots:
  - validate blocked-slot behavior and no-river-placement tests.
- Diagnose failures by source before fixing:
  - local runtime bug,
  - CI/CD/deploy pipeline issue,
  - local-vs-server sync discrepancy.

## Docs Sync Checklist (Required for AGENTS/README updates)

- Scan recent commits (`git log --oneline`) and align operational guidance with current commit taxonomy.
- Verify every command in docs against `package.json` scripts and referenced script files.
- Re-validate architecture claims against runtime owners:
  - `web/src/config.js`,
  - `web/src/game-core.js`,
  - `web/src/app.js`,
  - `functions/api/progress.js`,
  - `scripts/dev-server.mjs`.
- Re-check persistence contract invariants (session ID source, payload shape, body limits) in both dev and production handlers.

## Definition of Done (Per Gameplay/System Change)

- Behavior works in playable web runtime.
- Data remains config-driven (no hidden constants in runtime logic).
- Core edge cases covered by automated tests or clearly documented manual checks.
- Docs updated (`AGENTS.md` + relevant runtime docs).
- Changes committed with clear message and pushed.
