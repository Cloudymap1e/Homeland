# AGENTS.md

This file is the execution contract for agents and contributors working in this repository.

## Mission Snapshot

- Game type: browser-based tower defense strategy.
- Theme: defend river routes from pirate fleets (boats).
- Primary runtime: JavaScript web prototype in `web/`.
- Legacy runtime: Python prototype in `src/homeland/` (reference-only, not default path).
- Current campaign scope: `map_01` through `map_05` are playable and configurable.

## Ground Truth: What Is Production-Relevant Today

1. Core gameplay implementation is in:
- `web/src/config.js` (all game/balance content and map/tower/enemy/progression data)
- `web/src/game-core.js` (canonical playable simulation engine)
- `web/src/app.js` (UI, rendering, controls, persistence orchestration)

2. Monte Carlo/balancing engines are in:
- `scripts/balance-sim.mjs` (main simulator, policy suites, pass-standard/diversity/OAT)
- `scripts/fast-game-core.mjs` (data-oriented fast simulation engine)
- `scripts/gpu-wave-runner.mjs` + `scripts/cuda/wave_sim.cu` (GPU wave backend)

3. Progress persistence backends:
- Local dev server mode: `scripts/dev-server.mjs` stores progress in `.data/player-progress.json`
- Cloudflare Pages mode: `functions/api/progress.js` stores progress in D1 (`PROGRESS_DB`)
- Schema/migration:
  - `schema/progress.sql`
  - `scripts/migrate-progress-to-d1.mjs`

4. Build/deploy toolchain:
- Build output: `dist/` via `scripts/build-web.mjs`
- Preview: `scripts/preview-web.mjs`
- Cloudflare config: `wrangler.toml`
- Tunnel publish scripts:
  - `scripts/cloudflare-tunnel-setup.sh`
  - `scripts/cloudflare-tunnel-run.sh`

## Product Rules (Current MVP+)

- Player starts on `Map 1`.
- Boats follow authored river routes.
- Towers can be placed only on valid build slots and only after slot activation payment.
- Starting coins are map-defined (Map 1 starts at `10,000`).
- Waves are fleet compositions defined by map config.
- Boats do not attack towers in current scope.
- Leak behavior:
  - leak applies coin + XP penalties,
  - XP floors at `0`,
  - coins may go negative (run can continue).
- Map progression:
  - map unlock remains sequential,
  - unlock requires previous-map completion + required XP.
- Map pass/fail:
  - leaked non-final waves continue the run,
  - final wave with leaks ends map as defeat (`reason: leaks`).

## Tower Set and Roles

- `arrow`: stable single-target DPS.
- `bone` (bomb tower): heavy direct hit with splash falloff.
- `magic_fire`: hit damage + burn + persistent fire zone.
- `magic_wind`: multi-target slow control.
- `magic_lightning`: chain damage with falloff.

Balance values must remain config-driven in `web/src/config.js`; do not hardcode balance constants into gameplay flow unless they are generic engine constants.

## Data and Architecture Rules

- Data-driven first:
  - map routes, slots, waves, unlocks, leak penalties, rewards, enemy scaling, pass criteria, and tower curves must remain in config data.
- Build slot coordinates are authored map design data:
  - never auto-generate, densify, offset, or normalize slot positions away from authored coordinates.
- `game-core` owns gameplay state transitions and simulation truth.
- `app.js` owns rendering, HUD, controls, and persistence scheduling only.
- `balance-sim` may use `FastHomelandGame`/GPU for speed, but game rules must stay behaviorally consistent with playable logic.

## Runtime and Commands

Run from repository root.

- Dev server (with local JSON progress API):
  - `npm run dev`
  - serves on `http://127.0.0.1:4173`
- Unit tests:
  - `npm test`
- E2E tests:
  - `npm run test:e2e`
  - optional base URL override: `HOMELAND_E2E_BASE_URL=http://127.0.0.1:4173`
- Build static assets:
  - `npm run build:web`
- Preview dist:
  - `npm run preview:web`
- Cloudflare Pages local emulation:
  - `npm run pages:dev`
- Cloudflare Pages deploy:
  - `npm run pages:deploy`

## Persistence Model (Do Not Break)

Client behavior in `web/src/app.js`:

- Dual persistence:
  - local fallback via `localStorage` (`homeland_progress_v1`)
  - remote `/api/progress` sync
