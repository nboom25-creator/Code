import type { ProjectSnapshot } from "@/lib/project/snapshot";

/** A specific project value the assistant used, with a link back to its source. */
export interface Citation {
  label: string;
  value: string;
  source: string;
  href?: string;
}

export interface ProposedChange {
  /** Human description of what would change. */
  description: string;
  table?: string;
  entityId?: string;
  patch?: Record<string, unknown>;
}

export interface AssistantAnswer {
  /** Markdown body. */
  answer: string;
  /** Numeric results derived from project data — always separated from advice. */
  calculations: { label: string; value: string; equation?: string; note?: string }[];
  /** Qualitative engineering advice, explicitly labelled as such. */
  advice: string[];
  citations: Citation[];
  /** Data the assistant needed but could not find. */
  missingData: string[];
  /** True when the conclusion touches safety and needs human review. */
  safetyFlag: boolean;
  /** Change the user may accept, edit, reject or defer. Never auto-applied. */
  proposedChange?: ProposedChange;
  provider: string;
  intent: string;
}

export interface AssistantProvider {
  readonly name: string;
  readonly available: boolean;
  answer(question: string, snap: ProjectSnapshot, history: { role: string; content: string }[]): Promise<AssistantAnswer>;
}
