/**
 * Token encryption and OAuth randomness.
 *
 * Tokens rest in KV encrypted with AES-256-GCM. The key is derived from SCOUT_TOKEN (the only secret the
 * Worker and the dashboard share) with HKDF-SHA-256, so rotating SCOUT_TOKEN also invalidates every stored
 * token (the owner then reconnects). Format: `v1.<base64url iv>.<base64url ciphertext>`.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

const HKDF_SALT = "3z-scout/social-tokens";
const HKDF_INFO = "aes-256-gcm/v1";

export function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (const b of u8) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** `n` random bytes as base64url (state nonces, PKCE verifiers). */
export function randomToken(n = 32): string {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/** PKCE S256: base64url(SHA-256(verifier)). */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(verifier));
  return toBase64Url(digest);
}

const keyCache = new Map<string, Promise<CryptoKey>>();

async function deriveKey(secret: string): Promise<CryptoKey> {
  let p = keyCache.get(secret);
  if (!p) {
    p = (async () => {
      const raw = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, [
        "deriveKey",
      ]);
      return crypto.subtle.deriveKey(
        {
          name: "HKDF",
          hash: "SHA-256",
          salt: enc.encode(HKDF_SALT),
          info: enc.encode(HKDF_INFO),
        },
        raw,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );
    })();
    keyCache.set(secret, p);
  }
  return p;
}

export async function encryptJson(secret: string, value: unknown): Promise<string> {
  const key = await deriveKey(secret);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(JSON.stringify(value)),
  );
  return `v1.${toBase64Url(iv)}.${toBase64Url(ct)}`;
}

/** Returns null when the blob is malformed or was sealed with another secret. */
export async function decryptJson<T>(secret: string, blob: string): Promise<T | null> {
  const [v, ivB64, ctB64] = blob.split(".");
  if (v !== "v1" || !ivB64 || !ctB64) return null;
  try {
    const key = await deriveKey(secret);
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64Url(ivB64) },
      key,
      fromBase64Url(ctB64),
    );
    return JSON.parse(dec.decode(pt)) as T;
  } catch {
    return null;
  }
}
