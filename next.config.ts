import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
};

// The Workers runtime (workerd) cannot reliably create its local storage on
// every Windows host, and a failed start leaves the app without a database.
// Use the bundled SQLite fallback there instead. Set CROSSFIRE_USE_WORKERD=1
// to force the local D1 emulator on Windows, or CROSSFIRE_LOCAL_DB=1 to force
// SQLite on any platform.
const forceLocalDb = process.env.CROSSFIRE_LOCAL_DB === "1";
const forceWorkerd = process.env.CROSSFIRE_USE_WORKERD === "1";
const useWorkerd =
  process.env.NODE_ENV === "development" &&
  !forceLocalDb &&
  (process.platform !== "win32" || forceWorkerd);

if (useWorkerd) {
  initOpenNextCloudflareForDev({ configPath: "./freebuff.wrangler.jsonc" });
}

export default nextConfig;
