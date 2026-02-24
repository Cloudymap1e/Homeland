# Homeland - River Defense

Homeland is a tower defense strategy game where the player protects river routes from pirate fleets.

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

2. Bone Tower
- Role: heavier physical damage
- Typical behavior: slower attack speed, higher per-hit damage

3. Magic Tower
- Role: elemental effects and burst utility
- Initial elements:
  - Fire (damage-over-time)
  - Wind (slow/disrupt)
  - Lightning (burst or chain)

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
- Penalties:
  - coin deduction
  - XP deduction
- Progression unlock: next map requires minimum XP threshold.

## Economy and Progression

### Economy

- Coins are used for:
  - tower placement
  - tower upgrades
- Coins are gained from:
  - destroying enemy boats
  - completing waves/maps (optional bonus)
- Coins are lost from:
  - leak penalties

### XP Progression

- XP gained by successful defense and completions.
- XP deducted on leak/failure conditions.
- Map unlocks require XP milestones.
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

## Current Status

This repository currently contains planning/foundation documents.
Implementation should begin from the MVP plan above.
