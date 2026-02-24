"""XP progression operations."""

from dataclasses import dataclass


@dataclass
class ProgressionSystem:
    xp: int

    def add_xp(self, amount: int) -> None:
        if amount < 0:
            raise ValueError("amount must be non-negative")
        self.xp += amount

    def remove_xp(self, amount: int) -> None:
        if amount < 0:
            raise ValueError("amount must be non-negative")
        self.xp = max(0, self.xp - amount)

    def has_unlock(self, min_xp: int) -> bool:
        return self.xp >= min_xp
