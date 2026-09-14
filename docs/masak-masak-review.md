# Masak Masak: wallet and draw review (2026-09-14)

Circle: `488DMgz6GQBUFepx8GvTJWe7TvykzTfpYXXidrLwFtgf`.

## Observed on chain

- Two members, each paying 0.5 COOK per round, both active.
- Both members paid round 1; neither has received a pot.
- Recorded pot: 1 COOK. Pot account: 1.00089088 COOK, including rent.
- Separate collateral: 0.5 COOK per member; bond account: 1.00089088 COOK, including rent.
- Round 1 is running, the deadline has passed, `drawTargetSlot = 0`, and `winnerDrawn = false`.
- Six circle transactions were present: create, two joins, start, and two contributions. No request, finalize, or claim was recorded.

Payment evidence:

- [Creator contribution](https://cookiescan.io/tx/3QjKQBbksgZRJtw7iaANvibo2pwevQbmAA7g9Nb4Nk5tQAjT33Y2h9QjQndiy5EMzfmbg2mqbNXPG2xsNt2uVPie)
- [Second member contribution](https://cookiescan.io/tx/3tAMXrFzg621JBX3qrZqz1y4xMGzvrJxiiLZXhFTpBGTtx2ckm6BSnV2NTENEfXYS1EETmz4QGBUiPcqV3d7qZp1)

## Root causes and fixes

WalletProvider had `autoConnect={false}`, so reloading restored a wallet name but not its connection. Enable the provider's auto-connect; the installed Wallet Standard adapter uses `connect({ silent: true })` when restoring a session. Explicit disconnect still clears the selection.

Sponsored request/finalize/redraw instructions require no caller account on chain. With the relayer as fee payer, their compiled message had only the relayer as a required signer. The app nevertheless asked the user's wallet to sign. Reproducing this with web3.js throws `Cannot sign with non signer key`. The screenshot's approximately 45.5 COOK matches the relayer balance around the creator contribution, not the 1 COOK pot. The signer-list error is reproduced; Nightly's internal balance-preview implementation was not inspected.

The client now includes the requesting wallet as a read-only signer remaining account for permissionless app actions. No program upgrade or account migration is required. A regression uses the real Anchor instruction builders, signs with a test wallet, and runs the relayer validator. Both old and fixed requests also simulated successfully against the real circle with signature verification disabled; only the fixed message includes the user's signer slot. These simulations did not broadcast or advance the user's circle.

Simulation now precedes wallet approval. Cancellation and failures after signing/submitting no longer trigger a second self-paid transaction automatically, since an ambiguous timeout could mean the original transaction landed.

The UI distinguishes waiting, finalization and expiration at the program's 300-slot window. It fetches current circle state before building a draw, restarts expired requests, explains claim eligibility, and exposes the existing redraw instruction after its deadline.

## Mechanism findings and limits

The observed joins, contributions, and separated funds are consistent with the program. This legacy campaign retains its agreed 0.5 COOK collateral even though new campaigns default to zero.

The draw chooses a seat from all members, not only members who have yet to receive a pot. Claiming twice is prohibited, but drawing a previous recipient can delay the round. The existing redraw condition is 24 hours after the round payment deadline (not 24 hours after finalization). The UI now exposes this recovery path; it does not change that protocol rule or guarantee that a redraw cannot choose the same seat. A future change to select only eligible recipients requires a program design change and dedicated protocol tests.

A one-minute demo round still uses that same 24-hour redraw rule. Missing contributions may leave a smaller pot in zero-collateral groups; the contract does not guarantee full collection. Those are protocol limitations, not proof that this campaign has paid out incorrectly.

## Verification

- 48 automated tests plus existing UI smoke checks passed; production frontend build passed.
- New regressions cover missing signers, signing request/finalize/redraw, relayer acceptance, cancellation, ambiguous send/confirmation timeouts, preflight failure, draw expiry boundaries, and claim eligibility.
- Live simulation used the existing Cookie Chain program and real circle state without broadcasting.
- Direct Brave verification could not be completed because the computer-use connection timed out. Actual Nightly approval and payout remain user actions.
