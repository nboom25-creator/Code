import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { ThemeProvider, ThemeToggle } from "@/components/theme";

export const metadata: Metadata = {
  title: "StockCast — Evidence-based stock forecasting",
  description:
    "Research tool for evidence-based stock-price forecasts, transparent ratings and backtesting. Not financial advice.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <ThemeProvider>
          <header className="sticky top-0 z-40 border-b border-border bg-surface/80 backdrop-blur">
            <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
              <Link href="/" className="flex items-center gap-2">
                <span className="text-xl">📊</span>
                <span className="text-lg font-bold tracking-tight text-fg">StockCast</span>
                <span className="hidden rounded bg-warn/20 px-1.5 py-0.5 text-[10px] font-semibold text-warn sm:inline">
                  RESEARCH TOOL — NOT ADVICE
                </span>
              </Link>
              <nav className="flex items-center gap-2 text-sm">
                <Link href="/" className="rounded-lg px-3 py-1.5 text-fg hover:bg-card">
                  Dashboard
                </Link>
                <Link href="/backtest" className="rounded-lg px-3 py-1.5 text-fg hover:bg-card">
                  Backtest
                </Link>
                <ThemeToggle />
              </nav>
            </div>
          </header>
          <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
          <footer className="mx-auto max-w-7xl px-4 py-8 text-center text-xs text-muted">
            StockCast is a research and educational tool. It does not provide personalised financial
            advice. Forecasts are uncertain model outputs — never guarantees. Past performance does not
            guarantee future results.
          </footer>
        </ThemeProvider>
      </body>
    </html>
  );
}
