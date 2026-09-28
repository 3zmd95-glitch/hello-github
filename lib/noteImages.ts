import { createStore, get, set, type UseStore } from "idb-keyval";

/**
 * 🖼️ Note images: pasted, dropped or picked pictures are shrunk and kept in this browser's IndexedDB (localStorage
 * is far too small for photos); the note itself only holds `![alt](img:<id>)`. Like the notes, they stay on this
 * device for now and are not part of the JSON export.
 */

/** Longest side kept, in pixels: sharp on a phone and a laptop, a few hundred KB per photo. */
export const NOTE_IMAGE_MAX_SIDE = 1600;

let store: UseStore | null = null;
const db = (): UseStore => (store ??= createStore("3z-prod-notes", "images"));

const newImageId = (): string =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Scale down to NOTE_IMAGE_MAX_SIDE and re-encode (WebP when the browser can, else JPEG; GIF/SVG kept as is). */
async function shrink(file: Blob): Promise<Blob> {
  if (!file.type.startsWith("image/") || /gif|svg/.test(file.type)) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  const scale = Math.min(1, NOTE_IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const encode = (type: string, q?: number) =>
    new Promise<Blob | null>((res) => canvas.toBlob(res, type, q));
  // Safari cannot encode WebP and hands back PNG: fall back to JPEG then.
  const webp = await encode("image/webp", 0.85);
  const out = webp?.type === "image/webp" ? webp : await encode("image/jpeg", 0.85);
  return out && out.size < file.size ? out : file;
}

/** Store an image and return its id. Throws when the file is not an image or storage is blocked. */
export async function saveNoteImage(file: Blob): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("not an image");
  const blob = await shrink(file);
  const id = newImageId();
  await set(id, blob, db());
  return id;
}

/** The stored image, or undefined when this device does not have it (or storage is blocked). */
export async function loadNoteImage(id: string): Promise<Blob | undefined> {
  try {
    return await get<Blob>(id, db());
  } catch {
    return undefined;
  }
}
