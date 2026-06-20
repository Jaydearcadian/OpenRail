module open_rails::paycard_v1 {
    use sui::object::{Self, UID, ID};
    use sui::tx_context::{Self, TxContext};
    use sui::coin::{Self, Coin};
    use sui::balance::{Self, Balance};
    use sui::transfer;
    use sui::clock::{Self, Clock};
    use open_rails::events;

    // --- Error Coding Matrix ---
    const EStreamExpired: u64          = 101;
    const EStreamNotActive: u64        = 102;
    const EChronologicalInversion: u64 = 103;
    const EZeroAccruedValue: u64       = 104;
    const ENotAuthorized: u64          = 105;
    const EBlobIdInvalidLength: u64    = 107;
    const U64_MAX: u64                 = 18446744073709551615;

    // --- Lifecycle State Constants ---
    const STATUS_ACTIVE: u8   = 0;
    const STATUS_DEPLETED: u8 = 2;
    const STATUS_CANCELLED: u8 = 3;

    /// The foundational OpenRails V1.1 Channel primitive.
    /// Shared so the recipient can claim and the payer can cancel without object handoff.
    public struct Paycard<phantom T> has key, store {
        id: UID,
        payer: address,
        recipient: address,
        allocation_pool: Balance<T>,
        initial_allocation: u64,          // locked at mint; used to compute total_paid in SettlementReceipt
        max_flow_rate_per_second: u64,
        start_timestamp: u64,
        duration_seconds: u64,
        last_checkpoint_timestamp: u64,
        residual_delta_recipient: address,
        walrus_blob_id: Option<vector<u8>>,
        status: u8,
    }

    /// Mints and funds an isolated Paycard envelope (RailsCard — outbound grant by payer).
    /// Pass an empty vector for blob_id if no Walrus metadata is needed;
    /// pass a 32-byte BlobID to anchor Walrus metadata atomically in the same transaction.
    public entry fun mint_and_fund_envelope<T>(
        funding_vault: &mut Coin<T>,
        total_provision_amount: u64,
        max_rate: u64,
        recipient: address,
        start_time: u64,
        duration: u64,
        recovery_target: address,
        blob_id: vector<u8>,
        ctx: &mut TxContext
    ) {
        let payer_address = tx_context::sender(ctx);

        let active_balance = coin::balance_mut(funding_vault);
        let isolated_pool = balance::split(active_balance, total_provision_amount);

        let walrus_blob_id = if (vector::length(&blob_id) == 0) {
            option::none()
        } else {
            assert!(vector::length(&blob_id) == 32, EBlobIdInvalidLength);
            option::some(blob_id)
        };

        let paycard_id = object::new(ctx);
        let id_for_event = object::uid_to_inner(&paycard_id);

        let paycard = Paycard<T> {
            id: paycard_id,
            payer: payer_address,
            recipient,
            allocation_pool: isolated_pool,
            initial_allocation: total_provision_amount,
            max_flow_rate_per_second: max_rate,
            start_timestamp: start_time,
            duration_seconds: duration,
            last_checkpoint_timestamp: start_time,
            residual_delta_recipient: recovery_target,
            walrus_blob_id,
            status: STATUS_ACTIVE,
        };

        events::emit_minted(
            id_for_event,
            payer_address,
            recipient,
            total_provision_amount,
            max_rate,
            start_time,
            duration,
            recovery_target,
        );
        if (option::is_some(&paycard.walrus_blob_id)) {
            events::emit_blob_anchored(id_for_event, *option::borrow(&paycard.walrus_blob_id));
        };
        transfer::share_object(paycard);
    }

    /// Computes lazily-evaluated linear accrual since last checkpoint.
    public fun calculate_accrual_debt<T>(paycard: &Paycard<T>, current_time: u64): u64 {
        if (paycard.status != STATUS_ACTIVE) { return 0 };
        if (current_time <= paycard.last_checkpoint_timestamp) { return 0 };

        let end_time = channel_end_time(paycard.start_timestamp, paycard.duration_seconds);
        let applicable_time = if (current_time > end_time) { end_time } else { current_time };

        if (applicable_time <= paycard.last_checkpoint_timestamp) { return 0 };

        let delta_time = applicable_time - paycard.last_checkpoint_timestamp;
        let pool_capacity = balance::value(&paycard.allocation_pool);
        let rate = paycard.max_flow_rate_per_second;

        if (rate == 0 || pool_capacity == 0) {
            0
        } else if (delta_time > pool_capacity / rate) {
            pool_capacity
        } else {
            delta_time * rate
        }
    }

    /// Core claim logic — computes accrual, updates state, returns coin.
    /// Non-entry: PTB-composable so the output coin can be piped into a DeepBook swap
    /// or any other PTB command within the same atomic transaction block.
    public fun execute_claim_round<T>(
        paycard: &mut Paycard<T>,
        clock_node: &Clock,
        ctx: &mut TxContext
    ): Coin<T> {
        assert!(tx_context::sender(ctx) == paycard.recipient, ENotAuthorized);

        let current_time = clock::timestamp_ms(clock_node) / 1000;
        let end_time = channel_end_time(paycard.start_timestamp, paycard.duration_seconds);

        assert!(current_time <= end_time, EStreamExpired);
        assert!(paycard.status == STATUS_ACTIVE, EStreamNotActive);
        assert!(current_time > paycard.last_checkpoint_timestamp, EChronologicalInversion);

        let accrued_debt = calculate_accrual_debt(paycard, current_time);
        assert!(accrued_debt > 0, EZeroAccruedValue);

        let id_for_event = object::uid_to_inner(&paycard.id);
        let current_pool_capacity = balance::value(&paycard.allocation_pool);

        if (accrued_debt >= current_pool_capacity) {
            let final_balance = balance::split(&mut paycard.allocation_pool, current_pool_capacity);
            events::emit_claimed(id_for_event, current_pool_capacity, current_time);
            paycard.status = STATUS_DEPLETED;
            events::emit_settlement_receipt(
                id_for_event,
                paycard.payer,
                paycard.recipient,
                paycard.initial_allocation,
                paycard.max_flow_rate_per_second,
                paycard.start_timestamp,
                paycard.duration_seconds,
                paycard.residual_delta_recipient,
                0,
                paycard.initial_allocation,  // all of it went to recipient
                0,                           // no residual — pool fully consumed
                events::settlement_type_depleted(),
                current_time,
            );
            coin::from_balance(final_balance, ctx)
        } else {
            let stream_balance = balance::split(&mut paycard.allocation_pool, accrued_debt);
            events::emit_claimed(id_for_event, accrued_debt, current_time);
            paycard.last_checkpoint_timestamp = current_time;
            coin::from_balance(stream_balance, ctx)
        }
    }

    /// Entry wrapper: claim and transfer accrued balance directly to recipient.
    /// Only the recipient may trigger a settlement claim.
    public entry fun claim_settlement_round<T>(
        paycard: &mut Paycard<T>,
        clock_node: &Clock,
        ctx: &mut TxContext
    ) {
        let coin_out = execute_claim_round(paycard, clock_node, ctx);
        transfer::public_transfer(coin_out, paycard.recipient);
    }

    /// STN-Delta expiry trigger. Sweeps unspent buffer back to recovery vault after duration closes.
    /// The Paycard owner, payer, or residual_delta_recipient may call. Idempotent if already depleted.
    public entry fun resolve_residual_delta_expiry<T>(
        paycard: &mut Paycard<T>,
        clock_node: &Clock,
        ctx: &mut TxContext
    ) {
        if (paycard.status != STATUS_ACTIVE) { return };

        let current_time = clock::timestamp_ms(clock_node) / 1000;
        let end_time = channel_end_time(paycard.start_timestamp, paycard.duration_seconds);
        assert!(current_time >= end_time, EStreamNotActive);

        let caller = tx_context::sender(ctx);
        assert!(
            caller == paycard.recipient
                || caller == paycard.payer
                || caller == paycard.residual_delta_recipient,
            ENotAuthorized
        );

        let id_for_event = object::uid_to_inner(&paycard.id);
        let accrued_debt = calculate_accrual_debt(paycard, current_time);

        if (accrued_debt > 0) {
            let accrued_balance = balance::split(&mut paycard.allocation_pool, accrued_debt);
            let accrued_coin = coin::from_balance(accrued_balance, ctx);
            transfer::public_transfer(accrued_coin, paycard.recipient);
            events::emit_claimed(id_for_event, accrued_debt, end_time);
            paycard.last_checkpoint_timestamp = end_time;
        };

        let residual_remaining = balance::value(&paycard.allocation_pool);

        if (residual_remaining > 0) {
            let residual_balance = balance::split(&mut paycard.allocation_pool, residual_remaining);
            let residual_coin = coin::from_balance(residual_balance, ctx);
            transfer::public_transfer(residual_coin, paycard.residual_delta_recipient);
            events::emit_residual_returned(id_for_event, residual_remaining, paycard.residual_delta_recipient);
        };

        paycard.status = STATUS_DEPLETED;

        let total_paid = paycard.initial_allocation - residual_remaining;
        events::emit_settlement_receipt(
            id_for_event,
            paycard.payer,
            paycard.recipient,
            paycard.initial_allocation,
            paycard.max_flow_rate_per_second,
            paycard.start_timestamp,
            paycard.duration_seconds,
            paycard.residual_delta_recipient,
            residual_remaining,
            total_paid,
            residual_remaining,
            events::settlement_type_expired(),
            current_time,
        );
    }

    /// Cancels an active Paycard before expiry, atomically paying accrued value to the recipient
    /// and routing all residual capital through STN-Delta to the recovery target.
    /// Only the original payer may cancel. Paycards are shared channels in V1.1 so the payer can
    /// exercise this path without taking ownership from the recipient.
    public entry fun cancel_paycard<T>(
        paycard: &mut Paycard<T>,
        clock_node: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(tx_context::sender(ctx) == paycard.payer, ENotAuthorized);
        let closed_at = clock::timestamp_ms(clock_node) / 1000;
        let end_time = channel_end_time(paycard.start_timestamp, paycard.duration_seconds);
        assert!(closed_at < end_time, EStreamExpired);
        assert!(paycard.status == STATUS_ACTIVE, EStreamNotActive);

        let id_for_event = object::uid_to_inner(&paycard.id);
        let accrued_debt = calculate_accrual_debt(paycard, closed_at);

        if (accrued_debt > 0) {
            let accrued_balance = balance::split(&mut paycard.allocation_pool, accrued_debt);
            let accrued_coin = coin::from_balance(accrued_balance, ctx);
            transfer::public_transfer(accrued_coin, paycard.recipient);
            events::emit_claimed(id_for_event, accrued_debt, closed_at);
            paycard.last_checkpoint_timestamp = closed_at;
        };

        let refund_amount = balance::value(&paycard.allocation_pool);
        if (refund_amount > 0) {
            let refund_balance = balance::split(&mut paycard.allocation_pool, refund_amount);
            let refund_coin = coin::from_balance(refund_balance, ctx);
            transfer::public_transfer(refund_coin, paycard.residual_delta_recipient);
            events::emit_residual_returned(id_for_event, refund_amount, paycard.residual_delta_recipient);
        };

        paycard.status = STATUS_CANCELLED;
        events::emit_cancelled(
            id_for_event,
            paycard.payer,
            paycard.recipient,
            accrued_debt,
            refund_amount,
            closed_at,
        );

        let total_paid = paycard.initial_allocation - refund_amount;
        events::emit_settlement_receipt(
            id_for_event,
            paycard.payer,
            paycard.recipient,
            paycard.initial_allocation,
            paycard.max_flow_rate_per_second,
            paycard.start_timestamp,
            paycard.duration_seconds,
            paycard.residual_delta_recipient,
            refund_amount,
            total_paid,
            refund_amount,
            events::settlement_type_cancelled(),
            closed_at,
        );
    }

    /// Internal constructor — creates and returns a Paycard without transferring it.
    /// Used by sealed_vault::unseal_and_mint to create a Paycard from a vault unsealing.
    /// Pass an empty blob_id vector for no Walrus anchoring; pass 32 bytes to anchor at mint.
    public fun new_paycard<T>(
        payer: address,
        recipient: address,
        pool: Balance<T>,
        max_rate: u64,
        start_timestamp: u64,
        duration: u64,
        recovery_target: address,
        blob_id: vector<u8>,
        ctx: &mut TxContext
    ): Paycard<T> {
        let paycard_id = object::new(ctx);
        let id_for_event = object::uid_to_inner(&paycard_id);
        let amount = balance::value(&pool);

        let walrus_blob_id = if (vector::length(&blob_id) == 0) {
            option::none()
        } else {
            assert!(vector::length(&blob_id) == 32, EBlobIdInvalidLength);
            option::some(blob_id)
        };

        let paycard = Paycard<T> {
            id: paycard_id,
            payer,
            recipient,
            allocation_pool: pool,
            initial_allocation: amount,
            max_flow_rate_per_second: max_rate,
            start_timestamp,
            duration_seconds: duration,
            last_checkpoint_timestamp: start_timestamp,
            residual_delta_recipient: recovery_target,
            walrus_blob_id,
            status: STATUS_ACTIVE,
        };

        events::emit_minted(
            id_for_event,
            payer,
            recipient,
            amount,
            max_rate,
            start_timestamp,
            duration,
            recovery_target,
        );
        if (option::is_some(&paycard.walrus_blob_id)) {
            events::emit_blob_anchored(id_for_event, *option::borrow(&paycard.walrus_blob_id));
        };
        paycard
    }

    // --- View helpers ---
    public fun get_id<T>(paycard: &Paycard<T>): ID                       { object::uid_to_inner(&paycard.id) }
    public fun get_payer<T>(paycard: &Paycard<T>): address               { paycard.payer }
    public fun get_recipient<T>(paycard: &Paycard<T>): address           { paycard.recipient }
    public fun get_status<T>(paycard: &Paycard<T>): u8                   { paycard.status }
    public fun get_pool_balance<T>(paycard: &Paycard<T>): u64            { balance::value(&paycard.allocation_pool) }
    public fun get_initial_allocation<T>(paycard: &Paycard<T>): u64      { paycard.initial_allocation }
    public fun get_flow_rate<T>(paycard: &Paycard<T>): u64               { paycard.max_flow_rate_per_second }
    public fun get_blob_id<T>(paycard: &Paycard<T>): &Option<vector<u8>> { &paycard.walrus_blob_id }
    public fun status_active(): u8   { STATUS_ACTIVE }
    public fun status_depleted(): u8 { STATUS_DEPLETED }
    public fun status_cancelled(): u8 { STATUS_CANCELLED }

    fun channel_end_time(start_timestamp: u64, duration_seconds: u64): u64 {
        if (duration_seconds > U64_MAX - start_timestamp) {
            U64_MAX
        } else {
            start_timestamp + duration_seconds
        }
    }
}
