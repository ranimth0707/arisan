import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createServer } from "vite";
import { Keypair, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
after(() => server.close());
const { send } = await server.ssrLoadModule("/src/lib/send.ts");
const { withRequesterSigner, assertWalletSigner } = await server.ssrLoadModule("/src/lib/transaction-signers.ts");
const { drawPhase, claimBlocker } = await server.ssrLoadModule("/src/lib/circle-progress.ts");
const { PROGRAM_ID, getReadOnlyProgram, bn } = await server.ssrLoadModule("/src/lib/cookiejar.ts");
const { validate } = await import("../api/_relayer.js");
const program = getReadOnlyProgram();
const owner = Keypair.generate(), relayer = Keypair.generate();
const circle = Keypair.generate().publicKey;
const safety = Keypair.generate().publicKey;
const bond = Keypair.generate().publicKey;
const request = await program.methods.requestTurn().accountsPartial({ circle, safety, bond }).instruction();
const reimbursement = await program.methods.reimburseRelayer(bn(10000)).accountsPartial({
  relayer: relayer.publicKey,
  config: Keypair.generate().publicKey,
  sponsor: Keypair.generate().publicKey,
  sponsorVault: Keypair.generate().publicKey,
}).instruction();
const blockhash = Keypair.generate().publicKey.toBase58();
const compile = (instructions, payer = relayer.publicKey) => new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions }).compileToV0Message());

test("reproduces missing user signer in the old sponsored draw", () => {
  const tx = compile([reimbursement, request]);
  assert.throws(() => tx.sign([owner]), /Cannot sign with non signer key/);
  assert.throws(() => assertWalletSigner(tx, owner.publicKey), /belum tercantum/);
});

for (const method of ["requestTurn", "finalizeTurn", "redrawTurn"]) test(`${method}: wallet can sign and relayer accepts fixed message`, async () => {
  const accounts = method === "redrawTurn"
    ? { circle, membership: Keypair.generate().publicKey }
    : { circle, safety, bond };
  const ix = await program.methods[method]().accountsPartial(accounts).instruction();
  const fixed = withRequesterSigner([ix], owner.publicKey, PROGRAM_ID);
  const tx = compile([reimbursement, ...fixed]);
  assertWalletSigner(tx, owner.publicKey);
  tx.sign([owner]);
  assert.equal(tx.message.header.numRequiredSignatures, 2);
  validate(tx, relayer.publicKey);
  assert.equal(ix.keys.some(k => k.pubkey.equals(owner.publicKey)), false, "does not mutate caller instructions");
  assert.equal(withRequesterSigner(fixed, owner.publicKey, PROGRAM_ID), fixed);
});

test("existing user signer and writable privileges are preserved", () => {
  const ix = new TransactionInstruction({ programId: PROGRAM_ID, data: Buffer.alloc(0), keys: [{ pubkey: owner.publicKey, isSigner: true, isWritable: true }] });
  const instructions = [ix];
  assert.equal(withRequesterSigner(instructions, owner.publicKey, PROGRAM_ID), instructions);
});

test("legacy roster setup and draw fit one sponsored transaction", async () => {
  const roster = Keypair.generate().publicKey;
  const membership = Keypair.generate().publicKey;
  const circleSafety = Keypair.generate().publicKey;
  const initialize = await program.methods.initializeCircleRoster().accountsPartial({
    payer: relayer.publicKey, circle, roster, safety: circleSafety, bond,
    systemProgram: SystemProgram.programId,
  }).instruction();
  const sync = await program.methods.syncCircleMembers().accountsPartial({
    payer: relayer.publicKey, circle, roster, safety: circleSafety, bond,
  })
    .remainingAccounts([{ pubkey: membership, isSigner: false, isWritable: false }]).instruction();
  const fixed = withRequesterSigner([initialize, sync, request], owner.publicKey, PROGRAM_ID);
  const tx = compile([reimbursement, ...fixed]);
  assert.equal(tx.message.compiledInstructions.length, 4);
  tx.sign([owner]);
  validate(tx, relayer.publicKey);
});

