import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

// Use the exact runtime/bundler shipped with our pinned Wrangler, without another dependency.
const requireRuntime = createRequire(import.meta.resolve("wrangler/package.json"));
const { Miniflare, convertV4MiniflareOptions } = requireRuntime("miniflare");
const { build } = requireRuntime("esbuild");

it("reaches TikTok in workerd and refuses redirects without forwarding its grant", async () => {
  const { outputFiles } = await build({
    stdin: {
      resolveDir: fileURLToPath(new URL(".", import.meta.url)),
      contents: `
        import { probeTikTokAccess } from './tiktokProbe';
        import { acquireTikTok } from './tiktokAcquire';
        import { encryptJson } from '../social/crypto';
        export default { async fetch(request) {
          const owner = 'runtime-owner-test';
          const sealed = await encryptJson(owner, {
            access_token: 'fake-runtime-token', advertiser_ids: ['123456789'],
            connectedAt: '2026-10-11T00:00:00.000Z'
          });
          const env = { SCOUT_TOKEN: owner, SOCIAL_KV: { get: async () => sealed } };
          if (request.url.endsWith('/acquire')) return Response.json(await acquireTikTok(
            new Request('https://worker.test/categories/anime/native/tt/acquire', {method:'POST'}), env, 'anime'));
          return Response.json(await probeTikTokAccess(
            new Request('https://worker.test/categories/anime/native/tt/probe', {method:'POST'}),
            env, 'anime'
          ));
        } };
      `,
    },
    bundle: true,
    format: "esm",
    platform: "browser",
    write: false,
  });
  const outbound: { origin: string; token: string | null }[] = [];
  let redirect = false;
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      compatibilityDate: "2026-09-01",
      script: outputFiles[0].text,
      // Every outbound request is intercepted; this test cannot contact a provider.
      outboundService: (request: Request) => {
        outbound.push({
          origin: new URL(request.url).origin,
          token: request.headers.get("Access-Token"),
        });
        return redirect
          ? new Response(null, { status: 302, headers: { Location: "https://untrusted.test/" } })
          : Response.json({ code: 0, data: { list: [] } });
      },
    }),
  );
  try {
    const accepted = await runtime.dispatchFetch("https://worker.test/");
    expect(await accepted.json()).toMatchObject({
      status: "accepted",
      httpStatus: 200,
      requests: 1,
    });
    expect(outbound).toEqual([
      { origin: "https://business-api.tiktok.com", token: "fake-runtime-token" },
    ]);
    redirect = true;
    const rejected = await runtime.dispatchFetch("https://worker.test/");
    expect(await rejected.json()).toMatchObject({
      status: "upstream",
      httpStatus: 302,
      requests: 1,
    });
    expect(outbound).toEqual([
      { origin: "https://business-api.tiktok.com", token: "fake-runtime-token" },
      { origin: "https://business-api.tiktok.com", token: "fake-runtime-token" },
    ]);
    redirect = false;
    const acquired = await runtime.dispatchFetch("https://worker.test/acquire");
    expect(await acquired.json()).toMatchObject({ status: "accepted", items: [], captioned: 0 });
    expect(outbound).toHaveLength(5);
  } finally {
    await runtime.dispose();
  }
}, 20_000);
