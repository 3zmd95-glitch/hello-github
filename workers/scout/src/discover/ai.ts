import { z } from "zod";
import type { FetchEnv } from "./fetchers";
import type { DiscoverRequest, SearchPlan } from "./types";
import { AI_SYSTEM, AiPlanSchema, searchPlanFromAi } from "./ai-plan";
import { aiSearchInput } from "./ai-schema";
export { AiPlanSchema } from "./ai-plan";

export const AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
export const AI_DAILY_LIMIT = 20;
export const AI_TIMEOUT_MS = 20_000;

export interface SearchAiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export class SearchAiError extends Error {
  constructor(public code: "ai_unavailable" | "ai_limit") {
    super(code);
  }
}

const RESPONSE_SCHEMA = z.toJSONSchema(AiPlanSchema);

const pending = new Map<string, Promise<z.infer<typeof AiPlanSchema>>>();

export async function planWithAi(
  env: FetchEnv,
  req: DiscoverRequest,
  hash: string,
  now: Date,
  timeoutMs = AI_TIMEOUT_MS,
): Promise<SearchPlan> {
  if (!env.AI || !env.SOCIAL_KV) throw new SearchAiError("ai_unavailable");
  const cacheKey = `discover:ai-plan:v2:${hash}`;
  const get = async () => {
    try {
      const cached = await env.SOCIAL_KV!.get(cacheKey, "text");
      if (cached) {
        const parsed = AiPlanSchema.safeParse(JSON.parse(cached));
        if (parsed.success) return parsed.data;
      }
    } catch {
      /* A malformed cache is not a plan. Budget reads below fail closed. */
    }
    const budgetKey = `discover:ai:${now.toISOString().slice(0, 10)}`;
    try {
      const raw = await env.SOCIAL_KV!.get(budgetKey, "text");
      const used = raw === null ? 0 : Number(raw);
      if (!Number.isSafeInteger(used) || used < 0) throw new SearchAiError("ai_unavailable");
      if (used >= AI_DAILY_LIMIT) throw new SearchAiError("ai_limit");
      // Best effort across Worker instances (KV isn't atomic), as with the existing YouTube cap.
      await env.SOCIAL_KV!.put(budgetKey, String(used + 1), { expirationTtl: 172_800 });
    } catch (error) {
      throw error instanceof SearchAiError ? error : new SearchAiError("ai_unavailable");
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        env.AI!.run(AI_MODEL, {
          messages: [
            { role: "system", content: AI_SYSTEM },
            {
              role: "user",
              content: aiSearchInput(req),
            },
          ],
          response_format: { type: "json_schema", json_schema: RESPONSE_SCHEMA },
          max_tokens: 900,
          temperature: 0.1,
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new SearchAiError("ai_unavailable")), timeoutMs);
        }),
      ]);
      const response = (result as { response?: unknown })?.response;
      const parsed = AiPlanSchema.parse(
        typeof response === "string" ? JSON.parse(response) : response,
      );
      await env
        .SOCIAL_KV!.put(cacheKey, JSON.stringify(parsed), { expirationTtl: 86_400 })
        .catch(() => undefined);
      return parsed;
    } catch {
      throw new SearchAiError("ai_unavailable");
    } finally {
      clearTimeout(timer);
    }
  };
  let running = pending.get(cacheKey);
  if (!running) {
    running = get();
    pending.set(cacheKey, running);
    void running
      .finally(() => {
        if (pending.get(cacheKey) === running) pending.delete(cacheKey);
      })
      .catch(() => undefined);
  }
  return searchPlanFromAi(req, await running);
}
