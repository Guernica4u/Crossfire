import { FALLBACK_MODELS } from "@/lib/agents";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const KEY_URL = "https://openrouter.ai/api/v1/key";

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

  constructor(message: string, status = 500, details = "") {
    super(message);
    this.name = "OpenRouterError";
    this.status = status;
    this.details = details;
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
    "HTTP-Referer": "http://localhost:3000",
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

function parseErrorBody(raw: string, status: number): OpenRouterError {
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
  return new OpenRouterError(message, status, raw.slice(0, 1000));
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
      return { configured: false, error: body?.error?.message ?? "Could not verify the key." };
    }
    const data = body?.data ?? {};
    return {
      configured: true,
      label: data.label,
      isFreeTier: data.is_free_tier,
      usage: data.usage,
      freeRequests: data.free_model_daily_requests,
    };
  } catch (error) {
    return {
      configured: false,
      error: error instanceof Error ? error.message : "Could not reach OpenRouter.",
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
    throw parseErrorBody(raw, response.status);
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
            payload.error.message ?? "The provider returned an error mid-stream.",
            payload.error.code ?? 502,
          );
        }
        const delta = payload.choices?.[0]?.delta;
        const text = contentToText(delta?.content);
        if (text) yield text;
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
    throw parseErrorBody(raw, response.status);
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

export function fallbackChain(primary: string): string[] {
  const seen = new Set<string>();
  const chain: string[] = [];
  for (const model of [primary, ...FALLBACK_MODELS]) {
    if (!seen.has(model)) {
      seen.add(model);
      chain.push(model);
    }
  }
  return chain;
}

export function isRetryable(error: unknown): boolean {
  return (
    error instanceof OpenRouterError &&
    (error.status === 401 || error.status === 402 || error.status === 403 || error.status === 429 || error.status >= 500)
  );
}
