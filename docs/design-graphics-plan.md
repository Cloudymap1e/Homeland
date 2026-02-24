# Homeland Design + Graphics Upgrade Plan (v0.1)

## Objective

Upgrade the current playable prototype from functional wireframe visuals to a cohesive, production-ready visual style for the first public demo.

Primary target:
- improve readability,
- improve visual identity,
- improve perceived game quality,
- keep gameplay clarity as the highest priority.

## Scope (This Phase)

### In Scope

- Full visual direction for Map 1.
- HUD redesign and interaction polish.
- 2D art pass for map, towers, enemies, projectiles, and effects.
- Animation pass for attacks, hits, leaks, upgrades, and wave transitions.
- Responsive layout tuning for desktop and mobile.
- Basic sound placeholders tied to VFX/SFX events.

### Out of Scope

- 3D assets.
- New gameplay mechanics.
- Campaign UI and meta progression screens.
- Localization and advanced accessibility features (beyond color contrast baseline).

## Art Direction (Concrete)

## Theme

"Frontier River Defense": nautical strategy with hand-painted tactical look.

## Visual Pillars

1. Clarity first
- Towers, boats, and projectiles must be distinguishable at a glance.
- Damage/effect states must be visible without opening panels.

2. Material contrast
- River = cool blue spectrum.
- Land = warm green/brown.
- Player structures = carved wood + metal highlights.
- Enemy fleet = dark hulls + faction color accents.

3. Effect language
- Fire = orange/red glow + ember particles.
- Wind = cyan arcs + soft ribbon trails.
- Lightning = high-contrast yellow-white bolt segments.

## Color System (v1 Palette)

- Background deep: `#0A1423`
- River mid: `#0E4773`
- River highlight: `#43A9E8`
- Land mid: `#2E5B3F`
- Land dark: `#1E3C2C`
- UI panel: `#111827`
- UI panel border: `#2C3E57`
- Friendly accent: `#5CC8FF`
- Warning accent: `#F59E0B`
- Danger accent: `#EF4444`
- Success accent: `#22C55E`

## Typography

- Display/Title: `Cinzel` (or fallback `Georgia`)
- Body/UI: `Inter` (or fallback `Segoe UI`)
- Numeric/HUD emphasis: `JetBrains Mono`

## UX + UI Upgrade Plan

## HUD Layout (Desktop)

- Top-left: coins, XP, leak counter.
- Top-center: wave progress bar + boats remaining.
- Bottom-left: selected slot/tower details card.
- Bottom-right: build/upgrade action group.
- Right-side collapsible panel: tower catalog and element tooltips.

## HUD Layout (Mobile)

- Top compact bar for resources and wave state.
- Bottom sheet with tabs:
  - Build
  - Upgrade
  - Speed/Controls

## Interaction States

- Build slot hover: ring highlight + valid/invalid color.
- Tower selected: persistent halo + range circle.
- Upgrade preview: stat delta tooltip and cost badge.
- Insufficient coins: shake + muted disabled style.

## Graphic Asset Deliverables

## Map Assets

- `map_01_bg_land.png` (base terrain)
- `map_01_bg_river.png` (water layer)
- `map_01_overlay_details.png` (rocks, reeds, foam)

## Tower Assets (per type)

- Idle sprite
- Attack frame(s)
- Upgrade visual variant (L1-L3)
- Shadow sprite

## Enemy Assets

- Scout boat sprite + wake
- Raider boat sprite + wake
- Barge sprite + wake
- Leak indicator icon

## FX Assets

- Projectile sprites (arrow, bone shard, fire orb, wind arc, lightning bolt)
- Hit impact sprites per damage type
- Burn, slow, chain overlays
- Wave start/clear banner animations

## UI Assets

- Panel backgrounds, button states, icon pack (coins, XP, wave, speed)
- Tower element icons and rarity/role tags

## Animation + VFX Specifications

## Timing Targets

- Basic attack readability window: `120ms-240ms`
- Hit flash duration: `80ms-120ms`
- Upgrade pulse: `350ms`
- Leak warning pulse: `500ms` repeating while active

## Motion Rules

- No more than 2 simultaneous strong screen-space flashes.
- Use additive blend only for magic effects.
- Keep camera static for MVP (no shake), except optional subtle leak pulse.

## Technical Implementation Plan

## Rendering Layers (Back to Front)

