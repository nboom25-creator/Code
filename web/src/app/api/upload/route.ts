import { NextResponse } from "next/server";
import { extractFromMedia } from "@/lib/anthropic";
import { classifyUpload } from "@/lib/upload";
import { neutralize } from "@/lib/sanitize";
import { errorResponse, checkRate } from "@/lib/routeHelpers";

export const runtime = "nodejs";

/**
 * File upload → extracted problem text (for confirmation before solving).
 * We validate type/size, sanitize text content, and never treat uploaded text
 * as instructions. Private content is not logged.
 */
export async function POST(req: Request) {
  const limited = checkRate(req, "upload");
  if (limited) return limited;
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided.", code: "bad_input" }, { status: 400 });
    }
    const { kind, reason } = classifyUpload(file.type, file.size);
    if (kind === "rejected") {
      return NextResponse.json({ error: reason, code: "rejected_file" }, { status: 400 });
    }

    if (kind === "text") {
      const raw = await file.text();
      const text = neutralize(raw.slice(0, 20000));
      return NextResponse.json({
        kind,
        text,
        notes: "Extracted directly from the text file — please review before solving.",
      });
    }

    // image / pdf → AI vision/document extraction
    const buf = Buffer.from(await file.arrayBuffer());
    const base64 = buf.toString("base64");
    const { text, notes } = await extractFromMedia({
      base64,
      mediaType: file.type,
      isPdf: kind === "pdf",
    });
    return NextResponse.json({ kind, text: neutralize(text), notes });
  } catch (err) {
    return errorResponse(err);
  }
}
