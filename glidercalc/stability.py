"""Static stability and pitch/roll trim for a fully submerged glider.

A submerged vehicle is kept upright not by a waterplane (as a surface ship is)
but by the vertical separation between its centre of buoyancy (CB) and centre of
gravity (CG). For stability the **CB must sit above the CG**; the vertical gap
``BG`` is the stability lever.

Coordinate convention
---------------------
* ``x`` : longitudinal, positive forward (towards the nose)
* ``z`` : vertical, positive up

When the vehicle tilts by an angle ``theta`` the weight (down, through CG) and
buoyancy (up, through CB) form a righting couple::

    M_restore = B * BG * sin(theta)      (B ~= W near neutral buoyancy)

Pitch trim by a moving mass
---------------------------
Gliders pitch by sliding an internal mass (often the battery) fore/aft. Moving a
mass ``m_p`` by a distance ``d`` shifts the CG longitudinally by::

    dx_cg = m_p * d / m_total

The vehicle then pitches until the CG is again vertically below the CB::

    tan(theta) = dx_cg / BG

so a larger BG gives a "stiffer", harder-to-trim vehicle, and a smaller BG
trims more easily but is less stable.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable

from . import constants


@dataclass
class MassComponent:
    """A point mass at a longitudinal/vertical location (SI units)."""

    name: str
    mass_kg: float
    x_m: float = 0.0
    z_m: float = 0.0


def center_of_mass(components: Iterable[MassComponent]) -> tuple[float, float, float]:
    """Return ``(total_mass, x_cg, z_cg)`` for a set of point masses."""
    comps = list(components)
    total = sum(c.mass_kg for c in comps)
    if total <= 0:
        raise ValueError("total mass must be positive")
    x = sum(c.mass_kg * c.x_m for c in comps) / total
    z = sum(c.mass_kg * c.z_m for c in comps) / total
    return total, x, z


@dataclass
class StabilityResult:
    """Static-stability and trim summary (SI units; angles in degrees)."""

    total_mass_kg: float
    cg_x_m: float
    cg_z_m: float
    cb_x_m: float
    cb_z_m: float
    bg_m: float
    is_stable: bool
    righting_stiffness_nm_per_rad: float
    longitudinal_offset_m: float
    natural_pitch_deg: float

    def summary(self) -> str:
        verdict = ("STABLE (CB above CG)" if self.is_stable
                   else "UNSTABLE (CG at or above CB - will roll/pitch over)")
        lines = [
            "Stability & trim",
            "----------------",
            f"  Total mass          : {self.total_mass_kg:.3f} kg",
            f"  CG (x, z)           : ({self.cg_x_m:+.4f}, {self.cg_z_m:+.4f}) m",
            f"  CB (x, z)           : ({self.cb_x_m:+.4f}, {self.cb_z_m:+.4f}) m",
            f"  BG (CB above CG)    : {self.bg_m * 1e3:+.1f} mm  -> {verdict}",
            f"  Righting stiffness  : {self.righting_stiffness_nm_per_rad:.3f} N·m/rad",
            f"  Long. CG-CB offset  : {self.longitudinal_offset_m * 1e3:+.1f} mm",
            f"  Natural pitch       : {self.natural_pitch_deg:+.2f} deg "
            "(at rest, from any built-in offset)",
        ]
        return "\n".join(lines)


def analyze(cg_x_m: float, cg_z_m: float,
            cb_x_m: float, cb_z_m: float,
            total_mass_kg: float,
            buoyancy_force_n: float | None = None,
            g: float = constants.GRAVITY) -> StabilityResult:
    """Static stability from CG and CB positions.

    ``buoyancy_force_n`` defaults to the vehicle weight (neutral buoyancy),
    which sets the magnitude of the righting couple.
    """
    bg = cb_z_m - cg_z_m  # positive when CB is above CG -> stable
    b = buoyancy_force_n if buoyancy_force_n is not None else total_mass_kg * g
    stiffness = b * bg  # dM/dtheta at theta=0 for M = B*BG*sin(theta)
    long_offset = cg_x_m - cb_x_m
    # At rest the vehicle pitches until CG is below CB: tan(theta)=offset/BG.
    natural_pitch = math.degrees(math.atan2(long_offset, bg)) if bg != 0 else 0.0
    return StabilityResult(
        total_mass_kg=total_mass_kg,
        cg_x_m=cg_x_m,
        cg_z_m=cg_z_m,
        cb_x_m=cb_x_m,
        cb_z_m=cb_z_m,
        bg_m=bg,
        is_stable=bg > 0,
        righting_stiffness_nm_per_rad=stiffness,
        longitudinal_offset_m=long_offset,
        natural_pitch_deg=natural_pitch,
    )


def pitch_from_mass_shift(mass_shift_kg: float,
                          shift_distance_m: float,
                          total_mass_kg: float,
                          bg_m: float) -> float:
    """Pitch angle (deg) produced by sliding ``mass_shift_kg`` by a distance.

    Positive ``shift_distance_m`` (forward) gives a nose-down pitch.
    """
    if bg_m <= 0:
        raise ValueError("bg_m must be positive (vehicle must be statically stable)")
    dx_cg = mass_shift_kg * shift_distance_m / total_mass_kg
    return math.degrees(math.atan2(dx_cg, bg_m))


def mass_shift_for_pitch(target_pitch_deg: float,
                         movable_mass_kg: float,
                         total_mass_kg: float,
                         bg_m: float) -> float:
    """Travel distance (m) of ``movable_mass_kg`` needed for a target pitch."""
    if bg_m <= 0:
        raise ValueError("bg_m must be positive (vehicle must be statically stable)")
    if movable_mass_kg <= 0:
        raise ValueError("movable_mass_kg must be positive")
    dx_cg = bg_m * math.tan(math.radians(target_pitch_deg))
    return dx_cg * total_mass_kg / movable_mass_kg
