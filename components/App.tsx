"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Input, Label, ProgressBar, TextField } from "react-aria-components";
import { useDialog } from "@/components/Dialog";
import { ExtraFocus } from "@/components/ExtraFocus";
import { MappingFocus } from "@/components/MappingFocus";
import { MappingOverview } from "@/components/MappingOverview";
import { MappingSummary } from "@/components/MappingSummary";
import { SetPicker } from "@/components/SetPicker";
import { TokenGate } from "@/components/TokenGate";
import { LoadingCard, SelectField, Spinner } from "@/components/ui";
import {
  type ApplyState,
  type Choice,
  DEFAULT_SORT,
  KEEP,
  type MappingRecord,
  type RemovedEntry,
  ORIGINAL,
  SORT_OPTIONS,
  type SearchOptions,
  type SearchState,
  THEMES,
  type Theme,
  themeForDate,
} from "@/lib/mapping";
import { createLimiter } from "@/lib/queue";
import {
  ApiError,
  type EmoteSetInfo,
  type EmoteSummary,
  type SearchResult,
  type Me,
  type SetEmote,
  type SortBy,
  emoteImage,
  friendlyError,
  isCapacityError,
  isEmoteLevelError,
  onRateLimitPause,
  parseEmoteId,
  usedSlots,
} from "@/lib/seventv";
import { type Step, buildSteps, stepAlias, stepRow } from "@/lib/steps";
import { useServices } from "@/lib/services";
type Filter = "all" | "undecided" | "replace" | "original" | "exclude" | "changed" | "remove" | "errors";


// Searches are the scarce resource (7TV allows ~100 per window), so we only search the emote on screen
// and preload the next one.
const searchLimit = createLimiter(2);
const AUTO_SEARCH_BURST = 3;
const AUTO_SEARCH_WINDOW_MS = 3000;
const AUTO_SEARCH_DELAY_MS = 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

interface MappingParams {
  sourceId: string;
  targetId: string;
  theme: Theme;
  customTags: string;
  sortBy: SortBy;
}

interface Session {
  params: MappingParams;
  source: EmoteSetInfo;
  target: EmoteSetInfo;
  /** Source emotes whose name isn't in the target yet, sorted by alias. These get added. */
  pending: SetEmote[];
  /** Source emotes whose name is already in the target, sorted by alias. Shown last; can be swapped. */
  mapped: SetEmote[];
  /** Target emotes whose name isn't in the source, sorted by alias. Kept unless the user removes them. */
  extras: SetEmote[];
  /** pending followed by mapped. */
  rows: SetEmote[];
  /** Everything the user steps through, in order (see lib/steps.ts). */
  steps: Step[];
  /** Target slots in use when loaded (deleted emotes don't count, matching 7TV). */
  targetUsed: number;
  tags: string[];
}

const tagsFor = (theme: Theme, customTags: string) =>
  theme === "custom"
    ? customTags
        .split(/[,\s]+/)
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
    : [...THEMES[theme].tags];

/**
 * The whole app. API and storage come from <ServicesProvider> (live on /, faked on /demo).
 * `children` render at the end of <main>, right under the last card (e.g. /demo's exit link).
 */
