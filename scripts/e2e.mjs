// End-to-end proof on Cookie Chain mainnet.
//
// The claim this test exists to verify: a wallet holding exactly zero COOK can
// open a Fortune Cookie, and doing so RAISES protocol TVL instead of draining
// it, because the COOK moves from one program vault into another rather than
// out to a wallet.

import anchor from "@coral-xyz/anchor";
import {
  Keypair, SystemProgram, TransactionMessage, VersionedTransaction,
} from "@solana/web3.js";
import {
  KEYS, SLOT_HASHES, connection, cook, explorer, findClaim, findConfig,
  findEnvelope, findEnvelopeVault, findJar, findJarVault, findPosition,
  findRewardVault, findSponsor, findSponsorVault, loadKeypair, loadProgram,
  toLamports,
} from "./lib.mjs";

const bn = (n) => new anchor.BN(n.toString());
const line = (s = "") => console.log(s);
const step = (n, s) => console.log(`\n--- ${n}. ${s} ---`);

const conn = connection();
const sponsor = loadKeypair(KEYS.deployer);
const relayer = loadKeypair(KEYS.relayer);
const program = loadProgram(sponsor);

const now = Math.floor(Date.now() / 1000);
const jarId = now;
const envelopeId = now;

line(`sponsor/creator : ${sponsor.publicKey.toBase58()}`);
line(`relayer         : ${relayer.publicKey.toBase58()}`);

// ---------------------------------------------------------------- 1. relayer
step(1, "Fund the relayer so it can front transaction fees");

