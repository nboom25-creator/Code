"""Depth-varying seawater density and pressure.

Seawater gets denser with depth for two reasons: it is compressed by the weight
of the water above it, and (usually) it gets colder. A glider trimmed to be
neutrally buoyant at the surface will not be neutral deeper down, so for deep
work it helps to use the *local* density rather than a single constant.

Density model
-------------
A simple, configurable linear model is used::

    rho(d) = rho_surface + gradient * d

If no gradient is supplied it is derived from the water's compressibility
(bulk modulus ``K``), which is the dominant effect in the deep ocean::

    gradient = rho_surface^2 * g / K       (kg/m^3 per metre)

For typical seawater (rho=1025, K~2.2 GPa) this is about 0.0047 kg/m^3 per
metre, i.e. roughly +0.5 kg/m^3 every 100 m from compression alone. You can add
a larger gradient to approximate a cold deep layer.

Pressure model
--------------
With a depth-varying density the gauge pressure is the integral of ``rho*g``::

    p(d) = g * (rho_surface * d + 0.5 * gradient * d^2)
"""

from __future__ import annotations

from dataclasses import dataclass

from . import constants

# Typical bulk modulus of seawater (Pa).
SEAWATER_BULK_MODULUS = 2.2e9


def density_gradient_from_compressibility(
        surface_density: float = constants.DENSITY_SEAWATER,
        bulk_modulus: float = SEAWATER_BULK_MODULUS,
        g: float = constants.GRAVITY) -> float:
    """Density gradient (kg/m^3 per metre) implied by water compressibility."""
    return surface_density ** 2 * g / bulk_modulus


def _resolve_gradient(gradient, surface_density, bulk_modulus, g) -> float:
    if gradient is None:
        return density_gradient_from_compressibility(surface_density, bulk_modulus, g)
    return gradient


def seawater_density(depth_m: float,
                     surface_density: float = constants.DENSITY_SEAWATER,
                     gradient: float | None = None,
                     bulk_modulus: float = SEAWATER_BULK_MODULUS,
                     g: float = constants.GRAVITY) -> float:
    """Local water density (kg/m^3) at ``depth_m``."""
    grad = _resolve_gradient(gradient, surface_density, bulk_modulus, g)
    return surface_density + grad * depth_m


def mean_density(depth_m: float,
                 surface_density: float = constants.DENSITY_SEAWATER,
                 gradient: float | None = None,
                 bulk_modulus: float = SEAWATER_BULK_MODULUS,
                 g: float = constants.GRAVITY) -> float:
    """Depth-averaged density (kg/m^3) from surface to ``depth_m``."""
    grad = _resolve_gradient(gradient, surface_density, bulk_modulus, g)
    return surface_density + 0.5 * grad * depth_m


def pressure_at_depth(depth_m: float,
                      surface_density: float = constants.DENSITY_SEAWATER,
                      gradient: float | None = None,
                      bulk_modulus: float = SEAWATER_BULK_MODULUS,
                      g: float = constants.GRAVITY) -> float:
    """Gauge pressure (Pa) at ``depth_m`` accounting for variable density."""
    grad = _resolve_gradient(gradient, surface_density, bulk_modulus, g)
    return g * (surface_density * depth_m + 0.5 * grad * depth_m ** 2)


@dataclass
class WaterColumnResult:
    depth_m: float
    surface_density: float
    gradient: float
    local_density: float
    mean_density: float
    pressure_pa: float

    def summary(self) -> str:
        lines = [
            "Water column",
            "------------",
            f"  Depth               : {self.depth_m:.1f} m",
            f"  Surface density     : {self.surface_density:.2f} kg/m^3",
            f"  Density gradient    : {self.gradient:.5f} kg/m^3 per m",
            f"  Local density       : {self.local_density:.2f} kg/m^3 "
            f"(+{self.local_density - self.surface_density:.2f})",
            f"  Mean density (0..d) : {self.mean_density:.2f} kg/m^3",
            f"  Pressure at depth   : {self.pressure_pa / 1e6:.3f} MPa "
            f"({self.pressure_pa / 1e5:.1f} bar)",
        ]
        return "\n".join(lines)


def analyze(depth_m: float,
            surface_density: float = constants.DENSITY_SEAWATER,
            gradient: float | None = None,
            bulk_modulus: float = SEAWATER_BULK_MODULUS,
            g: float = constants.GRAVITY) -> WaterColumnResult:
    """Summarise the water column down to ``depth_m``."""
    grad = _resolve_gradient(gradient, surface_density, bulk_modulus, g)
    return WaterColumnResult(
        depth_m=depth_m,
        surface_density=surface_density,
        gradient=grad,
        local_density=seawater_density(depth_m, surface_density, grad, bulk_modulus, g),
        mean_density=mean_density(depth_m, surface_density, grad, bulk_modulus, g),
        pressure_pa=pressure_at_depth(depth_m, surface_density, grad, bulk_modulus, g),
    )
