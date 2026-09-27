/**
 * Helpers shared by the two Meta Graph APIs (Instagram API with Instagram Login, Threads API): error
 * mapping, cursor paging, insight values and demographic breakdowns. Both APIs answer with the same shapes.
 */

import { fetchJson, int, percentages, type Http, type JsonReply } from "./http";
import { SocialError, type DemographicRow, type SocialPlatform } from "./types";

export interface MetaError {
  error?: { message?: string; type?: string; code?: number; error_subcode?: number };
}

export interface MetaPage<T> extends MetaError {
  data?: T[];
  paging?: { cursors?: { before?: string; after?: string }; next?: string };
}

/** One insight entry: `total_value` for totals, `values[]` for per-period series. */
export interface MetaInsight {
  name?: string;
  period?: string;
  values?: { value?: number | string; end_time?: string }[];
  total_value?: {
    value?: number | string;
    breakdowns?: {
      dimension_keys?: string[];
      results?: { dimension_values?: string[]; value?: number | string }[];
    }[];
  };
}

/** Graph API error codes that mean "the token is dead, reconnect" and "slow down". */
const EXPIRED_CODES = new Set([190, 102, 10]);
const RATE_CODES = new Set([
  4, 17, 32, 613, 80001, 80002, 80003, 80004, 80005, 80006, 80007, 80008,
]);

/** Throws the matching SocialError when a Graph reply failed; returns the body otherwise. */
export function metaBody<T extends MetaError>(reply: JsonReply<T>, what: string): T {
  const err = reply.body?.error;
  if (reply.ok && reply.body && !err) return reply.body;
  const code = err?.code ?? 0;
  if (reply.status === 401 || EXPIRED_CODES.has(code)) {
    throw new SocialError("token_expired", `${what}: ${err?.message ?? reply.status}`);
  }
  if (reply.status === 429 || RATE_CODES.has(code)) {
    throw new SocialError("rate_limited", `${what}: ${err?.message ?? reply.status}`);
  }
  throw new SocialError("upstream", `${what}: ${err?.message ?? reply.status}`);
}

/**
 * Follows `paging.next` (which already carries the access token) until `maxItems` items or `maxPages`
 * pages are in, or the budget runs out after the first page.
 */
export async function metaList<T>(
  http: Http,
  firstUrl: string,
  what: string,
  maxItems: number,
  maxPages: number,
): Promise<T[]> {
  const items: T[] = [];
  let url: string | undefined = firstUrl;
  for (let page = 0; url && page < maxPages && items.length < maxItems; page++) {
    if (page > 0 && !http.budget.ok) break;
    const body: MetaPage<T> = metaBody(await fetchJson<MetaPage<T>>(http, url), what);
    items.push(...(body.data ?? []));
    url = body.paging?.next;
  }
  return items.slice(0, maxItems);
}

/** The value of one metric in an insights reply: `total_value.value`, else the sum of `values[]`. */
export function metricValue(data: MetaInsight[] | undefined, name: string): number | undefined {
  const entry = data?.find((e) => e.name === name);
  if (!entry) return undefined;
  if (entry.total_value?.value !== undefined) return int(entry.total_value.value);
  if (entry.values?.length) return entry.values.reduce((s, v) => s + int(v.value), 0);
  return undefined;
}

export type Breakdown = "age" | "gender" | "country" | "city";

/** Gender codes Meta uses in demographic breakdowns. */
const GENDER: Record<string, "male" | "female"> = { M: "male", F: "female" };

/**
 * Turns one `follower_demographics` reply (one breakdown) into dashboard rows with `pct` shares. Unknown
 * genders ("U") are left out of the gender rows; age buckets ("18-24", "65+"), ISO-2 country codes and
 * city names pass through as Meta gives them.
 */
export function breakdownRows(
  platform: SocialPlatform,
  day: string,
  breakdown: Breakdown,
  data: MetaInsight[] | undefined,
): DemographicRow[] {
  const results = data?.[0]?.total_value?.breakdowns?.[0]?.results ?? [];
  const counted = results
    .map((r) => ({ key: r.dimension_values?.[0] ?? "", value: int(r.value) }))
    .filter((r) => r.key);
  if (breakdown === "gender") {
    return percentages(
      counted.filter((r) => GENDER[r.key]).map((r) => ({ key: GENDER[r.key], value: r.value })),
    ).map((r) => ({ platform, day, dimension: "gender", key: r.key, pct: r.pct }));
  }
  return percentages(counted).map((r) => ({
    platform,
    day,
    dimension: breakdown,
    key: r.key,
    pct: r.pct,
  }));
}

export const BREAKDOWNS: Breakdown[] = ["age", "gender", "country", "city"];
/** Meta serves audience demographics only for accounts with at least this many followers. */
export const DEMOGRAPHICS_MIN_FOLLOWERS = 100;
