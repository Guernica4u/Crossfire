import { checkKeyStatus, checkKeyStatusForKey, getOwnerKey, type OpenRouterKeyStatus } from "@/lib/openrouter";
import { getPoolProbeKey, getPoolSnapshot, type PoolSnapshot } from "@/lib/pool";
import { debatesRemaining, requiredCallsForDebate } from "@/lib/debate-state";

export interface ProviderCapacity {
  configured: boolean;
  source: "owner" | "community" | null;
  requestsRemaining: number | null;
  requestsPerDebate: number;
  debatesRemaining: number | null;
  poolActive: number;
  canStart: boolean;
  message?: string;
}

export interface ProviderCapacityReport {
  status: OpenRouterKeyStatus;
  pool: PoolSnapshot;
  capacity: ProviderCapacity;
}

/**
 * Checks whether the free pool can plausibly finish a debate before one is
 * created. This is a preflight, not a reservation: providers can still rate
 * limit mid-debate.
 */
export async function getProviderCapacity(rounds = 1): Promise<ProviderCapacityReport> {
  let status = await checkKeyStatus();
  let source: ProviderCapacity["source"] = status.configured ? "owner" : null;
  const pool = await getPoolSnapshot();

  if (!status.configured && pool.active > 0) {
    const probe = await getPoolProbeKey();
    if (probe) {
      const community = await checkKeyStatusForKey(probe.key);
      if (community.configured) {
        status = { ...community, label: "Community pool" };
        source = "community";
      }
    }
  }

  const requestsPerDebate = requiredCallsForDebate(rounds);
  const requestsRemaining = status.freeRequests?.remaining ?? null;
  const remainingDebates = debatesRemaining(requestsRemaining, rounds);

  let canStart = true;
  let message: string | undefined;
  const ownerKeyPresent = Boolean(getOwnerKey());

  if (!status.configured && pool.active === 0 && !ownerKeyPresent) {
    canStart = false;
    message =
      "No free OpenRouter key is available. Add a key to the environment or contribute one to the community pool.";
  } else if (!status.configured && pool.active === 0 && ownerKeyPresent) {
    message = "The free quota could not be verified. The debate will try anyway.";
  } else if (
    requestsRemaining !== null &&
    requestsRemaining < requestsPerDebate &&
    pool.active === 0
  ) {
    canStart = false;
    message = `Only ${requestsRemaining} free request${requestsRemaining === 1 ? "" : "s"} left today, but a debate needs about ${requestsPerDebate}. Try again after the daily reset or add a community key.`;
  } else if (
    requestsRemaining !== null &&
    requestsRemaining < requestsPerDebate &&
    pool.active > 0
  ) {
    message = "The owner quota is low; community keys will cover the rest of this debate.";
  }

  return {
    status,
    pool,
    capacity: {
      configured: status.configured,
      source,
      requestsRemaining,
      requestsPerDebate,
      debatesRemaining: remainingDebates,
      poolActive: pool.active,
      canStart,
      message,
    },
  };
}
