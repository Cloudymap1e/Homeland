"""Coin economy operations."""

from dataclasses import dataclass


@dataclass
class EconomySystem:
    coins: int

    def can_afford(self, amount: int) -> bool:
        return self.coins >= amount

    def spend(self, amount: int) -> bool:
        if amount < 0:
            raise ValueError("amount must be non-negative")
        if self.coins < amount:
            return False
        self.coins -= amount
        return True

    def reward(self, amount: int) -> None:
        if amount < 0:
            raise ValueError("amount must be non-negative")
        self.coins += amount

    def penalize(self, amount: int) -> None:
        if amount < 0:
            raise ValueError("amount must be non-negative")
        self.coins -= amount