1. Terrain base
2. River base
3. Path decals/wakes
4. Towers
5. Enemies
6. Projectiles
7. Hit/VFX overlays
8. UI/HUD

## Asset Pipeline

1. Create source files in `assets/source/`.
2. Export optimized runtime assets to `web/assets/`.
3. Enforce naming convention:
- `tower_<type>_l<level>_<state>.png`
- `enemy_<type>_<state>.png`
- `fx_<effect>_<variant>.png`

## Performance Budgets

- Target frame time: `< 16.6ms` desktop, `< 24ms` mobile.
- Draw calls (approx in current canvas model): keep under `220` average.
- Texture budget for Map 1 runtime: `< 20MB` total.
- Avoid real-time expensive blur filters in main loop.

## Concrete Task Backlog (Design/Graphics)

## P0 (Demo-Critical)

| ID | Task | Owner | Estimate | Dependency | Acceptance Criteria |
|---|---|---|---|---|---|
| DG-001 | Build visual style board + final palette tokens | Design | 0.5d | none | Approved palette and references in repo |
| DG-002 | Redesign HUD layout and component states | Design/Frontend | 1.0d | DG-001 | HUD wireframe + interaction spec approved |
| DG-003 | Implement HUD component refactor in web prototype | Frontend | 1.5d | DG-002 | Existing gameplay fully usable with new HUD |
| DG-004 | Add map layered background rendering | Frontend | 1.0d | DG-001 | Terrain + river + detail layers load correctly |
| DG-005 | Replace placeholder tower/enemy visuals with v1 sprite set | Art/Frontend | 2.0d | DG-001 | All towers/boats visually distinct in-game |
| DG-006 | Add projectile trails + hit effects by element type | Frontend | 1.5d | DG-005 | Fire/Wind/Lightning effects clearly differentiated |
| DG-007 | Add UX state feedback (invalid build, upgrade success, leak warning) | Frontend | 1.0d | DG-003 | Feedback states visible and non-blocking |
| DG-008 | Responsive polish for <=980px layout | Frontend | 1.0d | DG-003 | No overlapping controls on mobile viewport |

## P1 (Quality)

| ID | Task | Owner | Estimate | Dependency | Acceptance Criteria |
|---|---|---|---|---|---|
| DG-101 | Add micro-animations (panel enter, button states, wave banner) | Frontend | 1.0d | DG-003 | Animations improve clarity without stutter |
| DG-102 | Add audio placeholders mapped to major events | Frontend | 0.75d | DG-006 | Attack/hit/leak/wave cues audible and balanced |
| DG-103 | Visual QA pass for color contrast and readability | Design/QA | 0.5d | DG-008 | Contrast issues logged/fixed for MVP screens |

## Parallel Execution Matrix

Tasks that can run at the same time safely:

1. `DG-001` with art asset sketching prep.
2. `DG-003` and `DG-004` after `DG-002`/`DG-001` respectively.
3. `DG-005` art production in parallel with `DG-003` coding.
4. `DG-006` parallel with `DG-008` after base visuals are integrated.
5. `DG-101` and `DG-103` in parallel near finish.

Do not run together due to dependency conflicts:

1. `DG-003` before `DG-002` approval.
2. `DG-006` before `DG-005` integration.
3. `DG-103` before responsive/UI stabilization.

## Milestone Timeline (10 Working Days)

1. Day 1-2: `DG-001`, `DG-002`
2. Day 3-5: `DG-003`, `DG-004`, begin `DG-005`
3. Day 6-7: complete `DG-005`, run `DG-006`
4. Day 8: `DG-007`, `DG-008`
5. Day 9: `DG-101`, `DG-102`
6. Day 10: `DG-103`, bug fix buffer, demo packaging

## Review Gates

## Gate A: Art Direction Approval

- Palette, typography, and UI wireframes approved.

## Gate B: Visual Integration Check

- All v1 assets integrated with no broken states.

## Gate C: Demo Readiness

- 1 full map run with upgraded visuals at stable frame pacing.

## Acceptance Criteria for This Phase

1. A new player can identify all tower/enemy/effect types visually in under 10 seconds.
2. HUD remains readable during heavy combat.
3. Mobile layout remains playable without hidden core controls.
4. Performance stays within budget on target device.
5. Design docs and asset manifest are updated for maintainability.
