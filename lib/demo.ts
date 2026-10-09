import { DEMO_SEED } from "./demo-data";
import { type Api, type Services, liveApi, noopSlot } from "./services";
import { ApiError, type EmoteSetInfo, type EmoteSummary, type Me, type SearchResult, type SetEmote, usedSlots } from "./seventv";
import { sleep } from "./util";

/** The shape of lib/demo-data.ts. The first seasonal set is pre-selected on the setup form. */
export interface DemoSeed {
  base: DemoSetSeed;
  seasonal: DemoSetSeed[];
}
interface DemoSetSeed {
  name: string;
  capacity: number | null;
  emotes: { alias: string; zeroWidth: boolean; emote: EmoteSummary }[];
}

const OWNER = "youngmani";
export const DEMO_BASE_ID = "DEMOBASE000000000000000000";
/** Fake set IDs for the seasonal sets, in seed order. */
const demoSeasonalId = (i: number) => `DEMOSEASONAL${String(i).padStart(14, "0")}`;

/** A little latency so saving looks like saving. */
const latency = () => sleep(80 + Math.random() * 120);

interface DemoSet {
  id: string;
  name: string;
  capacity: number | null;
  entries: SetEmote[];
}

/**
 * In-memory stand-in for the user's two emote sets. Lives outside React: mutating it never re-renders
 * anything; the app learns about changes from its own add/remove calls, exactly as with the real API.
 * Applies the same rules (and error messages) as 7TV's addEmote/removeEmote so the app's handling runs
 * for real: name conflicts, capacity (deleted emotes don't count), private and deleted emotes.
 */
export class DemoStore {
  private sets = new Map<string, DemoSet>();
  /** Every emote seen (seed, search results, lookups), so adds by ID know what they're adding. */
  private known = new Map<string, EmoteSummary>();

  constructor(seed: DemoSeed) {
    const all: [string, DemoSetSeed][] = [
      [DEMO_BASE_ID, seed.base],
      ...seed.seasonal.map((s, i): [string, DemoSetSeed] => [demoSeasonalId(i), s]),
    ];
    for (const [id, s] of all) {
      const entries = s.emotes.map((e) => ({
        id: e.emote.id,
        alias: e.alias,
        flags: { zeroWidth: e.zeroWidth },
        emote: structuredClone(e.emote),
      }));
      entries.forEach((e) => this.remember(e.emote));
      this.sets.set(id, { id, name: s.name, capacity: s.capacity, entries });
    }
  }

  has = (setId: string) => this.sets.has(setId);
  ids = () => [...this.sets.keys()];
  remember = (e: EmoteSummary) => void this.known.set(e.id, e);
  lookup = (emoteId: string) => this.known.get(emoteId);

  info(setId: string): EmoteSetInfo | null {
    const s = this.sets.get(setId);
    if (!s) return null;
    return {
      id: s.id,
      name: s.name,
      capacity: s.capacity,
      owner: { mainConnection: { platformDisplayName: OWNER } },
      emotes: { totalCount: s.entries.length },
    };
  }

  /** A copy, like a fresh network response. */
  entries = (setId: string): SetEmote[] => structuredClone(this.sets.get(setId)?.entries ?? []);

  /** Names an emote has in a set (for the "in <set> as …" notes). */
  aliasesOf = (setId: string, emoteId: string) =>
    (this.sets.get(setId)?.entries ?? []).filter((e) => e.emote.id === emoteId).map((e) => e.alias);

