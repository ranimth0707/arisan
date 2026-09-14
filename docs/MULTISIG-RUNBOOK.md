# Multisig runbook

The protocol has two different administrative surfaces and they should not
share a hot key:

1. The program upgrade authority can change code. It must be a multisig.
2. The protocol config authority can pause the app and rotate the relayer. It
   should also be a multisig or a carefully controlled governance account.

The relayer and sponsor vault are separate operational infrastructure. They are
not a user-fund custodian, but they should not be one of the upgrade signers by
default either.

## Recommended threshold

Use **2-of-3** for the first production setup. It prevents one compromised key
from upgrading the program, while one unavailable signer does not freeze an
urgent upgrade. A **3-of-5** setup is reasonable once the team has five reliable
signers and a tested recovery process.

Avoid 3-of-3 for the program upgrade authority: one lost, unavailable, or
uncooperative key would make the program impossible to upgrade. Avoid a single
signer for material TVL. Document the signer succession plan and test key
rotation before the first deposit of meaningful value.

## Change procedure

1. Create the Squad with the selected members and threshold.
2. Add the Cookie Jar program as a managed program.
3. Transfer the program upgrade authority to the Squad address.
4. Verify on-chain that the program's upgrade authority is the Squad, not a
   deployer or laptop key.
5. Use a proposal, review window, and threshold approval for every upgrade.
6. Keep the previous binary, transaction signature, and review record so a
   failed rollout has a recoverable rollback path.

The same principle applies to the config authority, but changing that authority
requires an explicit on-chain transfer path and a known destination. Do not
guess the Squad address or execute the transfer until the three signer public
keys, threshold, and recovery owner have been confirmed.

## Current status

The deployed program upgrade authority is still the single key
`7zSgKrxUG28Bm3V7zMAPRHfUGiBvV3gFg4iqKqR93qeh`. No multisig transfer has been
executed in this change because doing so without the user's exact signer set
could lock the upgrade path permanently. The user vaults themselves are
program-controlled; the creator cannot withdraw their pot or another member's
reserve.

