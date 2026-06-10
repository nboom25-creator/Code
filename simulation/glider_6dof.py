"""
Full 6-DOF underwater-glider flight simulator.

This expands a 3-DOF longitudinal-plane baseline (x, z, theta, u, w, q) into a
complete 12-state, 6-degree-of-freedom rigid-body model:

    position  (x, y, z)        earth/NED frame, z = depth (down positive)
    attitude  (phi, theta, psi) roll, pitch, yaw (Euler ZYX)
    body vel  (u, v, w)        surge, sway, heave
    body rate (p, q, r)        roll, pitch, yaw rates

Physics included
----------------
* Rigid-body + added-mass inertia (6x6 system matrix M = M_RB + M_A).
* Coriolis/centripetal C(nu) derived from M via Fossen's parameterisation,
  which reproduces the destabilising added-mass "Munk" moments automatically.
* Hydrodynamic lift, drag and side force from angle-of-attack (alpha) and
  sideslip (beta), rotated wind-frame -> body-frame.
* Rotary aerodynamic damping (roll/pitch/yaw) and a steerable rudder.
* Buoyancy/gravity restoring with the centre of buoyancy above the centre of
  gravity (the metacentric righting that keeps the glider upright).
* Actuators: a variable-ballast buoyancy engine and a movable internal mass
  that trims pitch (fore/aft) AND roll (lateral).
* A depth-varying lateral ocean current; all hydrodynamics use velocity
  RELATIVE to the moving water, so the vehicle visibly crabs and drifts.

Integration is classic RK4. Running this file produces a multi-panel figure
(3-D path, top-down drift, depth profile and attitude history) and prints a
short summary.

Reduces exactly to the supplied 3-DOF baseline when the lateral states
(v, p, r, phi, psi), the current and the rudder are all zero.
"""

from __future__ import annotations
import numpy as np
import matplotlib
matplotlib.use("Agg")  # headless: save figures instead of showing
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d import Axes3D  # noqa: F401  (registers 3-D projection)


# --------------------------------------------------------------------------- #
# Small linear-algebra helpers
# --------------------------------------------------------------------------- #
def skew(a: np.ndarray) -> np.ndarray:
    """Skew-symmetric cross-product matrix S(a) so that S(a) @ b == a x b."""
    return np.array([[0.0, -a[2], a[1]],
                     [a[2], 0.0, -a[0]],
                     [-a[1], a[0], 0.0]])


def rot_body_to_earth(phi: float, theta: float, psi: float) -> np.ndarray:
    """Rotation matrix R (body -> earth) for Euler ZYX (yaw, pitch, roll)."""
    cph, sph = np.cos(phi), np.sin(phi)
    cth, sth = np.cos(theta), np.sin(theta)
    cps, sps = np.cos(psi), np.sin(psi)
    return np.array([
        [cps * cth, cps * sth * sph - sps * cph, cps * sth * cph + sps * sph],
        [sps * cth, sps * sth * sph + cps * cph, sps * sth * cph - cps * sph],
        [-sth,      cth * sph,                   cth * cph],
    ])


def euler_rate_matrix(phi: float, theta: float) -> np.ndarray:
    """T(eta) mapping body angular rates (p, q, r) -> Euler-angle rates."""
    cth = np.cos(theta)
    cth = np.sign(cth) * max(abs(cth), 1e-4)  # guard the +/-90 deg singularity
    tth = np.tan(theta)
    sph, cph = np.sin(phi), np.cos(phi)
    return np.array([
        [1.0, sph * tth, cph * tth],
        [0.0, cph,       -sph],
        [0.0, sph / cth, cph / cth],
    ])


def wrap_pi(angle: float) -> float:
    """Wrap an angle to [-pi, pi)."""
    return (angle + np.pi) % (2.0 * np.pi) - np.pi


