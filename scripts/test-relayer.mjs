// Tries to abuse the relayer the way an attacker would.
//
// The relayer signs as fee payer for strangers, so without these rules it is a
// free transaction service for the whole chain and its balance is anyone's to
// spend. Each case below is a specific way to steal that budget.

import anchor from "@coral-xyz/anchor";
import {
  Keypair, PublicKey, SystemProgram, TransactionInstruction,
  TransactionMessage, VersionedTransaction,
} from "@solana/web3.js";
import {
  KEYS, SLOT_HASHES, connection, findClaim, findConfig, findEnvelope,
  findEnvelopeVault, findJar, findJarVault, findPosition, findRewardVault,
  findSponsor, findSponsorVault, loadKeypair, loadProgram, toLamports,
} from "./lib.mjs";

const RELAYER_URL = process.env.RELAYER_URL ?? "http://localhost:8787";
const bn = (n) => new anchor.BN(n.toString());

const conn = connection();
const sponsor = loadKeypair(KEYS.deployer);
const program = loadProgram(sponsor);

const health = await (await fetch(`${RELAYER_URL}/health`)).json();
const relayer = new PublicKey(health.relayer);
console.log(`relayer ${relayer.toBase58()}`);
console.log(`balance ${(health.balanceLamports / 1e9).toFixed(4)} COOK\n`);

const results = [];
function check(label, pass, note = "") {
  results.push([label, pass]);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${note ? `  (${note})` : ""}`);
}

async function post(tx) {
  const res = await fetch(`${RELAYER_URL}/sponsor`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transaction: Buffer.from(tx.serialize()).toString("base64") }),
  });
  return { status: res.status, body: await res.json() };
}

async function build(instructions, payerKey = relayer, signers = []) {
  const { blockhash } = await conn.getLatestBlockhash();
  const msg = new TransactionMessage({
    payerKey, recentBlockhash: blockhash, instructions,
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  if (signers.length) tx.sign(signers);
  return tx;
}

const reimburse = (amount) =>
  program.methods
    .reimburseRelayer(bn(amount))
    .accountsPartial({
      relayer,
      config: findConfig(),
      sponsor: findSponsor(sponsor.publicKey),
      sponsorVault: findSponsorVault(sponsor.publicKey),
      systemProgram: SystemProgram.programId,
    })
    .instruction();

// ---------------------------------------------------------------- attacks

console.log("--- attempts that must be refused ---\n");

{
  // Drain the relayer with a plain transfer it would be signing as fee payer.
  const tx = await build([
    await reimburse(20_000),
    SystemProgram.transfer({
      fromPubkey: relayer, toPubkey: Keypair.generate().publicKey,
      lamports: toLamports(4),
    }),
  ]);
  const { status, body } = await post(tx);
  check("a bare transfer out of the relayer is refused", status === 400, body.error);
}

{
  // Use the relayer as a free fee payer for an unrelated program.
  const memo = new TransactionInstruction({
    programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
    keys: [],
    data: Buffer.from("free ride", "utf8"),
  });
  const tx = await build([await reimburse(20_000), memo]);
  const { status, body } = await post(tx);
  check("a foreign program is refused", status === 400, body.error);
}

{
  // Ask for more than the per-transaction cap.
  const tx = await build([await reimburse(500_000_000)]);
  const { status, body } = await post(tx);
  check("an oversized reimbursement is refused", status === 400, body.error);
}

{
  // Get a free transaction without paying the relayer back.
  const ix = await program.methods
    .requestDraw()
    .accountsPartial({ jar: findJar(sponsor.publicKey, 1) })
    .instruction();
  const tx = await build([ix]);
  const { status, body } = await post(tx);
  check("a transaction with no reimbursement is refused", status === 400, body.error);
}

{
  // Have the relayer pay while someone drains a sponsor's gas vault.
  const ix = await program.methods
    .withdrawGas(bn(toLamports(10)))
    .accountsPartial({
      authority: sponsor.publicKey,
      sponsor: findSponsor(sponsor.publicKey),
      sponsorVault: findSponsorVault(sponsor.publicKey),
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  const tx = await build([await reimburse(20_000), ix]);
  const { status, body } = await post(tx);
  check("withdrawing someone's gas budget is not sponsorable", status === 400, body.error);
}

{
  // Someone else pays the fee, so the relayer signature would be a free extra.
  const outsider = Keypair.generate();
  const tx = await build([await reimburse(20_000)], outsider.publicKey);
  const { status, body } = await post(tx);
  check("a transaction the relayer does not pay for is refused", status === 400, body.error);
}

{
  // Two reimbursements in one transaction, doubling the take.
  const tx = await build([await reimburse(4_000_000), await reimburse(4_000_000)]);
  const { status, body } = await post(tx);
  check("a second reimbursement is refused", status === 400, body.error);
}

// ----------------------------------------------------------- the real thing

console.log("\n--- the legitimate path must still work ---\n");

const now = Math.floor(Date.now() / 1000);
const jarId = now;
const envelopeId = now;
const jar = findJar(sponsor.publicKey, jarId);
const envelope = findEnvelope(sponsor.publicKey, envelopeId);

await program.methods
  .createJar(bn(jarId), "Relayer Test Jar", { lucky: {} },
    bn(now), bn(now + 900), bn(toLamports(1)), bn(toLamports(5)))
  .accountsPartial({
    creator: sponsor.publicKey, config: findConfig(), jar,
    jarVault: findJarVault(jar), rewardVault: findRewardVault(jar),
    systemProgram: SystemProgram.programId,
  })
  .rpc();

await program.methods
  .createEnvelope(bn(envelopeId), "relayer check", bn(toLamports(6)), 2,
    { equal: {} }, bn(now + 3600))
  .accountsPartial({
    creator: sponsor.publicKey, config: findConfig(), envelope,
    envelopeVault: findEnvelopeVault(envelope),
    systemProgram: SystemProgram.programId,
  })
  .rpc();

const newcomer = Keypair.generate();
const before = await conn.getBalance(newcomer.publicKey);

const rentClaim = await conn.getMinimumBalanceForRentExemption(8 + 90);
const rentPosition = await conn.getMinimumBalanceForRentExemption(8 + 130);

const crack = await program.methods
  .crackIntoJar()
  .accountsPartial({
    claimer: newcomer.publicKey,
    payer: relayer,
    config: findConfig(),
    envelope,
    envelopeVault: findEnvelopeVault(envelope),
    claim: findClaim(envelope, newcomer.publicKey),
    jar,
    jarVault: findJarVault(jar),
    position: findPosition(jar, newcomer.publicKey),
    slotHashes: SLOT_HASHES,
    systemProgram: SystemProgram.programId,
  })
  .instruction();

const good = await build(
  [await reimburse(rentClaim + rentPosition + 20_000), crack],
  relayer,
  [newcomer],
);

const { status, body } = await post(good);
check("a real sponsored claim is accepted", status === 200, body.signature ?? body.error);

if (body.signature) {
  await conn.confirmTransaction(body.signature, "confirmed");
  const after = await conn.getBalance(newcomer.publicKey);
  check("the claimer still holds zero COOK", before === 0 && after === 0, `${before} -> ${after}`);
  console.log(`\nhttps://cookiescan.io/tx/${body.signature}`);
}

// ----------------------------------------------------------------- summary

const failed = results.filter(([, p]) => !p);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  for (const [label] of failed) console.log(`  failed: ${label}`);
}
process.exit(failed.length ? 1 : 0);
