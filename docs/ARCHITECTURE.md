# Cookie Jar - Architecture

Gasless giveaway protocol for Cookie Chain where claiming a giveaway increases
protocol TVL instead of draining it.

## The problem this solves

Cookie Chain has two compounding cold-start problems.

**Nobody can start.** Every action needs COOK for gas. New users have none, and
getting some means bridging from Solana, which needs SOL they may also not have.
This is likely why MomoSwap, the chain's only launchpad, sits at $0 TVL.

**Giveaways leak.** The obvious fix (airdrop COOK to new users) produces a spike
of transactions and zero lasting TVL, because claimed funds leave the contract
immediately. This is not a hypothesis: Base lost 30% of TVL within two weeks of
Onchain Summer ending, and Blast's TVL and activity both collapsed after its
airdrop claim window.

## Design principle

Claiming must be an inflow, not an outflow.

A Fortune Cookie (the giveaway envelope) is cracked directly into a Cookie Jar
(a non-custodial deposit vault) in a single atomic instruction. The COOK moves
from one protocol-owned PDA to another. It never leaves. The recipient now owns
a withdrawable balance and has a standing reason to leave it there, because
deposits earn from a sponsor-funded reward pool.

Retention is voluntary in both directions:

- Principal is never at risk. No lending, no trading, no loss mechanism.
- Withdrawal is always available, in full, with no penalty.
- Leaving only costs future rewards, never principal.

## Account model

Cookie Chain's native gas token is COOK, so all value is native lamports. No SPL
token accounts, no ATAs, no token program. Vaults are program-owned PDAs holding
lamports directly.

1 COOK = 1e9 lamports. Observed transaction fee = 10,000 lamports.

### Config (PDA: `["config"]`)

| Field | Type | Purpose |
|---|---|---|
| `authority` | Pubkey | Admin. Can pause and rotate the relayer. Cannot touch user funds. |
| `relayer` | Pubkey | Hot wallet that pays transaction fees. Fee payer only, no vault authority. |
| `paused` | bool | Emergency stop for new deposits. Withdrawals stay open when paused. |
| `jar_count` | u64 | Counter |
| `envelope_count` | u64 | Counter |

### GasVault (PDA: `["gas_vault"]`) and GasDeposit (PDA: `["gas", depositor]`)

Sponsors deposit COOK here to fund their users' transaction fees. The vault is a
PDA, so the balance counts as protocol TVL. The relayer cannot withdraw it, it
can only reclaim its own spent fees, capped per transaction.

`GasDeposit` tracks each sponsor's unspent share so they can withdraw at any time.

### Jar (PDA: `["jar", creator, jar_id]`)

| Field | Type | Purpose |
|---|---|---|
| `creator` | Pubkey | Who opened the jar |
| `mode` | enum | `Proportional` or `Lucky` |
| `start_ts` / `end_ts` | i64 | Reward window |
| `reward_rate` | u64 | Lamports per second (Proportional mode) |
| `total_deposited` | u64 | Principal currently in the jar. This is the TVL number. |
| `acc_reward_per_share` | u128 | Reward accumulator, scaled by 1e12 |
| `last_update_ts` | i64 | Accumulator checkpoint |
| `entry_count` | u64 | Eligible depositors (Lucky mode) |
| `min_deposit` | u64 | Eligibility threshold for Lucky mode |
| `draw_target_slot` | u64 | Randomness commitment slot |
| `winner` | Option\<Pubkey\> | Set once drawn |

### JarVault (PDA: `["jar_vault", jar]`) and RewardVault (PDA: `["reward_vault", jar]`)

Principal and reward money are held in separate PDAs. This separation is the
guarantee that rewards are never paid out of anyone's deposit. A sponsor funding
a giveaway can only ever fund `RewardVault`, and `JarVault` can only ever be
debited by the depositor who owns that position.

### Position (PDA: `["position", jar, owner]`)

| Field | Type | Purpose |
|---|---|---|
| `amount` | u64 | Principal deposited |
| `reward_debt` | u128 | Accumulator checkpoint for this position |
| `entry_index` | u64 | Ticket number for Lucky mode |
| `eligible` | bool | False once balance drops below `min_deposit` |
| `first_deposit_ts` | i64 | For display and future weighting |

### Envelope (PDA: `["envelope", creator, envelope_id]`) and EnvelopeClaim (PDA: `["claim", envelope, claimer]`)

