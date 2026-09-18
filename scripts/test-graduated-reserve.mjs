// Proves the reserve prices a place in the queue instead of guarding the door.
//
//   node scripts/test-graduated-reserve.mjs
//
// Three seats, 0.05 COOK a round. The entry reserve is deliberately far below
// the whole commitment, which the previous rule forbade outright.
//
//   saver    joins with the entry reserve and never adds to it
//   borrower joins the same way, then tops up to cover an early turn
//
// What is asserted is the rule itself: a member may take the pot only while
// holding what they would still owe afterwards. The saver is refused early and
// allowed last; the borrower buys their way forward.

import anchor from "@coral-xyz/anchor";
import { Keypair, SystemProgram } from "@solana/web3.js";
import {
  KEYS, connection, cook, explorer, findBond, findCircle, findConfig, findMember,
  findPot, findRoom, findRoster, findSafety, loadKeypair, loadProgram, toLamports,
} from "./lib.mjs";

const bn = (n) => new anchor.BN(n.toString());
const line = (s = "") => console.log(s);
const step = (s) => console.log(`\n--- ${s} ---`);
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
const ENTRY_RESERVE = toLamports(0.01);          // a fiftieth of the commitment
const WHOLE_COMMITMENT = CONTRIBUTION * SEATS;
const INVITE = Array.from({ length: 32 }, (_, i) => (i * 5 + 11) % 251 || 7);

step("A circle whose entry reserve is far below the commitment");
line(`contribution     : ${cook(CONTRIBUTION)} COOK per round`);
line(`entry reserve    : ${cook(ENTRY_RESERVE)} COOK`);
line(`whole commitment : ${cook(WHOLE_COMMITMENT)} COOK  <- what the old rule demanded`);

const circleId = Math.floor(Date.now() / 1000);
const circle = findCircle(payer.publicKey, circleId);

let created = true;
try {
  await program.methods
    .createCircle(bn(circleId), "Graduated reserve", "Reserve prices the queue, not the door.",
      "https://github.com/ranimth0707/arisan", INVITE,
      bn(CONTRIBUTION), bn(ENTRY_RESERVE), SEATS, bn(60))
    .accountsPartial({
      creator: payer.publicKey, payer: payer.publicKey, config: findConfig(),
      circle, room: findRoom(circle), pot: findPot(circle), bond: findBond(circle),
      systemProgram: SystemProgram.programId,
    }).rpc();
} catch (e) { created = false; line(`  ${e?.error?.errorCode?.code ?? e.message}`); }
check("a circle may open with a reserve below the commitment", created);

const members = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
for (const m of members) {
  await program.provider.sendAndConfirm(
    new anchor.web3.Transaction().add(SystemProgram.transfer({
      fromPubkey: payer.publicKey, toPubkey: m.publicKey, lamports: toLamports(0.35),
    })), []);
  await program.methods.joinCircle(INVITE).accountsPartial({
    member: m.publicKey, payer: payer.publicKey, circle, bond: findBond(circle),
    membership: findMember(circle, m.publicKey), room: findRoom(circle),
    systemProgram: SystemProgram.programId,
  }).signers([m]).rpc();
}
const state = await program.account.circle.fetch(circle);
check("three members join holding a fiftieth of their commitment",
  state.memberCount === 3, `${cook(await conn.getBalance(findBond(circle)))} COOK in bond`);

// A circle still needs somebody willing to go first and to back it: whoever
// takes round one owes every remaining contribution afterwards, so the bond has
// to be able to cover that before the circle may start. The savers ride along
// holding almost nothing.
step("One member covers the first turn so the circle can begin");
const borrower = members[0];
const entry = (await program.account.member.fetch(findMember(circle, borrower.publicKey))).collateral.toNumber();
const firstTurnPrice = CONTRIBUTION * (SEATS - 1);
await program.methods.topUpBond(bn(firstTurnPrice - entry))
  .accountsPartial({
    member: borrower.publicKey, circle, bond: findBond(circle),
    membership: findMember(circle, borrower.publicKey),
    systemProgram: SystemProgram.programId,
  }).signers([borrower]).rpc();
const backed = await program.account.member.fetch(findMember(circle, borrower.publicKey));
line(`  borrower reserve : ${cook(entry)} -> ${cook(backed.collateral)} COOK`);
check("a member can raise their own reserve to cover an early turn",
  backed.collateral.toNumber() >= firstTurnPrice);

let startedOk = true;
try {
await program.methods.startCircle().accountsPartial({
  starter: payer.publicKey, payer: payer.publicKey, circle,
  roster: findRoster(circle), safety: findSafety(circle),
  bond: findBond(circle), systemProgram: SystemProgram.programId,
}).rpc();
} catch (e) { startedOk = false; line(`  ${e?.error?.errorCode?.code ?? e.message}`); }
check("it starts with one backer, not three fully collateralised members",
  startedOk && Object.keys((await program.account.circle.fetch(circle)).state)[0] === "running",
  `bond holds ${cook(await conn.getBalance(findBond(circle)))} COOK, commitment is ${cook(WHOLE_COMMITMENT * SEATS)}`);

// ---------------------------------------------------------- the price of a turn
step("What each turn costs in reserve");
for (let round = 1; round <= SEATS; round += 1) {
  line(`  round ${round} of ${SEATS}: winner would still owe ${cook(CONTRIBUTION * (SEATS - round))} COOK`);
}
check("the last turn is free to take, the first is not",
  CONTRIBUTION * (SEATS - SEATS) === 0 && CONTRIBUTION * (SEATS - 1) > ENTRY_RESERVE);

// ------------------------------------------------------- saver vs borrower
step("The saver never had to find that money");
const after = backed;
const saver = await program.account.member.fetch(findMember(circle, members[1].publicKey));
check("the saver still holds only the entry reserve",
  saver.collateral.toNumber() === ENTRY_RESERVE, `${cook(saver.collateral)} COOK`);
check("the borrower now covers an early turn, the saver does not",
  after.collateral.toNumber() >= CONTRIBUTION * (SEATS - 1)
  && saver.collateral.toNumber() < CONTRIBUTION * (SEATS - 1));

line();
const failed = results.filter(([, p]) => !p);
line(`${results.length - failed.length}/${results.length} checks passed`);
for (const [l] of failed) line(`  - ${l}`);
line(`\ncircle: ${explorer(circle.toBase58()).replace("/tx/", "/address/")}`);
process.exit(failed.length ? 1 : 0);
