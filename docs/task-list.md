# Homeland Prototype Task List (v0.1)

This is the execution backlog for the first playable prototype.

## Priority Legend

- `P0`: must-have for first playable.
- `P1`: important for quality/stability.
- `P2`: post-playable improvement.

## Status Legend

- `TODO`
- `IN_PROGRESS`
- `DONE`
- `BLOCKED`

## Sprint Goal

Ship one complete playable map with stable core loop and configurable balance.

## P0 Tasks (Core Gameplay)

| ID | Task | Status | Estimate | Dependency | Acceptance Criteria |
|---|---|---|---|---|---|
| HL-001 | Create source tree and module boundaries (`core`, `systems`, `entities`, `data`, `ui`) | TODO | 0.5d | none | Project compiles/runs and folders exist |
| HL-002 | Implement config loader and schema validation for map/tower/enemy/wave/progression | TODO | 1.0d | HL-001 | Invalid config fails with readable error |
| HL-003 | Build Map 1 scene with river path and 10 build slots from config | TODO | 1.0d | HL-002 | Path and slot data render correctly |
| HL-004 | Implement enemy boat movement along waypoints | TODO | 1.0d | HL-003 | Boats move start-to-exit without jitter/stall |
| HL-005 | Implement wave spawner with composition and spawn interval config | TODO | 1.0d | HL-004 | Wave data spawns exact counts and timing |
| HL-006 | Implement leak detection and leak event pipeline | TODO | 0.5d | HL-004 | Leak event fires exactly once per leaked boat |
| HL-007 | Implement tower placement rules and slot occupancy | TODO | 1.0d | HL-003 | No illegal placement outside slots |
| HL-008 | Implement Arrow Tower attack logic + upgrade path | TODO | 1.0d | HL-007, HL-004 | Damage and upgrade values match config |
| HL-009 | Implement Bone Tower attack logic + upgrade path | TODO | 0.75d | HL-007, HL-004 | Damage and upgrade values match config |
| HL-010 | Implement Magic Fire tower (burn DoT) + upgrades | TODO | 1.0d | HL-007, HL-004 | Burn applies and refreshes duration correctly |
| HL-011 | Implement Magic Wind tower (slow) + upgrades | TODO | 1.0d | HL-007, HL-004 | Slow applies and only highest slow is active |
| HL-012 | Implement Magic Lightning tower (single chain) + upgrades | TODO | 1.0d | HL-007, HL-004 | Chain hits secondary target with falloff |
| HL-013 | Implement combat resolution and kill event routing | TODO | 0.75d | HL-008..HL-012 | Enemy death resolves once and grants rewards |
| HL-014 | Implement economy system (spend/reward/penalty) | TODO | 0.75d | HL-006, HL-013 | Coin totals are deterministic and logged |
| HL-015 | Implement XP system (gain/loss/floor/unlock check) | TODO | 0.75d | HL-006, HL-013 | XP rules match spec and floor at 0 |
| HL-016 | Implement game state manager (`BuildPhase`, `WaveRunning`, `WaveResult`, `MapResult`) | TODO | 1.0d | HL-005, HL-013 | State transitions are valid and traceable |
| HL-017 | Implement HUD (coins, XP, wave index, boats remaining, speed, start wave) | TODO | 1.0d | HL-014, HL-015, HL-016 | HUD updates in real time with no stale values |
| HL-018 | Implement win/lose result screens and restart flow | TODO | 0.75d | HL-016 | Player can replay map without relaunch |

## P1 Tasks (Stability and QA)

| ID | Task | Status | Estimate | Dependency | Acceptance Criteria |
|---|---|---|---|---|---|
| HL-101 | Add deterministic seed mode for wave/combat testing | TODO | 0.5d | HL-016 | Same seed reproduces same result |
| HL-102 | Add config parsing tests | TODO | 0.5d | HL-002 | CI/local test passes |
| HL-103 | Add wave schedule tests | TODO | 0.5d | HL-005 | Spawn counts and timing validated |
| HL-104 | Add combat math tests (damage, burn, slow, chain) | TODO | 1.0d | HL-013 | Expected damage outcomes verified |
| HL-105 | Add economy and XP transaction tests | TODO | 0.75d | HL-014, HL-015 | No arithmetic regressions |
| HL-106 | Add gameplay smoke test script (manual checklist automation where possible) | TODO | 0.75d | HL-018 | Script verifies core flow end-to-end |

## P2 Tasks (Post-Playable)

| ID | Task | Status | Estimate | Dependency | Acceptance Criteria |
|---|---|---|---|---|---|
| HL-201 | Add telemetry export for balance analysis | TODO | 0.5d | HL-106 | Session JSON includes key gameplay events |
| HL-202 | Create random-strategy simulation harness for balance tuning | TODO | 1.5d | HL-201 | Batch run outputs clear-rate and leak stats |
| HL-203 | First balance retune pass from simulation output | TODO | 1.0d | HL-202 | Difficulty targets approach design ranges |

## Design + Graphics Upgrade Tasks

Reference plan:
- `/Users/rc/Project/Homeland/docs/design-graphics-plan.md`

| ID | Task | Status | Estimate | Dependency | Acceptance Criteria |
|---|---|---|---|---|---|
| DG-001 | Build visual style board + final palette tokens | TODO | 0.5d | none | Approved palette and references in repo |
| DG-002 | Redesign HUD layout and component states | TODO | 1.0d | DG-001 | HUD wireframe + interaction spec approved |
| DG-003 | Implement HUD component refactor in web prototype | TODO | 1.5d | DG-002 | Existing gameplay fully usable with new HUD |
| DG-004 | Add map layered background rendering | TODO | 1.0d | DG-001 | Terrain + river + detail layers load correctly |
| DG-005 | Replace placeholder tower/enemy visuals with v1 sprite set | TODO | 2.0d | DG-001 | All towers/boats visually distinct in-game |
| DG-006 | Add projectile trails + hit effects by element type | TODO | 1.5d | DG-005 | Fire/Wind/Lightning effects clearly differentiated |
| DG-007 | Add UX state feedback (invalid build, upgrade success, leak warning) | TODO | 1.0d | DG-003 | Feedback states visible and non-blocking |
| DG-008 | Responsive polish for <=980px layout | TODO | 1.0d | DG-003 | No overlapping controls on mobile viewport |
| DG-101 | Add micro-animations (panel enter, button states, wave banner) | TODO | 1.0d | DG-003 | Animations improve clarity without stutter |
| DG-102 | Add audio placeholders mapped to major events | TODO | 0.75d | DG-006 | Attack/hit/leak/wave cues audible and balanced |
| DG-103 | Visual QA pass for color contrast and readability | TODO | 0.5d | DG-008 | Contrast issues logged/fixed for MVP screens |

## Immediate Execution Order (Next 7 Tasks)

1. HL-001
2. HL-002
3. HL-003
4. HL-004
5. HL-005
6. HL-007
7. HL-008

## Immediate Design Execution Order (Next 6 Tasks)

1. DG-001
2. DG-002
3. DG-003
4. DG-004
5. DG-005
6. DG-006

## Definition of Done (Task-Level)

A task is `DONE` only if all are true:

1. Feature behavior matches spec.
2. Config values drive behavior (no hidden constants).
3. Related automated test exists or explicit manual verification is documented.
4. Changes are committed with clear message.
5. Relevant docs updated if contracts/rules changed.

## Reporting Format (Per Work Session)

Use this format after each implementation session:

```txt
Session Summary:
- Completed: [task ids]
- In Progress: [task ids]
- Blocked: [task ids + reason]
- Next: [task ids]
- Risks Noted: [short list]
```
