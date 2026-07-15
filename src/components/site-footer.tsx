import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Logo } from "@/components/logo";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t bg-card no-print">
      <div className="container flex flex-col gap-6 py-10 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-sm space-y-3">
          <Logo />
          <p className="text-sm text-muted-foreground">
            Every project is easier with a clear path. Beginner-friendly,
            safety-first DIY guidance.
          </p>
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            Guidance is educational only. Costs and times are estimates. When a
            job involves electrical, gas, structural, or major plumbing work,
            hire a licensed professional.
          </p>
        </div>
        <nav className="grid grid-cols-2 gap-x-10 gap-y-2 text-sm" aria-label="Footer">
          <Link href="/projects" className="text-muted-foreground hover:text-foreground">
            Browse projects
          </Link>
          <Link href="/planner" className="text-muted-foreground hover:text-foreground">
            Project planner
          </Link>
          <Link href="/shopping-list" className="text-muted-foreground hover:text-foreground">
            Shopping list
          </Link>
          <Link href="/dashboard" className="text-muted-foreground hover:text-foreground">
            Dashboard
          </Link>
          <Link href="/settings" className="text-muted-foreground hover:text-foreground">
            Settings
          </Link>
        </nav>
      </div>
    </footer>
  );
}
