"""Wave scheduling and enemy spawn queue."""

from __future__ import annotations

from dataclasses import dataclass

from homeland.config import WaveConfig


@dataclass
class WaveRuntime:
    config: WaveConfig
    spawn_queue: list[str]
    spawn_cooldown: float = 0.0

    @property
    def is_finished_spawning(self) -> bool:
        return not self.spawn_queue


class WaveSystem:
    def __init__(self, waves: list[WaveConfig]) -> None:
        if not waves:
            raise ValueError("At least one wave is required")
        self._waves = sorted(waves, key=lambda w: w.wave_id)
        self._wave_index = -1
        self._runtime: WaveRuntime | None = None

    @property
    def current_wave_number(self) -> int:
        if self._wave_index < 0:
            return 0
        return self._waves[self._wave_index].wave_id

    @property
    def total_waves(self) -> int:
        return len(self._waves)

    def has_more_waves(self) -> bool:
        return self._wave_index + 1 < len(self._waves)

    def has_active_wave(self) -> bool:
        return self._runtime is not None

    def start_next_wave(self) -> WaveRuntime:
        if self._runtime is not None:
            raise ValueError("Wave already running")
        if not self.has_more_waves():
            raise ValueError("No more waves")
        self._wave_index += 1
        config = self._waves[self._wave_index]
        queue: list[str] = []
        for enemy_type, count in config.composition.items():
            queue.extend([enemy_type] * count)
        runtime = WaveRuntime(config=config, spawn_queue=queue)
        self._runtime = runtime
        return runtime

    def tick(self, dt: float) -> list[str]:
        if self._runtime is None:
            return []

        spawned: list[str] = []
        self._runtime.spawn_cooldown -= dt

        while self._runtime.spawn_queue and self._runtime.spawn_cooldown <= 0:
            spawned.append(self._runtime.spawn_queue.pop(0))
            self._runtime.spawn_cooldown += self._runtime.config.spawn_interval

        return spawned

    def is_wave_complete(self, active_boats: int) -> bool:
        if self._runtime is None:
            return False
        return self._runtime.is_finished_spawning and active_boats == 0

    def finish_wave(self) -> None:
        self._runtime = None

    def boats_remaining_to_spawn(self) -> int:
        if self._runtime is None:
            return 0
        return len(self._runtime.spawn_queue)
