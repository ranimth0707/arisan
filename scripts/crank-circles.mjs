// Advances every seeded circle as far as the chain currently allows.
//
//   node scripts/crank-circles.mjs
//   node scripts/crank-circles.mjs --status     # read-only
//
// Safe to run repeatedly and on a schedule. Every action is guarded by the same
// condition the program enforces, so a run that has nothing to do sends nothing.
// Rounds only advance when their time is up, which is why this belongs in cron
// rather than in a loop.
//
// A round moves through four states and this walks all of them:
//   1. members pay in                      contribute
//   2. anyone who did not pay is settled   slash_absent   (from their reserve)
//   3. the turn is drawn                   request_turn + finalize_turn
//   4. the drawn member takes the pot      claim_turn

import {
  Keypair, SystemProgram, TransactionMessage, VersionedTransaction,
} from "@solana/web3.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  connection, explorer, findBond, findCircle, findMember, findPot, findRoster,
  findSafety, loadKeypair, loadProgram, LAMPORTS_PER_COOK, SLOT_HASHES,
} from "./lib.mjs";

const TREASURY_FILE = path.join(os.homedir(), ".config/solana/cookiejar-treasury.json");
const MEMBERS_FILE = path.join(os.homedir(), ".config/solana/cookiejar-members.json");

