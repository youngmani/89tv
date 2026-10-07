"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Input, Label, ProgressBar, TextField } from "react-aria-components";
import { useDialog } from "@/components/Dialog";
import { MappingFocus } from "@/components/MappingFocus";
import { MappingOverview } from "@/components/MappingOverview";
import { MappingSummary } from "@/components/MappingSummary";
import { SetPicker } from "@/components/SetPicker";
import { TokenGate, cleanToken } from "@/components/TokenGate";
import { SelectField } from "@/components/ui";
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
  clearLegacyStorage,
  clearMapping,
  loadMapping,
  saveMapping,
  themeForDate,
} from "@/lib/mapping";
import { createLimiter } from "@/lib/queue";
import {
  ApiError,
  type EmoteSetInfo,
  type EmoteSummary,
  type Me,
  type SetEmote,
  type SortBy,
  addEmoteToSet,
  emoteImage,
  fetchMe,
  fetchSetEmotes,
  fetchSetInfo,
  fetchSetInfos,
  friendlyError,
  isCapacityError,
  isEmoteLevelError,
  onRateLimitPause,
  removeEmoteFromSet,
  searchEmotes,
  usedSlots,
} from "@/lib/seventv";
import { load, save } from "@/lib/storage";

const TOKEN_KEY = "89tv:token";
type Filter = "all" | "undecided" | "replace" | "original" | "exclude" | "changed" | "errors";


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
  /** pending followed by mapped. The user steps through pending, an "All done!" step, then mapped. */
  rows: SetEmote[];
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

