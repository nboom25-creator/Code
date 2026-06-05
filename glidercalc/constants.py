"""Physical constants and reference values used across the calculations.

All values are SI. Water density depends on temperature, salinity and (weakly)
pressure; the values below are typical defaults you can override from the CLI
or a config file.
"""

# Standard gravitational acceleration (m/s^2).
GRAVITY = 9.80665

# Atmospheric pressure at sea level (Pa).
ATMOSPHERIC_PRESSURE = 101_325.0

# Typical water densities (kg/m^3).
DENSITY_FRESHWATER = 998.0      # ~20 C fresh water
DENSITY_SEAWATER = 1025.0       # typical ocean surface seawater

# Default working fluid density used when none is supplied (seawater).
DEFAULT_WATER_DENSITY = DENSITY_SEAWATER