# --------------------------------------------------------------------------- #
# The glider
# --------------------------------------------------------------------------- #
class Glider6DOF:
    def __init__(self) -> None:
        # ---- environment -------------------------------------------------- #
        self.g = 9.81
        self.rho_0 = 1025.0          # surface seawater density (kg/m^3)
        self.rho_grad = 0.005        # density increase per metre of depth

        # ---- mass / geometry ---------------------------------------------- #
        self.m_dry = 50.0            # dry mass incl. internals (kg)
        self.V_nominal = 0.0487      # displaced volume (m^3) -> ~neutral
        self.m_ballast = 0.0         # variable ballast water (kg) [-0.3, 0.3]
        self.m_p = 5.0               # movable internal mass (subset of m_dry)
        self.r_p = np.array([0.0, 0.0, 0.0])   # movable-mass position (body, m)
        self.rg_base = np.array([0.0, 0.0, 0.020])  # CG below CB -> z down (m)
        self.rb = np.array([0.0, 0.0, 0.0])         # centre of buoyancy = origin

        # inertia about the body origin (kg m^2): slender body
        self.I_O = np.diag([4.0, 12.0, 12.0])
        # diagonal added mass [surge, sway, heave, roll, pitch, yaw].
        # Keep the sway/heave-vs-surge asymmetry modest so the destabilising
        # added-mass (Munk) moment stays controllable by the fins.
        self.M_A = np.diag([2.0, 15.0, 15.0, 0.5, 6.0, 6.0])
        # linear hydrodynamic damping [surge, sway, heave, roll, pitch, yaw];
        # low in surge (so it still glides) but strong in sway/yaw for
        # directional stability — the role of the tail fins.
        self.D_lin = np.diag([1.5, 22.0, 22.0, 1.0, 6.0, 8.0])

        # ---- reference geometry & aero coefficients ----------------------- #
        self.A = 0.12                # reference (wing) area (m^2)
        self.c = 0.20               # reference chord (m)  -> longitudinal
        self.b = 0.60               # reference span  (m)  -> lateral
        self.CL_alpha = 4.0
        self.CD0 = 0.05
        self.K = 0.25                # induced drag, CD = CD0 + K CL^2
        self.CY_beta = -1.50         # side force opposes sideslip
        self.Cm0 = 0.0
        self.Cm_alpha = -0.80        # aero pitch stiffness (restoring)
        self.Cm_q = -4.5             # pitch-rate damping
        self.Cl_beta = -0.03         # roll due to sideslip (dihedral)
        self.Cl_p = -0.70            # roll-rate damping
        self.Cn_beta = 0.60          # weathercock (yaw) stability (tail fin)
        self.Cn_r = -0.80            # yaw-rate damping
        self.Cn_dr = 0.55            # rudder -> yaw
        self.Cl_dr = 0.0             # rudder -> roll coupling (off)

        # ---- ocean current (earth frame, m/s) ----------------------------- #
        # lateral (eastward) surface current decaying with depth — a
        # perturbation relative to the glide speed, not a dominant flow
        self.current_surface = np.array([0.0, 0.04, 0.0])
        self.current_decay = 25.0    # e-folding depth (m)

    # ------------------------------------------------------------------ #
    def current_earth(self, depth: float) -> np.ndarray:
        """Depth-varying ocean current in the earth frame (m/s)."""
        return self.current_surface * np.exp(-max(depth, 0.0) / self.current_decay)

    # ------------------------------------------------------------------ #
    def _mass_and_cg(self):
        """Total mass, combined CG offset rg, and the 6x6 system matrix M."""
        m_total = self.m_dry + self.m_ballast
        # movable mass shifts the combined CG (it is a sub-mass of m_dry)
        rg = self.rg_base + (self.m_p / m_total) * self.r_p
        M_RB = np.zeros((6, 6))
        M_RB[:3, :3] = m_total * np.eye(3)
        M_RB[:3, 3:] = -m_total * skew(rg)
        M_RB[3:, :3] = m_total * skew(rg)
        M_RB[3:, 3:] = self.I_O
        return m_total, rg, M_RB + self.M_A

    # ------------------------------------------------------------------ #
    def deriv(self, state: np.ndarray) -> np.ndarray:
        """State derivative for the 12-state vector (RK4 right-hand side)."""
        x, y, z, phi, theta, psi, u, v, w, p, q, r = state
        nu1 = np.array([u, v, w])
        nu2 = np.array([p, q, r])
        nu = np.concatenate([nu1, nu2])

        R = rot_body_to_earth(phi, theta, psi)
        m_total, rg, M = self._mass_and_cg()

        # --- environment & relative velocity (for hydrodynamics) ---------- #
        rho = self.rho_0 + self.rho_grad * max(z, 0.0)
        v_cur_body = R.T @ self.current_earth(z)
        nu_r = nu1 - v_cur_body
        u_r, v_r, w_r = nu_r
        V = np.linalg.norm(nu_r) + 1e-6

        alpha = np.arctan2(w_r, u_r)
        beta = np.arcsin(np.clip(v_r / V, -1.0, 1.0))
        qdyn = 0.5 * rho * V * V * self.A

        # --- aerodynamic force coefficients ------------------------------- #
        CL = self.CL_alpha * alpha
        CD = self.CD0 + self.K * CL * CL
        CY = self.CY_beta * beta
        L = qdyn * CL
        Dr = qdyn * CD
        Yf = qdyn * CY

        # wind-frame force (-D, Y, -L) rotated into the body frame
        ca, sa = np.cos(alpha), np.sin(alpha)
        cb, sb = np.cos(beta), np.sin(beta)
        R_bw = np.array([
            [ca * cb, -ca * sb, -sa],
            [sb,       cb,        0.0],
            [sa * cb, -sa * sb,  ca],
        ])
        F_aero = R_bw @ np.array([-Dr, Yf, -L])

        # --- aerodynamic moments (with rate damping + rudder) ------------- #
        delta_r = self.delta_r
        hatp = p * self.b / (2.0 * V)
        hatq = q * self.c / (2.0 * V)
        hatr = r * self.b / (2.0 * V)
        Mx = qdyn * self.b * (self.Cl_beta * beta + self.Cl_p * hatp + self.Cl_dr * delta_r)
        My = qdyn * self.c * (self.Cm0 + self.Cm_alpha * alpha + self.Cm_q * hatq)
        Mz = qdyn * self.b * (self.Cn_beta * beta + self.Cn_r * hatr + self.Cn_dr * delta_r)
        M_aero = np.array([Mx, My, Mz])

        # --- hydrostatic restoring (gravity + buoyancy) ------------------- #
        W = m_total * self.g
        B = rho * self.V_nominal * self.g
        fg_b = R.T @ np.array([0.0, 0.0, W])    # weight, earth +z (down)
        fb_b = R.T @ np.array([0.0, 0.0, -B])   # buoyancy, earth -z (up)
        F_rest = fg_b + fb_b
        M_rest = np.cross(rg, fg_b) + np.cross(self.rb, fb_b)

        # --- assemble generalised force and solve M nu_dot = tau - C nu --- #
        # damping uses velocity relative to the water (nu_r1) for translation
        nu_damp = np.concatenate([nu_r, nu2])
        tau = np.concatenate([F_aero + F_rest, M_aero + M_rest]) - self.D_lin @ nu_damp

        # Coriolis-centripetal from the system inertia matrix (Fossen)
        M11nu = M[:3, :3] @ nu1 + M[:3, 3:] @ nu2
        M21nu = M[3:, :3] @ nu1 + M[3:, 3:] @ nu2
        C = np.zeros((6, 6))
        C[:3, 3:] = -skew(M11nu)
        C[3:, :3] = -skew(M11nu)
        C[3:, 3:] = -skew(M21nu)

        nu_dot = np.linalg.solve(M, tau - C @ nu)

        # --- kinematics: body rates -> earth-frame derivatives ------------ #
        pos_dot = R @ nu1
        eul_dot = euler_rate_matrix(phi, theta) @ nu2

        return np.concatenate([pos_dot, eul_dot, nu_dot])

    # ------------------------------------------------------------------ #
    def rk4_step(self, state: np.ndarray, dt: float) -> np.ndarray:
        k1 = self.deriv(state)
        k2 = self.deriv(state + 0.5 * dt * k1)
        k3 = self.deriv(state + 0.5 * dt * k2)
        k4 = self.deriv(state + dt * k3)
        return state + (dt / 6.0) * (k1 + 2 * k2 + 2 * k3 + k4)


