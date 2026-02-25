# AGENTS.md

This file defines how agents and contributors should execute work for this project.

## Project Summary

- Game type: Tower defense strategy.
- Theme: Defend river routes from pirate fleets.
- Core loop: Place towers near river paths, upgrade towers, stop fleets before they exit the map.
- Current scope: Build a clean MVP foundation for early maps (no enemy attack behavior yet).

## Product Rules (MVP)

- Player starts on Map 1.
- Every map includes a river path that enemies follow.
- Towers can only be placed on valid build slots near the river.
- Initial player balance: `10,000` coins.
- Enemy waves are pirate fleets (boats), typically `10-20` boats per fleet.
- Boats differ by speed and HP.
- First maps: boats do not attack towers.
- Failure condition component: if a boat exits the river end, player is penalized.
- Penalties include coin deduction and XP deduction.
- Progression: player needs enough XP to unlock the next map.
- Difficulty scaling: later maps/waves increase enemy strength.

## Tower Set (Initial)

- Arrow Tower: consistent single-target physical damage.
- Bomb Tower: high direct damage with splash damage in area.
- Magic Tower (element variants):
  - Fire: fireball impact with 3-second persistent burn zone.
  - Wind: fleet slow-control with multi-target effect by level.
  - Lightning: chain or burst magic damage.

Keep balancing data in config files, not hardcoded in gameplay systems.

## Architecture Direction

Use a data-driven architecture so balancing and content expansion are easy.

- `MapConfig`: river path, build slots, wave plans, unlock requirement.
- `TowerConfig`: cost, range, attack speed, damage, upgrade tree.
- `EnemyConfig`: HP, speed, reward, special abilities (future).
- `WaveConfig`: composition of enemy boats, spawn intervals.
- `ProgressionConfig`: XP thresholds and map unlock rules.

## Suggested Core Modules

- `GameStateManager`: game phases, pause/resume, win/lose state.
- `EconomySystem`: coins, spending, rewards, penalties.
- `PlacementSystem`: tower placement validation and grid/slot occupancy.
- `CombatSystem`: targeting, projectile/effect processing, damage resolution.
- `WaveSystem`: spawns fleets and tracks wave completion.
- `ProgressionSystem`: XP gain/loss and map unlock evaluation.
- `UI/HUD`: coins, XP, wave status, build/upgrade controls.

## Working Practices for Agents

- Keep changes small and incremental.
- Prefer config-first changes for balancing.
- Add or update docs whenever game rules change.
- For any new mechanic, define:
  - player-facing behavior,
  - system owner/module,
  - data fields required,
  - test scenario.

## MVP Milestones

1. Foundation
- Set up project structure.
- Implement config loading.
- Implement map path + build slots.

2. Core Gameplay
- Add tower placement and 3 base tower types.
- Add enemy movement along river path.
- Add damage/combat and wave completion.

3. Economy + Progression
- Add initial coins, rewards, costs, penalties.
- Add XP gain/loss and next-map unlock logic.

4. Polish for First Playable
- HUD clarity.
- Basic VFX/SFX placeholders.
- Balance pass for Map 1.

## Out of Scope (For Now)

- Enemy boat attacks against towers.
- Advanced abilities and status combinations beyond basic element behavior.
- Meta systems (inventory/hero/cards/etc.).
- Multiplayer.

## Definition of Done (for each gameplay task)

- Mechanic works in playable scene.
- Data is configurable without code edits.
- Basic edge cases are handled.
- README and relevant docs are updated.

## Runtime Stack

- Primary implementation stack: JavaScript/TypeScript-oriented web runtime.
- Main playable prototype location: `web/` at the repo root (paths in docs may reference `/Users/rc/Project/Homeland`; in a worktree, use the current repo root).
- Dev server command: `npm run dev` (serves `web/` on `http://127.0.0.1:4173`).
- Test command: `npm test`.
- Legacy Python prototype in `/Users/rc/Project/Homeland/src/homeland` is reference-only and not the default implementation path.

## Repository Layout (Current)

