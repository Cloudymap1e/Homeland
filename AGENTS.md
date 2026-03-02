# AGENTS.md

This file is the execution contract for coding agents and contributors in this repository.

## 1) Mission and Source of Truth

- Project: Homeland river-route tower defense.
- Current primary runtime: browser JS prototype in `web/`.
- Primary game logic source of truth: `web/src/config.js` and `web/src/game-core.js`.
- UI behavior source of truth: `web/src/app.js` + `web/index.html` + `web/styles.css`.
- Backend persistence source of truth: `functions/api/progress.js` (Cloudflare Pages Function) and `schema/progress.sql` (D1 schema).
- Simulation/balancing source of truth: `scripts/balance-sim.mjs` + `scripts/fast-game-core.mjs` + optional CUDA binary used by `scripts/gpu-wave-runner.mjs`.
- Legacy Python prototype in `src/homeland/` is reference-only and must not be treated as the primary implementation path.

If any old doc conflicts with code, trust active code paths above.

## 2) Current Product Rules (Implemented)

- Player starts from `map_01_river_bend`.
- Maps currently in config: Map 1 through Map 5.
- Towers can only be built on authored build slots and only after slot activation payment.
- Build slots are authored coordinates and must remain exact; do not auto-generate, densify, offset, or infer positions.
- Enemies are pirate boats following map route waypoints with weighted route selection.
- Enemy boats currently do not attack towers.
- Leak events deduct coins and XP; XP floors at `0`.
- Coins may go negative after leaks; this is allowed.
- If a wave leaks before final wave, run remains resumable (back to build phase, towers kept).
- Final-wave leaks produce map defeat (`map_result` with reason `leaks`).
- Tower selling is supported and refunds `70%` of total spent on that tower (build + upgrades).
- Progression uses XP thresholds and sequential campaign unlock logic.

## 3) Data and Gameplay Architecture

### 3.1 Config layer

`web/src/config.js` defines data-driven gameplay:

- `MAPS`: per-map economy, penalties, routes, build slots, waves, pass criteria, unlock requirements.
- `TOWER_CONFIG`: tower families and level curves to level 50.
- `ENEMIES`: enemy base HP/speed/reward profiles.
- `PROGRESSION`: base XP progression constants.
- `CAMPAIGN_INFO`, `CAMPAIGN_PASS_CRITERIA`: campaign-wide balancing metadata.

Tower IDs currently used:

- `arrow` (Arrow Tower)
- `bone` (Bomb Tower behavior, historical ID kept for compatibility)
- `magic_fire`
- `magic_wind`
- `magic_lightning`

### 3.2 Runtime core

`web/src/game-core.js` (`HomelandGame`) owns:

- map loading and slot partitioning (buildable vs blocked river-overlap slots),
- economy and XP mutation,
- wave spawning/state transitions,
- tower build/upgrade/sell,
- combat resolution (fire zones, wind slow, bomb splash, lightning chain),
- map unlock/completion checks,
- import/export state for persistence.

Main game states:

- `build_phase`
- `wave_running`
- `wave_result`
- `map_result`

### 3.3 UI and persistence client

`web/src/app.js` owns:

- canvas rendering and HUD,
- slot popout interactions,
- panel toggles and auto-continue flow,
- save/load orchestration with remote API (`/api/progress`) and local fallback.

### 3.4 Persistence backend

- Local dev API store: `.data/player-progress.json` via `scripts/dev-server.mjs`.
- Production/staging API: Cloudflare Pages Function at `functions/api/progress.js` with D1 binding `PROGRESS_DB`.
- D1 schema: `schema/progress.sql` (`sessions`, `ip_index`).
- Migration helper: `scripts/migrate-progress-to-d1.mjs`.

## 4) Required Engineering Workflow

### 4.1 Git discipline (mandatory)

- Use small, incremental commits.
- Commit messages must clearly describe intent and scope.
- Commit and push frequently; do not batch unrelated large changes.
- Before finalizing, ensure `git status` is clean except intentional modifications.

### 4.2 Bug triage protocol

When debugging, classify the issue explicitly:

- Local machine bug,
- CI/CD/deploy bug,
- local vs deployed sync mismatch.

Fix the actual source category; do not patch symptoms only.

### 4.3 Host execution rule

- Do not run long-lived app server processes on this machine unless explicitly necessary for macOS-local validation.
- Preferred operational target is `GS75` for runtime-heavy operations.
- If local run is unavoidable for a quick check, keep it short and document why.

## 5) Commands and Execution Paths

Repository root: `/Users/rc/Project/Homeland`

Core commands:

- Dev server: `npm run dev` (serves `http://127.0.0.1:4173`)
- Unit tests: `npm test`
- E2E tests: `npm run test:e2e`
- Production build: `npm run build:web`
- Preview build: `npm run preview:web`

Balancing commands:

