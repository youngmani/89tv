// Minimal client for the 7TV v4 GraphQL API (https://api.7tv.app/v4/gql).
// The endpoint reflects any Origin in its CORS headers, so the browser can call it directly.

import { sleep } from "./util";

export const GQL_ENDPOINT = "https://api.7tv.app/v4/gql";

export class ApiError extends Error {
  constructor(
    message: string,
    public code?: string,
    public status?: number,
  ) {
    super(message);
  }
}

// 7TV rate limits per bucket (e.g. "search": 100 per window, "global"). When a bucket is exhausted the API
// answers HTTP 200 with a RATE_LIMIT_EXCEEDED GraphQL error whose extensions.headers carry
// x-ratelimit-<bucket>-reset. Requests in that bucket then wait out the reset instead of retrying — 7TV
// escalates to much longer blocks for clients that keep hammering after being limited.
// Bucket names match the API's header names (x-ratelimit-<bucket>-reset). Adds use "emote_set_change".
export type Bucket = "search" | "emote_set_change" | "global";
const pausedUntil: Record<string, number> = {};
const pauseListeners = new Set<(bucket: string, until: number) => void>();

/** Subscribe to rate-limit pauses; the callback gets the bucket and the epoch ms when it resumes. */
export function onRateLimitPause(cb: (bucket: string, until: number) => void) {
  pauseListeners.add(cb);
  return () => void pauseListeners.delete(cb);
}

/** Records the pause and returns when the limited bucket resumes. */
function pauseFrom(headers: Record<string, string> | undefined, fallbackBucket: string): number {
  const [key, value] = Object.entries(headers ?? {}).find(([k]) => k.endsWith("-reset")) ?? [];
  const bucket = key?.match(/^x-ratelimit-(.+)-reset$/)?.[1] ?? fallbackBucket;
  const seconds = Number(value) > 0 ? Number(value) : 10;
  const until = Date.now() + seconds * 1000 + 500;
  if (until > (pausedUntil[bucket] ?? 0)) {
    pausedUntil[bucket] = until;
    pauseListeners.forEach((cb) => cb(bucket, until));
  }
  return pausedUntil[bucket];
}

// Both buckets we use allow 100 requests per 60s, counted in fixed windows we can't see the start of. Rejected
// requests count too, so it's much better to never hit the limit than to wait it out. Requests are paced on
// our side: at most PACE_BURST in any PACE_BURST × 60s / PACE_LIMIT (a quick burst, then a steady ~0.63s apart).
// That keeps every 60s window, wherever it starts, at PACE_LIMIT or fewer (a little under 7TV's 100, to leave
// room for 7tv.app open in another tab).
const PACE_LIMIT = 95;
const PACE_BURST = 10;
const PACE_PERIOD_MS = (PACE_BURST * 60_000) / PACE_LIMIT;

/** Spaces out requests: at most `burst` may start in any `period`. Requests go out in the order they ask. */
class Pacer {
  private starts: number[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly burst: number,
    readonly period: number,
  ) {}

  /** How long until a request could start (0 if one could start now). */
  wait(now = Date.now()) {
    while (this.starts.length && this.starts[0] <= now - this.period) this.starts.shift();
    return this.starts.length < this.burst
      ? 0
      : this.starts[this.starts.length - this.burst] + this.period - now;
  }

  /** How many requests could start right now. */
  free(now = Date.now()) {
    this.wait(now);
    return this.burst - this.starts.length;
  }

  /** Waits for a turn. An aborted request gives up its place without using a slot. */
  take(signal?: AbortSignal) {
    const turn = this.queue.then(async () => {
      for (let ms = this.wait(); ms > 0; ms = this.wait()) await sleep(ms, signal);
      signal?.throwIfAborted();
      this.starts.push(Date.now());
    });
    this.queue = turn.catch(() => {});
    return turn;
  }
}

const pacers: Partial<Record<Bucket, Pacer>> = {
  search: new Pacer(PACE_BURST, PACE_PERIOD_MS),
  emote_set_change: new Pacer(PACE_BURST, PACE_PERIOD_MS),
};

/** How many searches could go out right now without waiting. */
export const freeSearches = () => pacers.search!.free();
/** How long until a search could go out (0 if it could now). */
export const searchWait = () => pacers.search!.wait();

/** Roughly how long a request takes, for estimates. */
const TYPICAL_REQUEST_MS = 300;
/** Roughly how long `n` adds/removes take, given the pacing above. */
export function setChangeTime(n: number) {
  const pacer = pacers.emote_set_change!;
  return Math.max(n * TYPICAL_REQUEST_MS, ((n - pacer.burst) * pacer.period) / pacer.burst);
}

