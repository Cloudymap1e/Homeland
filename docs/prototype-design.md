# Homeland Prototype Design Spec (v0.1)

## 1) Purpose

Define the implementation-ready scope for the first playable prototype of Homeland.

This document is intentionally concrete:
- fixed rules for the first map,
- initial balance values,
- data contracts for configs,
- system behavior and edge-case rules,
- prototype acceptance criteria.

## 2) Prototype Scope

### In Scope

- Single playable map (`map_01_river_bend`).
- Core tower defense loop:
  - place towers on predefined slots,
  - start wave,
  - towers attack boats,
  - collect rewards,
  - buy upgrades,
  - survive all waves.
- Tower families:
  - Arrow Tower,
  - Bone Tower,
  - Magic Tower (Fire/Wind/Lightning variants).
- Economy (coins) and progression (XP).
- Leak penalties when boats reach river exit.
- Win/Lose screens with retry.

### Out of Scope

- Enemy attacks on towers.
- Map editor.
- Campaign map selection UI.
- Save/load profile.
- Advanced status effect stacking rules.

## 3) Gameplay Loop and State Machine

## Game States

1. `Boot`
2. `MapLoad`
3. `BuildPhase`
4. `WaveRunning`
5. `WaveResult`
6. `MapResult`
7. `Paused`

## Core Loop

1. Enter map with starting resources.
2. Player places/upgrades towers during `BuildPhase`.
3. Player starts wave.
4. Boats spawn and move along river spline/waypoints.
5. Towers auto-target and attack.
6. If boat HP <= 0, boat is destroyed and grants rewards.
7. If boat reaches exit, apply leak penalties.
8. When all boats are resolved (destroyed or leaked), wave ends.
9. Repeat until all waves complete (map win) or fail condition triggers (map loss).

## 4) Map 1: Concrete Definition

## Map ID

- `map_01_river_bend`

## Win Condition

- Complete all 5 waves.

## Fail Condition

- Player coins drop below 0 after penalties.

## Map Parameters

- Starting Coins: `10000`
- Starting XP: `0`
- Build Slots: `10`
- Waves: `5`
- Base leak penalty (per leaked boat): `-120 coins`, `-6 XP`

## River Path (Waypoint Prototype Data)

Use normalized coordinates for engine-agnostic implementation:

```json
[
  { "x": 0.02, "y": 0.62 },
  { "x": 0.18, "y": 0.58 },
  { "x": 0.33, "y": 0.50 },
  { "x": 0.49, "y": 0.52 },
  { "x": 0.66, "y": 0.44 },
  { "x": 0.81, "y": 0.39 },
  { "x": 0.96, "y": 0.34 }
]
```

## Build Slot Coordinates (10 slots)

```json
[
  { "id": "s01", "x": 0.12, "y": 0.47 },
  { "id": "s02", "x": 0.20, "y": 0.69 },
  { "id": "s03", "x": 0.29, "y": 0.40 },
  { "id": "s04", "x": 0.37, "y": 0.63 },
  { "id": "s05", "x": 0.47, "y": 0.39 },
  { "id": "s06", "x": 0.55, "y": 0.64 },
  { "id": "s07", "x": 0.63, "y": 0.33 },
  { "id": "s08", "x": 0.72, "y": 0.58 },
  { "id": "s09", "x": 0.83, "y": 0.31 },
  { "id": "s10", "x": 0.90, "y": 0.52 }
]
```

## 5) Combat Rules

## Targeting

- Default targeting: nearest to river exit within tower range.
- If no target in range, tower idles.
- Retarget interval: every `0.2s`.

## Attack Timing

- Attack speed defined as attacks per second.
- Cooldown = `1 / attack_speed`.

## Damage and Effects

- Physical and magic damage are both flat in v0.
- Fire applies burn DoT.
- Wind applies slow.
- Lightning can chain once.
- Multiple slows do not stack in v0 (use highest).
- Burn stacks refresh duration (no additive stacking).

## 6) Tower Catalog (v0 Balance)

All towers have 3 upgrade levels (L1-L3).

## Arrow Tower

- Identity: reliable sustained DPS.

| Level | Build/Upgrade Cost | Damage | Range | Attack Speed | Notes |
|---|---:|---:|---:|---:|---|
| L1 | 500 | 32 | 2.8 | 1.10 | Single target |
| L2 | 450 | 48 | 3.0 | 1.20 | Single target |
| L3 | 700 | 70 | 3.2 | 1.25 | Single target |

## Bone Tower

- Identity: heavy hitter for high-HP boats.

| Level | Build/Upgrade Cost | Damage | Range | Attack Speed | Notes |
|---|---:|---:|---:|---:|---|
| L1 | 700 | 95 | 2.4 | 0.55 | Single target |
| L2 | 600 | 130 | 2.5 | 0.60 | Single target |
| L3 | 900 | 180 | 2.6 | 0.65 | Single target |

## Magic Tower: Fire

- Identity: damage-over-time pressure.

