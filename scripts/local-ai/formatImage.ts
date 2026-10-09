import { instagramImageUrl } from "../../workers/scout/src/instagramPreview";
import { LocalAiProviderError } from "./types";

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export async function fetchFormatImage(
  input: string,
  doFetch: typeof fetch,
  signal: AbortSignal,
): Promise<{ mime: "image/jpeg" | "image/png" | "image/webp"; bytes: Buffer }> {
  let url = instagramImageUrl(input);
  if (!url) throw new LocalAiProviderError("source_image_unavailable");
  const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(12_000)]);
  for (let hop = 0; hop <= 3; hop++) {
    const response: Response = await doFetch(url, {
      redirect: "manual",
      signal: boundedSignal,
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: { Accept: "image/jpeg,image/png,image/webp" },
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      const next: string | null = response.headers.get("location");
      url = next ? instagramImageUrl(new URL(next, url).href) : undefined;
      if (!url || hop === 3) throw new LocalAiProviderError("source_image_unavailable");
      continue;
    }
    const mime = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (
      !response.ok ||
      !response.body ||
      !["image/jpeg", "image/png", "image/webp"].includes(mime ?? "") ||
      Number(response.headers.get("content-length")) > MAX_IMAGE_BYTES
    ) {
      await response.body?.cancel();
      throw new LocalAiProviderError("source_image_unavailable");
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        boundedSignal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_IMAGE_BYTES) throw new LocalAiProviderError("source_image_unavailable");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    const bytes = Buffer.concat(chunks);
    const valid =
      mime === "image/jpeg"
        ? bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : mime === "image/png"
          ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : bytes.length > 12 &&
            bytes.toString("ascii", 0, 4) === "RIFF" &&
            bytes.toString("ascii", 8, 12) === "WEBP";
    if (!valid) throw new LocalAiProviderError("source_image_unavailable");
    return { mime: mime as "image/jpeg" | "image/png" | "image/webp", bytes };
  }
  throw new LocalAiProviderError("source_image_unavailable");
}
