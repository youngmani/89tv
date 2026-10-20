"use client";

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import {
  Button,
  Heading,
  Input,
  Label,
  ProgressBar,
  Sheet,
  SheetBackdrop,
  SheetContent,
  SheetOverlay,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  TextField,
} from "react-aria-components";
import { type DialogOptions, DialogContent, ModalShell, useDialog } from "@/components/Dialog";
import { Image } from "@/components/Image";
import { MappingFocus } from "@/components/MappingFocus";
import { MappingOverview } from "@/components/MappingOverview";
import { MappingSummary } from "@/components/MappingSummary";
import { SetPicker } from "@/components/SetPicker";
import { SiteHeader } from "@/components/SiteHeader";
import { TokenGate } from "@/components/TokenGate";
import { ErrorText, LoadingCard, LogInAgainContext, SelectField, Spinner } from "@/components/ui";
import {
  type ApplyState,
  type Choice,
  DEFAULT_SORT,
  KEEP,
  type MappingParams,
  type MappingRecord,
  type RemovedEntry,
  ORIGINAL,
  SORT_OPTIONS,
  type SearchOptions,
  type SearchState,
  THEMES,
  type Theme,
  themeForDate,
  mappingParams,
  type Outcome,
  outcome,
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
  canAddTo,
  emoteImage,
  freeSearches,
  friendlyError,
  isCapacityError,
  isEmoteLevelError,
  onRateLimitPause,
  parseEmoteId,
  searchWait,
  usedSlots,
} from "@/lib/seventv";
import { type Section, type Step, buildSteps, stepAlias, stepRow, stepSection } from "@/lib/steps";
import { useServices } from "@/lib/services";
import { listOf, plural, preloadImage, sleep } from "@/lib/util";

type Filter = "all" | "replace" | "original" | "exclude" | "changed" | "remove" | "errors";

// Searches are the scarce resource (7TV allows 100 a minute, paced in lib/seventv.ts), so we only search the
// emote on screen and preload the next one.
const searchLimit = createLimiter(2);
/** Cards shown less than this apart count as flicking through: searching waits until the user stops this long. */
const SETTLE_MS = 300;
/** Saves expected to take at least this long say so before starting; below it, time left is "less than a minute". */
const LONG_SAVE_MS = 45_000;
const duration = (ms: number) =>
  ms < 90_000 ? "about a minute" : `about ${Math.round(ms / 60_000)} minutes`;

/** How long "Start picking" waits for the first card before showing it anyway. */
const FIRST_CARD_BUDGET_MS = 1000;

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
  rows: SetEmote[];
  steps: Step[];
  tags: string[];
}

const byAlias = (a: SetEmote, b: SetEmote) =>
  a.alias.localeCompare(b.alias, undefined, { sensitivity: "base" });

// Re-apply the source alias, but only when it differs from the new emote's own name.
const aliasFor = (row: SetEmote, emote: EmoteSummary) =>
  row.alias !== emote.defaultName ? row.alias : undefined;

const tagsFor = (theme: Theme, customTags: string) =>
  theme === "custom"
    ? customTags
        .split(/[,\s]+/)
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
    : [...THEMES[theme].tags];

const toRecord = (
  s: Session,
  choices: Record<string, Choice>,
  step: Step | undefined,
  removed: Record<string, RemovedEntry>,
): MappingRecord => ({
  ...s.params,
  choices,
  currentAlias: stepAlias(step),
  atDone: step?.kind === "done" ? step.section : undefined,
  removed,
});

const sectionTitle: Record<Section, string> = {
  pending: "New",
  mapped: "Already added",
  extra: "Not in base",
};

/**
 * For the filters, an already-added emote counts as a seasonal pick or a copy by what the target ends up with:
 * a different emote than the base one, or the base emote itself. Removed ones are neither.
 */
const resultKind = (row: SetEmote, o: Outcome): "replace" | "original" | null =>
  o.kind === "remove" || o.kind === "skip"
    ? null
    : o.emote.id === row.emote.id
      ? "original"
      : "replace";

interface FilterState {
  choices: Record<string, Choice>;
  targetEntries: Record<string, SetEmote>;
  applyStates: Record<string, ApplyState>;
  mapped: Set<string>;
  extra: Set<string>;
}

function rowMatches(row: SetEmote, f: Filter, fs: FilterState): boolean {
  if (f === "all") return true;
  if (f === "errors") return fs.applyStates[row.alias]?.state === "error";
  const c = fs.choices[row.alias];
  const cur = fs.targetEntries[row.alias];
  const o = outcome(row, c ?? (cur ? KEEP : ORIGINAL), cur);
  if (f === "changed") return o.kind === "swap";
  if (f === "remove") return o.kind === "remove";
  if (fs.mapped.has(row.alias)) return resultKind(row, o) === f;
  if (fs.extra.has(row.alias)) return false;
  // A new emote with no pick is copied as-is.
  if (f === "original") return !c ? !cur : c.kind === "original";
  return c?.kind === f;
}

interface Visibility {
  /** Per step: matching emotes, and the done card of each section that has any (all of them with no filter). */
  visible: boolean[];
  matching: Set<Section>;
  first: number | null;
  /** Per step: its 1-based place among the visible emotes of its section (0 when hidden or a done card). */
  rank: number[];
  shown: Record<Section, number>;
}

function visibilityFor(steps: Step[], f: Filter, fs: FilterState): Visibility {
  const visible = steps.map((st) => st.kind !== "done" && rowMatches(stepRow(st)!, f, fs));
  const matching = new Set<Section>();
  const shown: Record<Section, number> = { pending: 0, mapped: 0, extra: 0 };
  const rank = steps.map((st, i) => {
    if (!visible[i]) return 0;
    const sec = stepSection(st);
    matching.add(sec);
    return ++shown[sec];
  });
  steps.forEach((st, i) => {
    if (st.kind === "done") visible[i] = f === "all" || matching.has(st.section);
  });
  const first = steps.findIndex((st, i) => st.kind !== "done" && visible[i]);
  return { visible, matching, first: first >= 0 ? first : null, rank, shown };
}

type SaveDialog =
  | (DialogOptions & { kind?: undefined })
  | { kind: "saving"; confirmLabel?: undefined; dismissable?: undefined };

/**
 * The whole app. API and storage come from <ServicesProvider> (live on /, faked on /demo).
 * `headerAction` goes where the live app shows the user and Sign out (e.g. /demo's exit link).
 */
