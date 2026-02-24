# Homeland Prototype Action Plan (v0.1)

## Objective

Deliver a first playable prototype of `map_01_river_bend` with complete core loop:
- build towers,
- run waves,
- defeat pirate boats,
- apply economy/XP,
- show win/loss result.

## Delivery Strategy

Use vertical slices and ship in small, testable increments. Each milestone must leave the game in a runnable state.

## Milestones and Gates

## Milestone 0: Project Bootstrap

### Deliverables

- Base source tree created.
- Config folders and schemas added.
- Minimal executable scene (loads map and UI shell).

### Exit Criteria

- App boots to Map 1 scene with HUD placeholders.
- Config files load without runtime errors.

## Milestone 1: Map + Enemy Movement Slice

### Deliverables

- River waypoint path implemented.
- Enemy boat entity implemented.
- Wave spawner with timing and composition support.
- Leak detection at river exit.

### Exit Criteria

- Wave 1 boats spawn and traverse full path.
- Destroy/leak events emit correct telemetry and counters.

## Milestone 2: Placement + Tower Combat Slice

### Deliverables

- Build slots and slot occupancy logic.
- Build menu with tower selection and cost validation.
- Tower targeting and attack loop.
- Projectile/effect resolution for all base tower types.

### Exit Criteria

- Player can place at least one of each tower family.
- Towers attack correctly and destroy boats.
- Tower upgrades apply stat deltas correctly.

## Milestone 3: Economy + XP + Results

### Deliverables

- Coin spend/reward and leak penalties.
- XP gain/loss rules.
- Wave completion and map completion rules.
- Win/Lose screen with restart flow.

### Exit Criteria

- Coins and XP values match config and event stream.
- Map transitions to result screen deterministically.

## Milestone 4: Prototype Stabilization

### Deliverables

- Bug fixing pass for core loop issues.
- Basic VFX/SFX placeholders.
- HUD readability pass.
- Automated smoke checks for core systems.

### Exit Criteria

- 10 consecutive local runs with no blocking defects.
- Known issues list created for post-prototype backlog.

## Engineering Workstreams

1. Gameplay Systems
- state machine, waves, pathing, combat, upgrades.

2. Data + Configuration
- schema definitions, validation, map/tower/enemy/wave configs.

3. UI/HUD
- resources display, wave controls, build/upgrade interactions.

4. QA + Tooling
- smoke tests, deterministic replay seed support, logging.

## Dependency Order

1. Config schema + loader.
2. Map path + enemy movement.
3. Placement rules.
4. Combat damage resolution.
5. Economy and XP systems.
6. Result-state and restart flows.

Do not implement advanced UX polish before system correctness is verified.

## Task Execution Rules

- Keep PR/commit scope narrow (single subsystem where possible).
- No hidden constants in gameplay code; use config.
- Add a minimal test (or deterministic simulation script) per core subsystem.
- Update docs whenever rule values or contracts change.

## Test and Validation Plan

## Automated Checks (minimum)

- Config parsing test.
- Wave spawn schedule test.
- Damage resolution test.
- Economy transaction test.
- XP progression and unlock test.

## Manual Smoke Script

1. Start Map 1 with 10,000 coins.
2. Place one Arrow and one Bone tower.
3. Run Wave 1 and verify rewards/penalties.
4. Upgrade one tower.
5. Complete all waves or intentionally leak to validate penalties.
6. Verify map result and XP unlock logic.

## Telemetry to Log

- `wave_start`, `wave_complete`
- `tower_built`, `tower_upgraded`
- `enemy_killed`, `enemy_leaked`
- `coins_changed` (delta + reason)
- `xp_changed` (delta + reason)
- `map_result`

## Risks and Mitigations

1. Balance feels too easy/hard.
- Mitigation: keep all numbers in config and run post-prototype simulation passes.

2. Combat bugs from status effects.
- Mitigation: start with simplified stacking rules; add explicit tests for burn/slow/chain.

3. Scope creep from future features.
- Mitigation: enforce out-of-scope list from design doc until first playable is signed off.

## Proposed Timeline (Engineering Days)

1. Day 1: Milestone 0
2. Day 2-3: Milestone 1
3. Day 4-6: Milestone 2
4. Day 7-8: Milestone 3
5. Day 9-10: Milestone 4

Timeline is estimate-only; milestone exit criteria are authoritative.

## Ready-to-Implement Checklist

- [ ] Design spec values approved.
- [ ] Engine/framework for prototype confirmed.
- [ ] Repo structure scaffolded.
- [ ] Config schema format selected (`json` or `yaml`).
- [ ] Milestone 0 started.
