# 🍪 Arisan

**A rotating savings circle nobody can run off with.**

A group agrees an amount and a period. Every round each member pays that in, and
one member who has not had a turn yet takes the whole pot. When everyone has had
a turn, it is done and everyone has put in and taken out the same, having had
access to a lump sum they could not have saved alone.

| | |
|---|---|
| Live app | **https://arisan-cook.vercel.app** |
| Program | [`Dwd7DXUQHRJaj1suYz6fTcVW7JJqBFVztg1z77t6Ysg`](https://cookiescan.io/address/Dwd7DXUQHRJaj1suYz6fTcVW7JJqBFVztg1z77t6Ysg) |
| Network | Cookie Chain mainnet |
| Wallet | Nightly |

This repository is open source under the [MIT License](./LICENSE). The live
application is a demo built around private groups, not an open marketplace for
strangers. Rooms are addressed by an invite code rather than listed publicly;
see [Campaign rooms](#campaign-rooms) for exactly how much that does and does
not enforce.

---

## The problem

An *arisan* is how tens of millions of Indonesian households actually save. It
works offline because everybody in the group knows each other, meets in person,
and can knock on your door.

Move it online and it collapses two ways, both ordinary rather than exotic:

**Somebody stops paying once they have already had their turn.** They collected a
full pot and now owe eleven more rounds to people who cannot reach them. The rest
of the group absorbs it.

**The organiser disappears with the money.** They hold every contribution between
rounds because somebody has to, and there is nothing but reputation stopping
them.

Both are trust problems, and a chain is the one place you can replace trust with
a rule that executes itself.

## What this does about it

**Nobody holds the money.** The pot is a program account. The organiser has no
key to it. Contributions can only ever leave in one direction: to the member
whose turn was drawn.

**A missed round cannot make another member's payout smaller.** Every new circle
locks a reserve per member equal to `contribution × member count` before it can
start. When someone skips, the program takes that round's amount from their own
reserve and puts it into the pot. The reserve is not a fee: whatever remains is
withdrawable after the circle finishes. If the reserve is not complete, the
program locks the draw and payout instead of making the other members insure the
shortfall.

**The draw cannot be timed.** Requesting a round's draw commits it to the hash of
a block three slots in the future. At the moment it is called, nobody, including
the organiser, can know who wins. That matters more here than in a game: the
organiser is a participant.

**An absent organiser cannot stall it.** Running the draw and charging a missed
round to somebody's collateral are both permissionless. In the test suite the
wallet that charges the defaulter is not even a member.

**The rules are frozen.** Contribution, collateral, seats and round length are
written once at creation and can never be changed. That is the reason anybody
should be willing to join a stranger's circle.

**The books are public.** Who paid, who missed and how many times, who has
already had a turn, how much collateral each person still holds. In a real arisan
that is a notebook one person keeps.

And the gas is covered where sponsorship is available. Joining, paying a round
and taking your turn can be fee-free; creating a campaign still needs the
creator's wallet for account rent. The contribution and any collateral always
come from the member's own wallet, because a stake somebody else paid for
guarantees nothing.

## See it work

A full cycle on mainnet, including a member going quiet halfway through. Three
members, 10 COOK a round, 30 COOK reserve each.

| | Round 1 | Round 2 |
|---|---|---|
| Members who paid | 3 | 2 |
| Pot paid out | **30 COOK** | **30 COOK** |

The pot was full both times. In round 2 the shortfall came out of the absent
member's reserve:

| | Before | After |
|---|---|---|
| Defaulter's reserve | 30 COOK | **20 COOK** |
| Pot | 20 COOK | **30 COOK** |

The missed round was settled from their reserve and recorded as a miss, while
the reserve still covered their future obligations. The draw that settled it:
[`4aX6u5FB…`](https://cookiescan.io/tx/4aX6u5FBG1wndtHtbT8dYcS3GfNGL1xSEPdnjsG6HYAp9ifrWSFZJAkpPxbRMB3RtfgBv886Zdydn6BjWmJ91eUL)

Also verified on mainnet, all as refusals: a fourth member cannot squeeze into
three seats, nobody can join once it is running, paying twice in one round is
rejected, drawing before the round closes is rejected, the same absence cannot be
charged twice, and a member cannot collect two turns.

### Try the live demo

The live app has a 3-seat room named **Demo · Join by code**. Its invite code is
published on purpose: **ARISAN-DEMO-9003**. Connect a wallet, open **Get demo COOK**,
claim enough demo COOK for the reserve shown in the room, then return to
**Circles**, paste the code, and join. Once the room has at least two members and
every member's reserve is complete, the creator can start it. The round lasts one
minute, so you can pay, draw and collect without waiting a month.

### Live Arisan metrics

The public app exposes a read-only [`/api/metrics`](https://arisan-cook.vercel.app/api/metrics)
endpoint for developers and reviewers. It reads Cookie Chain directly and reports
active TVL, protected TVL, room/member counts, contribution volume, payout volume,
and indexed transaction counts with an `asOf` timestamp. TVL excludes vault rent,
the faucet and relayer balances; volume is derived from confirmed `contribute`,
`slash_absent`, and `claim_turn` transactions.

### Campaign rooms

Circles are addressed by invite code rather than listed as an open pool. A
creator opens a campaign with a short description and a public social-post URL.
The program stores those details in a `CircleRoom` PDA alongside the SHA-256 hash
of the generated invite code. The creator is automatically the first member, then
shares the code with the people who saw the post.

**What the code actually is.** It is a discovery key, not an access-control
boundary, and the demo is deliberately built so you can see that for yourself.
`join_circle` takes the code *hash* as its argument and compares it to the hash
stored in the room, and that stored hash is a public account anyone can read. So
the honest statement is: anyone who can construct a transaction can join any
room, without ever knowing the code. The gate is in the interface, which asks for
a code before it will show you a room, not in the program.

That is a deliberate choice for a demo — a reviewer should be able to inspect a
room and join one without hunting for a secret. Enforcing it properly would mean
a creator-signed approval or a Merkle root of invited wallets, which is the right
shape for real money and the wrong shape for something people are meant to try in
one sitting.

Circle accounts created before rooms existed remain readable; their creator must run
`scripts/seed-demo-circle.mjs` or configure a room before new members can enter.

**One thing to know before you try it.** Wallet-adapter's `signTransaction` does
not forward a chain identifier, and Nightly does not publish Cookie Chain through
the Wallet Standard even while pointed at it. So a wallet may preview against the
wrong network and warn that the transaction will fail. It will not. A signature
covers the transaction bytes and says nothing about which chain it runs on.

## How this produces Volume and TVL

**TVL is locked by the design, not by hoping people stay.** Each member's reserve
sits for the whole cycle and contributions sit for a round. A 10-seat circle at
10 COOK a round holds 1,000 COOK of reserve continuously plus up to 100 COOK of
pot; unused reserve returns to its member when the circle finishes.

**Volume is scheduled rather than hoped for.** A 10-seat circle over 10 rounds is
100 contributions, 10 draws and 10 payouts. Roughly 120 transactions per circle,
arriving on a timetable the participants already committed to.

That matters on this chain in particular. Cookie Chain carries very little
traffic, so an app that waits for it gets none. An arisan generates its own, on
a timetable its members already committed to — and the effect is large enough to
see from outside:

```bash
node scripts/chain-share.mjs
```

Two 12-hour windows, a day apart, both measured with that script:

| | chain-wide, non-vote | from this program | share |
| --- | --- | --- | --- |
| 2026-09-15 | 553 | 238 | **43%** |
| 2026-09-16 | 1,865 | 376 | **20%** |

The share fell while our own output grew, because the rest of the chain got
roughly three times busier in a day — other entries in this bounty ramping up
before the deadline, most likely. Which is the point of quoting the script
rather than a number: any figure here goes stale, and a stale figure a reviewer
can disprove is worse than none. Run it yourself for today's.

Cookie Chain publishes no stats API (the explorer's `api.cookiescan.io` is a
Metaplex DAS endpoint for tokens and NFTs), so that script reads the RPC's own
`getRecentPerformanceSamples` and compares it against this program's signatures.
Vote transactions are excluded throughout: on a Solana fork they are consensus
overhead rather than usage, and counting them would make a quiet chain look
busy.

**What sponsoring costs.** The fee is 10,000 lamports, two signatures at 5,000
each. Joining also opens a 99-byte member record, 1,517,280 lamports of rent. So
a new member costs 0.001527 COOK once, and every round they pay after that costs
0.00001.

### Seeded liquidity, said out loud

Some of the circles on the live app are operator-seeded: one person funded the
wallets, and `scripts/seed-circles.mjs` opened the circles and filled the seats.
They are not strangers who found the app.

Calling that organic demand would be a lie, so here is what it actually is. The
COOK is real, locked in real program vaults under the same rules as anyone
else's — the reserve cannot be pulled out while a circle is running, a missed
round is slashed the same way, the draw is the same slot-hash draw, and
[`/api/metrics`](https://arisan-cook.vercel.app/api/metrics) counts it with the
same code it would count a stranger with. What it demonstrates is that the
mechanism runs unattended and that money stays locked for the full cycle. What
it does not demonstrate is that anybody wants it yet.

The scripts are in the repository rather than hidden, because the point of
publishing a number is that somebody can check how it was made:

```bash
node scripts/seed-circles.mjs --dry-run   # the plan and what it costs
node scripts/crank-circles.mjs --status   # where every circle currently stands
node scripts/unwind-circles.mjs --status  # what is still locked, and until when
```

## Architecture

```
  organiser ──creates──▶ Circle        rules frozen at creation
                           │
  members ──join, post──▶ Bond vault   collateral, theirs until they default
                           │
          ──contribute──▶ Pot vault ──▶ the drawn member
                           ▲                one turn each, then done
                           │
                     slash_absent          a missed round moves from Bond
                                           to Pot, so the round still pays
                                           out in full

  request_turn ──▶ commits to a block 3 slots ahead
  finalize_turn ─▶ reads that block's hash        nobody can time it
        both permissionless, so an absent organiser cannot stall the circle
```

Contributions and collateral are separate vaults on purpose. Collateral belongs
to the member until they default; it must never be payable as somebody else's
pot.

Cookie Chain's gas token is native COOK, so there are no SPL token accounts and
no ATAs. Vaults are zero-data PDAs holding lamports.

### Cookie Chain integrations

The program is built for Cookie Chain's SVM runtime with Anchor and the Solana
web3 SDK. The app reads and submits transactions through Cookie Chain's native
RPC at [`rpc.cookiescan.io`](https://rpc.cookiescan.io), and links every live
transaction and program account to [CookieScan](https://cookiescan.io).

Cookiebox and Cookieswap are not required by this product: Arisan moves native
COOK into program vaults and does not swap tokens or provide liquidity.
`cookie-mcp` is useful for local agent/developer workflows, but it is not a
runtime dependency of the public app and no private key is sent to it.

## Security

**The organiser has no privileged access to money.** They can create a circle and
start it. That is all. No instruction lets them move the pot, the collateral, or
anybody's membership.

**Collateral cannot be paid out as a prize.** It lives in a separate account from
the pot, and the only instruction that moves it into the pot charges a specific
member for a specific missed round, capped at one contribution.

**A missed round can only be charged once.** Slashing marks the round settled for
that member, so the same absence cannot be billed repeatedly to drain them.

**A default cannot make the group absorb a loss.** New circles must lock a
reserve of `contribution × seats` per member before starting. If that reserve is
not available, the program refuses to draw and refuses to pay out until the
shortfall is repaired. The reserve is reduced only when it actually covers a
missed contribution; unused COOK remains the member's to withdraw at the end.

**Eligibility is checked when the pot is collected, not when it is drawn.** The
claimer must hold the drawn seat, not have had a turn, be active, and have
settled this round. Drawing a seat proves nothing on its own.

**A stalled turn can be redrawn.** If the drawn member never collects, anyone can
redraw after the claim window, so one absent person cannot freeze everybody
else's money.

**A stolen relayer key cannot drain anything.** The relayer is a fee payer with no
authority anywhere in the program, and reclaims at most 0.005 COOK per
transaction, enforced on chain.

**Governance keys must be multisig.** The program upgrade authority and config
authority should be moved to a 2-of-3 governance wallet before material TVL;
the creator has no withdrawal instruction for the pot or bond vault. A 3-of-3
threshold is intentionally not recommended because one unavailable signer would
freeze recovery. See [`docs/MULTISIG-RUNBOOK.md`](docs/MULTISIG-RUNBOOK.md).

Honest limitation: the draw is a slot-hash commitment, not a VRF. A block
producer controlling the target slot could bias it. Acceptable at these amounts,
written down rather than hidden, and replaceable in one function.

Second honest limitation: nothing verifies identity, so one person can hold
several seats under different wallets. Collateral prices that rather than
preventing it, which is the trade-off every on-chain ROSCA makes.

## Tests

Everything runs against mainnet with real COOK.

```bash
node scripts/test-arisan.mjs    # a full cycle including a defaulting member
node scripts/test-relayer.mjs   # seven attacks on the relayer, then the real path
node scripts/test-flows.mjs     # the savings-jar instructions the program also carries
node scripts/e2e.mjs            # a zero-balance wallet taking part
```

Current results: **22/22** arisan, **9/9** relayer, **17/17** jars, **6/6**
gasless.

Bugs found by running against a live chain rather than a local validator, all
fixed:

1. Anchor billed account rent to the user, which broke the one thing the
   sponsorship promises. Paying and authorising are now separate accounts.
2. A draw pinned to an exact slot could be stranded forever, because Solana skips
   slots. It now takes the first block at or after the target, inside a bounded
   window so a late finalizer cannot reach back for a hash they already saw.
3. The rent estimate double-counted the account discriminator, quietly moving
   121,360 lamports per action from the sponsor vault to the relayer. Caught by
   reading the balance deltas of a real user's transaction, not by a test, which
   had the same wrong constant in it.

The program also carries instructions for savings jars, giveaway envelopes and
fundraising campaigns, all deployed and tested, all hidden from the interface.
They were explored on the way here and set aside rather than deleted.

## Prior art

Rotating savings on chain is not a new idea and this does not claim to be first.
The design follows the pattern established by
[Akyba Protocol](https://github.com/Akyba-Protocol) on Cardano, whose ROSCA spec
is the clearest public writeup of it: immutable group parameters, collateral
slashing for missed rounds, a rejoin path rather than permanent exclusion, and a
permissionless distribute crank. Others in the space include
[Bakso Finance](https://baksofinance.medium.com/arisan-on-solana-blockchain-30906b2e8cfd)
on Solana and [Njangi](https://njangionchain.com/learn/blockchain-rosca) on Sui.

What is here that is not there: it runs on Cookie Chain, and sponsored actions
can let a member with an empty wallet join, pay and collect; the COOK being
contributed still has to come from that member.

## Jumper Coinbase RWA mission helper

The read-only helper at [`scripts/jumper-rwa-cli.mjs`](scripts/jumper-rwa-cli.mjs)
uses the installed Zerion CLI for Base transaction history and Jumper's public
verification endpoint for the official task state. It deliberately never signs,
broadcasts, or loops trades; actual eligible swaps must be completed through
Jumper RWA.

```bash
npm run jumper:rwa -- assets --pretty
npm run jumper:rwa -- status --address 0xYourBaseWallet --limit 200 --pretty
npm run jumper:rwa -- plan --target 100000 --current 250 --pretty
npm run jumper:rwa -- open --asset NVDA
npm run test:jumper:rwa
```

## Run it locally

```bash
git clone https://github.com/ranimth0707/arisan.git
cd arisan
npm --prefix app install

RELAYER_SECRET_KEY="$(cat ~/.config/solana/cookiejar-relayer.json)" \
FAUCET_SECRET_KEY="$(cat ~/.config/solana/cookiejar-faucet.json)" \
  node relayer/dev-server.js

npm --prefix app run dev      # http://localhost:5174
```

Deployment is `app/` as the Vercel root directory. `app/api/*.js` become the
serverless relayer and demo faucet, and `app/dist` is the site.
`RELAYER_SECRET_KEY` is required. `FAUCET_AMOUNT_COOK` defaults to 0.5 and is
capped at 1.

**`FAUCET_SECRET_KEY` should point at a different wallet from the relayer.**
Wallet addresses cost nothing to generate, so no per-request limit can stop
someone from draining a faucet; what a separate wallet decides is whether the
drain also takes the sponsor down with it. Keep the faucet wallet small and top
it up. If the variable is unset the faucet falls back to the relayer's wallet
and holds back a 20 COOK reserve, which keeps the gasless buttons working but is
a fallback, not the arrangement to ship.

On top of that the faucet keys its rate limits on the connection and the
recipient *separately* — never on the pair, which would hand every fresh address
its own quota — and refuses any wallet already holding 2 COOK, since swept funds
have to land somewhere. `scripts/test-faucet.mjs` asserts all of it against a
running relayer.

Two things that will bite on a fresh Vercel project. `@solana/web3.js` pulls in
`rpc-websockets`, which `require()`s a version of `uuid` that is ESM only, so the
function dies at cold start with `ERR_REQUIRE_ESM`; the `overrides` block in
`app/package.json` pins it back. And a newly aliased `*.vercel.app` subdomain sits
behind deployment protection until it is added as a project domain rather than a
bare alias, which 302s every visitor to an SSO page.

Rebuilding the program needs Anchor 1.2 and the Solana CLI, and Cookie Chain runs
an older core than the current CLI, so order matters:

```bash
anchor build                                    # regenerates the IDL, but a v3 binary
node scripts/sync-idl.mjs                       # IDL and types into app/
cargo-build-sbf --arch v0 --manifest-path programs/cookie_jar/Cargo.toml
solana program deploy target/deploy/cookie_jar.so \
  --program-id Dwd7DXUQHRJaj1suYz6fTcVW7JJqBFVztg1z77t6Ysg
```

`anchor build` leaves an SBPF v3 binary that this chain rejects, so the v0 build
must come after it. Upgrade by **address**, not by the keypair file: the loader
does not support `ExtendProgram`, and a wiped `target/` silently regenerates a
different program keypair and deploys a stranger to a new address.

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
Standard for wallet discovery so Nightly registers itself, and a serverless
relayer that signs as fee payer and nothing more.

## What it does not do yet

- No identity, so one person can hold several seats. Collateral prices it rather
  than preventing it.
- No commission for whoever runs the draw, so cranking it is currently altruism
  or self-interest. Akyba pays a percentage for exactly this reason.
- Round length is fixed for the whole cycle. Real circles sometimes renegotiate.
- The draw is a slot-hash commitment, not a VRF.
- Native COOK only. No SPL tokens.
