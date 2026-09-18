// Replaces finished circles that were seeded with --recycle.
//
//   node scripts/recycle-circles.mjs --status
//   node scripts/recycle-circles.mjs
//
// A circle's parameters are frozen on chain, deliberately: an organiser must not
// be able to change the terms after members have committed money. So a finished
// circle cannot be restarted, only replaced. This pulls the collateral back out,
// opens an identical circle, and puts the same wallets back in their seats.
//
// It exists because short rounds and held TVL pull against each other. A circle
// with fast rounds produces steady volume and then completes, at which point its
// reserve unlocks and its TVL goes to zero. Recycling closes that loop.
//
// Safe to run on a timer. A circle that has not finished is left alone.

import anchor from "@coral-xyz/anchor";
import {
  Keypair, SystemProgram, TransactionMessage, VersionedTransaction,
} from "@solana/web3.js";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  connection, explorer, findBond, findCircle, findConfig, findMember, findPot,
  findRoom, findRoster, findSafety, loadKeypair, loadProgram, LAMPORTS_PER_COOK,
} from "./lib.mjs";

const TREASURY_FILE = path.join(os.homedir(), ".config/solana/cookiejar-treasury.json");
const MEMBERS_FILE = path.join(os.homedir(), ".config/solana/cookiejar-members.json");

const STATUS_ONLY = process.argv.includes("--status");
const bn = (n) => new anchor.BN(n.toString());
const line = (s = "") => console.log(s);
const cook = (l) => (Number(l) / LAMPORTS_PER_COOK).toLocaleString("en-US", { maximumFractionDigits: 4 });

/** Headroom for a wallet's own signatures and its member-account rent. */
const WALLET_OVERHEAD = 20_000_000;

if (!fs.existsSync(MEMBERS_FILE)) {
  console.error(`nothing to recycle: no ${MEMBERS_FILE}`);
  process.exit(1);
}

const state = JSON.parse(fs.readFileSync(MEMBERS_FILE, "utf8"));
const treasury = loadKeypair(TREASURY_FILE);
const conn = connection();
const program = loadProgram(treasury);

const save = () => {
  fs.writeFileSync(MEMBERS_FILE, JSON.stringify(state, null, 2));
  fs.chmodSync(MEMBERS_FILE, 0o600);
};

const keypairOf = (member) => Keypair.fromSecretKey(Uint8Array.from(member.secretKey));

/** Tops wallets up to `target`, batched so one signature covers many. */
async function topUp(wallets, target) {
  const short = [];
  for (const wallet of wallets) {
    const balance = await conn.getBalance(wallet.publicKey);
    if (balance < target) short.push({ to: wallet.publicKey, lamports: target - balance });
  }
  if (!short.length) return 0;

  const BATCH = 12;
  for (let offset = 0; offset < short.length; offset += BATCH) {
    const slice = short.slice(offset, offset + BATCH);
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
    const message = new TransactionMessage({
      payerKey: treasury.publicKey,
      recentBlockhash: blockhash,
      instructions: slice.map((s) => SystemProgram.transfer({
        fromPubkey: treasury.publicKey, toPubkey: s.to, lamports: s.lamports,
      })),
    }).compileToV0Message();
    const tx = new VersionedTransaction(message);
    tx.sign([treasury]);
    const signature = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  }
  return short.reduce((total, s) => total + s.lamports, 0);
}

/**
 * Restricts this run to records carrying a tag, so the public demo room — whose
 * rounds are a minute long — can be cranked every minute without dragging a
 * hundred and fifty wallets through the same pass.
 */
const ONLY = (() => {
  const index = process.argv.indexOf("--only");
  return index === -1 ? null : process.argv[index + 1];
})();
const inScope = (record) => ONLY === null || record.tag === ONLY;

/**
 * Seats the wallets and starts the circle. Shared by a fresh replacement and by
 * one that was opened earlier but never started.
 *
 * Returns false instead of throwing when it cannot finish, so the circle is left
 * forming and the next run resumes it.
 */
