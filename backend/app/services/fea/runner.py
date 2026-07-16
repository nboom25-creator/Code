"""Sandboxed CalculiX execution: argument arrays (no shell), CPU/memory/time
limits, and captured logs."""
from __future__ import annotations

import resource
import subprocess
from dataclasses import dataclass
from pathlib import Path

from ...config import get_settings


class SolverUnavailable(RuntimeError):
    pass


@dataclass
class SolverRun:
    returncode: int
    stdout: str
    stderr: str
    frd_path: Path | None
    dat_path: Path | None
    timed_out: bool = False


def _limits(memory_mb: int, cpu_s: int):
    def apply():
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_s, cpu_s + 30))
        mem = memory_mb * 1024 * 1024
        try:
            resource.setrlimit(resource.RLIMIT_AS, (mem, mem))
        except (ValueError, OSError):
            pass
    return apply


def run_calculix(workdir: Path, jobname: str = "job") -> SolverRun:
    settings = get_settings()
    if not settings.ccx_available:
        raise SolverUnavailable(
            f"CalculiX executable '{settings.ccx_path}' was not found on this system. "
            "Install it (e.g. apt install calculix-ccx) to enable FEA."
        )
    deck = workdir / f"{jobname}.inp"
    if not deck.exists():
        raise FileNotFoundError(deck)

    env = {"OMP_NUM_THREADS": "2", "CCX_NPROC_STIFFNESS": "2", "PATH": "/usr/bin:/bin:/usr/local/bin"}
    timed_out = False
    try:
        proc = subprocess.run(
            [settings.ccx_path, "-i", jobname],           # argv array; never a shell string
            cwd=str(workdir), env=env,
            capture_output=True, text=True,
            timeout=settings.fea_timeout_s,
            preexec_fn=_limits(settings.fea_memory_limit_mb, settings.fea_timeout_s),
        )
        rc, out, err = proc.returncode, proc.stdout, proc.stderr
    except subprocess.TimeoutExpired as exc:
        rc, out, err = -1, (exc.stdout or ""), (exc.stderr or "")
        if isinstance(out, bytes):
            out = out.decode(errors="replace")
        if isinstance(err, bytes):
            err = err.decode(errors="replace")
        timed_out = True

    frd = workdir / f"{jobname}.frd"
    dat = workdir / f"{jobname}.dat"
    (workdir / "solver_stdout.log").write_text(out or "")
    (workdir / "solver_stderr.log").write_text(err or "")
    return SolverRun(
        returncode=rc, stdout=out or "", stderr=err or "",
        frd_path=frd if frd.exists() else None,
        dat_path=dat if dat.exists() else None,
        timed_out=timed_out,
    )
