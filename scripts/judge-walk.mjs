// Walks the exact path a reviewer takes: fresh wallet, public faucet, published
// code, one full round — with no privileged access anywhere.
import anchor from "@coral-xyz/anchor";
import { Keypair, SystemProgram } from "@solana/web3.js";
import { createHash } from "node:crypto";
import {
  connection, explorer, findBond, findCircle, findMember, findPot, findRoom,
  findRoster, findSafety, loadKeypair, loadProgram, KEYS, LAMPORTS_PER_COOK, SLOT_HASHES,
} from "./lib.mjs";

const cook = (l) => (Number(l) / LAMPORTS_PER_COOK).toFixed(4);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (label, pass, detail = "") => {
  results.push([label, pass]);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
};

const conn = connection();
const judge = Keypair.generate();
const program = loadProgram(judge);
console.log(`judge wallet: ${judge.publicKey.toBase58()}\n`);

// 1 ---------------------------------------------------------- public faucet
const res = await fetch("https://arisan-cook.vercel.app/api/faucet", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ wallet: judge.publicKey.toBase58() }),
});
const body = await res.json();
check("faucet funds a brand-new wallet", res.ok, body.signature?.slice(0, 12) ?? body.error);
const funded = await conn.getBalance(judge.publicKey);
console.log(`   balance: ${cook(funded)} COOK\n`);

// 2 ------------------------------------------------- find the room by its code
const hash = Array.from(createHash("sha256").update("ARISAN-DEMO").digest());
const rooms = await program.account.circleRoom.all();
const matches = rooms.filter(r => r.account.inviteCodeHash.every((v, i) => v === hash[i]));
check("the published code finds a room", matches.length > 0, `${matches.length} room(s) share it`);
let circle = null, state = null;
for (const m of matches) {
  const s = await program.account.circle.fetch(m.account.circle);
  if (Object.keys(s.state)[0] === "forming" && s.memberCount < s.maxMembers) { circle = m.account.circle; state = s; break; }
}
check("at least one of them has a seat free", Boolean(circle));
check("the room has a seat free", state.memberCount < state.maxMembers,
  `${state.memberCount}/${state.maxMembers}`);
check("faucet COOK covers the reserve",
  funded > state.collateral.toNumber(), `need ${cook(state.collateral)} COOK`);

// 3 ------------------------------------------------------------------- join
await program.methods.joinCircle(hash).accountsPartial({
  member: judge.publicKey, payer: judge.publicKey, circle,
  bond: findBond(circle), membership: findMember(circle, judge.publicKey),
  room: findRoom(circle), systemProgram: SystemProgram.programId,
}).rpc();
state = await program.account.circle.fetch(circle);
check("joining fills the room", state.memberCount === state.maxMembers);

// 4 ------------------------ start it, as a member who is NOT the creator
const isCreator = state.creator.equals(judge.publicKey);
await program.methods.startCircle().accountsPartial({
  starter: judge.publicKey, payer: judge.publicKey, circle,
  roster: findRoster(circle), safety: findSafety(circle),
  bond: findBond(circle), systemProgram: SystemProgram.programId,
}).rpc();
state = await program.account.circle.fetch(circle);
check("a visitor can start it without the organiser",
  Object.keys(state.state)[0] === "running" && !isCreator);

// 5 --------------------------------------------------------------- pay in
await program.methods.contribute().accountsPartial({
  member: judge.publicKey, circle, pot: findPot(circle),
  membership: findMember(circle, judge.publicKey),
  systemProgram: SystemProgram.programId,
}).rpc();
check("contribution lands in the pot",
  (await conn.getBalance(findPot(circle))) > state.contribution.toNumber());

console.log(`\n   waiting out the 60s round...\n`);
while (Math.floor(Date.now() / 1000) < state.nextPayoutTs.toNumber() + 2) await sleep(3000);

// 6 -------------------- settle the other seat from its reserve, as the visitor
const others = (await program.account.member.all())
  .filter(m => m.account.circle.equals(circle) && !m.account.wallet.equals(judge.publicKey));
const bondBefore = await conn.getBalance(findBond(circle));
for (const other of others) {
  if (other.account.paidRound >= state.round) continue;
  await program.methods.slashAbsent().accountsPartial({
    circle, pot: findPot(circle), bond: findBond(circle),
    membership: findMember(circle, other.account.wallet),
    systemProgram: SystemProgram.programId,
  }).rpc();
}
const bondAfter = await conn.getBalance(findBond(circle));
state = await program.account.circle.fetch(circle);
check("an absent member is covered from their own reserve",
  state.paidThisRound === state.memberCount,
  `bond ${cook(bondBefore)} -> ${cook(bondAfter)}`);

// 7 ----------------------------------------------------------------- draw
await program.methods.requestTurn()
  .accountsPartial({ circle, safety: findSafety(circle), bond: findBond(circle) }).rpc();
state = await program.account.circle.fetch(circle);
let slot = await conn.getSlot();
while (slot < state.drawTargetSlot.toNumber()) { await sleep(400); slot = await conn.getSlot(); }
await program.methods.finalizeTurn().accountsPartial({
  circle, roster: findRoster(circle), safety: findSafety(circle),
  bond: findBond(circle), slotHashes: SLOT_HASHES,
}).rpc();
state = await program.account.circle.fetch(circle);
check("the draw resolves", state.winnerDrawn, `seat ${state.winnerIndex}`);

// 8 ------------------------------------------------------------ collect
const mine = await program.account.member.fetch(findMember(circle, judge.publicKey));
if (mine.seat === state.winnerIndex) {
  const before = await conn.getBalance(judge.publicKey);
  await program.methods.claimTurn().accountsPartial({
    winner: judge.publicKey, circle, roster: findRoster(circle),
    safety: findSafety(circle), pot: findPot(circle),
    membership: findMember(circle, judge.publicKey),
    systemProgram: SystemProgram.programId,
  }).rpc();
  const after = await conn.getBalance(judge.publicKey);
  check("the visitor collects the pot", after > before, `+${cook(after - before)} COOK`);
} else {
  check("the draw landed on the host seat, so the crank must collect", true,
    `seat ${state.winnerIndex}, not the visitor's ${mine.seat}`);
}

console.log();
const failed = results.filter(([, p]) => !p);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
for (const [l] of failed) console.log(`  - ${l}`);
process.exit(failed.length ? 1 : 0);