async function fillAndStart(circle, record, wallets, inviteHash) {
  const p = record.params;
  // A member slashed in the previous circle comes out short, so top every wallet
  // back up to what a seat costs before asking any of them to take one.
  const added = await topUp(wallets, p.collateral + p.contribution * 4 + WALLET_OVERHEAD);
  if (added) line(`  topped up : ${cook(added)} COOK from the treasury`);

  let joined = 0;
  for (const wallet of wallets) {
    try {
      await program.account.member.fetch(findMember(circle, wallet.publicKey));
      joined += 1;
      continue; // already seated by an earlier attempt
    } catch { /* not seated yet */ }
    try {
      await program.methods
        .joinCircle(inviteHash)
        .accountsPartial({
          member: wallet.publicKey, payer: treasury.publicKey, circle,
          bond: findBond(circle), membership: findMember(circle, wallet.publicKey),
          room: findRoom(circle), systemProgram: SystemProgram.programId,
        })
        .signers([wallet])
        .rpc();
      joined += 1;
    } catch (e) {
      line(`  join failed for ${wallet.publicKey.toBase58().slice(0, 8)}…: ${e?.error?.errorCode?.code ?? String(e.message ?? e).slice(0, 60)}`);
    }
  }

  // A demo room deliberately keeps a seat open, and the visitor who takes it is
  // the one who starts the circle. Seating our side is the whole job there.
  if (record.tag === "demo") {
    line(`  ${joined}/${p.maxMembers} seated — waiting for a visitor to take the last seat`);
    return joined >= 1;
  }
  if (joined < 2) {
    line(`  only ${joined} seat(s) filled — left forming for the next run`);
    return false;
  }

  try {
    const signature = await program.methods
      .startCircle()
      .accountsPartial({
        starter: treasury.publicKey, payer: treasury.publicKey, circle,
        roster: findRoster(circle), safety: findSafety(circle),
        bond: findBond(circle), systemProgram: SystemProgram.programId,
      })
      .rpc();
    line(`  started   : ${joined}/${p.maxMembers} seats, ${cook(await conn.getBalance(findBond(circle)))} COOK locked`);
    line(`  tx        : ${explorer(signature)}`);
    return true;
  } catch (e) {
    line(`  start failed: ${e?.error?.errorCode?.code ?? String(e.message ?? e).slice(0, 70)} — left forming`);
    return false;
  }
}

let replaced = 0;
let skipped = 0;

for (const record of state.circles) {
  if (!inScope(record)) continue;
  if (!record.recycle) continue;

  const circle = findCircle(treasury.publicKey, record.circleId);
  let account;
  try { account = await program.account.circle.fetch(circle); } catch { continue; }

  const stateName = Object.keys(account.state)[0];
  if (stateName === "running") {
    line(`${record.address.slice(0, 8)}…  running, round ${account.round}/${account.memberCount} — leaving it`);
    skipped += 1;
    continue;
  }

  // A replacement that was opened but never started. Finish that one instead of
  // opening another.
  //
  // The record used to advance only once a start succeeded, so a failed start
  // left it pointing at the old finished circle — and the next run dutifully
  // made a fresh replacement for it, every hour. That is how dozens of empty
  // rooms accumulated, each holding deposits nobody could reach, while the
  // lobby count climbed.
  if (stateName === "forming") {
    line(`\n${record.address.slice(0, 8)}…  forming ${account.memberCount}/${account.maxMembers} — finishing the start it never completed`);
    if (STATUS_ONLY) { replaced += 1; continue; }
    const seated = await fillAndStart(circle, record, record.members.map(keypairOf),
      Array.from(createHash("sha256").update(record.inviteCode).digest()));
    if (seated) replaced += 1;
    continue;
  }

  line(`\n${record.address.slice(0, 8)}…  finished — replacing it`);
  if (STATUS_ONLY) { replaced += 1; continue; }

  const wallets = record.members.map(keypairOf);

  // ------------------------------------------- 1. collateral back out
  let recovered = 0;
  for (const wallet of wallets) {
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
      if (code !== "AccountNotInitialized" && code !== "NothingToWithdraw") {
        line(`  withdraw skipped for ${wallet.publicKey.toBase58().slice(0, 8)}…: ${code ?? String(e.message ?? e).slice(0, 60)}`);
      }
    }
  }
  line(`  reclaimed : ${cook(recovered)} COOK of collateral`);

  // --------------------------------------------- 2. an identical circle
  const p = record.params;
  const circleId = Math.floor(Date.now() / 1000) + replaced;
  const next = findCircle(treasury.publicKey, circleId);
  // The public demo room's code is printed in the README and in the launch
  // thread, so it has to survive being replaced. Everything else gets a fresh
  // code, since a seeded circle's code was never meant to be shared.
  const inviteCode = record.fixedInviteCode
    ?? `ARISAN-${randomBytes(4).toString("hex").toUpperCase()}`;
  const inviteHash = Array.from(createHash("sha256").update(inviteCode).digest());

  await program.methods
    .createCircle(
      bn(circleId), p.name, p.description, p.socialUrl, inviteHash,
      bn(p.contribution), bn(p.collateral), p.maxMembers, bn(p.roundSeconds),
    )
    .accountsPartial({
      creator: treasury.publicKey, payer: treasury.publicKey, config: findConfig(),
      circle: next, room: findRoom(next), pot: findPot(next), bond: findBond(next),
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  // Point the record at the new circle straight away, before trying to fill it.
  // This is the fix for the pile-up: if the start fails, the next run finds a
  // forming circle and finishes that one rather than opening another.
  record.circleId = circleId;
  record.address = next.toBase58();
  record.inviteCode = inviteCode;
  save();

  if (await fillAndStart(next, record, wallets, inviteHash)) replaced += 1;
}

line();
if (STATUS_ONLY) {
  line(`${replaced} circle(s) ready to be replaced, ${skipped} still running.`);
} else {
  line(`${replaced} replaced, ${skipped} still running.`);
  line(`treasury: ${cook(await conn.getBalance(treasury.publicKey))} COOK`);
}
