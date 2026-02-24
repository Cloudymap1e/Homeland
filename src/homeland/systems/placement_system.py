"""Tower placement and occupancy validation."""

from __future__ import annotations

from dataclasses import dataclass

from homeland.config import BuildSlot
from homeland.entities.tower import Tower


@dataclass
class PlacementSystem:
    slots: dict[str, BuildSlot]

    def __post_init__(self) -> None:
        self._towers_by_slot: dict[str, Tower] = {}
        self._counter = 0

    @classmethod
    def from_slots(cls, slots: list[BuildSlot]) -> "PlacementSystem":
        return cls(slots={slot.slot_id: slot for slot in slots})

    def is_slot_available(self, slot_id: str) -> bool:
        return slot_id in self.slots and slot_id not in self._towers_by_slot

    def place_tower(self, slot_id: str, tower_id: str) -> Tower:
        if slot_id not in self.slots:
            raise ValueError(f"Unknown slot: {slot_id}")
        if slot_id in self._towers_by_slot:
            raise ValueError(f"Slot is occupied: {slot_id}")
        self._counter += 1
        slot = self.slots[slot_id]
        tower = Tower(
            tower_instance_id=f"tower_{self._counter:03d}",
            tower_id=tower_id,
            slot_id=slot_id,
            x=slot.x,
            y=slot.y,
            level=1,
        )
        self._towers_by_slot[slot_id] = tower
        return tower

    def get_tower(self, slot_id: str) -> Tower | None:
        return self._towers_by_slot.get(slot_id)

    def all_towers(self) -> list[Tower]:
        return list(self._towers_by_slot.values())
