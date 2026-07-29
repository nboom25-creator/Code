"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import clsx from "clsx";

export const NAV_SECTIONS: { heading: string; items: { href: string; label: string; hint: string }[] }[] = [
  {
    heading: "Overview",
    items: [
      { href: "/", label: "Dashboard", hint: "Project state, warnings and what to work on next" },
      { href: "/requirements", label: "Requirements", hint: "Define and trace engineering requirements" },
    ],
  },
  {
    heading: "Vehicle",
    items: [
      { href: "/vehicle", label: "Vehicle", hint: "Envelope, wings and the shared vehicle definition" },
      { href: "/components", label: "Components", hint: "Inventory with mass, volume, material and position" },
      { href: "/viewer", label: "CAD Viewer", hint: "3D view with CG, CB and component markers" },
      { href: "/mass", label: "Mass & Buoyancy", hint: "Mass, displacement and net buoyancy budget" },
    ],
  },
  {
    heading: "Analysis",
    items: [
      { href: "/syringe", label: "Syringe Engine", hint: "Buoyancy engine sizing, forces, torque and energy" },
      { href: "/structure", label: "Pressure & Structure", hint: "Preliminary housing, end cap and seal checks" },
      { href: "/stability", label: "Stability & Trim", hint: "CG/CB, righting moment and the trim solver" },
      { href: "/hydro", label: "Hydrodynamics", hint: "Drag buildup and steady glide performance" },
      { href: "/mission", label: "Mission Simulator", hint: "Dive-and-climb cycles with a state machine" },
      { href: "/compare", label: "Compare Designs", hint: "Side-by-side comparison of candidate configurations" },
    ],
  },
  {
    heading: "Build & test",
    items: [
      { href: "/electronics", label: "Electronics", hint: "Loads, pins, power budget and control strategy" },
      { href: "/tests", label: "Tests & Data", hint: "Test plans, recorded runs and data analysis" },
    ],
  },
  {
    heading: "Record",
    items: [
      { href: "/notebook", label: "Notebook", hint: "Chronological engineering notebook" },
      { href: "/decisions", label: "Decisions", hint: "Design decision records and weighted matrices" },
      { href: "/risks", label: "Risks", hint: "Risk register with priority scoring" },
      { href: "/assumptions", label: "Assumptions", hint: "Open assumptions awaiting confirmation" },
      { href: "/reports", label: "Reports", hint: "Generate and export engineering documents" },
    ],
  },
  {
    heading: "Help",
    items: [
      { href: "/assistant", label: "Assistant", hint: "Ask questions about your own project data" },
      { href: "/settings", label: "Settings", hint: "Environment, units, theme and project options" },
    ],
  },
];

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={onClose} aria-hidden />}
      <nav
        aria-label="Main"
        className={clsx(
          "gf-no-print fixed inset-y-0 left-0 z-40 w-60 shrink-0 overflow-y-auto border-r bg-panel px-3 py-4 transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <Link href="/" className="mb-5 block px-2" onClick={onClose}>
          <div className="text-sm font-bold tracking-tight">GliderForge</div>
          <div className="text-[10px] uppercase tracking-widest text-muted">Assistant</div>
        </Link>
        {NAV_SECTIONS.map((section) => (
          <div key={section.heading} className="mb-4">
            <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-widest text-muted">{section.heading}</div>
            <ul className="space-y-px">
              {section.items.map((item) => {
                const active = pathname === item.href;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      title={item.hint}
                      onClick={onClose}
                      aria-current={active ? "page" : undefined}
                      className={clsx(
                        "block rounded px-2 py-1.5 text-[13px] transition",
                        active ? "bg-surface font-semibold text-ink" : "text-muted hover:bg-surface hover:text-ink",
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </>
  );
}

export function TopBar({
  projects,
  activeId,
  onMenu,
}: {
  projects: { id: string; name: string; is_sample: number }[];
  activeId: string | null;
  onMenu: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [theme, setTheme] = React.useState<"light" | "dark">("dark");

  React.useEffect(() => {
    const stored = localStorage.getItem("gf-theme");
    const initial = stored === "light" || stored === "dark" ? stored : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    setTheme(initial);
    document.documentElement.classList.toggle("dark", initial === "dark");
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("gf-theme", next);
    document.documentElement.classList.toggle("dark", next === "dark");
  };

  const switchProject = async (id: string) => {
    document.cookie = `gf_project=${encodeURIComponent(id)}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
    router.push("/");
  };

  const undo = async () => {
    if (!activeId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${activeId}/undo`, { method: "POST" });
      const json = await res.json();
      setMessage(json.description ?? "Nothing to undo.");
      router.refresh();
    } catch {
      setMessage("Undo failed — check the server log.");
    } finally {
      setBusy(false);
      setTimeout(() => setMessage(null), 5000);
    }
  };

  return (
    <header className="gf-no-print sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b bg-panel px-4 py-2">
      <button className="gf-btn lg:hidden" onClick={onMenu} aria-label="Open navigation">
        ☰
      </button>
      <label className="sr-only" htmlFor="project-switcher">
        Active project
      </label>
      <select
        id="project-switcher"
        className="gf-input w-auto max-w-[260px]"
        value={activeId ?? ""}
        onChange={(e) => switchProject(e.target.value)}
      >
        {projects.length === 0 && <option value="">No projects yet</option>}
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.is_sample ? "  (demo)" : ""}
          </option>
        ))}
      </select>

      <div className="ml-auto flex items-center gap-2">
        {message && <span className="text-xs text-muted">{message}</span>}
        <button className="gf-btn" onClick={undo} disabled={busy || !activeId} title="Undo the last change to project data">
          Undo
        </button>
        <Link href="/projects" className="gf-btn">
          Projects
        </Link>
        <button className="gf-btn" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} title="Toggle theme">
          {theme === "dark" ? "☀" : "☾"}
        </button>
      </div>
    </header>
  );
}

export function Shell({
  projects,
  activeId,
  children,
}: {
  projects: { id: string; name: string; is_sample: number }[];
  activeId: string | null;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="flex min-h-screen">
      <Sidebar open={open} onClose={() => setOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar projects={projects} activeId={activeId} onMenu={() => setOpen(true)} />
        <main className="min-w-0 flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
