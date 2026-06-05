"""glidercalc - engineering calculations for designing an underwater glider.

The package is organised into four calculation domains, each in its own module:

* :mod:`glidercalc.buoyancy`      - net buoyancy, displaced volume, ballast sizing
* :mod:`glidercalc.hydrodynamics` - lift/drag, glide angle, glide ratio, speeds
* :mod:`glidercalc.pressure_hull` - hull stress and collapse depth (cylinder/sphere)
* :mod:`glidercalc.energy`        - pump energy, battery cycles, range and endurance

All calculations use SI units unless explicitly noted:
metres (m), kilograms (kg), seconds (s), newtons (N), pascals (Pa), joules (J).
"""

__version__ = "0.1.0"

__all__ = [
    "buoyancy",
    "hydrodynamics",
    "pressure_hull",
    "energy",
    "constants",
]
