import { databaseBackend, getDebateStats } from "@/lib/db";
import { getOwnerKey } from "@/lib/openrouter";
import { getPoolSnapshot } from "@/lib/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [stats, pool] = await Promise.all([getDebateStats(), getPoolSnapshot()]);
    return Response.json(
      {
        ok: true,
        database: databaseBackend(),
        ownerKeyConfigured: Boolean(getOwnerKey()),
        pool: { active: pool.active, total: pool.total },
        debates: stats,
        checkedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "The health check failed.",
        checkedAt: new Date().toISOString(),
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
