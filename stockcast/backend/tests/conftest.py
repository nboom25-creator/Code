import os
import sys
from pathlib import Path

# Ensure the backend package root is importable and the demo provider is active.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("PROVIDER", "demo")
os.environ.setdefault("CACHE_DB_PATH", ":memory:")
