import { renderIcon } from "@/lib/iconResponse";

// 512×512 PWA icon referenced by the web manifest (Android/Chrome install).
export const runtime = "edge";

export function GET() {
  return renderIcon(512);
}