export function App({ children }: { children?: React.ReactNode }) {
  // Stable for the page's lifetime (created once), so depending on these never re-runs effects/callbacks.
  const { api, storage, mode, initialSelection } = useServices();
  const [hydrated, setHydrated] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [sets, setSets] = useState<EmoteSetInfo[]>([]);
  /** The account check and the editable-set list load as one blocking phase (nothing to do until both land). */
  const [account, setAccount] = useState<"idle" | "checking" | "loading-sets" | "ready" | "error">("idle");
  /** Set when the user just logged in from the clipboard, so it's wiped once the token checks out. */
  const clearClipboardAfterLogin = useRef(false);
  /** Shown if wiping the clipboard was blocked by the browser. */
  const [clipboardWarning, setClipboardWarning] = useState(false);
  /** Bumped by "Retry" to re-run the account check after a network failure. */
  const [accountAttempt, setAccountAttempt] = useState(0);

  // Setup form. Defaults are inferred, never persisted; only an in-progress mapping is saved.
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>("custom");
  const [customTags, setCustomTags] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>(DEFAULT_SORT);

  /** A saved in-progress mapping waiting to be resumed (or that failed to resume). */
  const [resume, setResume] = useState<MappingRecord | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(false);
  /** Re-reading the target before the confirm dialog; the apply buttons show a spinner meanwhile. */
  const [preparing, setPreparing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [completed, setCompleted] = useState<{
    added: number;
    swapped: number;
    removed: number;
    target: string;
  } | null>(null);

  /** Decisions the user has made; emotes without one are copied as the original. */
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [index, setIndex] = useState(0);
  const [searches, setSearches] = useState<Record<string, SearchState>>({});
  const [applyStates, setApplyStates] = useState<Record<string, ApplyState>>({});
  /** What the target currently holds under each already-mapped name (kept current after swaps). */
  const [targetEntries, setTargetEntries] = useState<Record<string, SetEmote>>({});
  /** Swap journal (see MappingRecord.removed). Mirrored in a ref so apply can persist it synchronously. */
  const [removed, setRemovedState] = useState<Record<string, RemovedEntry>>({});
  const removedRef = useRef<Record<string, RemovedEntry>>({});
  const setRemoved = useCallback((next: Record<string, RemovedEntry>) => {
    removedRef.current = next;
    setRemovedState(next);
  }, []);
  const [applying, setApplying] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [pause, setPause] = useState<{ bucket: string; seconds: number } | null>(null);

  const stopRef = useRef(false);
  const sessionRef = useRef<Session | null>(null);
  const searchPromises = useRef(new Map<string, Promise<SearchState>>());
  const { dialog, ask } = useDialog();

  // Countdown shown while a rate limit has paused requests.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const off = onRateLimitPause((bucket, until) => {
      clearInterval(timer);
      const tick = () => {
        const left = Math.ceil((until - Date.now()) / 1000);
        setPause(left > 0 ? { bucket, seconds: left } : null);
        if (left <= 0) clearInterval(timer);
      };
      tick();
      timer = setInterval(tick, 1000);
    });
    return () => {
      off();
      clearInterval(timer);
    };
  }, []);

  // ---- Bootstrap: saved token and any in-progress mapping ----
  useEffect(() => {
    storage.init();
    setToken(storage.token.get());
    const saved = storage.mapping.get();
    if (saved) {
      setSourceId(saved.sourceId);
      setTargetId(saved.targetId);
      setTheme(saved.theme);
      setCustomTags(saved.customTags);
      setSortBy(saved.sortBy);
      setResume(saved);
    } else {
      setTheme(themeForDate());
      if (initialSelection) {
        setSourceId(initialSelection.sourceId);
        setTargetId(initialSelection.targetId);
      }
    }
    setHydrated(true);
  }, [storage, initialSelection]);

  useEffect(() => {
    document.documentElement.dataset.theme = THEMES[theme].palette;
  }, [theme]);

  const resetSession = useCallback(() => {
    sessionRef.current = null;
    searchPromises.current.clear();
    setSession(null);
    setSearches({});
    setApplyStates({});
    setTargetEntries({});
    removedRef.current = {};
    setRemovedState({});
    setChoices({});
    setIndex(0);
  }, []);

  const signOut = useCallback(
    (reason?: string) => {
      storage.token.set(null);
      setToken(null);
      setMe(null);
      setSets([]);
      setAccount("idle");
      resetSession();
      setAuthError(reason ?? null);
    },
    [resetSession, storage],
  );

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      setAuthError(null);
      setAccount("checking");
      try {
        const user = await api.fetchMe(token);
        if (cancelled) return;
        if (!user) return signOut("7TV didn't accept that token. Run the command on 7tv.app again, then press Paste and log in.");
        storage.token.set(token);
        if (clearClipboardAfterLogin.current) {
          clearClipboardAfterLogin.current = false;
          // Overwrite the token on the clipboard so it can't be pasted on stream by accident.
          navigator.clipboard.writeText(window.location.host).then(
            () => setClipboardWarning(false),
            () => setClipboardWarning(true),
          );
        }
        setMe(user);
        setAccount("loading-sets");
        const editable = await api.fetchSetInfos(user.editableEmoteSetIds, token);
        if (cancelled) return;
        setSets(editable);
        setAccount("ready");
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 401)
          return signOut(
            clearClipboardAfterLogin.current
              ? "7TV didn't accept that token. Run the command on 7tv.app again, then press Paste and log in."
              : "Your 7TV session has expired. Log in again to keep going.",
          );
        setAuthError(friendlyError(e));
        setAccount("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, signOut, accountAttempt, api, storage]);

  const tags = useMemo(() => tagsFor(theme, customTags), [theme, customTags]);

  // ---- Start / resume a mapping ----
  const startMapping = useCallback(
    async (params: MappingParams, saved?: MappingRecord) => {
      if (!token || !me) return;
      setLoading(true);
      setLoadError(null);
      setCompleted(null);
      try {
        const [source, target, sourceEmotes, targetEmotes] = await Promise.all([
          api.fetchSetInfo(params.sourceId, token),
          api.fetchSetInfo(params.targetId, token),
          api.fetchSetEmotes(params.sourceId, token),
          api.fetchSetEmotes(params.targetId, token),
        ]);
        if (!source) throw new Error("Your base set no longer exists.");
        if (!target) throw new Error("Your seasonal set no longer exists.");
        if (!me.editableEmoteSetIds.includes(target.id)) throw new Error("You can't edit that seasonal set.");
        // An emote counts as already mapped when the target has something under the same name (alias).
        const byAlias = (a: SetEmote, b: SetEmote) => a.alias.localeCompare(b.alias, undefined, { sensitivity: "base" });
        const entries = new Map(targetEmotes.map((e) => [e.alias, e]));
        const pendingRows = sourceEmotes.filter((e) => !entries.has(e.alias)).sort(byAlias);
        const mappedRows = sourceEmotes.filter((e) => entries.has(e.alias)).sort(byAlias);
        // Target emotes the source doesn't have (e.g. the source changed since last season).
        const sourceAliases = new Set(sourceEmotes.map((e) => e.alias));
        const extraRows = targetEmotes.filter((e) => !sourceAliases.has(e.alias)).sort(byAlias);
        const steps = buildSteps(pendingRows, mappedRows, extraRows);
        const s: Session = {
          params,
          source,
          target,
          pending: pendingRows,
          mapped: mappedRows,
          extras: extraRows,
          rows: [...pendingRows, ...mappedRows],
          steps,
          targetUsed: usedSlots(targetEmotes),
          tags: tagsFor(params.theme, params.customTags),
        };
        const restored = saved?.choices ?? {};
        // Resume where the user was. Names are looked up rather than positions, because emotes move between
        // sections as they get added (e.g. a pending emote added before the reload is now "mapped").
        const summaryAt = steps.findIndex((st) => st.kind === "summary");
        const endAt = steps.findIndex((st) => st.kind === "end");
        const aliasAt = saved?.currentAlias ? steps.findIndex((st) => stepAlias(st) === saved.currentAlias) : -1;
        const firstUndecided = s.pending.findIndex((r) => !restored[r.alias]);
        const step =
          saved?.atStep === "end"
            ? endAt >= 0
              ? endAt
              : summaryAt
            : saved?.atStep === "summary"
              ? summaryAt
              : aliasAt >= 0
                ? aliasAt
                : firstUndecided >= 0
                  ? firstUndecided
                  : summaryAt;
        // Swap journal: an entry whose name is back in the target finished (or rolled back) before the page
        // closed. One whose name is still missing was interrupted between remove and re-add; keep it so the
        // user can restore the previous emote.
        const removed = Object.fromEntries(
          Object.entries(saved?.removed ?? {}).filter(([alias]) => !entries.has(alias)),
        );
        resetSession();
        sessionRef.current = s;
        setTargetEntries(Object.fromEntries(mappedRows.map((r) => [r.alias, entries.get(r.alias)!])));
        setChoices(restored);
        setRemoved(removed);
        setIndex(step);
        setSession(s);
        setResume(null);
      } catch (e) {
        setLoadError(friendlyError(e));
      } finally {
        setLoading(false);
      }
    },
    [token, me, resetSession, api],
  );

  // Resume the saved mapping as soon as we know who the user is.
  useEffect(() => {
    if (me && resume && !session && !loading && !loadError) void startMapping(resume, resume);
  }, [me, resume, session, loading, loadError, startMapping]);

  const pending = useMemo(() => session?.pending ?? [], [session]);
  const rows = useMemo(() => session?.rows ?? [], [session]);
  const extras = useMemo(() => session?.extras ?? [], [session]);
  const steps = useMemo(() => session?.steps ?? [], [session]);
  const stepCount = steps.length;
  const step = steps[index] as Step | undefined;
  const summaryStep = steps.findIndex((st) => st.kind === "summary");
  const stepOfAlias = useCallback((alias: string) => steps.findIndex((st) => stepAlias(st) === alias), [steps]);
  const rowAtStep = useCallback((i: number) => stepRow(steps[i]), [steps]);
  const atSummary = step?.kind === "summary";
  const atEnd = step?.kind === "end";
  /** The source emote on screen (sections 1 and 2). */
  const current = stepRow(step);
  /** The target-only emote on screen (section 3). */
  const currentExtra = step?.kind === "extra" ? step.entry : undefined;
  const isMapped = (alias: string) => alias in targetEntries;
  const extraAliases = useMemo(() => new Set(extras.map((e) => e.alias)), [extras]);
  const isExtra = (alias: string) => extraAliases.has(alias);

  // Persist the in-progress mapping on every change.
  const persist = useCallback(
    (s: Session) =>
      storage.mapping.set({
        ...s.params,
        choices,
        currentAlias: stepAlias(step),
        atStep: atSummary ? "summary" : atEnd ? "end" : undefined,
        removed: removedRef.current,
      }),
    [choices, step, atSummary, atEnd, storage],
  );
  useEffect(() => {
    if (session) persist(session);
  }, [session, persist, removed]);

  const cancelMapping = async () => {
    const ok = await ask({
      title: "Start over?",
      body: "Your picks will be thrown away. Anything already saved to your seasonal set stays there.",
      confirmLabel: "Start over",
      destructive: true,
    });
    if (!ok) return;
    stopRef.current = true;
    storage.mapping.set(null);
    resetSession();
    setResume(null);
    setLoadError(null);
  };

  // ---- Searching ----
  const runSearch = useCallback((row: SetEmote, opts?: Partial<SearchOptions>): Promise<SearchState> => {
    const s = sessionRef.current;
    if (!s) return Promise.reject(new Error("no session"));
    const { alias } = row;
    const o: SearchOptions = {
      input: "",
      exact: true,
      tagged: true,
      sortBy: s.params.sortBy,
      ...opts,
    };
    // A blank box searches the emote's own (unaliased) name; an emote link or ID is looked up directly.
    const linkedId = parseEmoteId(o.input);
    const query = o.input.trim() || row.emote.defaultName;
    const base = { ...o, query, items: [], total: 0, hidden: 0 };
    // Keep the previous results while loading so the tiles don't blink out; the UI dims them under a spinner.
    setSearches((prev) => ({
      ...prev,
      [alias]: { ...base, items: prev[alias]?.items ?? [], status: "loading" },
    }));
    // The base emote is already offered as its own tile. Private and deleted emotes can't be added, so
    // they're dropped (and counted) rather than offered.
    const usable = (found: SearchResult[]) => {
      const others = found.filter((e) => e.id !== row.emote.id);
      const items = others.filter((e) => !e.deleted && !e.flags.private);
      return { items, hidden: others.length - items.length };
    };
    const p = searchLimit(async (): Promise<SearchState> => {
      if (sessionRef.current !== s) throw new Error("cancelled"); // don't spend quota on a stale session
      if (linkedId) {
        // Exact lookup first; filters don't apply to a specific emote.
        const emote = await api.fetchEmoteById(linkedId, s.target.id).catch(() => null);
        if (emote) return { ...base, status: "done", via: "link", total: 1, ...usable([emote]) };
      }
      const res = await api.searchEmotes({
        query,
        tags: o.tagged ? s.tags : [],
        sortBy: o.sortBy,
        exactMatch: o.exact,
        targetSetId: s.target.id,
      });
      return {
        ...base,
        status: "done",
        via: linkedId ? "link-missing" : undefined,
        total: res.total,
        ...usable(res.items),
      };
    })
      .catch((e): SearchState => ({ ...base, status: "error", error: friendlyError(e) }))
      .then((state) => {
        if (sessionRef.current === s) setSearches((prev) => ({ ...prev, [alias]: state }));
        return state;
      });
    searchPromises.current.set(alias, p);
    return p;
  }, [api]);

  /** Default search for an emote: its unaliased name, exact match, seasonal tags. Runs once per emote. */
  const ensureSearch = useCallback(
    (row: SetEmote) => searchPromises.current.get(row.alias) ?? runSearch(row),
    [runSearch],
  );

  // Search the emote on screen, then preload the next one (results + images) so stepping forward is instant.
  // Stepping through fast would burn the search quota (~100 per window), so once AUTO_SEARCH_BURST automatic
  // searches have gone out within AUTO_SEARCH_WINDOW_MS, the next one waits AUTO_SEARCH_DELAY_MS (spinner
  // showing) and is dropped entirely if the user has moved on by then. Preloading pauses while that's the case.
  // Searches the user asks for (Search button, filters, sort) are never throttled.
  const autoSearchTimes = useRef<number[]>([]);
  const steppingFast = useCallback(() => {
    const now = Date.now();
    autoSearchTimes.current = autoSearchTimes.current.filter((t) => now - t < AUTO_SEARCH_WINDOW_MS);
    return autoSearchTimes.current.length >= AUTO_SEARCH_BURST;
  }, []);
  const autoSearch = useCallback(
    (row: SetEmote) => {
      const cached = searchPromises.current.get(row.alias);
      if (cached) return cached;
      autoSearchTimes.current.push(Date.now());
      return ensureSearch(row);
    },
    [ensureSearch],
  );

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const preloadNext = () => {
      const next = rowAtStep(index + 1) ?? rowAtStep(index + 2); // skip over a summary step
      if (cancelled || !next || steppingFast()) return;
      autoSearch(next).then((st) => {
        for (const e of st.items) new Image().src = emoteImage(e.id, 3);
      });
      new Image().src = emoteImage(next.emote.id, 3);
    };
    // On an "All done!" step there's nothing to search, but the emote after it is worth preloading.
    if (!current) {
      preloadNext();
      return () => {
        cancelled = true;
      };
    }
    if (searchPromises.current.has(current.alias) || !steppingFast()) {
      autoSearch(current).then(preloadNext);
      return () => {
        cancelled = true;
      };
    }
    const timer = setTimeout(() => autoSearch(current).then(preloadNext), AUTO_SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer); // moved on before the delay ran out: the search is never sent
    };
  }, [session, current, index, rowAtStep, autoSearch, steppingFast]);

  const navigate = useCallback(
    (delta: number) => setIndex((i) => Math.min(Math.max(0, i + delta), Math.max(0, stepCount - 1))),
    [stepCount],
  );

  const choose = useCallback(
    (choice: Choice, advance: boolean) => {
      const alias = stepAlias(step);
      if (!alias) return;
      setChoices((prev) => ({ ...prev, [alias]: choice }));
      if (advance) navigate(1);
    },
    [step, navigate],
  );

  const jumpToNextUndecided = () => {
    const open = (r: SetEmote) => !choices[r.alias] && applyStates[r.alias]?.state !== "added";
    const i = pending.findIndex((r, j) => j > index && open(r));
    const k = i >= 0 ? i : pending.findIndex(open);
    setIndex(k >= 0 ? k : summaryStep);
  };
  /** Jump to the first step of a section (from the "All done!" buttons). */
  const jumpTo = (kind: "mapped" | "extra") => {
    const i = steps.findIndex((st) => st.kind === kind);
    if (i >= 0) setIndex(i);
  };

  // ---- Applying ----
  /**
   * Emotes not yet in the target default to the original; anything already in the target (mapped, or only in
   * the target) defaults to staying as-is.
   */
  const choiceOf = (alias: string): Choice =>
    choices[alias] ?? (isMapped(alias) || isExtra(alias) ? KEEP : ORIGINAL);
  /** The emote this row should end up as in the target (null = not copied). */
  const desiredEmote = (row: SetEmote): EmoteSummary | null => {
    const c = choiceOf(row.alias);
    if (c.kind === "replace") return c.emote;
    if (c.kind === "original") return row.emote;
    if (c.kind === "keep") return targetEntries[row.alias]?.emote ?? null;
    return null;
  };
  /** Already-mapped rows whose chosen emote differs from what the target holds now. */
  const isSwap = (row: SetEmote) => {
    const cur = targetEntries[row.alias];
    const want = desiredEmote(row);
    return !!cur && !!want && want.id !== cur.emote.id;
  };

  const plan = pending.filter((r) => choiceOf(r.alias).kind !== "exclude" && applyStates[r.alias]?.state !== "added");
  const swaps = session?.mapped.filter(isSwap) ?? [];
  const removals = extras.filter((e) => choiceOf(e.alias).kind === "remove" && applyStates[e.alias]?.state !== "removed");
  const addedCount = pending.filter((r) => applyStates[r.alias]?.state === "added").length;
  const capacity = session?.target.capacity ?? null;
  // Swapping out an entry whose emote was deleted from 7TV takes a slot (deleted emotes don't count).
  const swapSlots = swaps.filter((r) => targetEntries[r.alias]?.emote.deleted).length;
  const removedCount = extras.filter((e) => applyStates[e.alias]?.state === "removed" && !e.emote.deleted).length;
  // Removing frees a slot unless the emote was deleted from 7TV (those never counted).
  const freedSlots = removals.filter((e) => !e.emote.deleted).length;
  const projected = (session?.targetUsed ?? 0) + addedCount + plan.length + swapSlots - removedCount - freedSlots;

  const stats = useMemo(() => {
    const counts = { replace: 0, original: 0, exclude: 0, undecided: 0, remove: 0, errors: 0 };
    for (const r of pending) {
      const c = choices[r.alias];
      const done = applyStates[r.alias]?.state === "added";
      if (c && (c.kind === "replace" || c.kind === "original" || c.kind === "exclude")) counts[c.kind]++;
      else if (!done) counts.undecided++; // already-added emotes don't need reviewing
    }
    for (const e of extras) if (choices[e.alias]?.kind === "remove") counts.remove++;
    for (const r of [...rows, ...extras]) if (applyStates[r.alias]?.state === "error") counts.errors++;
    return counts;
  }, [pending, rows, extras, choices, applyStates]);

  // Closing the tab mid-run is recoverable (see the swap journal and the re-read in apply), but warn anyway.
  useEffect(() => {
    if (!applying) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [applying]);

  /** Updates the swap journal and writes it to storage immediately, before the next network call. */
  const journal = (s: Session, alias: string, entry: RemovedEntry | null) => {
    const next = { ...removedRef.current };
    if (entry) next[alias] = entry;
    else delete next[alias];
    setRemoved(next);
    persist(s);
  };

  const apply = async () => {
    const s = sessionRef.current;
    if (!s || !token || preparing || applying) return; // ignore repeat presses

    // Re-read the target right before writing: earlier (partial) runs, or edits made elsewhere, may have
    // already added some of these emotes, and only the emotes still missing need free slots.
    let fresh: SetEmote[];
    let freshCapacity: number | null;
    setPreparing(true);
    try {
      const [info, emotes] = await Promise.all([api.fetchSetInfo(s.target.id, token), api.fetchSetEmotes(s.target.id, token)]);
      if (!info) throw new Error("Your seasonal set no longer exists.");
      fresh = emotes;
      freshCapacity = info.capacity;
    } catch (e) {
      setPreparing(false);
      await ask({ title: `Couldn't check ${s.target.name}`, body: friendlyError(e) });
      return;
    }
    setPreparing(false);
    const freshByAlias = new Map(fresh.map((e) => [e.alias, e]));
    const toAdd = s.pending.filter((r) => choiceOf(r.alias).kind !== "exclude" && !freshByAlias.has(r.alias));
    const alreadyThere = s.pending.filter((r) => freshByAlias.has(r.alias));

    // A swap is only safe if the target still holds exactly what we showed the user.
    const toSwap: SetEmote[] = [];
    const stale: SetEmote[] = [];
    for (const r of s.mapped.filter(isSwap)) {
      const now = freshByAlias.get(r.alias);
      if (now && now.emote.id === targetEntries[r.alias]?.emote.id) toSwap.push(r);
      else stale.push(r);
    }
    // Removals: only if the target still holds exactly the emote the user saw under that name.
    const toRemove: SetEmote[] = [];
    const goneAlready: SetEmote[] = [];
    for (const e of s.extras.filter((x) => choiceOf(x.alias).kind === "remove")) {
      const now = freshByAlias.get(e.alias);
      if (!now) goneAlready.push(e);
      else if (now.emote.id === e.emote.id) toRemove.push(e);
      else stale.push(e);
    }
    setApplyStates((prev) => {
      const next = { ...prev };
      for (const r of alreadyThere) next[r.alias] = { state: "added" };
      for (const e of goneAlready) next[e.alias] = { state: "removed" };
      for (const r of stale)
        next[r.alias] = {
          state: "error",
          message: "Someone changed this one on 7TV after you loaded it, so it was left alone. Reload to see what's there now.",
        };
      return next;
    });

    if (!toAdd.length && !toSwap.length && !toRemove.length) {
      if (stale.length) {
        await ask({
          title: "Nothing was saved",
          body: `${plural(stale.length, "emote")} you changed were edited on 7TV in the meantime, so they were left alone. Reload to see the latest.`,
        });
        return;
      }
      return finish(s, 0, 0, 0);
    }

    const used = usedSlots(fresh);
    const slotsNeeded = toAdd.length + toSwap.filter((r) => targetEntries[r.alias]?.emote.deleted).length;
    // Removals run first, so the slots they free count towards the space available.
    const freed = toRemove.filter((e) => !e.emote.deleted).length;
    const free = freshCapacity == null ? Infinity : Math.max(0, freshCapacity - used + freed);
    if (slotsNeeded > free) {
      await ask({
        title: `${s.target.name} is too full`,
        body: (
          <>
            <p>
              It has {plural(free, "free slot")} ({used} of {freshCapacity} used), but {plural(slotsNeeded, "emote")}{" "}
              still need one
              {freed ? `, even counting the ${plural(freed, "emote")} you're removing` : ""}.
            </p>
            <p>
              Skip at least {slotsNeeded - free} more, or raise the set&apos;s capacity on 7tv.app.
            </p>
          </>
        ),
      });
      return;
    }

    const replaced = toAdd.filter((r) => choiceOf(r.alias).kind === "replace").length;
    const undecided = toAdd.filter((r) => !choices[r.alias]).length;
    const ok = await ask({
      title: `Save to ${s.target.name}?`,
      body: (
        <ul>
          {toAdd.length > 0 && (
            <li>
              Add {plural(toAdd.length, "emote")}: {replaced} seasonal, {toAdd.length - replaced} copied from the base set
              {undecided ? ` (${undecided} unreviewed)` : ""}
            </li>
          )}
          {toSwap.length > 0 && (
            <li>
              Swap {plural(toSwap.length, "emote")}: the current one comes out and your pick goes in under the same name.
              If that fails, the old one is put back.
            </li>
          )}
          {toRemove.length > 0 && (
            <li>
              <b>Remove {plural(toRemove.length, "emote")}</b> your base set doesn&apos;t have:{" "}
              {toRemove
                .slice(0, 10)
                .map((e) => e.alias)
                .join(", ")}
              {toRemove.length > 10 ? `, and ${toRemove.length - 10} more` : ""}
            </li>
          )}
          {freshCapacity != null && (
            <li>
              {s.target.name} will use {used + slotsNeeded - freed} of {freshCapacity} slots
            </li>
          )}
        </ul>
      ),
      confirmLabel: toRemove.length || toSwap.length ? "Save changes" : "Add emotes",
      destructive: toRemove.length > 0,
    });
    if (!ok) return;

    stopRef.current = false;
    setApplying(true);
    setApplyStates((prev) => {
      const next = { ...prev };
      for (const r of [...toRemove, ...toAdd, ...toSwap]) next[r.alias] = { state: "queued" };
      return next;
    });
    let added = 0;
    let swapped = 0;
    let removedN = 0;
    let failed = 0;
    let full = false;
    let fatal: string | null = null;
    // Re-apply the source alias, but only when it differs from the new emote's own name.
    const aliasFor = (row: SetEmote, emote: EmoteSummary) => (row.alias !== emote.defaultName ? row.alias : undefined);
    const fail = (row: SetEmote, e: unknown, suffix = "") => {
      failed++;
      const message = friendlyError(e) + suffix;
      setApplyStates((prev) => ({ ...prev, [row.alias]: { state: "error", message } }));
      if (isCapacityError(e)) full = true;
      // Problems with one emote (name clash, private, gone) don't stop the run; anything about the set,
      // the session or the network would fail every remaining change too, so stop and report it.
      else if (!isEmoteLevelError(e)) fatal = message;
      return full || !!fatal;
    };

    // Removals first: they free slots for the adds that follow.
    for (const entry of toRemove) {
      if (stopRef.current || sessionRef.current !== s) break;
      setApplyStates((prev) => ({ ...prev, [entry.alias]: { state: "running" } }));
      try {
        await api.removeEmoteFromSet(token, s.target.id, entry.emote.id, entry.alias);
        removedN++;
        setApplyStates((prev) => ({ ...prev, [entry.alias]: { state: "removed" } }));
      } catch (e) {
        if (fail(entry, e)) break;
      }
      await sleep(250);
    }

    for (const row of full || fatal ? [] : toAdd) {
      if (stopRef.current || sessionRef.current !== s) break;
      const emote = desiredEmote(row)!;
      // A name left empty by an interrupted swap keeps the zero-width setting the target had.
      const interrupted = removedRef.current[row.alias];
      setApplyStates((prev) => ({ ...prev, [row.alias]: { state: "running" } }));
      try {
        await api.addEmoteToSet(token, s.target.id, emote.id, aliasFor(row, emote), interrupted?.zeroWidth ?? row.flags.zeroWidth);
        added++;
        if (interrupted) journal(s, row.alias, null);
        setApplyStates((prev) => ({ ...prev, [row.alias]: { state: "added" } }));
      } catch (e) {
        if (fail(row, e)) break;
      }
      await sleep(250);
    }

    // Swaps: remove the current entry, add the new emote under the same name, and roll back on failure.
    for (const row of full || fatal ? [] : toSwap) {
      if (stopRef.current || sessionRef.current !== s) break;
      const cur = targetEntries[row.alias];
      const emote = desiredEmote(row)!;
      setApplyStates((prev) => ({ ...prev, [row.alias]: { state: "running" } }));
      journal(s, row.alias, { emote: cur.emote, zeroWidth: cur.flags.zeroWidth });
      try {
        await api.removeEmoteFromSet(token, s.target.id, cur.emote.id, cur.alias);
      } catch (e) {
        journal(s, row.alias, null);
        if (fail(row, e, " Nothing was changed.")) break;
        continue;
      }
      try {
        await api.addEmoteToSet(token, s.target.id, emote.id, aliasFor(row, emote), cur.flags.zeroWidth);
        swapped++;
        journal(s, row.alias, null);
        setTargetEntries((prev) => ({ ...prev, [row.alias]: { ...cur, emote } }));
        setChoices((prev) => ({ ...prev, [row.alias]: KEEP }));
        setApplyStates((prev) => ({ ...prev, [row.alias]: { state: "updated" } }));
      } catch (e) {
        let restored = false;
        try {
          await api.addEmoteToSet(token, s.target.id, cur.emote.id, aliasFor(row, cur.emote), cur.flags.zeroWidth);
          restored = true;
          journal(s, row.alias, null);
        } catch {
          setTargetEntries((prev) => {
            const next = { ...prev };
            delete next[row.alias];
            return next;
          });
        }
        const suffix = restored
          ? ` The old one (${cur.emote.defaultName}) was put back.`
          : ` The old one (${cur.emote.defaultName}) couldn't be put back. Re-add it on 7tv.app.`;
        if (fail(row, e, suffix)) break;
      }
      await sleep(250);
    }

    setApplyStates((prev) => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(next)) if (v.state === "queued") delete next[k];
      return next;
    });
    setApplying(false);

    if (sessionRef.current !== s) return; // cancelled mid-run
    const done =
      [`${added} added`, swapped && `${swapped} swapped`, removedN && `${removedN} removed`]
        .filter(Boolean)
        .join(", ");
    if (failed || stale.length) setFilter("errors");
    if (full) {
      await ask({
        title: `${s.target.name} is full`,
        body: `7TV turned down a change because ${s.target.name} hit its capacity (${done} before that). Free up some space or skip a few more emotes, then save again.`,
      });
    } else if (fatal) {
      await ask({
        title: "Stopped early",
        body: `${fatal} (${done} before that.) Your picks are saved, so you can carry on once it's sorted.`,
      });
    } else if (failed || stale.length) {
      await ask({
        title: `${plural(failed + stale.length, "emote")} failed`,
        body: `${done}. The rest are listed at the top with the reason. Fix them and save again.`,
      });
    } else if (!stopRef.current) {
      finish(s, added, swapped, removedN);
    }
  };

  /** Every emote is in place: the mapping is complete, so it stops being "in progress". */
  const finish = (s: Session, added: number, swapped: number, removedN: number) => {
    storage.mapping.set(null);
    resetSession();
    setCompleted({ added, swapped, removed: removedN, target: s.target.name });
    // The set picker's emote counts are now out of date; refresh them in the background.
    if (me) api.fetchSetInfos(me.editableEmoteSetIds, token).then(setSets, () => {});
  };

  // ---- Render ----
  const matchesFilter = (row: SetEmote) => {
    const c = choices[row.alias];
    if (filter === "all") return true;
    if (filter === "errors") return applyStates[row.alias]?.state === "error";
    if (filter === "changed") return isMapped(row.alias) && isSwap(row);
    if (filter === "remove") return isExtra(row.alias) && c?.kind === "remove";
    if (isMapped(row.alias) || isExtra(row.alias)) return false;
    if (filter === "undecided") return !c;
    return c?.kind === filter;
  };
  const targetName = session?.target.name ?? "your seasonal set";
  const sectionRows = (kind: Step["kind"]) =>
    steps.flatMap((st, index) => {
      if (st.kind !== kind) return [];
      const row = st.kind === "extra" ? st.entry : stepRow(st)!;
      return matchesFilter(row) ? [{ row, index }] : [];
    });
  const overviewSections = [
    { title: `New to ${targetName}`, rows: sectionRows("pending") },
    { title: `Already in ${targetName}`, rows: sectionRows("mapped") },
    { title: `Only in ${targetName}`, rows: sectionRows("extra"), extra: true },
  ];

  const themeItems = Object.entries(THEMES).map(([id, t]) => ({ id, label: t.label }));
  const filterItems = [
    { id: "all", label: `All (${rows.length + extras.length})` },
    { id: "undecided", label: `Unreviewed (${stats.undecided})` },
    { id: "replace", label: `Seasonal picks (${stats.replace})` },
    { id: "original", label: `Copied as-is (${stats.original})` },
    { id: "exclude", label: `Skipped (${stats.exclude})` },
    ...(session?.mapped.length ? [{ id: "changed", label: `Swapping (${swaps.length})` }] : []),
    ...(extras.length ? [{ id: "remove", label: `Removing (${stats.remove})` }] : []),
    { id: "errors", label: `Failed (${stats.errors})` },
  ];
  const free = capacity == null ? null : capacity - projected;
  // "Add 18 emotes to Halloween" when it's only adds; otherwise one total ("Save 21 changes to Halloween"),
  // with the breakdown shown in the stats and the confirm dialog.
  const changeCount = plan.length + swaps.length + removals.length;
  const applyLabel =
    changeCount === 0
      ? "Finish"
      : changeCount === plan.length
        ? `Add ${plural(plan.length, "emote")} to ${targetName}`
        : `Save ${plural(changeCount, "change")} to ${targetName}`;
  const interrupted = Object.keys(removed);

  const header = (
    <header className="top">
      <h1>
        {/* All three are rendered and CSS picks one from <html data-theme>, which an inline script sets before
            first paint, so the logo is right even before hydration. */}
        <span className="logo" aria-hidden>
          <span className="logo-halloween">🎃</span>
          <span className="logo-winter">❄️</span>
          <span className="logo-neutral">✨</span>
        </span>{" "}
        89TV
      </h1>
      <p className="tagline">Make a seasonal copy of your 7TV emote set</p>
      {me && (
        <div className="me">
          {me.mainConnection?.platformAvatarUrl && <img src={me.mainConnection.platformAvatarUrl} alt="" />}
          <span>{me.mainConnection?.platformDisplayName ?? me.id}</span>
          {mode === "live" && (
            <Button className="link-button" onPress={() => signOut()}>
              Sign out
            </Button>
          )}
        </div>
      )}
    </header>
  );

  // Before hydration (and in the prerendered HTML) only the header shows; nothing below it can be right yet.
  if (!hydrated) return <main>{header}</main>;

  return (
    <main>
      {dialog}
      {header}
      {me && clipboardWarning && (
        <div className="card narrow notice-card" role="alert">
          <span>
            Your browser didn&apos;t let us clear your clipboard, so your token may still be on it. Copy something else
            to overwrite it.
          </span>
          <Button className="link-button" onPress={() => setClipboardWarning(false)}>
            Dismiss
          </Button>
        </div>
      )}

      {!token ? (
        <TokenGate
          onToken={(t) => {
            clearClipboardAfterLogin.current = true;
            setToken(t);
          }}
          error={authError}
        />
      ) : account === "error" ? (
        <section className="card narrow center" role="alert">
          <p>{me ? "Couldn't load your emote sets." : "Couldn't check your 7TV session."}</p>
          <p className="error">{authError}</p>
          <div className="buttons-row">
            <Button className="btn primary" onPress={() => setAccountAttempt((n) => n + 1)}>
              Retry
            </Button>
            <Button className="btn" onPress={() => signOut()}>
              Use a different token
            </Button>
          </div>
        </section>
      ) : !me ? (
        <LoadingCard message="Signing you in…" />
      ) : session ? (
        <>
          <section className="card toolbar" aria-label="Your progress">
            <div className="summary">
              <div className="pair">
                <b>{session.source.name}</b> <span className="muted">→</span> <b>{session.target.name}</b>
              </div>
              <div className="muted small">
                Looking for emotes tagged {session.tags.join(" or ")}, sorted by{" "}
                {SORT_OPTIONS.find((i) => i.id === session.params.sortBy)?.label}
              </div>
              <div className="stats">
                <span>
                  <b>{stats.replace}</b> seasonal
                </span>
                <span>
                  <b>{stats.original}</b> as-is
                </span>
                <span>
                  <b>{stats.exclude}</b> skipped
                </span>
                <span>
                  <b>{stats.undecided}</b> unreviewed
                </span>
                {session.mapped.length > 0 && (
                  <span className="muted">
                    {session.mapped.length} already in {targetName}
                    {swaps.length ? ` (swapping ${swaps.length})` : ""}
                  </span>
                )}
                {extras.length > 0 && (
                  <span className="muted">
                    {extras.length} only in {targetName}
                    {removals.length ? ` (removing ${removals.length})` : ""}
                  </span>
                )}
                {capacity != null && free != null && (
                  <span className={free < 0 ? "error" : "muted"}>
                    {free < 0 ? `${-free} over capacity` : `${plural(free, "slot")} left after saving`}
                  </span>
                )}
              </div>
            </div>
            <div className="buttons">
              {stats.undecided > 0 && (
                <Button className="btn" onPress={jumpToNextUndecided}>
                  Next unreviewed
                </Button>
              )}
              {applying ? (
                <Button className="btn" onPress={() => (stopRef.current = true)}>
                  Stop
                </Button>
              ) : (
                <Button className="btn primary" onPress={apply} isDisabled={preparing}>
                  {preparing ? (
                    <>
                      <Spinner label={`Checking ${targetName}`} size="sm" /> Checking {targetName}…
                    </>
                  ) : (
                    applyLabel
                  )}
                </Button>
              )}
              <Button className="btn ghost-danger" isDisabled={applying} onPress={cancelMapping}>
                Start over
              </Button>
            </div>
            {stats.errors > 0 && !applying && (
              <div className="problems" role="region" aria-label="Failed emotes">
                <h3>{plural(stats.errors, "emote")} failed</h3>
                <ul>
                  {[...rows, ...extras].flatMap((r) =>
                    applyStates[r.alias]?.state === "error"
                      ? [
                          <li key={r.alias}>
                            <Button className="link-button" onPress={() => setIndex(stepOfAlias(r.alias))}>
                              {r.alias}
                            </Button>
                            : {applyStates[r.alias]?.message}
                          </li>,
                        ]
                      : [],
                  )}
                </ul>
              </div>
            )}
            {interrupted.length > 0 && (
              <div className="alert small" role="alert">
                The page closed partway through {interrupted.length === 1 ? "a swap" : `${interrupted.length} swaps`} (
                {interrupted.join(", ")}): the old emote came out but the new one didn&apos;t go in yet. Save again to
                finish, or pick the <i>previously in {targetName}</i> emote to put it back.
              </div>
            )}
            {pause && (
              <div className="notice small" role="status">
                {pause.bucket === "search"
                  ? `You've hit 7TV's search limit. Searching again in ${pause.seconds}s.`
                  : `7TV asked us to slow down. Carrying on in ${pause.seconds}s.`}
              </div>
            )}
            {(applying || addedCount > 0) && (
              <ProgressBar
                className="progress"
                aria-label={`Saving to ${targetName}`}
                value={addedCount}
                maxValue={addedCount + plan.length}
              >
                {({ percentage, valueText }) => (
                  <>
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: `${percentage}%` }} />
                    </div>
                    <span className="muted small">{valueText}</span>
                  </>
                )}
              </ProgressBar>
            )}
          </section>

          {atSummary || atEnd ? (
            <MappingSummary
              key={atEnd ? "end" : "summary"}
              variant={atEnd ? "end" : "summary"}
              canPrev={index > 0}
              counts={stats}
              swapCount={swaps.length}
              removeCount={removals.length}
              mappedCount={session.mapped.length}
              extraCount={extras.length}
              sourceName={session.source.name}
              targetName={session.target.name}
              onJump={jumpTo}
              canApply={!applying && !preparing}
              applyLabel={preparing ? `Checking ${targetName}…` : applyLabel}
              onApply={apply}
              onReviewUndecided={jumpToNextUndecided}
              onNavigate={navigate}
            />
          ) : current ? (
            <MappingFocus
              key={`${session.source.id}:${current.alias}`}
              source={current}
              position={step && "n" in step ? `${step.n} of ${step.of}` : ""}
              canPrev={index > 0}
              canNext={index < stepCount - 1}
              inTarget={targetEntries[current.alias]}
              previous={removed[current.alias]}
              tags={session.tags}
              targetName={session.target.name}
              choice={choiceOf(current.alias)}
              decided={!!choices[current.alias] && !isMapped(current.alias)}
              search={searches[current.alias]}
              apply={applyStates[current.alias]}
              defaultSort={session.params.sortBy}
              onChoose={choose}
              onSearch={(opts) => void runSearch(current, opts)}
              onNavigate={navigate}
            />
          ) : currentExtra && step?.kind === "extra" ? (
            <ExtraFocus
              key={`extra:${currentExtra.alias}`}
              entry={currentExtra}
              position={`${step.n} of ${step.of}`}
              canPrev={index > 0}
              canNext={index < stepCount - 1}
              sourceName={session.source.name}
              targetName={session.target.name}
              choice={choiceOf(currentExtra.alias)}
              apply={applyStates[currentExtra.alias]}
              onChoose={choose}
              onNavigate={navigate}
            />
          ) : null}

          {rows.length + extras.length > 0 && (
            <section className="card" aria-label="All emotes">
              <div className="overview-head">
                <h3>All emotes</h3>
                <SelectField
                  aria-label="Filter emotes"
                  className="compact"
                  items={filterItems}
                  value={filter}
                  onChange={(id) => setFilter(id as Filter)}
                />
              </div>
              <MappingOverview
                sections={overviewSections}
                current={index}
                choices={choices}
                targetEntries={targetEntries}
                applyStates={applyStates}
                onJump={setIndex}
              />
            </section>
          )}
        </>
      ) : (
        <>
          {completed && (
            <section className="card narrow center done" role="status">
              <h2>{completed.target} is up to date</h2>
              <p>
                {[
                  `Added ${plural(completed.added, "emote")}`,
                  completed.swapped && `swapped ${completed.swapped}`,
                  completed.removed && `removed ${completed.removed}`,
                ]
                  .filter(Boolean)
                  .join(", ")}
                .
              </p>
            </section>
          )}

          {resume ? (
            <section className="card narrow center">
              {loadError ? (
                <>
                  <p>Couldn&apos;t pick up where you left off.</p>
                  <p className="error">{loadError}</p>
                  <div className="buttons-row">
                    <Button className="btn primary" onPress={() => void startMapping(resume, resume)}>
                      Try again
                    </Button>
                    <Button className="btn ghost-danger" onPress={cancelMapping}>
                      Start over
                    </Button>
                  </div>
                </>
              ) : (
                <div className="loading-card">
                  <Spinner label="Picking up where you left off" />
                  <p className="muted">Picking up where you left off…</p>
                </div>
              )}
            </section>
          ) : account !== "ready" ? (
            <LoadingCard message="Loading your emote sets…" />
          ) : (
            <section className="card setup" aria-label="Choose your sets">
              <SetPicker
                label="Base set"
                description="Your regular emote set"
                sets={sets}
                value={sourceId}
                onChange={setSourceId}
                allowCustom
              />
              <SetPicker
                label="Seasonal set"
                description="Where to add the seasonal emotes"
                sets={sets}
                value={targetId}
                onChange={setTargetId}
                disabledId={sourceId}
              />
              <div className="field-group">
                <SelectField
                  label="Theme"
                  items={themeItems}
                  value={theme}
                  onChange={(id) => setTheme(id as Theme)}
                  description={theme === "custom" ? undefined : `Search for emotes tagged ${tags.join(" or ")}`}
                />
                {theme === "custom" && (
                  <TextField className="field" value={customTags} onChange={setCustomTags}>
                    <Label className="visually-hidden">Custom tags</Label>
                    <Input placeholder="Tags to look for, e.g. spring, easter" />
                  </TextField>
                )}
              </div>
              <SelectField
                label="Sort by"
                items={SORT_OPTIONS}
                value={sortBy}
                onChange={(id) => setSortBy(id as SortBy)}
              />
              <div className="actions">
                <Button
                  className="btn primary"
                  isDisabled={!sourceId || !targetId || sourceId === targetId || !tags.length || loading}
                  onPress={() =>
                    sourceId && targetId && void startMapping({ sourceId, targetId, theme, customTags, sortBy })
                  }
                >
                  {loading ? (
                    <>
                      <Spinner label="Loading your sets" size="sm" /> Loading your sets…
                    </>
                  ) : (
                    "Start picking"
                  )}
                </Button>
                {sourceId && sourceId === targetId && (
                  <span className="error small">Your base and seasonal sets need to be different.</span>
                )}
                {theme === "custom" && !tags.length && <span className="muted small">Add at least one tag.</span>}
                {loadError && <span className="error small">{loadError}</span>}
                {sets.length === 0 && (
                  <span className="muted small">
                    You can&apos;t edit any emote sets yet. Create your seasonal set on 7tv.app, then reload.
                  </span>
                )}
              </div>
            </section>
          )}
        </>
      )}
      {children}
    </main>
  );
}
