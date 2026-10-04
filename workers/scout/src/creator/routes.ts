import { CreatorError, generateCreatorDraft, type CreatorEnv } from "./ai";
import { CreatorRequestSchema } from "./schema";

const MAX_BYTES = 32_768;
function reply(body: unknown, status: number, cors: Headers): Response {
  const headers = new Headers(cors);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

/** Called only after the router's owner-token check. No secrets/credentials enter the model. */
export async function handleCreator(
  req: Request,
  env: CreatorEnv,
  cors: Headers,
  deps: { now?: () => Date; waitUntil?: (task: Promise<unknown>) => void } = {},
): Promise<Response | null> {
  if (new URL(req.url).pathname !== "/creator/draft") return null;
  if (req.method !== "POST") return reply({ error: "method_not_allowed" }, 405, cors);
  let raw: unknown;
  try {
    if (!req.body || Number(req.headers.get("Content-Length")) > MAX_BYTES) throw new Error();
    const reader = req.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let text = "";
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BYTES) {
        await reader.cancel();
        throw new Error();
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    raw = JSON.parse(text + decoder.decode());
  } catch {
    return reply({ error: "bad_request" }, 400, cors);
  }
  const request = CreatorRequestSchema.safeParse(raw);
  if (!request.success) return reply({ error: "bad_request" }, 400, cors);
  try {
    return reply(
      {
        draft: await generateCreatorDraft(
          env,
          request.data,
          deps.now?.(),
          undefined,
          deps.waitUntil,
        ),
      },
      200,
      cors,
    );
  } catch (error) {
    const code = error instanceof CreatorError ? error.code : "ai_unavailable";
    return reply({ error: code }, code === "ai_limit" ? 429 : 503, cors);
  }
}
