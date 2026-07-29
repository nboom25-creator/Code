"use client";

import React from "react";
import type { EngineConfig } from "@/lib/calc/syringe";

/**
 * Labelled schematic of the selected buoyancy-engine architecture.
 *
 * Inline SVG rather than an image so it scales, respects the theme, and can be
 * printed into a report. The point of each drawing is to make the physical
 * difference between the architectures obvious: what moves, what crosses the
 * hull boundary, and which way ambient pressure pushes.
 */

const INK = "currentColor";
const WATER = "var(--series-1)";
const HULL = "var(--label)";
const FLUID = "var(--series-3)";
const FORCE = "var(--series-2)";

export function EngineSchematic({ config }: { config: EngineConfig }) {
  return (
    <div className="space-y-2">
      <div className="gf-scroll-x">
        <svg viewBox="0 0 420 220" className="w-full" style={{ maxWidth: 460 }} role="img" aria-label={SCHEMATIC_ALT[config]}>
          {/* Water region */}
          <rect x="0" y="0" width="420" height="220" fill={WATER} opacity="0.06" />
          <text x="6" y="14" fontSize="9" fill={HULL}>
            ambient water
          </text>

          {/* Hull boundary */}
          <rect x="30" y="40" width="250" height="140" fill="none" stroke={HULL} strokeWidth="2.5" rx="6" />
          <text x="38" y="56" fontSize="9" fill={HULL}>
            sealed hull (dry, at surface pressure)
          </text>

          {Body[config]()}
        </svg>
      </div>
      <p className="text-[11px] leading-snug text-muted">{SCHEMATIC_ALT[config]}</p>
      <div className="flex flex-wrap gap-3 text-[10px] text-muted">
        <Legend color={HULL} label="hull boundary" />
        <Legend color={WATER} label="ambient water" />
        <Legend color={FLUID} label="carried fluid" />
        <Legend color={FORCE} label="pressure acting on the actuator" />
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span aria-hidden className="inline-block h-2 w-4 rounded-sm" style={{ background: color, opacity: 0.7 }} />
      {label}
    </span>
  );
}

const SCHEMATIC_ALT: Record<EngineConfig, string> = {
  "external-plunger":
    "A motor drives a lead screw which pushes the syringe plunger out through the tail cap. The protruding plunger increases the vehicle's external displaced volume while its mass stays constant, so the vehicle becomes more buoyant. Ambient pressure pushes inward on the exposed plunger face, so extending is the stroke that fights pressure.",
  "internal-ballast":
    "The syringe draws ambient water through a hull port into a tank inside the sealed hull. The external envelope does not change, but the vehicle's mass increases by the mass of water taken in, so it becomes less buoyant. Ambient pressure helps the intake stroke and fights the discharge stroke, so discharge at maximum depth is the sizing case.",
  "external-bladder":
    "A carried working fluid is pumped from a rigid internal reservoir into a flexible bladder mounted outside the hull. Total vehicle mass is unchanged because the fluid never leaves the vehicle, but the external envelope grows by the transferred volume, so the vehicle becomes more buoyant. Inflating works against ambient pressure plus the bladder's own elastic back-pressure.",
  "piston-separator":
    "A piston inside a through-hull cylinder separates carried fluid on the dry side from ambient water on the wet side. Moving the piston changes how much of the cylinder is occupied by ambient water, which changes the external displaced volume at constant vehicle mass. The piston face sees the full pressure differential.",
  combined:
    "The mechanism changes both the vehicle's mass and its displaced volume at once. The two effects can partly or wholly cancel — if water taken in equals the envelope growth, the net buoyancy change is zero — so the fractions going to each must be stated explicitly.",
};

