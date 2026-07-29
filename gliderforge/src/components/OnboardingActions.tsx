"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { api } from "./client";
import { ErrorNotice, Spinner } from "./ui";

/** First-run actions: load the demonstration project, or create a blank one. */
export function OnboardingActions() {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const activate = (id: string) => {
    document.cookie = `gf_project=${encodeURIComponent(id)}; path=/; max-age=31536000; samesite=lax`;
  };

  const loadSample = async () => {
    setBusy("sample");
    setError(null);
    try {
      const { project } = await api.createSample();
      activate(String(project.id));
      router.refresh();
      router.push("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (error) return <ErrorNotice detail={error} onRetry={() => setError(null)} />;

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <button className="gf-btn gf-btn-primary" onClick={loadSample} disabled={busy !== null}>
        {busy === "sample" ? <Spinner label="Building demo…" /> : "Load the demonstration project"}
      </button>
      <a href="/projects" className="gf-btn">
        Create my own project
      </a>
    </div>
  );
}
