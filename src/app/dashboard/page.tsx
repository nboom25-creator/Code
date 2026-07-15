import type { Metadata } from "next";
import { DashboardClient } from "@/components/dashboard-client";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Your DIY progress, saved projects, and stats.",
};

export default function DashboardPage() {
  return <DashboardClient />;
}
