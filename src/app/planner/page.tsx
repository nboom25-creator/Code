import type { Metadata } from "next";
import { PlannerClient } from "@/components/planner-client";

export const metadata: Metadata = {
  title: "Project planner",
  description:
    "Answer a few questions and get beginner-friendly DIY project recommendations that fit your time, budget, and tools.",
};

export default function PlannerPage() {
  return <PlannerClient />;
}