async function waitForBuckets(bucket: Bucket, signal?: AbortSignal) {
  for (;;) {
    const until = Math.max(pausedUntil[bucket] ?? 0, pausedUntil.global ?? 0);
    if (Date.now() >= until) return;
    await sleep(until - Date.now(), signal);
  }
}

export async function gql<T>(
  query: string,
  variables: Record<string, unknown> = {},
  token?: string | null,
  bucket: Bucket = "global",
  /** Aborts the request, including any wait for a rate limit or a retry. */
  signal?: AbortSignal,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    await waitForBuckets(bucket, signal);
    await pacers[bucket]?.take(signal);

    const res = await fetch(GQL_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ query, variables }),
      signal,
    });

    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt, signal);
      continue;
    }

    const body = await res.json().catch(() => null);
    if (res.status === 401) {
      throw new ApiError(body?.error ?? "Invalid or expired token", "UNAUTHORIZED", 401);
    }
    if (body?.errors?.length) {
      const e = body.errors[0];
      if (e.extensions?.code === "RATE_LIMIT_EXCEEDED" && attempt < 8) {
        // Wait for whichever bucket was actually exhausted, even if it isn't the one we expected.
        const until = pauseFrom(e.extensions.headers, bucket);
        await sleep(Math.max(0, until - Date.now()), signal);
        continue;
      }
      throw new ApiError(
        e.extensions?.message ?? e.message,
        e.extensions?.code,
        e.extensions?.status,
      );
    }
    if (!res.ok || !body?.data) {
      throw new ApiError(body?.error ?? `HTTP ${res.status}`, undefined, res.status);
    }
    return body.data as T;
  }
}

// ---------- Types ----------

export interface EmoteSummary {
  id: string;
  defaultName: string;
  /** Deleted emotes stay listed in sets but don't count towards capacity. */
  deleted: boolean;
  tags: string[];
  flags: { animated: boolean; defaultZeroWidth: boolean; private: boolean };
  /** The uploader's user ID. A private emote can only go into sets this user owns. */
  ownerId: string;
  owner: { mainConnection: { platformDisplayName: string } | null } | null;
}

export interface SetEmote {
  id: string;
  alias: string;
  flags: { zeroWidth: boolean };
  emote: EmoteSummary;
}

export interface EmoteSetInfo {
  id: string;
  name: string;
  capacity: number | null;
  /** The owning user's ID (null for sets without an owner). */
  ownerId: string | null;
  owner: { mainConnection: { platformDisplayName: string } | null } | null;
  emotes: { totalCount: number };
}

export interface Me {
  id: string;
  mainConnection: { platformDisplayName: string; platformAvatarUrl: string | null } | null;
  editableEmoteSetIds: string[];
}

export type SortBy =
  | "TOP_ALL_TIME"
  | "TOP_MONTHLY"
  | "TRENDING_MONTHLY"
  | "TRENDING_WEEKLY"
  | "UPLOAD_DATE";

// ---------- Helpers ----------

export const emoteImage = (id: string, size: 1 | 2 | 3 | 4 = 2) =>
  `https://cdn.7tv.app/emote/${id}/${size}x.webp`;
export const emotePage = (id: string) => `https://7tv.app/emotes/${id}`;
export const ownerName = (o: { owner: EmoteSummary["owner"] }) =>
  o.owner?.mainConnection?.platformDisplayName ?? "unknown";

/**
 * Whether 7TV's addEmote would accept this emote into a set owned by `setOwnerId`: deleted emotes never, and
 * private ones only into a set their uploader owns (apps/api/src/http/v4/gql/mutations/emote_set/operation.rs).
 */
export const canAddTo = (e: EmoteSummary, setOwnerId: string | null) =>
  !e.deleted && (!e.flags.private || (setOwnerId != null && e.ownerId === setOwnerId));

/**
 * An emote ID from what the user typed: a bare ID, or a link containing one (7tv.app/emotes/<id>,
 * cdn.7tv.app/emote/<id>/2x.webp, …). Plain search text never matches.
 */
export function parseEmoteId(input: string): string | null {
  const t = input.trim();
  const bare = t.match(/^([0-9A-HJKMNP-TV-Z]{26})$/i);
  const link = t.match(/\/emotes?\/([0-9A-HJKMNP-TV-Z]{26})(?![0-9A-Z])/i);
  return (bare?.[1] ?? link?.[1])?.toUpperCase() ?? null;
}

/** Accepts a raw set ID or any 7tv URL containing one. */
export function parseSetId(input: string): string | null {
  const m = input.trim().match(/\b([0-9A-HJKMNP-TV-Z]{26}|[0-9a-f]{24})\b/i);
  return m ? m[1].toUpperCase() : null;
}

