# 🍪 Cookie Tin

**Put COOK in a tin. You cannot lose it. One saver wins the pot.**

Your deposit is yours the whole time and comes back in full whenever you ask.
There is no lending it out, no trading it, and no instruction that can hand it to
anybody else. What you are playing for is the prize pool a sponsor puts on top.

| | |
|---|---|
| Live app | **https://cookietin-cook.vercel.app** |
| Program | [`Dwd7DXUQHRJaj1suYz6fTcVW7JJqBFVztg1z77t6Ysg`](https://cookiescan.io/account/Dwd7DXUQHRJaj1suYz6fTcVW7JJqBFVztg1z77t6Ysg) |
| Network | Cookie Chain mainnet |
| Wallet | Nightly |

---

## The problem

Cookie Chain is empty. Sampling 258 consecutive blocks, roughly 103 seconds of
real time, turned up **3 non-vote transactions from 3 wallets**. Its only
launchpad sits at $0 TVL. The whole chain does about 8 swaps a day.

There are two reasons nothing sticks here.

**Nobody can start.** Every action needs COOK a new wallet does not have, and
getting some means bridging from Solana, which needs SOL they may not have
either.

**Anything that pays people out drains itself.** Airdrops and giveaways produce a
spike of transactions and nothing lasting, because the money leaves the moment it
is claimed. Base lost 30% of its TVL within two weeks of Onchain Summer ending.
Blast's collapsed the week its airdrop opened.

## What Cookie Tin does

A tin is a vault you put COOK into. Two things make it different from a yield
farm.

**Your deposit cannot be lost.** Principal and prize money live in separate
program accounts. No instruction moves lamports out of a tin to anybody but the
owner of that position. That is structural, not a check somebody could forget.
Withdrawal stays open even while the protocol is paused.

**The prize is somebody else's money.** A sponsor funds the pool. Savers are
never paying each other, which is what separates this from the mechanics it
superficially resembles.

Two payout shapes:

- **Streaming.** Everyone earns continuously, weighted by amount and time held.
- **Lucky.** One entry per wallet. A 1 COOK deposit and a 1,000 COOK deposit have
  identical odds, so the biggest wallet does not simply win. Winner takes the
  pool.

And the gas is covered. Depositing, withdrawing and collecting are all paid by a
sponsor vault, so a wallet holding exactly zero COOK can still take part.

## See it work

Every line below is a real transaction on Cookie Chain mainnet. Click them.

| What it proves | Transaction |
|---|---|
| A Lucky draw settled against a slot hash that **did not exist when the draw was requested** | [`RSjz1pvv…`](https://cookiescan.io/tx/RSjz1pvvjEnarqG1x2nHhwBZqWKNm9PYSS2qeXofGxy49T2c25emH5FjB9giv8bqHpW4tCPWiEFhDd9M9WekG8q) |
| The winner collected the whole 25 COOK pool | [`5Sd8oYZ8…`](https://cookiescan.io/tx/5Sd8oYZ8GwVzq77K3G6DA3PJDDaV9uShY9hcKP4XSR4Lyqkvz2Jvyw3njnRrm2YC4j8i4GihxGS2MtgsJj6zDW2h) |
| **A real Nightly wallet holding zero COOK** took part and paid nothing | [`63nPzm62…`](https://cookiescan.io/tx/63nPzm62sSE6bvYeTitre8vDLgWRHb8GB1kMMuZqABdFoH3bkPux6pnTdAe2LWg93NnMP3WK9k9YsULAf2Fb2eGY) |
| A zero-balance wallet signed while somebody else paid the fee | [`dFWFof5b…`](https://cookiescan.io/tx/dFWFof5bH4PKDhmawnNhytvztrhBHSA8C5jEfcfMCf1S2Yw2fazQA7K4uBht6kovdghnv1EaQddfMfzLZk7PUgq) |

On the third one, read the balances directly: the wallet went from 0 lamports to
0 lamports while taking part. The fee came from the sponsor vault, not from them.

**One thing to know before you try it.** Wallet-adapter's `signTransaction` does
not forward a chain identifier, and Nightly does not publish Cookie Chain through
the Wallet Standard even while pointed at it. So a wallet may preview against the
wrong network and warn that the transaction will fail. It will not. A signature
covers the transaction bytes and says nothing about which chain it runs on.

## How this produces Volume and TVL

**TVL is the product, not a side effect.** In most apps a balance is something
that accumulates if things go well. Here the deposits *are* the thing being
built, and two properties make them stay:

| Vault | Why it stays |
|---|---|
| Tin principal | Withdrawing forfeits future prize share, never principal. |
| Prize pools | Sponsor-funded, locked until earned or drawn. |
| Gas vault | At 10,000 lamports a transaction, a deposit here is effectively permanent. |

A DefiLlama adapter summing these PDA types is about twenty lines, and matches
the methodology already used for CookieSwap on this chain.

**Volume is recurring rather than one-shot.** An airdrop is one transaction per
user, ever. Here the same wallet deposits, collects, tops up, withdraws part,
and cranks a draw, and the draw itself is permissionless so a closed tin never
waits on its creator.

**What sponsoring costs.** The fee is 10,000 lamports, two signatures at 5,000
each. A first deposit also opens a 130-byte position, 1,795,680 lamports of rent.
So a brand new saver costs 0.001806 COOK and everything they do afterwards costs
0.00001. The 150 COOK in the public gas vault covers roughly **80,000 first-time
savers**, for about a cent and a half.

## Architecture

```
  sponsor ──funds──▶ Prize vault ─────┐
                                      │  streamed, or drawn to one winner
  saver ──deposits──▶ Tin vault ──▶ Position (yours)
                          │            withdraw in full, any time
                          └────────────┘
              two separate accounts, so the prize can never
              be paid out of somebody else's deposit

   Relayer ──pays the fee──▶ transaction
      ▲                           │
      └──reimburse_relayer────────┘   capped at 0.005 COOK, enforced on-chain
            (from the gas vault)
```

Cookie Chain's gas token is native COOK, so there are no SPL token accounts and
no ATAs anywhere. Vaults are zero-data PDAs holding lamports.

Full design notes are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Security

**The prize can never be paid from someone's deposit.** Principal and rewards sit
in separate PDAs. No instruction moves lamports out of a jar vault to anyone but
the owner of that position. Structural, not a check that could be forgotten.

**The admin cannot reach user funds.** `authority` can pause new deposits and
rotate the relayer. That is the entire surface, and withdraw stays open while
paused, so pausing can never trap anyone's money.

**A stolen relayer key cannot drain a vault.** The relayer is a fee payer and
nothing else, with no authority anywhere in the program, and the most it can
reclaim per transaction is capped on-chain at 0.005 COOK.

**The draw commits to a slot that does not exist yet.** `request_draw` records a
target three slots ahead and `finalize_draw` reads that slot's hash, bounded to a
300 slot window so nobody can stall until a hash they already saw comes back into
reach. Honest limitation: a block producer controlling the target slot can bias
it. Written down rather than hidden, and a VRF replaces one function.

**The relayer refuses anything it should not pay for.** Instruction allowlist,
exactly one capped reimbursement, fee payer must be the relayer, and the relayer
may not appear anywhere else in the account list.

## Tests

Everything runs against mainnet with real COOK.

```bash
node scripts/test-flows.mjs     # accrual, withdrawal, full draw cycle
node scripts/e2e.mjs            # a zero-balance wallet taking part
node scripts/test-relayer.mjs   # seven attacks on the relayer, then the real path
```

Current results: **17/17** protocol, **6/6** gasless, **9/9** relayer.

The relayer suite is adversarial. It tries to drain the relayer with a bare
transfer, ride it for a foreign program, ask above the cap, skip the
reimbursement, sponsor a gas-vault withdrawal, make someone else the fee payer,
and stack two reimbursements. All seven are refused and the real path still works.

Bugs found by running against a live chain rather than a local validator, all
fixed:

1. Anchor billed account rent to the user, which broke the one thing the protocol
   promises. Paying and authorising are now separate accounts.
2. The draw pinned itself to an exact slot. Solana skips slots, so a skipped
   target meant a prize locked forever.
3. The rent estimate double-counted the account discriminator, quietly moving
   121,360 lamports per action from the sponsor vault to the relayer. Caught by
   reading the balance deltas of a real user's transaction, not by a test, which
   had the same wrong constant in it.

The program also carries instructions for giveaway envelopes and for fundraising
campaigns, both deployed and tested, both currently hidden from the interface.
They were explored and set aside rather than deleted.

## Run it locally

```bash
git clone <this repo> && cd cookie-tin
npm --prefix app install

# relayer, the same code that runs as a Vercel function in production
RELAYER_SECRET_KEY="$(cat ~/.config/solana/cookiejar-relayer.json)" \
  node relayer/dev-server.js

# web app, in another shell. Vite proxies /api to the relayer above.
npm --prefix app run dev      # http://localhost:5174
```

Deployment is `app/` as the Vercel root directory. `app/api/*.js` become the
serverless relayer, `app/dist` is the site, and `RELAYER_SECRET_KEY` is the only
secret. Frontend and relayer share an origin, so there is no CORS and nothing is
blocked as mixed content.

Two things that will bite on a fresh Vercel project. `@solana/web3.js` pulls in
`rpc-websockets`, which `require()`s a version of `uuid` that is ESM only, and
the function dies at cold start with `ERR_REQUIRE_ESM`; the `overrides` block in
`app/package.json` pins it back. And a newly aliased `*.vercel.app` subdomain sits
behind Vercel's deployment protection until it is added as a project domain
rather than a bare alias, which 302s every visitor to an SSO page.

Rebuilding the program needs Anchor 1.2 and the Solana CLI. Cookie Chain runs an
older core than the current CLI, so it must be built for SBPF v0:

```bash
anchor build                                    # regenerates the IDL
node scripts/sync-idl.mjs                       # IDL and types into app/
cargo-build-sbf --arch v0 --manifest-path programs/cookie_jar/Cargo.toml
solana program deploy target/deploy/cookie_jar.so \
  --program-id Dwd7DXUQHRJaj1suYz6fTcVW7JJqBFVztg1z77t6Ysg
```

Upgrade by **address**, not by the keypair file. Cookie Chain's loader does not
support `ExtendProgram`, so a program account cannot be grown later, and a wiped
`target/` will silently regenerate a different program keypair and deploy a
stranger to a new address.

Deploying somewhere fresh also needs these once:

```bash
node scripts/fund-deployer.mjs 2000   # move COOK to the deploy wallet
node scripts/initialize.mjs           # create the Config PDA, register the relayer
```

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
Standard for wallet discovery so Nightly registers itself, and a small serverless
relayer that signs as fee payer and nothing more.

## What it does not do yet

- Randomness is a slot-hash commitment, not a VRF. A block producer controlling
  the target slot can bias a draw. Acceptable at these prize sizes, written down
  rather than hidden, and replaceable in one function.
- Native COOK only. No SPL tokens in tins.
- Prize pools are funded by whoever opens a tin. There is no protocol revenue and
  no fee, so nothing funds them at scale yet.
- One sponsor covers gas for the public deployment. The program already supports
  a sponsor account per app, so any project can fund its own users.
