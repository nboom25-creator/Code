import { renderIcon } from "@/lib/iconResponse";

// iOS "Add to Home Screen" uses the apple-touch-icon (this convention file).
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return renderIcon(180);
}