const Body: Record<EngineConfig, () => React.ReactElement> = {
  "external-plunger": () => (
    <g>
      {/* motor */}
      <rect x="50" y="95" width="42" height="34" fill="none" stroke={INK} strokeWidth="1.5" />
      <text x="53" y="116" fontSize="9" fill={INK}>
        motor
      </text>
      {/* lead screw */}
      <line x1="92" y1="112" x2="140" y2="112" stroke={INK} strokeWidth="2" strokeDasharray="4 2" />
      <text x="98" y="106" fontSize="8" fill={HULL}>
        lead screw
      </text>
      {/* syringe barrel */}
      <rect x="140" y="94" width="120" height="36" fill="none" stroke={INK} strokeWidth="1.5" />
      <text x="152" y="90" fontSize="8" fill={HULL}>
        syringe barrel
      </text>
      {/* plunger */}
      <rect x="196" y="96" width="10" height="32" fill={INK} opacity="0.55" />
      <line x1="206" y1="112" x2="330" y2="112" stroke={INK} strokeWidth="3" />
      {/* rod seal at hull */}
      <circle cx="280" cy="112" r="5" fill="none" stroke={FORCE} strokeWidth="2" />
      <text x="252" y="150" fontSize="8" fill={FORCE}>
        dynamic rod seal
      </text>
      {/* protruding volume */}
      <rect x="280" y="102" width="50" height="20" fill={WATER} opacity="0.35" />
      <text x="286" y="96" fontSize="8" fill={WATER}>
        added displaced volume
      </text>
      {/* pressure arrows inward */}
      <Arrow x1={380} y1={112} x2={336} y2={112} color={FORCE} />
      <text x="336" y="132" fontSize="8" fill={FORCE}>
        P_ambient
      </text>
      {/* motion */}
      <Arrow x1={300} y1={80} x2={340} y2={80} color={INK} />
      <text x="296" y="74" fontSize="8" fill={INK}>
        extend = more buoyant
      </text>
      <text x="38" y="172" fontSize="8.5" fill={HULL}>
        mass constant · displaced volume changes
      </text>
    </g>
  ),

  "internal-ballast": () => (
    <g>
      <rect x="50" y="95" width="42" height="34" fill="none" stroke={INK} strokeWidth="1.5" />
      <text x="53" y="116" fontSize="9" fill={INK}>
        motor
      </text>
      <line x1="92" y1="112" x2="130" y2="112" stroke={INK} strokeWidth="2" strokeDasharray="4 2" />
      {/* syringe / tank inside hull */}
      <rect x="130" y="90" width="120" height="44" fill={WATER} opacity="0.3" stroke={INK} strokeWidth="1.5" />
      <rect x="130" y="90" width="10" height="44" fill={INK} opacity="0.55" />
      <text x="150" y="116" fontSize="9" fill={INK}>
        internal water tank
      </text>
      <text x="146" y="86" fontSize="8" fill={HULL}>
        water taken INSIDE the hull
      </text>
      {/* port through hull */}
      <line x1="250" y1="112" x2="280" y2="112" stroke={WATER} strokeWidth="4" />
      <circle cx="280" cy="112" r="5" fill="none" stroke={FORCE} strokeWidth="2" />
      <text x="256" y="150" fontSize="8" fill={FORCE}>
        hull port + valve
      </text>
      <Arrow x1={360} y1={112} x2={292} y2={112} color={WATER} />
      <text x="300" y="100" fontSize="8" fill={WATER}>
        intake (pressure HELPS)
      </text>
      <Arrow x1={292} y1={140} x2={360} y2={140} color={FORCE} />
      <text x="296" y="158" fontSize="8" fill={FORCE}>
        discharge (pressure FIGHTS) ← sizing case
      </text>
      <text x="38" y="172" fontSize="8.5" fill={HULL}>
        mass changes · displaced volume constant
      </text>
    </g>
  ),

  "external-bladder": () => (
    <g>
      <rect x="50" y="95" width="42" height="34" fill="none" stroke={INK} strokeWidth="1.5" />
      <text x="53" y="116" fontSize="9" fill={INK}>
        pump
      </text>
      <rect x="105" y="90" width="105" height="44" fill={FLUID} opacity="0.28" stroke={INK} strokeWidth="1.5" />
      <text x="118" y="116" fontSize="9" fill={INK}>
        oil reservoir
      </text>
      <line x1="210" y1="112" x2="280" y2="112" stroke={FLUID} strokeWidth="4" />
      <circle cx="280" cy="112" r="5" fill="none" stroke={FORCE} strokeWidth="2" />
      <text x="230" y="150" fontSize="8" fill={FORCE}>
        static hull fitting
      </text>
      {/* bladder */}
      <ellipse cx="330" cy="112" rx="42" ry="30" fill={FLUID} opacity="0.35" stroke={FLUID} strokeWidth="2" />
      <text x="300" y="70" fontSize="8" fill={FLUID}>
        external bladder
      </text>
      <Arrow x1={392} y1={112} x2={376} y2={112} color={FORCE} />
      <text x="330" y="160" fontSize="8" fill={FORCE}>
        P_ambient + bladder back-pressure
      </text>
      <text x="38" y="172" fontSize="8.5" fill={HULL}>
        mass constant (fluid stays aboard) · displaced volume changes
      </text>
    </g>
  ),

  "piston-separator": () => (
    <g>
      <rect x="50" y="95" width="42" height="34" fill="none" stroke={INK} strokeWidth="1.5" />
      <text x="53" y="116" fontSize="9" fill={INK}>
        motor
      </text>
      <line x1="92" y1="112" x2="130" y2="112" stroke={INK} strokeWidth="2" strokeDasharray="4 2" />
      {/* through-hull cylinder */}
      <rect x="130" y="92" width="230" height="40" fill="none" stroke={INK} strokeWidth="1.5" />
      <rect x="130" y="94" width="90" height="36" fill={FLUID} opacity="0.28" />
      <rect x="230" y="94" width="130" height="36" fill={WATER} opacity="0.3" />
      {/* piston */}
      <rect x="220" y="90" width="10" height="44" fill={INK} opacity="0.65" />
      <text x="146" y="116" fontSize="8" fill={INK}>
        carried fluid
      </text>
      <text x="272" y="116" fontSize="8" fill={INK}>
        ambient water
      </text>
      <text x="196" y="84" fontSize="8" fill={INK}>
        piston
      </text>
      {/* hull crossing */}
      <line x1="280" y1="40" x2="280" y2="180" stroke={HULL} strokeWidth="2.5" strokeDasharray="3 3" />
      <text x="284" y="176" fontSize="8" fill={HULL}>
        hull boundary
      </text>
      <Arrow x1={392} y1={112} x2={366} y2={112} color={FORCE} />
      <text x="300" y="152" fontSize="8" fill={FORCE}>
        full ΔP across the piston face
      </text>
      <text x="38" y="172" fontSize="8.5" fill={HULL}>
        mass constant · displaced volume changes
      </text>
    </g>
  ),

  combined: () => (
    <g>
      <rect x="50" y="95" width="42" height="34" fill="none" stroke={INK} strokeWidth="1.5" />
      <text x="53" y="116" fontSize="9" fill={INK}>
        motor
      </text>
      <rect x="105" y="86" width="105" height="24" fill={WATER} opacity="0.3" stroke={INK} strokeWidth="1.2" />
      <text x="112" y="102" fontSize="8" fill={INK}>
        water taken inside (mass ↑)
      </text>
      <rect x="105" y="118" width="105" height="24" fill={FLUID} opacity="0.28" stroke={INK} strokeWidth="1.2" />
      <text x="112" y="134" fontSize="8" fill={INK}>
        envelope grows (volume ↑)
      </text>
      <line x1="210" y1="98" x2="280" y2="98" stroke={WATER} strokeWidth="3" />
      <line x1="210" y1="130" x2="280" y2="130" stroke={FLUID} strokeWidth="3" />
      <ellipse cx="318" cy="130" rx="34" ry="22" fill={FLUID} opacity="0.35" stroke={FLUID} strokeWidth="2" />
      <Arrow x1={392} y1={98} x2={292} y2={98} color={WATER} />
      <text x="36" y="172" fontSize="8.5" fill={FORCE}>
        the two effects SUBTRACT — equal fractions cancel to zero authority
      </text>
    </g>
  ),
};

function Arrow({ x1, y1, x2, y2, color }: { x1: number; y1: number; x2: number; y2: number; color: string }) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const size = 6;
  const p1 = [x2 - size * Math.cos(angle - Math.PI / 7), y2 - size * Math.sin(angle - Math.PI / 7)];
  const p2 = [x2 - size * Math.cos(angle + Math.PI / 7), y2 - size * Math.sin(angle + Math.PI / 7)];
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth="2" />
      <polygon points={`${x2},${y2} ${p1[0]},${p1[1]} ${p2[0]},${p2[1]}`} fill={color} />
    </g>
  );
}
