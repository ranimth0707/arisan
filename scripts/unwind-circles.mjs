// Returns every seeded COOK to the treasury.
//
//   node scripts/unwind-circles.mjs --status     # what is recoverable right now
//   node scripts/unwind-circles.mjs
//
// Collateral is only withdrawable once a circle has finished, which is the whole
// point of the reserve: nobody, including whoever seeded it, can pull the
// backing out from under a circle that is still running. So this recovers what
// is currently free and reports what is not, rather than pretending it can
// unwind a live circle.
//
// Run it after the circles complete. Until then the money is doing its job.

import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  connection, explorer, findBond, findCircle, findMember, loadKeypair,
  loadProgram, LAMPORTS_PER_COOK,
} from "./lib.mjs";

const TREASURY_FILE = path.join(os.homedir(), ".config/solana/cookiejar-treasury.json");
const MEMBERS_FILE = path.join(os.homedir(), ".config/solana/cookiejar-members.json");

const STATUS_ONLY = process.argv.includes("--status");
const line = (s = "") => console.log(s);
const cook = (l) => (Number(l) / LAMPORTS_PER_COOK).toLocaleString("en-US", { maximumFractionDigits: 4 });

if (!fs.existsSync(MEMBERS_FILE)) {
  console.error(`nothing to unwind: no ${MEMBERS_FILE}`);
  process.exit(1);
}

const state = JSON.parse(fs.readFileSync(MEMBERS_FILE, "utf8"));
const treasury = loadKeypair(TREASURY_FILE);
const conn = connection();
const program = loadProgram(treasury);

let recovered = 0;
let stranded = 0;

for (const record of state.circles) {
  const circle = findCircle(treasury.publicKey, record.circleId);
  let account;
  try { account = await program.account.circle.fetch(circle); } catch { continue; }

  const stateName = Object.keys(account.state)[0];
  const bond = await conn.getBalance(findBond(circle));
  line(`\n${record.address}  ${account.name}`);
  line(`  ${stateName}  round ${account.round}/${account.memberCount}  bond ${cook(bond)} COOK`);

  if (stateName !== "finished") {
    stranded += bond;
    const roundsLeft = account.memberCount - account.winnersSoFar;
    line(`  still running: ${roundsLeft} round(s) to go before collateral unlocks`);
    if (!STATUS_ONLY) continue;
  }

  if (STATUS_ONLY) continue;

  // ------------------------------------------------- collateral back out
  for (const member of record.members) {
    const wallet = Keypair.fromSecretKey(Uint8Array.from(member.secretKey));
    try {
      const membership = await program.account.member.fetch(findMember(circle, wallet.publicKey));
      if (membership.collateral.toNumber() === 0) continue;
      await program.methods
        .withdrawBond()
        .accountsPartial({
          member: wallet.publicKey, circle, bond: findBond(circle),
          membership: findMember(circle, wallet.publicKey),
          systemProgram: SystemProgram.programId,
        })
        .signers([wallet])
        .rpc();
      recovered += membership.collateral.toNumber();
    } catch (e) {
      const code = e?.error?.errorCode?.code;
      if (code !== "AccountNotInitialized") {
        line(`  ${member.publicKey.slice(0, 8)}… withdraw skipped: ${code ?? String(e.message ?? e).slice(0, 60)}`);
      }
    }
  }

  // ----------------------------------------------------- empty the wallets
  for (const member of record.members) {
    const wallet = Keypair.fromSecretKey(Uint8Array.from(member.secretKey));
    const balance = await conn.getBalance(wallet.publicKey);
    // One signature, one 5,000 lamport fee. Sending the exact remainder closes
    // the account; leaving dust behind fails, since an account must be empty or
    // rent-exempt and dust is neither.
    if (balance <= 5_000) continue;
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
    const message = new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: blockhash,
      instructions: [SystemProgram.transfer({
        fromPubkey: wallet.publicKey, toPubkey: treasury.publicKey, lamports: balance - 5_000,
      })],
    }).compileToV0Message();
    const tx = new VersionedTransaction(message);
    tx.sign([wallet]);
    try {
      const signature = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
      await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
    } catch (e) {
      line(`  ${member.publicKey.slice(0, 8)}… sweep skipped: ${String(e.message ?? e).slice(0, 60)}`);
    }
  }
  line(`  swept the members' wallets`);
}

line();
if (STATUS_ONLY) {
  line(`locked in circles still running : ${cook(stranded)} COOK`);
  line("Run without --status once they finish.");
} else {
  line(`collateral withdrawn : ${cook(recovered)} COOK`);
  line(`treasury balance     : ${cook(await conn.getBalance(treasury.publicKey))} COOK`);
  line("");
  line("Send it home with your own wallet as the destination, or leave it here.");
}