| Field | Type | Purpose |
|---|---|---|
| `total_amount` | u64 | Funded amount |
| `remaining` | u64 | Unclaimed balance |
| `claims_total` / `claims_done` | u16 | Slot count |
| `split` | enum | `Equal` or `Surprise` |
| `expiry_ts` | i64 | After this, creator can sweep the remainder |

`EnvelopeClaim` exists purely to make double claiming impossible. Its existence
is the proof of a prior claim.

## Instruction set

**Config**
- `initialize(relayer)`
- `set_paused(bool)`, `set_relayer(pubkey)`, `transfer_authority(pubkey)`

**Gas sponsorship**
- `deposit_gas(amount)` - anyone funds the shared gas vault
- `withdraw_gas(amount)` - sponsor reclaims their unspent share
- `reimburse_relayer()` - relayer-signed, moves at most `MAX_FEE_REIMBURSEMENT`
  (20,000 lamports) from `GasVault` to the relayer wallet

**Jar**
- `create_jar(jar_id, mode, start_ts, end_ts, min_deposit)`
- `fund_jar(amount)` - anyone adds to the reward pool. This is the giveaway money.
- `deposit(amount)` / `withdraw(amount)`
- `harvest()` - claim accrued rewards (Proportional)
- `request_draw()` - permissionless after `end_ts`, commits to a future slot
- `finalize_draw()` - permissionless, reads the committed slot hash, picks winner
- `claim_prize()` - winner withdraws the reward pool (Lucky)

**Fortune Cookie**
- `create_envelope(id, total, claims, split, expiry)`
- `crack()` - claim to the claimer's own wallet
- `crack_into_jar(jar)` - claim straight into a jar position, atomically
- `sweep_envelope()` - creator reclaims the unclaimed remainder after expiry

## Reward math

### Proportional mode

Standard per-share accumulator, which weights by amount multiplied by time held.

```
update(jar):
  now = min(clock.unix_timestamp, jar.end_ts)
  if jar.total_deposited > 0 && now > jar.last_update_ts:
      elapsed = now - jar.last_update_ts
      minted  = elapsed * jar.reward_rate
      jar.acc_reward_per_share += minted * 1e12 / jar.total_deposited
  jar.last_update_ts = now

pending(position) = position.amount * jar.acc_reward_per_share / 1e12
                  - position.reward_debt
```

`update` runs before every deposit, withdraw and harvest. Depositing later or
withdrawing earlier reduces your share, with no cliff and no lockup.

### Lucky mode

Every depositor at or above `min_deposit` gets exactly one entry, regardless of
size. A $1 deposit and a $1,000 deposit have identical odds.

This is a deliberate choice. Equal odds make the giveaway fairer, make it far
more attractive to the small new wallets we are trying to onboard, and drive the
user-count metric the Cookie Chain team named as an alternative to raw volume.

Entries are assigned sequentially, so selecting a winner is O(1):

```
winner_index = seed % jar.entry_count
```

Anyone can then submit the Position whose `entry_index` equals `winner_index`,
and the program verifies it directly. If that position became ineligible by
withdrawing, the draw re-rolls with the next slot hash.

## Randomness

Solana forks have no native VRF and Cookie Chain has no oracle. The draw uses a
two-phase commitment so that nobody, including the caller, knows the seed at the
time the draw is requested.

1. `request_draw()` can only run after `end_ts`. It records
   `draw_target_slot = current_slot + 3`.
2. `finalize_draw()` can only run at or after `draw_target_slot`. It reads that
   slot's hash from the `SlotHashes` sysvar and derives
   `seed = hash(slot_hash, jar_key, entry_count)`.

`SlotHashes` retains 512 slots, roughly four minutes, so finalize must happen in
that window or the request is re-made.

Honest limitation: a block producer that controls the target slot can bias the
result. For prize pools of this size that tradeoff is acceptable, and it is
documented rather than hidden. A VRF can replace this later without touching any
other part of the protocol.

## Gas sponsorship

Verified on-chain before this design was written: a wallet holding exactly zero
COOK successfully signed and landed a transaction on Cookie Chain while a
separate wallet paid 100% of the fee. Transaction
`dFWFof5bH4PKDhmawnNhytvztrhBHSA8C5jEfcfMCf1S2Yw2fazQA7K4uBht6kovdghnv1EaQddfMfzLZk7PUgq`,
fee 10,000 lamports charged entirely to the payer, signer balance 0 before and 0
after.

