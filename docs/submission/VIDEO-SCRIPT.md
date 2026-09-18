# 60-second demo script

One take, screen recording, no edit needed if you follow the beats. Narration is
about 145 words — that is a comfortable 60 seconds with room to breathe. Read it
slightly slower than feels natural.

**Before you hit record**

- A wallet with **zero COOK**. The point of the first beat is that it starts empty.
- Nightly pointed at Cookie Chain. Approve dialogs will appear — that is fine, it
  is part of the demo.
- Browser at `https://arisan-cook.vercel.app`, window around 1440×900.
- Have `ARISAN-DEMO` on your clipboard.
- Do a dry run first. Rounds are one minute, so a rehearsal costs you a minute.

---

| Time | On screen | Say |
| --- | --- | --- |
| **0:00** | Home page. Live activity panel visible. | "Arisan is how millions of Indonesian households actually save. Everyone pays in each round, and one person takes the whole pot, until everyone has had a turn." |
| **0:08** | Click **Get demo COOK**. Show the wallet balance at 0. Claim. Balance becomes 0.5. | "It works offline because the group knows each other. Here it is on Cookie Chain — and you can try it holding nothing." |
| **0:20** | **Join with code** → paste `ARISAN-DEMO` → join. Approve in Nightly. | "One code, one room. Your seat fills it, so you can start the circle yourself — no waiting on an organiser." |
| **0:30** | Click **Start**, then **Pay this round**. Show the pot filling. | "You pay your round. The pot is a program account with no key — it can only ever pay whoever gets drawn." |
| **0:40** | Wait for the round to close. Draw runs. Show the result. | "The draw commits to a block three slots in the future, so nobody — including whoever set it up — can know the winner when it is called." |
| **0:50** | Collect the pot if you won. Cut to the ledger showing paid / missed per seat. | "Every payment and every miss is public and permanent. That is the part a group chat does badly." |
| **0:56** | Home page, live stats in frame. | "Live on mainnet now. Code and numbers are in the description." |

---

## If "Cover from reserve" appears, film it

Sometimes the other seat has not paid when the round closes, and the ledger shows
a **Cover from reserve** button. Press it. It is the strongest ten seconds in the
whole demo, and worth restructuring around:

> "The other member did not pay. I settle it out of the deposit they posted — the
> pot stays whole, nobody else covers them, and their books record a miss, not a
> payment."

Drop the 0:50 line to make room.

## What not to say

- Do not call the deposit collateral or insurance. It covers **being late**. It
  does not cover somebody taking the pot and leaving, and the README says so.
- Do not say the invite code keeps people out. It is how you find a room; the
  gate is in the interface, not the program.
- Do not imply the numbers are organic. They are largely operator-seeded and the
  app says so on the same screen.

## Description to paste under the video

```
Arisan — rotating savings circles on Cookie Chain.

A group agrees an amount and a period. Everyone pays in each round, one member
takes the pot, until everyone has had a turn. The pot is a program account with
no key, the terms freeze when people commit, and the draw commits to a future
block so it cannot be timed.

Try it with zero COOK: claim from the faucet in the app, then join with code
ARISAN-DEMO. Rounds there last one minute.

App:     https://arisan-cook.vercel.app
Code:    https://github.com/ranimth0707/arisan
Program: Dwd7DXUQHRJaj1suYz6fTcVW7JJqBFVztg1z77t6Ysg
Metrics: https://arisan-cook.vercel.app/api/metrics
```
