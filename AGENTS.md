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
- Main playable prototype location: `/Users/rc/Project/Homeland/web`.
- Dev server command: `npm run dev` (serves `web/` on `http://127.0.0.1:4173`).
- Test command: `npm test`.
- Legacy Python prototype in `/Users/rc/Project/Homeland/src/homeland` is reference-only and not the default implementation path.

## Monte Carlo Balancing (GS75 CUDA-First Rule)

- When running balancing simulations on machine `GS75`, always try CUDA acceleration first.
- Required first attempt on GS75:
  - `cd /Users/rc/Project/Homeland`
  - `npm run balance:gs75`
- The simulation runner performs CUDA runtime detection when `--cuda` is enabled.
- `balance:gs75` uses `--cuda-required`: it must fail fast if CUDA is unavailable.
- If `balance:gs75` fails due missing CUDA runtime, record this explicitly and then run CPU fallback with:
  - `npm run balance:sim`

## Balancing Coverage Rule

- Balance validation must include diversity and controlled-variable checks, not only a single mixed policy run.
- Required coverage in a balancing cycle:
  - random baseline (`random_all` policy using initial map coins),
  - mixed baseline (`balanced` policy) for tower composition comparison,
  - mono tower scenarios (arrow, bomb, fire, wind, lightning),
  - duo tower scenarios (at least 3 combinations),
  - OAT sensitivity for `windSlowMult`, `bombSplashMult`, `fireDpsMult`.
- Campaign random-policy difficulty targets should trend near:
  - Map 1 clear rate: ~90%
  - Map 2 clear rate: ~85%
  - Map 3 clear rate: ~80%
- Prefer enemy-side scaling for progression updates:
  - adjust enemy HP/speed/rewards, map `enemyScale`, leak penalties, and wave composition first;
  - avoid frequent tower-curve rewrites unless a tower role is fundamentally broken.
- Use:
  - `npm run balance:sim` for full search + diversity + OAT,
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
- writes `~/.cloudflared/config.yml` with ingress to `http://127.0.0.1:4173`.

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
