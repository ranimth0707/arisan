// Shared client setup and PDA derivation for the Cookie Jar program.
// Seeds here must stay in lockstep with programs/cookie_jar/src/constants.rs.

import anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import fs from "fs";
import os from "os";
import path from "path";

export const RPC_URL = "https://rpc.cookiescan.io";
export const PROGRAM_ID = new PublicKey("Dwd7DXUQHRJaj1suYz6fTcVW7JJqBFVztg1z77t6Ysg");
export const LAMPORTS_PER_COOK = 1_000_000_000;

export const KEYS = {
  deployer: path.join(os.homedir(), ".config/solana/cookiejar-deployer.json"),
  relayer: path.join(os.homedir(), ".config/solana/cookiejar-relayer.json"),
};

export function loadKeypair(file) {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8"))));
}

export function connection() {
  return new Connection(RPC_URL, "confirmed");
}

export function loadProgram(payer) {
  const provider = new anchor.AnchorProvider(
    connection(),
    new anchor.Wallet(payer),
    { commitment: "confirmed", preflightCommitment: "confirmed" },
  );
  const idl = JSON.parse(
    fs.readFileSync(new URL("../target/idl/cookie_jar.json", import.meta.url), "utf8"),
  );
  return new anchor.Program(idl, provider);
}

const enc = (s) => Buffer.from(s);
const u64 = (n) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};

const pda = (seeds) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];

export const findConfig = () => pda([enc("config")]);
export const findSponsor = (authority) => pda([enc("sponsor"), authority.toBuffer()]);
export const findSponsorVault = (authority) => pda([enc("sponsor_vault"), authority.toBuffer()]);
export const findJar = (creator, jarId) => pda([enc("jar"), creator.toBuffer(), u64(jarId)]);
export const findJarVault = (jar) => pda([enc("jar_vault"), jar.toBuffer()]);
export const findRewardVault = (jar) => pda([enc("reward_vault"), jar.toBuffer()]);
export const findPosition = (jar, owner) => pda([enc("position"), jar.toBuffer(), owner.toBuffer()]);
export const findEnvelope = (creator, id) => pda([enc("envelope"), creator.toBuffer(), u64(id)]);
export const findEnvelopeVault = (envelope) => pda([enc("envelope_vault"), envelope.toBuffer()]);
export const findClaim = (envelope, claimer) =>
  pda([enc("claim"), envelope.toBuffer(), claimer.toBuffer()]);

export const SLOT_HASHES = new PublicKey("SysvarS1otHashes111111111111111111111111111");

export const cook = (lamports) => (Number(lamports) / LAMPORTS_PER_COOK).toLocaleString(undefined, {
  maximumFractionDigits: 6,
});

export const toLamports = (amount) => Math.round(amount * LAMPORTS_PER_COOK);

export function explorer(sig) {
  return `https://cookiescan.io/tx/${sig}`;
}
