from homeland.config import load_game_content


def test_load_content_success() -> None:
    content = load_game_content()
    assert content.map_config.map_id == "map_01_river_bend"
    assert content.map_config.starting_coins == 10000
    assert len(content.map_config.path_waypoints) == 7
    assert len(content.map_config.build_slots) == 10
    assert "arrow" in content.tower_configs
    assert "scout" in content.enemy_configs
    assert len(content.waves) == 5
    assert content.progression.xp_per_wave_clear == 25
