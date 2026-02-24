"""Path helpers for distance and interpolation over map waypoints."""

from __future__ import annotations

from dataclasses import dataclass
import math

from homeland.config import Waypoint


@dataclass
class Path:
    points: list[Waypoint]

    def __post_init__(self) -> None:
        if len(self.points) < 2:
            raise ValueError("Path requires at least 2 points")
        self._segments: list[tuple[Waypoint, Waypoint, float]] = []
        self.length = 0.0
        for idx in range(len(self.points) - 1):
            a = self.points[idx]
            b = self.points[idx + 1]
            seg_len = math.hypot(b.x - a.x, b.y - a.y) * 10.0
            self._segments.append((a, b, seg_len))
            self.length += seg_len

    def position_at_distance(self, distance: float) -> tuple[float, float]:
        if distance <= 0:
            return (self.points[0].x, self.points[0].y)
        if distance >= self.length:
            return (self.points[-1].x, self.points[-1].y)

        remaining = distance
        for a, b, seg_len in self._segments:
            if remaining <= seg_len:
                t = remaining / seg_len if seg_len else 0.0
                return (a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
            remaining -= seg_len

        return (self.points[-1].x, self.points[-1].y)
