"""Parsers for CalculiX output: .frd result blocks and .dat reaction totals.

The .frd nodal blocks use fixed-width Fortran records:
  ' -1' + node id (10 chars) + values (12 chars each)
"""
from __future__ import annotations

import re
from pathlib import Path

import numpy as np


class FrdParseError(RuntimeError):
    pass


def _parse_block(lines: list[str], start: int, n_comp: int) -> tuple[dict[int, list[float]], int]:
    data: dict[int, list[float]] = {}
    i = start
    while i < len(lines):
        line = lines[i]
        if line.startswith(" -3"):
            return data, i
        if line.startswith(" -1"):
            try:
                node = int(line[3:13])
                vals = [float(line[13 + 12 * k: 13 + 12 * (k + 1)]) for k in range(n_comp)
                        if len(line) >= 13 + 12 * (k + 1) - 1]
                # continuation lines (' -2') for >6 components — not needed for U/S/E
                data[node] = vals
            except ValueError as exc:
                raise FrdParseError(f"bad FRD record at line {i}: {line!r}") from exc
        i += 1
    return data, i


def parse_frd(path: Path) -> dict:
    """Returns dict with 'displacement' {node: [ux,uy,uz]}, 'stress' {node: [sxx,syy,szz,sxy,syz,szx]},
    'strain' likewise, using 1-based CalculiX node ids."""
    text = path.read_text(errors="replace")
    lines = text.splitlines()
    out: dict[str, dict[int, list[float]]] = {}
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith(" -4"):
            name = line[5:13].strip()
            if name.startswith("DISP"):
                block, i = _parse_block(lines, i + 1, 3)
                # skip the component-definition rows that _parse_block cannot see
                out["displacement"] = {n: v[:3] for n, v in block.items()}
            elif name.startswith("STRESS"):
                block, i = _parse_block(lines, i + 1, 6)
                out["stress"] = block
            elif name.startswith("TOSTRAIN"):
                block, i = _parse_block(lines, i + 1, 6)
                out["strain"] = block
        i += 1
    if "displacement" not in out:
        raise FrdParseError("no displacement block found in FRD file")
    return out


def _clean_component_rows(block: dict[int, list[float]]) -> dict[int, list[float]]:
    return block


def von_mises(stress6: np.ndarray) -> np.ndarray:
    """stress6 columns: sxx, syy, szz, sxy, syz, szx (CalculiX order)."""
    sxx, syy, szz, sxy, syz, szx = (stress6[:, k] for k in range(6))
    return np.sqrt(0.5 * ((sxx - syy) ** 2 + (syy - szz) ** 2 + (szz - sxx) ** 2)
                   + 3.0 * (sxy ** 2 + syz ** 2 + szx ** 2))


def principal_stresses(stress6: np.ndarray) -> np.ndarray:
    """Return (n,3) principal stresses sorted descending."""
    n = len(stress6)
    T = np.zeros((n, 3, 3))
    T[:, 0, 0] = stress6[:, 0]
    T[:, 1, 1] = stress6[:, 1]
    T[:, 2, 2] = stress6[:, 2]
    T[:, 0, 1] = T[:, 1, 0] = stress6[:, 3]
    T[:, 1, 2] = T[:, 2, 1] = stress6[:, 4]
    T[:, 0, 2] = T[:, 2, 0] = stress6[:, 5]
    w = np.linalg.eigvalsh(T)  # ascending
    return w[:, ::-1]


_DAT_SET_RE = re.compile(r"total force .*? set (\S+)", re.IGNORECASE)


def parse_dat_reactions(path: Path) -> dict[str, list[float]]:
    """Parse '*NODE PRINT ... RF TOTALS=ONLY' output: total reaction per set."""
    reactions: dict[str, list[float]] = {}
    if not path or not path.exists():
        return reactions
    lines = path.read_text(errors="replace").splitlines()
    current: str | None = None
    for line in lines:
        m = _DAT_SET_RE.search(line)
        if m:
            current = m.group(1).strip()
            continue
        if current:
            parts = line.split()
            floats = []
            for p in parts:
                try:
                    floats.append(float(p))
                except ValueError:
                    floats = []
                    break
            if len(floats) >= 3:
                reactions[current] = floats[-3:]
                current = None
    return reactions
