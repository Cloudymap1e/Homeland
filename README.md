# Homeland - River Defense

Homeland is a tower defense strategy game where the player protects river routes from pirate fleets.

## Current Runtime Snapshot

- Runtime of record: browser JS campaign under `web/`, not the legacy Python prototype.
- Live content: 5 playable maps, 5 tower types (`arrow`, `bone`, `magic_fire`, `magic_wind`, `magic_lightning`), 50 tower levels, branching river routes, sequential map unlocks.
- Core runtime owners:
  - configs and authored map/slot data: `web/src/config.js`
  - game loop/state/economy/combat: `web/src/game-core.js`
  - rendering/UI/HUD/persistence: `web/src/app.js`
  - production progress API: `functions/api/progress.js`
  - local dev progress API: `scripts/dev-server.mjs`
- Persistence behavior:
  - browser `localStorage` mirror plus remote `/api/progress`,
  - session identity via `homeland_sid` cookie with client IP fallback,
  - local dev storage in `.data/player-progress.json`,
  - production storage in Cloudflare D1 via `PROGRESS_DB`.
- Build/deploy path:
  - `npm run build:web` creates hashed assets in `dist/`,
  - `npm run preview:web` is static smoke only and stubs `/api/progress`,
  - `npm run pages:dev` is the closer Pages/functions preview,
  - `npm run pages:deploy` deploys the production bundle.
- Balance/simulation path:
  - Monte Carlo source: `scripts/balance-sim.mjs` + `scripts/fast-game-core.mjs`,
  - optional GPU wave backend: `scripts/cuda/wave_sim.cu` via `npm run build:gpu-wave`,
  - GS75 CUDA-first workflow is the expected path for full balance passes.

For operational truth, prefer this snapshot plus [`AGENTS.md`](AGENTS.md) and current source owners. The sections below still include original design-brief material and may be less current than the runtime contract above.

## High-Level Concept

- Player starts on the first map.
- Each map has a river path used by enemy boats.
- Player places towers only on designated build spots near the river.
- Goal: destroy all enemy boats before they exit the river.

If enemies pass through, the player is penalized (coins and XP deduction).

## MVP Gameplay Rules

### Starting State

- Starting coins: `10,000`
- Starting map: `Map 1`
- Towers available at start: Arrow, Bone, Magic

### Tower Types

1. Arrow Tower
- Role: stable single-target DPS
- Typical behavior: medium range, medium fire rate, low-to-medium damage

2. Bomb Tower
- Role: heavy burst damage + splash damage
- Typical behavior: slower attack speed, high direct hit, AOE splash in nearby radius

3. Magic Tower
- Role: elemental effects and burst utility
- Initial elements:
  - Fire (fireball impact + persistent 3-second burn zone + ignite burn DoT on hit boats)
  - Wind (multi-target slow control)
  - Lightning (burst or chain, with short shock-state visuals on affected boats)

### Enemy Fleets (Pirate Boats)

- Fleet size target: `10-20` boats per wave (varies by map/wave).
- Stats vary by boat type:
  - HP
  - Speed
  - Reward value
- Early maps: enemy boats do **not** attack towers.
- Future maps: enemy attack behavior may unlock.

### Win / Failure Logic

- Win wave: all boats in the fleet are neutralized.
- Leak event: any boat reaching river exit triggers penalties.
- Wave fail handling: leaked waves still continue to next build phase (no mid-map hard stop).
- Map pass rule: all waves complete **and** total leaks remain `0`; leaked runs end as map defeat at final wave.
- Penalties:
  - coin deduction
  - XP deduction
  - XP floors at `0` (coins may go negative)
- Progression unlock: next map requires minimum XP threshold.

## Economy and Progression

### Economy

- Coins are used for:
  - slot activation (pay once per slot per map run)
  - tower placement (after slot activation)
  - tower upgrades
  - tower sales refund at `70%` of total tower build/upgrade cost
- Coins are gained from:
  - destroying enemy boats
  - completing waves/maps (map clear rewards included)
- Coins are lost from:
  - leak penalties
- Coins can go negative during heavy leaks; run continues and player can recover by selling towers.

### XP Progression

- XP gained by successful defense and completions.
- XP deducted on leak/failure conditions.
- Campaign pass criteria standard:
  - one failed run deducts about `2` run-equivalents of progression XP,
  - expected unlock run targets scale by map index: `30`, `50`, `60`, `90`, `100`, `120`...
  - map pass rates are computed with retained-coins Monte Carlo chaining (`r[N]` standard; see balancing section below).
- Map unlocks require both:
  - previous map(s) cleared in sequence,
  - required XP milestone.
