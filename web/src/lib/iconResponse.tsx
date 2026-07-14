import { ImageResponse } from "next/og";

/**
 * Renders the EngineerTutor app icon as a PNG at a given size. Used by the
 * favicon, Apple touch icon, and PWA manifest icons — no binary image assets
 * are checked into the repo; Vercel/Next generate them at build/request time.
 *
 * The background is full-bleed (no rounded corners) so it works as a
 * "maskable" icon: the platform applies its own mask/shape.
 */
export function renderIcon(size: number): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#1a5fed",
          color: "white",
          fontSize: Math.round(size * 0.6),
          fontWeight: 800,
          fontFamily: "sans-serif",
        }}
      >
        E
      </div>
    ),
    { width: size, height: size },
  );
}