// ---------- Queries ----------

const EMOTE_FIELDS = `id defaultName deleted tags flags { animated defaultZeroWidth private } ownerId owner { mainConnection { platformDisplayName } }`;
const SET_INFO_FIELDS = `id name capacity ownerId owner { mainConnection { platformDisplayName } } emotes(page: 1, perPage: 1) { totalCount }`;

export async function fetchMe(token: string): Promise<Me | null> {
  const d = await gql<{ users: { me: Me | null } }>(
    `query Me { users { me { id mainConnection { platformDisplayName platformAvatarUrl } editableEmoteSetIds } } }`,
    {},
    token,
  );
  return d.users.me;
}

export async function fetchSetInfos(ids: string[], token?: string | null): Promise<EmoteSetInfo[]> {
  if (!ids.length) return [];
  const d = await gql<{ emoteSets: { emoteSets: EmoteSetInfo[] } }>(
    `query Sets($ids: [Id!]!) { emoteSets { emoteSets(ids: $ids) { ${SET_INFO_FIELDS} } } }`,
    { ids },
    token,
  );
  return d.emoteSets.emoteSets;
}

export async function fetchSetInfo(
  id: string,
  token?: string | null,
): Promise<EmoteSetInfo | null> {
  const d = await gql<{ emoteSets: { emoteSet: EmoteSetInfo | null } }>(
    `query Set($id: Id!) { emoteSets { emoteSet(id: $id) { ${SET_INFO_FIELDS} } } }`,
    { id },
    token,
  );
  return d.emoteSets.emoteSet;
}

/** Fetches every emote in a set, following pagination. */
export async function fetchSetEmotes(id: string, token?: string | null): Promise<SetEmote[]> {
  const perPage = 500;
  const all: SetEmote[] = [];
  for (let page = 1; ; page++) {
    const d = await gql<{
      emoteSets: { emoteSet: { emotes: { pageCount: number; items: SetEmote[] } } | null };
    }>(
      `query SetEmotes($id: Id!, $page: Int, $perPage: Int) { emoteSets { emoteSet(id: $id) {
        emotes(page: $page, perPage: $perPage) { pageCount items { id alias flags { zeroWidth } emote { ${EMOTE_FIELDS} } } }
      } } }`,
      { id, page, perPage },
      token,
    );
    const emotes = d.emoteSets.emoteSet?.emotes;
    if (!emotes) throw new ApiError(`Emote set ${id} not found`);
    all.push(...emotes.items);
    if (page >= emotes.pageCount || emotes.items.length === 0) return all;
  }
}

export interface SearchParams {
  query: string;
  tags: string[];
  exactMatch: boolean;
  sortBy: SortBy;
  perPage?: number;
  /** Report whether each result is already in this set (and under which names). */
  targetSetId?: string;
}

export interface SearchResult extends EmoteSummary {
  /** Aliases this emote already has in the target set, if any. */
  inTarget: string[];
}

/** An emote as queried with `inEmoteSets` (included only when there's a target set to check). */
type EmoteWithSets = EmoteSummary & { inEmoteSets?: { emote: { alias: string } | null }[] };
const withInTarget = ({ inEmoteSets, ...e }: EmoteWithSets): SearchResult => ({
  ...e,
  inTarget: (inEmoteSets ?? []).flatMap((s) => (s.emote ? [s.emote.alias] : [])),
});
/**
 * `$setIds` is a required variable even when `inEmoteSets` is skipped (`@include(if: false)`), and 7TV rejects
 * an empty list, so this placeholder is sent when there's no target set.
 */
const setIdsFor = (targetSetId: string | undefined) =>
  targetSetId ? [targetSetId] : ["00000000000000000000000000"];

// Note: windowed sorts (TRENDING_*, TOP_MONTHLY) also filter, returning only emotes with activity in that
// window (e.g. "catJAM" + halloween: 1 result trending vs 6 all-time). That's intended.
// Same field the 7tv.app website's own EmoteSearch operation uses (emotes.search), including its
// inEmoteSets trick for showing which results are already in a set.
export async function searchEmotes(
  p: SearchParams,
  token?: string | null,
  signal?: AbortSignal,
): Promise<{ total: number; items: SearchResult[] }> {
  const d = await gql<{ emotes: { search: { totalCount: number; items: EmoteWithSets[] } } }>(
    `query EmoteSearch($query: String, $tags: Tags, $sort: Sort!, $filters: Filters, $perPage: Int, $setIds: [Id!]!, $withSets: Boolean!) {
      emotes { search(query: $query, tags: $tags, sort: $sort, filters: $filters, page: 1, perPage: $perPage) {
        totalCount items { ${EMOTE_FIELDS} inEmoteSets(emoteSetIds: $setIds) @include(if: $withSets) { emote { alias } } }
      } }
    }`,
    {
      query: p.query.slice(0, 100), // the API rejects longer query strings
      tags: p.tags.length ? { tags: p.tags, match: "ANY" } : null,
      sort: { sortBy: p.sortBy, order: "DESCENDING" },
      filters: { exactMatch: p.exactMatch },
      perPage: p.perPage ?? 24,
      setIds: setIdsFor(p.targetSetId),
      withSets: !!p.targetSetId,
    },
    token,
    "search",
    signal,
  );
  return {
    total: d.emotes.search.totalCount,
    items: d.emotes.search.items.map(withInTarget),
  };
}