- Difficulty rises with progression:
  - stronger fleets
  - faster boats
  - higher HP boats
  - larger fleet compositions

## System Foundation (Data-Driven)

Use external configuration for balance and content scaling.

### Recommended Config Objects

- `MapConfig`
  - id, name
  - river path waypoints
  - build slot coordinates
  - wave list
  - unlock XP requirement

- `TowerConfig`
  - id, tower type
  - cost
  - base stats (damage/range/rate)
  - upgrade levels and costs
  - special effect type

- `EnemyConfig`
  - id, boat class
  - HP
  - speed
  - coin reward
  - attack-enabled flag (future)

- `WaveConfig`
  - wave id
  - enemy entries and counts
  - spawn interval
  - pacing modifiers

- `ProgressionConfig`
  - XP per kill / wave clear
  - XP penalty on leak
  - map unlock thresholds

## Suggested Project Structure

```txt
Homeland/
  README.md
  AGENTS.md
  docs/
    game-design.md
    balancing-guide.md
  src/
    core/
      game_state.*
      event_bus.*
    systems/
      placement_system.*
      combat_system.*
      wave_system.*
      economy_system.*
      progression_system.*
    entities/
      tower.*
      enemy_boat.*
      projectile.*
    data/
      maps/
      towers/
      enemies/
      waves/
      progression/
    ui/
      hud.*
      build_menu.*
      upgrade_panel.*
```

Use your engine/framework equivalent, but keep this separation of concerns.

## MVP Implementation Plan

1. Base Loop
- Load Map 1.
- Spawn enemy boats along river waypoints.
- End wave when all boats are destroyed or escaped.

2. Tower Placement + Combat
- Restrict placement to valid slots.
- Implement targeting and attack logic for 3 base towers.
- Add upgrade flow for each tower.

3. Economy + XP
- Start with 10,000 coins.
- Deduct placement/upgrade costs.
- Grant kill rewards.
- Apply leak penalties to coins and XP.

4. Progression
- Track XP thresholds.
- Unlock next map at required XP.
- Scale future wave difficulty by progression.

## Initial Balancing Targets (v0)

- Wave duration: 60-120 seconds.
- Tower placement count on Map 1: 8-14 slots.
- Average clear rate target for new players: 65-80% on first attempt.
- Leak penalty should hurt, but not instantly hard-lock progression.

These numbers should be moved to config and tuned after first playable tests.

## Future Expansion Hooks

- Enemy attack-capable boats.
- New tower branches and elemental combos.
- Terrain modifiers (bridges, narrow channels, storm zones).
- Boss fleets and elite ships.
- Campaign map progression with branching paths.

## Implementation Documents

- Design spec: `/Users/rc/Project/Homeland/docs/prototype-design.md`
- Engineering plan: `/Users/rc/Project/Homeland/docs/action-plan.md`
- Sprint task list: `/Users/rc/Project/Homeland/docs/task-list.md`
- Design/graphics upgrade plan: `/Users/rc/Project/Homeland/docs/design-graphics-plan.md`

## Prototype Runtime

Primary runtime is now browser-based JS:
- interactive map/canvas prototype,
- tower placement and upgrades,
- wave spawning, pathing, combat, and effects,
- coin and XP progression,
- win/loss loop for multi-map campaign.

Runtime control additions:
- `Fast 1s Fleet Run`: compresses an active wave into about one second of wall time.
- `Auto Continue`: automatically starts the next wave and auto-loads unlocked next maps while carrying coins/XP.
- `Tower Curves` panel: visualizes each tower's capability growth and cost growth across levels 1-50.
- `Hide HUD`: toggles the overlay top-strip stats without hiding the command deck.

Campaign progression additions:
- Slots now require explicit unlock payment before towers can be placed.
- Coins and XP carry forward across map transitions.
- Each cleared map grants a clear reward (coins/XP).
- Map unlocks are sequential (cannot skip earlier maps).
- Current playable endpoint: `Map 5 - Blackwater Lattice`.

Progress persistence:
- Player progress now auto-saves continuously and on tab close.
- Session identity is indexed by `homeland_sid` cookie, with client IP fallback if cookie is missing.
- Local dev data is stored in `.data/player-progress.json`; production data is stored in Cloudflare D1 and mirrored in browser `localStorage` as fallback.

Run local web prototype:

```bash
# from the repo root
npm run dev
```

Run tests:

```bash
# from the repo root
npm test
```

Monte Carlo balance run (1,000 simulations, all maps):

```bash
# from the repo root
npm run balance:sim
```

