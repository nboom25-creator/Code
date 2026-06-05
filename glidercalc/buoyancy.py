"""Buoyancy and ballast calculations.

An underwater glider moves by making itself slightly heavier than the
surrounding water (to dive) or slightly lighter (to climb). The driving force
of the whole vehicle is this small *net buoyancy*, so getting it right is the
foundation of the design.

Key relationships (SI units)::

    buoyancy force      B   = rho_water * g * V_displaced
    weight force        W   = mass * g
    net buoyancy force  F   = B - W            (positive => floats up)
    ballast volume      dV  = dF / (rho_water * g)
"""

from __future__ import annotations

from dataclasses import dataclass

from . import constants


def buoyancy_force(displaced_volume_m3: float,
                   water_density: float = constants.DEFAULT_WATER_DENSITY,
                   g: float = constants.GRAVITY) -> float:
    """Upward buoyancy force (N) for a body displacing ``displaced_volume_m3``."""
    return water_density * g * displaced_volume_m3


def weight_force(mass_kg: float, g: float = constants.GRAVITY) -> float:
    """Downward weight force (N) of a body of mass ``mass_kg``."""
    return mass_kg * g


def neutral_volume(mass_kg: float,
                   water_density: float = constants.DEFAULT_WATER_DENSITY) -> float:
    """Displaced volume (m^3) at which the vehicle is neutrally buoyant."""
    return mass_kg / water_density


def ballast_volume_for_force(net_force_n: float,
                             water_density: float = constants.DEFAULT_WATER_DENSITY,
                             g: float = constants.GRAVITY) -> float:
    """Volume change (m^3) needed to produce a net buoyancy force ``net_force_n``.

    A positive result is the extra displaced volume (or expelled ballast water)
    required to obtain that much upward force.
    """
    return net_force_n / (water_density * g)


@dataclass
class BuoyancyResult:
    """Outcome of a buoyancy analysis. Forces are in newtons, volumes in m^3."""

    mass_kg: float
    displaced_volume_m3: float
    water_density: float
    buoyancy_force_n: float
    weight_force_n: float
    net_force_n: float
    net_mass_g: float
    neutral_volume_m3: float
    volume_to_neutral_m3: float

    @property
    def is_positively_buoyant(self) -> bool:
        return self.net_force_n > 0

    def summary(self) -> str:
        state = ("positively buoyant (rises)" if self.net_force_n > 1e-9
                 else "negatively buoyant (sinks)" if self.net_force_n < -1e-9
                 else "neutrally buoyant")
        lines = [
            "Buoyancy & ballast",
            "------------------",
            f"  Mass                : {self.mass_kg:.3f} kg",
            f"  Displaced volume    : {self.displaced_volume_m3 * 1e3:.3f} L "
            f"({self.displaced_volume_m3:.6f} m^3)",
            f"  Water density       : {self.water_density:.1f} kg/m^3",
            f"  Buoyancy force      : {self.buoyancy_force_n:.3f} N",
            f"  Weight force        : {self.weight_force_n:.3f} N",
            f"  Net force           : {self.net_force_n:+.3f} N  -> {state}",
            f"  Net (mass equiv.)   : {self.net_mass_g:+.1f} g",
            f"  Neutral volume      : {self.neutral_volume_m3 * 1e3:.3f} L",
            f"  Vol. change to neutral: {self.volume_to_neutral_m3 * 1e3:+.4f} L",
        ]
        return "\n".join(lines)


def analyze(mass_kg: float,
            displaced_volume_m3: float,
            water_density: float = constants.DEFAULT_WATER_DENSITY,
            g: float = constants.GRAVITY) -> BuoyancyResult:
    """Full buoyancy analysis for a vehicle of known mass and displaced volume."""
    b = buoyancy_force(displaced_volume_m3, water_density, g)
    w = weight_force(mass_kg, g)
    net = b - w
    v_neutral = neutral_volume(mass_kg, water_density)
    return BuoyancyResult(
        mass_kg=mass_kg,
        displaced_volume_m3=displaced_volume_m3,
        water_density=water_density,
        buoyancy_force_n=b,
        weight_force_n=w,
        net_force_n=net,
        net_mass_g=(net / g) * 1e3,
        neutral_volume_m3=v_neutral,
        volume_to_neutral_m3=v_neutral - displaced_volume_m3,
    )