function harness() {
  const calls = { builds: [], signs: 0, broadcasts: 0, posts: 0 };
  const conn = {
    getLatestBlockhash: async () => ({ blockhash, lastValidBlockHeight: 200 }),
    simulateTransaction: async () => ({ value: { err: null } }),
    confirmTransaction: async () => ({ value: { err: null } }),
    sendRawTransaction: async () => { calls.broadcasts++; return "self-paid-signature"; },
  };
  const wallet = { publicKey: owner.publicKey, signTransaction: async tx => { calls.signs++; tx.sign([owner]); return tx; } };
  const opts = { conn, relayerPubkey: relayer.publicKey, reimbursement, build: async payer => { calls.builds.push(payer.toBase58()); return [request]; } };
  return { calls, conn, wallet, opts };
}

test("sponsored draw reaches broadcast with the requesting wallet signature", async () => {
  const { calls, wallet, opts } = harness();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    calls.posts++;
    const tx = VersionedTransaction.deserialize(Buffer.from(JSON.parse(init.body).transaction, "base64"));
    const i = tx.message.staticAccountKeys.findIndex(k => k.equals(owner.publicKey));
    assert.ok(tx.signatures[i].some(byte => byte !== 0));
    validate(tx, relayer.publicKey);
    return { ok: true, json: async () => ({ signature: "sponsored-signature" }) };
  };
  try {
    assert.deepEqual(await send(wallet, opts), { signature: "sponsored-signature", sponsored: true });
    assert.equal(calls.signs, 1); assert.equal(calls.posts, 1); assert.equal(calls.broadcasts, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("wallet rejection does not launch a second approval", async () => {
  const { calls, wallet, opts } = harness();
  wallet.signTransaction = async () => { calls.signs++; throw new Error("User rejected the request"); };
  await assert.rejects(send(wallet, opts), /User rejected/);
  assert.equal(calls.signs, 1); assert.equal(calls.builds.length, 1); assert.equal(calls.broadcasts, 0);
});

for (const phase of ["post", "confirmation"]) test(`${phase} timeout never retries as a second self-paid transaction`, async () => {
  const { calls, wallet, opts, conn } = harness();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { calls.posts++; if (phase === "post") throw new Error("timeout"); return { ok: true, json: async () => ({ signature: "possibly-landed" }) }; };
  if (phase === "confirmation") conn.confirmTransaction = async () => { throw new Error("timeout"); };
  try { await assert.rejects(send(wallet, opts), /timeout/); assert.equal(calls.signs, 1); assert.equal(calls.broadcasts, 0); assert.equal(calls.builds.length, 1); }
  finally { globalThis.fetch = originalFetch; }
});

test("failed on-chain simulation prevents wallet approvals and broadcast", async () => {
  const { calls, wallet, opts, conn } = harness();
  conn.simulateTransaction = async () => ({ value: { err: { InstructionError: [0, { Custom: 6000 }] }, logs: ["Error Message: Round not over"] } });
  await assert.rejects(send(wallet, opts), /Round not over/);
  assert.equal(calls.signs, 0); assert.equal(calls.broadcasts, 0);
});

test("draw finalization respects exact expiry boundary and can restart", () => {
  assert.equal(drawPhase(0, 1000), "request");
  assert.equal(drawPhase(1000, 999), "waiting");
  assert.equal(drawPhase(1000, 1000), "finalize");
  assert.equal(drawPhase(1000, 1300), "finalize");
  assert.equal(drawPhase(1000, 1301), "expired");
  assert.equal(drawPhase(1000, null), "loading");
});

test("only an active, settled member who has never received a pot can claim", () => {
  const member = { active: true, paidRound: 2, roundsPaid: 2, hasWon: false };
  assert.equal(claimBlocker(member, 2), null);
  assert.match(claimBlocker({ ...member, hasWon: true }, 2), /sudah menerima/);
  assert.match(claimBlocker({ ...member, active: false }, 2), /jaminan/);
  assert.match(claimBlocker({ ...member, paidRound: 1 }, 2), /iuran/);
  assert.equal(claimBlocker({ ...member, roundsPaid: 0 }, 2), null, "a reserve-covered miss is settled without being labelled paid");
});