/** Looks up one emote by ID (null if it doesn't exist). Not a search, so it doesn't use the search quota. */
export async function fetchEmoteById(
  id: string,
  targetSetId?: string,
  token?: string | null,
  signal?: AbortSignal,
): Promise<SearchResult | null> {
  const d = await gql<{ emotes: { emote: EmoteWithSets | null } }>(
    `query EmoteById($id: Id!, $setIds: [Id!]!, $withSets: Boolean!) {
      emotes { emote(id: $id) { ${EMOTE_FIELDS} inEmoteSets(emoteSetIds: $setIds) @include(if: $withSets) { emote { alias } } } }
    }`,
    { id, setIds: setIdsFor(targetSetId), withSets: !!targetSetId },
    token,
    "global",
    signal,
  );
  return d.emotes.emote && withInTarget(d.emotes.emote);
}

export async function addEmoteToSet(
  token: string,
  setId: string,
  emoteId: string,
  alias: string | undefined,
  zeroWidth: boolean,
): Promise<void> {
  await gql(
    `mutation AddEmote($setId: Id!, $id: EmoteSetEmoteId!, $zeroWidth: Boolean) {
      emoteSets { emoteSet(id: $setId) { addEmote(id: $id, zeroWidth: $zeroWidth) { id } } }
    }`,
    { setId, id: { emoteId, alias: alias ?? null }, zeroWidth },
    token,
    "emote_set_change",
  );
}

/** Removes one entry (emote + alias) from a set. Only used to swap an existing mapping the user changed. */
export async function removeEmoteFromSet(
  token: string,
  setId: string,
  emoteId: string,
  alias: string,
): Promise<void> {
  await gql(
    `mutation RemoveEmote($setId: Id!, $id: EmoteSetEmoteId!) {
      emoteSets { emoteSet(id: $setId) { removeEmote(id: $id) { id } } }
    }`,
    { setId, id: { emoteId, alias } },
    token,
    "emote_set_change",
  );
}

// Error messages from the 7TV API's addEmote (apps/api/src/http/v4/gql/mutations/emote_set/operation.rs).
export const isCapacityError = (e: unknown) => e instanceof Error && /at capacity/i.test(e.message);
export const isConflictError = (e: unknown) =>
  e instanceof Error && /conflicting name/i.test(e.message);

/** Failures specific to one emote; the rest of a batch can still go through. */
export const isEmoteLevelError = (e: unknown) =>
  isConflictError(e) ||
  (e instanceof Error &&
    /emote is private|emote not found|not allowed in personal/i.test(e.message));

/** Turns API and network failures into a sentence a user can act on. */
export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const code = e instanceof ApiError ? e.code : undefined;
  if (isCapacityError(e)) return "Your seasonal set is full.";
  if (isConflictError(e)) return "Your seasonal set already has an emote with this name.";
  if (/emote is private/i.test(msg)) return "This emote is private.";
  if (/emote not found/i.test(msg)) return "This emote has been deleted from 7TV.";
  if (/emote set not found/i.test(msg)) return "Your seasonal set no longer exists.";
  if (code === "UNAUTHORIZED" || code === "LOGIN_REQUIRED")
    return "Your 7TV session has expired. Log in again to continue.";
  if (code === "LACKING_PRIVILEGES" || (e instanceof ApiError && e.status === 403))
    return "You no longer have permission to edit this emote set.";
  if (code === "RATE_LIMIT_EXCEEDED") return "Rate limit exceeded. Try again in a minute.";
  if (e instanceof TypeError) return "Couldn't reach 7TV. Check your connection and try again.";
  return msg.replace(/^[A-Z_]+ /, ""); // strip the "CODE " prefix 7TV puts on messages
}

/** Slots used in a set, as 7TV counts them: deleted emotes don't take up capacity. */
export const usedSlots = (emotes: SetEmote[]) => emotes.filter((e) => !e.emote.deleted).length;
