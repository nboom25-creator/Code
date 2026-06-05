"""Power, energy, range and endurance.

A glider's energy budget is dominated by the buoyancy pump, which must move
ballast water against the ambient pressure at depth, plus a steady "hotel" load
from electronics and sensors.

Pump energy per inflation
-------------------------
The ideal work to push a volume ``dV`` of water out of the hull against the
external pressure ``p`` at depth is::

    E_ideal = p * dV

Real pumps are inefficient, so::

    E_pump = p * dV / efficiency

A full sawtooth cycle (one dive + one climb) changes buoyancy twice, but only
the inflation that happens at depth does significant work against pressure; the
deflation at the surface is comparatively cheap. This module charges the pump
for the work done at the deepest point of each half-cycle, which is the
conservative, dominant term.

Range per cycle
---------------
Diving then climbing across a depth band ``depth`` at a given glide ratio
covers a horizontal distance of::

    range_per_cycle = 2 * depth * glide_ratio
"""

from __future__ import annotations

from dataclasses import dataclass

from . import constants


def pump_energy_per_inflation(ballast_volume_m3: float,
                              depth_m: float,
                              efficiency: float = 0.5,
                              water_density: float = constants.DEFAULT_WATER_DENSITY,
                              g: float = constants.GRAVITY,
                              include_atmospheric: bool = True) -> float:
    """Energy (J) for one buoyancy inflation against pressure at ``depth_m``."""
    if not 0 < efficiency <= 1:
        raise ValueError("efficiency must be in (0, 1]")
    p = water_density * g * depth_m
    if include_atmospheric:
        p += constants.ATMOSPHERIC_PRESSURE
    return p * ballast_volume_m3 / efficiency


@dataclass
class EnergyResult:
    """Energy, range and endurance estimate (SI units; convenience fields noted)."""

    battery_energy_j: float
    pump_energy_per_cycle_j: float
    hotel_power_w: float
    glide_ratio: float
    horizontal_speed_mps: float
    depth_band_m: float
    cycle_time_s: float
    hotel_energy_per_cycle_j: float
    total_energy_per_cycle_j: float
    num_cycles: float
    range_per_cycle_m: float
    total_range_m: float
    endurance_s: float

    def summary(self) -> str:
        lines = [
            "Power, energy & range",
            "---------------------",
            f"  Battery energy      : {self.battery_energy_j / 3600:.0f} Wh "
            f"({self.battery_energy_j / 1e6:.2f} MJ)",
            f"  Depth band per cycle: {self.depth_band_m:.0f} m",
            f"  Pump energy / cycle : {self.pump_energy_per_cycle_j:.1f} J",
            f"  Hotel load          : {self.hotel_power_w:.2f} W",
            f"  Cycle time          : {self.cycle_time_s / 3600:.2f} h",
            f"  Hotel energy / cycle: {self.hotel_energy_per_cycle_j:.1f} J",
            f"  Total energy / cycle: {self.total_energy_per_cycle_j:.1f} J",
            f"  Number of cycles    : {self.num_cycles:.0f}",
            f"  Range per cycle     : {self.range_per_cycle_m / 1e3:.2f} km",
            f"  Total range         : {self.total_range_m / 1e3:.1f} km",
            f"  Endurance           : {self.endurance_s / 86400:.1f} days "
            f"({self.endurance_s / 3600:.0f} h)",
        ]
        return "\n".join(lines)


def analyze(battery_energy_j: float,
            ballast_volume_m3: float,
            depth_band_m: float,
            glide_ratio: float,
            horizontal_speed_mps: float,
            hotel_power_w: float = 0.5,
            pump_efficiency: float = 0.5,
            water_density: float = constants.DEFAULT_WATER_DENSITY,
            g: float = constants.GRAVITY) -> EnergyResult:
    """Estimate cycles, range and endurance from an energy budget.

    Parameters
    ----------
    battery_energy_j:
        Usable battery energy in joules (1 Wh = 3600 J).
    ballast_volume_m3:
        Ballast volume moved per inflation.
    depth_band_m:
        Vertical extent of each dive/climb (the sawtooth amplitude).
    glide_ratio:
        Horizontal distance per unit depth (from the hydrodynamics module).
    horizontal_speed_mps:
        Horizontal speed used to convert distance to time.
    hotel_power_w:
        Continuous electronics/sensor power draw.
    pump_efficiency:
        Overall efficiency of the buoyancy pump (0-1).
    """
    if horizontal_speed_mps <= 0:
        raise ValueError("horizontal_speed_mps must be positive")

    # One sawtooth cycle = dive + climb. The pump inflates once at depth to
    # climb and deflates once at the surface to dive; the at-depth inflation
    # dominates, so charge one full-pressure inflation per cycle.
    pump_per_cycle = pump_energy_per_inflation(
        ballast_volume_m3, depth_band_m, pump_efficiency, water_density, g)

    range_per_cycle = 2.0 * depth_band_m * glide_ratio
    cycle_time = range_per_cycle / horizontal_speed_mps
    hotel_per_cycle = hotel_power_w * cycle_time
    total_per_cycle = pump_per_cycle + hotel_per_cycle

    num_cycles = battery_energy_j / total_per_cycle if total_per_cycle > 0 else 0.0
    total_range = num_cycles * range_per_cycle
    endurance = num_cycles * cycle_time

    return EnergyResult(
        battery_energy_j=battery_energy_j,
        pump_energy_per_cycle_j=pump_per_cycle,
        hotel_power_w=hotel_power_w,
        glide_ratio=glide_ratio,
        horizontal_speed_mps=horizontal_speed_mps,
        depth_band_m=depth_band_m,
        cycle_time_s=cycle_time,
        hotel_energy_per_cycle_j=hotel_per_cycle,
        total_energy_per_cycle_j=total_per_cycle,
        num_cycles=num_cycles,
        range_per_cycle_m=range_per_cycle,
        total_range_m=total_range,
        endurance_s=endurance,
    )
