import { PHASE_0_STATUS, MISSING_SOURCE_ASSETS } from "../data/phase-status.ts";

/**
 * Phase 0 shell.
 *
 * KICKOFF scopes session 1 to "Phase 0 only. No map, no UI." CLAUDE.md's working
 * style still requires each phase to end with the app running, so this is a status
 * surface and nothing more. The War Room shell is Phase 11 — do not grow this file
 * into it.
 *
 * The palette here is provisional. KICKOFF directs the visual language to be mined
 * from `kernel/legacy-ui-reference.jsx`, which is not in the repo yet; replace these
 * values from that file rather than inventing a second palette.
 */
export function App() {
  return (
    <main className="shell">
      <header className="shell__head">
        <h1 className="shell__title">STRATCOM</h1>
        <p className="shell__sub">
          Educational geopolitical conflict simulator — strategic abstraction only.
        </p>
      </header>

      <section className="card" aria-labelledby="phase-h">
        <h2 id="phase-h" className="card__title">
          Phase 0 — scaffold and port
        </h2>
        <ul className="checklist">
          {PHASE_0_STATUS.map((item) => (
            <li key={item.label} className={`checklist__item is-${item.state}`}>
              <span className="checklist__mark" aria-hidden="true">
                {item.state === "done" ? "✓" : item.state === "blocked" ? "✗" : "·"}
              </span>
              <span className="checklist__label">{item.label}</span>
              <span className="checklist__state">{item.state}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card card--warn" aria-labelledby="blocked-h">
        <h2 id="blocked-h" className="card__title">
          Calibration gate: not established
        </h2>
        <p className="card__body">
          The gate is <strong>not green and is not red</strong> — it has never run. The
          source assets the port reads from are absent from this repository:
        </p>
        <ul className="missing">
          {MISSING_SOURCE_ASSETS.map((a) => (
            <li key={a.path}>
              <code>{a.path}</code> — {a.what}
            </li>
          ))}
        </ul>
        <p className="card__body">
          Per CLAUDE.md non-negotiable #1, no baseline has been recorded. Numbers in
          KICKOFF (train ≈ 2.8, held out ≈ 3.4) are orientation from the previous
          codebase, not measurements taken here.
        </p>
      </section>
    </main>
  );
}
