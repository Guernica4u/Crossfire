import { checkKeyStatus, checkKeyStatusForKey } from "@/lib/openrouter";
import { getPoolProbeKey, getPoolSnapshot } from "@/lib/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let status = await checkKeyStatus();
  const pool = getPoolSnapshot();

  if (!status.configured && pool.active > 0) {
    const probe = getPoolProbeKey();
    if (probe) {
      const community = await checkKeyStatusForKey(probe.key);
      if (community.configured) {
        status = { ...community, label: "Community pool" };
      }
    }
  }

  return Response.json({ ...status, pool }, {
    headers: { "Cache-Control": "no-store" },
  });
}
