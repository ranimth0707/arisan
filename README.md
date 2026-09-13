# 🤝 Bake Care

**Ask for help on chain. Give without paying a fee. What is raised keeps working
while it waits.**

Somebody with an empty wallet can open a request for help. Somebody else can give
to it and pay nothing but the gift itself. And money that has been raised does
not sit idle until the bill arrives.

| | |
|---|---|
| Live app | **https://bakecare-cook.vercel.app** |
| Program | [`Dwd7DXUQHRJaj1suYz6fTcVW7JJqBFVztg1z77t6Ysg`](https://cookiescan.io/account/Dwd7DXUQHRJaj1suYz6fTcVW7JJqBFVztg1z77t6Ysg) |
| Network | Cookie Chain mainnet |
| Wallet | Nightly |

---

## The problem

Crowdfunding platforms take a cut, decide whose story qualifies, and hold the
money in between. On a chain that cut could be zero and the gate could not exist
at all. Except nobody can use a chain they have no gas for, and the people most
likely to need help are the least likely to be holding any.

Cookie Chain shows what that does to a network. Its only launchpad sits at **$0
TVL**. The whole chain does roughly **8 swaps a day**. Every action needs COOK
that a new wallet does not have, and getting some means bridging from Solana,
which needs SOL they may not have either.

And the usual fix makes it worse. Airdropping tokens at people produces a spike
of transactions and nothing lasting, because the money leaves the moment it is
claimed. Base lost 30% of its TVL within two weeks of Onchain Summer ending.
Blast's TVL and activity both collapsed the week its airdrop opened.

## What Bake Care does

**Ask, with nothing.** Open a request with a title, a story and a goal. No
approval step, no platform cut, and no COOK needed to start. The rent for the
account is sponsored.

**Give, and pay only the gift.** A donor's transaction fee and the rent for their
donation record are both covered. They spend exactly what they meant to give, to
the lamport. The donor count is one per wallet rather than one per gift, so
giving twice does not inflate the number of people who actually helped.

**Raised money does not sit idle.** The default route out of a campaign is into
the asker's own jar, not their wallet. It stays withdrawable the moment a bill
arrives, and earns from a sponsor-funded pool while it waits. A successful
campaign moves value inside the protocol instead of draining it.

Two other primitives support that:

**🫙 Jars.** A non-custodial vault. **Streaming** pays everyone continuously by
amount and time held. **Lucky** gives one entry per wallet, so a 1 COOK deposit
and a 1,000 COOK deposit have identical odds.

**🥠 Fortune Cookies.** A shareable giveaway link, for getting COOK into the
hands of people who have none so they can take part at all. Cracking one open
deposits straight into a jar, so even a giveaway is an inflow.

Principal is never at risk anywhere. No lending, no trading, and no path by which
a depositor ends up with less than they put in.

## See it work

Every line below is a real transaction on Cookie Chain mainnet. Click them.

| What it proves | Transaction |
|---|---|
| A stranger gave 25 COOK and **paid exactly 25 COOK**, fee and account rent covered | [`3bkvRh78…`](https://cookiescan.io/tx/3bkvRh78V2q3dhAeHHZedjez6Ds5yZSXtiSBxsrFbHedyoeERHU7R3rZYqSEB38qHxbpspLxr5vUv6u5cufFJuby) |
| **A real Nightly wallet holding zero COOK** took part and paid nothing | [`63nPzm62…`](https://cookiescan.io/tx/63nPzm62sSE6bvYeTitre8vDLgWRHb8GB1kMMuZqABdFoH3bkPux6pnTdAe2LWg93NnMP3WK9k9YsULAf2Fb2eGY) |
| A zero-balance wallet signed while somebody else paid the fee | [`dFWFof5b…`](https://cookiescan.io/tx/dFWFof5bH4PKDhmawnNhytvztrhBHSA8C5jEfcfMCf1S2Yw2fazQA7K4uBht6kovdghnv1EaQddfMfzLZk7PUgq) |
| A Lucky draw settled against a slot hash that did not exist when it was requested | [`RSjz1pvv…`](https://cookiescan.io/tx/RSjz1pvvjEnarqG1x2nHhwBZqWKNm9PYSS2qeXofGxy49T2c25emH5FjB9giv8bqHpW4tCPWiEFhDd9M9WekG8q) |

On the first one, read the balances directly: the donor went down by exactly
25,000,000,000 lamports and the campaign vault went up by exactly the same. The
fee and the 1,517,280 lamports of rent for their donation record came from the
sponsor vault, not from them.

**One thing to know before you try it.** Wallet-adapter's `signTransaction` does
not forward a chain identifier, and Nightly does not publish Cookie Chain through
the Wallet Standard even while pointed at it. So a wallet may preview against the
wrong network and warn that the transaction will fail. It will not. A signature
covers the transaction bytes and says nothing about which chain it runs on.

## How this produces Volume and TVL

**TVL** is the sum of live program vaults, all withdrawable by their owner and
none of them locked:

| Vault | Why it stays |
|---|---|
| Campaign escrow | Raised and not yet needed. |
| Jar principal | Withdrawing forfeits future rewards, never principal. |
| Reward pools | Sponsor-funded budgets, locked until earned or drawn. |
| Gas vault | At 10,000 lamports a transaction, a deposit here is effectively permanent. |
| Fortune Cookie escrow | Unclaimed giveaways. |

The route from a campaign into a jar is what keeps a successful fundraiser from
being a TVL event that reverses itself. A DefiLlama adapter summing these PDA
types is about twenty lines, and matches the methodology already used for
CookieSwap on this chain.

**Volume** is recurring rather than one-shot. A plain airdrop is one transaction
per user, ever. Here the same person opens a request, receives many gifts, moves
the result into a jar, harvests, withdraws in pieces as bills arrive.

**What sponsoring costs.** The fee is 10,000 lamports, two signatures at 5,000
each. A first-time donation also opens a 90-byte record, 1,517,280 lamports of
rent. So a brand new donor costs 0.001527 COOK and every gift after that costs
0.00001. The 100 COOK in the public gas vault covers roughly **65,000 first-time
donors**, for under a cent.

## Architecture

```
  ask for help ──▶ Campaign ──donate──▶ Campaign vault
                       │                     │
                       │              withdraw_to_jar
                       │                     ▼
                       │                 Jar vault ──▶ Position (the asker's)
                       │                                withdraw any time,
                       │                                earns while it waits
                       ▼
                 goal, story, deadline

   Relayer ──pays the fee──▶ transaction
      ▲                           │
      └──reimburse_relayer────────┘   capped at 0.005 COOK, enforced on-chain
            (from the gas vault)
```

Cookie Chain's gas token is native COOK, so there are no SPL token accounts and
no ATAs anywhere. Vaults are zero-data PDAs holding lamports.

Full design notes are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Security

**Nobody but the asker can touch what was raised.** `withdraw_raised` and
`withdraw_to_jar` both constrain the signer to the campaign creator, and neither
can move more than `raised - withdrawn`. Closing a campaign stops new gifts but
never strands what people already gave.

**Rewards can never be paid from someone's deposit.** Principal and rewards sit
in separate PDAs. No instruction moves lamports out of a jar vault to anyone but
the owner of that position. Structural, not a check that could be forgotten.

**The admin cannot reach user funds.** `authority` can pause new deposits and
rotate the relayer. That is the entire surface, and withdraw stays open while
paused, so pausing can never trap anyone's money.

**A stolen relayer key cannot drain a vault.** The relayer is a fee payer and
nothing else, with no authority anywhere in the program, and the most it can
reclaim per transaction is capped on-chain at 0.005 COOK.

**Double claiming is impossible rather than checked.** A claim creates a PDA
keyed to the envelope and the claimer. Creating it twice fails at the runtime
level.

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
node scripts/test-campaign.mjs  # ask, give gasless, move the result into a jar
node scripts/e2e.mjs            # zero-balance claim raises TVL
node scripts/test-flows.mjs     # reward accrual, withdrawal, full draw cycle
node scripts/test-relayer.mjs   # seven attacks on the relayer, then the real path
```

Current results: **16/16** fundraising, **6/6** gasless claim, **17/17**
protocol, **9/9** relayer.

The relayer suite is adversarial. It tries to drain the relayer with a bare
transfer, ride it for a foreign program, ask above the cap, skip the
reimbursement, sponsor a gas-vault withdrawal, make someone else the fee payer,
and stack two reimbursements. All seven are refused and the real path still works.

Bugs found by running against a live chain rather than a local validator, all
fixed:

1. Anchor billed account rent to the claimer, breaking the one thing the protocol
   promises. Paying and authorising are now separate accounts.
2. The draw pinned itself to an exact slot. Solana skips slots, so a skipped
   target meant a prize locked forever.
3. The rent estimate double-counted the account discriminator, quietly moving
   121,360 lamports per claim from the sponsor vault to the relayer. Caught by
   reading the balance deltas of a real user's transaction, not by a test, which
   had the same wrong constant in it.

## Run it locally

```bash
git clone <this repo> && cd bake-care
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

- Campaign stories are 280 characters on chain. No images, no updates feed.
- No refunds if a goal is missed. Whatever was raised stays with the asker, the
  way a physical collection tin works.
- Nothing verifies that a request is genuine. That is a real gap for anything
  handling need at scale, and the honest answer today is that this is a proof of
  the mechanism, not a charity.
- Randomness is a slot-hash commitment, not a VRF.
- Native COOK only. No SPL tokens.
