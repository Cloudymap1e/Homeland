"""Game state definitions for prototype flow."""

from enum import Enum


class GameState(str, Enum):
    BOOT = "boot"
    MAP_LOAD = "map_load"
    BUILD_PHASE = "build_phase"
    WAVE_RUNNING = "wave_running"
    WAVE_RESULT = "wave_result"
    MAP_RESULT = "map_result"
    PAUSED = "paused"
