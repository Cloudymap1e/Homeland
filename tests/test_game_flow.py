from homeland.config import (
    BuildSlot,
    EnemyConfig,
    GameContent,
    LeakPenalty,
    MapConfig,
    ProgressionConfig,
    TowerConfig,
    TowerLevel,
    UnlockRequirement,
    WaveConfig,
    Waypoint,
)
from homeland.core.game_state import GameState
from homeland.game import HomelandGame


def _mini_content() -> GameContent:
    map_cfg = MapConfig(
        map_id="test_map",
        starting_coins=100,
        starting_xp=0,
        leak_penalty=LeakPenalty(coins=10, xp=2),
        unlock_requirement=UnlockRequirement(next_map="map_02", min_xp=10),
        path_waypoints=[Waypoint(x=0.0, y=0.5), Waypoint(x=1.0, y=0.5)],
        build_slots=[BuildSlot(slot_id="s1", x=0.2, y=0.5)],
    )

    towers = {
        "arrow": TowerConfig(
            tower_id="arrow",
            display_name="Arrow Tower",
            effect_type="physical",
            levels=[
                TowerLevel(level=1, cost=10, damage=80, range=5.0, attack_speed=5.0),
                TowerLevel(level=2, cost=10, damage=90, range=5.0, attack_speed=5.0),
            ],
        )
    }

    enemies = {
        "scout": EnemyConfig(enemy_type="scout", hp=50, speed=0.2, coin_reward=5, xp_reward=2)
    }

    waves = [WaveConfig(wave_id=1, spawn_interval=0.1, composition={"scout": 1})]
    progression = ProgressionConfig(xp_per_wave_clear=3, xp_map_clear=7)

    return GameContent(
        map_config=map_cfg,
        tower_configs=towers,
        enemy_configs=enemies,
        waves=waves,
        progression=progression,
    )


def test_game_completes_and_rewards_progression() -> None:
    game = HomelandGame(content=_mini_content())
    game.build_tower("s1", "arrow")
    assert game.economy.coins == 90

    game.start_next_wave()
    guard = 0
    while game.state != GameState.MAP_RESULT and guard < 200:
        game.tick(0.1)
        guard += 1

    assert game.state == GameState.MAP_RESULT
    assert game.economy.coins == 95
    assert game.progression.xp == 12