export function App({ headerAction }: { headerAction?: React.ReactNode }) {
  // Stable for the page's lifetime (created once), so depending on these never re-runs effects/callbacks.
  const { api, storage, mode, initialSelection, changeDelay, saveTime } = useServices();
  const [hydrated, setHydrated] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [sets, setSets] = useState<EmoteSetInfo[]>([]);
  /** The account check and the editable-set list load as one blocking phase (nothing to do until both land). */
  const [account, setAccount] = useState<"idle" | "checking" | "loading-sets" | "ready" | "error">(
    "idle",
  );
  /** Set when the user just logged in from the clipboard, so it's wiped once the token checks out. */
  const clearClipboardAfterLogin = useRef(false);
  const [clipboardWarning, setClipboardWarning] = useState(false);
  /** Numbers each account check; a newer check, or signing out, makes an older one stop where it is. */
  const accountCheck = useRef(0);

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

  const [choices, setChoices] = useState<Record<string, Choice>>({});
  /** The card the user navigated to. The one shown is `index` (below): the same, unless the filter hides it. */
  const [navIndex, setNavIndex] = useState(0);
  const [searches, setSearches] = useState<Record<string, SearchState>>({});
  const [applyStates, setApplyStates] = useState<Record<string, ApplyState>>({});
  /**
   * What the target holds under each name, kept current through every add, swap and removal. This (not which
   * section a row was loaded into) is what decides whether a name is in the target.
   */
  const [targetEntries, setTargetEntries] = useState<Record<string, SetEmote>>({});
  const setTargetEntry = useCallback((alias: string, entry: SetEmote | null) => {
    setTargetEntries((prev) => {
      const next = { ...prev };
      if (entry) next[alias] = entry;
      else delete next[alias];
      return next;
    });
  }, []);
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
  /** Estimated time left on the save in progress, in ms; re-estimated from the actual pace after each change. */
  const [runLeft, setRunLeft] = useState(0);
  const [filter, setFilter] = useState<Filter>("all");
  const [listOpen, setListOpen] = useState(false);
  /**
   * Whether the drawer was opened by touch. Only touch can swipe it away (a drag is a scroll), so that shows the
   * drag handle; a mouse, pen or keyboard gets a close button instead.
   */
  const [listByTouch, setListByTouch] = useState(false);
  const [pause, setPause] = useState<{ bucket: string; seconds: number } | null>(null);

  /** The save modal: one modal for the whole save (confirm, progress, result) that swaps its content. */
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
  const sessionRef = useRef<Session | null>(null);
  /** Where the user last was in each section, so switching tabs returns there. Only read in event handlers. */
  const lastInSection = useRef<Partial<Record<Section, number>>>({});
  const searchPromises = useRef(new Map<string, Promise<SearchState>>());
  /** Aborts each emote's latest search; a newer search for the same emote, or a reset, cancels it. */
  const searchControllers = useRef(new Map<string, AbortController>());
  const { dialog, ask } = useDialog();

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

  useEffect(() => {
    // Wait until startup has loaded the real theme: before that `theme` is just the initial placeholder, and
    // writing it would overwrite the inline <head> script's (correct) palette for a frame.
    if (!hydrated) return;
    document.documentElement.dataset.theme = THEMES[theme].palette;
  }, [theme, hydrated]);

  const resetSession = useCallback(() => {
    sessionRef.current = null;
    searchPromises.current.clear();
    searchControllers.current.forEach((c) => c.abort());
    searchControllers.current.clear();
    setSession(null);
    setSearches({});
    setApplyStates({});
    setRun(null);
    setRunLeft(0);
    setSaveDialog(null);
    setFilter("all");
    setListOpen(false);
    setTargetEntries({});
    removedRef.current = {};
    setRemovedState({});
    lastInSection.current = {};
    setChoices({});
    setNavIndex(0);
  }, []);

  const signOut = useCallback(
    (reason?: string) => {
      accountCheck.current++;
      storage.token.set(null);
      setToken(null);
      setMe(null);
      setSets([]);
      setAccount("idle");
      resetSession();
      setAuthError(reason ?? null);
      // The in-progress mapping stays saved; pick it up again once the user is logged back in.
      setResume(storage.mapping.get());
      setLoadError(null);
    },
    [resetSession, storage],
  );
  /** "Log in" in an expired-session error: closes the save modal if it's open, then back to the login screen. */
  const logInAgain = useCallback(() => {
    saveAnswer.current?.(false);
    saveAnswer.current = null;
    signOut();
  }, [signOut]);

  const tags = useMemo(() => tagsFor(theme, customTags), [theme, customTags]);

  // ---- Searching ----
  const runSearch = useCallback(
    (row: SetEmote, opts?: Partial<SearchOptions>): Promise<SearchState> => {
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
      // Only the latest search for an emote matters: cancel the one it replaces, request and all.
      searchControllers.current.get(alias)?.abort();
      const controller = new AbortController();
      const { signal } = controller;
      searchControllers.current.set(alias, controller);
      // Keep the previous results while loading so the tiles don't blink out; the UI dims them under a spinner.
      setSearches((prev) => ({
        ...prev,
        [alias]: { ...base, items: prev[alias]?.items ?? [], status: "loading" },
      }));
      // The base emote is already offered as its own tile. Emotes 7TV won't add to the target (deleted ones,
      // and private ones unless the target's owner uploaded them) are dropped (and counted) rather than offered.
      const usable = (found: SearchResult[]) => {
        const others = found.filter((e) => e.id !== row.emote.id);
        const items = others.filter((e) => canAddTo(e, s.target.ownerId));
        return { items, hidden: others.length - items.length };
      };
      const p = searchLimit(async (): Promise<SearchState> => {
        signal.throwIfAborted(); // cancelled while queued: don't spend quota
        if (linkedId) {
          // Exact lookup first; filters don't apply to a specific emote.
          const emote = await api
            .fetchEmoteById(linkedId, s.target.id, undefined, signal)
            .catch((e) => {
              if (signal.aborted) throw e;
              return null;
            });
          if (emote) return { ...base, status: "done", via: "link", total: 1, ...usable([emote]) };
        }
        const res = await api.searchEmotes(
          {
            query,
            tags: o.tagged ? s.tags : [],
            sortBy: o.sortBy,
            exactMatch: o.exact,
            targetSetId: s.target.id,
          },
          undefined,
          signal,
        );
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
          if (!signal.aborted) setSearches((prev) => ({ ...prev, [alias]: state }));
          return state;
        });
      searchPromises.current.set(alias, p);
      return p;
    },
    [api],
  );

  // ---- Start / resume a mapping ----
  const startMapping = useCallback(
    /**
     * `login` is passed explicitly when called straight after logging in (the state hasn't re-rendered yet);
     * otherwise the current token, user and sets are used.
     */
    async (
      params: MappingParams,
      saved?: MappingRecord,
      login?: { token: string; me: Me; sets: EmoteSetInfo[] },
    ) => {
      const t = login?.token ?? token;
      const user = login?.me ?? me;
      const editable = login?.sets ?? sets;
      if (!t || !user) return;
      setLoading(true);
      setLoadError(null);
      setSourceLinkError(null);
      // A pasted link (not one of the user's own sets) is only checked with 7TV now, on submit.
      const pastedSource = !editable.some((x) => x.id === params.sourceId) && !saved;
      if (pastedSource) {
        const found = await api.fetchSetInfo(params.sourceId, t).catch(() => null);
        if (!found) {
          setSourceLinkError("No emote set found at that link. Check it and try again.");
          setLoading(false);
          return;
        }
      }
      try {
        const [source, target, sourceEmotes, targetEmotes] = await Promise.all([
          api.fetchSetInfo(params.sourceId, t),
          api.fetchSetInfo(params.targetId, t),
          api.fetchSetEmotes(params.sourceId, t),
          api.fetchSetEmotes(params.targetId, t),
        ]);
        if (!source) throw new Error("Your base set no longer exists.");
        if (!target) throw new Error("Your seasonal set no longer exists.");
        if (!user.editableEmoteSetIds.includes(target.id))
          throw new Error("You don't have permission to edit this emote set.");
        // An emote counts as already mapped when the target has something under the same name (alias).
        const entries = new Map(targetEmotes.map((e) => [e.alias, e]));
        const pendingRows = sourceEmotes.filter((e) => !entries.has(e.alias)).toSorted(byAlias);
        const mappedRows = sourceEmotes.filter((e) => entries.has(e.alias)).toSorted(byAlias);
        // Target emotes the source doesn't have (e.g. the source changed since last season).
        const sourceAliases = new Set(sourceEmotes.map((e) => e.alias));
        const extraRows = targetEmotes.filter((e) => !sourceAliases.has(e.alias)).toSorted(byAlias);
        const steps = buildSteps(pendingRows, mappedRows, extraRows);
        const s: Session = {
          params: mappingParams(params),
          source,
          target,
          pending: pendingRows,
          mapped: mappedRows,
          extras: extraRows,
          rows: [...pendingRows, ...mappedRows],
          steps,
          tags: tagsFor(params.theme, params.customTags),
        };
        const restored = saved?.choices ?? {};
        // Resume where the user was. Names are looked up rather than positions, because emotes move between
        // sections as they get added (e.g. a pending emote added before the reload is now "mapped").
        const doneAt = (section: Section) =>
          steps.findIndex((st) => st.kind === "done" && st.section === section);
        const savedDone = saved?.atDone;
        const aliasAt = saved?.currentAlias
          ? steps.findIndex((st) => stepAlias(st) === saved.currentAlias)
          : -1;
        const step = savedDone && doneAt(savedDone) >= 0 ? doneAt(savedDone) : Math.max(0, aliasAt);
        // Swap journal: an entry whose name is back in the target finished (or rolled back) before the page
        // closed. One whose name is still missing was interrupted between remove and re-add; keep it so the
        // user can restore the previous emote.
        const journal = Object.fromEntries(
          Object.entries(saved?.removed ?? {}).filter(([alias]) => !entries.has(alias)),
        );
        resetSession();
        sessionRef.current = s;
        setTargetEntries(
          Object.fromEntries(
            [...mappedRows, ...extraRows].map((r) => [r.alias, entries.get(r.alias)!]),
          ),
        );
        setChoices(restored);
        setRemoved(journal);
        // Give the first card up to FIRST_CARD_BUDGET_MS to be ready (its search plus every image on it) while
        // the button shows a spinner, so it doesn't appear half-loaded and shift around. If that takes longer,
        // switch anyway: the card shows its usual loading state, like any other slow card.
        const first = stepRow(steps[step]);
        if (first) {
          const current = entries.get(first.alias)?.emote;
          const ready = runSearch(first).then((st) =>
            Promise.all(
              [first.emote, current, ...st.items].flatMap((e) =>
                e ? [preloadImage(emoteImage(e.id, 3))] : [],
              ),
            ),
          );
          await Promise.race([ready, sleep(FIRST_CARD_BUDGET_MS)]);
          if (sessionRef.current !== s) return; // superseded (e.g. cancelled) while waiting
        }
        setNavIndex(step);
        if (steps[step]) lastInSection.current = { [stepSection(steps[step])]: step };
        setSession(s);
        setResume(null);
      } catch (e) {
        setLoadError(friendlyError(e));
      } finally {
        setLoading(false);
      }
    },
    [token, me, resetSession, setRemoved, runSearch, api, sets],
  );

  /**
   * Checks a token with 7TV and loads the user's editable sets, then picks up `pendingResume` (a saved in-progress
   * mapping) if there is one. Runs at startup with the saved token, after "Paste and log in", and from Retry.
   */
  const checkAccount = async (t: string, pendingResume: MappingRecord | null) => {
    const check = ++accountCheck.current;
    const superseded = () => check !== accountCheck.current;
    setAuthError(null);
    setAccount("checking");
    try {
      const user = await api.fetchMe(t);
      if (superseded()) return;
      if (!user)
        return signOut(
          "Token rejected by 7TV. Run the command on 7tv.app again, then press Paste and log in.",
        );
      storage.token.set(t);
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
      const editable = await api.fetchSetInfos(user.editableEmoteSetIds, t);
      if (superseded()) return;
      setSets(editable);
      setAccount("ready");
      if (pendingResume)
        void startMapping(pendingResume, pendingResume, { token: t, me: user, sets: editable });
    } catch (e) {
      if (superseded()) return;
      if (e instanceof ApiError && e.status === 401)
        return signOut(
          clearClipboardAfterLogin.current
            ? "Token rejected by 7TV. Run the command on 7tv.app again, then press Paste and log in."
            : "Your 7TV session has expired. Log in again to continue.",
        );
      setAuthError(friendlyError(e));
      setAccount("error");
    }
  };

  // ---- Bootstrap: saved token and any in-progress mapping ----
  // Reads browser storage once after hydration (it isn't available during the static prerender).
  const bootstrap = useEffectEvent(() => {
    const savedToken = storage.token.get();
    setToken(savedToken);
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
    if (savedToken) void checkAccount(savedToken, saved);
  });
  // Setting state here is intended: storage only exists in the browser, so it's read once hydration is done.
  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => bootstrap(), []);

  const pending = useMemo(() => session?.pending ?? [], [session]);
  const rows = useMemo(() => session?.rows ?? [], [session]);
  const extras = useMemo(() => session?.extras ?? [], [session]);
  const steps = useMemo(() => session?.steps ?? [], [session]);
  const stepCount = steps.length;
  const stepOfAlias = useCallback(
    (alias: string) => steps.findIndex((st) => stepAlias(st) === alias),
    [steps],
  );
  const rowAtStep = useCallback((i: number) => stepRow(steps[i]), [steps]);
  const sections = useMemo(() => [...new Set(steps.map(stepSection))], [steps]);
  const mappedAliases = useMemo(
    () => new Set((session?.mapped ?? []).map((r) => r.alias)),
    [session],
  );
  const extraAliases = useMemo(() => new Set(extras.map((e) => e.alias)), [extras]);
  const isExtra = (alias: string) => extraAliases.has(alias);

  /** Names not in the target yet default to the original; names already in it default to staying as-is. */
  const choiceOf = (alias: string): Choice =>
    choices[alias] ?? (targetEntries[alias] ? KEEP : ORIGINAL);
  const outcomeOf = (row: SetEmote) => outcome(row, choiceOf(row.alias), targetEntries[row.alias]);
  const finalEmote = (row: SetEmote): EmoteSummary | null => {
    const o = outcomeOf(row);
    return o.kind === "remove" || o.kind === "skip" ? null : o.emote;
  };
  const isSwap = (row: SetEmote) => outcomeOf(row).kind === "swap";
  const mappedKind = (row: SetEmote) => resultKind(row, outcomeOf(row));
  /** " (swapping 2, removing 1)" for these rows, or "" when none of them change. */
  const changeNote = (rs: SetEmote[]) => {
    const swapping = rs.filter(isSwap).length;
    const removing = rs.filter((r) => outcomeOf(r).kind === "remove").length;
    const parts = [swapping && `swapping ${swapping}`, removing && `removing ${removing}`].filter(
      Boolean,
    );
    return parts.length ? ` (${parts.join(", ")})` : "";
  };

  // ---- The filter: which cards exist ----
  const filterState = useMemo<FilterState>(
    () => ({ choices, targetEntries, applyStates, mapped: mappedAliases, extra: extraAliases }),
    [choices, targetEntries, applyStates, mappedAliases, extraAliases],
  );
  const visibility = useMemo(
    () => visibilityFor(steps, filter, filterState),
    [steps, filter, filterState],
  );
  const isStepVisible = (i: number) => visibility.visible[i] ?? false;
  const matchingSections = visibility.matching;
  const noMatches = filter !== "all" && visibility.first === null;
  /** The card on screen: the one the user navigated to, or the start of the list if the filter hides that one. */
  const index = isStepVisible(navIndex) ? navIndex : (visibility.first ?? navIndex);
  const step = steps[index] as Step | undefined;
  const doneStep = step?.kind === "done" ? step : undefined;
  const section = step ? stepSection(step) : "pending";
  /** The emote on screen: a base emote, or (in "Not in base") a seasonal-set entry. */
  const current = stepRow(step);

  // Keep the saved in-progress mapping in step with every change (storage is outside React).
  useEffect(() => {
    if (session) storage.mapping.set(toRecord(session, choices, step, removed));
  }, [session, choices, step, removed, storage]);

  const cancelMapping = async () => {
    const ok = await ask({
      title: "Start over?",
      body: "Unsaved changes will be discarded.",
      confirmLabel: "Start over",
      destructive: true,
    });
    if (!ok) return;
    storage.mapping.set(null);
    resetSession();
    setResume(null);
    setLoadError(null);
  };

  /** Default search for an emote: its unaliased name, exact match, seasonal tags. Runs once per emote. */
  const ensureSearch = useCallback(
    (row: SetEmote) => searchPromises.current.get(row.alias) ?? runSearch(row),
    [runSearch],
  );

  // Search the emote on screen, then preload the next one so stepping forward is instant. To save search quota,
  // nothing is searched while the user flicks through cards (less than SETTLE_MS apart) or while the search
  // pacer has no free slot, and nothing is sent for a card the user has already left.
  const lastCardChange = useRef(0);
  useEffect(() => {
    if (!session) return;
    const now = Date.now();
    const rapid = now - lastCardChange.current < SETTLE_MS;
    lastCardChange.current = now;
    let cancelled = false;
    const preloadNext = () => {
      const next = rowAtStep(index + 1) ?? rowAtStep(index + 2); // skip over a summary step
      if (cancelled || !next || searchPromises.current.has(next.alias)) return;
      if (freeSearches() < 2) return;
      ensureSearch(next).then((st) => {
        for (const e of st.items) void preloadImage(emoteImage(e.id, 3));
      });
      void preloadImage(emoteImage(next.emote.id, 3));
    };
    const searchNow = () => {
      if (cancelled) return;
      // On an "All done!" step there's nothing to search, but the emote after it is worth preloading.
      if (!current) preloadNext();
      else ensureSearch(current).then(preloadNext);
    };
    const cached = !current || searchPromises.current.has(current.alias);
    const delay = Math.max(rapid ? SETTLE_MS : 0, cached ? 0 : searchWait());
    const timer = delay > 0 ? setTimeout(searchNow, delay) : undefined;
    if (!timer) searchNow();
    return () => {
      cancelled = true;
      clearTimeout(timer); // moved on before it ran: nothing is sent
    };
  }, [session, current, index, rowAtStep, ensureSearch]);

  const findVisible = (from: number, dir: 1 | -1, visible: (i: number) => boolean) => {
    for (let i = from + dir; i >= 0 && i < stepCount; i += dir) if (visible(i)) return i;
    return null;
  };
  const go = useCallback(
    (i: number) => {
      setNavIndex(i);
      const st = steps[i];
      if (st) lastInSection.current = { ...lastInSection.current, [stepSection(st)]: i };
    },
    [steps],
  );
  const navigate = (delta: number) => {
    const dir = delta < 0 ? -1 : 1;
    let at = index;
    for (let n = Math.abs(delta); n > 0; n--) {
      const next = findVisible(at, dir, isStepVisible);
      if (next === null) break;
      at = next;
    }
    go(at);
  };

  const choose = (choice: Choice, advance: boolean) => {
    const alias = stepAlias(step);
    if (!alias) return;
    setChoices((prev) => ({ ...prev, [alias]: choice }));
    if (!advance) return;
    // Move on by what the filter will show once this pick is in: the pick can take this card (and, if it was the
    // section's last match, the section's done card) out of the filter. The next card still shown, else the
    // nearest one before it; with nothing left, the empty state shows.
    const after = visibilityFor(steps, filter, {
      ...filterState,
      choices: { ...choices, [alias]: choice },
    });
    const shown = (i: number) => after.visible[i] ?? false;
    const to = findVisible(index, 1, shown) ?? findVisible(index, -1, shown);
    if (to !== null) go(to);
  };

  const goShowing = (i: number) => {
    if (!isStepVisible(i)) setFilter("all");
    go(i);
  };
  /**
   * Switches the filter. The emote on screen stays if the new filter shows it; otherwise (or from a done card) it
   * goes to the first match in the list. With no matches, the card area shows an empty state.
   */
  const changeFilter = (next: Filter) => {
    const v = visibilityFor(steps, next, filterState);
    if (current && v.visible[index]) go(index);
    else if (v.first !== null) go(v.first);
    setFilter(next);
  };
  const workspaceMain = useRef<HTMLDivElement>(null);
  const jumpFromList = useCallback(
    (i: number) => {
      go(i);
      setListOpen(false);
      requestAnimationFrame(() => {
        const el = workspaceMain.current;
        if (el && el.getBoundingClientRect().top < 0)
          el.scrollIntoView({ block: "start", behavior: "smooth" });
      });
    },
    [go],
  );
  const goToSection = (to: Section) => {
    const last = lastInSection.current[to];
    const i =
      last !== undefined && isStepVisible(last)
        ? last
        : steps.findIndex((st, j) => stepSection(st) === to && isStepVisible(j));
    if (i >= 0) go(i);
  };

  // Every row is judged by what the target holds now, whatever section it was loaded into: a new emote that
  // was added can be swapped or removed like any other, and a name a failed swap left empty gets filled again.
  const allRows = useMemo(() => [...rows, ...extras], [rows, extras]);
  const plan = allRows.filter((r) => outcomeOf(r).kind === "add");
  const swaps = allRows.filter(isSwap);
  const removalEntries = (rs: SetEmote[]): SetEmote[] =>
    rs.flatMap((r) => (outcomeOf(r).kind === "remove" ? [targetEntries[r.alias]] : []));
  const removals = removalEntries(allRows);
  const capacity = session?.target.capacity ?? null;
  // Slots in use now (deleted emotes don't count, matching 7TV), plus what saving would change.
  const usedNow = Object.values(targetEntries).filter((e) => !e.emote.deleted).length;
  // Swapping out an entry whose emote was deleted from 7TV takes a slot.
  const swapSlots = swaps.filter((r) => targetEntries[r.alias]?.emote.deleted).length;
  // Removing frees a slot unless the emote was deleted from 7TV (those never counted).
  const freedSlots = removals.filter((e) => !e.emote.deleted).length;
  const projected = usedNow + plan.length + swapSlots - freedSlots;

  const stats = useMemo(() => {
    const counts = { replace: 0, original: 0, exclude: 0, remove: 0, errors: 0 };
    for (const r of pending) {
      const c = choices[r.alias];
      if (c && (c.kind === "replace" || c.kind === "original" || c.kind === "exclude"))
        counts[c.kind]++;
      else if (!targetEntries[r.alias]) counts.original++; // no pick: copied as-is
    }
    for (const r of allRows)
      if (choices[r.alias]?.kind === "remove" && targetEntries[r.alias]) counts.remove++;
    for (const r of allRows) if (applyStates[r.alias]?.state === "error") counts.errors++;
    return counts;
  }, [pending, allRows, choices, targetEntries, applyStates]);

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
    storage.mapping.set(toRecord(s, choices, step, next));
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
        const [info, emotes] = await Promise.all([
          api.fetchSetInfo(s.target.id, token),
          api.fetchSetEmotes(s.target.id, token),
        ]);
        if (!info) throw new Error("Your seasonal set no longer exists.");
        fresh = emotes;
        freshCapacity = info.capacity;
      } catch (e) {
        setPreparing(false);
        await saveStep({
          title: `Couldn't check ${s.target.name}`,
          body: <ErrorText message={friendlyError(e)} />,
        });
        return;
      }
      setPreparing(false);
      const freshByAlias = new Map(fresh.map((e) => [e.alias, e]));
      const sessionRows = [...s.rows, ...s.extras];
      const adds = sessionRows.filter((r) => outcomeOf(r).kind === "add");
      const toAdd = adds.filter((r) => !freshByAlias.has(r.alias));
      // A swap is only safe if the target still holds exactly what we showed the user.
      const toSwap: SetEmote[] = [];
      const stale: SetEmote[] = [];
      // Names that turned up in the target since loading (an earlier partial run, or an edit on 7tv.app). From
      // now on they count as already there. One holding a different emote than the user picked is reported like
      // any other stale change, and their pick is dropped rather than swapped in over someone else's edit.
      const alreadyThere: SetEmote[] = [];
      for (const r of adds.filter((a) => freshByAlias.has(a.alias))) {
        const now = freshByAlias.get(r.alias)!;
        setTargetEntry(r.alias, now);
        if (now.emote.id === finalEmote(r)?.id) alreadyThere.push(r);
        else {
          stale.push(r);
          setChoices((prev) => ({ ...prev, [r.alias]: KEEP }));
        }
      }
      for (const r of sessionRows.filter(isSwap)) {
        const now = freshByAlias.get(r.alias);
        if (now && now.emote.id === targetEntries[r.alias]?.emote.id) toSwap.push(r);
        else stale.push(r);
      }
      // Removals: only if the target still holds exactly the emote the user saw under that name.
      const toRemove: SetEmote[] = [];
      const goneAlready: SetEmote[] = [];
      for (const e of removalEntries(sessionRows)) {
        const now = freshByAlias.get(e.alias);
        if (!now) goneAlready.push(e);
        else if (now.emote.id === e.emote.id) toRemove.push(e);
        else stale.push(e);
      }
      for (const e of goneAlready) setTargetEntry(e.alias, null);
      setApplyStates((prev) => {
        const next = { ...prev };
        for (const r of alreadyThere) next[r.alias] = { state: "added" };
        for (const e of goneAlready) next[e.alias] = { state: "removed" };
        for (const r of stale)
          next[r.alias] = {
            state: "error",
            message:
              "This emote changed on 7TV after you loaded it, so it wasn't saved. Reload to see the latest.",
          };
        return next;
      });

      if (!toAdd.length && !toSwap.length && !toRemove.length) {
        if (stale.length) {
          await saveStep({
            title: "Nothing was saved",
            body: `${plural(stale.length, "emote")} ${stale.length === 1 ? "was" : "were"} changed on 7TV after you loaded ${stale.length === 1 ? "it" : "them"}. Reload to see the latest, then try again.`,
          });
          return;
        }
        return void (await finish(s, 0, 0, 0));
      }

      const used = usedSlots(fresh);
      const slotsNeeded =
        toAdd.length + toSwap.filter((r) => targetEntries[r.alias]?.emote.deleted).length;
      // Removals run first, so the slots they free count towards the space available.
      const freed = toRemove.filter((e) => !e.emote.deleted).length;
      const free = freshCapacity == null ? Infinity : Math.max(0, freshCapacity - used + freed);
      if (slotsNeeded > free) {
        await saveStep({
          title: `${s.target.name} is too full`,
          body: `This save requires ${plural(slotsNeeded, "open slot")}, but there ${
            free === 1 ? "is only 1 slot" : free === 0 ? "are no slots" : `are only ${free} slots`
          } remaining. Remove at least ${plural(slotsNeeded - free, "more emote")}, then try again.`,
        });
        return;
      }

      const replaced = toAdd.filter((r) => choiceOf(r.alias).kind === "replace").length;
      /** Adds and removes to send: a swap is one of each. */
      const requestCount = toRemove.length + toAdd.length + 2 * toSwap.length;
      const estimate = saveTime(requestCount);
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
              </li>
            )}
            {toSwap.length > 0 && <li>Swap {plural(toSwap.length, "emote")}</li>}
            {toRemove.length > 0 && <li>Remove {plural(toRemove.length, "emote")}</li>}
            {freshCapacity != null && (
              <li>
                {s.target.name} will use {used + slotsNeeded - freed} of {freshCapacity} slots
              </li>
            )}
            {estimate >= LONG_SAVE_MS && <li>Takes {duration(estimate)}, so keep this tab open</li>}
          </ul>
        ),
        confirmLabel: toRemove.length || toSwap.length ? "Save changes" : "Add emotes",
        destructive: toRemove.length > 0,
      });
      if (!ok) return;

      setSaveDialog({ kind: "saving" });
      setApplying(true);
      setRunLeft(estimate);
      const gap = changeDelay(requestCount);
      // Time left: the expected time per request, or the pace so far if 7TV is slower than that (a slow API, or a
      // rate-limit pause). The first requests go out in a quick burst, so the expected pace is a floor.
      const started = Date.now();
      const expectedPerRequest = estimate / Math.max(1, requestCount);
      let requestsDone = 0;
      const progressed = (requests: number) => {
        requestsDone += requests;
        const pace = Math.max(expectedPerRequest, (Date.now() - started) / requestsDone);
        setRunLeft(pace * Math.max(0, requestCount - requestsDone));
      };
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
          setTargetEntry(entry.alias, null);
          setApplyStates((prev) => ({ ...prev, [entry.alias]: { state: "removed" } }));
        } catch (e) {
          if (fail(entry, e)) break;
        }
        progressed(1);
        await sleep(gap);
      }

      for (const row of full || fatal ? [] : toAdd) {
        if (sessionRef.current !== s) break;
        const emote = finalEmote(row)!;
        // A name left empty by an interrupted swap keeps the zero-width setting the target had.
        const interrupted = removedRef.current[row.alias];
        const zeroWidth = interrupted?.zeroWidth ?? row.flags.zeroWidth;
        setApplyStates((prev) => ({ ...prev, [row.alias]: { state: "running" } }));
        try {
          await api.addEmoteToSet(token, s.target.id, emote.id, aliasFor(row, emote), zeroWidth);
          added++;
          setTargetEntry(row.alias, {
            id: emote.id,
            alias: row.alias,
            flags: { zeroWidth },
            emote,
          });
          if (interrupted) journal(s, row.alias, null);
          setApplyStates((prev) => ({ ...prev, [row.alias]: { state: "added" } }));
        } catch (e) {
          if (fail(row, e)) break;
        }
        progressed(1);
        await sleep(gap);
      }

      // Swaps: remove the current entry, add the new emote under the same name, and roll back on failure.
      for (const row of full || fatal ? [] : toSwap) {
        if (sessionRef.current !== s) break;
        const cur = targetEntries[row.alias];
        const emote = finalEmote(row)!;
        setApplyStates((prev) => ({ ...prev, [row.alias]: { state: "running" } }));
        journal(s, row.alias, { emote: cur.emote, zeroWidth: cur.flags.zeroWidth });
        try {
          await api.removeEmoteFromSet(token, s.target.id, cur.emote.id, cur.alias);
        } catch (e) {
          journal(s, row.alias, null);
          if (fail(row, e, " Nothing was changed.")) break;
          progressed(2);
          continue;
        }
        try {
          await api.addEmoteToSet(
            token,
            s.target.id,
            emote.id,
            aliasFor(row, emote),
            cur.flags.zeroWidth,
          );
          swapped++;
          journal(s, row.alias, null);
          setTargetEntry(row.alias, { ...cur, id: emote.id, emote });
          setChoices((prev) => ({ ...prev, [row.alias]: KEEP }));
          setApplyStates((prev) => ({ ...prev, [row.alias]: { state: "updated" } }));
        } catch (e) {
          let restored = false;
          try {
            await api.addEmoteToSet(
              token,
              s.target.id,
              cur.emote.id,
              aliasFor(row, cur.emote),
              cur.flags.zeroWidth,
            );
            restored = true;
            journal(s, row.alias, null);
          } catch {
            // The name is empty now. The journal keeps the old emote, and the user's pick goes in on the next save.
            setTargetEntry(row.alias, null);
          }
          const suffix = restored
            ? ` The previous emote (${cur.emote.defaultName}) was restored.`
            : ` The previous emote (${cur.emote.defaultName}) could not be restored. Save again to retry.`;
          if (fail(row, e, suffix)) break;
        }
        progressed(2);
        await sleep(gap);
      }

      setApplyStates((prev) => {
        const next = { ...prev };
        for (const [k, v] of Object.entries(next)) if (v.state === "queued") delete next[k];
        return next;
      });
      setApplying(false);

      if (sessionRef.current !== s) return; // cancelled mid-run
      const done = [
        `${added} added`,
        swapped && `${swapped} swapped`,
        removedN && `${removedN} removed`,
      ]
        .filter(Boolean)
        .join(", ");
      if (failed || stale.length) setFilter("errors");
      if (full) {
        await saveStep({
          title: `${s.target.name} is full`,
          body: `${s.target.name} ran out of room after ${done}. Remove some emotes from it, then save again.`,
        });
      } else if (fatal) {
        await saveStep({
          title: "Stopped early",
          body: (
            <>
              <ErrorText message={fatal} /> {done} before the save stopped. Your selections are
              saved. Resolve the issue, then save again.
            </>
          ),
        });
      } else if (failed || stale.length) {
        await saveStep({
          title: `${plural(failed + stale.length, "emote")} failed`,
          body: `${done}. Failed emotes are listed at the top with the reason for each. Resolve them, then save again.`,
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
    const summary = listOf(parts);
    await saveStep({
      title: `${s.target.name} is up to date`,
      body: summary ? `${summary[0].toUpperCase()}${summary.slice(1)}.` : "No changes were needed.",
      okLabel: "Done",
      dismissable: false,
    });
    resetSession();
    // The set picker's emote counts are now out of date; refresh them in the background.
    if (me) api.fetchSetInfos(me.editableEmoteSetIds, token).then(setSets, () => {});
  };

  // ---- Render ----
  /** "2 of 5" within the card's section, counting only emotes the filter shows. */
  const positionOf = (i: number) => {
    const st = steps[i];
    if (!st || st.kind === "done") return "";
    if (filter === "all") return `${st.n} of ${st.of}`;
    const at = visibility.rank[i] - 1;
    const total = visibility.shown[stepSection(st)];
    const label = filterItems
      .find((f) => f.id === filter)
      ?.label.replace(/ \(\d+\)$/, "")
      .toLowerCase();
    return at >= 0 ? `${at + 1} of ${total} ${label}` : `not ${label}`;
  };
  const canPrev = findVisible(index, -1, isStepVisible) !== null;
  const canNext = findVisible(index, 1, isStepVisible) !== null;
  const targetName = session?.target.name ?? "your seasonal set";
  const sectionSize: Record<Section, number> = {
    pending: pending.length,
    mapped: session?.mapped.length ?? 0,
    extra: extras.length,
  };
  /** The emote list's sections: the emotes the filter shows, each with its step. Stable between unrelated renders. */
  const overviewSections = useMemo(() => {
    const rowsOf = (kind: Step["kind"]) =>
      steps.flatMap((st, i) =>
        st.kind === kind && visibility.visible[i] ? [{ row: stepRow(st)!, index: i }] : [],
      );
    return [
      { title: sectionTitle.pending, rows: rowsOf("pending") },
      { title: sectionTitle.mapped, rows: rowsOf("mapped") },
      { title: sectionTitle.extra, rows: rowsOf("extra"), extra: true },
    ];
  }, [steps, visibility]);

  const mappedKinds = { replace: 0, original: 0 };
  for (const r of session?.mapped ?? []) {
    const k = mappedKind(r);
    if (k) mappedKinds[k]++;
  }
  const themeItems = Object.entries(THEMES).map(([id, t]) => ({ id, label: t.label }));
  const filterItems = [
    { id: "all", label: `All (${rows.length + extras.length})` },
    { id: "replace", label: `Seasonal picks (${stats.replace + mappedKinds.replace})` },
    { id: "original", label: `Copied as-is (${stats.original + mappedKinds.original})` },
    { id: "exclude", label: `Skipped (${stats.exclude})` },
    ...(session?.mapped.length || extras.length || swaps.length
      ? [{ id: "changed", label: `Swapping (${swaps.length})` }]
      : []),
    ...(session?.mapped.length || extras.length || stats.remove
      ? [{ id: "remove", label: `Removing (${stats.remove})` }]
      : []),
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
  const runDone =
    run?.filter((a) => !["queued", "running"].includes(applyStates[a]?.state ?? "queued")).length ??
    0;
  /** Rough time left on the save in progress, e.g. "About 3 minutes left". Always shown, so it never pops in. */
  const timeLeft =
    runLeft < LONG_SAVE_MS
      ? "Less than a minute left"
      : `${duration(runLeft).replace(/^a/, "A")} left`;

  const filterSelect = (
    <SelectField
      aria-label="Filter emotes"
      className="compact emote-list-filter"
      items={filterItems}
      value={filter}
      onChange={(id) => changeFilter(id as Filter)}
    />
  );
  const emoteList = (inDrawer: boolean) => (
    <>
      {overviewSections.some((sec) => sec.rows.length) ? (
        <MappingOverview
          sections={overviewSections}
          current={index}
          choices={choices}
          targetEntries={targetEntries}
          applyStates={applyStates}
          onJump={jumpFromList}
          followFocus={!inDrawer}
        />
      ) : (
        <p className="muted small center">No emotes match this filter.</p>
      )}
    </>
  );

  const card = !session ? null : noMatches ? (
    <section className="card focus empty-state" aria-label="No matching emotes">
      <div className="summary-emoji" aria-hidden>
        🔍
      </div>
      <h2>No matching emotes</h2>
      <p className="muted">
        No emotes in “{filterItems.find((f) => f.id === filter)?.label.replace(/ \(\d+\)$/, "")}”.
      </p>
      <Button className="btn" onPress={() => changeFilter("all")}>
        Show all emotes
      </Button>
    </section>
  ) : doneStep ? (
    <MappingSummary
      key={`done:${doneStep.section}`}
      section={doneStep.section}
      next={
        sections
          .slice(sections.indexOf(doneStep.section) + 1)
          .find((sec) => filter === "all" || matchingSections.has(sec)) ?? null
      }
      isLast={doneStep.next === null}
      multiSection={sections.length > 1}
      canPrev={canPrev}
      counts={stats}
      swapCount={swaps.length}
      removeCount={removals.length}
      sectionTitle={sectionTitle}
      canApply={!applying && !preparing}
      applyLabel={preparing ? "Checking your seasonal set…" : applyLabel}
      onApply={apply}
      onNextSection={goToSection}
      onNavigate={navigate}
    />
  ) : current ? (
    <MappingFocus
      key={`${session.source.id}:${current.alias}`}
      source={current}
      position={positionOf(index)}
      canPrev={canPrev}
      canNext={canNext}
      inTarget={targetEntries[current.alias]}
      previous={removed[current.alias]}
      tags={session.tags}
      choice={choiceOf(current.alias)}
      inBase={!isExtra(current.alias)}
      search={searches[current.alias]}
      apply={applyStates[current.alias]}
      defaultSort={session.params.sortBy}
      onChoose={choose}
      onSearch={(opts) => void runSearch(current, opts)}
      onNavigate={navigate}
    />
  ) : null;

  const header = (
    <SiteHeader>
      {/* The demo's account is fake, so there's no user (or Sign out) to show; it gets its own action instead. */}
      {mode !== "live" && headerAction && <div className="me">{headerAction}</div>}
      {me && mode === "live" && (
        <div className="me">
          {me.mainConnection?.platformAvatarUrl && (
            <Image src={me.mainConnection.platformAvatarUrl} alt="" />
          )}
          <span>{me.mainConnection?.platformDisplayName ?? me.id}</span>
          <Button className="link-button" onPress={() => signOut()}>
            Sign out
          </Button>
        </div>
      )}
    </SiteHeader>
  );

  // Before hydration (and in the prerendered HTML) only the header shows; nothing below it can be right yet.
  if (!hydrated) return <main>{header}</main>;

  return (
    <LogInAgainContext.Provider value={logInAgain}>
      <main>
        {dialog}
        <ModalShell
          isOpen={!!saveDialog}
          dismissable={saveDialog?.kind !== "saving" && saveDialog?.dismissable !== false}
          alert={!!saveDialog?.confirmLabel}
          onDismiss={() => answerSave(false)}
        >
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
              <p className="muted small time-left">{timeLeft}</p>
              {pause && pause.bucket !== "search" && (
                <p className="notice small">
                  Rate limit exceeded. Trying again in {pause.seconds}s.
                </p>
              )}
            </>
          ) : (
            saveDialog && <DialogContent {...saveDialog} onClose={answerSave} />
          )}
        </ModalShell>
        {header}
        {me && clipboardWarning && (
          <div className="card narrow notice-card" role="alert">
            <span>Unable to clear the clipboard. Copy something else to overwrite the token.</span>
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
              void checkAccount(t, resume);
            }}
            error={authError}
          />
        ) : account === "error" ? (
          <section className="card narrow center stack" role="alert">
            <p>{me ? "Couldn't load your emote sets." : "Couldn't check your 7TV session."}</p>
            <p className="error">{authError}</p>
            <div className="buttons-row">
              <Button
                className="btn primary"
                onPress={() => token && void checkAccount(token, resume)}
              >
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
                  <b>{session.source.name}</b> <span className="muted">→</span>{" "}
                  <b>{session.target.name}</b>
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
                  {session.mapped.length > 0 && (
                    <span className="muted">
                      {session.mapped.length} already added
                      {changeNote(session.mapped)}
                    </span>
                  )}
                  {extras.length > 0 && (
                    <span className="muted">
                      {extras.length} not in base
                      {changeNote(extras)}
                    </span>
                  )}
                  {capacity != null && free != null && (
                    <span className={free < 0 ? "error" : "muted"}>
                      {free < 0
                        ? `${-free} over capacity`
                        : `${plural(free, "slot")} left after saving`}
                    </span>
                  )}
                </div>
              </div>
              <div className="buttons">
                <Button className="btn primary" onPress={apply} isDisabled={preparing || applying}>
                  {preparing ? (
                    <>
                      <Spinner label="Checking your seasonal set" size="sm" /> Checking your
                      seasonal set…
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
                              <Button
                                className="link-button"
                                onPress={() => goShowing(stepOfAlias(r.alias))}
                              >
                                {r.alias}
                              </Button>
                              : <ErrorText message={applyStates[r.alias]?.message ?? ""} />
                            </li>,
                          ]
                        : [],
                    )}
                  </ul>
                </div>
              )}
              {interrupted.length > 0 && (
                <div className="alert small" role="alert">
                  A save was interrupted, so {listOf(interrupted)}{" "}
                  {interrupted.length === 1 ? "is" : "are"} missing from your seasonal set. Save
                  again to fix {interrupted.length === 1 ? "it" : "them"}.
                </div>
              )}
              {pause && (
                <div className="notice small" role="status">
                  {pause.bucket === "search"
                    ? `Search rate limit exceeded. Trying again in ${pause.seconds}s.`
                    : `Rate limit exceeded. Trying again in ${pause.seconds}s.`}
                </div>
              )}
            </section>

            {/* The list of every emote sits beside the card (a drawer on narrow screens) and drives it: picking a
                row shows that emote, and the filter decides which emotes the arrows step through. */}
            <div className={`workspace${rows.length + extras.length > 0 ? "" : " empty"}`}>
              {rows.length + extras.length > 0 && (
                <aside className="card emote-list" aria-label="All emotes">
                  {/* The box matches the card's height; its contents stay on screen as a tall card scrolls. */}
                  <div className="emote-list-inner">
                    {filterSelect}
                    {emoteList(false)}
                  </div>
                </aside>
              )}
              <div className="workspace-main" ref={workspaceMain}>
                {/* Narrow screens: the filter stays on the page; only the list itself is in the sheet. */}
                {rows.length + extras.length > 0 && (
                  <div className="list-bar">
                    {filterSelect}
                    <Button
                      className="btn small"
                      onPress={(e) => {
                        setListByTouch(e.pointerType === "touch");
                        setListOpen(true);
                      }}
                    >
                      ☰ List
                    </Button>
                  </div>
                )}
                {sections.length > 1 ? (
                  // One tab per section with emotes in it; a single section needs no tabs. On wide screens the
                  // list's section headings stand in for the tab bar, so it's hidden there.
                  <Tabs
                    className="section-tabs"
                    selectedKey={section}
                    onSelectionChange={(key) => goToSection(key as Section)}
                  >
                    <TabList className="section-tab-list" aria-label="Sections">
                      {/* With a filter on, tabs count (and only offer) sections with matching emotes. */}
                      {sections
                        .filter(
                          (sec) => filter === "all" || matchingSections.has(sec) || sec === section,
                        )
                        .map((sec) => (
                          <Tab key={sec} id={sec} className="section-tab">
                            {sectionTitle[sec]}{" "}
                            <span className="section-tab-count">
                              {filter === "all" ? sectionSize[sec] : visibility.shown[sec]}
                            </span>
                          </Tab>
                        ))}
                    </TabList>
                    <TabPanel id={section}>{card}</TabPanel>
                  </Tabs>
                ) : (
                  card
                )}
              </div>
            </div>
            <SheetOverlay position="left" isOpen={listOpen} onOpenChange={setListOpen}>
              <SheetBackdrop swipeAnimation="sheet-backdrop" />
              <Sheet overscrollPadding stackAnimation="sheet-scale-back">
                {listByTouch && <div className="sheet-handle" />}
                <SheetContent aria-label="All emotes">
                  {!listByTouch && (
                    <div className="sheet-head">
                      <Heading slot="title">All emotes</Heading>
                      <Button
                        className="btn small"
                        aria-label="Close list"
                        onPress={() => setListOpen(false)}
                      >
                        ✕
                      </Button>
                    </div>
                  )}
                  {emoteList(true)}
                </SheetContent>
              </Sheet>
            </SheetOverlay>
          </>
        ) : resume ? (
          <section className="card narrow center stack">
            {loadError ? (
              <>
                <p>Couldn&apos;t restore your previous session.</p>
                <p className="error">
                  <ErrorText message={loadError} />
                </p>
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
                <Spinner label="Restoring your previous session" />
                <p className="muted">Restoring your previous session…</p>
              </div>
            )}
          </section>
        ) : account !== "ready" ? (
          <LoadingCard message="Loading your emote sets…" />
        ) : (
          <section className="card setup" aria-label="Choose your sets">
            <SetPicker
              label="Base set"
              description="Read-only source"
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
              label="Seasonal set"
              description="Changes are saved here"
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
                description={
                  theme === "custom" ? undefined : `Search for emotes tagged ${tags.join(" or ")}`
                }
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
                  sourceId &&
                  targetId &&
                  void startMapping({ sourceId, targetId, theme, customTags, sortBy })
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
                <span className="error small">The base and seasonal sets must be different.</span>
              )}
              {theme === "custom" && !tags.length && (
                <span className="muted small">Add at least one tag.</span>
              )}
              {loadError && <span className="error small">{loadError}</span>}
              {sets.length === 0 && (
                <span className="muted small">
                  You can&apos;t edit any emote sets yet. Create an empty seasonal set on 7tv.app,
                  then reload.
                </span>
              )}
            </div>
          </section>
        )}
      </main>
    </LogInAgainContext.Provider>
  );
}
