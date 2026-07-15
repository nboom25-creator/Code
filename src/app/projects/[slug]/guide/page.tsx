import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GuideClient } from "@/components/guide-client";
import { PROJECTS, PROJECT_BY_SLUG } from "@/lib/seed/projects";

export function generateStaticParams() {
  return PROJECTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const project = PROJECT_BY_SLUG[slug];
  return { title: project ? `Guide: ${project.title}` : "Guide" };
}

export default async function GuidePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!PROJECT_BY_SLUG[slug]) notFound();
  return <GuideClient slug={slug} />;
}
