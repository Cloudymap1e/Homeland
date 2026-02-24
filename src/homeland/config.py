"""Config loading and validation for the Homeland prototype."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import json


@dataclass
class LeakPenalty:
    coins: int
    xp: int


@dataclass
class UnlockRequirement:
    next_map: str
    min_xp: int


@dataclass
class Waypoint:
    x: float
    y: float


@dataclass
class BuildSlot:
    slot_id: str
    x: float
    y: float


@dataclass
class MapConfig:
    map_id: str
    starting_coins: int
    starting_xp: int
    leak_penalty: LeakPenalty
    unlock_requirement: UnlockRequirement
    path_waypoints: list[Waypoint]
    build_slots: list[BuildSlot]


@dataclass
class TowerLevel:
    level: int
    cost: int
    damage: float
    range: float
    attack_speed: float
    burn_dps: float = 0.0
    burn_duration: float = 0.0
    slow_percent: float = 0.0
    slow_duration: float = 0.0
    chain_count: int = 0
    chain_falloff: float = 0.0


@dataclass
class TowerConfig:
    tower_id: str
    display_name: str
    effect_type: str
    levels: list[TowerLevel]


@dataclass
class EnemyConfig:
    enemy_type: str
    hp: float
    speed: float
    coin_reward: int
    xp_reward: int


@dataclass
class WaveConfig:
    wave_id: int
    spawn_interval: float
    composition: dict[str, int]


@dataclass
class ProgressionConfig:
    xp_per_wave_clear: int
    xp_map_clear: int


@dataclass
class GameContent:
    map_config: MapConfig
    tower_configs: dict[str, TowerConfig]
    enemy_configs: dict[str, EnemyConfig]
    waves: list[WaveConfig]
    progression: ProgressionConfig


DEFAULT_DATA_DIR = Path(__file__).resolve().parent / "data"


def _load_json(path: Path) -> dict | list:
    if not path.exists():
        raise ValueError(f"Missing config file: {path}")
    return json.loads(path.read_text())


def _require_keys(data: dict, keys: set[str], context: str) -> None:
    missing = keys - set(data.keys())
    if missing:
        raise ValueError(f"{context}: missing keys {sorted(missing)}")


def load_game_content(base_data_dir: Path | None = None) -> GameContent:
    data_dir = base_data_dir or DEFAULT_DATA_DIR

    map_raw = _load_json(data_dir / "maps" / "map_01_river_bend.json")
    _require_keys(
        map_raw,
        {
            "map_id",
            "starting_coins",
            "starting_xp",
            "leak_penalty",
            "unlock_requirement",
            "path_waypoints",
            "build_slots",
        },
        "map_01_river_bend",
    )

    map_config = MapConfig(
        map_id=map_raw["map_id"],
        starting_coins=int(map_raw["starting_coins"]),
        starting_xp=int(map_raw["starting_xp"]),
        leak_penalty=LeakPenalty(
            coins=int(map_raw["leak_penalty"]["coins"]),
            xp=int(map_raw["leak_penalty"]["xp"]),
        ),
        unlock_requirement=UnlockRequirement(
            next_map=map_raw["unlock_requirement"]["next_map"],
            min_xp=int(map_raw["unlock_requirement"]["min_xp"]),
        ),
        path_waypoints=[Waypoint(x=float(p["x"]), y=float(p["y"])) for p in map_raw["path_waypoints"]],
        build_slots=[
            BuildSlot(slot_id=s["id"], x=float(s["x"]), y=float(s["y"])) for s in map_raw["build_slots"]
        ],
    )

    if map_config.starting_coins < 0:
        raise ValueError("starting_coins must be non-negative")
    if len(map_config.path_waypoints) < 2:
        raise ValueError("path_waypoints must include at least 2 points")

    towers_raw = _load_json(data_dir / "towers" / "towers.json")
    tower_configs: dict[str, TowerConfig] = {}
    for tower in towers_raw:
        _require_keys(tower, {"tower_id", "display_name", "effect_type", "levels"}, f"tower {tower!r}")
        levels: list[TowerLevel] = []
        for level_data in tower["levels"]:
            stats = level_data["stats"]
            levels.append(
                TowerLevel(
                    level=int(level_data["level"]),
                    cost=int(level_data["cost"]),
                    damage=float(stats["damage"]),
                    range=float(stats["range"]),
                    attack_speed=float(stats["attack_speed"]),
                    burn_dps=float(stats.get("burn_dps", 0.0)),
                    burn_duration=float(stats.get("burn_duration", 0.0)),
                    slow_percent=float(stats.get("slow_percent", 0.0)),
                    slow_duration=float(stats.get("slow_duration", 0.0)),
                    chain_count=int(stats.get("chain_count", 0)),
                    chain_falloff=float(stats.get("chain_falloff", 0.0)),
                )
            )
        tower_cfg = TowerConfig(
            tower_id=tower["tower_id"],
            display_name=tower["display_name"],
            effect_type=tower["effect_type"],
            levels=sorted(levels, key=lambda l: l.level),
        )
        tower_configs[tower_cfg.tower_id] = tower_cfg

    enemies_raw = _load_json(data_dir / "enemies" / "boat_types.json")
    enemy_configs: dict[str, EnemyConfig] = {}
    for enemy in enemies_raw:
        _require_keys(enemy, {"enemy_type", "hp", "speed", "coin_reward", "xp_reward"}, f"enemy {enemy!r}")
        cfg = EnemyConfig(
            enemy_type=enemy["enemy_type"],
            hp=float(enemy["hp"]),
            speed=float(enemy["speed"]),
            coin_reward=int(enemy["coin_reward"]),
            xp_reward=int(enemy["xp_reward"]),
        )
        enemy_configs[cfg.enemy_type] = cfg

    waves_raw = _load_json(data_dir / "waves" / "map_01_waves.json")
    waves: list[WaveConfig] = []
    for wave in waves_raw:
        _require_keys(wave, {"wave_id", "spawn_interval", "composition"}, f"wave {wave!r}")
        composition = {k: int(v) for k, v in wave["composition"].items()}
        for enemy_type in composition:
            if enemy_type not in enemy_configs:
                raise ValueError(f"Wave references unknown enemy type: {enemy_type}")
        waves.append(
            WaveConfig(
                wave_id=int(wave["wave_id"]),
                spawn_interval=float(wave["spawn_interval"]),
                composition=composition,
            )
        )

    progression_raw = _load_json(data_dir / "progression" / "progression.json")
    _require_keys(progression_raw, {"xp_per_wave_clear", "xp_map_clear"}, "progression")
    progression = ProgressionConfig(
        xp_per_wave_clear=int(progression_raw["xp_per_wave_clear"]),
        xp_map_clear=int(progression_raw["xp_map_clear"]),
    )

    return GameContent(
        map_config=map_config,
        tower_configs=tower_configs,
        enemy_configs=enemy_configs,
        waves=sorted(waves, key=lambda w: w.wave_id),
        progression=progression,
    )
