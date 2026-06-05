"""Hydrodynamics and steady-glide performance.

A glider in steady gliding flight balances three forces: the (vertical) net
buoyancy force, hydrodynamic lift (perpendicular to the flow) and drag (along
the flow). Resolving along and across the flight path gives::

    tan(gamma) = D / L = C_D / C_L              glide path angle below horizontal
    L = F_net * cos(gamma) = 1/2 rho V^2 S C_L  perpendicular balance
    D = F_net * sin(gamma)                       along-path balance

The drag is modelled with a quadratic drag polar::

    C_D = C_D0 + k * C_L^2

from which the speed along the path and the horizontal/vertical speeds follow.

Glide ratio (horizontal distance per unit depth) = L / D = 1 / tan(gamma).
The maximum glide ratio occurs at C_L = sqrt(C_D0 / k).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from . import constants


@dataclass
class GlideResult:
    """Steady-glide performance at one operating point (SI units, angles in deg)."""

    net_force_n: float
    wing_area_m2: float
    cl: float
    cd: float
    glide_ratio: float
    glide_angle_deg: float
    speed_mps: float
    horizontal_speed_mps: float
    vertical_speed_mps: float
    water_density: float

    def summary(self) -> str:
        lines = [
            "Hydrodynamics & glide",
            "---------------------",
            f"  Net driving force   : {self.net_force_n:.3f} N",
            f"  Reference area      : {self.wing_area_m2:.4f} m^2",
            f"  Lift coefficient CL : {self.cl:.4f}",
            f"  Drag coefficient CD : {self.cd:.4f}",
            f"  Glide ratio (L/D)   : {self.glide_ratio:.2f} : 1 (horizontal:vertical)",
            f"  Glide path angle    : {self.glide_angle_deg:.2f} deg below horizontal",
            f"  Path speed          : {self.speed_mps:.3f} m/s",
            f"  Horizontal speed    : {self.horizontal_speed_mps:.3f} m/s "
            f"({self.horizontal_speed_mps * 3.6:.2f} km/h)",
            f"  Vertical speed      : {self.vertical_speed_mps:.3f} m/s",
        ]
        return "\n".join(lines)


def drag_coefficient(cl: float, cd0: float, k: float) -> float:
    """Quadratic drag polar: C_D = C_D0 + k * C_L^2."""
    return cd0 + k * cl * cl


def best_glide_cl(cd0: float, k: float) -> float:
    """Lift coefficient that maximises the glide ratio (L/D)."""
    if cd0 <= 0 or k <= 0:
        raise ValueError("cd0 and k must be positive")
    return math.sqrt(cd0 / k)


def max_glide_ratio(cd0: float, k: float) -> float:
    """Maximum achievable glide ratio for the given drag polar."""
    return 1.0 / (2.0 * math.sqrt(k * cd0))


def glide(net_force_n: float,
          wing_area_m2: float,
          cl: float,
          cd0: float,
          k: float,
          water_density: float = constants.DEFAULT_WATER_DENSITY) -> GlideResult:
    """Solve steady glide at a chosen lift coefficient.

    Parameters
    ----------
    net_force_n:
        Magnitude of the net buoyancy force driving the glide (N). Use the
        absolute value; the same magnitude applies to diving and climbing.
    wing_area_m2:
        Reference (planform) area used for the lift/drag coefficients.
    cl:
        Operating lift coefficient.
    cd0, k:
        Drag-polar parameters (parasite drag and induced-drag factor).
    """
    if net_force_n <= 0:
        raise ValueError("net_force_n must be positive (use its magnitude)")
    if cl <= 0:
        raise ValueError("cl must be positive for a gliding solution")

    cd = drag_coefficient(cl, cd0, k)
    glide_ratio = cl / cd
    gamma = math.atan2(cd, cl)  # path angle below horizontal

    # Perpendicular balance: F_net*cos(gamma) = 1/2 rho V^2 S C_L
    v = math.sqrt((2.0 * net_force_n * math.cos(gamma)) /
                  (water_density * wing_area_m2 * cl))

    return GlideResult(
        net_force_n=net_force_n,
        wing_area_m2=wing_area_m2,
        cl=cl,
        cd=cd,
        glide_ratio=glide_ratio,
        glide_angle_deg=math.degrees(gamma),
        speed_mps=v,
        horizontal_speed_mps=v * math.cos(gamma),
        vertical_speed_mps=v * math.sin(gamma),
        water_density=water_density,
    )


def glide_at_best_ratio(net_force_n: float,
                        wing_area_m2: float,
                        cd0: float,
                        k: float,
                        water_density: float = constants.DEFAULT_WATER_DENSITY
                        ) -> GlideResult:
    """Steady glide at the lift coefficient that maximises glide ratio."""
    cl = best_glide_cl(cd0, k)
    return glide(net_force_n, wing_area_m2, cl, cd0, k, water_density)
