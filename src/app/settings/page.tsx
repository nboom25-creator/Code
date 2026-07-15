import type { Metadata } from "next";
import { SettingsClient } from "@/components/settings-client";

export const metadata: Metadata = {
  title: "Settings",
  description: "Personalize ProjectPath and manage your data.",
};

export default function SettingsPage() {
  return <SettingsClient />;
}
