import {
  PoolError,
  contributePoolKey,
  getPoolSnapshot,
  noteContributionAttempt,
} from "@/lib/pool";
import { enforceRateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function GET() {
  return Response.json({ pool: await getPoolSnapshot() }, { headers: NO_STORE });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return Response.json({ error: "Cross-origin contributions are not allowed." }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return Response.json({ error: "Send the contribution as JSON." }, { status: 415 });
  }

  const limit = await enforceRateLimit(request, "pool-contribute", 8, 3600);
  if (!limit.allowed) return rateLimitResponse(limit);

  try {
    noteContributionAttempt();
    const body = (await request.json()) as { key?: unknown; contributor?: unknown };
    const result = await contributePoolKey({
      key: body.key,
      contributor: body.contributor,
    });
    return Response.json(
      {
        contributed: true,
        key: result.key,
        pool: result.pool,
        message: "Key verified and added to the community pool.",
      },
      { status: 201, headers: NO_STORE },
    );
  } catch (error) {
    const status = error instanceof PoolError ? error.status : 500;
    return Response.json(
      {
        error:
          error instanceof PoolError
            ? error.message
            : "The key could not be added to the pool.",
      },
      { status, headers: NO_STORE },
    );
  }
}
