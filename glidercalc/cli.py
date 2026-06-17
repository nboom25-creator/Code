"""Command-line interface for glidercalc.

Run ``python -m glidercalc --help`` (or ``glider --help`` if installed) to see
the available subcommands:

    buoyancy   net buoyancy and ballast sizing
    glide      steady-glide speed, angle and glide ratio
    hull       pressure-hull stress and collapse depth
    energy     pump energy, range and endurance
    report     full chained analysis from a YAML/JSON config file
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any

from . import (__version__, buoyancy, constants, energy, hydrodynamics,
               pressure_hull, report, stability, water)


def _load_config(path: str) -> dict[str, Any]:
    with open(path, "r", encoding="utf-8") as fh:
        text = fh.read()
    if path.endswith((".yaml", ".yml")):
        try:
            import yaml  # type: ignore
        except ImportError:  # pragma: no cover - depends on environment
            print("PyYAML is not installed; use a JSON config or 'pip install pyyaml'.",
                  file=sys.stderr)
            raise SystemExit(2)
        return yaml.safe_load(text)
    return json.loads(text)


def _add_water_args(p: argparse.ArgumentParser) -> None:
    p.add_argument("--water-density", type=float,
                   default=constants.DEFAULT_WATER_DENSITY,
                   help="water density in kg/m^3 (default: seawater 1025)")
    p.add_argument("--gravity", type=float, default=constants.GRAVITY,
                   help="gravitational acceleration in m/s^2")


def _cmd_buoyancy(args: argparse.Namespace) -> None:
    vol = args.volume_m3 if args.volume_m3 is not None else args.volume_l / 1e3
    res = buoyancy.analyze(args.mass, vol, args.water_density, args.gravity)
    print(res.summary())


def _cmd_glide(args: argparse.Namespace) -> None:
    if args.cl is not None:
        res = hydrodynamics.glide(args.net_force, args.wing_area, args.cl,
                                  args.cd0, args.k, args.water_density)
    else:
        res = hydrodynamics.glide_at_best_ratio(args.net_force, args.wing_area,
                                                args.cd0, args.k, args.water_density)
        print(f"(using best-glide CL = {res.cl:.4f}, "
              f"max glide ratio = {hydrodynamics.max_glide_ratio(args.cd0, args.k):.2f})")
    print(res.summary())


def _cmd_hull(args: argparse.Namespace) -> None:
    res = pressure_hull.analyze(
        shape=args.shape,
        radius_m=args.radius / 1e3,
        thickness_m=args.thickness / 1e3,
        depth_m=args.depth,
        yield_strength_pa=args.yield_strength * 1e6,
        youngs_modulus_pa=args.youngs_modulus * 1e9,
        poisson_ratio=args.poisson,
        water_density=args.water_density,
        g=args.gravity,
    )
    print(res.summary())


def _cmd_energy(args: argparse.Namespace) -> None:
    res = energy.analyze(
        battery_energy_j=args.battery_wh * 3600.0,
        ballast_volume_m3=args.ballast_l / 1e3,
        depth_band_m=args.depth_band,
        glide_ratio=args.glide_ratio,
        horizontal_speed_mps=args.speed,
        hotel_power_w=args.hotel_power,
        pump_efficiency=args.pump_efficiency,
        water_density=args.water_density,
        g=args.gravity,
    )
    print(res.summary())


def _cmd_polar(args: argparse.Namespace) -> None:
    results = hydrodynamics.polar_sweep(
        args.net_force, args.wing_area, args.cd0, args.k,
        cl_min=args.cl_min, cl_max=args.cl_max, steps=args.steps,
        water_density=args.water_density)
    if args.csv:
        text = hydrodynamics.polar_csv(results)
        if args.csv is True or args.csv == "-":
            print(text)
        else:
            with open(args.csv, "w", encoding="utf-8") as fh:
                fh.write(text + "\n")
            print(f"wrote {len(results)} rows to {args.csv}")
    else:
        best = max(results, key=lambda r: r.glide_ratio)
        print(hydrodynamics.polar_table(results))
        print(f"  best glide ratio {best.glide_ratio:.2f} at CL={best.cl:.3f}")


def _cmd_stability(args: argparse.Namespace) -> None:
    res = stability.analyze(
        cg_x_m=args.cg_x, cg_z_m=args.cg_z,
        cb_x_m=args.cb_x, cb_z_m=args.cb_z,
        total_mass_kg=args.mass, g=args.gravity)
    print(res.summary())
    if args.mass_shift is not None and args.shift_distance is not None:
        pitch = stability.pitch_from_mass_shift(
            args.mass_shift, args.shift_distance, args.mass, res.bg_m)
        print(f"  Moving {args.mass_shift:.2f} kg by "
              f"{args.shift_distance * 1e3:.0f} mm -> pitch {pitch:+.2f} deg")
    if args.target_pitch is not None and args.mass_shift is not None:
        travel = stability.mass_shift_for_pitch(
            args.target_pitch, args.mass_shift, args.mass, res.bg_m)
        print(f"  For {args.target_pitch:+.1f} deg pitch, move "
              f"{args.mass_shift:.2f} kg by {travel * 1e3:+.0f} mm")


def _cmd_density(args: argparse.Namespace) -> None:
    res = water.analyze(args.depth, surface_density=args.surface_density,
                        gradient=args.gradient, g=args.gravity)
    print(res.summary())
    if args.table:
        print()
        print("  depth(m)  density(kg/m^3)  pressure(MPa)")
        n = 10
        for i in range(n + 1):
            d = args.depth * i / n
            rho = water.seawater_density(d, args.surface_density, args.gradient, g=args.gravity)
            p = water.pressure_at_depth(d, args.surface_density, args.gradient, g=args.gravity)
            print(f"  {d:8.0f}  {rho:14.2f}  {p / 1e6:12.3f}")


def _cmd_report(args: argparse.Namespace) -> None:
    cfg = _load_config(args.config)
    rep = report.run(cfg)
    if args.json:
        from dataclasses import asdict
        out = {
            "water": asdict(rep.water) if rep.water else None,
            "buoyancy": asdict(rep.buoyancy),
            "glide": asdict(rep.glide) if rep.glide else None,
            "stability": asdict(rep.stability) if rep.stability else None,
            "hull": asdict(rep.hull) if rep.hull else None,
            "energy": asdict(rep.energy) if rep.energy else None,
            "warnings": rep.warnings,
        }
        print(json.dumps(out, indent=2))
    else:
        print(rep.summary())


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="glider",
        description="Calculations for designing an underwater glider.")
    parser.add_argument("--version", action="version",
                        version=f"glidercalc {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    # buoyancy ------------------------------------------------------------
    p_b = sub.add_parser("buoyancy", help="net buoyancy and ballast sizing")
    p_b.add_argument("--mass", type=float, required=True, help="vehicle mass (kg)")
    grp = p_b.add_mutually_exclusive_group(required=True)
    grp.add_argument("--volume-l", type=float, help="displaced volume (litres)")
    grp.add_argument("--volume-m3", type=float, help="displaced volume (m^3)")
    _add_water_args(p_b)
    p_b.set_defaults(func=_cmd_buoyancy)

    # glide ---------------------------------------------------------------
    p_g = sub.add_parser("glide", help="steady-glide speed, angle and glide ratio")
    p_g.add_argument("--net-force", type=float, required=True,
                     help="net buoyancy force magnitude (N)")
    p_g.add_argument("--wing-area", type=float, required=True,
                     help="reference/wing area (m^2)")
    p_g.add_argument("--cd0", type=float, required=True, help="parasite drag coeff.")
    p_g.add_argument("--k", type=float, required=True, help="induced-drag factor")
    p_g.add_argument("--cl", type=float, default=None,
                     help="lift coefficient (omit to use the best-glide CL)")
    _add_water_args(p_g)
    p_g.set_defaults(func=_cmd_glide)

    # hull ----------------------------------------------------------------
    p_h = sub.add_parser("hull", help="pressure-hull stress and collapse depth")
    p_h.add_argument("--shape", choices=["cylinder", "sphere"], default="cylinder")
    p_h.add_argument("--radius", type=float, required=True, help="radius (mm)")
    p_h.add_argument("--thickness", type=float, required=True, help="wall thickness (mm)")
    p_h.add_argument("--depth", type=float, required=True, help="operating depth (m)")
    p_h.add_argument("--yield-strength", type=float, required=True,
                     help="material yield strength (MPa)")
    p_h.add_argument("--youngs-modulus", type=float, required=True,
                     help="Young's modulus (GPa)")
    p_h.add_argument("--poisson", type=float, default=0.33, help="Poisson's ratio")
    _add_water_args(p_h)
    p_h.set_defaults(func=_cmd_hull)

    # energy --------------------------------------------------------------
    p_e = sub.add_parser("energy", help="pump energy, range and endurance")
    p_e.add_argument("--battery-wh", type=float, required=True,
                     help="usable battery energy (Wh)")
    p_e.add_argument("--ballast-l", type=float, required=True,
                     help="ballast volume moved per inflation (litres)")
    p_e.add_argument("--depth-band", type=float, required=True,
                     help="dive/climb depth band per cycle (m)")
    p_e.add_argument("--glide-ratio", type=float, required=True,
                     help="glide ratio (horizontal:vertical)")
    p_e.add_argument("--speed", type=float, required=True,
                     help="horizontal speed (m/s)")
    p_e.add_argument("--hotel-power", type=float, default=0.5,
                     help="continuous electronics power draw (W)")
    p_e.add_argument("--pump-efficiency", type=float, default=0.5,
                     help="buoyancy pump efficiency (0-1)")
    _add_water_args(p_e)
    p_e.set_defaults(func=_cmd_energy)

    # polar ---------------------------------------------------------------
    p_p = sub.add_parser("polar", help="sweep the glide polar over a range of CL")
    p_p.add_argument("--net-force", type=float, required=True,
                     help="net buoyancy force magnitude (N)")
    p_p.add_argument("--wing-area", type=float, required=True, help="wing area (m^2)")
    p_p.add_argument("--cd0", type=float, required=True, help="parasite drag coeff.")
    p_p.add_argument("--k", type=float, required=True, help="induced-drag factor")
    p_p.add_argument("--cl-min", type=float, default=0.1, help="lowest CL in sweep")
    p_p.add_argument("--cl-max", type=float, default=1.2, help="highest CL in sweep")
    p_p.add_argument("--steps", type=int, default=12, help="number of points")
    p_p.add_argument("--csv", nargs="?", const=True, default=None,
                     help="emit CSV; optionally give a file path to write to")
    _add_water_args(p_p)
    p_p.set_defaults(func=_cmd_polar)

    # stability -----------------------------------------------------------
    p_s = sub.add_parser("stability", help="static stability and pitch trim")
    p_s.add_argument("--mass", type=float, required=True, help="total mass (kg)")
    p_s.add_argument("--cg-x", type=float, default=0.0, help="CG longitudinal pos (m)")
    p_s.add_argument("--cg-z", type=float, required=True, help="CG vertical pos (m)")
    p_s.add_argument("--cb-x", type=float, default=0.0, help="CB longitudinal pos (m)")
    p_s.add_argument("--cb-z", type=float, default=0.0, help="CB vertical pos (m)")
    p_s.add_argument("--mass-shift", type=float, default=None,
                     help="movable mass for pitch trim (kg)")
    p_s.add_argument("--shift-distance", type=float, default=None,
                     help="how far the mass slides (m, +forward)")
    p_s.add_argument("--target-pitch", type=float, default=None,
                     help="desired pitch angle (deg) to solve travel for")
    _add_water_args(p_s)
    p_s.set_defaults(func=_cmd_stability)

    # density -------------------------------------------------------------
    p_d = sub.add_parser("density", help="depth-varying seawater density & pressure")
    p_d.add_argument("--depth", type=float, required=True, help="depth (m)")
    p_d.add_argument("--surface-density", type=float,
                     default=constants.DENSITY_SEAWATER,
                     help="surface water density (kg/m^3)")
    p_d.add_argument("--gradient", type=float, default=None,
                     help="density gradient (kg/m^3 per m); omit to derive from K")
    p_d.add_argument("--table", action="store_true",
                     help="also print a depth/density/pressure table")
    p_d.add_argument("--gravity", type=float, default=constants.GRAVITY,
                     help="gravitational acceleration in m/s^2")
    p_d.set_defaults(func=_cmd_density)

    # report --------------------------------------------------------------
    p_r = sub.add_parser("report", help="full chained analysis from a config file")
    p_r.add_argument("config", help="path to a YAML or JSON config file")
    p_r.add_argument("--json", action="store_true",
                     help="emit machine-readable JSON instead of a text report")
    p_r.set_defaults(func=_cmd_report)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        args.func(args)
    except (ValueError, KeyError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