Flow:

```
1. Frontend builds: [reimburse_relayer, <user instruction>]
2. feePayer = relayer wallet
3. Nightly signs as the user (partial signature, user pays nothing)
4. Frontend POSTs the partially signed transaction to the relayer service
5. Relayer validates, signs as fee payer, broadcasts
6. Signature returned, frontend subscribes for confirmation
```

The relayer never holds user funds and never has authority over any vault. It
pays fees and is reimbursed a capped amount by the program itself, which means
its economics are enforced on-chain rather than by trust.

### Relayer validation rules

A transaction is only signed if all of these hold:

- Every instruction targets the Cookie Jar program or `ComputeBudget`
- Exactly one `reimburse_relayer` instruction, and it is first
- Fee payer is the relayer and the relayer is not a signer on anything else
- No account in the transaction is the relayer's, other than as fee payer and
  reimbursement recipient
- Per-wallet and per-IP rate limits are not exceeded

Without these checks the relayer is a free transaction service for the whole
chain and the gas vault drains to unrelated activity.

## How this produces the judged metrics

**TVL** is the sum of live PDA balances:

| Source | Behaviour |
|---|---|
| `JarVault` | Principal. Stays because withdrawing forfeits future rewards. |
| `RewardVault` | Sponsor-funded giveaway budgets, locked until earned or drawn. |
| `GasVault` | Sponsor gas. At 10,000 lamports per transaction, effectively permanent. |
| `Envelope` | Unclaimed giveaway escrow. |

**Volume** is transaction throughput, and unlike a plain airdrop it is recurring
rather than one-shot: create envelope, crack, deposit, harvest, withdraw, fund,
request draw, finalize draw, claim prize.

A DefiLlama adapter summing these four PDA types is straightforward, and matches
the methodology already used for CookieSwap on this chain, which sums token
balances held in protocol vault accounts.

## Security model

| Risk | Mitigation |
|---|---|
| Rewards paid from depositors' principal | Principal and rewards live in separate PDAs. No instruction moves lamports from `JarVault` to anyone but that position's owner. |
| Admin drains funds | `authority` can only pause and rotate the relayer. No instruction grants it vault authority. |
| Single admin key is compromised | `transfer_authority` provides an explicit handoff to a governance PDA; production deployment should use a 2-of-3 multisig for both admin and program upgrade authority. |
| Relayer key compromised | Worst case is fee-paying for junk transactions, capped per transaction and bounded by `GasVault`. No user funds reachable. |
| Free-relay abuse | Instruction allowlist plus rate limits in the relayer service. |
| Double claiming an envelope | `EnvelopeClaim` PDA per claimer. Creating it twice fails at the runtime level. |
| Sybil farming the Lucky draw | Entry requires a real deposit at or above `min_deposit`, and the relayer rate-limits claims. Cost of a fake entry is the deposit itself. |
| Validator biasing the draw | Documented. Two-phase slot commitment raises the cost. VRF is a drop-in replacement later. |
| Integer overflow | All arithmetic uses checked operations. Accumulator is u128. |
| Pause locks user funds | `paused` blocks new deposits only. Withdraw and harvest stay open. |

## Scope

**v1, the hackathon build**
Config, gas vault, jars in both modes, positions, envelopes with both splits,
atomic crack-into-jar, two-phase draw, relayer service, web app with Nightly.

**Deliberately not in v1**
VRF randomness, SPL token support (native COOK only), multi-asset jars,
multisig deployment, a sponsor dashboard, DefiLlama adapter submission.

## Verified before building

| Assumption | Status |
|---|---|
| Fee payer can be a different wallet than the signer | Verified on-chain, tx `dFWFof5...` |
| A zero-balance wallet can transact | Verified, balance 0 before and after |
| Programs can be deployed post-genesis on Cookie Chain | Verified, deploys observed at slots 1,979,576 and 5,523,224 against a genesis at slot 0 |
| Toolchain runs against a solana-core 4.1.2 fork | rustc 1.98.1, solana-cli 4.2.2, anchor-cli 1.2.0 installed |
| Nightly can sign with an external fee payer | Not yet verified. Tested in the browser before the frontend is built. |
