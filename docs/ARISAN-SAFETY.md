# Arisan safety model

## What the research found

A ROSCA is not risk-free credit. Members who receive the pot early still owe
future contributions, and the research documents the exact failure mode: a member
stops contributing after their turn and leaves the rest short.

Note where that risk sits. It is *after* the turn, not before it — a member who
has not been paid yet is held in place by the turn they are still waiting for.
That asymmetry is what the reserve is built around, and getting it wrong in
either direction breaks the circle: too little and an early winner can walk, too
much and nobody who actually needs the money can afford to join.

## The invariant

```text
reserve needed to collect on round k of N  =  (N - k) × contribution
```

That is the liability a member carries *after* taking the pot, and it is the
only thing the reserve is sized against. It is the whole remaining commitment
for whoever goes first and nothing at all for whoever goes last, so the reserve
becomes the price of a place in the queue rather than a toll at the door. A
member may join holding the entry reserve and never add to it; they simply
cannot be paid early. `handle_claim_turn` is where this is enforced, because
that is the moment the money actually moves.

The reserve is not a fee. A missed round moves one contribution from that
member's reserve into the pot; any unused balance remains withdrawable after the
circle finishes.

**The earlier rule required `contribution × seats` from every member before the
circle could start.** It made the reserve airtight and the product meaningless:
you had to already own the pot in order to be allowed to receive it. A circle you
can only join if you could already afford to skip it is neither savings nor
credit, and correcting that is the reason this document changed.

After a round is settled, the program reduces the required reserve by the
settled round. It allows a draw only when:

- every member has either paid or been settled from their own reserve;
- the roster contains every seat and excludes every previous winner; and
- the bond vault can cover one winner's post-turn liability.

That last one used to demand the sum across every member, which only describes
something real when every seat is reserved to the hilt. Exactly one member
collects per round, and whether *that* member is covered is decided per member
at claim time, so the vault only has to be able to back the one.

If any one of those checks fails, the round stops. Other members are never
asked to top up somebody else's missing reserve, and the pot is never paid
partially.

## The seat invariant

Seats are the program's only name for a member. A draw produces a seat number,
`claim_turn` matches it against the caller's `Member.seat`, and the roster
bitmaps address winners by seat. All of that assumes one property:

```text
the seats of a circle are exactly 0 .. member_count - 1, each held once
```

Joining preserves it by taking `seat = member_count`. Leaving is where it can
break, and did: an earlier version decremented `member_count` and closed the
member account, which left a hole. The next joiner then took a seat number that
was already occupied, and the vacated number belonged to nobody.

Both halves of that are fatal, and neither announces itself:

- **A duplicated seat.** Two members answer to one number. The first to claim
  marks the seat as a winner, and the second can never receive a pot while still
  being required to pay into every round. Their money is gone with no error
  anywhere.
- **An orphaned seat.** The draw can select a number no member holds. Nobody can
  claim it, so the round stalls until the 24-hour claim window lets somebody call
  `redraw_turn` — repeatedly, for as long as the hole exists.

`leave_circle` therefore takes the member holding the highest seat as an extra
account and moves them into the vacated one, closing the gap in the same
transaction. A leaver who already holds the highest seat passes nothing. Any
other combination is refused with `TailMemberRequired` rather than being
silently repaired, because a caller that supplies the wrong tail is a caller
whose view of the circle is stale.

`scripts/test-seat-integrity.mjs` proves this against mainnet: it builds a
circle, tries the gap-creating leave and watches it fail, performs the repaired
leave, and confirms the next joiner receives a fresh seat rather than a
duplicate.

## What a defaulting member loses

The defaulting member loses the reserve used to cover their missed contribution
and the ledger records a miss. The reserve-funded settlement is deliberately
shown as “ditutup dari cadangan” rather than “paid”. A member may still collect
their own turn when the reserve has fully settled that round; this is fair to the
other members because their pot is whole, and the default is permanently visible
in the books.

## What this does not promise

The rule protects members from another member's missed contributions. It does
not make COOK price-stable, guarantee a social relationship, or remove the
external risk of a compromised upgrade authority. The program's upgrade
authority and operational admin therefore need multisig governance before the
circle holds material value.

