// Empties circles the recycler opened and abandoned.
//
//   node scripts/reclaim-orphans.mjs --status
//   node scripts/reclaim-orphans.mjs
//
// The recycler used to advance its record only once a start had succeeded, so a
// failed start left the record pointing at the old finished circle and the next
// run opened yet another replacement for it. Dozens accumulated, each holding
// deposits nobody was going to reach, each counted in the lobby as a room
// looking for members.
//
// That bug is fixed. This clears up what it already made: for every forming
// circle the treasury created that no record still points at, the wallets leave
// and take their deposits back.
//
// Leaving is only possible while a circle is forming, which is exactly the state
// these are stuck in. A running or finished circle is never touched.

import { SystemProgram } from "@solana/web3.js";
import { Keypair } from "@solana/web3.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  connection, explorer, findBond, findMember, loadKeypair, loadProgram,
  LAMPORTS_PER_COOK,
} from "./lib.mjs";

const TREASURY_FILE = path.join(os.homedir(), ".config/solana/cookiejar-treasury.json");
const MEMBERS_FILE = path.join(os.homedir(), ".config/solana/cookiejar-members.json");

const STATUS_ONLY = process.argv.includes("--status");
const line = (s = "") => console.log(s);
const cook = (l) => (Number(l) / LAMPORTS_PER_COOK).toLocaleString("en-US", { maximumFractionDigits: 4 });

const treasury = loadKeypair(TREASURY_FILE);
const conn = connection();
const program = loadProgram(treasury);

const state = JSON.parse(fs.readFileSync(MEMBERS_FILE, "utf8"));
const live = new Set(state.circles.map((record) => record.address));
const knownWallets = new Map();
for (const record of state.circles) {
  for (const member of record.members) {
    knownWallets.set(member.publicKey, Keypair.fromSecretKey(Uint8Array.from(member.secretKey)));
  }
}

const circles = (await program.account.circle.all())
  .filter((entry) => entry.account.creator.equals(treasury.publicKey))
  .filter((entry) => Object.keys(entry.account.state)[0] === "forming")
  .filter((entry) => !live.has(entry.publicKey.toBase58()));

const members = await program.account.member.all();

line(`orphaned forming circles: ${circles.length}`);
if (!circles.length) process.exit(0);

let reclaimed = 0;
let emptied = 0;
let stranded = 0;

for (const entry of circles) {
  const circle = entry.publicKey;
  const seated = members
    .filter((m) => m.account.circle.equals(circle))
    .sort((a, b) => b.account.seat - a.account.seat); // highest seat first, so each leaver is the tail

  const ours = seated.filter((m) => knownWallets.has(m.account.wallet.toBase58()));
  const held = seated.reduce((total, m) => total + m.account.collateral.toNumber(), 0);

  if (ours.length < seated.length) {
    line(`  ${circle.toBase58().slice(0, 8)}…  holds a seat that is not ours — leaving it alone`);
    stranded += held;
    continue;
  }
  if (STATUS_ONLY) {
    line(`  ${circle.toBase58().slice(0, 8)}…  ${seated.length} seat(s), ${cook(held)} COOK recoverable`);
    reclaimed += held;
    continue;
  }

  let left = 0;
  for (const m of ours) {
    const wallet = knownWallets.get(m.account.wallet.toBase58());
    try {
      await program.methods
        .leaveCircle()
        .accountsPartial({
          member: wallet.publicKey, circle, bond: findBond(circle),
          membership: findMember(circle, wallet.publicKey),
          // Always the highest remaining seat, so the tail is never needed.
          tail: null,
          systemProgram: SystemProgram.programId,
        })
        .signers([wallet])
        .rpc();
      reclaimed += m.account.collateral.toNumber();
      left += 1;
    } catch (e) {
      line(`  ${circle.toBase58().slice(0, 8)}…  seat ${m.account.seat} would not leave: ${e?.error?.errorCode?.code ?? String(e.message ?? e).slice(0, 60)}`);
    }
  }
  if (left) {
    emptied += 1;
    line(`  ${circle.toBase58().slice(0, 8)}…  emptied ${left} seat(s)`);
  }
}

line();
if (STATUS_ONLY) {
  line(`${cook(reclaimed)} COOK recoverable, ${cook(stranded)} COOK behind seats that are not ours.`);
  line("Run without --status to reclaim it.");
} else {
  line(`emptied ${emptied} circle(s), reclaimed ${cook(reclaimed)} COOK`);
  line(`treasury: ${cook(await conn.getBalance(treasury.publicKey))} COOK`);
  line("");
  line("The circle accounts themselves stay on chain — the program has no way to");
  line("close one — but with no members they no longer count as rooms looking for");
  line("members, and their deposits are back in circulation.");
}
