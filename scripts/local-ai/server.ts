import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { access, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import handler from "serve-handler";
import { z } from "zod";
import { AI_SYSTEM, AiPlanSchema, aiSearchInput } from "../../workers/scout/src/discover/ai-schema";
import { normalizeTerm } from "../../workers/scout/src/discover/terms";
import { createClaudeProvider } from "./claude";
import { LocalAiProviderError, type LocalAiProvider, type LocalAiProviderStatus } from "./types";

type ProviderName = "chatgpt" | "claude";
type Providers = Record<ProviderName, LocalAiProvider>;
const MAX_BODY = 16_384;
const MAX_PLAN_OUTPUT = 32_768;
const SCHEMA = z.toJSONSchema(AiPlanSchema, { target: "draft-7" });
const RequestSchema = z.strictObject({
  provider: z.enum(["chatgpt", "claude"]),
  model: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/),
  effort: z
    .string()
    .min(1)
    .max(24)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/)
    .optional(),
  accountId: z.string().min(1).max(256).optional(),
  request: z.strictObject({
    q: z
      .string()
      .trim()
      .min(1)
      .max(600)
      .refine((q) => Boolean(normalizeTerm(q))),
    genreQuery: z
      .strictObject({
        ar: z.string().trim().min(1).max(100).optional(),
        en: z.string().trim().min(1).max(100).optional(),
      })
      .optional(),
    program: z.string().trim().min(1).max(60).optional(),
  }),
});
const StatusSchema = z.object({
  connected: z.boolean(),
  sharing: z.boolean().optional(),
  connecting: z.boolean().optional(),
  account: z.string().max(200).optional(),
  accountId: z.string().max(256).optional(),
  models: z
    .array(
      z.object({
        id: z.string().max(120),
        name: z.string().max(160),
        efforts: z.array(z.string().max(24)).max(12).optional(),
      }),
    )
    .max(100),
  error: z
    .string()
    .max(80)
    .regex(/^[a-z][a-z0-9_]*$/)
    .optional(),
});

export interface LocalAiServerOptions {
  rootDir: string;
  providers: Providers;
  planTimeoutMs?: number;
  now?: () => number;
}

function reply(res: ServerResponse, status: number, data: unknown) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
  });
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] ?? ""))
    return Promise.reject(new LocalAiProviderError("invalid_request"));
  const declaredLength = req.headers["content-length"];
  if (declaredLength && Number(declaredLength) > MAX_BODY)
    return Promise.reject(new LocalAiProviderError("request_too_large"));
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    const cleanup = () => {
      clearTimeout(timer);
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
      req.off("aborted", onError);
    };
    const fail = (code: string) => {
      cleanup();
      req.resume();
      reject(new LocalAiProviderError(code));
    };
    const onData = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY) return fail("request_too_large");
      chunks.push(chunk);
    };
    const onError = () => fail("invalid_request");
    const onEnd = () => {
      cleanup();
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new LocalAiProviderError("invalid_request"));
      }
    };
    const timer = setTimeout(() => fail("invalid_request"), 5_000);
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
    req.on("aborted", onError);
  });
}

function safeError(error: unknown): string {
  return error instanceof LocalAiProviderError && /^[a-z][a-z0-9_]{2,79}$/.test(error.code)
    ? error.code
    : "ai_unavailable";
}

async function safeStatus(provider: LocalAiProvider): Promise<LocalAiProviderStatus> {
  try {
    return StatusSchema.parse(await provider.status());
  } catch (error) {
    return { connected: false, models: [], error: safeError(error) };
  }
}

