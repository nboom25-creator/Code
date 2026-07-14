import { renderIcon } from "@/lib/iconResponse";

// 192×192 PWA icon referenced by the web manifest (Android/Chrome install).
export const runtime = "edge";

export function GET() {
  return renderIcon(192);
}
