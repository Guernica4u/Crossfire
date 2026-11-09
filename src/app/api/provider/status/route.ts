import { getProviderCapacity } from "@/lib/capacity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const rounds = Math.min(
    3,
    Math.max(1, Number(new URL(request.url).searchParams.get("rounds")) || 1),
  );
  const { status, pool, capacity } = await getProviderCapacity(rounds);

  return Response.json(
    { ...status, pool, capacity },
    { headers: { "Cache-Control": "no-store" } },
  );
}
