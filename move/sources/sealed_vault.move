/// SealedVault — the on-chain primitive for RailsCard (outbound grant) flows.
///
/// The payer deposits funds and cryptographic authorization into a shared SealedVault.
/// Whoever holds a valid signed RailsCard bearer token can call unseal_and_mint,
/// which verifies the payer's signature on-chain (Ed25519 or secp256k1) and opens
/// a shared Paycard channel for the recipient — no payer involvement required at claim time.
///
/// Tier-2 gasless UX: the payer also deposits a small gas_reserve (in SUI). At unseal,
/// that reserve is dispensed to the recipient in the same transaction, so the recipient
/// is self-funded for every subsequent claim_settlement_round call. Only the single
/// unseal_and_mint call needs external gas — and that can be protocol-sponsored.
///
/// start_timestamp sentinel:
///   0         → dynamic: stream start is set to clock time at unseal (recipient gets full duration)
///   non-zero  → fixed: payer-encoded start time (stream may have partially elapsed)
module open_rails::sealed_vault {
    use sui::object::{Self, UID, ID};
    use sui::tx_context::{Self, TxContext};
    use sui::coin::{Self, Coin};
    use sui::balance::{Self, Balance};
    use sui::transfer;
    use sui::clock::{Self, Clock};
    use sui::ed25519;
    use sui::ecdsa_k1;
    use sui::bcs;
    use sui::sui::SUI;
    use open_rails::paycard_v1;
    use open_rails::events;
    use open_rails::nonce_account::{Self, NonceAccount};

    // --- Errors ---
    const EVaultAlreadyClaimed: u64 = 201;
    const EInvalidSignature: u64    = 202;
    const ENotVaultPayer: u64       = 203;

    // --- Status ---
    const STATUS_SEALED: u8  = 0;
    const STATUS_CLAIMED: u8 = 1;

    // --- Curve identifiers ---
    const CURVE_ED25519: u8    = 0;
    const CURVE_SECP256K1: u8  = 1;
    // Hash type passed to ecdsa_k1::secp256k1_verify (SHA256 = 1)
    const HASH_SHA256: u8      = 1;

    /// start_timestamp sentinel — stream starts at unseal time
    const START_DYNAMIC: u64 = 0;

    /// A funded, signed escrow object waiting for a valid recipient to claim.
    /// Shared so any address can reach it with a valid bearer token.
    public struct SealedVault<phantom T> has key {
        id: UID,
        payer: address,
        payer_pubkey: vector<u8>,         // Ed25519 (32 bytes) or secp256k1 compressed (33 bytes)
        allocation_pool: Balance<T>,
        gas_reserve: Balance<SUI>,        // Tier-2: dispensed to recipient at unseal for future gas
        max_flow_rate_per_second: u64,
        duration_seconds: u64,
        start_timestamp: u64,             // 0 = dynamic; non-zero = payer-fixed
        recovery_target: address,
        nonce: u64,                       // V1.2: nonce_value consumed from the payer's lane
        nonce_channel: u64,               // V1.2: payer nonce lane this open advanced
        curve: u8,                        // CURVE_ED25519 = 0, CURVE_SECP256K1 = 1
        metadata_hash: vector<u8>,        // V1.2: canonical product/invoice terms hash (empty = none)
        status: u8,
    }

