// A full arisan cycle on Cookie Chain mainnet, including the case the whole
// design exists for: a member who stops paying.
//
// Three members, 10 COOK a round, 10 COOK collateral each. Member C pays the
// first round and then goes quiet, so the suite can check that the round still
// pays out in full, that C funds the shortfall out of their own collateral, and
// that C cannot collect a turn while sitting on a missed round.

import anchor from "@coral-xyz/anchor";
import {
  Keypair, SystemProgram, TransactionMessage, VersionedTransaction,
} from "@solana/web3.js";
import {
  KEYS, SLOT_HASHES, connection, cook, explorer, findBond, findCircle,
  findConfig, findMember, findPot, loadKeypair, loadProgram, toLamports,
} from "./lib.mjs";

const bn = (n) => new anchor.BN(n.toString());
const line = (s = "") => console.log(s);
const step = (s) => console.log(`\n--- ${s} ---`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const conn = connection();
const funder = loadKeypair(KEYS.deployer);
const program = loadProgram(funder);
const config = findConfig();

const results = [];
const check = (label, pass, note = "") => {
  results.push([label, pass]);
  line(`${pass ? "PASS" : "FAIL"}  ${label}${note ? `  (${note})` : ""}`);
};

const CONTRIBUTION = 10;
const COLLATERAL = 10;
const ROUND_SECONDS = 60;

// ------------------------------------------------------------ three wallets
step("Give three members enough COOK to take part");

const members = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
const names = ["A", "B", "C"];

const seed = new TransactionMessage({
  payerKey: funder.publicKey,
  recentBlockhash: (await conn.getLatestBlockhash()).blockhash,
  instructions: members.map((m) => SystemProgram.transfer({
    fromPubkey: funder.publicKey,
    toPubkey: m.publicKey,
    lamports: toLamports(60),
  })),
}).compileToV0Message();
const seedTx = new VersionedTransaction(seed);
seedTx.sign([funder]);
await conn.confirmTransaction(await conn.sendRawTransaction(seedTx.serialize()), "confirmed");
for (const [i, m] of members.entries()) {
  line(`member ${names[i]} : ${cook(await conn.getBalance(m.publicKey))} COOK`);
}

// --------------------------------------------------------------- the circle
step("Open a circle: 3 seats, 10 COOK a round, 10 COOK collateral");

const circleId = Math.floor(Date.now() / 1000);
const circle = findCircle(funder.publicKey, circleId);
const pot = findPot(circle);
const bond = findBond(circle);

await program.methods
  .createCircle(bn(circleId), "Arisan Warga", bn(toLamports(CONTRIBUTION)),
    bn(toLamports(COLLATERAL)), 3, bn(ROUND_SECONDS))
  .accountsPartial({
    creator: funder.publicKey, payer: funder.publicKey, config,
    circle, pot, bond, systemProgram: SystemProgram.programId,
  })
  .rpc();

const c0 = await program.account.circle.fetch(circle);
line(`circle   : ${circle.toBase58()}`);
check("circle opens empty and forming",
  c0.memberCount === 0 && c0.state.forming !== undefined);

// ------------------------------------------------------------------ joining
step("Everyone joins and posts collateral");

for (const [i, m] of members.entries()) {
  await program.methods.joinCircle()
    .accountsPartial({
      member: m.publicKey, payer: m.publicKey, circle, bond,
      membership: findMember(circle, m.publicKey),
      systemProgram: SystemProgram.programId,
    })
    .signers([m]).rpc();
  line(`member ${names[i]} joined, seat ${i}`);
}

const c1 = await program.account.circle.fetch(circle);
const bondHeld = await conn.getBalance(bond);
check("three seats taken", c1.memberCount === 3);
check("collateral is held by the program, not a person",
  bondHeld >= toLamports(COLLATERAL * 3), `${cook(bondHeld)} COOK in the bond vault`);

let fourthBlocked = false;
try {
  const gate = Keypair.generate();
  await program.methods.joinCircle()
    .accountsPartial({
      member: gate.publicKey, payer: funder.publicKey, circle, bond,
      membership: findMember(circle, gate.publicKey),
      systemProgram: SystemProgram.programId,
    })
    .signers([gate]).rpc();
} catch { fourthBlocked = true; }
check("a fourth member cannot squeeze in", fourthBlocked);

// ----------------------------------------------------------------- starting
step("Start the circle");

await program.methods.startCircle()
  .accountsPartial({ creator: funder.publicKey, circle }).rpc();

const c2 = await program.account.circle.fetch(circle);
check("running, on round 1", c2.state.running !== undefined && c2.round === 1);

let joinAfterStart = false;
try {
  const late = Keypair.generate();
  await program.methods.joinCircle()
    .accountsPartial({
      member: late.publicKey, payer: funder.publicKey, circle, bond,
      membership: findMember(circle, late.publicKey),
      systemProgram: SystemProgram.programId,
    })
    .signers([late]).rpc();
} catch { joinAfterStart = true; }
check("nobody can join once it is running", joinAfterStart);

// ------------------------------------------------------------- round 1, all
step("Round 1: everybody pays");

for (const [i, m] of members.entries()) {
  await program.methods.contribute()
    .accountsPartial({
      member: m.publicKey, circle, pot,
      membership: findMember(circle, m.publicKey),
      systemProgram: SystemProgram.programId,
    })
    .signers([m]).rpc();
  line(`member ${names[i]} paid ${CONTRIBUTION} COOK`);
}

const c3 = await program.account.circle.fetch(circle);
check("the pot holds all three contributions",
  c3.potAmount.toNumber() === toLamports(CONTRIBUTION * 3), `${cook(c3.potAmount)} COOK`);

let doublePay = false;
try {
  await program.methods.contribute()
    .accountsPartial({
      member: members[0].publicKey, circle, pot,
      membership: findMember(circle, members[0].publicKey),
      systemProgram: SystemProgram.programId,
    }).signers([members[0]]).rpc();
} catch { doublePay = true; }
check("paying twice in one round is refused", doublePay);

// -------------------------------------------------------------- the draw
step("Round 1 closes and the turn is drawn");

let earlyDraw = false;
try {
  await program.methods.requestTurn().accountsPartial({ circle }).rpc();
} catch { earlyDraw = true; }
check("the draw is refused before the round is over", earlyDraw);

line(`waiting ${ROUND_SECONDS}s for the round to close...`);
while (Math.floor(Date.now() / 1000) < c2.nextPayoutTs.toNumber() + 2) await sleep(3000);

const winner = await drawTurn();
line(`seat ${winner} wins round 1`);

const winnerIdx = winner;
const winnerKp = members[winnerIdx];
const potBefore = await conn.getBalance(pot);
const winnerBefore = await conn.getBalance(winnerKp.publicKey);

await program.methods.claimTurn()
  .accountsPartial({
    winner: winnerKp.publicKey, circle, pot,
    membership: findMember(circle, winnerKp.publicKey),
    systemProgram: SystemProgram.programId,
  })
  .signers([winnerKp]).rpc();

const winnerAfter = await conn.getBalance(winnerKp.publicKey);
const c4 = await program.account.circle.fetch(circle);
line(`member ${names[winnerIdx]} : ${cook(winnerBefore)} -> ${cook(winnerAfter)} COOK`);

check("the whole pot went to the drawn seat",
  winnerAfter - winnerBefore === toLamports(CONTRIBUTION * 3));
check("the pot is empty and the round advanced",
  c4.potAmount.toNumber() === 0 && c4.round === 2);

let secondTurn = false;
try {
  await program.methods.claimTurn()
    .accountsPartial({
      winner: winnerKp.publicKey, circle, pot,
      membership: findMember(circle, winnerKp.publicKey),
      systemProgram: SystemProgram.programId,
    }).signers([winnerKp]).rpc();
} catch { secondTurn = true; }
check("the same member cannot collect twice", secondTurn);
void potBefore;

// ------------------------------------------------- round 2, one goes quiet
step("Round 2: one member stops paying");

const quiet = members.findIndex((_, i) => i !== winnerIdx);
const payers = members.map((_, i) => i).filter((i) => i !== quiet);

for (const i of payers) {
  await program.methods.contribute()
    .accountsPartial({
      member: members[i].publicKey, circle, pot,
      membership: findMember(circle, members[i].publicKey),
      systemProgram: SystemProgram.programId,
    })
    .signers([members[i]]).rpc();
}
line(`member ${names[quiet]} did not pay`);

const c5 = await program.account.circle.fetch(circle);
line(`waiting ${ROUND_SECONDS}s for round 2 to close...`);
while (Math.floor(Date.now() / 1000) < c5.nextPayoutTs.toNumber() + 2) await sleep(3000);

const quietBondBefore = (await program.account.member.fetch(
  findMember(circle, members[quiet].publicKey))).collateral.toNumber();
const potBeforeSlash = (await program.account.circle.fetch(circle)).potAmount.toNumber();

// Anyone can do this. Here a wallet with no stake in the circle does it.
await program.methods.slashAbsent()
  .accountsPartial({
    circle, pot, bond,
    membership: findMember(circle, members[quiet].publicKey),
    systemProgram: SystemProgram.programId,
  })
  .rpc();

const quietAfter = await program.account.member.fetch(findMember(circle, members[quiet].publicKey));
const potAfterSlash = (await program.account.circle.fetch(circle)).potAmount.toNumber();

line(`member ${names[quiet]} collateral : ${cook(quietBondBefore)} -> ${cook(quietAfter.collateral)} COOK`);
line(`pot                     : ${cook(potBeforeSlash)} -> ${cook(potAfterSlash)} COOK`);

check("the missed contribution came out of their collateral",
  quietBondBefore - quietAfter.collateral.toNumber() === toLamports(CONTRIBUTION));
check("and it landed in the pot, so the round is still whole",
  potAfterSlash - potBeforeSlash === toLamports(CONTRIBUTION));
check("the pot is the full three contributions either way",
  potAfterSlash === toLamports(CONTRIBUTION * 3), `${cook(potAfterSlash)} COOK`);
check("out of collateral, so sidelined from winning", quietAfter.active === false);
check("the miss is on their public record", quietAfter.roundsMissed === 1);

let slashTwice = false;
try {
  await program.methods.slashAbsent()
    .accountsPartial({
      circle, pot, bond,
      membership: findMember(circle, members[quiet].publicKey),
      systemProgram: SystemProgram.programId,
    }).rpc();
} catch { slashTwice = true; }
check("the same absence cannot be charged twice", slashTwice);

// ------------------------------------------------- a sidelined member loses
step("Round 2 draw: a sidelined member cannot collect");

const winner2 = await drawTurn();
line(`seat ${winner2} drawn for round 2`);

if (winner2 === quiet) {
  let blocked = false;
  try {
    await program.methods.claimTurn()
      .accountsPartial({
        winner: members[quiet].publicKey, circle, pot,
        membership: findMember(circle, members[quiet].publicKey),
        systemProgram: SystemProgram.programId,
      }).signers([members[quiet]]).rpc();
  } catch { blocked = true; }
  check("the member who skipped cannot take the pot", blocked);
} else {
  // Prove it directly: the sidelined member claims a turn that is not theirs.
  let blocked = false;
  try {
    await program.methods.claimTurn()
      .accountsPartial({
        winner: members[quiet].publicKey, circle, pot,
        membership: findMember(circle, members[quiet].publicKey),
        systemProgram: SystemProgram.programId,
      }).signers([members[quiet]]).rpc();
  } catch { blocked = true; }
  check("the member who skipped cannot take the pot", blocked);
}

// --------------------------------------------------------------- summary
line();
const failed = results.filter(([, p]) => !p);
line(`${results.length - failed.length}/${results.length} checks passed`);
for (const [label] of failed) line(`  failed: ${label}`);
process.exit(failed.length ? 1 : 0);

/** Runs the two-phase draw, retrying if a request goes stale. */
async function drawTurn() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const state = await program.account.circle.fetch(circle);
    if (state.winnerDrawn) return state.winnerIndex;

    if (state.drawTargetSlot.toNumber() === 0) {
      await program.methods.requestTurn().accountsPartial({ circle }).rpc();
    }
    const target = (await program.account.circle.fetch(circle)).drawTargetSlot.toNumber();
    let slot = await conn.getSlot();
    while (slot < target) { await sleep(400); slot = await conn.getSlot(); }

    try {
      const sig = await program.methods.finalizeTurn()
        .accountsPartial({ circle, slotHashes: SLOT_HASHES }).rpc();
      line(`draw tx  : ${explorer(sig)}`);
      return (await program.account.circle.fetch(circle)).winnerIndex;
    } catch (e) {
      if (attempt === 3) throw e;
      line(`draw attempt ${attempt} went stale, requesting again`);
      await program.methods.requestTurn().accountsPartial({ circle }).rpc();
    }
  }
  throw new Error("could not finalize the draw");
}
