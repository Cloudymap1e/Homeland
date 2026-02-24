"""Enemy boat entity and status effect logic."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class EnemyBoat:
    boat_id: str
    enemy_type: str
    max_hp: float
    hp: float
    speed: float
    coin_reward: int
    xp_reward: int
    distance: float = 0.0
    leaked: bool = False
    destroyed: bool = False
    burn_dps: float = 0.0
    burn_duration_left: float = 0.0
    slow_percent: float = 0.0
    slow_duration_left: float = 0.0

    def apply_damage(self, amount: float) -> bool:
        if self.destroyed or self.leaked:
            return False
        self.hp -= max(amount, 0.0)
        if self.hp <= 0:
            self.hp = 0
            self.destroyed = True
            return True
        return False

    def apply_burn(self, dps: float, duration: float) -> None:
        if self.destroyed or self.leaked:
            return
        if dps <= 0 or duration <= 0:
            return
        self.burn_dps = max(self.burn_dps, dps)
        self.burn_duration_left = duration

    def apply_slow(self, slow_percent: float, duration: float) -> None:
        if self.destroyed or self.leaked:
            return
        if slow_percent <= 0 or duration <= 0:
            return
        if slow_percent > self.slow_percent:
            self.slow_percent = slow_percent
        self.slow_duration_left = max(self.slow_duration_left, duration)

    def tick_effects(self, dt: float) -> bool:
        if self.destroyed or self.leaked:
            return False

        if self.burn_duration_left > 0:
            killed = self.apply_damage(self.burn_dps * dt)
            self.burn_duration_left = max(0.0, self.burn_duration_left - dt)
            if self.burn_duration_left == 0:
                self.burn_dps = 0.0
            if killed:
                return True

        if self.slow_duration_left > 0:
            self.slow_duration_left = max(0.0, self.slow_duration_left - dt)
            if self.slow_duration_left == 0:
                self.slow_percent = 0.0

        return False

    def move(self, dt: float, path_length: float) -> bool:
        if self.destroyed or self.leaked:
            return False

        speed_multiplier = 1.0 - min(self.slow_percent / 100.0, 0.8)
        self.distance += self.speed * speed_multiplier * dt
        if self.distance >= path_length:
            self.leaked = True
            return True
        return False