| Level | Build/Upgrade Cost | Hit Damage | Burn DPS | Burn Duration | Range | Attack Speed |
|---|---:|---:|---:|---:|---:|---:|
| L1 | 800 | 26 | 12 | 2.5s | 2.7 | 0.90 |
| L2 | 700 | 34 | 18 | 2.8s | 2.9 | 0.95 |
| L3 | 1000 | 45 | 24 | 3.0s | 3.0 | 1.00 |

## Magic Tower: Wind

- Identity: control and time extension.

| Level | Build/Upgrade Cost | Damage | Slow % | Slow Duration | Range | Attack Speed |
|---|---:|---:|---:|---:|---:|---:|
| L1 | 760 | 20 | 22% | 1.8s | 2.9 | 0.95 |
| L2 | 650 | 28 | 28% | 2.0s | 3.0 | 1.00 |
| L3 | 980 | 36 | 34% | 2.2s | 3.2 | 1.05 |

## Magic Tower: Lightning

- Identity: burst and secondary target pressure.

| Level | Build/Upgrade Cost | Damage | Chain Count | Chain Falloff | Range | Attack Speed |
|---|---:|---:|---:|---:|---:|---:|
| L1 | 900 | 58 | 1 | 35% | 2.8 | 0.80 |
| L2 | 800 | 78 | 1 | 30% | 3.0 | 0.85 |
| L3 | 1200 | 105 | 1 | 25% | 3.1 | 0.90 |

## 7) Enemy Boats (v0)

## Boat Types

| Type | HP | Speed (units/s) | Coin Reward | XP Reward | Notes |
|---|---:|---:|---:|---:|---|
| Scout Boat | 180 | 1.35 | 70 | 6 | Fast, low HP |
| Raider Boat | 320 | 1.00 | 105 | 10 | Baseline unit |
| Heavy Barge | 560 | 0.78 | 160 | 16 | Slow, high HP |

No attack capability in prototype.

## Wave Composition (Map 1)

| Wave | Spawn Interval | Scouts | Raiders | Barges | Total Boats |
|---|---:|---:|---:|---:|---:|
| 1 | 1.00s | 5 | 5 | 0 | 10 |
| 2 | 0.95s | 5 | 6 | 1 | 12 |
| 3 | 0.90s | 6 | 6 | 2 | 14 |
| 4 | 0.85s | 8 | 6 | 2 | 16 |
| 5 | 0.80s | 8 | 8 | 2 | 18 |

## 8) Economy and XP Rules

## Coin Flow

- Initial: `10000`
- Spend on tower placement/upgrades.
- Gain on enemy kill.
- Lose on leak.

## XP Flow

- Gain XP per enemy kill.
- Bonus XP per wave clear: `+25`
- Bonus XP map clear: `+100`
- Lose XP on leak (`-6` per leaked boat).
- XP floor: `0` (no negative XP).

## Progression Gate (initial)

- Unlock Map 2 requirement: `>= 650 XP`

## 9) UI/HUD Prototype Requirements

## HUD (Always Visible)

- Coins (top-left)
- XP (top-left under coins)
- Wave index (`current/total`) (top-center)
- Boats remaining in wave (top-center)
- Start Wave button (bottom-right)
- Game speed controls (`1x`, `2x`) (bottom-right)

## Build Panel

- Show tower cards with cost.
- Disable card visually when coins are insufficient.
- On slot click:
  - if empty: open build options,
  - if occupied: open tower details + upgrade button.

## Feedback

- Floating text for coin reward and penalties.
- Distinct effect color:
  - Fire: orange/red,
  - Wind: cyan,
  - Lightning: yellow/white.

## 10) Data Contracts (JSON shape)

```json
{
  "map_id": "map_01_river_bend",
  "starting_coins": 10000,
  "starting_xp": 0,
  "leak_penalty": { "coins": 120, "xp": 6 },
  "unlock_requirement": { "next_map": "map_02", "min_xp": 650 },
  "path_waypoints": [],
  "build_slots": [],
  "waves": []
}
```

Tower config shape:

```json
{
  "tower_id": "magic_fire",
  "display_name": "Magic Tower - Fire",
  "levels": [
    {
      "level": 1,
      "cost": 800,
      "stats": {
        "damage": 26,
        "range": 2.7,
        "attack_speed": 0.9,
        "burn_dps": 12,
        "burn_duration": 2.5
      }
    }
  ]
}
```

## 11) Acceptance Criteria (Prototype)

1. Player can finish a full run on Map 1 from boot to result screen.
2. All tower types can be placed and upgraded with correct costs.
3. Boats follow path and resolve correctly as destroyed or leaked.
4. Economy math is deterministic and matches config values.
5. XP progression and unlock check work at end of map.
6. No hardcoded balance constants outside config files.

## 12) Balance Validation Plan (Post-Prototype)

After first playable is stable, run simulation-assisted balance checks:

1. Generate random legal spending strategies under the same start coins.
2. Simulate each strategy against fixed wave data.
3. Estimate clear rate and leak distribution.
4. Adjust tower costs/damage and leak penalties to hit target difficulty.

Initial target for Map 1:
- clear rate of `65-80%` for first-time players,
- expected leaks between `1-4` boats for average play,
- no economy deadlock before wave 3 under reasonable decisions.