- Full balancing suite: `npm run balance:sim`
- Pass-standard only: `npm run balance:standard`
- Diversity/OAT only: `npm run balance:diversity`
- GS75 CUDA-required run: `npm run balance:gs75`

Deploy commands:

- Pages deploy: `npm run pages:deploy`
- D1 migration helper: `npm run migrate:d1`

Cloudflare tunnel commands:

- Setup: `./scripts/cloudflare-tunnel-setup.sh`
- Run named tunnel: `./scripts/cloudflare-tunnel-run.sh`
- Quick temporary URL: `npm run tunnel:quick`

## 6) Monte Carlo and Balancing Protocol (Mandatory)

### 6.1 GS75 CUDA-first rule

- On GS75, prioritize CUDA path first.
- If current host is not GS75, first attempt remote execution on GS75.
- Required first attempt:
  - `cd /Users/rc/Project/Homeland`
  - `npm run balance:gs75`
- `balance:gs75` is CUDA-required and should fail fast if CUDA is unavailable.
- Only after explicit CUDA unavailability, use CPU fallback:
  - `npm run balance:sim`

### 6.2 Coverage requirements

A balancing cycle must include:

- random baseline policy,
- campaign retained-coins baseline (`r[N]` chaining),
- fixed-budget pass-rate checks,
- mixed baseline (`balanced`) comparison,
- mono tower scenarios,
- at least 3 duo scenarios,
- OAT sensitivity for `windSlowMult`, `bombSplashMult`, `fireDpsMult`.

### 6.3 Progression criteria targets

- Failure should cost about `2` run-equivalents of XP progress.
- Expected run targets trend: `30`, `50`, `60`, `90`, `100`...
- Campaign random-policy clear-rate guidance:
  - Map 1 ~90%
  - Map 2 ~85%
  - Map 3 ~80%
  - Map 4 ~77%
  - Map 5 `58% +/- 5%` (active target)

Prefer enemy-side difficulty tuning (enemy HP/speed/rewards, leak penalties, map scales, wave composition) before tower-curve rewrites unless a tower role is fundamentally broken.

## 7) Deployment and Publish Rules

### 7.1 Delivery pipeline

Development flow:

- Local/GS75 development -> GitHub -> CI/CD -> Production/Staging

### 7.2 Required hostname

- Publish target: `homeland.secana.top`
- Use active `secana.top` Cloudflare zone.

### 7.3 Default live-update behavior

After implementation changes, publish by default unless user explicitly says not to.

Minimum verification after publish:

1. `curl -I https://homeland.secana.top` returns HTTP `200`.
2. Fetch page HTML and verify expected feature/content marker is present.

## 8) Testing and Validation Requirements

Before handing off substantial gameplay or infra changes:

1. Run relevant automated tests (`npm test`, and `npm run test:e2e` when UI interactions changed).
2. If balancing/data changed, run appropriate balancing suite command.
3. Validate no rule regressions in:
   - slot activation + build flow,
   - leak penalties and map result behavior,
   - persistence load/save,
   - map unlock gating.
4. Update docs when gameplay contracts or operational workflows change.

## 9) File Ownership Map

- Gameplay config and map/tower/enemy numbers:
  - `web/src/config.js`
- Deterministic gameplay loop and combat behavior:
  - `web/src/game-core.js`
- Rendering/UI/HUD/persistence client wiring:
  - `web/src/app.js`
- API persistence behavior:
  - `functions/api/progress.js`
- Local development server/static/API emulation:
  - `scripts/dev-server.mjs`
- Build pipeline for static site assets:
  - `scripts/build-web.mjs`
- Balance simulation engine and policy definitions:
  - `scripts/balance-sim.mjs`
  - `scripts/fast-game-core.mjs`
  - `scripts/gpu-wave-runner.mjs`
- Cloudflare tunnel setup/run:
  - `scripts/cloudflare-tunnel-setup.sh`
  - `scripts/cloudflare-tunnel-run.sh`
- D1 schema and migration:
  - `schema/progress.sql`
  - `scripts/migrate-progress-to-d1.mjs`

## 10) Guardrails to Prevent Workflow Drift

- Do not treat planning docs in `docs/` as implementation truth if they lag code.
- Do not rename legacy IDs (example: tower id `bone`) without migration and compatibility plan.
- Do not modify slot coordinate generation behavior; authored map slots are authoritative.
- Do not bypass GS75-first CUDA rule for Monte Carlo unless GS75 path is unavailable.
- Do not skip publish verification when publishing to `homeland.secana.top`.
- Do not leave undocumented contract changes in gameplay systems.

## 11) Definition of Done for Agent Tasks

A task is complete only when all apply:

1. Behavior works in active runtime path (web prototype and/or deploy target as relevant).
2. Data/config changes are externalized (not hidden magic constants in unrelated code).
3. Relevant tests or verification steps were run and reported.
4. Docs updated if architecture/rules/workflow changed.
5. Changes committed and pushed with clear commit message.
