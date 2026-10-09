/** "1 emote", "3 emotes". */
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

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

/** Loads an image into the browser cache; resolves once it has loaded (or failed). */
export const preloadImage = (src: string) =>
  new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = img.onerror = () => resolve();
    img.src = src;
  });