# --------------------------------------------------------------------------- #
# Flight controller: sawtooth dive logic + heading hold
# --------------------------------------------------------------------------- #
def control(glider: Glider6DOF, state: np.ndarray, phase: str,
            z_top: float, z_bot: float, psi_cmd: float) -> str:
    """Update actuators in-place; return the (possibly toggled) dive phase."""
    z, psi, r = state[2], state[5], state[11]

    if z < z_top:
        phase = "dive"
    elif z > z_bot:
        phase = "climb"

    if phase == "dive":
        glider.m_ballast = 0.40        # heavier than neutral -> sink
        glider.r_p = np.array([0.035, glider.r_p[1], 0.0])   # mass fwd -> nose down
    else:  # climb
        glider.m_ballast = -0.40       # lighter than neutral -> rise
        glider.r_p = np.array([-0.035, glider.r_p[1], 0.0])  # mass aft -> nose up

    # heading hold via rudder (PD on yaw) + a touch of lateral mass for bank
    yaw_err = wrap_pi(psi_cmd - psi)
    delta_r = np.clip(1.0 * yaw_err - 1.0 * r, -0.30, 0.30)
    glider.delta_r = delta_r
    glider.r_p[1] = np.clip(0.15 * yaw_err, -0.015, 0.015)   # bank into the turn
    return phase


