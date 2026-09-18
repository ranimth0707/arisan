# Arisan — Architecture

An arisan is a rotating savings circle. A group agrees an amount and a period,
everyone pays that in each round, and one member who has not had a turn yet takes
the whole pot. When everybody has had a turn, it is over, and each person has put
in and taken out the same amount — having had access to a lump sum they could not
have saved alone.

This is an Anchor program on Cookie Chain that keeps the books for one, plus a
web app and a fee relayer.

## Who it is for

A private circle of people who already know each other and have already agreed
to save together. Not strangers. Naming that decides every trade-off below.

There is no yield, no fee and no spread anywhere in the program. The purpose is
to make saving together easier to keep up with.

## What the chain is actually for

An arisan runs fine on a spreadsheet and a group chat, right up to the moment it
does not. The failures are always the same three, and they are the only things
this program exists to remove:

| Offline failure | What the program does |
| --- | --- |
| The organiser holds the money | Nobody holds it. The pot is a PDA with no key and can only pay the drawn member. |
| The organiser changes the terms | Contribution, deposit, seats and round length are written once at creation and never again. |
| The draw is not trusted | It commits to the hash of a block three slots in the future, so nobody — organiser included — can know the result when they call it. |

Two more follow from being on chain: nobody can stall a circle, because running
the draw and settling an absentee are permissionless; and the books are public
and permanent.

## The deposit

```text
deposit = 2 × contribution      (the organiser sets it; this is the usual size)
```

It covers **being late**, not **leaving**. A missed round moves one contribution
from that member's own deposit into the pot, so the round still pays in full and
no other member covers the shortfall. It is recorded as a miss, never as a
payment. Spend it down and you are sidelined from collecting until you top it
back up; whatever is left is withdrawable when the circle ends.

It does not stop a member who takes the pot and disappears. Covering that needs a
deposit larger than the pot, which would admit only members who never needed the
circle — see [ARISAN-SAFETY.md](./ARISAN-SAFETY.md) for the arithmetic and why
that risk stays with the group.

## Accounts

Every vault is a zero-data `SystemAccount` PDA holding native COOK, seeded with
a rent floor so it can never be closed out from under the circle.

| Account | Seeds | Holds |
| --- | --- | --- |
| `Config` | `["config"]` | Protocol authority and pause flag. **Live at its original size — do not add fields.** |
| `Circle` | `["circle", creator, circle_id]` | The frozen terms and the round counter. Also size-locked. |
| `CircleRoom` | `["room", circle]` | Description, social link and the invite code hash. |
| `CircleRoster` | `["roster", circle]` | Two 100-bit masks: who has won, and migration progress for older circles. |
| `CircleSafety` | `["safety", circle]` | The reserve target and per-seat coverage. |
| `Member` | `["member", circle, wallet]` | One per wallet per circle: seat, deposit, rounds paid, rounds missed, whether they have had a turn. |
| `Pot` | `["pot", circle]` | Contributions for the current round. Only ever pays the drawn member. |
| `Bond` | `["bond", circle]` | Deposits. Separate from the pot on purpose: a deposit belongs to its member until they miss a round, and must never be payable as a prize. |

`CircleRoom`, `CircleRoster` and `CircleSafety` are companion PDAs rather than
fields on `Circle`, because `Circle` was already live when each was added and
growing an account breaks every existing one.

## A round, end to end

```
contribute        each member pays in                      (member signs)
slash_absent      anyone unpaid is settled from their own deposit  (permissionless)
request_turn      commits the draw to slot + 3             (permissionless)
finalize_turn     reads SlotHashes, picks an unwon seat    (permissionless)
claim_turn        the drawn member takes the pot           (that member signs)
```

A draw is only allowed once every seat has settled, so the pot is whole before
anyone can win it. `finalize_turn` draws only from seats absent from the roster's
winner mask, so previous winners are mathematically excluded rather than rejected
afterwards — and the final round has exactly one possible outcome.

If the drawn member never collects, `redraw_turn` reopens the round: immediately
when they are ineligible, and after a 24-hour claim window otherwise.

## The seat invariant

Seats are the program's only name for a member. They must be exactly
`0 .. member_count - 1`, each held once. Joining preserves that with
`seat = member_count`; leaving closes the gap by moving the highest-seated member
down, which is why `leave_circle` takes that member as an extra account. A
duplicate seat would mean one member paying into every round and never being able
to collect; an orphaned seat would stall the draw.

## Randomness

`request_turn` records `clock.slot + 3`. `finalize_turn` reads that slot's hash
from the `SlotHashes` sysvar and derives the winner from
`keccak(hash, circle, round)`.

The seed does not exist when the draw is requested, so nobody can pick a
favourable moment — which matters because the organiser is a participant.
Finalizing is bounded to 300 slots past the target: without that, stalling would
let a caller reach back to a hash they had already seen and retry until it suited
them. Past the window the request is stale and must be made again, committing to
a fresh unknown slot. A skipped slot is handled by taking the first block at or
after the target, so a draw can never be permanently stranded.

## Gas sponsorship

A wallet holding zero COOK can join, pay a round and collect. The relayer is the
fee payer; the transaction carries a `reimburse_relayer` instruction that pays it
back on chain out of a sponsor vault, capped at `MAX_FEE_REIMBURSEMENT`
(5,000,000 lamports) per transaction.

The cap is what bounds the damage if the relayer key leaks: draining a 2,000 COOK
vault would take 400,000 separate transactions.

Contributions and deposits always come from the member's own wallet. Gas can be a
gift; the stake that makes a promise credible cannot.

### What the relayer refuses

Before signing, it checks that the transaction:

- carries no address lookup tables, so every account is visible;
- names the relayer as fee payer and nowhere else;
- holds at most four instructions, only from this program or `ComputeBudget`;
- contains exactly one reimbursement, within the cap;
- calls only an allow-listed instruction — `deposit_gas` and `withdraw_gas` are
  deliberately excluded.

`scripts/test-relayer.mjs` attacks all of it.

## Reading the numbers

`app/api/metrics.js` computes TVL and volume from the chain with no database:
TVL from live bond and pot balances minus rent, volume from the pot's balance
delta across confirmed `contribute`, `slash_absent` and `claim_turn`
transactions. `scripts/chain-share.mjs` compares this program's transaction count
against the whole chain's, read from the RPC's own performance samples.

Some of the liquidity on the live app is operator-seeded rather than organic. The
README says so plainly and ships the scripts that produced it.

## What else is in the program

The crate is still named `cookie_jar`, and alongside the arisan instructions it
carries savings jars, giveaway envelopes and fundraising campaigns from earlier
directions the project took. They are deployed and tested but unreachable from
the app, which ships only the arisan. They are left in place because the program
ID is live and closing it would burn the address; they are not part of what this
submission is.

## Known limits

- The invite code is stored as a hash in a public account and `join_circle`
  compares against it, so anyone who can build a transaction can join any room
  without knowing the code. The gate is in the interface, not the program. This
  is deliberate for a demo; see the README.
- A member who collects and then disappears is not covered.
- The upgrade authority and protocol admin are single keys. Both need multisig
  before a circle holds material value.
- COOK is not listed on any market, so there is no price to convert these
  amounts into.
