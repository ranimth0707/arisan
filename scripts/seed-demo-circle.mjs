// Creates the one open circle used by the public demo.
//
// The deployer is the first member, leaving one seat for a visitor. Once the
// visitor joins, the updated on-chain rule lets that visitor start a full circle
// without needing the organiser's wallet.

import { SystemProgram } from "@solana/web3.js";
import anchor from "@coral-xyz/anchor";

import {
  connection, findBond, findCircle, findConfig, findMember, findPot,
  KEYS, loadKeypair, loadProgram, toLamports, explorer,
} from "./lib.mjs";

const bn = (n) => new anchor.BN(n.toString());
const deployer = loadKeypair(KEYS.deployer);
const program = loadProgram(deployer);
const circleId = 9001;
const circle = findCircle(deployer.publicKey, circleId);

const existing = await connection().getAccountInfo(circle);
if (existing) {
  const state = await program.account.circle.fetch(circle);
  console.log(`demo circle already exists: \${circle.toBase58()}`);
  console.log(`state: \${JSON.stringify(state.state)} members: \${state.memberCount}/\${state.maxMembers}`);
  process.exit(0);
}

const createSignature = await program.methods
  .createCircle(
    bn(circleId),
    "Demo · Try Arisan",
    bn(toLamports(0.1)),
    bn(toLamports(0.1)),
    2,
    bn(60),
  )
  .accountsPartial({
    creator: deployer.publicKey,
    payer: deployer.publicKey,
    config: findConfig(),
    circle,
    pot: findPot(circle),
    bond: findBond(circle),
    systemProgram: SystemProgram.programId,
  })
  .rpc();

const joinSignature = await program.methods
  .joinCircle()
  .accountsPartial({
    member: deployer.publicKey,
    payer: deployer.publicKey,
    circle,
    bond: findBond(circle),
    membership: findMember(circle, deployer.publicKey),
    systemProgram: SystemProgram.programId,
  })
  .rpc();

console.log("created:", circle.toBase58());
console.log("create :", explorer(createSignature));
console.log("join   :", explorer(joinSignature));
