// Proves that leaving a forming circle cannot corrupt its seat numbering.
//
// Seats are handed out as `seat = member_count` and the draw addresses members
// by seat, so the range must stay a contiguous 0..member_count with no
// duplicates. Decrementing the count on the way out is not enough: it would
// hand the next joiner a seat somebody already holds and orphan the vacated
// one. Both break the circle, so both are asserted against here.
//
// Runs against Cookie Chain mainnet with real COOK. Amounts are deliberately
// tiny; the whole run costs well under a tenth of a COOK plus refundable rent.
//
// Each run leaves one emptied circle behind. The program has no close-circle
// instruction, so a forming circle nobody joined cannot be reclaimed; it costs
// a few thousand lamports of rent and shows up in the `forming` count.

import anchor from "@coral-xyz/anchor";
import { Keypair, SystemProgram } from "@solana/web3.js";
import {
  KEYS, connection, cook, explorer, findBond, findCircle, findConfig, findMember,
  findPot, findRoom, loadKeypair, loadProgram, toLamports,
} from "./lib.mjs";

const bn = (n) => new anchor.BN(n.toString());
const line = (s = "") => console.log(s);
const step = (s) => console.log(`\n--- ${s} ---`);

const conn = connection();
const payer = loadKeypair(KEYS.deployer);
const program = loadProgram(payer);

const results = [];
const check = (label, pass) => {
  results.push([label, pass]);
  line(`${pass ? "PASS" : "FAIL"}  ${label}`);
};

const CONTRIBUTION = toLamports(0.01);
const MAX_MEMBERS = 4;
// The program requires a reserve covering every planned contribution.
const COLLATERAL = CONTRIBUTION * MAX_MEMBERS;
const INVITE = Array.from({ length: 32 }, (_, i) => (i + 7) % 251 || 3);

/** Reads the seat of every member of a circle, sorted. */
async function seatsOf(circle) {
  const all = await program.account.member.all();
  return all
    .filter((entry) => entry.account.circle.equals(circle))
    .map((entry) => entry.account.seat)
    .sort((a, b) => a - b);
}

const memberFor = (circle, wallet) => ({
  member: wallet, payer: payer.publicKey, circle, bond: findBond(circle),
  membership: findMember(circle, wallet), room: findRoom(circle),
  systemProgram: SystemProgram.programId,
});

// ================================================================ SETUP
step("Setting up a four-seat circle");

const circleId = Math.floor(Date.now() / 1000);
const circle = findCircle(payer.publicKey, circleId);

await program.methods
  .createCircle(
    bn(circleId), "Seat integrity", "Temporary circle that checks seat bookkeeping.",
    "https://github.com/ranimth0707/arisan", INVITE,
    bn(CONTRIBUTION), bn(COLLATERAL), MAX_MEMBERS, bn(60),
  )
  .accountsPartial({
    creator: payer.publicKey, payer: payer.publicKey, config: findConfig(),
    circle, room: findRoom(circle), pot: findPot(circle), bond: findBond(circle),
    systemProgram: SystemProgram.programId,
  })
  .rpc();
line(`circle          : ${circle.toBase58()}`);

// Three joiners, funded just enough to post collateral. The deployer pays every
// account rent so the joiners need nothing beyond their own stake.
const joiners = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
for (const joiner of joiners) {
  const tx = new anchor.web3.Transaction().add(SystemProgram.transfer({
    fromPubkey: payer.publicKey,
    toPubkey: joiner.publicKey,
    lamports: COLLATERAL + toLamports(0.02),
  }));
  await program.provider.sendAndConfirm(tx, []);
}

for (const joiner of joiners) {
  await program.methods
    .joinCircle(INVITE)
    .accountsPartial(memberFor(circle, joiner.publicKey))
    .signers([joiner])
    .rpc();
}
line(`seats after join: [${await seatsOf(circle)}]`);
check("three joiners take seats 0, 1, 2",
  (await seatsOf(circle)).join() === "0,1,2");

// ======================================================== THE OLD BUG
step("Leaving a middle seat without the tail account is rejected");

