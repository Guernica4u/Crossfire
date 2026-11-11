import {
  countPoolKeys,
  findPoolKeyByFingerprint,
  insertPoolKey,
  listPublicPoolKeys,
  listStoredPoolKeys,
  markPoolKeyStatus,
  markPoolKeyUsed,
  type PublicPoolKey,
} from "@/lib/db";

const OPENROUTER_KEY_URL = "https://openrouter.ai/api/v1/key";
const MAX_POOL_KEYS = 25;
const encoder = new TextEncoder();

const globalForPool = globalThis as unknown as {
  crossfireAesKey?: Promise<CryptoKey>;
  crossfireFingerprintKey?: Promise<CryptoKey>;
  crossfireContributionTimes?: number[];
};

export class PoolError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "PoolError";
    this.status = status;
  }
}

function normalizeKey(value: unknown): string {
  let key = String(value ?? "").trim();
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }
  return key;
}

function validKeyShape(key: string): boolean {
  return /^sk-[A-Za-z0-9._-]{16,}$/.test(key) && key.length <= 240;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function poolSecret(): string {
  const configured = process.env.CROSSFIRE_POOL_SECRET?.trim();
  if (!configured || configured.length < 32) {
    throw new PoolError(
      "The pool encryption secret is not configured on this deployment.",
      503,
    );
  }
  return configured;
}

function aesKey(): Promise<CryptoKey> {
  if (!globalForPool.crossfireAesKey) {
    globalForPool.crossfireAesKey = (async () => {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        encoder.encode(`crossfire:aes:${poolSecret()}`),
      );
      return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
        "encrypt",
        "decrypt",
      ]);
    })();
  }
  return globalForPool.crossfireAesKey;
}

function fingerprintKey(): Promise<CryptoKey> {
  if (!globalForPool.crossfireFingerprintKey) {
    globalForPool.crossfireFingerprintKey = (async () => {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        encoder.encode(`crossfire:fingerprint:${poolSecret()}`),
      );
      return crypto.subtle.importKey("raw", digest, { name: "HMAC", hash: "SHA-256" }, false, [
        "sign",
      ]);
    })();
  }
  return globalForPool.crossfireFingerprintKey;
}

async function encryptKey(key: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await aesKey(),
    encoder.encode(key),
  );
  return ["v1", encodeBase64Url(iv), encodeBase64Url(new Uint8Array(encrypted))].join(".");
}

async function decryptKey(payload: string): Promise<string> {
  const [version, ivPart, dataPart] = payload.split(".");
  if (version !== "v1" || !ivPart || !dataPart) {
    throw new Error("The stored pool key is unreadable.");
  }
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: decodeBase64Url(ivPart) },
      await aesKey(),
      decodeBase64Url(dataPart),
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    throw new Error("The stored pool key is unreadable.");
  }
}

async function fingerprint(key: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await fingerprintKey(),
    encoder.encode(key),
  );
  return encodeBase64Url(new Uint8Array(signature));
}

function keyHint(key: string): string {
  return `â€¦${key.slice(-4)}`;
}

function cleanContributor(value: unknown): string | null {
  const clean = String(value ?? "")
    .replace(/[^\p{L}\p{N} ._@-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 32);
  return clean || null;
}

export function publicLabel(value: unknown): string | null {
  const clean = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);
  // OpenRouter lets a key's label be the key itself, sometimes masked.
  // Never publish even a partial key through the pool snapshot.
  if (!clean || /^sk-[A-Za-z0-9._-]+$/i.test(clean)) return null;
  return clean;
}

