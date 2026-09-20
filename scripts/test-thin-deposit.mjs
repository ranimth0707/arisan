// Proves a circle whose deposit is below one contribution can now run a full
// round — the shape the app's form accepts but the program used to refuse.
import anchor from "@coral-xyz/anchor";
import { Keypair, SystemProgram } from "@solana/web3.js";
import {
  KEYS, connection, cook, findBond, findCircle, findConfig, findMember, findPot,
  findRoom, findRoster, findSafety, loadKeypair, loadProgram, toLamports, SLOT_HASHES,
} from "./lib.mjs";

const bn = (n) => new anchor.BN(n.toString());
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const conn = connection();
const payer = loadKeypair(KEYS.deployer);
const program = loadProgram(payer);

const SEATS = 2, CONTRIB = toLamports(0.5), DEPOSIT = toLamports(0.02); // 1/25th of a contribution
const INVITE = Array.from({length:32},(_,i)=>(i*3+29)%251||9);
const id = Math.floor(Date.now()/1000);
const circle = findCircle(payer.publicKey, id);

console.log(`contribution ${cook(CONTRIB)} COOK, deposit ${cook(DEPOSIT)} COOK — far below one round`);

await program.methods.createCircle(bn(id),"Thin deposit","Deposit below one contribution.",
  "https://github.com/ranimth0707/arisan",INVITE,bn(CONTRIB),bn(DEPOSIT),SEATS,bn(60))
  .accountsPartial({creator:payer.publicKey,payer:payer.publicKey,config:findConfig(),
    circle,room:findRoom(circle),pot:findPot(circle),bond:findBond(circle),
    systemProgram:SystemProgram.programId}).rpc();

const members=[Keypair.generate(),Keypair.generate()];
for (const m of members) {
  await program.provider.sendAndConfirm(new anchor.web3.Transaction().add(
    SystemProgram.transfer({fromPubkey:payer.publicKey,toPubkey:m.publicKey,lamports:toLamports(0.7)})),[]);
  await program.methods.joinCircle(INVITE).accountsPartial({member:m.publicKey,payer:payer.publicKey,
    circle,bond:findBond(circle),membership:findMember(circle,m.publicKey),room:findRoom(circle),
    systemProgram:SystemProgram.programId}).signers([m]).rpc();
}
await program.methods.startCircle().accountsPartial({starter:payer.publicKey,payer:payer.publicKey,
  circle,roster:findRoster(circle),safety:findSafety(circle),bond:findBond(circle),
  systemProgram:SystemProgram.programId}).rpc();
console.log("PASS  it starts");

for (const m of members) {
  await program.methods.contribute().accountsPartial({member:m.publicKey,circle,pot:findPot(circle),
    membership:findMember(circle,m.publicKey),systemProgram:SystemProgram.programId}).signers([m]).rpc();
}
let s = await program.account.circle.fetch(circle);
while (Math.floor(Date.now()/1000) < s.nextPayoutTs.toNumber()+2) await sleep(3000);

await program.methods.requestTurn().accountsPartial({circle,safety:findSafety(circle),bond:findBond(circle)}).rpc();
s = await program.account.circle.fetch(circle);
let slot = await conn.getSlot();
while (slot < s.drawTargetSlot.toNumber()) { await sleep(400); slot = await conn.getSlot(); }
await program.methods.finalizeTurn().accountsPartial({circle,roster:findRoster(circle),
  safety:findSafety(circle),bond:findBond(circle),slotHashes:SLOT_HASHES}).rpc();
s = await program.account.circle.fetch(circle);
console.log(`PASS  the draw runs (seat ${s.winnerIndex})`);

const w = members.find(async()=>true);
const winner = [];
for (const m of members) {
  const mem = await program.account.member.fetch(findMember(circle,m.publicKey));
  if (mem.seat === s.winnerIndex) winner.push(m);
}
const before = await conn.getBalance(winner[0].publicKey);
await program.methods.claimTurn().accountsPartial({winner:winner[0].publicKey,circle,
  roster:findRoster(circle),safety:findSafety(circle),pot:findPot(circle),
  membership:findMember(circle,winner[0].publicKey),systemProgram:SystemProgram.programId})
  .signers([winner[0]]).rpc();
const after = await conn.getBalance(winner[0].publicKey);
console.log(`PASS  the pot is collected (+${cook(after-before)} COOK)`);
console.log("\n3/3 — a thin deposit no longer blocks a circle.");
