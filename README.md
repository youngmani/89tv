# 89TV

Make a seasonal copy of your [7TV](https://7tv.app) emote set.

Every Halloween and Christmas, streamers rebuild their emote set by hand: finding a spooky or festive version of
each emote and adding it under the same name. 89TV does the busywork. Pick your regular set and your seasonal set,
and it walks you through your emotes one at a time, showing seasonal versions to choose from.

- **One emote at a time.** Pick a seasonal version, keep the original, or skip it. Keyboard shortcuts make it quick.
- **Names stay the same.** Seasonal emotes go in under your existing names, so chat doesn't have to relearn anything.
- **Update last year's set.** Emotes that are already in your seasonal set can be kept, swapped for something else,
  or removed.
- **Nothing happens until you save.** You see exactly what will change first, and you can close the page and pick
  up where you left off.
- **Safe on stream.** Logging in never shows your 7TV token on screen.

Not ready to log in? Open `/demo` on the site to try it with example sets; nothing is saved to 7TV.

89TV is an unofficial fan project and isn't affiliated with 7TV.

## Local development

```bash
pnpm install
pnpm dev     # http://localhost:3000
pnpm build   # static site in ./out
```

There's no backend: the site is fully static and talks to the 7TV API directly from the browser.
