"""Entry point so the package can be run with ``python -m glidercalc``."""

from .cli import main

if __name__ == "__main__":
    raise SystemExit(main())
