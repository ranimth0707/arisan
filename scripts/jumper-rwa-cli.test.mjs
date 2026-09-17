import test from "node:test";
import assert from "node:assert/strict";
import { buildAssetUrl, inspectEligibleHistory, volumeTier } from "./jumper-rwa-cli.mjs";

test("builds the Jumper RWA asset URL only for known eligible assets", () => {
  assert.equal(buildAssetUrl("nvda"), "https://rwa.jumper.xyz/assets/NVDA");
  assert.throws(() => buildAssetUrl("ETH"), /Unknown eligible asset/);
});

test("counts one eligible leg of a confirmed trade and ignores approvals", () => {
  const result = inspectEligibleHistory({
    transactions: [
      {
        hash: "0x1",
        type: "trade",
        status: "confirmed",
        transfers: [
          { direction: "out", fungible: "USDC", value: 500 },
          { direction: "in", fungible: "NVDAc", value: 499 },
        ],
      },
      {
        hash: "0x2",
        type: "approve",
        status: "confirmed",
        transfers: [{ direction: "in", fungible: "NVDAc", value: 999 }],
      },
      {
        hash: "0x3",
        type: "trade",
        status: "reverted",
        transfers: [{ direction: "in", fungible: "AAPLc", value: 700 }],
      },
    ],
  });
  assert.equal(result.observedVolumeUsd, 499);
  assert.equal(result.matchedTransactions, 1);
  assert.deepEqual(result.transactions[0].assets, ["NVDA"]);
});

test("maps mission volume to the published multiplier tiers", () => {
  assert.deepEqual(volumeTier(249), { minimum: 0, multiplier: 0, xp: 0, nextThreshold: 250, gapToNext: 1 });
  assert.deepEqual(volumeTier(1_000), { minimum: 1_000, multiplier: 2, xp: 15, nextThreshold: 10_000, gapToNext: 9_000 });
  assert.deepEqual(volumeTier(100_000), { minimum: 100_000, multiplier: 5, xp: 30, nextThreshold: null, gapToNext: 0 });
});

