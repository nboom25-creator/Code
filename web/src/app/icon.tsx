import { renderIcon } from "@/lib/iconResponse";

// Browser favicon (Next metadata file convention → auto-injected into <head>).
export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return renderIcon(64);
}
