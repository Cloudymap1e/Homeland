from homeland.systems.economy_system import EconomySystem
from homeland.systems.progression_system import ProgressionSystem


def test_economy_transactions() -> None:
    economy = EconomySystem(coins=1000)
    assert economy.can_afford(500)
    assert economy.spend(250)
    assert economy.coins == 750
    economy.reward(100)
    assert economy.coins == 850
    economy.penalize(50)
    assert economy.coins == 800


def test_progression_floor_at_zero() -> None:
    progression = ProgressionSystem(xp=5)
    progression.remove_xp(20)
    assert progression.xp == 0
    progression.add_xp(12)
    assert progression.has_unlock(10)
