// One-time protocol setup: creates the Config PDA and registers the relayer.

import { findConfig, loadKeypair, loadProgram, KEYS, explorer } from "./lib.mjs";

const deployer = loadKeypair(KEYS.deployer);
const relayer = loadKeypair(KEYS.relayer);
const program = loadProgram(deployer);
const config = findConfig();

console.log("authority:", deployer.publicKey.toBase58());
console.log("relayer:  ", relayer.publicKey.toBase58());
console.log("config:   ", config.toBase58());

const existing = await program.provider.connection.getAccountInfo(config);
if (existing) {
  const state = await program.account.config.fetch(config);
  console.log("\nalready initialized:");
  console.log("  authority:", state.authority.toBase58());
  console.log("  relayer:  ", state.relayer.toBase58());
  console.log("  paused:   ", state.paused);
  process.exit(0);
}

const sig = await program.methods
  .initialize(relayer.publicKey)
  .accounts({ payer: deployer.publicKey })
  .rpc();

console.log("\ninitialized:", explorer(sig));

const state = await program.account.config.fetch(config);
console.log("  authority:", state.authority.toBase58());
console.log("  relayer:  ", state.relayer.toBase58());
console.log("  paused:   ", state.paused);
