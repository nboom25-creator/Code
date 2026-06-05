"""Pressure-hull stress and collapse-depth calculations.

The hull must survive external water pressure at depth without either yielding
(material overstress) or buckling (elastic instability). Two failure modes are
checked for the two common hull shapes.

External pressure at depth (gauge, i.e. above atmospheric)::

    p = rho_water * g * depth

Thin-wall stresses
------------------
Cylinder under external pressure (hoop stress is the larger one)::

    sigma_hoop = p * r / t

Sphere under external pressure::

    sigma = p * r / (2 t)

Elastic buckling (critical collapse pressure)
---------------------------------------------
Long cylinder (classic Bryant/long-tube formula)::

    p_cr = E / (4 (1 - nu^2)) * (t / r)^3

Sphere (Zoelly classical buckling)::

    p_cr = 2 E / sqrt(3 (1 - nu^2)) * (t / r)^2

These are idealised formulas; real hulls need knock-down factors for
imperfections, end effects and finite length. Treat the results as first-order
sizing, not certification.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from . import constants


def pressure_at_depth(depth_m: float,
                      water_density: float = constants.DEFAULT_WATER_DENSITY,
                      g: float = constants.GRAVITY) -> float:
    """Gauge water pressure (Pa) at ``depth_m`` below the surface."""
    return water_density * g * depth_m


def depth_for_pressure(pressure_pa: float,
                       water_density: float = constants.DEFAULT_WATER_DENSITY,
                       g: float = constants.GRAVITY) -> float:
    """Depth (m) at which the gauge pressure equals ``pressure_pa``."""
    return pressure_pa / (water_density * g)


@dataclass
class HullResult:
    """Pressure-hull analysis result (SI units)."""

    shape: str
    radius_m: float
    thickness_m: float
    depth_m: float
    pressure_pa: float
    hoop_stress_pa: float
    yield_strength_pa: float
    yield_safety_factor: float
    yield_collapse_depth_m: float
    buckling_pressure_pa: float
    buckling_safety_factor: float
    buckling_collapse_depth_m: float
    water_density: float

    @property
    def limiting_collapse_depth_m(self) -> float:
        return min(self.yield_collapse_depth_m, self.buckling_collapse_depth_m)

    def summary(self) -> str:
        limit = ("buckling" if self.buckling_collapse_depth_m
                 < self.yield_collapse_depth_m else "yielding")
        lines = [
            "Pressure hull",
            "-------------",
            f"  Shape               : {self.shape}",
            f"  Radius / thickness  : {self.radius_m * 1e3:.1f} mm / "
            f"{self.thickness_m * 1e3:.2f} mm",
            f"  Operating depth     : {self.depth_m:.1f} m",
            f"  Pressure at depth   : {self.pressure_pa / 1e6:.3f} MPa "
            f"({self.pressure_pa / 1e5:.1f} bar)",
            f"  Hoop/wall stress    : {self.hoop_stress_pa / 1e6:.1f} MPa",
            f"  Yield strength      : {self.yield_strength_pa / 1e6:.1f} MPa",
            f"  Yield safety factor : {self.yield_safety_factor:.2f}",
            f"  Buckling pressure   : {self.buckling_pressure_pa / 1e6:.3f} MPa",
            f"  Buckling safety fac.: {self.buckling_safety_factor:.2f}",
            f"  Collapse depth (yield)   : {self.yield_collapse_depth_m:.0f} m",
            f"  Collapse depth (buckling): {self.buckling_collapse_depth_m:.0f} m",
            f"  Limiting collapse depth  : {self.limiting_collapse_depth_m:.0f} m "
            f"({limit} governs)",
        ]
        return "\n".join(lines)


def _buckling_pressure(shape: str, radius_m: float, thickness_m: float,
                       youngs_modulus_pa: float, poisson_ratio: float) -> float:
    t_over_r = thickness_m / radius_m
    if shape == "cylinder":
        return (youngs_modulus_pa / (4.0 * (1.0 - poisson_ratio ** 2))) * t_over_r ** 3
    if shape == "sphere":
        return ((2.0 * youngs_modulus_pa /
                 math.sqrt(3.0 * (1.0 - poisson_ratio ** 2))) * t_over_r ** 2)
    raise ValueError("shape must be 'cylinder' or 'sphere'")


def _hoop_stress(shape: str, pressure_pa: float, radius_m: float,
                 thickness_m: float) -> float:
    if shape == "cylinder":
        return pressure_pa * radius_m / thickness_m
    if shape == "sphere":
        return pressure_pa * radius_m / (2.0 * thickness_m)
    raise ValueError("shape must be 'cylinder' or 'sphere'")


def analyze(shape: str,
            radius_m: float,
            thickness_m: float,
            depth_m: float,
            yield_strength_pa: float,
            youngs_modulus_pa: float,
            poisson_ratio: float = 0.33,
            water_density: float = constants.DEFAULT_WATER_DENSITY,
            g: float = constants.GRAVITY,
            pressure_pa: float | None = None) -> HullResult:
    """Analyse a thin-wall pressure hull for yield and buckling at depth.

    ``pressure_pa`` overrides the computed pressure at depth; pass a value from
    :mod:`glidercalc.water` to account for depth-varying density.
    """
    shape = shape.lower()
    if radius_m <= 0 or thickness_m <= 0:
        raise ValueError("radius and thickness must be positive")

    p = pressure_pa if pressure_pa is not None else pressure_at_depth(
        depth_m, water_density, g)
    hoop = _hoop_stress(shape, p, radius_m, thickness_m)
    p_buckle = _buckling_pressure(shape, radius_m, thickness_m,
                                  youngs_modulus_pa, poisson_ratio)

    # Pressure that first causes yielding: invert the hoop-stress relation.
    p_yield = (yield_strength_pa * thickness_m / radius_m if shape == "cylinder"
               else 2.0 * yield_strength_pa * thickness_m / radius_m)

    yield_sf = (yield_strength_pa / hoop) if hoop > 0 else math.inf
    buckle_sf = (p_buckle / p) if p > 0 else math.inf

    return HullResult(
        shape=shape,
        radius_m=radius_m,
        thickness_m=thickness_m,
        depth_m=depth_m,
        pressure_pa=p,
        hoop_stress_pa=hoop,
        yield_strength_pa=yield_strength_pa,
        yield_safety_factor=yield_sf,
        yield_collapse_depth_m=depth_for_pressure(p_yield, water_density, g),
        buckling_pressure_pa=p_buckle,
        buckling_safety_factor=buckle_sf,
        buckling_collapse_depth_m=depth_for_pressure(p_buckle, water_density, g),
        water_density=water_density,
    )
