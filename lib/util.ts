/** "1 emote", "3 emotes". */
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "a", "a and b", "a, b and c". */
export const listOf = (items: string[]) =>
  items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : (items[0] ?? "");

/** Waits `ms`, or rejects as soon as `signal` aborts. */
export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    signal?.throwIfAborted();
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/** Loads an image into the browser cache; resolves with whether it loaded. */
export const preloadImage = (src: string) =>
  new Promise<boolean>((resolve) => {
    const img = new Image();
    img.addEventListener("load", () => resolve(true));
    img.addEventListener("error", () => resolve(false));
    img.src = src;
  });
