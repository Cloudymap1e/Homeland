"""Simple in-memory event bus for gameplay telemetry."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class Event:
    """Runtime event payload."""

    name: str
    payload: dict[str, Any]


class EventBus:
    """Collects events so systems can emit traceable state changes."""

    def __init__(self) -> None:
        self._events: list[Event] = []

    def emit(self, name: str, **payload: Any) -> None:
        self._events.append(Event(name=name, payload=payload))

    @property
    def events(self) -> list[Event]:
        return self._events

    def drain(self) -> list[Event]:
        events = self._events[:]
        self._events.clear()
        return events
