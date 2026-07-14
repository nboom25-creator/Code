import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { ThemeScript } from "@/components/ThemeScript";

export const metadata: Metadata = {
  title: "EngineerTutor — learn any engineering subject",
  description:
    "An interactive engineering tutor: structured lessons, step-by-step problem solving, quizzes, deterministic calculations, and real instructional videos.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "EngineerTutor", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#1a5fed" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1115" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body>
        <div className="min-h-screen">
          <Nav />
          <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-6">{children}</main>
          <footer className="mx-auto max-w-6xl px-4 pb-10 text-center text-xs text-slate-400">
            EngineerTutor · AI-generated instruction — verify against your course materials and
            follow your instructor&apos;s academic-integrity policy.
          </footer>
        </div>
      </body>
    </html>
  );
}
