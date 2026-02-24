from homeland.config import WaveConfig
from homeland.systems.wave_system import WaveSystem


def test_wave_spawns_expected_count() -> None:
    waves = [WaveConfig(wave_id=1, spawn_interval=0.5, composition={"scout": 2, "raider": 1})]
    wave_system = WaveSystem(waves)
    wave_system.start_next_wave()

    spawned = []
    for _ in range(10):
        spawned.extend(wave_system.tick(0.25))

    assert spawned.count("scout") == 2
    assert spawned.count("raider") == 1
    assert len(spawned) == 3