  add(setId: string, emote: EmoteSummary, alias: string | undefined, zeroWidth: boolean) {
    const s = this.sets.get(setId);
    if (!s) throw new ApiError("emote set not found", "BAD_REQUEST", 404);
    if (emote.deleted) throw new ApiError("emote not found", "BAD_REQUEST", 404);
    if (emote.flags.private) throw new ApiError("emote is private", "BAD_REQUEST", 400);
    const name = alias ?? emote.defaultName;
    const entry: SetEmote = { id: emote.id, alias: name, flags: { zeroWidth }, emote: structuredClone(emote) };
    const clash = s.entries.findIndex((e) => e.alias === name);
    // Like 7TV: a name held by a live emote is a conflict; one held by a deleted emote is overwritten.
    if (clash >= 0 && !s.entries[clash].emote.deleted)
      throw new ApiError("this emote has a conflicting name", "BAD_REQUEST", 409);
    const next = clash >= 0 ? s.entries.map((e, i) => (i === clash ? entry : e)) : [...s.entries, entry];
    if (s.capacity != null && usedSlots(next) > s.capacity)
      throw new ApiError("emote set is at capacity", "BAD_REQUEST", 400);
    s.entries = next;
  }

  remove(setId: string, emoteId: string, alias: string) {
    const s = this.sets.get(setId);
    if (!s) throw new ApiError("emote set not found", "BAD_REQUEST", 404);
    const i = s.entries.findIndex((e) => e.emote.id === emoteId && e.alias === alias);
    if (i < 0) throw new ApiError("emote not found", "BAD_REQUEST", 404);
    s.entries = s.entries.filter((_, j) => j !== i);
  }
}

/**
 * Services for /demo: a fake account and fake saving backed by DemoStore, with real (anonymous) search and
 * emote lookups. Nothing is persisted, so reloading starts the demo fresh and a real in-progress mapping is
 * never touched.
 */
export function createDemoServices(seed: DemoSeed = DEMO_SEED): Services {
  const store = new DemoStore(seed);
  const me: Me = {
    id: "DEMO",
    mainConnection: { platformDisplayName: OWNER, platformAvatarUrl: null },
    editableEmoteSetIds: store.ids(),
  };
  /** Real results, with the "already in <set>" info taken from the demo store instead of 7TV. */
  const localize = (e: SearchResult, setId: string | undefined): SearchResult => {
    store.remember(e);
    return setId && store.has(setId) ? { ...e, inTarget: store.aliasesOf(setId, e.id) } : e;
  };

  const api: Api = {
    fetchMe: async () => me,
    fetchSetInfos: async (ids) => ids.flatMap((id) => store.info(id) ?? []),
    // Demo sets come from the store; anything else (a pasted link to a real set) is read from 7TV.
    fetchSetInfo: async (id) => store.info(id) ?? liveApi.fetchSetInfo(id),
    fetchSetEmotes: async (id) => (store.has(id) ? store.entries(id) : liveApi.fetchSetEmotes(id)),
    searchEmotes: async (p, token, signal) => {
      const demoTarget = p.targetSetId && store.has(p.targetSetId);
      const res = await liveApi.searchEmotes(demoTarget ? { ...p, targetSetId: undefined } : p, token, signal);
      return { ...res, items: res.items.map((e) => localize(e, p.targetSetId)) };
    },
    fetchEmoteById: async (id, targetSetId, token, signal) => {
      const demoTarget = targetSetId && store.has(targetSetId);
      const e = await liveApi.fetchEmoteById(id, demoTarget ? undefined : targetSetId, token, signal);
      return e && localize(e, targetSetId);
    },
    addEmoteToSet: async (_token, setId, emoteId, alias, zeroWidth) => {
      await latency();
      const emote = store.lookup(emoteId) ?? (await liveApi.fetchEmoteById(emoteId));
      if (!emote) throw new ApiError("emote not found", "BAD_REQUEST", 404);
      store.add(setId, emote, alias, zeroWidth);
    },
    removeEmoteFromSet: async (_token, setId, emoteId, alias) => {
      await latency();
      store.remove(setId, emoteId, alias);
    },
  };

  return {
    mode: "demo",
    api,
    storage: { token: noopSlot("demo"), mapping: noopSlot() },
    initialSelection: { sourceId: DEMO_BASE_ID, targetId: demoSeasonalId(0) },
  };
}
