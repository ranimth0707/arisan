// Fundraising, end to end on Cookie Chain mainnet.
//
// The claim under test: somebody can ask for help with an empty wallet, a
// stranger holding zero COOK can give, and what is raised lands in the asker's
// jar rather than draining out of the protocol.

import anchor from "@coral-xyz/anchor";
import {
  Keypair, SystemProgram, TransactionMessage, VersionedTransaction,
} from "@solana/web3.js";
import {
  KEYS, connection, cook, explorer, findCampaign, findCampaignVault, findConfig,
  findDonation, findJar, findJarVault, findPosition, findRewardVault,
  findSponsor, findSponsorVault, loadKeypair, loadProgram, toLamports,
} from "./lib.mjs";

const bn = (n) => new anchor.BN(n.toString());
const line = (s = "") => console.log(s);
const step = (s) => console.log(`\n--- ${s} ---`);

const conn = connection();
const me = loadKeypair(KEYS.deployer);
const relayer = loadKeypair(KEYS.relayer);
const program = loadProgram(me);
const config = findConfig();

const results = [];
const check = (label, pass, note = "") => {
  results.push([label, pass]);
  line(`${pass ? "PASS" : "FAIL"}  ${label}${note ? `  (${note})` : ""}`);
};

const now = Math.floor(Date.now() / 1000);

// ============================================================== the request
step("Someone opens a request for help");

const campaignId = now;
const campaign = findCampaign(me.publicKey, campaignId);
const campaignVault = findCampaignVault(campaign);

await program.methods
  .createCampaign(
    bn(campaignId),
    "Bayar biaya rumah sakit ibu",
    "Ibu saya dirawat minggu lalu dan tagihannya belum lunas. Bantuan sekecil apa pun sangat berarti.",
    bn(toLamports(500)),
    bn(now + 86400),
  )
  .accountsPartial({
    creator: me.publicKey,
    payer: me.publicKey,
    config,
    campaign,
    campaignVault,
    systemProgram: SystemProgram.programId,
  })
  .rpc();

const c0 = await program.account.campaign.fetch(campaign);
line(`campaign : ${campaign.toBase58()}`);
line(`title    : ${c0.title}`);
line(`target   : ${cook(c0.target)} COOK`);
check("campaign opened", c0.raised.toNumber() === 0 && !c0.closed);

// ======================================================== a gasless stranger
step("A stranger holding zero COOK gives");

// A donor genuinely needs COOK to give it away, so this one is funded. What is
// being proved here is that the FEE is covered, not the gift.
const donor = Keypair.generate();
const seed = new TransactionMessage({
  payerKey: me.publicKey,
  recentBlockhash: (await conn.getLatestBlockhash()).blockhash,
  instructions: [SystemProgram.transfer({
    fromPubkey: me.publicKey, toPubkey: donor.publicKey, lamports: toLamports(30),
  })],
}).compileToV0Message();
const seedTx = new VersionedTransaction(seed);
seedTx.sign([me]);
await conn.confirmTransaction(
  await conn.sendRawTransaction(seedTx.serialize()), "confirmed",
);

const donorBefore = await conn.getBalance(donor.publicKey);
const vaultBefore = await conn.getBalance(campaignVault);

const rentDonation = await conn.getMinimumBalanceForRentExemption(90);
const ixReimburse = await program.methods
  .reimburseRelayer(bn(rentDonation + 10_000))
  .accountsPartial({
    relayer: relayer.publicKey, config,
    sponsor: findSponsor(me.publicKey), sponsorVault: findSponsorVault(me.publicKey),
    systemProgram: SystemProgram.programId,
  })
  .instruction();

const ixDonate = await program.methods
  .donate(bn(toLamports(25)))
  .accountsPartial({
    donor: donor.publicKey,
    payer: relayer.publicKey,
    config,
    campaign,
    campaignVault,
    donation: findDonation(campaign, donor.publicKey),
    systemProgram: SystemProgram.programId,
  })
  .instruction();

const msg = new TransactionMessage({
  payerKey: relayer.publicKey,
  recentBlockhash: (await conn.getLatestBlockhash()).blockhash,
  instructions: [ixReimburse, ixDonate],
}).compileToV0Message();
const tx = new VersionedTransaction(msg);
tx.sign([relayer, donor]);

const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
await conn.confirmTransaction(sig, "confirmed");
line(`tx       : ${explorer(sig)}`);

const donorAfter = await conn.getBalance(donor.publicKey);
const vaultAfter = await conn.getBalance(campaignVault);
const c1 = await program.account.campaign.fetch(campaign);
const d1 = await program.account.donation.fetch(findDonation(campaign, donor.publicKey));

line(`donor    : ${cook(donorBefore)} -> ${cook(donorAfter)} COOK`);
line(`raised   : ${cook(c1.raised)} COOK from ${c1.donorCount} donor(s)`);

check("the gift arrived in full", vaultAfter - vaultBefore === toLamports(25));
check("the donor paid the gift and nothing else",
  donorBefore - donorAfter === toLamports(25),
  `${donorBefore - donorAfter} lamports`);
check("donor counted once", c1.donorCount.toNumber() === 1);
check("donation recorded", d1.total.toNumber() === toLamports(25) && d1.times === 1);

