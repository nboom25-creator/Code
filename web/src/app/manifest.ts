import type { MetadataRoute } from "next";

// PWA manifest (served at /manifest.webmanifest). Enables "Install app" /
// "Add to Home Screen" so EngineerTutor behaves like an app on phones.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "EngineerTutor",
    short_name: "EngineerTutor",
    description:
      "An interactive engineering tutor: lessons, step-by-step problem solving, quizzes, and real instructional videos.",
    start_url: "/",
    display: "standalone",
    background_color: "#0f1115",
    theme_color: "#1a5fed",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
