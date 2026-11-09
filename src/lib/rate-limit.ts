import { consumeRateLimit, type RateLimitResult } from "@/lib/db";

function clientAddress(request: Request): string {
  const direct = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-real-ip");
  if (direct?.trim()) return direct.trim();
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "local";
}

async function bucketFor(request: Request, scope: string): Promise<string> {
  const address = clientAddress(request);
  try {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`crossfire:${scope}:${address}`),
    );
    const hex = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    return `rl:${scope}:${hex.slice(0, 32)}`;
  } catch {
    return `rl:${scope}:${address.slice(0, 64)}`;
  }
}

/** Applies a per-IP, per-scope fixed-window limit. */
export async function enforceRateLimit(
  request: Request,
  scope: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  return consumeRateLimit(await bucketFor(request, scope), limit, windowSeconds);
}

export function rateLimitResponse(result: RateLimitResult): Response {
  return Response.json(
    {
      error: `Too many requests. Try again in ${result.retryAfterSeconds} seconds.`,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfterSeconds),
        "Cache-Control": "no-store",
      },
    },
  );
}