export default function Home() {
  const [hydrated, setHydrated] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [sets, setSets] = useState<EmoteSetInfo[]>([]);

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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [completed, setCompleted] = useState<{ added: number; swapped: number; target: string } | null>(null);

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

  // ---- Bootstrap: token (hash or storage) and any in-progress mapping ----
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const fromHash = hash.get("token");
    if (fromHash) {
      save(TOKEN_KEY, cleanToken(fromHash));
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    clearLegacyStorage();
    setToken(load<string | null>(TOKEN_KEY, null));
    const saved = loadMapping();
    if (saved) {
      setSourceId(saved.sourceId);
      setTargetId(saved.targetId);
      setTheme(saved.theme);
      setCustomTags(saved.customTags);
      setSortBy(saved.sortBy);
      setResume(saved);
    } else {
      setTheme(themeForDate());
    }
    setHydrated(true);
  }, []);

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
      save(TOKEN_KEY, null);
      setToken(null);
      setMe(null);
      setSets([]);
      resetSession();
      setAuthError(reason ?? null);
    },
    [resetSession],
  );

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const user = await fetchMe(token);
        if (cancelled) return;
        if (!user) return signOut("That token isn't valid (7TV didn't recognise the session).");
        save(TOKEN_KEY, token);
        setMe(user);
        setAuthError(null);
        setSets(await fetchSetInfos(user.editableEmoteSetIds, token));
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 401) signOut("Your 7TV session has expired. Please sign in again.");
        else setAuthError(friendlyError(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, signOut]);

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
          fetchSetInfo(params.sourceId, token),
          fetchSetInfo(params.targetId, token),
          fetchSetEmotes(params.sourceId, token),
          fetchSetEmotes(params.targetId, token),
        ]);
        if (!source) throw new Error("The source set no longer exists.");
        if (!target) throw new Error("The target set no longer exists.");
        if (!me.editableEmoteSetIds.includes(target.id)) throw new Error("You don't have edit access to the target set.");
        // An emote counts as already mapped when the target has something under the same name (alias).
        const byAlias = (a: SetEmote, b: SetEmote) => a.alias.localeCompare(b.alias, undefined, { sensitivity: "base" });
        const entries = new Map(targetEmotes.map((e) => [e.alias, e]));
        const pendingRows = sourceEmotes.filter((e) => !entries.has(e.alias)).sort(byAlias);
        const mappedRows = sourceEmotes.filter((e) => entries.has(e.alias)).sort(byAlias);
        const s: Session = {
          params,
          source,
          target,
          pending: pendingRows,
          mapped: mappedRows,
          rows: [...pendingRows, ...mappedRows],
          targetUsed: usedSlots(targetEmotes),
          tags: tagsFor(params.theme, params.customTags),
        };
        const restored = saved?.choices ?? {};
        // Steps: pending emotes, the summary, mapped emotes, then (if any were mapped) an end step.
        const P = pendingRows.length;
        const M = mappedRows.length;
        const rowAt = saved?.currentAlias ? s.rows.findIndex((r) => r.alias === saved.currentAlias) : -1;
        const firstUndecided = s.pending.findIndex((r) => !restored[r.alias]);
        const step = saved?.atStep === "end" && M > 0
          ? P + 1 + M
          : saved?.atStep
            ? P
            : rowAt >= 0
            ? rowAt < P
              ? rowAt
              : rowAt + 1
            : firstUndecided >= 0
              ? firstUndecided
              : P;
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
    [token, me, resetSession],
  );

  // Resume the saved mapping as soon as we know who the user is.
  useEffect(() => {
    if (me && resume && !session && !loading && !loadError) void startMapping(resume, resume);
  }, [me, resume, session, loading, loadError, startMapping]);

  const pending = useMemo(() => session?.pending ?? [], [session]);
  const rows = useMemo(() => session?.rows ?? [], [session]);
  // Steps: [pending emotes…, "All done!" summary, already-mapped emotes…, "All done!" end].
  // The end step only exists when there are already-mapped emotes; otherwise the summary is the end.
  const summaryStep = pending.length;
  const mappedCount = session?.mapped.length ?? 0;
  const endStep = mappedCount > 0 ? summaryStep + 1 + mappedCount : summaryStep;
  const stepCount = endStep + 1;
  /** Step index for rows[i]: mapped rows sit one past the summary step. */
  const stepOfRow = useCallback((i: number) => (i < summaryStep ? i : i + 1), [summaryStep]);
  const rowAtStep = useCallback(
    (step: number): SetEmote | undefined =>
      step < summaryStep ? rows[step] : step > summaryStep && step < endStep ? rows[step - 1] : undefined,
    [rows, summaryStep, endStep],
  );
  const atSummary = !!session && index === summaryStep;
  const atEnd = !!session && !atSummary && index === endStep;
  const current = atSummary || atEnd ? undefined : rowAtStep(index);
  const isMapped = (alias: string) => alias in targetEntries;

  // Persist the in-progress mapping on every change.
  const persist = useCallback(
    (s: Session) =>
      saveMapping({
        ...s.params,
        choices,
        currentAlias: current?.alias ?? null,
        atStep: atSummary ? "summary" : atEnd ? "end" : undefined,
        removed: removedRef.current,
      }),
    [choices, current, atSummary, atEnd],
  );
  useEffect(() => {
    if (session) persist(session);
  }, [session, persist, removed]);

  const cancelMapping = async () => {
    const ok = await ask({
      title: "Cancel this mapping?",
      body: "Your choices will be discarded. Changes already made to the target set stay there.",
      confirmLabel: "Cancel mapping",
      destructive: true,
    });
    if (!ok) return;
    stopRef.current = true;
    clearMapping();
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
      query: row.emote.defaultName,
      exact: true,
      tagged: true,
      sortBy: s.params.sortBy,
      ...opts,
    };
    const base = { ...o, items: [], total: 0, hidden: 0 };
    // Keep the previous results while loading so the tiles don't blink out; the UI dims them under a spinner.
    setSearches((prev) => ({
      ...prev,
      [alias]: { ...base, items: prev[alias]?.items ?? [], status: "loading" },
    }));
    const p = searchLimit(async (): Promise<SearchState> => {
      if (sessionRef.current !== s) throw new Error("cancelled"); // don't spend quota on a stale session
      const res = await searchEmotes({
        query: o.query,
        tags: o.tagged ? s.tags : [],
        sortBy: o.sortBy,
        exactMatch: o.exact,
        targetSetId: s.target.id,
      });
      // The original itself may carry the seasonal tag; it's already offered as "original". Private and
      // deleted emotes can't be added, so they're dropped (and counted) rather than offered.
      const others = res.items.filter((e) => e.id !== row.emote.id);
      const items = others.filter((e) => !e.deleted && !e.flags.private);
      return { ...base, status: "done", items, total: res.total, hidden: others.length - items.length };
    })
      .catch((e): SearchState => ({ ...base, status: "error", error: friendlyError(e) }))
      .then((state) => {
        if (sessionRef.current === s) setSearches((prev) => ({ ...prev, [alias]: state }));
        return state;
      });
    searchPromises.current.set(alias, p);
    return p;
  }, []);

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
      if (!current) return;
      setChoices((prev) => ({ ...prev, [current.alias]: choice }));
      if (advance) navigate(1);
    },
    [current, navigate],
  );

  const jumpToNextUndecided = () => {
    const open = (r: SetEmote) => !choices[r.alias] && applyStates[r.alias]?.state !== "added";
    const i = pending.findIndex((r, j) => j > index && open(r));
    const k = i >= 0 ? i : pending.findIndex(open);
    setIndex(k >= 0 ? k : summaryStep);
  };

  // ---- Applying ----
  /** Emotes not yet in the target default to the original; ones already there default to staying as-is. */
  const choiceOf = (alias: string): Choice => choices[alias] ?? (isMapped(alias) ? KEEP : ORIGINAL);
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
  const addedCount = pending.filter((r) => applyStates[r.alias]?.state === "added").length;
  const capacity = session?.target.capacity ?? null;
  // Swapping out an entry whose emote was deleted from 7TV takes a slot (deleted emotes don't count).
  const swapSlots = swaps.filter((r) => targetEntries[r.alias]?.emote.deleted).length;
  const projected = (session?.targetUsed ?? 0) + addedCount + plan.length + swapSlots;

  const stats = useMemo(() => {
    const counts = { replace: 0, original: 0, exclude: 0, undecided: 0, errors: 0 };
    for (const r of pending) {
      const c = choices[r.alias];
      const done = applyStates[r.alias]?.state === "added";
      if (c && c.kind !== "keep") counts[c.kind]++;
      else if (!done) counts.undecided++; // already-added emotes don't need reviewing
    }
    for (const r of rows) if (applyStates[r.alias]?.state === "error") counts.errors++;
    return counts;
  }, [pending, rows, choices, applyStates]);

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
    if (!s || !token) return;

    // Re-read the target right before writing: earlier (partial) runs, or edits made elsewhere, may have
    // already added some of these emotes, and only the emotes still missing need free slots.
    let fresh: SetEmote[];
    let freshCapacity: number | null;
    try {
      const [info, emotes] = await Promise.all([fetchSetInfo(s.target.id, token), fetchSetEmotes(s.target.id, token)]);
      if (!info) throw new Error("The target set no longer exists.");
      fresh = emotes;
      freshCapacity = info.capacity;
    } catch (e) {
      await ask({ title: "Couldn't read the target set", body: friendlyError(e) });
      return;
    }
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
    setApplyStates((prev) => {
      const next = { ...prev };
      for (const r of alreadyThere) next[r.alias] = { state: "added" };
      for (const r of stale)
        next[r.alias] = {
          state: "error",
          message: "This emote changed on 7TV since the mapping was loaded, so it was left alone. Reload to see it.",
        };
      return next;
    });

    if (!toAdd.length && !toSwap.length) {
      if (stale.length) {
        await ask({
          title: "Nothing was changed",
          body: `${plural(stale.length, "emote")} you changed were edited on 7TV in the meantime and were left alone.`,
        });
        return;
      }
      return finish(s, 0, 0);
    }

    const used = usedSlots(fresh);
    const slotsNeeded = toAdd.length + toSwap.filter((r) => targetEntries[r.alias]?.emote.deleted).length;
    const free = freshCapacity == null ? Infinity : Math.max(0, freshCapacity - used);
    if (slotsNeeded > free) {
      await ask({
        title: "Not enough space in the target set",
        body: (
          <>
            <p>
              <b>{s.target.name}</b> has {plural(free, "free slot")} ({used}/{freshCapacity} used), but{" "}
              {plural(slotsNeeded, "emote")} still need a slot
              {alreadyThere.length ? ` (${alreadyThere.length} are already there and don't need space)` : ""}.
            </p>
            <p>
              Mark at least {slotsNeeded - free} more as <i>don&apos;t copy</i>, or raise the set&apos;s capacity on
              7tv.app.
            </p>
          </>
        ),
      });
      return;
    }

    const replaced = toAdd.filter((r) => choiceOf(r.alias).kind === "replace").length;
    const undecided = toAdd.filter((r) => !choices[r.alias]).length;
    const ok = await ask({
      title: `Update ${s.target.name}?`,
      body: (
        <ul>
          {toAdd.length > 0 && (
            <li>
              Add {plural(toAdd.length, "emote")}: {plural(replaced, "seasonal replacement")},{" "}
              {plural(toAdd.length - replaced, "original")}
              {undecided ? ` (${undecided} not reviewed yet)` : ""}
            </li>
          )}
          {toSwap.length > 0 && (
            <li>
              Swap {plural(toSwap.length, "emote")} already in the set: each current emote is removed and the new one
              added under the same name. If adding fails, the previous emote is put back.
            </li>
          )}
          {freshCapacity != null && (
            <li>
              {used + slotsNeeded}/{freshCapacity} slots used afterwards
            </li>
          )}
        </ul>
      ),
      confirmLabel: toSwap.length ? "Update set" : "Add emotes",
    });
    if (!ok) return;

    stopRef.current = false;
    setApplying(true);
    setApplyStates((prev) => {
      const next = { ...prev };
      for (const r of [...toAdd, ...toSwap]) next[r.alias] = { state: "queued" };
      return next;
    });
    let added = 0;
    let swapped = 0;
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

    for (const row of toAdd) {
      if (stopRef.current || sessionRef.current !== s) break;
      const emote = desiredEmote(row)!;
      // A name left empty by an interrupted swap keeps the zero-width setting the target had.
      const interrupted = removedRef.current[row.alias];
      setApplyStates((prev) => ({ ...prev, [row.alias]: { state: "running" } }));
      try {
        await addEmoteToSet(token, s.target.id, emote.id, aliasFor(row, emote), interrupted?.zeroWidth ?? row.flags.zeroWidth);
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
        await removeEmoteFromSet(token, s.target.id, cur.emote.id, cur.alias);
      } catch (e) {
        journal(s, row.alias, null);
        if (fail(row, e, " Nothing was changed.")) break;
        continue;
      }
      try {
        await addEmoteToSet(token, s.target.id, emote.id, aliasFor(row, emote), cur.flags.zeroWidth);
        swapped++;
        journal(s, row.alias, null);
        setTargetEntries((prev) => ({ ...prev, [row.alias]: { ...cur, emote } }));
        setChoices((prev) => ({ ...prev, [row.alias]: KEEP }));
        setApplyStates((prev) => ({ ...prev, [row.alias]: { state: "updated" } }));
      } catch (e) {
        let restored = false;
        try {
          await addEmoteToSet(token, s.target.id, cur.emote.id, aliasFor(row, cur.emote), cur.flags.zeroWidth);
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
          ? ` The previous emote (${cur.emote.defaultName}) was put back.`
          : ` The previous emote (${cur.emote.defaultName}) couldn't be put back; re-add it on 7tv.app.`;
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
    const done = `${plural(added, "emote")} added${swapped ? `, ${swapped} swapped` : ""}`;
    if (failed || stale.length) setFilter("errors");
    if (full) {
      await ask({
        title: "The target set is full",
        body: `7TV rejected a change because ${s.target.name} reached its capacity (${done} before that). Free up space or mark more emotes as don't copy, then continue.`,
      });
    } else if (fatal) {
      await ask({
        title: "Stopped",
        body: `${fatal} (${done} before this happened.) Your mapping is saved, so you can continue once it's sorted out.`,
      });
    } else if (failed || stale.length) {
      await ask({
        title: `${plural(failed + stale.length, "emote")} couldn't be updated`,
        body: `${done}. The ones that didn't go through are listed under "Couldn't update" with the reason.`,
      });
    } else if (!stopRef.current) {
      finish(s, added, swapped);
    }
  };

  /** Every emote is in place: the mapping is complete, so it stops being "in progress". */
  const finish = (s: Session, added: number, swapped: number) => {
    clearMapping();
    resetSession();
    setCompleted({ added, swapped, target: s.target.name });
  };

  // ---- Render ----
  const matchesFilter = (row: SetEmote) => {
    const c = choices[row.alias];
    if (filter === "all") return true;
    if (filter === "errors") return applyStates[row.alias]?.state === "error";
    if (filter === "changed") return isMapped(row.alias) && isSwap(row);
    if (isMapped(row.alias)) return false;
    if (filter === "undecided") return !c;
    return c?.kind === filter;
  };
  const overviewSections = [
    { title: "To add", rows: pending.map((row, i) => ({ row, index: i })).filter(({ row }) => matchesFilter(row)) },
    {
      title: "Already in the target",
      rows: (session?.mapped ?? [])
        .map((row, i) => ({ row, index: summaryStep + 1 + i }))
        .filter(({ row }) => matchesFilter(row)),
    },
  ];

  if (!hydrated) return null;

  const themeItems = Object.entries(THEMES).map(([id, t]) => ({ id, label: t.label }));
  const filterItems = [
    { id: "all", label: `All (${rows.length})` },
    { id: "undecided", label: `Not reviewed (${stats.undecided})` },
    { id: "replace", label: `Seasonal (${stats.replace})` },
    { id: "original", label: `Kept original (${stats.original})` },
    { id: "exclude", label: `Not copied (${stats.exclude})` },
    { id: "changed", label: `Changed, already in target (${swaps.length})` },
    { id: "errors", label: `Failed (${stats.errors})` },
  ];
  const free = capacity == null ? null : capacity - projected;
  const targetName = session?.target.name ?? "";
  const applyLabel =
    plan.length && swaps.length
      ? `Add ${plan.length}, swap ${swaps.length} in ${targetName}`
      : plan.length
        ? `Add ${plural(plan.length, "emote")} to ${targetName}`
        : swaps.length
          ? `Swap ${plural(swaps.length, "emote")} in ${targetName}`
          : "Finish mapping";
  const interrupted = Object.keys(removed);

  return (
    <main>
      {dialog}
      <header className="top">
        <h1>
          <span className="logo" aria-hidden>
            {theme === "christmas" ? "❄️" : theme === "halloween" ? "🎃" : "✨"}
          </span>{" "}
          89TV
        </h1>
        <p className="tagline">Make a seasonal copy of your 7TV emote set</p>
        {me && (
          <div className="me">
            {me.mainConnection?.platformAvatarUrl && <img src={me.mainConnection.platformAvatarUrl} alt="" />}
            <span>{me.mainConnection?.platformDisplayName ?? me.id}</span>
            <Button className="link-button" onPress={() => signOut()}>
              Sign out
            </Button>
          </div>
        )}
      </header>

      {!token ? (
        <TokenGate onToken={setToken} error={authError} />
      ) : !me ? (
        <section className="card narrow center">
          {authError ? (
            <>
              <p className="error">{authError}</p>
              <Button className="btn" onPress={() => signOut()}>
                Use a different token
              </Button>
            </>
          ) : (
            <p className="muted">Checking your 7TV session…</p>
          )}
        </section>
      ) : session ? (
        <>
          <section className="card toolbar" aria-label="Mapping in progress">
            <div className="summary">
              <div className="pair">
                <b>{session.source.name}</b> <span className="muted">→</span> <b>{session.target.name}</b>
              </div>
              <div className="muted small">
                {THEMES[session.params.theme].label} · tags {session.tags.join(", ")} ·{" "}
                {SORT_OPTIONS.find((i) => i.id === session.params.sortBy)?.label}
              </div>
              <div className="stats">
                <span>
                  <b>{stats.replace}</b> seasonal
                </span>
                <span>
                  <b>{stats.original}</b> kept
                </span>
                <span>
                  <b>{stats.exclude}</b> not copied
                </span>
                <span>
                  <b>{stats.undecided}</b> to review
                </span>
                <span className="muted">
                  {session.mapped.length} already in target
                  {swaps.length ? ` (${swaps.length} to swap)` : ""}
                </span>
                {capacity != null && free != null && (
                  <span className={free < 0 ? "error" : "muted"}>
                    {free < 0 ? `${-free} over capacity` : `${plural(free, "slot")} left after adding`}
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
                <Button className="btn primary" onPress={apply}>
                  {applyLabel}
                </Button>
              )}
              <Button className="btn ghost-danger" isDisabled={applying} onPress={cancelMapping}>
                Cancel mapping
              </Button>
            </div>
            {stats.errors > 0 && !applying && (
              <div className="problems" role="region" aria-label="Emotes that couldn't be updated">
                <h3>Couldn&apos;t update {plural(stats.errors, "emote")}</h3>
                <ul>
                  {rows.flatMap((r, i) =>
                    applyStates[r.alias]?.state === "error"
                      ? [
                          <li key={r.alias}>
                            <Button className="link-button" onPress={() => setIndex(stepOfRow(i))}>
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
                {plural(interrupted.length, "swap")} ({interrupted.join(", ")}) {interrupted.length === 1 ? "was" : "were"}{" "}
                interrupted when the page closed: the old emote was removed but the new one wasn&apos;t added yet.
                Press Add to finish, or pick the <i>previously in target</i> emote to restore it.
              </div>
            )}
            {pause && (
              <div className="notice small" role="status">
                {pause.bucket === "search"
                  ? `7TV's search rate limit was reached. Searches resume in ${pause.seconds}s.`
                  : `7TV is rate limiting requests. Continuing in ${pause.seconds}s.`}
              </div>
            )}
            {(applying || addedCount > 0) && (
              <ProgressBar
                className="progress"
                aria-label="Adding emotes"
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
              mappedCount={atEnd ? 0 : session.mapped.length}
              targetName={session.target.name}
              canApply={!applying}
              applyLabel={applyLabel}
              onApply={apply}
              onReviewUndecided={jumpToNextUndecided}
              onNavigate={navigate}
            />
          ) : current ? (
            <MappingFocus
              key={`${session.source.id}:${current.alias}`}
              source={current}
              position={
                index < summaryStep
                  ? `${index + 1} of ${summaryStep}`
                  : `${index - summaryStep} of ${session.mapped.length}`
              }
              canPrev={index > 0}
              canNext={index < stepCount - 1}
              inTarget={targetEntries[current.alias]}
              previous={removed[current.alias]}
              tags={session.tags}
              choice={choiceOf(current.alias)}
              decided={!!choices[current.alias] && !isMapped(current.alias)}
              search={searches[current.alias]}
              apply={applyStates[current.alias]}
              defaultSort={session.params.sortBy}
              onChoose={choose}
              onSearch={(opts) => void runSearch(current, opts)}
              onNavigate={navigate}
            />
          ) : null}

          {rows.length > 0 && (
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
              <h2>Done!</h2>
              <p>
                Added {plural(completed.added, "emote")}
                {completed.swapped ? ` and swapped ${completed.swapped}` : ""} in <b>{completed.target}</b>. The
                mapping is complete.
              </p>
            </section>
          )}

          {resume ? (
            <section className="card narrow center">
              {loadError ? (
                <>
                  <p>Your in-progress mapping couldn&apos;t be loaded:</p>
                  <p className="error">{loadError}</p>
                  <div className="buttons-row">
                    <Button className="btn primary" onPress={() => void startMapping(resume, resume)}>
                      Try again
                    </Button>
                    <Button className="btn ghost-danger" onPress={cancelMapping}>
                      Discard it
                    </Button>
                  </div>
                </>
              ) : (
                <p className="muted">Resuming your in-progress mapping…</p>
              )}
            </section>
          ) : (
            <section className="card setup" aria-label="Start a mapping">
              <SetPicker label="Copy from" sets={sets} value={sourceId} onChange={setSourceId} allowCustom />
              <SetPicker
                label="Into (seasonal set, must already exist)"
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
                  description={theme === "custom" ? undefined : `Searches emotes tagged ${tags.join(" or ")}`}
                />
                {theme === "custom" && (
                  <TextField className="field" value={customTags} onChange={setCustomTags}>
                    <Label className="visually-hidden">Custom tags</Label>
                    <Input placeholder="tags, comma separated (e.g. spring, easter)" />
                  </TextField>
                )}
              </div>
              <SelectField
                label="Sort results by"
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
                  {loading ? "Loading…" : "Start mapping"}
                </Button>
                {sourceId && sourceId === targetId && <span className="error small">Pick two different sets.</span>}
                {theme === "custom" && !tags.length && <span className="muted small">Enter at least one tag.</span>}
                {loadError && <span className="error small">{loadError}</span>}
                {sets.length === 0 && (
                  <span className="muted small">
                    No editable emote sets found on your account. Create the seasonal set on 7tv.app first.
                  </span>
                )}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
