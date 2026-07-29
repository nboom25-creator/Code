import type { Metadata } from "next";
import "./globals.css";
import { Shell } from "@/components/Nav";
import { listProjects } from "@/lib/db/repo";
import { getActiveProject } from "@/lib/project/session";

export const metadata: Metadata = {
  title: "GliderForge Assistant",
  description: "Engineering workspace for a laboratory-scale autonomous underwater glider senior design project.",
};

export const dynamic = "force-dynamic";

// Applied before paint so the page never flashes the wrong theme.
const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem('gf-theme');if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.classList.toggle('dark',t==='dark');}catch(e){}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const projects = listProjects();
  const active = await getActiveProject();
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>
        <Shell projects={projects.map((p) => ({ id: p.id, name: p.name, is_sample: p.is_sample }))} activeId={active?.id ?? null}>
          {children}
        </Shell>
      </body>
    </html>
  );
}
