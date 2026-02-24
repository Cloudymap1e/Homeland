from homeland.config import TowerLevel, TowerConfig, Waypoint
from homeland.entities.enemy_boat import EnemyBoat
from homeland.entities.tower import Tower
from homeland.systems.combat_system import CombatSystem
from homeland.systems.pathing import Path


def test_fire_burn_refresh_not_additive() -> None:
    boat = EnemyBoat(
        boat_id="b1",
        enemy_type="scout",
        max_hp=100,
        hp=100,
        speed=1.0,
        coin_reward=0,
        xp_reward=0,
    )
    boat.apply_burn(12, 2.5)
    boat.apply_burn(8, 1.0)

    assert boat.burn_dps == 12
    assert boat.burn_duration_left == 1.0


def test_wind_slow_uses_highest_only() -> None:
    boat = EnemyBoat(
        boat_id="b1",
        enemy_type="scout",
        max_hp=100,
        hp=100,
        speed=1.0,
        coin_reward=0,
        xp_reward=0,
    )
    boat.apply_slow(22, 1.8)
    boat.apply_slow(10, 3.0)

    assert boat.slow_percent == 22
    assert boat.slow_duration_left == 3.0


def test_lightning_chain_hits_secondary_target() -> None:
    lightning = TowerConfig(
        tower_id="magic_lightning",
        display_name="Magic Tower - Lightning",
        effect_type="lightning",
        levels=[
            TowerLevel(
                level=1,
                cost=100,
                damage=58,
                range=2.8,
                attack_speed=0.8,
                chain_count=1,
                chain_falloff=35,
            )
        ],
    )

    system = CombatSystem({"magic_lightning": lightning})
    path = Path([Waypoint(x=0.0, y=0.5), Waypoint(x=1.0, y=0.5)])

    tower = Tower(
        tower_instance_id="t1",
        tower_id="magic_lightning",
        slot_id="s1",
        x=0.25,
        y=0.5,
    )

    primary = EnemyBoat(
        boat_id="b1",
        enemy_type="raider",
        max_hp=200,
        hp=200,
        speed=0.1,
        coin_reward=0,
        xp_reward=0,
        distance=2.3,
    )
    secondary = EnemyBoat(
        boat_id="b2",
        enemy_type="raider",
        max_hp=200,
        hp=200,
        speed=0.1,
        coin_reward=0,
        xp_reward=0,
        distance=2.5,
    )

    system.tick(0.1, [tower], [primary, secondary], path)

    # Targeting favors the boat closest to exit; chain hits the second target.
    assert sorted([round(primary.hp, 1), round(secondary.hp, 1)]) == [142.0, 162.3]
