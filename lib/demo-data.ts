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
      {
        alias: "!claim",
        zeroWidth: false,
        emote: {
          id: "01FYWNCE7G000BHTYM8E1XMV40",
          defaultName: "dumbass",
          deleted: false,
          tags: [],
          flags: { animated: false, defaultZeroWidth: false, private: false },
          ownerId: "01F6ZHDWWR000DP81XYZ6HXZ57",
          owner: { mainConnection: { platformDisplayName: "Blu3Smok3" } },
        },
      },
      {
        alias: "Chatting",
        zeroWidth: false,
        emote: {
          id: "01FAK9C8MR0004HKF2ZK1YPQ5A",
          defaultName: "Chatting",
          deleted: false,
          tags: [],
          flags: { animated: true, defaultZeroWidth: false, private: false },
          ownerId: "01F6W7WSGG0007WR3JGSXWV2WT",
          owner: { mainConnection: { platformDisplayName: "smc5" } },
        },
      },
      {
        alias: "Cooked",
        zeroWidth: false,
        emote: {
          id: "01JJ0D0C2XWZ640NP4WJKB8MYX",
          defaultName: "Cooked",
          deleted: false,
          tags: ["wyay", "dn9n", "ome", "xqc", "flight", "forsen"],
          flags: { animated: false, defaultZeroWidth: false, private: false },
          ownerId: "01FEAXPYGG000DE2NEK152WEWA",
          owner: { mainConnection: { platformDisplayName: "onzuu" } },
        },
      },
      {
        alias: "Hmm",
        zeroWidth: false,
        emote: {
          id: "01F6MA6Y100002B6P5MWZ5D916",
          defaultName: "Hmm",
          deleted: false,
          tags: [],
          flags: { animated: false, defaultZeroWidth: false, private: false },
          ownerId: "01F38QW5W8000AG1XYT0315MFE",
          owner: { mainConnection: { platformDisplayName: "LNSc" } },
        },
      },
      {
        alias: "LOL",
        zeroWidth: false,
        emote: {
          id: "01FZ975PV8000B4AWRZNMVNEXN",
          defaultName: "LOL",
          deleted: false,
          tags: ["minion", "lol"],
          flags: { animated: true, defaultZeroWidth: false, private: false },
          ownerId: "01FMTF9MY0000EXJQ7MWJVQQYD",
          owner: { mainConnection: { platformDisplayName: "m4x0nn" } },
        },
      },
      {
        alias: "LULW",
        zeroWidth: false,
        emote: {
          id: "01F22WE74G000F9Q0G00A2DE8N",
          defaultName: "LULW",
          deleted: false,
          tags: [],
          flags: { animated: false, defaultZeroWidth: false, private: false },
          ownerId: "00000000000000000000000000",
          owner: null,
        },
      },
      {
        alias: "o7",
        zeroWidth: false,
        emote: {
          id: "01FS5ZCFG0000500DPPCXJWCP8",
          defaultName: "o7",
          deleted: false,
          tags: [],
          flags: { animated: false, defaultZeroWidth: false, private: false },
          ownerId: "01F6TCXYKG0004VKGC5C8XSEW4",
          owner: { mainConnection: { platformDisplayName: "TristianJones116" } },
        },
      },
      {
        alias: "Pepega",
        zeroWidth: false,
        emote: {
          id: "01EZTD6KQ800012PTN006Q50PV",
          defaultName: "Pepega",
          deleted: false,
          tags: [],
          flags: { animated: false, defaultZeroWidth: false, private: false },
          ownerId: "01EZPFZZT00009D0SFZ9WC8RZ1",
          owner: { mainConnection: { platformDisplayName: "rupusen" } },
        },
      },
      {
        alias: "ReallyMad",
        zeroWidth: false,
        emote: {
          id: "01FN8W1EP8000EXJQ7MWJVSDMP",
          defaultName: "ReallyMad",
          deleted: false,
          tags: ["xylipizdish", "mad", "angry", "really", "grr", "grrrr"],
          flags: { animated: false, defaultZeroWidth: false, private: false },
          ownerId: "01F706ZT1G000748A5Q7VR4JX9",
          owner: { mainConnection: { platformDisplayName: "jeebs" } },
        },
      },
    ],
  },
  seasonal: [
    {
      name: "My Halloween Emotes",
      capacity: 1000,
      emotes: [
        {
          alias: "Chatting",
          zeroWidth: false,
          emote: {
            id: "01GDEKA3VG00024RGDR8VKPA5K",
            defaultName: "Chatting",
            deleted: false,
            tags: ["chatting", "pumpkin", "halloween"],
            flags: { animated: true, defaultZeroWidth: false, private: false },
            ownerId: "01FD96TQ400009ZAD9VPCVD96V",
            owner: { mainConnection: { platformDisplayName: "grimsalad" } },
          },
        },
        {
          alias: "Hmm",
          zeroWidth: false,
          emote: {
            id: "01GE9PHHR80006MCY6R6BPT8G6",
            defaultName: "Hmm",
            deleted: false,
            tags: ["hmm", "hmmm"],
            flags: { animated: false, defaultZeroWidth: false, private: false },
            ownerId: "01F7AE8B4G0004PHWER2HJK2ST",
            owner: { mainConnection: { platformDisplayName: "Dekyrot" } },
          },
        },
        {
          alias: "Pepega",
          zeroWidth: false,
          emote: {
            id: "01GEYG0AC00007VKAEFZEJMGFK",
            defaultName: "Pepega",
            deleted: false,
            tags: ["spooky", "zombie", "pepege", "halloween", "october", "halloween2022"],
            flags: { animated: false, defaultZeroWidth: false, private: false },
            ownerId: "01FPB6Y380000FZADBM40VTJNA",
            owner: { mainConnection: { platformDisplayName: "ketchungus" } },
          },
        },
        {
          alias: "WitchHat",
          zeroWidth: true,
          emote: {
            id: "01FKERQN08000CCCJ7DMGD1GH1",
            defaultName: "WitchHat",
            deleted: false,
            tags: ["witch", "hat", "halloween"],
            flags: { animated: false, defaultZeroWidth: true, private: false },
            ownerId: "01F6MVXHVR0009HX192HRAAZ0Y",
            owner: { mainConnection: { platformDisplayName: "Zealryn" } },
          },
        },
      ],
    },
    {
      name: "My Winter Emotes",
      capacity: 1000,
      emotes: [],
    },
  ],
};
