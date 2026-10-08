// Demo data for /demo: a snapshot of public 7TV emote sets, so the demo never depends on a set living on
// someone's account. Snapshotted 2026-10-08 from 01M4A3HC4TBQ4D14WKSE15Z893 (base) and
// 01M4A3HGVM7F9C2TXND2GMN436 (Halloween); the winter set starts empty. Edit by hand: each emote is one line, and
// the `emote` object is the shape the 7TV API returns. Kept small on purpose so the demo is quick.

import type { DemoSeed } from "./demo";

export const DEMO_SEED: DemoSeed = {
  base: {
    name: "My Emotes",
    capacity: 1000,
    emotes: [
      {"alias":"LOL","zeroWidth":false,"emote":{"id":"01FZ975PV8000B4AWRZNMVNEXN","defaultName":"LOL","deleted":false,"tags":["minion","lol"],"flags":{"animated":true,"defaultZeroWidth":false,"private":false},"owner":{"mainConnection":{"platformDisplayName":"m4x0nn"}}}},
      {"alias":"LULW","zeroWidth":false,"emote":{"id":"01F22WE74G000F9Q0G00A2DE8N","defaultName":"LULW","deleted":false,"tags":[],"flags":{"animated":false,"defaultZeroWidth":false,"private":false},"owner":null}},
      {"alias":"o7","zeroWidth":false,"emote":{"id":"01FS5ZCFG0000500DPPCXJWCP8","defaultName":"o7","deleted":false,"tags":[],"flags":{"animated":false,"defaultZeroWidth":false,"private":false},"owner":{"mainConnection":{"platformDisplayName":"TristianJones116"}}}},
      {"alias":"Pepega","zeroWidth":false,"emote":{"id":"01EZTD6KQ800012PTN006Q50PV","defaultName":"Pepega","deleted":false,"tags":[],"flags":{"animated":false,"defaultZeroWidth":false,"private":false},"owner":{"mainConnection":{"platformDisplayName":"rupusen"}}}},
      {"alias":"ReallyMad","zeroWidth":false,"emote":{"id":"01FN8W1EP8000EXJQ7MWJVSDMP","defaultName":"ReallyMad","deleted":false,"tags":["xylipizdish","mad","angry","really","grr","grrrr"],"flags":{"animated":false,"defaultZeroWidth":false,"private":false},"owner":{"mainConnection":{"platformDisplayName":"jeebs"}}}},
    ],
  },
  seasonal: [
    {
      name: "My Halloween Emotes",
      capacity: 1000,
      emotes: [
        {"alias":"LOL","zeroWidth":false,"emote":{"id":"01K5HWC3JPGCSTBS3Q01BX3DAW","defaultName":"LOL","deleted":false,"tags":["halloween","minions","lol"],"flags":{"animated":true,"defaultZeroWidth":false,"private":false},"owner":{"mainConnection":{"platformDisplayName":"Tech_Taylor"}}}},
        {"alias":"WitchHat","zeroWidth":true,"emote":{"id":"01FKERQN08000CCCJ7DMGD1GH1","defaultName":"WitchHat","deleted":false,"tags":["witch","hat","halloween"],"flags":{"animated":false,"defaultZeroWidth":true,"private":false},"owner":{"mainConnection":{"platformDisplayName":"Zealryn"}}}},
      ],
    },
    {
      name: "My Winter Emotes",
      capacity: 1000,
      emotes: [],
    },
  ],
};