# --------------------------------------------------------------------------- #
# Simulation driver
# --------------------------------------------------------------------------- #
def simulate(t_max: float = 900.0, dt: float = 0.05,
             z_top: float = 2.5, z_bot: float = 18.0,
             psi_cmd_deg: float = 25.0):
    glider = Glider6DOF()
    glider.delta_r = 0.0
    glider.psi_cmd_deg = psi_cmd_deg
    psi_cmd = np.deg2rad(psi_cmd_deg)

    # state: [x, y, z, phi, theta, psi, u, v, w, p, q, r]
    state = np.array([0.0, 0.0, 2.0, 0.0, 0.0, 0.0, 0.45, 0.0, 0.0, 0.0, 0.0, 0.0])
    phase = "dive"

    n = int(t_max / dt)
    hist = np.empty((n, 12))
    t = np.arange(n) * dt
    for i in range(n):
        phase = control(glider, state, phase, z_top, z_bot, psi_cmd)
        state = glider.rk4_step(state, dt)
        hist[i] = state
    return t, hist, glider


# --------------------------------------------------------------------------- #
# Plotting + summary
# --------------------------------------------------------------------------- #
def plot(t, hist, glider, out="glider_6dof_trajectory.png"):
    x, y, z = hist[:, 0], hist[:, 1], hist[:, 2]
    phi, theta, psi = np.rad2deg(hist[:, 3]), np.rad2deg(hist[:, 4]), np.rad2deg(hist[:, 5])
    u, v, w = hist[:, 6], hist[:, 7], hist[:, 8]
    speed = np.sqrt(u ** 2 + v ** 2 + w ** 2)

    fig = plt.figure(figsize=(14, 9))
    fig.suptitle("6-DOF Underwater Glider Simulation (RK4) — roll, yaw & lateral current",
                 fontsize=14, fontweight="bold")

    ax1 = fig.add_subplot(2, 2, 1, projection="3d")
    ax1.plot(x, y, z, color="teal", lw=1.5)
    ax1.scatter(x[0], y[0], z[0], color="green", s=30, label="start")
    ax1.scatter(x[-1], y[-1], z[-1], color="red", s=30, label="end")
    ax1.set_xlabel("North x (m)"); ax1.set_ylabel("East y (m)"); ax1.set_zlabel("Depth (m)")
    ax1.invert_zaxis()
    ax1.set_title("3-D trajectory"); ax1.legend(loc="upper left", fontsize=8)

    ax2 = fig.add_subplot(2, 2, 2)
    ax2.plot(x, y, color="darkcyan", lw=1.5)
    ax2.quiver(x[::400], y[::400], 0, 1, color="steelblue", alpha=0.5,
               scale=25, width=0.004, label="current dir")
    ax2.scatter(x[0], y[0], color="green", s=25); ax2.scatter(x[-1], y[-1], color="red", s=25)
    ax2.set_xlabel("North x (m)"); ax2.set_ylabel("East y (m)")
    ax2.set_title("Top-down path (sideways current drift + turn)")
    ax2.axis("equal"); ax2.grid(True, ls="--", alpha=0.5); ax2.legend(fontsize=8)

    ax3 = fig.add_subplot(2, 2, 3)
    ax3.plot(t, z, color="teal", lw=1.2)
    ax3.invert_yaxis()
    ax3.set_xlabel("Time (s)"); ax3.set_ylabel("Depth (m)")
    ax3.set_title("Sawtooth depth profile"); ax3.grid(True, ls="--", alpha=0.5)

    ax4 = fig.add_subplot(2, 2, 4)
    ax4.plot(t, phi, label="roll φ", color="crimson", lw=1)
    ax4.plot(t, theta, label="pitch θ", color="seagreen", lw=1)
    ax4.plot(t, psi, label="yaw ψ", color="navy", lw=1)
    ax4.set_xlabel("Time (s)"); ax4.set_ylabel("Angle (deg)")
    ax4.set_title("Attitude history"); ax4.grid(True, ls="--", alpha=0.5); ax4.legend(fontsize=8)

    fig.tight_layout(rect=[0, 0, 1, 0.96])
    fig.savefig(out, dpi=110)
    print(f"saved figure -> {out}")

    # ---- text summary ---- #
    print("\n=== 6-DOF simulation summary ===")
    print(f"duration            : {t[-1]:.0f} s")
    print(f"depth range         : {z.min():.2f} – {z.max():.2f} m")
    print(f"horizontal travelled: {np.hypot(x[-1]-x[0], y[-1]-y[0]):.1f} m "
          f"(x {x[-1]:.1f} m, y {y[-1]:.1f} m)")
    print(f"lateral drift (y)   : {y[-1]:.1f} m  (from {glider.current_surface[1]:.2f} m/s surface current)")
    print(f"final heading ψ     : {psi[-1]:.1f} deg  (commanded {glider.psi_cmd_deg:.0f})")
    print(f"speed               : {speed.mean():.3f} m/s mean, {speed.max():.3f} m/s max")
    print(f"roll / pitch range  : ±{np.abs(phi).max():.1f}° / {theta.min():.1f}…{theta.max():.1f}°")


if __name__ == "__main__":
    t, hist, glider = simulate()
    plot(t, hist, glider)