async function inspectKey(key: string): Promise<{ label: string | null }> {
  let response: Response;
  try {
    response = await fetch(OPENROUTER_KEY_URL, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch {
    throw new PoolError("OpenRouter did not answer the key check. Try again in a moment.", 502);
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new PoolError("OpenRouter rejected that key.", 400);
    }
    throw new PoolError(`OpenRouter returned ${response.status} while checking the key.`, 502);
  }

  let body: { data?: { label?: unknown; is_free_tier?: unknown; free_model_daily_requests?: unknown } };
  try {
    body = (await response.json()) as typeof body;
  } catch {
    throw new PoolError("OpenRouter returned an unreadable key check.", 502);
  }

  const data = body.data ?? {};
  const hasFreeLimit = Boolean(data.free_model_daily_requests);
  if (data.is_free_tier !== true && !hasFreeLimit) {
    throw new PoolError(
      "Only free-tier keys can join this pool. Paid keys are not accepted.",
      400,
    );
  }

  return {
    label: publicLabel(data.label) ?? (data.is_free_tier === true ? "Free tier" : "Free models"),
  };
}

export function noteContributionAttempt(): void {
  const now = Date.now();
  const recent = (globalForPool.crossfireContributionTimes ?? []).filter(
    (time) => now - time < 60 * 60 * 1000,
  );
  if (recent.length >= 10) {
    throw new PoolError("The pool has received too many contributions this hour. Try later.", 429);
  }
  if (recent.length && now - recent[recent.length - 1] < 2500) {
    throw new PoolError("Wait a few seconds before contributing another key.", 429);
  }
  recent.push(now);
  globalForPool.crossfireContributionTimes = recent;
}

export async function contributePoolKey(input: {
  key: unknown;
  contributor?: unknown;
}): Promise<{ key: PublicPoolKey; pool: PoolSnapshot }> {
  const key = normalizeKey(input.key);
  if (!validKeyShape(key)) {
    throw new PoolError("That does not look like an OpenRouter key.", 400);
  }

  const counts = await countPoolKeys();
  if (counts.total >= MAX_POOL_KEYS) {
    throw new PoolError(`The public pool is full (${MAX_POOL_KEYS} keys).`, 409);
  }

  const hash = await fingerprint(key);
  if (await findPoolKeyByFingerprint(hash)) {
    throw new PoolError("That key is already in the public pool.", 409);
  }

  const info = await inspectKey(key);
  const stored = await insertPoolKey({
    fingerprint: hash,
    hint: keyHint(key),
    label: info.label,
    contributor: cleanContributor(input.contributor),
    encryptedKey: await encryptKey(key),
  });

  return { key: stored, pool: await getPoolSnapshot() };
}

export interface PoolSnapshot {
  total: number;
  active: number;
  capacity: number;
  keys: PublicPoolKey[];
}

export async function getPoolSnapshot(): Promise<PoolSnapshot> {
  const [counts, keys] = await Promise.all([countPoolKeys(), listPublicPoolKeys()]);
  return {
    total: counts.total,
    active: counts.active,
    capacity: MAX_POOL_KEYS,
    keys: keys
      .filter((key) => key.status === "active")
      // Older rows may have stored a key-like provider label before the
      // insert check existed. Sanitize on read as well.
      .map((key) => ({ ...key, label: publicLabel(key.label) })),
  };
}

export interface KeyCandidate {
  id: string | null;
  key: string;
  source: "owner" | "community";
  hint: string;
}

export async function getKeyCandidates(): Promise<KeyCandidate[]> {
  const candidates: KeyCandidate[] = [];
  const seen = new Set<string>();
  const owner = normalizeKey(process.env.OPENROUTER_API_KEY);
  if (owner) {
    seen.add(owner);
    candidates.push({ id: null, key: owner, source: "owner", hint: keyHint(owner) });
  }

  for (const stored of await listStoredPoolKeys()) {
    if (stored.status !== "active") continue;
    try {
      const key = await decryptKey(stored.encryptedKey);
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        id: stored.id,
        key,
        source: "community",
        hint: stored.hint,
      });
    } catch {
      await markPoolKeyStatus(stored.id, "invalid", "The stored key could not be decrypted.");
    }
  }

  return candidates;
}

export async function getPoolProbeKey(): Promise<KeyCandidate | null> {
  return (await getKeyCandidates()).find((candidate) => candidate.source === "community") ?? null;
}

export async function noteCandidateUsed(candidate: KeyCandidate): Promise<void> {
  if (candidate.id) await markPoolKeyUsed(candidate.id);
}

export async function noteCandidateRejected(candidate: KeyCandidate): Promise<void> {
  if (candidate.id) {
    await markPoolKeyStatus(candidate.id, "invalid", "OpenRouter rejected this key.");
  }
}
