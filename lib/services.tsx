"use client";

import { createContext, useContext } from "react";
import { type MappingRecord, clearMapping, loadMapping, saveMapping } from "./mapping";
import * as seventv from "./seventv";
import { load, save } from "./storage";

/**
 * Everything the app needs from the outside world, injected through context so /demo can swap pieces out.
 *
 * Render behaviour: the Services object is created once per page and never replaced, and it only holds
 * functions (no state), so consuming it never causes a re-render. Storage slots are imperative get/set,
 * not reactive: nothing subscribes to them.
 */
export interface Api {
  fetchMe: typeof seventv.fetchMe;
  fetchSetInfos: typeof seventv.fetchSetInfos;
  fetchSetInfo: typeof seventv.fetchSetInfo;
  fetchSetEmotes: typeof seventv.fetchSetEmotes;
  searchEmotes: typeof seventv.searchEmotes;
  fetchEmoteById: typeof seventv.fetchEmoteById;
  addEmoteToSet: typeof seventv.addEmoteToSet;
  removeEmoteFromSet: typeof seventv.removeEmoteFromSet;
}

export interface Slot<T> {
  get(): T | null;
  set(value: T | null): void;
}

export interface Services {
  mode: "live" | "demo";
  api: Api;
  storage: {
    token: Slot<string>;
    mapping: Slot<MappingRecord>;
  };
  /** Sets to pre-select on the setup form when there's no in-progress mapping. */
  initialSelection?: { sourceId: string; targetId: string };
  /** How long to pause after each add or remove while saving `total` of them. */
  changeDelay: (total: number) => number;
  /** Roughly how long saving `total` adds/removes takes, in ms. */
  saveTime: (total: number) => number;
}

export const liveApi: Api = {
  fetchMe: seventv.fetchMe,
  fetchSetInfos: seventv.fetchSetInfos,
  fetchSetInfo: seventv.fetchSetInfo,
  fetchSetEmotes: seventv.fetchSetEmotes,
  searchEmotes: seventv.searchEmotes,
  fetchEmoteById: seventv.fetchEmoteById,
  addEmoteToSet: seventv.addEmoteToSet,
  removeEmoteFromSet: seventv.removeEmoteFromSet,
};

const TOKEN_KEY = "89tv:token";

export function createLiveServices(): Services {
  return {
    mode: "live",
    api: liveApi,
    storage: {
      token: { get: () => load<string | null>(TOKEN_KEY, null), set: (v) => save(TOKEN_KEY, v) },
      mapping: { get: loadMapping, set: (v) => (v ? saveMapping(v) : clearMapping()) },
    },
    // The API client already paces set changes to stay under 7TV's rate limit.
    changeDelay: () => 0,
    saveTime: seventv.setChangeTime,
  };
}

/** A slot that forgets everything: nothing is persisted. */
export const noopSlot = <T,>(fixed: T | null = null): Slot<T> => ({
  get: () => fixed,
  set: () => {},
});

const ServicesContext = createContext<Services | null>(null);

/**
 * Pass a value created once (e.g. `useState(createLiveServices)`), never an inline object: a new identity
 * would re-render every consumer.
 */
export const ServicesProvider = ServicesContext.Provider;

export function useServices(): Services {
  const s = useContext(ServicesContext);
  if (!s) throw new Error("useServices() needs a <ServicesProvider>");
  return s;
}
