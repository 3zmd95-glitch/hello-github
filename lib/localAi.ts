/** Nonsecret choices only. Subscription credentials stay in the local runtime. */
export type SubscriptionProvider = "chatgpt" | "claude";
export interface AiSelection {
  provider: SubscriptionProvider;
  model: string;
  effort?: string;
  accountId?: string;
}
export interface AiChoice {
  provider: "builtin" | SubscriptionProvider;
  model: string;
  effort?: string;
  accountId?: string;
}
export interface LocalModel {
  id: string;
  name: string;
  efforts?: string[];
}
export interface LocalProviderStatus {
  connected: boolean;
  sharing?: boolean;
  connecting?: boolean;
  account?: string;
  accountId?: string;
  models: LocalModel[];
  error?: string;
}
export interface LocalAiStatus {
  available: true;
  providers: Record<SubscriptionProvider, LocalProviderStatus>;
}
export interface SubscriptionPlan {
  provider: SubscriptionProvider;
  model: string;
  effort?: string;
  plan: Record<string, unknown>;
}

function providerStatusValid(value: unknown): value is LocalProviderStatus {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.connected === "boolean" &&
    ["sharing", "connecting"].every(
      (key) => item[key] === undefined || typeof item[key] === "boolean",
    ) &&
    ["account", "accountId", "error"].every(
      (key) => item[key] === undefined || typeof item[key] === "string",
    ) &&
    Array.isArray(item.models) &&
    item.models.every(
      (model) =>
        model &&
        typeof model === "object" &&
        typeof model.id === "string" &&
        typeof model.name === "string" &&
        (model.efforts === undefined ||
          (Array.isArray(model.efforts) &&
            model.efforts.every((effort: unknown) => typeof effort === "string"))),
    )
  );
}

export function isLocalAiHost(): boolean {
  return (
    typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname)
  );
}

export async function localAiStatus(): Promise<LocalAiStatus | null> {
  if (!isLocalAiHost()) return null;
  try {
    const response = await fetch("/api/local-ai/status", {
      cache: "no-store",
      headers: { "X-Local-AI": "1" },
      signal: AbortSignal.timeout(70_000),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.available === true &&
      providerStatusValid(data.providers?.chatgpt) &&
      providerStatusValid(data.providers?.claude)
      ? (data as LocalAiStatus)
      : null;
  } catch {
    return null;
  }
}

export async function localAiConnection(
  action: "connect" | "disconnect",
  provider: SubscriptionProvider,
): Promise<boolean> {
  if (!isLocalAiHost()) return false;
  try {
    const response = await fetch(`/api/local-ai/${action}/${provider}`, {
      method: "POST",
      headers: { "X-Local-AI": "1", "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(70_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function highestEffort(efforts?: string[]): string | undefined {
  return ["ultra", "max", "xhigh", "high", "medium", "low", "minimal", "none"].find((effort) =>
    efforts?.includes(effort),
  );
}

export type SubscriptionError =
  | "local_ai_unavailable"
  | "subscription_auth"
  | "subscription_limit"
  | "subscription_model"
  | "subscription_failed";

export function subscriptionError(code: unknown): SubscriptionError {
  if (typeof code !== "string") return "subscription_failed";
  if (/limit|quota|budget|usage_unavailable/.test(code)) return "subscription_limit";
  if (/auth|connect|login|sharing|scope|token|sign_in|account_changed/.test(code))
    return "subscription_auth";
  if (/model|effort/.test(code)) return "subscription_model";
  return "subscription_failed";
}

export async function subscriptionPlan(
  selection: AiSelection,
  request: { q: string; genreQuery?: { ar?: string; en?: string }; program?: string },
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<
  { ok: true; data: SubscriptionPlan } | { ok: false; error: { type: SubscriptionError } }
> {
  try {
    const response = await fetchImpl("/api/local-ai/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Local-AI": "1" },
      body: JSON.stringify({
        ...selection,
        request: {
          q: request.q,
          genreQuery: request.genreQuery,
          program: request.program,
        },
      }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(190_000)])
        : AbortSignal.timeout(190_000),
    });
    if (!response.headers.get("content-type")?.includes("application/json"))
      return { ok: false, error: { type: "local_ai_unavailable" } };
    const data = await response.json();
    if (!response.ok) return { ok: false, error: { type: subscriptionError(data?.error) } };
    if (
      data?.provider !== selection.provider ||
      data.model !== selection.model ||
      data.effort !== selection.effort ||
      !data.plan ||
      typeof data.plan !== "object" ||
      Array.isArray(data.plan)
    )
      return { ok: false, error: { type: "subscription_failed" } };
    return { ok: true, data };
  } catch {
    return { ok: false, error: { type: "local_ai_unavailable" } };
  }
}
