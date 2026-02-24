"""Main game orchestrator for the Homeland prototype."""

from __future__ import annotations

from pathlib import Path

from homeland.config import GameContent, load_game_content
from homeland.core.event_bus import EventBus
from homeland.core.game_state import GameState
from homeland.entities.enemy_boat import EnemyBoat
from homeland.systems.combat_system import CombatSystem
from homeland.systems.economy_system import EconomySystem
from homeland.systems.pathing import Path
from homeland.systems.placement_system import PlacementSystem
from homeland.systems.progression_system import ProgressionSystem
from homeland.systems.wave_system import WaveSystem


class HomelandGame:
    """Engine-agnostic game model for tower defense prototype logic."""

    def __init__(self, data_dir: Path | None = None, content: GameContent | None = None) -> None:
        self.content = content or load_game_content(base_data_dir=data_dir)
        self.events = EventBus()
        self.state = GameState.BOOT

        self.path = Path(self.content.map_config.path_waypoints)
        self.economy = EconomySystem(coins=self.content.map_config.starting_coins)
        self.progression = ProgressionSystem(xp=self.content.map_config.starting_xp)
        self.placement = PlacementSystem.from_slots(self.content.map_config.build_slots)
        self.wave_system = WaveSystem(self.content.waves)
        self.combat = CombatSystem(self.content.tower_configs)

        self.active_boats: list[EnemyBoat] = []
        self._boat_counter = 0

        self.state = GameState.MAP_LOAD
        self.events.emit("map_load", map_id=self.content.map_config.map_id)
        self.state = GameState.BUILD_PHASE
        self.events.emit("build_phase_start")

    def build_tower(self, slot_id: str, tower_id: str) -> None:
        if self.state not in {GameState.BUILD_PHASE, GameState.WAVE_RESULT}:
            raise ValueError("Towers can only be built in build phase")

        tower_cfg = self.content.tower_configs.get(tower_id)
        if tower_cfg is None:
            raise ValueError(f"Unknown tower_id: {tower_id}")

        cost = tower_cfg.levels[0].cost
        if not self.economy.spend(cost):
            raise ValueError("Not enough coins")

        tower = self.placement.place_tower(slot_id, tower_id)
        self.events.emit("coins_changed", delta=-cost, reason="tower_build", coins=self.economy.coins)
        self.events.emit(
            "tower_built",
            tower_instance_id=tower.tower_instance_id,
            tower_id=tower.tower_id,
            slot_id=tower.slot_id,
            level=tower.level,
        )

    def upgrade_tower(self, slot_id: str) -> None:
        if self.state not in {GameState.BUILD_PHASE, GameState.WAVE_RESULT}:
            raise ValueError("Towers can only be upgraded in build phase")

        tower = self.placement.get_tower(slot_id)
        if tower is None:
            raise ValueError(f"No tower at slot: {slot_id}")

        tower_cfg = self.content.tower_configs[tower.tower_id]
        if tower.level >= len(tower_cfg.levels):
            raise ValueError("Tower is already max level")

        next_level = tower.level + 1
        upgrade_cost = tower_cfg.levels[next_level - 1].cost

        if not self.economy.spend(upgrade_cost):
            raise ValueError("Not enough coins")

        tower.level = next_level
        self.events.emit("coins_changed", delta=-upgrade_cost, reason="tower_upgrade", coins=self.economy.coins)
        self.events.emit(
            "tower_upgraded",
            tower_instance_id=tower.tower_instance_id,
            tower_id=tower.tower_id,
            slot_id=tower.slot_id,
            level=tower.level,
        )

    def start_next_wave(self) -> None:
        if self.state not in {GameState.BUILD_PHASE, GameState.WAVE_RESULT}:
            raise ValueError("Cannot start wave from current state")
        if not self.wave_system.has_more_waves():
            raise ValueError("No more waves")

        runtime = self.wave_system.start_next_wave()
        self.state = GameState.WAVE_RUNNING
        self.events.emit(
            "wave_start",
            wave_id=runtime.config.wave_id,
            total_waves=self.wave_system.total_waves,
            planned_boats=sum(runtime.config.composition.values()),
        )

    def tick(self, dt: float) -> None:
        if self.state != GameState.WAVE_RUNNING:
            return

        for enemy_type in self.wave_system.tick(dt):
            self._spawn_boat(enemy_type)

        combat_outcome = self.combat.tick(dt, self.placement.all_towers(), self.active_boats, self.path)

        if combat_outcome.attacks_fired:
            self.events.emit("combat_tick", attacks_fired=combat_outcome.attacks_fired)

        killed_ids = {boat.boat_id for boat in combat_outcome.killed_boats}
        if killed_ids:
            survivors: list[EnemyBoat] = []
            for boat in self.active_boats:
                if boat.boat_id in killed_ids:
                    self.economy.reward(boat.coin_reward)
                    self.progression.add_xp(boat.xp_reward)
                    self.events.emit("enemy_killed", boat_id=boat.boat_id, enemy_type=boat.enemy_type)
                    self.events.emit(
                        "coins_changed",
                        delta=boat.coin_reward,
                        reason="enemy_kill",
                        coins=self.economy.coins,
                    )
                    self.events.emit(
                        "xp_changed",
                        delta=boat.xp_reward,
                        reason="enemy_kill",
                        xp=self.progression.xp,
                    )
                    continue
                survivors.append(boat)
            self.active_boats = survivors

        survivors_after_move: list[EnemyBoat] = []
        for boat in self.active_boats:
            leaked = boat.move(dt, self.path.length)
            if leaked:
                self.economy.penalize(self.content.map_config.leak_penalty.coins)
                self.progression.remove_xp(self.content.map_config.leak_penalty.xp)
                self.events.emit("enemy_leaked", boat_id=boat.boat_id, enemy_type=boat.enemy_type)
                self.events.emit(
                    "coins_changed",
                    delta=-self.content.map_config.leak_penalty.coins,
                    reason="enemy_leak",
                    coins=self.economy.coins,
                )
                self.events.emit(
                    "xp_changed",
                    delta=-self.content.map_config.leak_penalty.xp,
                    reason="enemy_leak",
                    xp=self.progression.xp,
                )
            else:
                survivors_after_move.append(boat)

        self.active_boats = survivors_after_move

        if self.economy.coins < 0:
            self.state = GameState.MAP_RESULT
            self.events.emit("map_result", victory=False, unlocked_next_map=False)
            return

        if self.wave_system.is_wave_complete(active_boats=len(self.active_boats)):
            self.state = GameState.WAVE_RESULT
            self.events.emit("wave_complete", wave_id=self.wave_system.current_wave_number)
            self.wave_system.finish_wave()
            self.progression.add_xp(self.content.progression.xp_per_wave_clear)
            self.events.emit(
                "xp_changed",
                delta=self.content.progression.xp_per_wave_clear,
                reason="wave_clear",
                xp=self.progression.xp,
            )

            if self.wave_system.has_more_waves():
                self.state = GameState.BUILD_PHASE
                self.events.emit("build_phase_start")
            else:
                self.progression.add_xp(self.content.progression.xp_map_clear)
                self.events.emit(
                    "xp_changed",
                    delta=self.content.progression.xp_map_clear,
                    reason="map_clear",
                    xp=self.progression.xp,
                )
                unlocked = self.progression.has_unlock(self.content.map_config.unlock_requirement.min_xp)
                self.state = GameState.MAP_RESULT
                self.events.emit("map_result", victory=True, unlocked_next_map=unlocked)

    def boats_remaining_current_wave(self) -> int:
        return len(self.active_boats) + self.wave_system.boats_remaining_to_spawn()

    def snapshot(self) -> dict[str, int | str | bool]:
        return {
            "state": self.state.value,
            "coins": self.economy.coins,
            "xp": self.progression.xp,
            "current_wave": self.wave_system.current_wave_number,
            "total_waves": self.wave_system.total_waves,
            "boats_remaining": self.boats_remaining_current_wave(),
            "towers_built": len(self.placement.all_towers()),
            "next_map_unlocked": self.progression.has_unlock(self.content.map_config.unlock_requirement.min_xp),
        }

    def _spawn_boat(self, enemy_type: str) -> None:
        enemy_cfg = self.content.enemy_configs[enemy_type]
        self._boat_counter += 1
        boat = EnemyBoat(
            boat_id=f"boat_{self._boat_counter:04d}",
            enemy_type=enemy_cfg.enemy_type,
            max_hp=enemy_cfg.hp,
            hp=enemy_cfg.hp,
            speed=enemy_cfg.speed,
            coin_reward=enemy_cfg.coin_reward,
            xp_reward=enemy_cfg.xp_reward,
            distance=0.0,
        )
        self.active_boats.append(boat)
        self.events.emit("enemy_spawned", boat_id=boat.boat_id, enemy_type=boat.enemy_type)
