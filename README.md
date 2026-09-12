# 🍪 Cookie Jar

**Giveaways that fill the jar instead of emptying it.**

A wallet holding zero COOK can open a giveaway on Cookie Chain, pay nothing, and
the money it receives never leaves the protocol. Claiming raises TVL instead of
draining it.

| | |
|---|---|
| Live app | **https://cookiejar-cook.vercel.app** |
| Program | [`Dwd7DXUQHRJaj1suYz6fTcVW7JJqBFVztg1z77t6Ysg`](https://cookiescan.io/account/Dwd7DXUQHRJaj1suYz6fTcVW7JJqBFVztg1z77t6Ysg) |
| Network | Cookie Chain mainnet |
| Wallet | Nightly |

---

## The problem

Two numbers explain why Cookie Chain is quiet.

**Nobody can start.** Every action needs COOK for gas. A new user has none, and
getting some means bridging from Solana, which needs SOL they may also not have.
MomoSwap, the chain's only launchpad, sits at **$0 TVL**. The whole chain does
roughly **8 swaps a day**.

**Giveaways leak.** The obvious fix is to airdrop COOK at people. That produces
a spike of transactions and zero lasting TVL, because claimed funds leave the
contract the moment they are claimed. This is not a guess. Base lost 30% of its
TVL within two weeks of Onchain Summer ending, and Blast's TVL and activity both
collapsed the week its airdrop opened.

So the usual answer to a cold chain makes one metric look good for a week and
the other one worse.

## What Cookie Jar does

Two things that plug into each other.

**🥠 Fortune Cookie.** A giveaway envelope. Fill it with COOK, share a link,
anyone can crack it open. Split it evenly, or leave it to chance so nobody knows
what they will get.

**🫙 Cookie Jar.** A non-custodial vault. Deposits earn from a prize pool that
the jar's sponsor funds. Two modes:

- **Streaming** pays everyone continuously, weighted by how much and how long.
- **Lucky draw** gives one entry per wallet. A 1 COOK deposit and a 1,000 COOK
  deposit have identical odds. Winner takes the pool.

The join between them is the whole idea. Cracking a Fortune Cookie **into** a
jar is one atomic instruction: the COOK moves from one program vault to another
and never touches an outside wallet. The claimer walks away with a withdrawable
position and a standing reason to leave it there.

Nothing is locked. Principal is never at risk. There is no lending, no trading,
and no path by which a depositor ends up with less than they put in. Leaving
costs you future rewards, never your money.

## See it work

Every line below is a real transaction on Cookie Chain mainnet. Click them.

| What it proves | Transaction |
|---|---|
| **A real Nightly wallet holding zero COOK** claimed 44.15 COOK through the live site and paid nothing | [`63nPzm62…`](https://cookiescan.io/tx/63nPzm62sSE6bvYeTitre8vDLgWRHb8GB1kMMuZqABdFoH3bkPux6pnTdAe2LWg93NnMP3WK9k9YsULAf2Fb2eGY) |
| A wallet with **zero COOK** signed and landed a transaction while someone else paid the fee | [`dFWFof5b…`](https://cookiescan.io/tx/dFWFof5bH4PKDhmawnNhytvztrhBHSA8C5jEfcfMCf1S2Yw2fazQA7K4uBht6kovdghnv1EaQddfMfzLZk7PUgq) |
| A brand new empty wallet cracked a cookie and **TVL went up**, not down | [`3akeiqse…`](https://cookiescan.io/tx/3akeiqse2qdQY1admXxemjziLHn6W6NFpmRcTJci6XjyQRK6RXgEz3ymYyEaxLPgXYsvHZGzDW2zxZHgMXemVzdY) |
| The same claim through the live relayer, end to end | [`64jpVMTy…`](https://cookiescan.io/tx/64jpVMTyK7oBY5ZcFxkVzUGb2xkezsYki96yENkBwamgPnafmCjTMhpLrqS8iASdGNJMGYsuVyK9sisZRzHw7NLt) |
| A Lucky draw settled against a future slot hash | [`RSjz1pvv…`](https://cookiescan.io/tx/RSjz1pvvjEnarqG1x2nHhwBZqWKNm9PYSS2qeXofGxy49T2c25emH5FjB9giv8bqHpW4tCPWiEFhDd9M9WekG8q) |
| The winner collected 25 COOK | [`5Sd8oYZ8…`](https://cookiescan.io/tx/5Sd8oYZ8GwVzq77K3G6DA3PJDDaV9uShY9hcKP4XSR4Lyqkvz2Jvyw3njnRrm2YC4j8i4GihxGS2MtgsJj6zDW2h) |

The first one is the whole thesis in a single transaction, and not a scripted
keypair: a person opened the live site with Nightly, clicked once, and the
wallet at `HWG1j6Jz…po9M4FR` went from 0 lamports to 0 lamports while 44.15 COOK
moved out of the envelope vault and into their jar position.

**One thing to know if you try it.** Point your wallet at Cookie Chain first.
Wallet-adapter's `signTransaction` does not forward a chain identifier, so a
wallet left on another network simulates against that one, reports
`AccountNotFound`, and warns you the transaction will fail. This app now names
the chain explicitly through the Wallet Standard, and tells you when your wallet
does not recognise it. Approving past the warning works either way: a signature
covers the transaction bytes and says nothing about which chain it is for.

## How this produces Volume and TVL

**TVL** is the sum of four live program vaults, all of them withdrawable by
their owner and none of them locked:

| Vault | Why it stays |
|---|---|
| Jar principal | Withdrawing forfeits future rewards, never principal. |
| Reward pools | Sponsor-funded budgets, locked until earned or drawn. |
| Gas vault | At 10,000 lamports a transaction, a deposit here is effectively permanent. |
| Envelope escrow | Unclaimed giveaways. |

A DefiLlama adapter summing those four PDA types is about twenty lines, and it
matches the methodology already used for CookieSwap on this chain.

**Volume** is recurring rather than one-shot. A plain airdrop is one transaction
per user, ever. Here the same user creates, cracks, deposits, harvests,
withdraws, funds, and cranks draws.

**What sponsoring actually costs.** The transaction fee is 10,000 lamports, two
signatures at 5,000 each. The real cost of a first-time user is the rent for the
two accounts their claim opens, 3,312,960 lamports, so onboarding somebody brand
new costs 0.003323 COOK and everything they do afterwards costs 0.00001 COOK.

At today's price the 100 COOK in the public gas vault covers about **30,000
first-time users** or **10 million repeat actions**, for under a cent.
Onboarding cost is not the constraint here. Attention is.

## Architecture

```
Fortune Cookie escrow ──crack_into_jar──▶ Jar vault ──▶ Position (yours)
                          one instruction              withdraw any time
        ▲                                                      │
        │                                                      ▼
   sponsor funds                                        earns from the
   the giveaway                                          reward vault

   Relayer  ──pays the fee──▶ transaction
      ▲                            │
      └──reimburse_relayer─────────┘   capped at 0.005 COOK, enforced on-chain
             (from the gas vault)
```

Cookie Chain's gas token is native COOK, so there are no SPL token accounts and
no ATAs anywhere. Vaults are zero-data PDAs holding lamports.

Full design notes, including the reward math and the randomness argument, are in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Security

Design decisions that exist specifically to remove a class of failure:

**Rewards can never be paid from someone's deposit.** Principal and rewards sit
in separate PDAs. No instruction moves lamports out of a jar vault to anyone but
the owner of that position. This is structural, not a check that could be
forgotten.

**The admin cannot reach user funds.** `authority` can pause new deposits and
rotate the relayer. That is the entire surface. Withdraw and harvest stay open
while paused, so pausing can never trap anyone's money.

**A stolen relayer key cannot drain a vault.** The relayer is a fee payer and
nothing else. It has no authority anywhere in the program, and the most it can
reclaim per transaction is capped on-chain at 0.005 COOK. Emptying the 50 COOK
public vault would take 10,000 separate transactions to net about half a cent.

**Double claiming is impossible rather than merely checked.** A claim creates a
PDA keyed to the envelope and the claimer. Creating it twice fails at the
runtime level.

**The draw commits to a slot that does not exist yet.** `request_draw` records a
target three slots ahead, and `finalize_draw` reads that slot's hash. Nobody,
including the caller, knows the seed at request time. Finalizing is bounded to a
300 slot window, because without that bound a caller could stall until an old
hash they had already seen came into reach and retry until it suited them.

Honest limitation: a block producer that controls the target slot can bias the
result. For prize pools this size that tradeoff is acceptable, and it is written
down rather than hidden. A VRF is a drop-in replacement for one function.

**The relayer refuses anything it should not pay for.** Instruction allowlist,
exactly one capped reimbursement, fee payer must be the relayer, the relayer may
not appear anywhere else in the account list, and per-client rate limiting.
Without those rules it is a free transaction service for the entire chain.

## Tests

Everything runs against mainnet with real COOK.

```bash
node scripts/e2e.mjs          # zero-balance claim raises TVL
node scripts/test-flows.mjs   # reward accrual, withdrawal, full draw cycle
node scripts/test-relayer.mjs # seven attacks on the relayer, then the real path
```

Current results: **18/18** protocol checks, **9/9** relayer checks.

The relayer suite is adversarial, not ceremonial. It tries to drain the relayer
with a bare transfer, ride it for a foreign program, ask above the cap, skip the
reimbursement entirely, sponsor a gas-vault withdrawal, make someone else the
fee payer, and stack two reimbursements. All seven are refused, and a real
sponsored claim still goes through with the claimer at zero COOK throughout.

Two real bugs were found by running against a live chain rather than a local
validator, and both are fixed:

1. Anchor billed account rent to the claimer, which broke the one thing the
   protocol promises. Paying and authorising are now separate accounts.
2. The draw pinned itself to an exact slot. Solana skips slots, so a skipped
   target meant a prize locked forever. It now takes the first block at or after
   the target.

## Run it locally

```bash
git clone <this repo> && cd cookiejar
npm --prefix app install

# relayer, the same code that runs as a Vercel function in production
RELAYER_SECRET_KEY="$(cat ~/.config/solana/cookiejar-relayer.json)" \
  node relayer/dev-server.js

# web app, in another shell. Vite proxies /api to the relayer above.
npm --prefix app run dev      # http://localhost:5174
```

Deployment is `app/` as the Vercel root directory. `app/api/*.js` become the
serverless relayer, `app/dist` is the site, and `RELAYER_SECRET_KEY` is the only
secret. Frontend and relayer share an origin, so there is no CORS to configure
and nothing is blocked as mixed content.

Two things that will bite on a fresh Vercel project. `@solana/web3.js` pulls in
`rpc-websockets`, which `require()`s a version of `uuid` that is ESM only, and
the function dies at cold start with `ERR_REQUIRE_ESM`; the `overrides` block in
`app/package.json` pins it back. And a newly aliased `*.vercel.app` subdomain
sits behind Vercel's deployment protection until it is added as a project domain
rather than a bare alias, which makes it 302 to an SSO page for everyone else.

Rebuilding the program needs Anchor 1.2 and the Solana CLI. Cookie Chain runs an
older core than the current CLI, so it must be built for SBPF v0:

```bash
anchor build                                                    # regenerates the IDL
node scripts/sync-idl.mjs                                       # IDL and types into app/
cargo-build-sbf --arch v0 --manifest-path programs/cookie_jar/Cargo.toml
solana program deploy target/deploy/cookie_jar.so \
  --program-id target/deploy/cookie_jar-keypair.json --max-len 1000000
```

Skipping `sync-idl` leaves the app talking to the previous version of the
program, which fails in confusing ways rather than loudly.

`--max-len` matters. Cookie Chain's loader does not support `ExtendProgram`, so
a program account cannot be grown later and closing one burns its address.

Deploying to a fresh chain also needs these once, in order:

```bash
node scripts/fund-deployer.mjs 2000   # move COOK to the deploy wallet
node scripts/initialize.mjs           # create the Config PDA, register the relayer
```

`scripts/lib.mjs` holds the shared client setup and PDA derivation that the
scripts above import.

## Addresses

| | |
|---|---|
| Program | `Dwd7DXUQHRJaj1suYz6fTcVW7JJqBFVztg1z77t6Ysg` |
| Config PDA | `3zuBJYMEhLvqo996KSQbNMokPQASeVy7Ps7TeV8ruvci` |
| Relayer | `BMS3jCCznvmLcFpiTSPPLZtDYsmAwS68AXt85g6DhpeL` |
| RPC | `https://rpc.cookiescan.io` |
| Explorer | `https://cookiescan.io` |

## Stack

Anchor 1.2 on Cookie Chain (SVM), React and Vite for the app, Solana Wallet
Standard for wallet discovery so Nightly registers itself, and a small Express
relayer that signs as fee payer and nothing more.

## What it does not do yet

- Randomness is a slot-hash commitment, not a VRF.
- Native COOK only. No SPL tokens in jars.
- One sponsor funds gas for the public deployment. The program already supports
  a sponsor account per app, so any project can fund its own users.
- Swap cashback is designed but not built. Every swap would mint a Fortune
  Cookie, verified by reading the Instructions sysvar to confirm a real
  CookieSwap trade in the same transaction. It is parked because the chain
  currently does about 8 swaps a day, so there is no volume to attach to yet.
