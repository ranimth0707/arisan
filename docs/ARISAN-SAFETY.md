# Arisan safety model

## What the research found

A ROSCA is not risk-free credit. Members who receive the pot early still owe
future contributions. Research on ROSCAs documents the exact failure mode: a
member can stop contributing after their turn and leave the remaining members
short. That is why a social promise or a small, optional bond cannot guarantee a
whole pot.

## The invariant

New circles use a protected-by-default rule:

```text
reserve per member = contribution × number of seats
reserve for the group = reserve per member × number of seats
```

Every member locks that reserve before the creator can start the circle. The
reserve is not a fee. A missed round moves exactly one contribution from that
member's reserve into the pot; any unused balance remains withdrawable after the
circle finishes.

After a round is settled, the program reduces the required reserve by the
settled round. It allows a draw only when:

- every member has either paid or been settled by a one-time collateral slash;
- the roster contains every seat and excludes every previous winner;
- every remaining obligation is still backed by the bond vault; and
- the safety PDA is marked protected.

If any one of those checks fails, the round stops. Other members are never
asked to top up somebody else's missing reserve, and the pot is never paid
partially.

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