const STATUS_ONLY = process.argv.includes("--status");
const line = (s = "") => console.log(s);
const cook = (l) => (Number(l) / LAMPORTS_PER_COOK).toLocaleString("en-US", { maximumFractionDigits: 4 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (s) => `${s.slice(0, 8)}…`;

if (!fs.existsSync(MEMBERS_FILE)) {
  console.error(`no seeded circles at ${MEMBERS_FILE}. Run scripts/seed-circles.mjs first.`);
  process.exit(1);
}

const state = JSON.parse(fs.readFileSync(MEMBERS_FILE, "utf8"));
const treasury = loadKeypair(TREASURY_FILE);
const conn = connection();
const program = loadProgram(treasury);

const keypairOf = (member) => Keypair.fromSecretKey(Uint8Array.from(member.secretKey));

let actions = 0;
let failures = 0;

/** Runs one instruction, reporting rather than throwing: one stuck circle must
 *  not stop the others from advancing. */
async function attempt(label, run) {
  try {
    const signature = await run();
    actions += 1;
    line(`    ${label}  ${explorer(signature)}`);
    return true;
  } catch (e) {
    failures += 1;
    const code = e?.error?.errorCode?.code;
    line(`    ${label}  skipped: ${code ?? String(e.message ?? e).slice(0, 90)}`);
    return false;
  }
}

for (const record of state.circles) {
  const circle = findCircle(treasury.publicKey, record.circleId);
  let account;
  try {
    account = await program.account.circle.fetch(circle);
  } catch {
    line(`\n${record.address} — not on chain, skipping`);
    continue;
  }

  const stateName = Object.keys(account.state)[0];
  const potBalance = await conn.getBalance(findPot(circle));
  const bondBalance = await conn.getBalance(findBond(circle));
  const now = Math.floor(Date.now() / 1000);
  const dueIn = account.nextPayoutTs.toNumber() - now;

  line(`\n${record.address}  ${account.name}`);
  line(`  ${stateName}  round ${account.round}/${account.memberCount}  `
    + `paid ${account.paidThisRound}/${account.memberCount}  `
    + `pot ${cook(potBalance)}  bond ${cook(bondBalance)}  `
    + (dueIn > 0 ? `draw in ${Math.ceil(dueIn / 60)}m` : "draw due"));

  if (STATUS_ONLY || stateName !== "running") continue;

  // ------------------------------------------------------------ 1. PAY IN
  const round = account.round;
  const unpaid = [];
  for (const member of record.members) {
    const wallet = keypairOf(member);
    let membership;
    try {
      membership = await program.account.member.fetch(findMember(circle, wallet.publicKey));
    } catch {
      continue; // left or never joined
    }
    if (membership.paidRound >= round) continue;

    const balance = await conn.getBalance(wallet.publicKey);
    if (balance < account.contribution.toNumber() + 5_000_000) {
      unpaid.push({ member, wallet, membership, reason: "wallet empty" });
      continue;
    }
    const ok = await attempt(`pay   ${short(member.publicKey)}`, () => program.methods
      .contribute()
      .accountsPartial({
        member: wallet.publicKey, circle, pot: findPot(circle),
        membership: findMember(circle, wallet.publicKey),
        systemProgram: SystemProgram.programId,
      })
      .signers([wallet])
      .rpc());
    if (!ok) unpaid.push({ member, wallet, membership, reason: "contribute failed" });
  }

  // --------------------------------------------------- 2. SETTLE ABSENTEES
  // Only once the round is over. Before that a member is not late, and the
  // program refuses the slash anyway.
  if (unpaid.length && Math.floor(Date.now() / 1000) >= account.nextPayoutTs.toNumber()) {
    for (const entry of unpaid) {
      await attempt(`slash ${short(entry.member.publicKey)} (${entry.reason})`, () => program.methods
        .slashAbsent()
        .accountsPartial({
          circle, pot: findPot(circle), bond: findBond(circle),
          membership: findMember(circle, entry.wallet.publicKey),
          systemProgram: SystemProgram.programId,
        })
        .rpc());
    }
  }

  // ------------------------------------------------------------- 3. DRAW
  let current = await program.account.circle.fetch(circle);
  const roundOver = Math.floor(Date.now() / 1000) >= current.nextPayoutTs.toNumber();
  const settled = current.paidThisRound === current.memberCount;

  if (!current.winnerDrawn && roundOver && settled) {
    const requested = await attempt("request turn", () => program.methods
      .requestTurn()
      .accountsPartial({ circle, safety: findSafety(circle), bond: findBond(circle) })
      .rpc());

    if (requested) {
      current = await program.account.circle.fetch(circle);
      const target = current.drawTargetSlot.toNumber();
      // The seed is the hash of a block three slots ahead, so it does not exist
      // yet at request time. Wait for it rather than guessing.
      let slot = await conn.getSlot();
      while (slot < target) {
        await sleep(400);
        slot = await conn.getSlot();
      }
      await attempt("finalize turn", () => program.methods
        .finalizeTurn()
        .accountsPartial({
          circle, roster: findRoster(circle), safety: findSafety(circle),
          bond: findBond(circle), slotHashes: SLOT_HASHES,
        })
        .rpc());
    }
  } else if (!current.winnerDrawn && roundOver && !settled) {
    line(`    waiting: ${current.memberCount - current.paidThisRound} member(s) unsettled`);
  }

  // -------------------------------------------------------- 4. TAKE THE POT
  current = await program.account.circle.fetch(circle);
  if (!current.winnerDrawn) continue;

  const winnerSeat = current.winnerIndex;
  let winner = null;
  for (const member of record.members) {
    const wallet = keypairOf(member);
    try {
      const membership = await program.account.member.fetch(findMember(circle, wallet.publicKey));
      if (membership.seat === winnerSeat) { winner = { member, wallet, membership }; break; }
    } catch { /* not a member */ }
  }

  if (!winner) {
    line(`    seat ${winnerSeat} is not one of ours — leaving it for its owner to claim`);
    continue;
  }

  await attempt(`claim ${short(winner.member.publicKey)} (seat ${winnerSeat}, ${cook(current.potAmount)} COOK)`,
    () => program.methods
      .claimTurn()
      .accountsPartial({
        winner: winner.wallet.publicKey, circle, roster: findRoster(circle),
        safety: findSafety(circle), pot: findPot(circle),
        membership: findMember(circle, winner.wallet.publicKey),
        systemProgram: SystemProgram.programId,
      })
      .signers([winner.wallet])
      .rpc());
}

// ============================================================== RECYCLE
//
// A circle is closed-loop: each round the members pay one pot in and one of them
// takes the same pot out. So a wallet that has just won is holding roughly a
// whole circle's round, and wallets that have not won yet are draining. Moving
// the surplus back through the treasury is what lets every wallet start with a
// few rounds of float instead of the full commitment, which is the difference
// between locking capital as TVL and parking it in wallets doing nothing.
//
// Nothing here touches a bond or a pot. This only moves the change.

/** Left in a wallet so it can pay several rounds and its own fees. */
const FLOAT_ROUNDS = 4;
const FEE_FLOOR = 20_000_000;

if (!STATUS_ONLY) {
  line("\n=== Recycling working capital ===");

  const sweeps = [];
  const topUps = [];

  for (const record of state.circles) {
    const circle = findCircle(treasury.publicKey, record.circleId);
    let account;
    try { account = await program.account.circle.fetch(circle); } catch { continue; }
    if (Object.keys(account.state)[0] === "forming") continue;

    const float = account.contribution.toNumber() * FLOAT_ROUNDS + FEE_FLOOR;
    for (const member of record.members) {
      const wallet = keypairOf(member);
      const balance = await conn.getBalance(wallet.publicKey);
      if (balance > float * 2) sweeps.push({ wallet, lamports: balance - float });
      else if (balance < float / 2) topUps.push({ to: wallet.publicKey, lamports: float - balance });
    }
  }

  for (const sweep of sweeps) {
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
    const message = new TransactionMessage({
      payerKey: sweep.wallet.publicKey,
      recentBlockhash: blockhash,
      instructions: [SystemProgram.transfer({
        fromPubkey: sweep.wallet.publicKey,
        toPubkey: treasury.publicKey,
        // One signature, so one 5,000 lamport fee comes out on top of this.
        lamports: sweep.lamports - 5_000,
      })],
    }).compileToV0Message();
    const tx = new VersionedTransaction(message);
    tx.sign([sweep.wallet]);
    try {
      const signature = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
      await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
      actions += 1;
    } catch (e) {
      failures += 1;
      line(`  sweep failed: ${String(e.message ?? e).slice(0, 80)}`);
    }
  }
  const swept = sweeps.reduce((total, s) => total + s.lamports, 0);
  line(`  swept   : ${cook(swept)} COOK from ${sweeps.length} wallet(s)`);

  const treasuryBalance = await conn.getBalance(treasury.publicKey);
  const wanted = topUps.reduce((total, t) => total + t.lamports, 0);
  if (wanted > treasuryBalance - FEE_FLOOR) {
    line(`  topping up ${cook(wanted)} COOK needs more than the treasury's ${cook(treasuryBalance)} COOK`);
    line("  run scripts/fund-treasury.mjs, or the crank will start settling from collateral");
  }

  const BATCH = 12;
  let sent = 0;
  for (let offset = 0; offset < topUps.length; offset += BATCH) {
    const slice = topUps.slice(offset, offset + BATCH);
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
    const message = new TransactionMessage({
      payerKey: treasury.publicKey,
      recentBlockhash: blockhash,
      instructions: slice.map((t) => SystemProgram.transfer({
        fromPubkey: treasury.publicKey, toPubkey: t.to, lamports: t.lamports,
      })),
    }).compileToV0Message();
    const tx = new VersionedTransaction(message);
    tx.sign([treasury]);
    try {
      const signature = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
      await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
      sent += slice.length;
      actions += 1;
    } catch (e) {
      failures += 1;
      line(`  top-up failed: ${String(e.message ?? e).slice(0, 80)}`);
    }
  }
  line(`  topped  : ${cook(wanted)} COOK into ${sent} wallet(s)`);
  line(`  treasury: ${cook(await conn.getBalance(treasury.publicKey))} COOK`);
}

// ================================================================ SUMMARY
line();
if (STATUS_ONLY) {
  line("status only, nothing sent.");
} else {
  line(`${actions} transaction(s) landed, ${failures} skipped.`);
  line("Run again after the next round closes.");
}
