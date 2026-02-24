"""Tower targeting and attack resolution."""

from __future__ import annotations

from dataclasses import dataclass
import math

from homeland.config import TowerConfig
from homeland.entities.enemy_boat import EnemyBoat
from homeland.entities.tower import Tower
from homeland.systems.pathing import Path


WORLD_SCALE = 10.0
CHAIN_RADIUS = 2.4


@dataclass
class CombatTickResult:
    killed_boats: list[EnemyBoat]
    attacks_fired: int


class CombatSystem:
    def __init__(self, tower_configs: dict[str, TowerConfig]) -> None:
        self._tower_configs = tower_configs

    def tick(self, dt: float, towers: list[Tower], boats: list[EnemyBoat], path: Path) -> CombatTickResult:
        killed: dict[str, EnemyBoat] = {}
        attacks_fired = 0

        for boat in boats:
            if boat.tick_effects(dt):
                killed[boat.boat_id] = boat

        alive_boats = [b for b in boats if not (b.destroyed or b.leaked)]

        for tower in towers:
            tower.tick_cooldown(dt)
            if not tower.can_attack():
                continue

            tower_cfg = self._tower_configs[tower.tower_id]
            level_cfg = tower_cfg.levels[tower.level - 1]

            target = self._select_target(tower, level_cfg.range, alive_boats, path)
            if target is None:
                continue

            attacks_fired += 1
            tower.reset_cooldown(level_cfg.attack_speed)

            if target.apply_damage(level_cfg.damage):
                killed[target.boat_id] = target

            if tower_cfg.effect_type == "fire":
                target.apply_burn(level_cfg.burn_dps, level_cfg.burn_duration)
            elif tower_cfg.effect_type == "wind":
                target.apply_slow(level_cfg.slow_percent, level_cfg.slow_duration)
            elif tower_cfg.effect_type == "lightning":
                self._apply_chain_damage(
                    source=target,
                    boats=alive_boats,
                    path=path,
                    chain_count=level_cfg.chain_count,
                    base_damage=level_cfg.damage,
                    chain_falloff=level_cfg.chain_falloff,
                    killed=killed,
                )

        return CombatTickResult(killed_boats=list(killed.values()), attacks_fired=attacks_fired)

    def _select_target(
        self,
        tower: Tower,
        range_units: float,
        boats: list[EnemyBoat],
        path: Path,
    ) -> EnemyBoat | None:
        in_range: list[EnemyBoat] = []
        for boat in boats:
            if boat.destroyed or boat.leaked:
                continue
            bx, by = path.position_at_distance(boat.distance)
            dist = math.hypot((tower.x - bx) * WORLD_SCALE, (tower.y - by) * WORLD_SCALE)
            if dist <= range_units:
                in_range.append(boat)

        if not in_range:
            return None

        return max(in_range, key=lambda b: b.distance)

    def _apply_chain_damage(
        self,
        source: EnemyBoat,
        boats: list[EnemyBoat],
        path: Path,
        chain_count: int,
        base_damage: float,
        chain_falloff: float,
        killed: dict[str, EnemyBoat],
    ) -> None:
        if chain_count <= 0:
            return

        sx, sy = path.position_at_distance(source.distance)
        available = [b for b in boats if b.boat_id != source.boat_id and not (b.destroyed or b.leaked)]
        if not available:
            return

        available.sort(
            key=lambda b: math.hypot(
                (sx - path.position_at_distance(b.distance)[0]) * WORLD_SCALE,
                (sy - path.position_at_distance(b.distance)[1]) * WORLD_SCALE,
            )
        )

        chain_hits = 0
        for candidate in available:
            if chain_hits >= chain_count:
                break
            cx, cy = path.position_at_distance(candidate.distance)
            dist = math.hypot((sx - cx) * WORLD_SCALE, (sy - cy) * WORLD_SCALE)
            if dist > CHAIN_RADIUS:
                continue
            chain_damage = base_damage * (1.0 - (chain_falloff / 100.0))
            if candidate.apply_damage(chain_damage):
                killed[candidate.boat_id] = candidate
            chain_hits += 1
