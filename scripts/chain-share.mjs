// Measures how much of Cookie Chain's actual activity comes from this program.
//
//   node scripts/chain-share.mjs
//
// Cookie Chain has no public stats API — the explorer's api.cookiescan.io is a
// Metaplex DAS endpoint for tokens and NFTs, and returns the same page for every
// path. So the honest source for chain-wide activity is the RPC itself.
//
// `getRecentPerformanceSamples` reports per-minute totals and retains 720 of
// them, which is a 12-hour window. Vote transactions are excluded throughout:
// on a Solana fork they are consensus overhead, not usage, and counting them
// would turn a near-idle chain into a busy-looking one.

import { Connection, PublicKey } from "@solana/web3.js";
import { PROGRAM_ID, RPC_URL } from "./lib.mjs";

const conn = new Connection(RPC_URL, "confirmed");
const line = (s = "") => console.log(s);
const n = (v) => v.toLocaleString("en-US");

const samples = await conn.getRecentPerformanceSamples(720);
let nonVote = 0;
let total = 0;
let seconds = 0;
for (const sample of samples) {
  nonVote += sample.numNonVoteTransactions ?? 0;
  total += sample.numTransactions;
  seconds += sample.samplePeriodSecs;
}

const cutoff = Math.floor(Date.now() / 1000) - seconds;
const program = new PublicKey(PROGRAM_ID);

let ours = 0;
let before;
for (;;) {
  const page = await conn.getSignaturesForAddress(program, {
    limit: 1000,
    ...(before ? { before } : {}),
  });
  if (!page.length) break;
  for (const entry of page) {
    if (entry.blockTime && entry.blockTime >= cutoff) ours += 1;
  }
  const oldest = page[page.length - 1];
  if (!oldest.blockTime || oldest.blockTime < cutoff) break;
  before = oldest.signature;
}

const others = nonVote - ours;
const share = nonVote > 0 ? (ours / nonVote) * 100 : 0;

line(`Window          : ${(seconds / 3600).toFixed(1)} hours, ending now`);
line(`Source          : ${RPC_URL} (getRecentPerformanceSamples + getSignaturesForAddress)`);
line("");
line(`Chain-wide, excluding votes : ${n(nonVote)} transactions`);
line(`  of which this program     : ${n(ours)}`);
line(`  everything else combined  : ${n(others)}`);
line(`  share                     : ${share.toFixed(1)}%`);
line("");
line(`Chain-wide including votes  : ${n(total)}  (consensus overhead, not usage)`);
line(`Non-vote transactions/day   : ${n(Math.round((nonVote / seconds) * 86_400))} at this rate`);
