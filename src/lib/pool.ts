import fs from "node:fs";
import path from "node:path";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";
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
const DATA_DIR = path.join(process.cwd(), "data");
const SECRET_FILE = path.join(DATA_DIR, "pool.secret");

const globalForPool = globalThis as unknown as {
  crossfirePoolSecret?: Buffer;
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

/**
 * The local secret is generated once and kept beside the database. A hosted
 * deployment should set CROSSFIRE_POOL_SECRET in its server environment.
 */
function getSecret(): Buffer {
  if (globalForPool.crossfirePoolSecret) return globalForPool.crossfirePoolSecret;

  const configured = process.env.CROSSFIRE_POOL_SECRET?.trim();
  if (configured) {
    globalForPool.crossfirePoolSecret = createHash("sha256").update(configured).digest();
    return globalForPool.crossfirePoolSecret;
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  let raw = "";
  try {
    raw = fs.readFileSync(SECRET_FILE, "utf8").trim();
  } catch {
    // Generated below.
  }
  if (raw.length < 32) {
    raw = randomBytes(32).toString("hex");
    fs.writeFileSync(SECRET_FILE, raw, { encoding: "utf8", mode: 0o600 });
  }
  globalForPool.crossfirePoolSecret = createHash("sha256").update(raw).digest();
  return globalForPool.crossfirePoolSecret;
}

function encryptKey(key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getSecret(), iv);
  const encrypted = Buffer.concat([cipher.update(key, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decryptKey(payload: string): string {
  const [version, ivPart, tagPart, dataPart] = payload.split(".");
  if (version !== "v1" || !ivPart || !tagPart || !dataPart) {
    throw new Error("The stored pool key is unreadable.");
  }
  const decipher = createDecipheriv("aes-256-gcm", getSecret(), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function fingerprint(key: string): string {
  return createHmac("sha256", getSecret()).update(key).digest("hex");
}

function keyHint(key: string): string {
  return `…${key.slice(-4)}`;
}

function cleanContributor(value: unknown): string | null {
  const clean = String(value ?? "")
    .replace(/[^\p{L}\p{N} ._@-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 32);
  return clean || null;
}

function cleanLabel(value: unknown): string | null {
  const clean = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);
  return clean || null;
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
    label: cleanLabel(data.label) ?? (data.is_free_tier === true ? "Free tier" : "Free models"),
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

  const counts = countPoolKeys();
  if (counts.total >= MAX_POOL_KEYS) {
    throw new PoolError(`The public pool is full (${MAX_POOL_KEYS} keys).`, 409);
  }

  const hash = fingerprint(key);
  if (findPoolKeyByFingerprint(hash)) {
    throw new PoolError("That key is already in the public pool.", 409);
  }

  const info = await inspectKey(key);
  const stored = insertPoolKey({
    fingerprint: hash,
    hint: keyHint(key),
    label: info.label,
    contributor: cleanContributor(input.contributor),
    encryptedKey: encryptKey(key),
  });

  return { key: stored, pool: getPoolSnapshot() };
}

export interface PoolSnapshot {
  total: number;
  active: number;
  capacity: number;
  keys: PublicPoolKey[];
}

export function getPoolSnapshot(): PoolSnapshot {
  const counts = countPoolKeys();
  return {
    total: counts.total,
    active: counts.active,
    capacity: MAX_POOL_KEYS,
    keys: listPublicPoolKeys().filter((key) => key.status === "active"),
  };
}

export interface KeyCandidate {
  id: string | null;
  key: string;
  source: "owner" | "community";
  hint: string;
}

export function getKeyCandidates(): KeyCandidate[] {
  const candidates: KeyCandidate[] = [];
  const seen = new Set<string>();
  const owner = normalizeKey(process.env.OPENROUTER_API_KEY);
  if (owner) {
    seen.add(owner);
    candidates.push({ id: null, key: owner, source: "owner", hint: keyHint(owner) });
  }

  for (const stored of listStoredPoolKeys()) {
    if (stored.status !== "active") continue;
    try {
      const key = decryptKey(stored.encryptedKey);
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        id: stored.id,
        key,
        source: "community",
        hint: stored.hint,
      });
    } catch {
      markPoolKeyStatus(stored.id, "invalid", "The stored key could not be decrypted.");
    }
  }

  return candidates;
}

export function getPoolProbeKey(): KeyCandidate | null {
  return getKeyCandidates().find((candidate) => candidate.source === "community") ?? null;
}

export function noteCandidateUsed(candidate: KeyCandidate): void {
  if (candidate.id) markPoolKeyUsed(candidate.id);
}

export function noteCandidateRejected(candidate: KeyCandidate): void {
  if (candidate.id) {
    markPoolKeyStatus(candidate.id, "invalid", "OpenRouter rejected this key.");
  }
}
