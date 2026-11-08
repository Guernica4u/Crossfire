import { PoolPanel } from "@/components/pool-panel";
import { getPoolSnapshot } from "@/lib/pool";

export const dynamic = "force-dynamic";

export default async function PoolPage() {
  const pool = await getPoolSnapshot();
  return <PoolPanel initialPool={pool} />;
}
