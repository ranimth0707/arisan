use anchor_lang::prelude::*;
use anchor_lang::system_program;

/// Every native-COOK vault in this program is a zero-data PDA owned by the
/// System program. The runtime rejects a transaction that leaves such an
/// account holding a non-zero balance below the rent-exempt minimum, so each
/// vault is seeded with exactly that minimum at creation and never spends it.
///
/// Logical balances are tracked in account state, so this floor is invisible to
/// the accounting and costs about 0.00089 COOK per vault.
pub fn vault_rent_floor() -> Result<u64> {
    Ok(Rent::get()?.minimum_balance(0))
}

/// Moves lamports out of a program-derived vault, signing with its seeds.
pub fn vault_transfer<'info>(
    system_program: &Program<'info, System>,
    vault: &SystemAccount<'info>,
    to: &AccountInfo<'info>,
    amount: u64,
    seeds: &[&[u8]],
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let signer: &[&[&[u8]]] = &[seeds];
    let cpi = CpiContext::new_with_signer(
        system_program.key(),
        system_program::Transfer {
            from: vault.to_account_info(),
            to: to.clone(),
        },
        signer,
    );
    system_program::transfer(cpi, amount)
}

/// Moves lamports from a signing wallet into a vault.
pub fn fund_vault<'info>(
    system_program: &Program<'info, System>,
    from: &Signer<'info>,
    vault: &SystemAccount<'info>,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let cpi = CpiContext::new(
        system_program.key(),
        system_program::Transfer {
            from: from.to_account_info(),
            to: vault.to_account_info(),
        },
    );
    system_program::transfer(cpi, amount)
}

/// Returns the hash of the first block produced at or after `target_slot`.
///
/// SlotHashes is far too large to deserialize inside a program, so the raw
/// layout is parsed directly: an 8-byte entry count followed by 40-byte
/// entries of (slot: u64, hash: [u8; 32]), ordered newest first.
///
/// Pinning to an exact slot would be fragile, because not every slot produces a
/// block. A skipped target slot has no hash and never will, which would strand
/// the draw permanently. Taking the earliest block at or after the target keeps
/// the same guarantee that matters: at the moment the draw was requested, the
/// chosen hash did not exist yet and could not be predicted.
pub fn slot_hash_for(sysvar: &AccountInfo, target_slot: u64) -> Option<[u8; 32]> {
    let data = sysvar.try_borrow_data().ok()?;
    if data.len() < 8 {
        return None;
    }
    let count = u64::from_le_bytes(data[0..8].try_into().ok()?) as usize;

    let mut best: Option<[u8; 32]> = None;
    for i in 0..count {
        let base = 8 + i * 40;
        if base + 40 > data.len() {
            break;
        }
        let slot = u64::from_le_bytes(data[base..base + 8].try_into().ok()?);
        if slot < target_slot {
            // Descending order, so everything from here on is older.
            break;
        }
        let mut hash = [0u8; 32];
        hash.copy_from_slice(&data[base + 8..base + 40]);
        best = Some(hash);
    }
    best
}

/// Reads the newest entry in SlotHashes. Good enough to vary an envelope share,
/// which is a cosmetic amount rather than a prize worth manipulating a block for.
pub fn latest_slot_hash(sysvar: &AccountInfo) -> Option<[u8; 32]> {
    let data = sysvar.try_borrow_data().ok()?;
    if data.len() < 48 {
        return None;
    }
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&data[16..48]);
    Some(hash)
}

/// Folds a slot hash together with caller-supplied context into a u64 seed.
pub fn derive_seed(slot_hash: &[u8; 32], salt: &Pubkey, nonce: u64) -> u64 {
    let digest = solana_keccak_hasher::hashv(&[slot_hash, salt.as_ref(), &nonce.to_le_bytes()]);
    let bytes = digest.to_bytes();
    u64::from_le_bytes(bytes[0..8].try_into().unwrap())
}
