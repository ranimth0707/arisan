// Opens and fills a batch of arisan circles from the seeding treasury.
//
//   node scripts/seed-circles.mjs --dry-run          # costs nothing, prints the plan
//   node scripts/seed-circles.mjs
//
// What this is, stated plainly: these circles are funded by one operator, not by
// unrelated people who found the app. The TVL and volume they produce are real
// on-chain amounts in real program vaults, and /api/metrics counts them the same
// way it would count a stranger's — but they are seeded liquidity, and the
// README says so rather than implying organic demand.
//
// Member keys are generated here and written to ~/.config/solana/, outside the
// repository. They are throwaway wallets holding demo amounts; do not reuse them
// for anything else.

import anchor from "@coral-xyz/anchor";
import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  connection, explorer, findBond, findCircle, findConfig, findMember, findPot,
  findRoom, findRoster, findSafety, loadKeypair, toLamports, loadProgram,
  LAMPORTS_PER_COOK,
} from "./lib.mjs";

const TREASURY_FILE = path.join(os.homedir(), ".config/solana/cookiejar-treasury.json");
const MEMBERS_FILE = path.join(os.homedir(), ".config/solana/cookiejar-members.json");

const bn = (n) => new anchor.BN(n.toString());
const line = (s = "") => console.log(s);
const step = (s) => console.log(`\n=== ${s} ===`);
const cook = (l) => (l / LAMPORTS_PER_COOK).toLocaleString("en-US", { maximumFractionDigits: 4 });

// ============================================================== OPTIONS
function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) ? value : fallback;
}

const DRY_RUN = process.argv.includes("--dry-run");

const PLAN = {
  circles: option("circles", 5),
  members: option("members", 20),
  contributionCook: option("contribution", 5),
  roundHours: option("round-hours", 18),
  // Rounds of contributions a wallet can fund on its own. It does not need to
  // cover the whole circle: every round pays one of these same wallets the full
  // pot, and the crank recycles that back through the treasury. This is timing
  // float, not the total commitment.
  bufferRounds: option("buffer-rounds", 4),
};

// The program requires a reserve covering every seat, so this is not a knob.
const collateralCook = PLAN.contributionCook * PLAN.members;
const perWalletCook = collateralCook + PLAN.contributionCook * PLAN.bufferRounds;
// Rent for a Member account plus a few signatures, paid out of the wallet itself
// when it signs. Small, but a wallet short by one lamport cannot join.
const WALLET_OVERHEAD = 20_000_000;

const totalPerCircle = perWalletCook * PLAN.members;
const totalCook = totalPerCircle * PLAN.circles;
const lockedCook = collateralCook * PLAN.members * PLAN.circles;

step("Plan");
line(`circles            : ${PLAN.circles}`);
line(`members per circle : ${PLAN.members}`);
line(`contribution       : ${PLAN.contributionCook} COOK per member per round`);
line(`collateral         : ${collateralCook} COOK per member (contribution x seats, required)`);
line(`round length       : ${PLAN.roundHours}h  (${PLAN.members} rounds = ${(PLAN.members * PLAN.roundHours / 24).toFixed(0)} days to finish)`);
line(`wallet funding     : ${perWalletCook} COOK each (${collateralCook} locked + ${PLAN.contributionCook * PLAN.bufferRounds} working)`);
line("");
line(`total deployed     : ${totalCook.toLocaleString("en-US")} COOK`);
line(`locked as TVL      : ${lockedCook.toLocaleString("en-US")} COOK (${(lockedCook / totalCook * 100).toFixed(0)}% of it)`);
line(`volume per round   : ${(PLAN.contributionCook * PLAN.members * 2 * PLAN.circles).toLocaleString("en-US")} COOK across all circles`);
line(`wallets to create  : ${PLAN.members * PLAN.circles}`);

if (PLAN.members < 2 || PLAN.members > 100) {
  console.error("\nmembers must be between 2 and 100");
  process.exit(1);
}
if (PLAN.roundHours * 3600 < 60) {
  console.error("\nround must be at least 60 seconds");
  process.exit(1);
}

if (DRY_RUN) {
  line("\ndry run, nothing sent. Drop --dry-run to execute.");
  process.exit(0);
}

// ============================================================== TREASURY
if (!fs.existsSync(TREASURY_FILE)) {
  console.error(`\nno treasury keypair at ${TREASURY_FILE}`);
  process.exit(1);
}
const treasury = loadKeypair(TREASURY_FILE);
const conn = connection();
const program = loadProgram(treasury);

const treasuryBalance = await conn.getBalance(treasury.publicKey);
step("Treasury");
line(`address : ${treasury.publicKey.toBase58()}`);
line(`balance : ${cook(treasuryBalance)} COOK`);

// Circle, room, roster and safety rent, plus the per-wallet overhead and fees.
const RENT_PER_CIRCLE = 12_000_000;
const needed = toLamports(totalCook)
  + WALLET_OVERHEAD * PLAN.members * PLAN.circles
  + RENT_PER_CIRCLE * PLAN.circles;

