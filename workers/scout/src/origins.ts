/** Browser origins allowed to call the Worker (CORS) and to receive OAuth redirects. */

export const DEFAULT_ALLOWED_ORIGINS = "http://localhost:3000,https://3zmd95-glitch.github.io";

export function allowedOrigins(env: { ALLOWED_ORIGINS?: string }): string[] {
  return (env.ALLOWED_ORIGINS ?? DEFAULT_ALLOWED_ORIGINS)
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

/** Whether `url` is an http(s) URL on one of the allowed origins. */
export function isAllowedReturnTo(url: string, env: { ALLOWED_ORIGINS?: string }): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    return allowedOrigins(env).includes(u.origin);
  } catch {
    return false;
  }
}