    /// Payer deposits funds, a gas reserve, and authorization into a new SealedVault.
    /// The vault becomes a shared object reachable by any valid token holder.
    ///
    /// gas_coin / gas_amount fund the recipient's future claim gas. Pass gas_amount = 0
    /// to disable Tier-2 dispensing (recipient supplies their own gas). When T = SUI,
    /// the SDK splits a distinct gas coin object before calling — funding_coin and
    /// gas_coin must be separate objects.
    /// V1.2: the payer (sender) consumes their nonce lane at vault creation. `nonce` is the
    /// lane's expected next value; `metadata_hash` binds canonical product/invoice terms.
    /// Both are covered by the payer signature verified at unseal (see build_vault_message).
    public entry fun create_sealed_vault<T>(
        funding_coin: &mut Coin<T>,
        allocation_amount: u64,
        gas_coin: &mut Coin<SUI>,
        gas_amount: u64,
        payer_pubkey: vector<u8>,
        max_flow_rate_per_second: u64,
        duration_seconds: u64,
        start_timestamp: u64,
        recovery_target: address,
        nonce: u64,
        curve: u8,
        nonce_account: &mut NonceAccount,
        nonce_channel: u64,
        metadata_hash: vector<u8>,
        ctx: &mut TxContext
    ) {
        let payer = tx_context::sender(ctx);
        nonce_account::verify_and_consume(nonce_account, payer, nonce_channel, nonce);

        let pool = balance::split(coin::balance_mut(funding_coin), allocation_amount);
        let gas_reserve = balance::split(coin::balance_mut(gas_coin), gas_amount);

        let vault_id = object::new(ctx);
        let id_for_event = object::uid_to_inner(&vault_id);

        let vault = SealedVault<T> {
            id: vault_id,
            payer,
            payer_pubkey,
            allocation_pool: pool,
            gas_reserve,
            max_flow_rate_per_second,
            duration_seconds,
            start_timestamp,
            recovery_target,
            nonce,
            nonce_channel,
            curve,
            metadata_hash,
            status: STATUS_SEALED,
        };

        events::emit_vault_sealed(id_for_event, payer, allocation_amount, start_timestamp);
        transfer::share_object(vault);
    }

    /// Verifies the payer's signature, opens a shared Paycard channel, and dispenses
    /// the gas reserve so the recipient can fund all future claims.
    /// The message signed off-chain must match build_vault_message(vault).
    /// start_timestamp = 0 → stream starts now; non-zero → stream starts at payer's encoded time.
    /// blob_id: optional 32-byte Walrus BlobID anchored into the Paycard at mint; pass empty to skip.
    public entry fun unseal_and_mint<T>(
        vault: &mut SealedVault<T>,
        signature: vector<u8>,
        recipient: address,
        blob_id: vector<u8>,
        clock_node: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(vault.status == STATUS_SEALED, EVaultAlreadyClaimed);

        // Verify payer's signature over canonical vault parameters (curve-dispatched)
        let msg = build_vault_message(vault);
        let is_valid = if (vault.curve == CURVE_ED25519) {
            ed25519::ed25519_verify(&signature, &vault.payer_pubkey, &msg)
        } else {
            // secp256k1: compressed 33-byte pubkey, 64-byte compact sig (r+s), SHA256-hashed message
            ecdsa_k1::secp256k1_verify(&signature, &vault.payer_pubkey, &msg, HASH_SHA256)
        };
        assert!(is_valid, EInvalidSignature);

        // Resolve start time
        let actual_start = if (vault.start_timestamp == START_DYNAMIC) {
            clock::timestamp_ms(clock_node) / 1000
        } else {
            vault.start_timestamp
        };

        // Extract entire pool into Paycard
        let pool_amount = balance::value(&vault.allocation_pool);
        let pool = balance::split(&mut vault.allocation_pool, pool_amount);

        let paycard = paycard_v1::new_paycard<T>(
            vault.payer,
            recipient,
            pool,
            vault.max_flow_rate_per_second,
            actual_start,
            vault.duration_seconds,
            vault.recovery_target,
            blob_id,
            vault.metadata_hash,
            vault.nonce_channel,
            vault.nonce,
            ctx
        );

        let vault_id_for_event = object::uid_to_inner(&vault.id);
        let paycard_id = paycard_v1::get_id(&paycard);
        events::emit_vault_unsealed(vault_id_for_event, paycard_id, recipient, actual_start);

        vault.status = STATUS_CLAIMED;
        transfer::public_share_object(paycard);

        // Tier-2: dispense the gas reserve to the recipient for future claims
        let gas_value = balance::value(&vault.gas_reserve);
        if (gas_value > 0) {
            let gas_bal = balance::split(&mut vault.gas_reserve, gas_value);
            let gas_coin = coin::from_balance(gas_bal, ctx);
            transfer::public_transfer(gas_coin, recipient);
        };
    }

