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

/** Mirrors TURN_CLAIM_WINDOW in programs/cookie_jar/src/constants.rs. */
const TURN_CLAIM_WINDOW = 60 * 60 * 24;

if (!fs.existsSync(MEMBERS_FILE)) {
  console.error(`no seeded circles at ${MEMBERS_FILE}. Run scripts/seed-circles.mjs first.`);
  process.exit(1);
}

const state = JSON.parse(fs.readFileSync(MEMBERS_FILE, "utf8"));
const treasury = loadKeypair(TREASURY_FILE);
const conn = connection();
const program = loadProgram(treasury);

const keypairOf = (member) => Keypair.fromSecretKey(Uint8Array.from(member.secretKey));

/**
 * Restricts this run to records carrying a tag, so the public demo room — whose
 * rounds are a minute long — can be cranked every minute without dragging a
 * hundred and fifty wallets through the same pass.
 */
const ONLY = (() => {
  const index = process.argv.indexOf("--only");
  return index === -1 ? null : process.argv[index + 1];
})();
const inScope = (record) => ONLY === null || record.tag === ONLY;

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
  if (!inScope(record)) continue;
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
      continue; // settled from its reserve below
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
    void ok; // a failed contribution is settled from the reserve below
  }

  // --------------------------------------------------- 2. SETTLE ABSENTEES
  //
  // Every unpaid seat, not only the ones we hold. A visitor who joins the demo
  // room, plays a round and walks away would otherwise stall it forever: the
  // round can never settle, so the draw never runs, so the circle never
  // finishes, so it is never replaced — and because it is full and running, no
  // new visitor can join either. One abandoned seat would quietly end the demo.
  //
  // Slashing is permissionless by design and costs the absentee nothing they did
  // not already agree to: one contribution out of the reserve they posted, into
  // the pot, recorded as a miss rather than a payment.
  //
  // Only once the round is over. Before that a member is not late, and the
  // program refuses the slash anyway.
  if (Math.floor(Date.now() / 1000) >= account.nextPayoutTs.toNumber()) {
    const seats = (await program.account.member.all())
      .filter((m) => m.account.circle.equals(circle) && m.account.paidRound < round);
    for (const seat of seats) {
      const wallet = seat.account.wallet;
      const ours = record.members.some((m) => m.publicKey === wallet.toBase58());
      await attempt(`slash ${short(wallet.toBase58())} (seat ${seat.account.seat}${ours ? "" : ", not ours"})`,
        () => program.methods
          .slashAbsent()
          .accountsPartial({
            circle, pot: findPot(circle), bond: findBond(circle),
            membership: findMember(circle, wallet),
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
    let requested = await attempt("request turn", () => program.methods
      .requestTurn()
      .accountsPartial({ circle, safety: findSafety(circle), bond: findBond(circle) })
      .rpc());

    // A draw commits to a slot three ahead and must be finalized within 300
    // slots of it, about two minutes. Past that the program calls the request
    // stale and refuses, so that stalling the finalize cannot be used to reach
    // back to a hash the caller has already seen and retry until it suits them.
    //
    // A slow RPC round trip can miss that window through no fault of anyone, and
    // on short rounds losing the draw costs a whole round. So an expired draw is
    // re-requested here rather than left for the next run: a fresh request
    // commits to a fresh unknown slot, which is exactly what the rule wants.
    for (let attemptNo = 1; requested && attemptNo <= 3; attemptNo += 1) {
      current = await program.account.circle.fetch(circle);
      if (current.winnerDrawn) break;

      const target = current.drawTargetSlot.toNumber();
      let slot = await conn.getSlot();
      while (slot < target) {
        await sleep(400);
        slot = await conn.getSlot();
      }

      const finalized = await attempt(`finalize turn${attemptNo > 1 ? ` (retry ${attemptNo - 1})` : ""}`,
        () => program.methods
          .finalizeTurn()
          .accountsPartial({
            circle, roster: findRoster(circle), safety: findSafety(circle),
            bond: findBond(circle), slotHashes: SLOT_HASHES,
          })
          .rpc());
      if (finalized) break;

      requested = await attempt("re-request turn", () => program.methods
        .requestTurn()
        .accountsPartial({ circle, safety: findSafety(circle), bond: findBond(circle) })
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
    // A visitor's seat won. It is theirs to collect, so this waits — but not
    // forever. If they never come back the circle cannot finish, and a demo room
    // that cannot finish is never replaced and never has a seat for anybody
    // else. The program allows a redraw once the claim window has passed, which
    // is exactly this situation, so take it when it becomes available.
    const drawn = (await program.account.member.all())
      .find((m) => m.account.circle.equals(circle) && m.account.seat === winnerSeat);
    const windowClosed = drawn && Math.floor(Date.now() / 1000)
      >= current.nextPayoutTs.toNumber() + TURN_CLAIM_WINDOW;

    if (drawn && windowClosed) {
      await attempt(`redraw seat ${winnerSeat} (claim window passed)`, () => program.methods
        .redrawTurn()
        .accountsPartial({ circle, membership: findMember(circle, drawn.account.wallet) })
        .rpc());
    } else {
      const waitMins = drawn
        ? Math.ceil((current.nextPayoutTs.toNumber() + TURN_CLAIM_WINDOW - Date.now() / 1000) / 60)
        : 0;
      line(`    seat ${winnerSeat} is not one of ours — theirs to collect, redraw in ${waitMins}m`);
    }
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

/**
 * Rounds a wallet can fund before the treasury tops it up again. Two, not four:
 * the crank runs more often than any round closes, so a wallet never needs to
 * self-fund for long, and every extra round of float is capital parked across a
 * hundred and fifty wallets instead of locked as TVL.
 */
const FLOAT_ROUNDS = 2;
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
      // Sweeping at twice the float and topping up at half of it left a dead
      // band that most wallets settled inside: 88 of 100 parked at exactly the
      // float, 12 ran dry, and nothing was ever above the sweep line to fund
      // them. The treasury covered the gap until it nearly emptied. A tighter
      // band keeps the same total circulating and moves it to whoever needs it.
      if (balance > float * 1.5) sweeps.push({ wallet, lamports: balance - float });
      else if (balance < float) topUps.push({ to: wallet.publicKey, lamports: float - balance });
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
