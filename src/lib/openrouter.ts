import { FALLBACK_MODELS } from "@/lib/agents";
import { sanitizeErrorText } from "@/lib/utils";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const KEY_URL = "https://openrouter.ai/api/v1/key";
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
  process.env.SITE_URL?.trim() ||
  "https://site-2a4337a8b0494c409d081c6612ae611d.freebuff.page";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Jittered delay for retrying an upstream provider. */
export function retryDelayMs(attempt: number, retryAfterMs?: number | null): number {
  if (retryAfterMs && retryAfterMs > 0) return Math.min(4_000, retryAfterMs);
  const base = Math.min(2_000, 300 * 2 ** Math.max(0, attempt));
  return base + Math.floor(Math.random() * 250);
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenRouterKeyStatus {
  configured: boolean;
  label?: string;
  isFreeTier?: boolean;
  usage?: number;
  freeRequests?: {
    used: number;
    limit: number;
    remaining: number;
  };
  error?: string;
}

export class OpenRouterError extends Error {
  status: number;
  details: string;
  retryAfterMs: number | null;

  constructor(message: string, status = 500, details = "", retryAfterMs: number | null = null) {
    super(message);
    this.name = "OpenRouterError";
    this.status = status;
    this.details = details;
    this.retryAfterMs = retryAfterMs;
  }
}


function getKey(): string {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) {
    throw new OpenRouterError(
      "No OpenRouter key is configured. Set OPENROUTER_API_KEY as a server secret.",
      401,
    );
  }
  return key;
}

export function getOwnerKey(): string | null {
  return process.env.OPENROUTER_API_KEY?.trim() || null;
}

function headers(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": SITE_URL,
    "X-Title": "Crossfire Debate",
  };
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join("");
  }
  return "";
}

function parseErrorBody(raw: string, status: number, retryAfterMs: number | null = null): OpenRouterError {
  let message = "The model provider returned an error.";
  try {
    const parsed = JSON.parse(raw);
    message = parsed?.error?.message ?? message;
    const providerCode = parsed?.error?.metadata?.provider_error_code;
    const rawDetail = parsed?.error?.metadata?.raw;
    if (rawDetail) message = `${message} ${String(rawDetail).slice(0, 220)}`;
    if (providerCode) message += ` (${providerCode})`;
  } catch {
    if (raw) message = raw.slice(0, 280);
  }
  return new OpenRouterError(sanitizeErrorText(message), status, raw.slice(0, 1000), retryAfterMs);
}

function retryAfterFrom(response: Response): number | null {
  const header = response.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}


export async function checkKeyStatus(): Promise<OpenRouterKeyStatus> {
  if (!getOwnerKey()) {
    return { configured: false, error: "OPENROUTER_API_KEY is not set." };
  }
  return checkKeyStatusForKey(getKey());
}

export async function checkKeyStatusForKey(apiKey: string): Promise<OpenRouterKeyStatus> {
  try {
    const response = await fetch(KEY_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });
    const body = await response.json();
    if (!response.ok) {
      return {
        configured: false,
        error: sanitizeErrorText(body?.error?.message ?? "Could not verify the key."),
      };
    }
    const data = body?.data ?? {};
    // Some keys use a masked version of the key as their label. Keep the
    // provider status endpoint from echoing even a partial key to clients.
    const rawLabel = typeof data.label === "string" ? data.label.trim() : "";
    const label =
      rawLabel && !/^sk-[A-Za-z0-9._-]+$/i.test(rawLabel)
        ? sanitizeErrorText(rawLabel, 60)
        : undefined;
    return {
      configured: true,
      label,
      isFreeTier: data.is_free_tier,
      usage: data.usage,
      freeRequests: data.free_model_daily_requests,
    };
  } catch (error) {
    return {
      configured: false,
      error: sanitizeErrorText(
        error instanceof Error ? error.message : "Could not reach OpenRouter.",
      ),
    };
  }
}

export interface StreamOptions {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  apiKey?: string;
  onFinish?: (reason: string) => void;
}

export async function* streamChat(options: StreamOptions): AsyncGenerator<string, void, unknown> {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: headers(options.apiKey ?? getKey()),
    signal: options.signal,
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      max_tokens: options.maxTokens ?? 1400,
      temperature: options.temperature ?? 0.8,
      reasoning: { effort: "low", exclude: true },
      stream: true,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const raw = await response.text();
    throw parseErrorBody(raw, response.status, retryAfterFrom(response));
  }
  if (!response.body) {
    throw new OpenRouterError("The provider returned an empty stream.", 502);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        let event: unknown;
        try {
          event = JSON.parse(data);
        } catch {
          continue;
        }
        const payload = event as {
          error?: { message?: string; code?: number };
          choices?: Array<{ delta?: { content?: unknown }; finish_reason?: string }>;
        };
        if (payload.error) {
          throw new OpenRouterError(
            sanitizeErrorText(payload.error.message ?? "The provider returned an error mid-stream."),
            payload.error.code ?? 502,
          );
        }
        const choice = payload.choices?.[0];
        const delta = choice?.delta;
        const text = contentToText(delta?.content);
        if (text) yield text;
        if (choice?.finish_reason && options.onFinish) {
          options.onFinish(String(choice.finish_reason));
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function completeChat(options: {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  apiKey?: string;
}): Promise<string> {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: headers(options.apiKey ?? getKey()),
    signal: options.signal,
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      max_tokens: options.maxTokens ?? 2400,
      temperature: options.temperature ?? 0.2,
      reasoning: { effort: "low", exclude: true },
      stream: false,
    }),
    cache: "no-store",
  });

  const raw = await response.text();
  if (!response.ok) {
    throw parseErrorBody(raw, response.status, retryAfterFrom(response));
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new OpenRouterError("The provider returned an unreadable response.", 502, raw.slice(0, 500));
  }
  const content = contentToText(
    (body as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content,
  );
  if (!content.trim()) {
    throw new OpenRouterError("The model returned no text. It may have spent its budget on reasoning.", 502);
  }
  return content.trim();
}

export function fallbackChain(primary: string, options?: { avoid?: string[] }): string[] {
  const avoid = new Set(options?.avoid ?? []);
  const seen = new Set<string>();
  const chain: string[] = [];
  const rest = [primary, ...FALLBACK_MODELS];
  // Keep the room diverse: try free models nobody else in the debate is using
  // before collapsing two speakers onto the same model.
  const ordered = [
    ...rest.filter((model) => model === primary || !avoid.has(model)),
    ...rest.filter((model) => model !== primary && avoid.has(model)),
  ];
  for (const model of ordered) {
    if (!seen.has(model)) {
      seen.add(model);
      chain.push(model);
    }
  }
  return chain;
}

export type OpenRouterErrorKind = "auth" | "quota" | "rate-limit" | "server" | "other";

export function errorKind(error: unknown): OpenRouterErrorKind {
  if (!(error instanceof OpenRouterError)) return "other";
  if (error.status === 401 || error.status === 403) return "auth";
  if (error.status === 402) return "quota";
  if (error.status === 429) return "rate-limit";
  if (error.status >= 500 || error.status === 408) return "server";
  return "other";
}

export function isTransient(error: unknown): boolean {
  const kind = errorKind(error);
  return kind === "rate-limit" || kind === "server" || kind === "quota";
}

export function isRetryable(error: unknown): boolean {
  const kind = errorKind(error);
  return kind === "auth" || kind === "quota" || kind === "rate-limit" || kind === "server";
}