    /// Payer cancels an unclaimed vault and recovers the full deposit plus gas reserve.
    public entry fun cancel_vault<T>(
        vault: SealedVault<T>,
        ctx: &mut TxContext
    ) {
        assert!(tx_context::sender(ctx) == vault.payer, ENotVaultPayer);
        assert!(vault.status == STATUS_SEALED, EVaultAlreadyClaimed);

        let SealedVault {
            id,
            payer,
            payer_pubkey: _,
            allocation_pool,
            gas_reserve,
            max_flow_rate_per_second: _,
            duration_seconds: _,
            start_timestamp: _,
            recovery_target: _,
            nonce: _,
            nonce_channel: _,
            curve: _,
            metadata_hash: _,
            status: _,
        } = vault;

        let refund = balance::value(&allocation_pool);
        let id_for_event = object::uid_to_inner(&id);

        let refund_coin = coin::from_balance(allocation_pool, ctx);
        transfer::public_transfer(refund_coin, payer);

        // Return the unused gas reserve to the payer as well
        let gas_value = balance::value(&gas_reserve);
        if (gas_value > 0) {
            let gas_coin = coin::from_balance(gas_reserve, ctx);
            transfer::public_transfer(gas_coin, payer);
        } else {
            balance::destroy_zero(gas_reserve);
        };

        events::emit_vault_cancelled(id_for_event, refund);
        object::delete(id);
    }

    // --- View helpers ---
    public fun get_status<T>(vault: &SealedVault<T>): u8           { vault.status }
    public fun get_payer<T>(vault: &SealedVault<T>): address       { vault.payer }
    public fun get_pool<T>(vault: &SealedVault<T>): u64            { balance::value(&vault.allocation_pool) }
    public fun get_gas_reserve<T>(vault: &SealedVault<T>): u64     { balance::value(&vault.gas_reserve) }
    public fun get_nonce<T>(vault: &SealedVault<T>): u64           { vault.nonce }
    public fun get_nonce_channel<T>(vault: &SealedVault<T>): u64   { vault.nonce_channel }
    public fun get_metadata_hash<T>(vault: &SealedVault<T>): vector<u8> { vault.metadata_hash }
    public fun get_curve<T>(vault: &SealedVault<T>): u8            { vault.curve }
    public fun get_start_timestamp<T>(vault: &SealedVault<T>): u64 { vault.start_timestamp }
    public fun status_sealed(): u8    { STATUS_SEALED }
    public fun status_claimed(): u8   { STATUS_CLAIMED }
    public fun start_dynamic(): u64   { START_DYNAMIC }
    public fun curve_ed25519(): u8    { CURVE_ED25519 }
    public fun curve_secp256k1(): u8  { CURVE_SECP256K1 }

    /// Canonical message bytes signed by the payer for vault authorization.
    /// Must match the SDK's buildVaultMessage() function exactly.
    /// V1.2 format (nonce_channel + metadata_hash appended at the end):
    ///   payer_pubkey || allocation_amount || gas_amount || max_rate || duration
    ///   || start_timestamp || recovery_target || nonce || curve
    ///   || nonce_channel || metadata_hash
    fun build_vault_message<T>(vault: &SealedVault<T>): vector<u8> {
        let mut msg = vector::empty<u8>();
        vector::append(&mut msg, vault.payer_pubkey);
        vector::append(&mut msg, bcs::to_bytes(&balance::value(&vault.allocation_pool)));
        vector::append(&mut msg, bcs::to_bytes(&balance::value(&vault.gas_reserve)));
        vector::append(&mut msg, bcs::to_bytes(&vault.max_flow_rate_per_second));
        vector::append(&mut msg, bcs::to_bytes(&vault.duration_seconds));
        vector::append(&mut msg, bcs::to_bytes(&vault.start_timestamp));
        vector::append(&mut msg, bcs::to_bytes(&vault.recovery_target));
        vector::append(&mut msg, bcs::to_bytes(&vault.nonce));
        vector::push_back(&mut msg, vault.curve);
        vector::append(&mut msg, bcs::to_bytes(&vault.nonce_channel));
        vector::append(&mut msg, vault.metadata_hash);
        msg
    }
}
