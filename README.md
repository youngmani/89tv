# 89TV — seasonal 7TV emote sets

A static web app that copies a 7TV emote set into a seasonal (Halloween / Christmas) set, letting you swap each emote for a seasonal equivalent.

- Pick a **source** set (any set, yours or someone else's) and an existing **target** set you can edit.
- Emotes whose name (alias) already exists in the target are listed after the rest as **already in the target**. They stay as they are unless you pick something else. A change swaps them: the current entry is removed and the new emote is added under the same name, and if that add fails the previous emote is put back. These swaps are the only time the app ever removes anything.
- **Closing the page mid-run is recoverable.** Every run re-reads the target first, so emotes that were already added are recognised as mapped and never added twice. Before each swap's remove, the old emote is written to a swap journal in the saved mapping. If the page closes between the remove and the re-add, resuming shows the interrupted swap and offers the old emote as *previously in target*. While a run is in progress, the browser also warns before you leave the page.
- For each remaining emote, the app searches 7TV for the emote's **unaliased** name, filtered to the theme's tags (`halloween`, or `christmas`/`xmas`), with exact-name matching (you can switch a search to fuzzy).
- The whole site's colour scheme follows the chosen theme (Halloween, winter, neutral). UI controls are built with react-aria-components.
- Pick a result, keep the original, or leave it out. When you apply, each emote is added under the **source alias**, and its zero-width flag is kept. Undecided emotes are copied as the original.
- **One in-progress mapping at a time.** Once you start a mapping, its choices are saved in `localStorage` and it resumes when you come back. The saved mapping is deleted when you press **Cancel mapping** or once every emote has been added. The app saves nothing else, so there are no stored preferences.
- **Defaults:** the theme is picked from the date (Sept 1 – Oct 31 Halloween, Nov 1 – Jan 7 Christmas/winter, otherwise custom tags), and results are sorted by most used (all time). Each emote can change its own sort, switch to fuzzy matching, or turn the tag filter off.
- **Capacity:** right before adding, the app re-reads the target. Emotes that are already there, for example from an earlier partial run, don't need a slot. Deleted emotes don't count towards capacity, which matches how 7TV counts. If there aren't enough free slots, nothing is added and the app tells you how many to drop. If 7TV still returns `emote set is at capacity` during a run, the run stops and the mapping stays in progress.

Keys: `0` keep original · `1`–`9` pick result · `X` don't copy · `→`/`Enter` next · `←` back.

## How it talks to 7TV

There's no backend. The browser calls `https://api.7tv.app/v4/gql` directly, and that endpoint reflects any `Origin` in its CORS headers.

| Need | GQL |
| --- | --- |
| Current user + editable sets | `users { me { editableEmoteSetIds } }` |
| Set contents (paginated) | `emoteSets { emoteSet(id) { emotes(page, perPage) { items { alias flags { zeroWidth } emote { … } } } } }` |
| Seasonal search | `emotes { search(query, tags: { tags, match: ANY }, sort, filters: { exactMatch }) }` |
| Add emote | `mutation { emoteSets { emoteSet(id) { addEmote(id: { emoteId, alias }, zeroWidth) } } }` |

The v4 schema is introspectable, so you can browse it at `https://api.7tv.app/v4/gql`.

**Rate limits:** adds have their own bucket (`emote_set_change`). Search allows **100 requests per window**. When you go over, the API returns HTTP 200 with a `RATE_LIMIT_EXCEEDED` error, and `extensions.headers` gives `x-ratelimit-search-reset`. If you keep sending requests after that, the block grows much longer (about an hour). The client pauses each bucket until its reset time, and the UI only searches the emote on screen plus the next one (preloaded).

### Login

7TV's OAuth `redirect_uri` is fixed to `https://7tv.app/login/callback`, and an absolute `return_to` is refused (`return_to origin mismatch`). The PKCE verifier is also an `HttpOnly; SameSite=Strict` cookie on `api.7tv.app`. Because of all this, a third-party site can't finish the login itself. The app asks for your existing 7tv.app session token instead: in the DevTools console on 7tv.app, run `copy(localStorage.getItem("7tv-token"))` and paste the result. The token is kept in this app's `localStorage` and is only ever sent to `api.7tv.app`.

## Develop / deploy

```bash
pnpm install
pnpm dev        # http://localhost:3000
pnpm build      # static export in ./out
```

You can deploy `out/` to any static host. For Cloudflare Pages, set the build command to `pnpm build` and the output directory to `out`. If the app is hosted under a sub-path (for example a GitHub Pages project site), set `BASE_PATH=/repo-name` when you build.