line(`needed  : ${cook(needed)} COOK`);
if (treasuryBalance < needed) {
  console.error(`\nshort by ${cook(needed - treasuryBalance)} COOK.`);
  console.error("Top it up first:  node scripts/fund-treasury.mjs <amount>");
  process.exit(1);
}

// ================================================================ STATE
const state = fs.existsSync(MEMBERS_FILE)
  ? JSON.parse(fs.readFileSync(MEMBERS_FILE, "utf8"))
  : { version: 1, circles: [] };

const save = () => {
  fs.writeFileSync(MEMBERS_FILE, JSON.stringify(state, null, 2));
  fs.chmodSync(MEMBERS_FILE, 0o600);
};

/** Splits transfers across transactions that fit inside one message. */
async function fundWallets(recipients, lamports) {
  const BATCH = 12;
  for (let offset = 0; offset < recipients.length; offset += BATCH) {
    const slice = recipients.slice(offset, offset + BATCH);
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
    const message = new TransactionMessage({
      payerKey: treasury.publicKey,
      recentBlockhash: blockhash,
      instructions: slice.map((to) => SystemProgram.transfer({
        fromPubkey: treasury.publicKey, toPubkey: to, lamports,
      })),
    }).compileToV0Message();
    const tx = new VersionedTransaction(message);
    tx.sign([treasury]);
    const signature = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
    process.stdout.write(`  funded ${Math.min(offset + BATCH, recipients.length)}/${recipients.length}\r`);
  }
  line("");
}

// ============================================================== EXECUTE
const baseId = Math.floor(Date.now() / 1000);
const contribution = toLamports(PLAN.contributionCook);
const collateral = toLamports(collateralCook);
const walletFunding = toLamports(perWalletCook) + WALLET_OVERHEAD;

for (let index = 0; index < PLAN.circles; index += 1) {
  const circleId = baseId + index;
  const circle = findCircle(treasury.publicKey, circleId);
  const inviteCode = `ARISAN-${randomBytes(4).toString("hex").toUpperCase()}`;
  const inviteHash = Array.from(createHash("sha256").update(inviteCode).digest());

  step(`Circle ${index + 1} of ${PLAN.circles}  (id ${circleId})`);

  const createSignature = await program.methods
    .createCircle(
      bn(circleId),
      `Arisan ${PLAN.members} · ${PLAN.contributionCook} COOK`,
      `A ${PLAN.members}-seat savings circle. Every member locks ${collateralCook} COOK to cover their whole commitment, then pays ${PLAN.contributionCook} COOK each round. One member takes the pot per round until everyone has had a turn.`,
      "https://github.com/ranimth0707/arisan",
      inviteHash,
      bn(contribution),
      bn(collateral),
      PLAN.members,
      bn(Math.round(PLAN.roundHours * 3600)),
    )
    .accountsPartial({
      creator: treasury.publicKey, payer: treasury.publicKey, config: findConfig(),
      circle, room: findRoom(circle), pot: findPot(circle), bond: findBond(circle),
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  line(`created   : ${explorer(createSignature)}`);

  const wallets = Array.from({ length: PLAN.members }, () => Keypair.generate());
  const record = {
    circleId,
    address: circle.toBase58(),
    inviteCode,
    contribution,
    members: wallets.map((w) => ({
      publicKey: w.publicKey.toBase58(),
      secretKey: Array.from(w.secretKey),
    })),
  };
  state.circles.push(record);
  save();
  line(`wallets   : ${PLAN.members} generated, saved to ${MEMBERS_FILE}`);

  line(`funding   : ${perWalletCook} COOK each`);
  await fundWallets(wallets.map((w) => w.publicKey), walletFunding);

  for (const [seat, wallet] of wallets.entries()) {
    await program.methods
      .joinCircle(inviteHash)
      .accountsPartial({
        member: wallet.publicKey, payer: treasury.publicKey, circle,
        bond: findBond(circle), membership: findMember(circle, wallet.publicKey),
        room: findRoom(circle), systemProgram: SystemProgram.programId,
      })
      .signers([wallet])
      .rpc();
    process.stdout.write(`  joined ${seat + 1}/${PLAN.members}\r`);
  }
  line("");

  const startSignature = await program.methods
    .startCircle()
    .accountsPartial({
      starter: treasury.publicKey, payer: treasury.publicKey, circle,
      roster: findRoster(circle), safety: findSafety(circle),
      bond: findBond(circle), systemProgram: SystemProgram.programId,
    })
    .rpc();

  const started = await program.account.circle.fetch(circle);
  const bondBalance = await conn.getBalance(findBond(circle));
  line(`started   : ${explorer(startSignature)}`);
  line(`state     : round ${started.round}, ${started.memberCount}/${started.maxMembers} seats`);
  line(`locked    : ${cook(bondBalance)} COOK in the bond vault`);
  line(`invite    : ${inviteCode}`);
}

// ================================================================ SUMMARY
step("Done");
const left = await conn.getBalance(treasury.publicKey);
line(`treasury left : ${cook(left)} COOK`);
line(`circles       : ${state.circles.length} tracked in ${MEMBERS_FILE}`);
line("");
line("Rounds do not advance on their own. Run the crank on a schedule:");
line("  node scripts/crank-circles.mjs");
