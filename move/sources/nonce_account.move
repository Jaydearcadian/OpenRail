/// NonceAccount — per-payer replay & concurrency control for V1.2 public writes.
///
/// A payer creates one shared NonceAccount and reuses it across every channel open.
/// Each "lane" (nonce_channel) carries an independent monotonic counter (nonce_value),
/// so concurrent workflows advance without colliding. An open consumes the expected
/// next value for its lane and increments it; replaying the same (lane, value) — or
/// presenting a stale value — aborts the whole transaction, so no signed intent can be
/// replayed and a failed validation never advances the lane.
///
/// Lanes map naturally onto V2 Conduits (workflow boundaries), but here they are a thin
/// replay/sequence primitive only.
module open_rails::nonce_account {
    use sui::object::{Self, UID};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;
    use sui::table::{Self, Table};

    // --- Errors ---
    const E_WRONG_PAYER: u64    = 401;
    const E_NONCE_MISMATCH: u64 = 402;

    /// Authoritative on-chain next-nonce state for a single payer.
    public struct NonceAccount has key {
        id: UID,
        payer: address,
        lanes: Table<u64, u64>,   // nonce_channel -> next expected nonce_value
    }

    /// Create and share the caller's NonceAccount. One per payer; reused across opens.
    public entry fun create_nonce_account(ctx: &mut TxContext) {
        let account = NonceAccount {
            id: object::new(ctx),
            payer: tx_context::sender(ctx),
            lanes: table::new<u64, u64>(ctx),
        };
        transfer::share_object(account);
    }

    /// Verify the signed (nonce_channel, nonce_value) equals the lane's expected next value,
    /// then increment that lane. Aborts (reverting the whole tx) on payer mismatch or a
    /// stale/replayed value, so a failed open never advances the lane.
    public fun verify_and_consume(
        account: &mut NonceAccount,
        payer: address,
        nonce_channel: u64,
        nonce_value: u64,
    ) {
        assert!(account.payer == payer, E_WRONG_PAYER);
        let expected = next_nonce(account, nonce_channel);
        assert!(expected == nonce_value, E_NONCE_MISMATCH);

        if (table::contains(&account.lanes, nonce_channel)) {
            let slot = table::borrow_mut(&mut account.lanes, nonce_channel);
            *slot = nonce_value + 1;
        } else {
            table::add(&mut account.lanes, nonce_channel, nonce_value + 1);
        };
    }

    /// Next expected nonce value for a lane (0 if the lane has never been used).
    public fun next_nonce(account: &NonceAccount, nonce_channel: u64): u64 {
        if (table::contains(&account.lanes, nonce_channel)) {
            *table::borrow(&account.lanes, nonce_channel)
        } else {
            0
        }
    }

    // --- View helpers ---
    public fun get_payer(account: &NonceAccount): address { account.payer }
}