let rejected = null;
try {
  await program.methods
    .leaveCircle()
    .accountsPartial({
      member: joiners[1].publicKey, circle, bond: findBond(circle),
      membership: findMember(circle, joiners[1].publicKey),
      tail: null,
      systemProgram: SystemProgram.programId,
    })
    .signers([joiners[1]])
    .rpc();
} catch (e) {
  rejected = e;
}
line(`rejected with   : ${rejected?.error?.errorCode?.code ?? rejected?.message?.slice(0, 60) ?? "nothing"}`);
check("a gap-creating leave is refused",
  rejected?.error?.errorCode?.code === "TailMemberRequired");
check("seats untouched by the refused attempt",
  (await seatsOf(circle)).join() === "0,1,2");

// ===================================================== THE REPAIRED PATH
step("Leaving a middle seat with the tail account closes the gap");

const sig = await program.methods
  .leaveCircle()
  .accountsPartial({
    member: joiners[1].publicKey, circle, bond: findBond(circle),
    membership: findMember(circle, joiners[1].publicKey),
    tail: findMember(circle, joiners[2].publicKey),
    systemProgram: SystemProgram.programId,
  })
  .signers([joiners[1]])
  .rpc();
line(`tx              : ${explorer(sig)}`);

const afterLeave = await seatsOf(circle);
const circleAfter = await program.account.circle.fetch(circle);
line(`seats now       : [${afterLeave}]  member_count=${circleAfter.memberCount}`);
check("the tail moved down into the vacated seat", afterLeave.join() === "0,1");
check("member_count matches the seat range", circleAfter.memberCount === 2);

const movedTail = await program.account.member.fetch(findMember(circle, joiners[2].publicKey));
check("the moved member kept its collateral", movedTail.collateral.toNumber() === COLLATERAL);

// ============================================= THE CONSEQUENCE THAT MATTERED
step("The next joiner gets a fresh seat, not a duplicate");

const latecomer = Keypair.generate();
await program.provider.sendAndConfirm(
  new anchor.web3.Transaction().add(SystemProgram.transfer({
    fromPubkey: payer.publicKey,
    toPubkey: latecomer.publicKey,
    lamports: COLLATERAL + toLamports(0.02),
  })), []);

await program.methods
  .joinCircle(INVITE)
  .accountsPartial(memberFor(circle, latecomer.publicKey))
  .signers([latecomer])
  .rpc();

const finalSeats = await seatsOf(circle);
line(`final seats     : [${finalSeats}]`);
check("seats stay contiguous and unique", finalSeats.join() === "0,1,2");
check("no seat is held twice", new Set(finalSeats).size === finalSeats.length);

// ================================================================= CLEANUP
step("Returning stakes");

// Unwinding from the highest seat down means the leaver is always the tail, so
// no tail account is ever needed. That is also the shape the UI should use.
const remaining = new Map([joiners[0], joiners[2], latecomer].map((w) => [w.publicKey.toBase58(), w]));
while (remaining.size > 0) {
  const members = (await program.account.member.all())
    .filter((entry) => entry.account.circle.equals(circle));
  const last = members.reduce((a, b) => (a.account.seat > b.account.seat ? a : b));
  const wallet = remaining.get(last.account.wallet.toBase58());
  if (!wallet) break;
  remaining.delete(last.account.wallet.toBase58());
  try {
    await program.methods
      .leaveCircle()
      .accountsPartial({
        member: wallet.publicKey, circle, bond: findBond(circle),
        membership: findMember(circle, wallet.publicKey),
        tail: null,
        systemProgram: SystemProgram.programId,
      })
      .signers([wallet])
      .rpc();
  } catch (e) {
    line(`could not unwind ${wallet.publicKey.toBase58().slice(0, 8)}: ${e.message?.slice(0, 80)}`);
    break;
  }
}
line(`seats left      : [${await seatsOf(circle)}]`);

const bondLeft = await conn.getBalance(findBond(circle));
line(`bond vault left : ${cook(bondLeft)} COOK`);

// ================================================================= SUMMARY
line();
const failed = results.filter(([, pass]) => !pass);
line(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  line("failed:");
  for (const [label] of failed) line(`  - ${label}`);
}
process.exit(failed.length ? 1 : 0);
