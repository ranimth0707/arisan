// Exercises the parts e2e.mjs does not: proportional reward accrual, harvest,
// withdrawal, and a full Lucky draw cycle from request to prize claim.
//
// Runs against Cookie Chain mainnet with real COOK. Amounts are tiny.

import anchor from "@coral-xyz/anchor";
import { SystemProgram } from "@solana/web3.js";
import {
  KEYS, SLOT_HASHES, connection, cook, explorer, findConfig, findJar,
  findJarVault, findPosition, findRewardVault, loadKeypair, loadProgram,
  toLamports,
} from "./lib.mjs";

const bn = (n) => new anchor.BN(n.toString());
const line = (s = "") => console.log(s);
const step = (s) => console.log(`\n--- ${s} ---`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const conn = connection();
const user = loadKeypair(KEYS.deployer);
const program = loadProgram(user);
const config = findConfig();

const results = [];
const check = (label, pass) => {
  results.push([label, pass]);
  line(`${pass ? "PASS" : "FAIL"}  ${label}`);
};

// ============================================================ PROPORTIONAL
step("Proportional jar: rewards stream by amount x time");

const pid = Math.floor(Date.now() / 1000);
const pNow = Math.floor(Date.now() / 1000);
const pJar = findJar(user.publicKey, pid);
const pVault = findJarVault(pJar);
const pReward = findRewardVault(pJar);
const pPos = findPosition(pJar, user.publicKey);

await program.methods
  .createJar(bn(pid), "Streaming Jar", { proportional: {} },
    bn(pNow), bn(pNow + 120), bn(toLamports(0.1)), bn(toLamports(60)))
  .accountsPartial({
    creator: user.publicKey, config, jar: pJar,
    jarVault: pVault, rewardVault: pReward,
    systemProgram: SystemProgram.programId,
  })
  .rpc();

const pState0 = await program.account.jar.fetch(pJar);
line(`reward budget   : ${cook(pState0.rewardTotal)} COOK over 120s`);
line(`stream rate     : ${cook(pState0.rewardRate)} COOK/sec`);
// The rate is spread over the window still remaining when the transaction
// lands, which is a second or two short of the nominal 120, so this checks the
// ballpark rather than an exact quotient.
const idealRate = toLamports(60) / 120;
check("rate spreads the budget across the remaining window",
  pState0.rewardRate.toNumber() >= idealRate
  && pState0.rewardRate.toNumber() <= idealRate * 1.05);

await program.methods
  .deposit(bn(toLamports(10)))
  .accountsPartial({
    owner: user.publicKey, payer: user.publicKey, config, jar: pJar,
    jarVault: pVault, position: pPos,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
line(`deposited       : 10 COOK`);

line(`waiting 30s for rewards to accrue...`);
await sleep(30_000);

const balBeforeHarvest = await conn.getBalance(user.publicKey);
const hSig = await program.methods
  .harvest()
  .accountsPartial({
    owner: user.publicKey, jar: pJar, rewardVault: pReward,
    position: pPos, systemProgram: SystemProgram.programId,
  })
  .rpc();
const balAfterHarvest = await conn.getBalance(user.publicKey);

const pPosState = await program.account.position.fetch(pPos);
line(`harvested       : ${cook(pPosState.rewardsClaimed)} COOK`);
line(`tx              : ${explorer(hSig)}`);

// Sole depositor, so roughly 30 seconds of a 0.5 COOK/sec stream.
const harvested = pPosState.rewardsClaimed.toNumber();
check("rewards actually accrued", harvested > 0);
check("amount matches elapsed time, within a few seconds",
  harvested >= toLamports(12) && harvested <= toLamports(20));
check("wallet balance rose", balAfterHarvest > balBeforeHarvest);

// ================================================================ WITHDRAW
step("Withdrawal: full principal back, no penalty");

const vaultBeforeW = await conn.getBalance(pVault);
await program.methods
  .withdraw(bn(toLamports(10)))
  .accountsPartial({
    owner: user.publicKey, jar: pJar, jarVault: pVault,
    position: pPos, systemProgram: SystemProgram.programId,
  })
  .rpc();

const vaultAfterW = await conn.getBalance(pVault);
const pPosAfterW = await program.account.position.fetch(pPos);
const pJarAfterW = await program.account.jar.fetch(pJar);

line(`jar vault       : ${cook(vaultBeforeW)} -> ${cook(vaultAfterW)} COOK`);
check("full principal returned", vaultBeforeW - vaultAfterW === toLamports(10));
check("position emptied", pPosAfterW.amount.toNumber() === 0);
check("jar total_deposited back to zero", pJarAfterW.totalDeposited.toNumber() === 0);
check("vault kept its rent floor", vaultAfterW > 0);

// ============================================================== LUCKY DRAW
step("Lucky draw: request, finalize on a future slot hash, claim");

const lid = pid + 1;
const lNow = Math.floor(Date.now() / 1000);
const lJar = findJar(user.publicKey, lid);
const lVault = findJarVault(lJar);
const lReward = findRewardVault(lJar);
const lPos = findPosition(lJar, user.publicKey);

await program.methods
  .createJar(bn(lid), "Lucky Jar", { lucky: {} },
    bn(lNow), bn(lNow + 65), bn(toLamports(1)), bn(toLamports(25)))
  .accountsPartial({
    creator: user.publicKey, config, jar: lJar,
    jarVault: lVault, rewardVault: lReward,
    systemProgram: SystemProgram.programId,
  })
  .rpc();

await program.methods
  .deposit(bn(toLamports(2)))
  .accountsPartial({
    owner: user.publicKey, payer: user.publicKey, config, jar: lJar,
    jarVault: lVault, position: lPos,
    systemProgram: SystemProgram.programId,
  })
  .rpc();

const lPosState = await program.account.position.fetch(lPos);
line(`entry granted   : ${lPosState.hasEntry} (index ${lPosState.entryIndex})`);
check("deposit above minimum earns an entry", lPosState.hasEntry === true);

// Harvest must be rejected on a Lucky jar.
let harvestRejected = false;
try {
  await program.methods.harvest()
    .accountsPartial({
      owner: user.publicKey, jar: lJar, rewardVault: lReward,
      position: lPos, systemProgram: SystemProgram.programId,
    }).rpc();
} catch { harvestRejected = true; }
check("harvest is rejected on a Lucky jar", harvestRejected);

// Draw must be rejected before the jar ends.
let earlyDrawRejected = false;
try {
  await program.methods.requestDraw().accountsPartial({ jar: lJar }).rpc();
} catch { earlyDrawRejected = true; }
check("draw is rejected before the jar ends", earlyDrawRejected);

line(`waiting for the jar to close...`);
const closesAt = lNow + 65;
while (Math.floor(Date.now() / 1000) <= closesAt + 2) await sleep(3_000);

const reqSig = await program.methods.requestDraw().accountsPartial({ jar: lJar }).rpc();
const lAfterReq = await program.account.jar.fetch(lJar);
line(`draw requested  : target slot ${lAfterReq.drawTargetSlot.toString()}`);
line(`tx              : ${explorer(reqSig)}`);

// The "too early" path is deliberately not asserted here. The commitment is
// only three slots, about 1.2 seconds, which is shorter than one RPC round
// trip, so the window has usually closed before a test can reach it. The
// program does enforce it; this suite simply cannot observe it reliably.

// A stale request can be replaced, so the draw is never permanently stuck.
let finSig;
for (let attempt = 1; ; attempt++) {
  const state = await program.account.jar.fetch(lJar);
  if (state.drawState.finalized !== undefined) break;

  let slot = await conn.getSlot();
  while (slot < state.drawTargetSlot.toNumber()) {
    await sleep(400);
    slot = await conn.getSlot();
  }
  try {
    finSig = await program.methods
      .finalizeDraw()
      .accountsPartial({ jar: lJar, slotHashes: SLOT_HASHES })
      .rpc();
    break;
  } catch (e) {
    if (attempt >= 3) throw e;
    line(`finalize attempt ${attempt} went stale, requesting again`);
    const fresh = await program.account.jar.fetch(lJar);
    if (fresh.drawState.requested !== undefined) {
      await program.methods.requestDraw().accountsPartial({ jar: lJar }).rpc();
    }
  }
}
const lAfterFin = await program.account.jar.fetch(lJar);
line(`winning entry   : ${lAfterFin.winnerIndex.toString()}`);
if (finSig) line(`tx              : ${explorer(finSig)}`);
check("draw finalized", lAfterFin.drawState.finalized !== undefined);
check("winner index is inside the entry range",
  lAfterFin.winnerIndex.toNumber() < lAfterFin.entryCount.toNumber());

const rewardBeforeClaim = await conn.getBalance(lReward);
const claimSig = await program.methods
  .claimPrize()
  .accountsPartial({
    owner: user.publicKey, jar: lJar, rewardVault: lReward,
    position: lPos, systemProgram: SystemProgram.programId,
  })
  .rpc();
const rewardAfterClaim = await conn.getBalance(lReward);
const lFinal = await program.account.jar.fetch(lJar);

line(`prize paid      : ${cook(rewardBeforeClaim - rewardAfterClaim)} COOK`);
line(`tx              : ${explorer(claimSig)}`);
check("prize paid out", rewardBeforeClaim - rewardAfterClaim > 0);
check("jar records the winner", lFinal.winner !== null);
check("prize cannot be claimed twice", lFinal.prizeClaimed === true);

let doubleClaimRejected = false;
try {
  await program.methods.claimPrize()
    .accountsPartial({
      owner: user.publicKey, jar: lJar, rewardVault: lReward,
      position: lPos, systemProgram: SystemProgram.programId,
    }).rpc();
} catch { doubleClaimRejected = true; }
check("a second claim is rejected", doubleClaimRejected);

// ================================================================= SUMMARY
line();
const failed = results.filter(([, p]) => !p);
line(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  line("failed:");
  for (const [label] of failed) line(`  - ${label}`);
}
process.exit(failed.length ? 1 : 0);
