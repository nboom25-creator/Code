"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "./ThemeToggle";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/learn", label: "Learn" },
  { href: "/solve", label: "Solve" },
  { href: "/quiz", label: "Quiz" },
  { href: "/study-plan", label: "Study Plan" },
];

export function Nav() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3">
        <Link href="/" className="mr-2 flex items-center gap-2 font-semibold">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-600 text-sm text-white">
            E
          </span>
          <span className="hidden sm:inline">EngineerTutor</span>
        </Link>
        <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
          {LINKS.map((l) => {
            const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${
                  active
                    ? "bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200"
                    : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <ThemeToggle />
      </div>
    </header>
  );
}
