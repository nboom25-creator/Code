"use client";

import { useEffect, useState } from "react";
import { getPrefs, setPrefs } from "@/lib/storage";

export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    setPrefs({ theme: next ? "dark" : "light" });
    void getPrefs;
  }

  return (
    <button
      onClick={toggle}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      className="btn-ghost !px-2.5 !py-1.5"
    >
      {dark ? "☀️" : "🌙"}
    </button>
  );
}
