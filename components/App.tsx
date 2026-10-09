"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Dialog,
  Heading,
  Input,
  Label,
  Modal,
  ModalOverlay,
  ProgressBar,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  TextField,
} from "react-aria-components";
import { type DialogOptions, DialogContent, useDialog } from "@/components/Dialog";
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
import { type Section, type Step, buildSteps, stepAlias, stepRow, stepSection } from "@/lib/steps";
import { useServices } from "@/lib/services";
type Filter = "all" | "undecided" | "replace" | "original" | "exclude" | "changed" | "remove" | "errors";


// Searches are the scarce resource (7TV allows ~100 per window), so we only search the emote on screen
// and preload the next one.
const searchLimit = createLimiter(2);
const AUTO_SEARCH_BURST = 3;
const AUTO_SEARCH_WINDOW_MS = 3000;
const AUTO_SEARCH_DELAY_MS = 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** How long "Start picking" waits for the first card before showing it anyway. */
const FIRST_CARD_BUDGET_MS = 1000;
/** Resolves once the image has loaded (or failed), so it's in the cache before it's shown. */
const preloadImage = (src: string) =>
  new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = img.onerror = () => resolve();
    img.src = src;
  });
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
/** A step of the save modal: a message or confirmation (see DialogOptions), or the progress bar. */
type SaveDialog = (DialogOptions & { kind?: undefined }) | { kind: "saving"; confirmLabel?: undefined; dismissable?: undefined };

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
  /** The pasted base-set link didn't resolve when checked on submit; shown on the link field itself. */
  const [sourceLinkError, setSourceLinkError] = useState<string | null>(null);

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
  /** Names changed by the latest save (adds, swaps and removals), for the progress bar. */
  const [run, setRun] = useState<string[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [pause, setPause] = useState<{ bucket: string; seconds: number } | null>(null);

  /**
   * The save modal: one modal for the whole save (confirm, progress, result) that stays open and swaps its
   * content, rather than a modal per step animating in and out.
   */
  const [saveDialog, setSaveDialog] = useState<SaveDialog | null>(null);
  const saveAnswer = useRef<((ok: boolean) => void) | null>(null);
  /** Shows a step with buttons and waits for one (or for a dismiss, which counts as false). */
  const saveStep = (d: Exclude<SaveDialog, { kind: "saving" }>) =>
    new Promise<boolean>((resolve) => {
      saveAnswer.current = resolve;
      setSaveDialog(d);
    });
  const answerSave = (ok: boolean) => {
    saveAnswer.current?.(ok);
    saveAnswer.current = null;
  };
  /** Lets startMapping (defined above runSearch) start the first card's search. */
  const runSearchRef = useRef<(row: SetEmote) => Promise<SearchState>>(() => Promise.reject(new Error("not ready")));
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
    // Wait until startup has loaded the real theme: before that `theme` is just the initial placeholder, and
    // writing it would overwrite the inline <head> script's (correct) palette for a frame.
    if (!hydrated) return;
    document.documentElement.dataset.theme = THEMES[theme].palette;
  }, [theme, hydrated]);

  const resetSession = useCallback(() => {
    sessionRef.current = null;
    searchPromises.current.clear();
    setSession(null);
    setSearches({});
    setApplyStates({});
    setRun(null);
    setTargetEntries({});
    removedRef.current = {};
    setRemovedState({});
    lastInSection.current = {};
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
      setSourceLinkError(null);
      // A pasted link (not one of the user's own sets) is only checked with 7TV now, on submit.
      const pastedSource = !sets.some((x) => x.id === params.sourceId) && !saved;
      if (pastedSource) {
        const found = await api.fetchSetInfo(params.sourceId, token).catch(() => null);
        if (!found) {
          setSourceLinkError("No emote set found at that link. Check it and try again.");
          setLoading(false);
          return;
        }
      }
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
        const doneAt = (section: Section) => steps.findIndex((st) => st.kind === "done" && st.section === section);
        const savedDone = saved?.atDone ?? (saved?.atStep === "summary" ? "pending" : undefined);
        const aliasAt = saved?.currentAlias ? steps.findIndex((st) => stepAlias(st) === saved.currentAlias) : -1;
        const firstUndecided = s.pending.findIndex((r) => !restored[r.alias]);
        const step =
          saved?.atStep === "end"
            ? steps.length - 1 // the last step is always a done step
            : savedDone && doneAt(savedDone) >= 0
              ? doneAt(savedDone)
              : aliasAt >= 0
                ? aliasAt
                : firstUndecided >= 0
                  ? firstUndecided
                  : // Every emote to add is decided: their done step. With none to add, the next section's start.
                    Math.max(0, doneAt("pending"));
        // Swap journal: an entry whose name is back in the target finished (or rolled back) before the page
        // closed. One whose name is still missing was interrupted between remove and re-add; keep it so the
        // user can restore the previous emote.
        const removed = Object.fromEntries(
          Object.entries(saved?.removed ?? {}).filter(([alias]) => !entries.has(alias)),
        );
        resetSession();
        sessionRef.current = s;
        setTargetEntries(
          Object.fromEntries([...mappedRows, ...extraRows].map((r) => [r.alias, entries.get(r.alias)!])),
        );
        setChoices(restored);
        setRemoved(removed);
        // Give the first card up to FIRST_CARD_BUDGET_MS to be ready (its search plus every image on it) while
        // the button shows a spinner, so it doesn't appear half-loaded and shift around. If that takes longer,
        // switch anyway: the card shows its usual loading state, like any other slow card.
        const first = stepRow(steps[step]);
        if (first) {
          const current = entries.get(first.alias)?.emote;
          const ready = runSearchRef.current(first).then((st) =>
            Promise.all(
              [first.emote, current, ...st.items].flatMap((e) => (e ? [preloadImage(emoteImage(e.id, 3))] : [])),
            ),
          );
          await Promise.race([ready, sleep(FIRST_CARD_BUDGET_MS)]);
          if (sessionRef.current !== s) return; // superseded (e.g. cancelled) while waiting
        }
        setIndex(step);
        setSession(s);
        setResume(null);
      } catch (e) {
        setLoadError(friendlyError(e));
      } finally {
        setLoading(false);
      }
    },
    [token, me, resetSession, api, sets],
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
  const pendingDoneStep = steps.findIndex((st) => st.kind === "done" && st.section === "pending");
  const stepOfAlias = useCallback((alias: string) => steps.findIndex((st) => stepAlias(st) === alias), [steps]);
  const rowAtStep = useCallback((i: number) => stepRow(steps[i]), [steps]);
  const doneStep = step?.kind === "done" ? step : undefined;
  const section = step ? stepSection(step) : "pending";
  /** Sections with emotes in them, in order (each is a tab). */
  const sections = useMemo(() => [...new Set(steps.map(stepSection))], [steps]);
  /** The emote on screen: a base emote, or (in "Not in base") a seasonal-set entry. */
  const current = stepRow(step);
  const mappedAliases = useMemo(() => new Set((session?.mapped ?? []).map((r) => r.alias)), [session]);
  const isMapped = (alias: string) => mappedAliases.has(alias);
  const extraAliases = useMemo(() => new Set(extras.map((e) => e.alias)), [extras]);
  const isExtra = (alias: string) => extraAliases.has(alias);

  // Persist the in-progress mapping on every change.
  const persist = useCallback(
    (s: Session) =>
      storage.mapping.set({
        ...s.params,
        choices,
        currentAlias: stepAlias(step),
        atDone: step?.kind === "done" ? step.section : undefined,
        removed: removedRef.current,
      }),
    [choices, step, storage],
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

  runSearchRef.current = runSearch;

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
    setIndex(k >= 0 ? k : pendingDoneStep);
  };
  /** Where the user last was in each section, so switching tabs returns there. */
  const lastInSection = useRef<Partial<Record<Section, number>>>({});
  useEffect(() => {
    if (step) lastInSection.current[stepSection(step)] = index;
  }, [step, index]);
  const goToSection = (to: Section) => {
    const i = lastInSection.current[to] ?? steps.findIndex((st) => stepSection(st) === to);
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
  /** Rows already in the target (in both sets, or only in the target) whose chosen emote differs from it. */
  const isSwap = (row: SetEmote) => {
    const cur = targetEntries[row.alias];
    const want = desiredEmote(row);
    return !!cur && !!want && want.id !== cur.emote.id;
  };

  const plan = pending.filter((r) => choiceOf(r.alias).kind !== "exclude" && applyStates[r.alias]?.state !== "added");
  const swaps = [...(session?.mapped ?? []), ...extras].filter(isSwap);
  /**
   * Seasonal-set entries the user chose to remove, from either section that's already in the target. The entry
   * is whatever the seasonal set currently holds under that name (it may have been swapped since loading).
   */
  const removalEntries = (sess: Session | null): SetEmote[] =>
    [...(sess?.mapped ?? []), ...(sess?.extras ?? [])].flatMap((r) =>
      choiceOf(r.alias).kind === "remove" && targetEntries[r.alias] ? [targetEntries[r.alias]] : [],
    );
  const removals = removalEntries(session).filter((e) => applyStates[e.alias]?.state !== "removed");
  const addedCount = pending.filter((r) => applyStates[r.alias]?.state === "added").length;
  const capacity = session?.target.capacity ?? null;
  // Swapping out an entry whose emote was deleted from 7TV takes a slot (deleted emotes don't count).
  const swapSlots = swaps.filter((r) => targetEntries[r.alias]?.emote.deleted).length;
  const removedCount = removalEntries(session).filter(
    (e) => applyStates[e.alias]?.state === "removed" && !e.emote.deleted,
  ).length;
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
    for (const r of [...extras, ...(session?.mapped ?? [])]) if (choices[r.alias]?.kind === "remove") counts.remove++;
    for (const r of [...rows, ...extras]) if (applyStates[r.alias]?.state === "error") counts.errors++;
    return counts;
  }, [pending, rows, extras, session, choices, applyStates]);

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
    try {
      setPreparing(true);
      try {
        const [info, emotes] = await Promise.all([api.fetchSetInfo(s.target.id, token), api.fetchSetEmotes(s.target.id, token)]);
        if (!info) throw new Error("Your seasonal set no longer exists.");
        fresh = emotes;
        freshCapacity = info.capacity;
      } catch (e) {
        setPreparing(false);
        await saveStep({ title: `Couldn't check ${s.target.name}`, body: friendlyError(e) });
        return;
      }
      setPreparing(false);
      const freshByAlias = new Map(fresh.map((e) => [e.alias, e]));
      const toAdd = s.pending.filter((r) => choiceOf(r.alias).kind !== "exclude" && !freshByAlias.has(r.alias));
      const alreadyThere = s.pending.filter((r) => freshByAlias.has(r.alias));

      // A swap is only safe if the target still holds exactly what we showed the user.
      const toSwap: SetEmote[] = [];
      const stale: SetEmote[] = [];
      for (const r of [...s.mapped, ...s.extras].filter(isSwap)) {
        const now = freshByAlias.get(r.alias);
        if (now && now.emote.id === targetEntries[r.alias]?.emote.id) toSwap.push(r);
        else stale.push(r);
      }
      // Removals: only if the target still holds exactly the emote the user saw under that name.
      const toRemove: SetEmote[] = [];
      const goneAlready: SetEmote[] = [];
      for (const e of removalEntries(s)) {
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
          await saveStep({
            title: "Nothing was saved",
            body: `${plural(stale.length, "emote")} you changed were edited on 7TV in the meantime, so they were left alone. Reload to see the latest.`,
          });
          return;
        }
        return void (await finish(s, 0, 0, 0));
      }

      const used = usedSlots(fresh);
      const slotsNeeded = toAdd.length + toSwap.filter((r) => targetEntries[r.alias]?.emote.deleted).length;
      // Removals run first, so the slots they free count towards the space available.
      const freed = toRemove.filter((e) => !e.emote.deleted).length;
      const free = freshCapacity == null ? Infinity : Math.max(0, freshCapacity - used + freed);
      if (slotsNeeded > free) {
        await saveStep({
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
      const ok = await saveStep({
        title: `Save to ${s.target.name}?`,
        body: (
          <ul>
            {toAdd.length > 0 && (
              <li>
                {/* Only mention the kinds that are there: "Add 3 seasonal emotes", not "…: 3 seasonal, 0 copied". */}
                {replaced === toAdd.length
                  ? `Add ${replaced} seasonal ${replaced === 1 ? "emote" : "emotes"}`
                  : replaced === 0
                    ? `Add ${plural(toAdd.length, "emote")} copied from the base set`
                    : `Add ${plural(toAdd.length, "emote")}: ${replaced} seasonal, ${toAdd.length - replaced} copied from the base set`}
                {undecided ? ` (${undecided} unreviewed)` : ""}
              </li>
            )}
            {toSwap.length > 0 && <li>Swap {plural(toSwap.length, "emote")}</li>}
            {toRemove.length > 0 && <li>Remove {plural(toRemove.length, "emote")}</li>}
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

      setSaveDialog({ kind: "saving" });
      setApplying(true);
      setRun([...toRemove, ...toAdd, ...toSwap].map((r) => r.alias));
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
        if (sessionRef.current !== s) break;
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
        if (sessionRef.current !== s) break;
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
        if (sessionRef.current !== s) break;
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
        await saveStep({
          title: `${s.target.name} is full`,
          body: `7TV turned down a change because ${s.target.name} hit its capacity (${done} before that). Free up some space or skip a few more emotes, then save again.`,
        });
      } else if (fatal) {
        await saveStep({
          title: "Stopped early",
          body: `${fatal} (${done} before that.) Your picks are saved, so you can carry on once it's sorted.`,
        });
      } else if (failed || stale.length) {
        await saveStep({
          title: `${plural(failed + stale.length, "emote")} failed`,
          body: `${done}. The rest are listed at the top with the reason. Fix them and save again.`,
        });
      } else {
        await finish(s, added, swapped, removedN);
      }
    } finally {
      setSaveDialog(null);
    }
  };

  /**
   * Every emote is in place: the mapping is complete, so it stops being "in progress". Says so in the save
   * modal, whose only way out is then Done, which goes back to the setup form.
   */
  const finish = async (s: Session, added: number, swapped: number, removedN: number) => {
    storage.mapping.set(null);
    const parts = [
      added && `added ${plural(added, "emote")}`,
      swapped && `swapped ${swapped}`,
      removedN && `removed ${removedN}`,
    ].filter(Boolean) as string[];
    const summary = parts.length
      ? `${parts.slice(0, -1).join(", ")}${parts.length > 1 ? " and " : ""}${parts.at(-1)}`
      : "";
    await saveStep({
      title: `${s.target.name} is up to date`,
      body: summary ? `${summary[0].toUpperCase()}${summary.slice(1)}.` : "Nothing needed changing.",
      okLabel: "Done",
      dismissable: false,
    });
    resetSession();
    // The set picker's emote counts are now out of date; refresh them in the background.
    if (me) api.fetchSetInfos(me.editableEmoteSetIds, token).then(setSets, () => {});
  };

  // ---- Render ----
  const matchesFilter = (row: SetEmote) => {
    const c = choices[row.alias];
    if (filter === "all") return true;
    if (filter === "errors") return applyStates[row.alias]?.state === "error";
    if (filter === "changed") return (isMapped(row.alias) || isExtra(row.alias)) && isSwap(row);
    if (filter === "remove") return (isExtra(row.alias) || isMapped(row.alias)) && c?.kind === "remove";
    if (isMapped(row.alias) || isExtra(row.alias)) return false;
    if (filter === "undecided") return !c;
    return c?.kind === filter;
  };
  const targetName = session?.target.name ?? "your seasonal set";
  const sectionRows = (kind: Step["kind"]) =>
    steps.flatMap((st, index) => {
      if (st.kind !== kind) return [];
      const row = stepRow(st)!;
      return matchesFilter(row) ? [{ row, index }] : [];
    });
  const sectionTitle: Record<Section, string> = {
    pending: "New",
    mapped: "Already added",
    extra: "Not in base",
  };
  const sectionSize: Record<Section, number> = {
    pending: pending.length,
    mapped: session?.mapped.length ?? 0,
    extra: extras.length,
  };
  const overviewSections = [
    { title: sectionTitle.pending, rows: sectionRows("pending") },
    { title: sectionTitle.mapped, rows: sectionRows("mapped") },
    { title: sectionTitle.extra, rows: sectionRows("extra"), extra: true },
  ];

  const themeItems = Object.entries(THEMES).map(([id, t]) => ({ id, label: t.label }));
  const filterItems = [
    { id: "all", label: `All (${rows.length + extras.length})` },
    { id: "undecided", label: `Unreviewed (${stats.undecided})` },
    { id: "replace", label: `Seasonal picks (${stats.replace})` },
    { id: "original", label: `Copied as-is (${stats.original})` },
    { id: "exclude", label: `Skipped (${stats.exclude})` },
    ...(session?.mapped.length || extras.length ? [{ id: "changed", label: `Swapping (${swaps.length})` }] : []),
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
        ? `Add ${plural(plan.length, "emote")}`
        : `Save ${plural(changeCount, "change")}`;
  // Mid-save the journal holds the swap in flight, which isn't an interruption.
  const interrupted = applying ? [] : Object.keys(removed);
  /** Finished (or failed) changes from the latest save; ones skipped by Stop never leave "queued". */
  const runDone = run?.filter((a) => !["queued", "running"].includes(applyStates[a]?.state ?? "queued")).length ?? 0;

  /** The card for the current step. */
  const card = !session ? null : doneStep ? (
    <MappingSummary
      key={`done:${doneStep.section}`}
      section={doneStep.section}
      next={doneStep.next}
      multiSection={sections.length > 1}
      canPrev={index > 0}
      counts={stats}
      swapCount={swaps.length}
      removeCount={removals.length}
      sectionTitle={sectionTitle}
      canApply={!applying && !preparing}
      applyLabel={preparing ? "Checking your seasonal set…" : applyLabel}
      onApply={apply}
      onReviewUndecided={jumpToNextUndecided}
      onNextSection={goToSection}
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
      choice={choiceOf(current.alias)}
      inBase={!isExtra(current.alias)}
      decided={!!choices[current.alias] && !isMapped(current.alias) && !isExtra(current.alias)}
      search={searches[current.alias]}
      apply={applyStates[current.alias]}
      defaultSort={session.params.sortBy}
      onChoose={choose}
      onSearch={(opts) => void runSearch(current, opts)}
      onNavigate={navigate}
    />
  ) : null;

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
      {/* The demo's account is fake, so there's no user (or Sign out) to show. */}
      {me && mode === "live" && (
        <div className="me">
          {me.mainConnection?.platformAvatarUrl && <img src={me.mainConnection.platformAvatarUrl} alt="" />}
          <span>{me.mainConnection?.platformDisplayName ?? me.id}</span>
          <Button className="link-button" onPress={() => signOut()}>
            Sign out
          </Button>
        </div>
      )}
    </header>
  );

  // Before hydration (and in the prerendered HTML) only the header shows; nothing below it can be right yet.
  if (!hydrated) return <main>{header}</main>;

  return (
    <main>
      {dialog}
      <ModalOverlay
        className="modal-overlay"
        isOpen={!!saveDialog}
        onOpenChange={(open) => !open && answerSave(false)}
        isDismissable={saveDialog?.kind !== "saving" && saveDialog?.dismissable !== false}
        isKeyboardDismissDisabled={saveDialog?.kind === "saving" || saveDialog?.dismissable === false}
      >
        <Modal className="modal">
          <Dialog className="dialog" role={saveDialog?.confirmLabel ? "alertdialog" : "dialog"}>
            {saveDialog?.kind === "saving" ? (
              // Can't be dismissed or stopped: it closes itself once every change has been tried.
              <>
                <Heading slot="title">Saving to {targetName}…</Heading>
                <ProgressBar
                  className="progress"
                  aria-label={`Saving to ${targetName}`}
                  value={runDone}
                  maxValue={run?.length || 1}
                  valueLabel={`${runDone} of ${plural(run?.length ?? 0, "change")}`}
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
                {pause && pause.bucket !== "search" && (
                  <p className="notice small">7TV asked us to slow down. Carrying on in {pause.seconds}s.</p>
                )}
              </>
            ) : (
              saveDialog && <DialogContent {...saveDialog} onClose={answerSave} />
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
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
        <section className="card narrow center stack" role="alert">
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
                    {session.mapped.length} already added
                    {(() => {
                      const swapping = swaps.filter((r) => isMapped(r.alias)).length;
                      const removing = session.mapped.filter((r) => choices[r.alias]?.kind === "remove").length;
                      const parts = [swapping && `swapping ${swapping}`, removing && `removing ${removing}`];
                      return parts.some(Boolean) ? ` (${parts.filter(Boolean).join(", ")})` : "";
                    })()}
                  </span>
                )}
                {extras.length > 0 && (
                  <span className="muted">
                    {extras.length} not in base
                    {(() => {
                      const swapping = swaps.filter((r) => isExtra(r.alias)).length;
                      const removing = extras.filter((e) => choices[e.alias]?.kind === "remove").length;
                      const parts = [swapping && `swapping ${swapping}`, removing && `removing ${removing}`];
                      return parts.some(Boolean) ? ` (${parts.filter(Boolean).join(", ")})` : "";
                    })()}
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
              <Button className="btn primary" onPress={apply} isDisabled={preparing || applying}>
                {preparing ? (
                  <>
                    <Spinner label="Checking your seasonal set" size="sm" /> Checking your seasonal set…
                  </>
                ) : (
                  applyLabel
                )}
              </Button>
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
                finish, or pick the <i>previous</i> emote to put it back.
              </div>
            )}
            {pause && (
              <div className="notice small" role="status">
                {pause.bucket === "search"
                  ? `You've hit 7TV's search limit. Searching again in ${pause.seconds}s.`
                  : `7TV asked us to slow down. Carrying on in ${pause.seconds}s.`}
              </div>
            )}
          </section>

          {sections.length > 1 ? (
            // One tab per section with emotes in it; a single section needs no tabs.
            <Tabs
              className="section-tabs"
              selectedKey={section}
              onSelectionChange={(key) => goToSection(key as Section)}
            >
              <TabList className="section-tab-list" aria-label="Sections">
                {sections.map((sec) => (
                  <Tab key={sec} id={sec} className="section-tab">
                    {sectionTitle[sec]} <span className="section-tab-count">{sectionSize[sec]}</span>
                  </Tab>
                ))}
              </TabList>
              <TabPanel id={section}>{card}</TabPanel>
            </Tabs>
          ) : (
            card
          )}

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

          {resume ? (
            <section className="card narrow center stack">
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
                onChange={(id) => {
                  setSourceId(id);
                  setSourceLinkError(null);
                }}
                allowCustom
                linkError={sourceLinkError}
              />
              <SetPicker
                label="Target set"
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
                  isDisabled={!sourceId || !targetId || sourceId === targetId || !tags.length}
                  isPending={loading}
                  onPress={() =>
                    sourceId && targetId && void startMapping({ sourceId, targetId, theme, customTags, sortBy })
                  }
                >
                  {({ isPending }) => (
                    <>
                      {isPending && <Spinner label="Loading your sets" size="sm" />}
                      Start picking
                    </>
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
