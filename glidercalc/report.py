"""Run a complete, chained analysis of a glider from a single config file.

The full report wires the four domains together the way they depend on each
other in a real design:

1. Buoyancy gives the net driving force from mass and displaced volume.
2. That force feeds the glide solution (speed, glide ratio, angle).
3. The hull is checked independently at the operating depth.
4. The glide ratio and speed feed the energy / range / endurance estimate.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

from . import buoyancy, constants, energy, hydrodynamics, pressure_hull


@dataclass
class FullReport:
    buoyancy: buoyancy.BuoyancyResult
    glide: Optional[hydrodynamics.GlideResult]
    hull: Optional[pressure_hull.HullResult]
    energy: Optional[energy.EnergyResult]
    warnings: list[str]

    def summary(self) -> str:
        blocks = ["=" * 60, "UNDERWATER GLIDER - DESIGN REPORT", "=" * 60, ""]
        blocks.append(self.buoyancy.summary())
        if self.glide is not None:
            blocks.append("")
            blocks.append(self.glide.summary())
        if self.hull is not None:
            blocks.append("")
            blocks.append(self.hull.summary())
        if self.energy is not None:
            blocks.append("")
            blocks.append(self.energy.summary())
        if self.warnings:
            blocks.append("")
            blocks.append("Warnings")
            blocks.append("--------")
            blocks.extend(f"  ! {w}" for w in self.warnings)
        blocks.append("")
        blocks.append("=" * 60)
        return "\n".join(blocks)


def run(config: dict[str, Any]) -> FullReport:
    """Build a :class:`FullReport` from a parsed config dictionary.

    Expected (all sections optional except ``buoyancy``)::

        water_density: 1025          # optional global override
        gravity: 9.80665             # optional global override
        buoyancy:
          mass_kg: 52.0
          displaced_volume_l: 50.6   # litres (or displaced_volume_m3)
        glide:
          wing_area_m2: 0.1
          cd0: 0.1
          k: 0.3
          cl: 0.5                    # optional; omit to use best glide ratio
        hull:
          shape: cylinder            # or sphere
          radius_mm: 100
          thickness_mm: 5
          depth_m: 200
          yield_strength_mpa: 270
          youngs_modulus_gpa: 70
          poisson_ratio: 0.33
        energy:
          battery_wh: 200
          ballast_volume_l: 0.5
          depth_band_m: 200          # defaults to hull depth if present
          hotel_power_w: 0.5
          pump_efficiency: 0.5
    """
    warnings: list[str] = []
    rho = float(config.get("water_density", constants.DEFAULT_WATER_DENSITY))
    g = float(config.get("gravity", constants.GRAVITY))

    if "buoyancy" not in config:
        raise ValueError("config must contain a 'buoyancy' section")

    b_cfg = config["buoyancy"]
    if "displaced_volume_m3" in b_cfg:
        vol = float(b_cfg["displaced_volume_m3"])
    elif "displaced_volume_l" in b_cfg:
        vol = float(b_cfg["displaced_volume_l"]) / 1e3
    else:
        raise ValueError("buoyancy needs displaced_volume_l or displaced_volume_m3")

    b_res = buoyancy.analyze(
        mass_kg=float(b_cfg["mass_kg"]),
        displaced_volume_m3=vol,
        water_density=rho,
        g=g,
    )

    net_force_mag = abs(b_res.net_force_n)

    glide_res: Optional[hydrodynamics.GlideResult] = None
    if "glide" in config:
        g_cfg = config["glide"]
        if net_force_mag < 1e-6:
            warnings.append(
                "Net buoyancy is ~0; no driving force for a glide solution. "
                "Adjust mass or displaced volume so the vehicle is slightly "
                "heavy/light.")
        else:
            cd0 = float(g_cfg["cd0"])
            k = float(g_cfg["k"])
            area = float(g_cfg["wing_area_m2"])
            if "cl" in g_cfg and g_cfg["cl"] is not None:
                glide_res = hydrodynamics.glide(
                    net_force_mag, area, float(g_cfg["cl"]), cd0, k, rho)
            else:
                glide_res = hydrodynamics.glide_at_best_ratio(
                    net_force_mag, area, cd0, k, rho)

    hull_res: Optional[pressure_hull.HullResult] = None
    if "hull" in config:
        h_cfg = config["hull"]
        radius = (float(h_cfg["radius_m"]) if "radius_m" in h_cfg
                  else float(h_cfg["radius_mm"]) / 1e3)
        thickness = (float(h_cfg["thickness_m"]) if "thickness_m" in h_cfg
                     else float(h_cfg["thickness_mm"]) / 1e3)
        yield_pa = (float(h_cfg["yield_strength_pa"]) if "yield_strength_pa" in h_cfg
                    else float(h_cfg["yield_strength_mpa"]) * 1e6)
        modulus_pa = (float(h_cfg["youngs_modulus_pa"]) if "youngs_modulus_pa" in h_cfg
                      else float(h_cfg["youngs_modulus_gpa"]) * 1e9)
        hull_res = pressure_hull.analyze(
            shape=str(h_cfg.get("shape", "cylinder")),
            radius_m=radius,
            thickness_m=thickness,
            depth_m=float(h_cfg["depth_m"]),
            yield_strength_pa=yield_pa,
            youngs_modulus_pa=modulus_pa,
            poisson_ratio=float(h_cfg.get("poisson_ratio", 0.33)),
            water_density=rho,
            g=g,
        )
        if hull_res.yield_safety_factor < 1.5:
            warnings.append(
                f"Hull yield safety factor is {hull_res.yield_safety_factor:.2f} "
                "(< 1.5); consider thicker walls or stronger material.")
        if hull_res.buckling_safety_factor < 2.0:
            warnings.append(
                f"Hull buckling safety factor is "
                f"{hull_res.buckling_safety_factor:.2f} (< 2.0); buckling is the "
                "usual failure mode for thin hulls - add margin.")

    energy_res: Optional[energy.EnergyResult] = None
    if "energy" in config:
        e_cfg = config["energy"]
        if glide_res is None:
            warnings.append(
                "Energy section needs a glide solution (glide ratio and speed); "
                "add a 'glide' section to enable range/endurance.")
        else:
            ballast = (float(e_cfg["ballast_volume_m3"])
                       if "ballast_volume_m3" in e_cfg
                       else float(e_cfg["ballast_volume_l"]) / 1e3)
            battery_j = (float(e_cfg["battery_j"]) if "battery_j" in e_cfg
                         else float(e_cfg["battery_wh"]) * 3600.0)
            depth_band = float(e_cfg.get(
                "depth_band_m",
                hull_res.depth_m if hull_res is not None else 0.0))
            if depth_band <= 0:
                raise ValueError(
                    "energy needs depth_band_m (or a hull section to infer it)")
            energy_res = energy.analyze(
                battery_energy_j=battery_j,
                ballast_volume_m3=ballast,
                depth_band_m=depth_band,
                glide_ratio=glide_res.glide_ratio,
                horizontal_speed_mps=glide_res.horizontal_speed_mps,
                hotel_power_w=float(e_cfg.get("hotel_power_w", 0.5)),
                pump_efficiency=float(e_cfg.get("pump_efficiency", 0.5)),
                water_density=rho,
                g=g,
            )

    return FullReport(
        buoyancy=b_res,
        glide=glide_res,
        hull=hull_res,
        energy=energy_res,
        warnings=warnings,
    )