This command runs:
- multipliers search,
- full 1,000-run verification,
- campaign pass-standard framework:
  - retention baseline: `100` random-policy campaign probes per map,
  - fixed-budget pass-rate check: `1000` runs using retained-coins baseline,
- diversity scenario matrix (mono/duo/mixed),
- controlled OAT sensitivity checks (one factor at a time),
- random policy baseline (`random_all`) with initial map coins.

Current random-policy balance intent (not strict hard limits):
- Map 1 clear rate near 90%,
- Map 2 clear rate near 85%,
- Map 3 clear rate near 80%,
- Map 4 clear rate near 77%,
- Map 5 clear rate near `58% +/- 5%` (active revision target),
- Map 6 clear rate to be set after Map 5 is stabilized using `r[5] + initial[6]` budget.

Map standard difficulty scale (`r[N]`):
- Keep retained-coins array `r[N]`.
- `r[i]` means the minimal retained coins after passing Maps `1..i` in campaign Monte Carlo.
- For Map `i+1`, use simulation budget `r[i] + initial[i+1]`.
- Run Monte Carlo fleet simulations for Map `i+1` using that budget and measure pass rate (`pass = fully neutralize all pirate boats`).
- Use measured pass rate to scale difficulty by tuning:
  - slot unlock price / tower slot price,
  - fleet HP,
  - fleet speed,
  - fleet specialties and wave composition.

Scaling policy for future iterations:
- Keep tower level curves mostly stable for consistency.
- Scale campaign difficulty primarily with fleet-side values (`enemyScale`, enemy HP/speed/reward, leak pressure, and wave composition).

Fast 1,000-run verification only (skip multiplier search):

```bash
# from the repo root
npm run balance:verify
```

Diversity + controlled-variable suite without search (faster):

```bash
# from the repo root
npm run balance:diversity
```

Pass-standard framework only (retention baseline + fixed-budget pass-rate checks):

```bash
# from the repo root
npm run balance:standard
```

GS75 CUDA-first balance run:

```bash
# from the repo root on GS75
npm run balance:gs75
```

Quick CUDA availability check:

```bash
# from the repo root
npm run balance:cuda-check
```

Native CUDA wave backend build (GS75):

```bash
# from the repo root on GS75
npm run build:gpu-wave
```

GPU-engine sanity run (Map 1 quick suite):

```bash
# from the repo root
npm run balance:gpu-check
```

For direct CLI use, `balance-sim` accepts `--engine=classic|fast|gpu` (default `fast`).

Legacy headless Python prototype remains under `src/homeland` for reference only.

Load and startup performance harness:

```bash
# from the repo root
npm run perf:load
```

This writes:
- `docs/perf/load-metrics-YYYYMMDD.json`
- `docs/perf/baseline-YYYYMMDD.json`

Build optimized production assets (hashed JS/CSS + cache headers):

```bash
# from the repo root
npm run build:web
npm run preview:web
```

For Pages Functions or persistence checks, prefer:

```bash
# from the repo root
npm run build:web
npm run pages:dev
```

## Cloudflare Pages + D1 (Primary Production Path)

Target hostname: `homeland.secana.top`

Use the currently active `secana.top` Cloudflare zone. Do not change nameservers if the zone is already active.

```bash
# from the repo root
npx wrangler whoami
npx wrangler d1 create homeland-progress
# Update wrangler.toml with real database_id and preview_database_id values.
npx wrangler d1 execute homeland-progress --file schema/progress.sql
npm run build:web
npm run pages:deploy
```

Pages runtime API:
- `functions/api/progress.js` keeps `/api/progress` response schema compatible.
- D1 binding name: `PROGRESS_DB`.

Progress migration to D1:

```bash
# from the repo root
npm run migrate:d1 -- --db=homeland-progress --apply --verify --truncate
```

Migration script:
- source: `.data/player-progress.json`
- output SQL: `.data/d1-progress-migration.sql`
- preserves `createdAt`, `updatedAt`, `lastIp`, and exact progress payload JSON.

## Cloudflare Tunnel Publish (Fallback / Rollback)

Keep tunnel scripts available for rollback windows or emergency routing:

```bash
# from the repo root
./scripts/cloudflare-tunnel-setup.sh
npm run dev
./scripts/cloudflare-tunnel-run.sh
```

Quick public URL without DNS mapping:

```bash
# from the repo root
npm run dev
npm run tunnel:quick
```

## Current Status

JS prototype core loop is implemented and tested.
Primary production path now includes:
- bundled static output in `dist/`,
- Cloudflare Pages Functions API under `functions/api/`,
- D1 schema + migration tooling for progress persistence.
