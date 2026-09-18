// Opens the public demo room: the one circle a reviewer can finish alone.
//
//   node scripts/seed-demo-room.mjs
//
// Every constraint here comes from walking the path a stranger actually takes.
//
// Two seats, not three. `start_circle` only lets a non-creator start a circle
// once every seat is taken, so a three-seat room with one of ours and one
// visitor leaves that visitor stuck holding a reserve in a circle they cannot
// begin. Two seats means the visitor fills it and can start it themselves.
//
// One-minute rounds, so a full cycle — pay, draw, collect — happens while
// somebody is still looking at it.
//
// Our seat is an ordinary generated wallet, tagged `demo` so the fast cron can
// crank just this room without dragging every seeded wallet through the pass.
// It is deliberately not the treasury and not the deployer: the room should be
// survivable if its key leaks, and the deployer holds upgrade authority.

import anchor from "@coral-xyz/anchor";
import { Keypair, SystemProgram } from "@solana/web3.js";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  connection, explorer, findBond, findCircle, findConfig, findMember, findPot,
  findRoom, loadKeypair, loadProgram, toLamports, LAMPORTS_PER_COOK,
} from "./lib.mjs";

const TREASURY_FILE = path.join(os.homedir(), ".config/solana/cookiejar-treasury.json");
const MEMBERS_FILE = path.join(os.homedir(), ".config/solana/cookiejar-members.json");

const bn = (n) => new anchor.BN(n.toString());
const line = (s = "") => console.log(s);
const cook = (l) => (Number(l) / LAMPORTS_PER_COOK).toLocaleString("en-US", { maximumFractionDigits: 4 });

const INVITE_CODE = "ARISAN-DEMO";
const SEATS = 2;
const CONTRIBUTION = toLamports(0.1);
// Two contributions: late twice before the seat is sidelined. It covers a
// missed round, not a member leaving — see docs/ARISAN-SAFETY.md.
const COLLATERAL = CONTRIBUTION * 2;
const ROUND_SECONDS = 60;
const NAME = "Demo · Join by code";
const DESCRIPTION = "A live two-seat demo. Claim demo COOK, join with the published code, "
  + "and you can start the circle yourself because your seat fills it. Rounds last one "
  + "minute, so a full turn finishes while you watch.";
const SOCIAL_URL = "https://github.com/ranimth0707/arisan";

const treasury = loadKeypair(TREASURY_FILE);
const conn = connection();
const program = loadProgram(treasury);

const state = fs.existsSync(MEMBERS_FILE)
  ? JSON.parse(fs.readFileSync(MEMBERS_FILE, "utf8"))
  : { version: 1, circles: [] };

// Several rooms deliberately share one code. A visitor arriving while another
// is mid-cycle needs somewhere to sit, and the app sends them to whichever of
// them still has a free seat.
const existing = state.circles.filter((c) => c.tag === "demo").length;
line(`demo rooms already open: ${existing}`);

const circleId = Math.floor(Date.now() / 1000);
const circle = findCircle(treasury.publicKey, circleId);
const inviteHash = Array.from(createHash("sha256").update(INVITE_CODE).digest());

const createSignature = await program.methods
  .createCircle(
    bn(circleId), NAME, DESCRIPTION, SOCIAL_URL, inviteHash,
    bn(CONTRIBUTION), bn(COLLATERAL), SEATS, bn(ROUND_SECONDS),
  )
  .accountsPartial({
    creator: treasury.publicKey, payer: treasury.publicKey, config: findConfig(),
    circle, room: findRoom(circle), pot: findPot(circle), bond: findBond(circle),
    systemProgram: SystemProgram.programId,
  })
  .rpc();
line(`created : ${explorer(createSignature)}`);

const host = Keypair.generate();
const funding = COLLATERAL + CONTRIBUTION * 20 + 20_000_000;
const transfer = new anchor.web3.Transaction().add(SystemProgram.transfer({
  fromPubkey: treasury.publicKey, toPubkey: host.publicKey, lamports: funding,
}));
await program.provider.sendAndConfirm(transfer, []);

const joinSignature = await program.methods
  .joinCircle(inviteHash)
  .accountsPartial({
    member: host.publicKey, payer: treasury.publicKey, circle,
    bond: findBond(circle), membership: findMember(circle, host.publicKey),
    room: findRoom(circle), systemProgram: SystemProgram.programId,
  })
  .signers([host])
  .rpc();
line(`host in : ${explorer(joinSignature)}`);

state.circles.push({
  circleId,
  address: circle.toBase58(),
  inviteCode: INVITE_CODE,
  fixedInviteCode: INVITE_CODE,
  tag: "demo",
  recycle: true,
  contribution: CONTRIBUTION,
  params: {
    name: NAME, description: DESCRIPTION, socialUrl: SOCIAL_URL,
    contribution: CONTRIBUTION, collateral: COLLATERAL,
    maxMembers: SEATS, roundSeconds: ROUND_SECONDS,
  },
  members: [{
    publicKey: host.publicKey.toBase58(),
    secretKey: Array.from(host.secretKey),
  }],
});
fs.writeFileSync(MEMBERS_FILE, JSON.stringify(state, null, 2));
fs.chmodSync(MEMBERS_FILE, 0o600);

const account = await program.account.circle.fetch(circle);
line("");
line(`circle  : ${circle.toBase58()}`);
line(`seats   : ${account.memberCount}/${account.maxMembers} — one open for a visitor`);
line(`terms   : ${cook(CONTRIBUTION)} COOK a round, ${cook(COLLATERAL)} COOK reserve, ${ROUND_SECONDS}s rounds`);
line(`invite  : ${INVITE_CODE}`);
line(`locked  : ${cook(await conn.getBalance(findBond(circle)))} COOK`);
line("");
line("The visitor who takes the second seat fills the room and can start it themselves.");
line("Crank this room on its own timer:  node scripts/crank-circles.mjs --only demo");
