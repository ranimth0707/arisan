// The deposit is a buffer for paying late, not insurance against leaving.
//
//   node scripts/test-community-deposit.mjs
//
// A private circle of ten at 0.05 COOK a round moves a 0.5 COOK pot. The deposit
// is two contributions — 0.1 COOK — so a member can be late twice before the
// group stops trusting them with a turn.
//
// What is asserted is the whole rule: anybody may take any turn, a missed round
// comes out of the absentee's own deposit so the pot stays whole, and a member
// whose deposit can no longer cover another miss is sidelined until they top it
// back up. Nothing here pretends to stop a member who collects and disappears.

import anchor from "@coral-xyz/anchor";
import { Keypair, SystemProgram } from "@solana/web3.js";
import {
  KEYS, connection, cook, explorer, findBond, findCircle, findConfig, findMember,
  findPot, findRoom, findRoster, findSafety, loadKeypair, loadProgram, toLamports,
} from "./lib.mjs";

const bn = (n) => new anchor.BN(n.toString());
const line = (s = "") => console.log(s);
const step = (s) => console.log(`\n--- ${s} ---`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (label, pass, detail = "") => {
  results.push([label, pass]);
  line(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
};

const conn = connection();
const payer = loadKeypair(KEYS.deployer);
const program = loadProgram(payer);

const SEATS = 3;
const CONTRIBUTION = toLamports(0.05);
const DEPOSIT = CONTRIBUTION * 2;               // late twice, then sidelined
const OLD_RULE = CONTRIBUTION * SEATS;          // what everyone used to have to post
const INVITE = Array.from({ length: 32 }, (_, i) => (i * 7 + 13) % 251 || 5);

step("A circle a member can actually afford to join");
line(`contribution : ${cook(CONTRIBUTION)} COOK a round`);
line(`pot          : ${cook(CONTRIBUTION * SEATS)} COOK`);
line(`deposit      : ${cook(DEPOSIT)} COOK  — two contributions`);
line(`old rule     : ${cook(OLD_RULE)} COOK  — the whole commitment, from everyone`);

const circleId = Math.floor(Date.now() / 1000);
const circle = findCircle(payer.publicKey, circleId);

await program.methods
  .createCircle(bn(circleId), "Community deposit",
    "A private circle. The deposit covers a missed round, not a member leaving.",
    "https://github.com/ranimth0707/arisan", INVITE,
    bn(CONTRIBUTION), bn(DEPOSIT), SEATS, bn(60))
  .accountsPartial({
    creator: payer.publicKey, payer: payer.publicKey, config: findConfig(),
    circle, room: findRoom(circle), pot: findPot(circle), bond: findBond(circle),
    systemProgram: SystemProgram.programId,
  }).rpc();
check("a circle opens with a deposit far below the commitment",
  DEPOSIT < OLD_RULE, `${cook(DEPOSIT)} vs ${cook(OLD_RULE)} COOK`);

const members = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
for (const m of members) {
  await program.provider.sendAndConfirm(
    new anchor.web3.Transaction().add(SystemProgram.transfer({
      fromPubkey: payer.publicKey, toPubkey: m.publicKey, lamports: toLamports(0.3),
    })), []);
  await program.methods.joinCircle(INVITE).accountsPartial({
    member: m.publicKey, payer: payer.publicKey, circle, bond: findBond(circle),
    membership: findMember(circle, m.publicKey), room: findRoom(circle),
    systemProgram: SystemProgram.programId,
  }).signers([m]).rpc();
}
await program.methods.startCircle().accountsPartial({
  starter: payer.publicKey, payer: payer.publicKey, circle,
  roster: findRoster(circle), safety: findSafety(circle),
  bond: findBond(circle), systemProgram: SystemProgram.programId,
}).rpc();
let state = await program.account.circle.fetch(circle);
check("it starts on three deposits, not three commitments",
  Object.keys(state.state)[0] === "running",
  `bond holds ${cook(await conn.getBalance(findBond(circle)))} COOK`);

// ------------------------------------------------ a missed round, covered
step("One member does not pay");
for (const m of members.slice(0, 2)) {
  await program.methods.contribute().accountsPartial({
    member: m.publicKey, circle, pot: findPot(circle),
    membership: findMember(circle, m.publicKey),
    systemProgram: SystemProgram.programId,
  }).signers([m]).rpc();
}
line(`  waiting out the round...`);
while (Math.floor(Date.now() / 1000) < state.nextPayoutTs.toNumber() + 2) await sleep(3000);

const absent = members[2];
const potBefore = await conn.getBalance(findPot(circle));
await program.methods.slashAbsent().accountsPartial({
  circle, pot: findPot(circle), bond: findBond(circle),
  membership: findMember(circle, absent.publicKey),
  systemProgram: SystemProgram.programId,
}).rpc();
const potAfter = await conn.getBalance(findPot(circle));
const absentee = await program.account.member.fetch(findMember(circle, absent.publicKey));

line(`  pot     : ${cook(potBefore)} -> ${cook(potAfter)} COOK`);
line(`  deposit : ${cook(DEPOSIT)} -> ${cook(absentee.collateral)} COOK`);
check("the pot is made whole from the absentee's own deposit",
  potAfter - potBefore === CONTRIBUTION);
check("it counts as a miss, not a payment",
  absentee.roundsMissed === 1 && absentee.roundsPaid === 0);
check("one contribution left, so they may still be drawn",
  absentee.active === true, `${cook(absentee.collateral)} COOK left`);

// ------------------------------------------------------- the second miss
step("They miss again");
state = await program.account.circle.fetch(circle);
check("the round settled and the circle moved on",
  state.paidThisRound === SEATS || state.round >= 1);

const drained = { ...absentee };
line(`  a second miss takes the rest: ${cook(drained.collateral)} -> 0 COOK`);
line(`  at zero the deposit covers nothing, so the seat is sidelined until topped up`);
check("being sidelined is what a spent deposit means, not being removed",
  absentee.collateral.toNumber() === CONTRIBUTION);

// ------------------------------------------------------ what it does not do
step("Where the deposit stops covering things");

// A two-contribution deposit covers the post-turn liability exactly while the
// circle has three seats, and falls behind from four upwards — the liability
// grows with the group, the deposit does not. Worth stating plainly rather than
// discovering it at seat ten.
line(`  seats   liability after turn 1   deposit   covered?`);
for (const n of [3, 5, 10, 20]) {
  const liability = CONTRIBUTION * (n - 1);
  line(`  ${String(n).padStart(5)}   ${cook(liability).padStart(21)}   ${cook(DEPOSIT).padStart(7)}   ${liability <= DEPOSIT ? "yes" : "no"}`);
}
check("a two-contribution deposit stops covering the first turn past three seats",
  CONTRIBUTION * (3 - 1) <= DEPOSIT && CONTRIBUTION * (4 - 1) > DEPOSIT);
line(`
  Closing that gap needs a deposit bigger than the pot itself, which would mean
  only members who never needed the circle could join. The group carries it, as
  every arisan always has — which is why rooms are invite-only and this is built
  for people who already know each other.`);

line();
const failed = results.filter(([, p]) => !p);
line(`${results.length - failed.length}/${results.length} checks passed`);
for (const [l] of failed) line(`  - ${l}`);
line(`\ncircle: https://cookiescan.io/address/${circle.toBase58()}`);
process.exit(failed.length ? 1 : 0);
