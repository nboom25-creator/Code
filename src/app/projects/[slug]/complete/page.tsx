import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CompletionClient } from "@/components/completion-client";
import { PROJECTS, PROJECT_BY_SLUG } from "@/lib/seed/projects";

export function generateStaticParams() {
  return PROJECTS.map((p) => ({ slug: p.slug }));
}

export const metadata: Metadata = { title: "Project complete" };

export default async function CompletePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!PROJECT_BY_SLUG[slug]) notFound();
  return <CompletionClient slug={slug} />;
}