- `web/index.html`, `web/styles.css`: UI shell and styling.
- `web/src/app.js`: UI/controller, rendering, input handling, persistence client, and main game loop.
- `web/src/game-core.js`: deterministic game simulation (state machine, wave/placement/combat/effects).
- `web/src/config.js`: all balance/content data (maps, routes, towers, enemies, campaign criteria).
- `web/tests/*.test.mjs`: unit tests for JS game logic.
- `web/tests/*.e2e.spec.mjs`: Playwright-driven UI smoke tests.
- `scripts/dev-server.mjs`: static web server + `/api/progress` persistence API.
- `scripts/balance-sim.mjs`: Monte Carlo suite runner (multi-worker, fast engine, GPU optional).
- `scripts/fast-game-core.mjs`: optimized simulation engine for Monte Carlo.
- `scripts/gpu-wave-runner.mjs`, `scripts/cuda/wave_sim.cu`, `scripts/build-gpu-wave-sim.sh`: CUDA wave backend.
- `src/homeland/*`: legacy Python reference prototype + data files (do not treat as active runtime).
- `tests/*`: legacy Python tests (run with `pytest`).

## Web Runtime Architecture (Current)

- **Data config lives in `web/src/config.js`:** owns map layouts, build slots, routes, wave plans, tower curves, enemy stats, campaign unlock criteria; balance work should update config data first, not logic in `game-core.js`.
- **Simulation lives in `web/src/game-core.js`:** `HomelandGame` is the state machine with `build_phase`, `wave_running`, `wave_result`, `map_result`, and handles slot activation, placement validation, tower upgrades, wave spawning, targeting, damage, AOE, DOT zones, and leak penalties; it also exposes `exportState()` and helpers used by UI + sim tools.
- **UI/controller lives in `web/src/app.js`:** owns render loop (canvas + overlays), player input, and UI panels (report/curve panels), calls into `HomelandGame` for progression and uses `getEnemyPosition()` for rendering, triggers persistence saves and refreshes campaign map availability.

## Progress Persistence (Current)

- **Client persistence:** primary is `/api/progress` (JSON) on the dev server, fallback is `localStorage` key `homeland_progress_v1` if server is unavailable.
- **Server persistence (`scripts/dev-server.mjs`):** stores sessions in `.data/player-progress.json`, session identity uses `homeland_sid` cookie with IP fallback, API supports `GET/PUT/POST/DELETE` for progress JSON.

## Monte Carlo + GPU Balance Pipeline (Current)

- `scripts/balance-sim.mjs` runs the full suite (search, retention baselines, pass-standard, diversity, OAT).
- Uses worker threads and the optimized `FastHomelandGame` engine by default.
- GPU wave engine is optional and built via `npm run build:gpu-wave`.
- `balance:gs75` uses `--cuda-required` and must run on GS75 first per the CUDA-first rule.

## Monte Carlo Balancing (GS75 CUDA-First Rule)

- When running any Monte Carlo balancing simulation on machine `GS75`, CUDA must be prioritized first.
- On `GS75`, do not run CPU Monte Carlo first when CUDA is available.
- If current host is not `GS75`, run Monte Carlo on `GS75` remotely via SSH first (for example `ssh GS75 'cd /Users/rc/Project/Homeland && npm run balance:gs75'`).
- Local CPU Monte Carlo on non-`GS75` hosts is fallback-only and must be used only when `GS75` execution is unavailable.
- Required first attempt on GS75:
  - `cd /Users/rc/Project/Homeland`
  - `npm run balance:gs75`
- The simulation runner performs CUDA runtime detection when `--cuda` is enabled.
- `balance:gs75` uses `--cuda-required`: it must fail fast if CUDA is unavailable.
- If `balance:gs75` fails due missing CUDA runtime, record this explicitly and then run CPU fallback with:
  - `npm run balance:sim`

## Balancing Coverage Rule

