"""CLI entry point for the Homeland prototype simulation."""

from __future__ import annotations

from homeland.core.game_state import GameState
from homeland.game import HomelandGame


def _auto_build(game: HomelandGame) -> None:
    # Deterministic baseline strategy for first playable simulation.
    planned_builds = [
        ("s03", "arrow"),
        ("s05", "bone"),
        ("s08", "magic_fire"),
        ("s07", "magic_wind"),
    ]

    for slot_id, tower_id in planned_builds:
        if game.placement.is_slot_available(slot_id):
            try:
                game.build_tower(slot_id, tower_id)
            except ValueError:
                continue


def _auto_upgrade(game: HomelandGame) -> None:
    for slot_id in ["s03", "s05", "s08", "s07"]:
        tower = game.placement.get_tower(slot_id)
        if not tower:
            continue
        try:
            game.upgrade_tower(slot_id)
            break
        except ValueError:
            continue


def main() -> None:
    game = HomelandGame()
    _auto_build(game)

    while game.state != GameState.MAP_RESULT:
        if game.state == GameState.BUILD_PHASE:
            _auto_upgrade(game)
            game.start_next_wave()

        if game.state == GameState.WAVE_RUNNING:
            game.tick(0.1)

    summary = game.snapshot()
    print("Homeland Prototype Run")
    print(f"state={summary['state']}")
    print(f"coins={summary['coins']}")
    print(f"xp={summary['xp']}")
    print(f"waves={summary['current_wave']}/{summary['total_waves']}")
    print(f"towers_built={summary['towers_built']}")
    print(f"next_map_unlocked={summary['next_map_unlocked']}")


if __name__ == "__main__":
    main()