- Boot strategy:
  - apply local snapshot immediately if valid,
  - perform fast remote fetch with timeout (`REMOTE_PROGRESS_TIMEOUT_MS`),
  - perform slow-path retry without timeout to reconcile stale local state.
- Write strategy:
  - debounced saves + periodic saves + unload flush (`sendBeacon` fallback POST).
- Safety rule:
  - remote stale data must not overwrite newer local-mutated state during boot.

Any persistence changes must preserve these guarantees and include test/verification notes.

## Balancing and Monte Carlo Rules

### GS75 CUDA-First Rule (Required)

- On machine `GS75`, Monte Carlo must try CUDA first.
- On non-`GS75`, run remote first:
  - `ssh GS75 'cd /Users/rc/Project/Homeland && npm run balance:gs75'`
- First required command on GS75:
  - `cd /Users/rc/Project/Homeland`
  - `npm run balance:gs75`
- If CUDA-required run fails because CUDA runtime is unavailable, record that explicitly, then run CPU fallback:
  - `npm run balance:sim`

### Coverage Rule (Required per balancing cycle)

- random baseline (`random_all`),
- campaign retention baseline (~100 runs/map, chained),
- fixed-budget pass-rate check (~1000 runs/map with retained-coins seeding),
- mixed baseline (`balanced`),
- mono scenarios (arrow/bomb/fire/wind/lightning),
- at least 3 duo scenarios,
- OAT sensitivity:
  - `windSlowMult`
  - `bombSplashMult`
  - `fireDpsMult`

### Campaign Standard

- Use retained-coins chaining `r[i]`:
  - `r[i]` = minimal retained coins after passing maps `1..i`,
  - next-map budget = `r[i] + initial[i+1]`.
- Progression criterion:
  - one failed run should cost about `2` run-equivalents of XP progress.
- Pass-rate trend targets:
  - Map 1: ~90%
  - Map 2: ~85%
  - Map 3: ~80%
  - Map 4: ~77%
  - Map 5: `58% +/- 5%` (active target)
  - Map 6+: derive from chained retained budget after previous map is stabilized.

### Preferred balancing levers

- Prefer enemy-side tuning first:
  - enemy HP/speed/reward,
  - map `enemyScale`,
  - leak penalties,
  - wave composition.
- Avoid frequent tower-curve rewrites unless tower role is fundamentally broken.

### Simulation commands

- Full suite: `npm run balance:sim`
- Pass-standard only: `npm run balance:standard`
- Diversity + OAT reruns: `npm run balance:diversity`
- GPU quick check: `npm run balance:gpu-check`

## Cloudflare Publish Rule (Default)

Required public hostname:
- `homeland.secana.top`

Default behavior after implementing project changes:
- publish to `homeland.secana.top` unless user explicitly says not to.

Minimum publish verification:
1. `curl -I https://homeland.secana.top` returns HTTP `200`.
2. Fetched page HTML includes expected new UI/content marker.

Tunnel setup/run:
1. `cloudflared tunnel login` (one-time if needed).
2. `./scripts/cloudflare-tunnel-setup.sh`
3. Start app: `npm run dev`
4. Start tunnel: `./scripts/cloudflare-tunnel-run.sh`

Quick temporary URL (no custom domain):
- `npm run tunnel:quick`

## Working Practices for Agents

- Keep changes small and incremental.
- Prefer config-first changes for balancing/content.
- Update docs when rules/contracts/workflow change.
- For every new mechanic, explicitly define:
  - player-facing behavior,
  - owning system/module,
  - required data fields,
  - test scenario.
- When touching runtime-critical behavior, validate with relevant tests (`npm test`; add e2e when UI flow changes).

## Commit and Git Protocol

- Commit frequently in small increments.
- Use clear commit messages with intent prefix (e.g., `Fix:`, `Feature:`, `Docs:`, `Perf:`, `Test:`, `Deploy:`).
- Push after each meaningful checkpoint when network/remote access is available.
- Do not rewrite history unless explicitly requested.

## Definition of Done (Gameplay/Runtime Changes)

- Mechanic works in playable scene.
- Behavior is config-driven where appropriate.
- Edge cases are handled.
- Tests or explicit validation steps are updated.
- Docs (`README.md` and/or this file) are updated when rules/contracts change.

## Legacy / Historical Docs Note

- `docs/action-plan.md` and `docs/task-list.md` include early planning scaffolds and may not reflect current implementation status.
- When conflicts exist, code and this `AGENTS.md` are authoritative for current operations.
