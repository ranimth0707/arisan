# Arisan safety model

## What this is for

A private circle of people who already know each other and have already agreed to
save together. Not strangers, not a lending protocol. Naming that is what decides
every trade-off below — get it wrong and you either build something nobody can
afford to join, or something that quietly loses people's money.

The point is to make saving together easier to keep up with, and there is no
yield, fee or spread anywhere in it.

## What the research found

A ROSCA is not risk-free credit. Members who receive the pot early still owe
future contributions, and the research documents the exact failure mode: a member
stops contributing after their turn and leaves the rest short.

Note where that risk sits. It is *after* the turn, not before — a member who has
not been paid yet is held in place by the turn they are still waiting for.

## The deposit

```text
deposit = 2 × contribution      (the organiser sets it; this is the sensible size)
```

It covers **being late**, not **leaving**. A missed round moves one contribution
from that member's deposit into the pot, so the round pays out in full and no
other member covers the shortfall. The books record it as a miss, never as a
payment. Once the deposit can no longer cover another miss the member is
sidelined from collecting until they top it back up; whatever is left is
withdrawable when the circle finishes.

## What it does not cover, stated plainly

A member who collects the pot on round 1 of N still owes `(N - 1) × contribution`
afterwards. A two-contribution deposit covers that at three seats and nowhere
above it:

| seats | owed after turn 1 | deposit | covered? |
| --- | --- | --- | --- |
| 3 | 2 × contribution | 2 × contribution | yes |
| 5 | 4 × contribution | 2 × contribution | no |
| 10 | 9 × contribution | 2 × contribution | no |
| 20 | 19 × contribution | 2 × contribution | no |

Closing that gap requires a deposit larger than the pot itself, at which point
only members who never needed the circle can join. **An earlier version of this
document described exactly that rule** — `contribution × seats` locked by
everyone before the circle could start — and it made the reserve airtight and the
product pointless. The group carries this risk, as every arisan always has, and
invite-only rooms are how it is kept survivable.

## What the chain does carry

- **Nobody holds the money.** The pot is a program account with no key. It can
  only ever pay the member whose turn was drawn.
- **The rules freeze on creation.** Contribution, deposit, seats and round length
  cannot be changed after anyone has committed money.
- **The draw cannot be timed.** Requesting it commits to the hash of a block three
  slots in the future, so nobody — the organiser included — can know the result
  when they call it.
- **Nobody can stall it.** Running the draw and settling an absentee out of their
  own deposit are both permissionless.
- **The books are public.** Who paid, who missed, how often, who has had a turn,
  and what each member still holds.

## The seat invariant

Seats are the program's only name for a member: the draw yields a seat number,
`claim_turn` matches it, and the roster bitmaps track winners by seat. So the
seats of a circle must be exactly `0 .. member_count - 1`, each held once.

Joining preserves that by taking `seat = member_count`. Leaving is where it broke:
an earlier version decremented the count and closed the account, leaving a hole.
The next joiner took a seat somebody already held, and the vacated number belonged
to nobody. A duplicated seat means one of the two can never receive a pot while
still paying into every round. An orphaned seat means the draw can select a member
who does not exist, stalling the round until the claim window allows a redraw.

`leave_circle` now takes the member holding the highest seat as an extra account
and moves them into the vacated one. `scripts/test-seat-integrity.mjs` proves it
against mainnet.

## What this does not promise

It does not make COOK price-stable, does not manufacture a social relationship,
and does not remove the risk of a compromised upgrade authority. That authority
and the operational admin need multisig governance before a circle holds
material value.
