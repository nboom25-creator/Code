import path from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The repository root holds an unrelated Expo project; pin tracing to this app.
  outputFileTracingRoot: path.dirname(new URL(import.meta.url).pathname),
  serverExternalPackages: ["better-sqlite3"],
  eslint: { ignoreDuringBuilds: true },
};
export default nextConfig;