- Balance validation must include diversity and controlled-variable checks, not only a single mixed policy run.
- Map standard difficulty scale must use retained-coins Monte Carlo chaining:
  - keep a retained-coins array `r[N]`,
  - define `r[i]` as the minimal retained coins after passing Maps `1..i` in campaign Monte Carlo runs,
  - for Map `i+1`, set simulation budget as `r[i] + initial[i+1]`,
  - run Monte Carlo fleet simulations on Map `i+1` with this budget and record pass rate (`pass = fully neutralize all pirate boats`),
  - scale difficulty toward target pass rate by tuning slot unlock price / tower slot price, fleet HP, fleet speed, and fleet specialties/wave composition.
- Required coverage in a balancing cycle:
  - random baseline (`random_all` policy using initial map coins),
  - campaign retention baseline (about `100` random-policy runs per map, passing all previous maps first, then averaging retained coins),
  - fixed-budget pass-rate check (about `1000` runs per map, seeded with retained-coins baseline),
  - mixed baseline (`balanced` policy) for tower composition comparison,
  - mono tower scenarios (arrow, bomb, fire, wind, lightning),
  - duo tower scenarios (at least 3 combinations),
  - OAT sensitivity for `windSlowMult`, `bombSplashMult`, `fireDpsMult`.
- Progression pass criteria:
  - one failed run should deduct roughly `2` run-equivalents of XP progress,
  - expected run targets to pass should scale roughly `30`, `50`, `60`, `90`, `100`... by map difficulty.
- Campaign random-policy difficulty targets should trend near:
  - Map 1 clear rate: ~90%
  - Map 2 clear rate: ~85%
  - Map 3 clear rate: ~80%
  - Map 4 clear rate: ~77%
  - Map 5 clear rate: `58% +/- 5%` (active revision target)
  - Map 6 clear rate: derive from `r[5] + initial[6]` after Map 5 target is stabilized
- Prefer enemy-side scaling for progression updates:
  - adjust enemy HP/speed/rewards, map `enemyScale`, leak penalties, and wave composition first;
  - avoid frequent tower-curve rewrites unless a tower role is fundamentally broken.
- Use:
  - `npm run balance:sim` for full search + pass-standard + diversity + OAT,
  - `npm run balance:standard` for pass-standard only (retention + fixed-budget pass-rate),
  - `npm run balance:diversity` for faster no-search diversity/OAT reruns.

## Cloudflare Tunnel Publish (Required Hostname)

Publish target must be:
- `homeland.secana.top`

DNS authority for this project:
- Use the currently active `secana.top` Cloudflare zone.
- Do not switch nameservers just to publish this app if the zone is already active.

### One-time setup

1. Authenticate cloudflared:
- `cloudflared tunnel login`

2. Create/configure tunnel and DNS route:
- `cd /Users/rc/Project/Homeland`
- `./scripts/cloudflare-tunnel-setup.sh`

This script:
- creates tunnel `homeland-web` if missing,
- routes DNS for `homeland.secana.top`,
- writes project-local `/Users/rc/Project/Homeland/.cloudflared/config.yml` with ingress to `http://127.0.0.1:4173`.
- should not overwrite tunnel config for other projects.

### Run publish

1. Start local web app:
- `cd /Users/rc/Project/Homeland`
- `npm run dev`

2. Start tunnel:
- `./scripts/cloudflare-tunnel-run.sh`

### Default Live Update Rule

- After implementing project changes, publish to `homeland.secana.top` by default (unless user explicitly says not to publish).
- Minimum publish verification:
  - `curl -I https://homeland.secana.top` must return HTTP `200`,
  - fetch page HTML and verify the expected new UI/content marker is present.
- If one-time setup blocks on browser login but token credentials already exist locally (for example from another project), reuse those stored Cloudflare tunnel credentials and continue with token-based tunnel run.

### Quick temporary URL (no custom domain)

- `npm run tunnel:quick`

### Files

- Setup script: `/Users/rc/Project/Homeland/scripts/cloudflare-tunnel-setup.sh`
- Run script: `/Users/rc/Project/Homeland/scripts/cloudflare-tunnel-run.sh`
- Template config: `/Users/rc/Project/Homeland/.cloudflared/config.yml.example`
