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

from . import __version__, buoyancy, constants, energy, hydrodynamics, pressure_hull, report


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


def _cmd_report(args: argparse.Namespace) -> None:
    cfg = _load_config(args.config)
    rep = report.run(cfg)
    if args.json:
        from dataclasses import asdict
        out = {
            "buoyancy": asdict(rep.buoyancy),
            "glide": asdict(rep.glide) if rep.glide else None,
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
