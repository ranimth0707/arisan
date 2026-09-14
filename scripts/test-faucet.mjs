// Adversarial checks on the demo faucet, against a running relayer.
//
//   RELAYER_SECRET_KEY="$(cat ~/.config/solana/cookiejar-relayer.json)" \
//     node relayer/dev-server.js &
//   node scripts/test-faucet.mjs
//
// Wallet addresses are free to generate, so no request-shaped limit can stop a
// determined drainer. What these checks defend is the property that actually
// matters: a drain must not be able to take the relayer's fee budget with it,
// and must not be free of friction on the way.
//
// Costs one faucet claim, which is swept back at the end.

import { Keypair, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { KEYS, connection, cook, loadKeypair } from "./lib.mjs";

const API = process.env.FAUCET_API ?? "http://127.0.0.1:8787";
const line = (s = "") => console.log(s);
const step = (s) => console.log(`\n--- ${s} ---`);

const conn = connection();
const relayer = loadKeypair(KEYS.relayer);

const results = [];
const check = (label, pass, detail = "") => {
  results.push([label, pass]);
  line(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
};

async function claim(wallet) {
  const res = await fetch(`${API}/faucet`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet }),
  });
  return { status: res.status, body: await res.json() };
}

// ================================================================== STATUS
step("Status");

const status = await (await fetch(`${API}/faucet`)).json();
line(`faucet          : ${status.faucet}`);
line(`per claim       : ${status.amountCook} COOK`);
line(`balance         : ${cook(status.balanceLamports)} COOK`);
line(`spendable       : ${cook(status.spendableLamports)} COOK`);
line(`shares relayer  : ${status.sharedWithRelayer}`);

check("status reports what the faucet may actually spend",
  typeof status.spendableLamports === "number");
check("a shared wallet holds back a relayer reserve",
  !status.sharedWithRelayer || status.spendableLamports < status.balanceLamports,
  `${cook(status.balanceLamports)} held, ${cook(status.spendableLamports)} spendable`);

// ============================================================ REFUSED CASES
step("Attempts that must be refused");

const junk = await claim("not-a-real-address");
check("a malformed address is refused", junk.status === 400, junk.body.error);

const self = await claim(status.faucet);
check("the faucet will not pay itself", self.status === 400, self.body.error);

const program = await claim("Dwd7DXUQHRJaj1suYz6fTcVW7JJqBFVztg1z77t6Ysg");
check("a program address is refused", program.status === 400, program.body.error);

// The one check a drainer cannot sidestep by rotating addresses: swept COOK has
// to land somewhere, and a destination that already holds enough is refused.
const funded = await claim(loadKeypair(KEYS.deployer).publicKey.toBase58());
check("a wallet that already has COOK is refused", funded.status === 400, funded.body.error);

// ============================================================== HAPPY PATH
step("A new wallet gets exactly one claim");

const fresh = Keypair.generate();
const first = await claim(fresh.publicKey.toBase58());
check("a new wallet is funded", first.status === 200, first.body.signature?.slice(0, 16) ?? first.body.error);

const balance = await conn.getBalance(fresh.publicKey);
check("the COOK actually arrived",
  balance === Math.round(status.amountCook * 1e9), `${cook(balance)} COOK`);

const second = await claim(fresh.publicKey.toBase58());
check("the same wallet is refused straight away", second.status === 429, second.body.error);

// ======================================================= THE OLD WEAKNESS
step("Rotating the wallet does not reset the limit");

// The previous key was `faucet:<ip>:<wallet>`, which handed every generated
// address a fresh quota and therefore limited nothing at all.
const rotated = Array.from({ length: 6 }, () => Keypair.generate());
const rotations = [];
for (const wallet of rotated) {
  rotations.push(await claim(wallet.publicKey.toBase58()));
}
const throttled = rotations.filter((r) => r.status === 429).length;
line(`refused         : ${throttled} of ${rotations.length} rotated wallets`);
check("fresh addresses still hit the per-connection limit", throttled > 0,
  `${throttled} refused`);

const paid = rotations.filter((r) => r.status === 200);
check("the connection limit bites within a handful of requests", paid.length <= 4,
  `${paid.length} funded before the limit`);

// ================================================================= CLEANUP
step("Sweeping the demo COOK back");

let returned = 0;
for (const keypair of [fresh, ...rotated]) {
  const left = await conn.getBalance(keypair.publicKey);
  // Exactly one signature, so exactly one 5,000 lamport fee. Sending the rest
  // leaves the account at zero, which closes it. Leaving any dust behind fails:
  // an account must be empty or rent-exempt, and dust is neither.
  const fee = 5_000;
  if (left <= fee) continue;
  try {
    await sendAndConfirmTransaction(conn, new Transaction().add(SystemProgram.transfer({
      fromPubkey: keypair.publicKey, toPubkey: relayer.publicKey, lamports: left - fee,
    })), [keypair], { commitment: "confirmed" });
    returned += left - fee;
  } catch (e) {
    line(`could not sweep : ${e.message?.slice(0, 80)}`);
  }
}
line(`returned        : ${cook(returned)} COOK`);

// ================================================================= SUMMARY
line();
const failed = results.filter(([, pass]) => !pass);
line(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  line("failed:");
  for (const [label] of failed) line(`  - ${label}`);
}
process.exit(failed.length ? 1 : 0);
