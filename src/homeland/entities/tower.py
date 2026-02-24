"""Tower entity and attack cooldown logic."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Tower:
    tower_instance_id: str
    tower_id: str
    slot_id: str
    x: float
    y: float
    level: int = 1
    cooldown_left: float = 0.0

    def tick_cooldown(self, dt: float) -> None:
        self.cooldown_left = max(0.0, self.cooldown_left - dt)

    def can_attack(self) -> bool:
        return self.cooldown_left <= 0.0

    def reset_cooldown(self, attack_speed: float) -> None:
        if attack_speed <= 0:
            self.cooldown_left = 1.0
        else:
            self.cooldown_left = 1.0 / attack_speed
