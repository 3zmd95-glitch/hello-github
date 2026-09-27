/**
 * Outbound HTTP for the platform modules: a subrequest budget (the free plan allows 50 subrequests per
 * invocation, KV operations included) and small JSON helpers that turn transport failures into
 * `SocialError("upstream")`.
 */

import { SocialError } from "./types";

/** Counts the outbound calls one sync may still make; optional calls check `ok` before spending. */
export class Budget {
  constructor(public left: number) {}
  get ok(): boolean {
    return this.left > 0;
  }
  /** Spends one call; throws `upstream` when nothing is left (required calls only). */
  take(): void {
    if (this.left <= 0) throw new SocialError("upstream", "subrequest budget exhausted");
    this.left -= 1;
  }
}

export interface Http {
  fetch: typeof fetch;
  budget: Budget;
}

export interface JsonReply<T> {
  status: number;
  ok: boolean;
  /** Parsed body, or null when it was not JSON. */
  body: T | null;
}

/** One budgeted call whose body is parsed as JSON (never throws on HTTP errors, only on transport ones). */
export async function fetchJson<T>(
  http: Http,
  url: string,
  init?: RequestInit,
): Promise<JsonReply<T>> {
  http.budget.take();
  let res: Response;
  try {
    res = await http.fetch(url, init);
  } catch {
    throw new SocialError("upstream", `fetch failed: ${new URL(url).host}`);
  }
  let body: T | null = null;
  try {
    body = (await res.json()) as T;
  } catch {
    body = null;
  }
  return { status: res.status, ok: res.ok, body };
}

/** `application/x-www-form-urlencoded` POST. */
export function formPost(params: Record<string, string>): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(params).toString(),
  };
}

export function bearer(token: string, extra?: Record<string, string>): HeadersInit {
  return { Authorization: `Bearer ${token}`, Accept: "application/json", ...extra };
}

/** `url` with `params` appended (undefined values skipped). */
export function withQuery(
  url: string,
  params: Record<string, string | number | undefined>,
): string {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params))
    if (v !== undefined) u.searchParams.set(k, String(v));
  return u.toString();
}

/** A non-negative integer from anything the APIs send (numbers, numeric strings), else 0. */
export function int(x: unknown): number {
  const n = typeof x === "string" ? Number(x) : typeof x === "number" ? x : 0;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** A non-negative number rounded to 2 decimals, else 0. */
export function num2(x: unknown): number {
  const n = typeof x === "string" ? Number(x) : typeof x === "number" ? x : 0;
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

/** Percent shares (2 decimals) of a list of counts; empty when the total is 0. */
export function percentages<K>(rows: { key: K; value: number }[]): { key: K; pct: number }[] {
  const total = rows.reduce((s, r) => s + r.value, 0);
  if (total <= 0) return [];
  return rows.map((r) => ({ key: r.key, pct: Math.round((r.value / total) * 10_000) / 100 }));
}

/** The first line of a caption/title, at most `max` characters; undefined when empty. */
export function clip(text: unknown, max = 120): string | undefined {
  if (typeof text !== "string") return undefined;
  const line = text.trim().split(/\r?\n/)[0]?.trim() ?? "";
  if (!line) return undefined;
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Mean of the numbers, 2 decimals; undefined for an empty list. */
export function mean2(xs: number[]): number | undefined {
  if (!xs.length) return undefined;
  return Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 100) / 100;
}

/** Removes `undefined` fields so stored rows stay compact and equal to what the dashboard receives. */
export function compact<T extends object>(row: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (v !== undefined) out[k] = v;
  return out as T;
}
