import { z } from "zod";
import { getProject, listRows, createRow } from "@/lib/db/repo";
import { buildSnapshot } from "@/lib/project/snapshot";
import { resolveProvider, providerStatus } from "@/lib/assistant/provider";
import { ok, fail, handleError, readJson, sanitizeText } from "@/lib/api";

export const dynamic = "force-dynamic";

const askSchema = z.object({ question: z.string().min(1).max(4000) });

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return ok({ status: providerStatus(), messages: listRows("assistant_messages", id, "created_at ASC") });
  } catch (e) {
    return handleError(e, "GET assistant");
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const project = getProject(id);
    if (!project) return fail("Project not found.", 404);

    const { question } = askSchema.parse(await readJson(req));
    const clean = sanitizeText(question, 4000)!;
    const snap = buildSnapshot(project);
    const history = listRows("assistant_messages", id, "created_at ASC")
      .slice(-10)
      .map((m) => ({ role: String(m.role), content: String(m.content) }));

    createRow("assistant_messages", id, { role: "user", content: clean });

    const provider = resolveProvider();
    let answer;
    try {
      answer = await provider.answer(clean, snap, history);
    } catch (providerError) {
      // A provider failure must never lose the user's question or fabricate a
      // reply. Record the failure and say so plainly.
      const message = providerError instanceof Error ? providerError.message : String(providerError);
      console.error(`[gliderforge] assistant provider failed: ${message}`);
      return fail(
        "The configured assistant provider could not be reached. Your question was saved. The built-in rules assistant is always available with ASSISTANT_PROVIDER=local.",
        502,
        message.slice(0, 200),
      );
    }

    createRow("assistant_messages", id, {
      role: "assistant",
      content: answer.answer,
      citations_json: JSON.stringify(answer.citations),
      provider: answer.provider,
    });

    return ok({ answer });
  } catch (e) {
    return handleError(e, "POST assistant");
  }
}
