"""Per-project isolated artifact storage with sanitized names and checksums.

Nothing uploaded is ever executed or parsed by shell tools; files are written
byte-for-byte and only read back through strict geometry parsers.
"""
from __future__ import annotations

import hashlib
import re
import shutil
import unicodedata
from pathlib import Path

from ..config import get_settings

_SAFE_CHARS = re.compile(r"[^A-Za-z0-9._-]+")


def sanitize_filename(name: str) -> str:
    name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    name = Path(name).name  # strip any path components
    name = _SAFE_CHARS.sub("_", name).strip("._")
    return name[:120] or "upload"


def sha256_file(path: Path | str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def project_dir(project_id: str) -> Path:
    # project ids are server-generated hex, but never trust them as paths blindly
    if not re.fullmatch(r"[0-9a-f]{32}", project_id):
        raise ValueError("invalid project id")
    d = get_settings().data_dir / "projects" / project_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def subdir(project_id: str, name: str) -> Path:
    assert name in {"uploads", "meshes", "sim", "reports", "variants", "snapshots", "analysis"}
    d = project_dir(project_id) / name
    d.mkdir(parents=True, exist_ok=True)
    return d


def delete_project_data(project_id: str) -> None:
    d = get_settings().data_dir / "projects" / project_id
    if d.exists():
        shutil.rmtree(d, ignore_errors=True)
