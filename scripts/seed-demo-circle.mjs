// Creates the one open circle used by the public demo.
//
// The deployer is the first member, leaving one seat for a visitor. Once the
// visitor joins, the updated on-chain rule lets that visitor start a full circle
// without needing the organiser's wallet.

import { SystemProgram } from "@solana/web3.js";
import anchor from "@coral-xyz/anchor";
import { createHash } from "node:crypto";

import {
  connection, findBond, findCircle, findConfig, findMember, findPot, findRoom,
  KEYS, loadKeypair, loadProgram, toLamports, explorer,
} from "./lib.mjs";

const bn = (n) => new anchor.BN(n.toString());
const deployer = loadKeypair(KEYS.deployer);
const program = loadProgram(deployer);
const circleId = 9001;
const circle = findCircle(deployer.publicKey, circleId);
const room = findRoom(circle);
const inviteCode = "ARISAN-DEMO-2026";
const inviteCodeHash = Array.from(createHash("sha256").update(inviteCode).digest());

const existing = await connection().getAccountInfo(circle);
if (existing) {
  const state = await program.account.circle.fetch(circle);
  if (!(await connection().getAccountInfo(room))) {
    const configureSignature = await program.methods
      .configureCircleRoom(
        "A live two-seat demo circle. Read the ledger, join with this invite code, and try one real round.",
        "https://arisan-cook.vercel.app",
        inviteCodeHash,
      )
      .accountsPartial({
        creator: deployer.publicKey,
        payer: deployer.publicKey,
        circle,
        room,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("room configured:", explorer(configureSignature));
  }
  console.log(`demo circle already exists: ${circle.toBase58()}`);
  console.log(`state: ${JSON.stringify(state.state)} members: ${state.memberCount}/${state.maxMembers}`);
  console.log(`invite: ${inviteCode}`);
  process.exit(0);
}

const createSignature = await program.methods
  .createCircle(
    bn(circleId),
    "Demo · Try Arisan",
    "A live two-seat demo circle. Read the ledger, join with this invite code, and try one real round.",
    "https://arisan-cook.vercel.app",
    inviteCodeHash,
    bn(toLamports(0.1)),
    bn(toLamports(0.1)),
    2,
    bn(60),
  )
  .accountsPartial({
    creator: deployer.publicKey,
    payer: deployer.publicKey,
    config: findConfig(),
    circle, room,
    pot: findPot(circle),
    bond: findBond(circle),
    systemProgram: SystemProgram.programId,
  })
  .rpc();

const joinSignature = await program.methods
  .joinCircle(inviteCodeHash)
  .accountsPartial({
    member: deployer.publicKey,
    payer: deployer.publicKey,
    circle,
    bond: findBond(circle),
    membership: findMember(circle, deployer.publicKey), room,
    systemProgram: SystemProgram.programId,
  })
  .rpc();

console.log("created:", circle.toBase58());
console.log("invite :", inviteCode);
console.log("create :", explorer(createSignature));
console.log("join   :", explorer(joinSignature));
