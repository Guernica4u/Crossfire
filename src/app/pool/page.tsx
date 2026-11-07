import { PoolPanel } from "@/components/pool-panel";
import { getPoolSnapshot } from "@/lib/pool";

export const dynamic = "force-dynamic";

export default function PoolPage() {
  return <PoolPanel initialPool={getPoolSnapshot()} />;
}