/** Import-safe HTTP factory. Tests inject adapters and bind an ephemeral loopback port. */
export function createLocalAiServer(options: LocalAiServerOptions): Server {
  const now = options.now ?? Date.now;
  const active = new Map<ProviderName, AbortController>();
  const cache = new Map<string, { until: number; value: unknown }>();
  let rateWindow = now();
  let mutations = 0;
  const serve = async (req: IncomingMessage, res: ServerResponse) => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 3000;
    const host = req.headers.host;
    if (host !== `localhost:${port}` && host !== `127.0.0.1:${port}`) {
      reply(res, 403, { error: "forbidden" });
      return;
    }
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== `http://${host}`) {
      reply(res, 403, { error: "forbidden" });
      return;
    }
    const url = new URL(req.url ?? "/", `http://${host}`);
    if (!url.pathname.startsWith("/api/local-ai/")) {
      if (req.method !== "GET" && req.method !== "HEAD") {
        reply(res, 405, { error: "method_not_allowed" });
        return;
      }
      await handler(req, res, {
        public: options.rootDir,
        cleanUrls: true,
        trailingSlash: true,
        directoryListing: false,
        symlinks: false,
        headers: [
          {
            source: "**",
            headers: [
              { key: "Cache-Control", value: "no-cache" },
              { key: "X-Content-Type-Options", value: "nosniff" },
            ],
          },
        ],
      });
      return;
    }
    if (
      req.headers["x-local-ai"] !== "1" ||
      (req.method !== "GET" && origin !== `http://${host}`)
    ) {
      reply(res, 403, { error: "forbidden" });
      return;
    }
    if (url.pathname === "/api/local-ai/status" && req.method === "GET") {
      const [chatgpt, claude] = await Promise.all([
        safeStatus(options.providers.chatgpt),
        safeStatus(options.providers.claude),
      ]);
      reply(res, 200, { available: true, providers: { chatgpt, claude } });
      return;
    }
    if (req.method !== "POST") {
      reply(res, 405, { error: "method_not_allowed" });
      return;
    }
    if (now() - rateWindow > 60_000) {
      rateWindow = now();
      mutations = 0;
    }
    if (++mutations > 30) {
      reply(res, 429, { error: "local_rate_limit" });
      return;
    }
    const connection = url.pathname.match(
      /^\/api\/local-ai\/(connect|disconnect)\/(chatgpt|claude)$/,
    );
    if (connection) {
      const body = await readBody(req);
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length)
        throw new LocalAiProviderError("invalid_request");
      const name = connection[2] as ProviderName;
      if (connection[1] === "disconnect") {
        active.get(name)?.abort();
        cache.clear();
        await options.providers[name].disconnect();
      } else await options.providers[name].connect();
      reply(res, 200, { ok: true });
      return;
    }
    if (url.pathname !== "/api/local-ai/plan") {
      reply(res, 404, { error: "not_found" });
      return;
    }
    const parsed = RequestSchema.safeParse(await readBody(req));
    if (!parsed.success) throw new LocalAiProviderError("invalid_request");
    const body = parsed.data;
    const provider = options.providers[body.provider];
    const status = await safeStatus(provider);
    if (!status.connected || status.sharing !== true)
      throw new LocalAiProviderError("not_connected");
    if (body.accountId && body.accountId !== status.accountId)
      throw new LocalAiProviderError("account_changed");
    const model = status.models.find((item) => item.id === body.model);
    if (!model || (body.effort && !model.efforts?.includes(body.effort)))
      throw new LocalAiProviderError("model_unavailable");
    const key = createHash("sha256")
      .update(JSON.stringify({ ...body, accountId: status.accountId }))
      .digest("hex");
    const hit = cache.get(key);
    if (hit && hit.until > now()) {
      reply(res, 200, hit.value);
      return;
    }
    if (active.has(body.provider)) {
      reply(res, 409, { error: "ai_busy" });
      return;
    }
    const controller = new AbortController();
    active.set(body.provider, controller);
    const disconnected = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.once("close", disconnected);
    const timer = setTimeout(() => controller.abort(), options.planTimeoutMs ?? 185_000);
    try {
      const result = await Promise.race([
        provider.plan({
          model: body.model,
          effort: body.effort,
          instructions: AI_SYSTEM,
          input: aiSearchInput(body.request),
          schema: SCHEMA,
          signal: controller.signal,
        }),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener(
            "abort",
            () => reject(new LocalAiProviderError("ai_timeout")),
            { once: true },
          );
        }),
      ]);
      if (controller.signal.aborted) throw new LocalAiProviderError("cancelled");
      if (result.model !== body.model || Buffer.byteLength(result.text, "utf8") > MAX_PLAN_OUTPUT)
        throw new LocalAiProviderError("invalid_response");
      let plan: z.infer<typeof AiPlanSchema>;
      try {
        plan = AiPlanSchema.parse(JSON.parse(result.text));
      } catch {
        throw new LocalAiProviderError("invalid_response");
      }
      const value = {
        provider: body.provider,
        model: result.model,
        ...(body.effort ? { effort: body.effort } : {}),
        plan,
      };
      if (cache.size >= 64) cache.delete(cache.keys().next().value!);
      cache.set(key, { until: now() + 86_400_000, value });
      reply(res, 200, value);
    } finally {
      clearTimeout(timer);
      res.off("close", disconnected);
      if (active.get(body.provider) === controller) active.delete(body.provider);
    }
  };
  const server = createServer((req, res) => {
    void serve(req, res).catch((error) => {
      const code = safeError(error);
      const status =
        code === "request_too_large"
          ? 413
          : code === "invalid_request"
            ? 400
            : code === "not_connected" || code === "account_changed"
              ? 401
              : code === "ai_limit" || code.includes("usage_limit")
                ? 429
                : code === "model_unavailable"
                  ? 400
                  : code === "ai_timeout"
                    ? 504
                    : 502;
      reply(res, status, { error: code });
    });
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 10_000;
  server.on("close", () => {
    for (const controller of active.values()) controller.abort();
    for (const provider of Object.values(options.providers)) void provider.dispose?.();
  });
  return server;
}

export async function startLocalAiServer(
  options: {
    port?: number;
    rootDir?: string;
    runtimeDir?: string;
    providers?: Providers;
  } = {},
): Promise<Server> {
  const rootDir = path.resolve(options.rootDir ?? "out");
  await access(path.join(rootDir, "index.html"));
  const runtimeDir = options.runtimeDir ?? path.join(os.homedir(), ".3z-prod", "local-ai");
  await mkdir(runtimeDir, { recursive: true, mode: 0o700 });
  const providers = options.providers ?? {
    chatgpt: (await import("./chatgpt")).createChatGptProvider(runtimeDir),
    claude: createClaudeProvider(runtimeDir),
  };
  const server = createLocalAiServer({ rootDir, providers });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 3000, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}