let relayerBalance = await conn.getBalance(relayer.publicKey);
if (relayerBalance < toLamports(0.5)) {
  const msg = new TransactionMessage({
    payerKey: sponsor.publicKey,
    recentBlockhash: (await conn.getLatestBlockhash()).blockhash,
    instructions: [SystemProgram.transfer({
      fromPubkey: sponsor.publicKey,
      toPubkey: relayer.publicKey,
      lamports: toLamports(2),
    })],
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([sponsor]);
  const sig = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction(sig, "confirmed");
  relayerBalance = await conn.getBalance(relayer.publicKey);
}
line(`relayer balance : ${cook(relayerBalance)} COOK`);

// ------------------------------------------------------------ 2. sponsor gas
step(2, "Deposit COOK into the sponsor gas vault");

const sponsorPda = findSponsor(sponsor.publicKey);
const sponsorVault = findSponsorVault(sponsor.publicKey);

// Only top up when the tank is actually low. Depositing every run drained the
// funding wallet and made the suite fail for a reason that had nothing to do
// with what it tests.
const tank = await conn.getBalance(sponsorVault);
if (tank < toLamports(20)) {
  await program.methods
    .depositGas(bn(toLamports(20)))
    .accountsPartial({
      authority: sponsor.publicKey,
      sponsor: sponsorPda,
      sponsorVault,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  line("topped the sponsor tank up");
}

const sponsorVaultBefore = await conn.getBalance(sponsorVault);
line(`sponsor vault   : ${cook(sponsorVaultBefore)} COOK  (counts as TVL)`);

// ------------------------------------------------------------------ 3. a jar
step(3, "Open a Lucky jar with a 2 COOK prize");

const jar = findJar(sponsor.publicKey, jarId);
const jarVault = findJarVault(jar);
const rewardVault = findRewardVault(jar);

await program.methods
  .createJar(
    bn(jarId),
    "Grand Opening Jar",
    { lucky: {} },
    bn(now),
    bn(now + 3600),
    bn(toLamports(0.5)),
    bn(toLamports(2)),
  )
  .accountsPartial({
    creator: sponsor.publicKey,
    config: findConfig(),
    jar,
    jarVault,
    rewardVault,
    systemProgram: SystemProgram.programId,
  })
  .rpc();

line(`jar             : ${jar.toBase58()}`);
line(`reward vault    : ${cook(await conn.getBalance(rewardVault))} COOK`);

// ------------------------------------------------------------ 4. an envelope
step(4, "Fill a Fortune Cookie with 6 COOK for 3 claimers");

const envelope = findEnvelope(sponsor.publicKey, envelopeId);
const envelopeVault = findEnvelopeVault(envelope);

await program.methods
  .createEnvelope(
    bn(envelopeId),
    "welcome to Cookie Chain",
    bn(toLamports(6)),
    3,
    { surprise: {} },
    bn(now + 86400),
  )
  .accountsPartial({
    creator: sponsor.publicKey,
    config: findConfig(),
    envelope,
    envelopeVault,
    systemProgram: SystemProgram.programId,
  })
  .rpc();

const envelopeVaultBefore = await conn.getBalance(envelopeVault);
const jarVaultBefore = await conn.getBalance(jarVault);
line(`envelope vault  : ${cook(envelopeVaultBefore)} COOK`);
line(`jar vault       : ${cook(jarVaultBefore)} COOK`);

// ------------------------------------------------- 5. the zero-balance claim
step(5, "A brand new wallet with zero COOK cracks it open");

const newcomer = Keypair.generate();
const newcomerBefore = await conn.getBalance(newcomer.publicKey);
line(`newcomer        : ${newcomer.publicKey.toBase58()}`);
line(`newcomer balance: ${newcomerBefore} lamports`);
if (newcomerBefore !== 0) throw new Error("newcomer should be empty");

// What the relayer fronts: rent for the two accounts this opens, plus the fee.
const rentClaim = await conn.getMinimumBalanceForRentExemption(90);
const rentPosition = await conn.getMinimumBalanceForRentExemption(130);
const reimbursement = rentClaim + rentPosition + 10_000;
line(`relayer fronts  : ${cook(reimbursement)} COOK (rent + fee), cap is 0.005`);

const position = findPosition(jar, newcomer.publicKey);

const ixReimburse = await program.methods
  .reimburseRelayer(bn(reimbursement))
  .accountsPartial({
    relayer: relayer.publicKey,
    config: findConfig(),
    sponsor: sponsorPda,
    sponsorVault,
    systemProgram: SystemProgram.programId,
  })
  .instruction();

const ixCrack = await program.methods
  .crackIntoJar()
  .accountsPartial({
    claimer: newcomer.publicKey,
    payer: relayer.publicKey,
    config: findConfig(),
    envelope,
    envelopeVault,
    claim: findClaim(envelope, newcomer.publicKey),
    jar,
    jarVault,
    position,
    slotHashes: SLOT_HASHES,
    systemProgram: SystemProgram.programId,
  })
  .instruction();

const msg = new TransactionMessage({
  payerKey: relayer.publicKey, // relayer pays 100% of the fee
  recentBlockhash: (await conn.getLatestBlockhash()).blockhash,
  instructions: [ixReimburse, ixCrack],
}).compileToV0Message();

const tx = new VersionedTransaction(msg);
tx.sign([relayer, newcomer]); // newcomer only authorises, pays nothing

const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
await conn.confirmTransaction(sig, "confirmed");
line(`tx              : ${explorer(sig)}`);

// -------------------------------------------------------------- 6. the proof
step(6, "What actually moved");

const newcomerAfter = await conn.getBalance(newcomer.publicKey);
const jarVaultAfter = await conn.getBalance(jarVault);
const envelopeVaultAfter = await conn.getBalance(envelopeVault);
const positionState = await program.account.position.fetch(position);
const jarState = await program.account.jar.fetch(jar);

const claimed = jarVaultAfter - jarVaultBefore;

line();
line(`newcomer COOK   : ${newcomerBefore} -> ${newcomerAfter} lamports`);
line(`envelope vault  : ${cook(envelopeVaultBefore)} -> ${cook(envelopeVaultAfter)} COOK`);
line(`jar vault (TVL) : ${cook(jarVaultBefore)} -> ${cook(jarVaultAfter)} COOK`);
line();
line(`position owner  : ${positionState.owner.toBase58()}`);
line(`position amount : ${cook(positionState.amount)} COOK`);
line(`has raffle entry: ${positionState.hasEntry} (index ${positionState.entryIndex})`);
line(`jar depositors  : ${jarState.depositorCount}`);
line(`jar entries     : ${jarState.entryCount}`);

line();
const checks = [
  ["newcomer paid nothing", newcomerAfter === 0],
  ["claim landed in the jar, not a wallet", claimed > 0],
  ["envelope vault fell by exactly what the jar gained",
    envelopeVaultBefore - envelopeVaultAfter === claimed],
  ["TVL went up, not down", jarVaultAfter > jarVaultBefore],
  ["position belongs to the newcomer", positionState.owner.equals(newcomer.publicKey)],
  ["newcomer got a raffle entry", positionState.hasEntry === true],
];

let ok = true;
for (const [label, pass] of checks) {
  line(`${pass ? "PASS" : "FAIL"}  ${label}`);
  if (!pass) ok = false;
}

line();
line(ok ? "All checks passed." : "Something failed, see above.");
process.exit(ok ? 0 : 1);