// ====================================================== giving twice is once
step("The same wallet gives again");

const ix2 = await program.methods
  .donate(bn(toLamports(4)))
  .accountsPartial({
    donor: donor.publicKey, payer: relayer.publicKey, config, campaign,
    campaignVault, donation: findDonation(campaign, donor.publicKey),
    systemProgram: SystemProgram.programId,
  })
  .instruction();
const msg2 = new TransactionMessage({
  payerKey: relayer.publicKey,
  recentBlockhash: (await conn.getLatestBlockhash()).blockhash,
  instructions: [await program.methods.reimburseRelayer(bn(10_000)).accountsPartial({
    relayer: relayer.publicKey, config,
    sponsor: findSponsor(me.publicKey), sponsorVault: findSponsorVault(me.publicKey),
    systemProgram: SystemProgram.programId,
  }).instruction(), ix2],
}).compileToV0Message();
const tx2 = new VersionedTransaction(msg2);
tx2.sign([relayer, donor]);
await conn.confirmTransaction(
  await conn.sendRawTransaction(tx2.serialize()), "confirmed",
);

const c2 = await program.account.campaign.fetch(campaign);
const d2 = await program.account.donation.fetch(findDonation(campaign, donor.publicKey));
line(`raised   : ${cook(c2.raised)} COOK from ${c2.donorCount} donor(s), ${c2.donationCount} gift(s)`);
check("raised went up", c2.raised.toNumber() === toLamports(29));
check("donor count did not inflate", c2.donorCount.toNumber() === 1);
check("gift count did go up", c2.donationCount.toNumber() === 2, `${d2.times} on the record`);

// ===================================================== raised money stays in
step("What was raised lands in a jar, not a wallet");

const jarId = now + 7;
const jar = findJar(me.publicKey, jarId);
await program.methods
  .createJar(bn(jarId), "Hospital fund", { proportional: {} },
    bn(now), bn(now + 3600), bn(toLamports(1)), bn(toLamports(5)))
  .accountsPartial({
    creator: me.publicKey, config, jar,
    jarVault: findJarVault(jar), rewardVault: findRewardVault(jar),
    systemProgram: SystemProgram.programId,
  })
  .rpc();

const jarVaultBefore = await conn.getBalance(findJarVault(jar));
const campVaultBefore = await conn.getBalance(campaignVault);

await program.methods
  .withdrawToJar(bn(toLamports(29)))
  .accountsPartial({
    creator: me.publicKey,
    payer: me.publicKey,
    campaign,
    campaignVault,
    jar,
    jarVault: findJarVault(jar),
    position: findPosition(jar, me.publicKey),
    systemProgram: SystemProgram.programId,
  })
  .rpc();

const jarVaultAfter = await conn.getBalance(findJarVault(jar));
const campVaultAfter = await conn.getBalance(campaignVault);
const pos = await program.account.position.fetch(findPosition(jar, me.publicKey));
const c3 = await program.account.campaign.fetch(campaign);

line(`campaign vault : ${cook(campVaultBefore)} -> ${cook(campVaultAfter)} COOK`);
line(`jar vault      : ${cook(jarVaultBefore)} -> ${cook(jarVaultAfter)} COOK`);
line(`position       : ${cook(pos.amount)} COOK, withdrawable any time`);

check("it left the campaign", campVaultBefore - campVaultAfter === toLamports(29));
check("it arrived in the jar", jarVaultAfter - jarVaultBefore === toLamports(29));
check("TVL did not drop, it moved", jarVaultAfter > jarVaultBefore);
check("the asker owns it", pos.owner.equals(me.publicKey));
check("campaign records the withdrawal", c3.withdrawn.toNumber() === toLamports(29));

// ============================================================ what must fail
step("What must not be allowed");

let strangerBlocked = false;
try {
  await program.methods.withdrawRaised(bn(toLamports(1)))
    .accountsPartial({
      creator: donor.publicKey, campaign, campaignVault,
      systemProgram: SystemProgram.programId,
    })
    .signers([donor]).rpc();
} catch { strangerBlocked = true; }
check("a stranger cannot take the money", strangerBlocked);

let overdrawBlocked = false;
try {
  await program.methods.withdrawRaised(bn(toLamports(1000)))
    .accountsPartial({
      creator: me.publicKey, campaign, campaignVault,
      systemProgram: SystemProgram.programId,
    }).rpc();
} catch { overdrawBlocked = true; }
check("the asker cannot take more than was raised", overdrawBlocked);

await program.methods.closeCampaign()
  .accountsPartial({ creator: me.publicKey, campaign }).rpc();

let closedBlocked = false;
try {
  const ix = await program.methods.donate(bn(toLamports(1)))
    .accountsPartial({
      donor: me.publicKey, payer: me.publicKey, config, campaign, campaignVault,
      donation: findDonation(campaign, me.publicKey),
      systemProgram: SystemProgram.programId,
    }).rpc();
  void ix;
} catch { closedBlocked = true; }
check("a closed campaign takes no more gifts", closedBlocked);

// ================================================================= summary
line();
const failed = results.filter(([, p]) => !p);
line(`${results.length - failed.length}/${results.length} checks passed`);
for (const [label] of failed) line(`  failed: ${label}`);
process.exit(failed.length ? 1 : 0);
