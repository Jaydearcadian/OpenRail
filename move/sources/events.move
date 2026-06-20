module open_rails::events {
    use sui::object::ID;
    use sui::event;

    public struct PaycardMinted has copy, drop {
        paycard_id: ID,
        payer: address,
        recipient: address,
        amount: u64,
        max_flow_rate_per_second: u64,
        start_timestamp: u64,
        duration_seconds: u64,
        residual_delta_recipient: address,
    }

    public struct SettlementClaimed has copy, drop {
        paycard_id: ID,
        amount: u64,
        timestamp: u64,
    }

    public struct ResidualDeltaReturned has copy, drop {
        paycard_id: ID,
        amount: u64,
        recovery_target: address,
    }

    public struct PaycardCancelled has copy, drop {
        paycard_id: ID,
        payer: address,
        recipient: address,
        accrued_paid: u64,
        refund: u64,
        timestamp: u64,
    }

    public struct BlobIdAnchored has copy, drop {
        paycard_id: ID,
        blob_id: vector<u8>,
    }

    /// V1.2: emitted at mint when a channel binds a canonical product/invoice metadata hash
    /// under a nonce lane. Ties the on-chain channel to off-chain product receipt terms.
    public struct ChannelMetadataAnchored has copy, drop {
        paycard_id: ID,
        metadata_hash: vector<u8>,
        nonce_channel: u64,
        nonce_value: u64,
    }

    public fun emit_minted(
        paycard_id: ID,
        payer: address,
        recipient: address,
        amount: u64,
        max_flow_rate_per_second: u64,
        start_timestamp: u64,
        duration_seconds: u64,
        residual_delta_recipient: address,
    ) {
        event::emit(PaycardMinted {
            paycard_id,
            payer,
            recipient,
            amount,
            max_flow_rate_per_second,
            start_timestamp,
            duration_seconds,
            residual_delta_recipient,
        });
    }

    public fun emit_claimed(paycard_id: ID, amount: u64, timestamp: u64) {
        event::emit(SettlementClaimed { paycard_id, amount, timestamp });
    }

    public fun emit_residual_returned(paycard_id: ID, amount: u64, recovery_target: address) {
        event::emit(ResidualDeltaReturned { paycard_id, amount, recovery_target });
    }

    public fun emit_cancelled(
        paycard_id: ID,
        payer: address,
        recipient: address,
        accrued_paid: u64,
        refund: u64,
        timestamp: u64,
    ) {
        event::emit(PaycardCancelled { paycard_id, payer, recipient, accrued_paid, refund, timestamp });
    }

    public fun emit_blob_anchored(paycard_id: ID, blob_id: vector<u8>) {
        event::emit(BlobIdAnchored { paycard_id, blob_id });
    }

    public fun emit_channel_metadata_anchored(
        paycard_id: ID,
        metadata_hash: vector<u8>,
        nonce_channel: u64,
        nonce_value: u64,
    ) {
        event::emit(ChannelMetadataAnchored { paycard_id, metadata_hash, nonce_channel, nonce_value });
    }

    // --- Settlement types ---
    const SETTLEMENT_DEPLETED:  u8 = 0;
    const SETTLEMENT_EXPIRED:   u8 = 1;
    const SETTLEMENT_CANCELLED: u8 = 2;

    /// Emitted once at every terminal Paycard state — the canonical audit-log entry.
    /// settlement_type: 0=depleted, 1=expired, 2=cancelled
    /// total_paid_to_recipient + residual_returned_to_payer == initial_allocation (value-conserving)
    public struct SettlementReceipt has copy, drop {
        paycard_id:                 ID,
        payer:                      address,
        recipient:                  address,
        initial_allocation:          u64,
        max_flow_rate_per_second:    u64,
        start_timestamp:             u64,
        duration_seconds:            u64,
        residual_delta_recipient:    address,
        residual_delta_amount:       u64,
        total_paid_to_recipient:    u64,
        residual_returned_to_payer: u64,
        settlement_type:            u8,
        closed_at_seconds:          u64,
    }

    public fun emit_settlement_receipt(
        paycard_id:                 ID,
        payer:                      address,
        recipient:                  address,
        initial_allocation:          u64,
        max_flow_rate_per_second:    u64,
        start_timestamp:             u64,
        duration_seconds:            u64,
        residual_delta_recipient:    address,
        residual_delta_amount:       u64,
        total_paid_to_recipient:    u64,
        residual_returned_to_payer: u64,
        settlement_type:            u8,
        closed_at_seconds:          u64,
    ) {
        event::emit(SettlementReceipt {
            paycard_id,
            payer,
            recipient,
            initial_allocation,
            max_flow_rate_per_second,
            start_timestamp,
            duration_seconds,
            residual_delta_recipient,
            residual_delta_amount,
            total_paid_to_recipient,
            residual_returned_to_payer,
            settlement_type,
            closed_at_seconds,
        });
    }

    public fun settlement_type_depleted():  u8 { SETTLEMENT_DEPLETED  }
    public fun settlement_type_expired():   u8 { SETTLEMENT_EXPIRED   }
    public fun settlement_type_cancelled(): u8 { SETTLEMENT_CANCELLED }

    public struct VaultSealed has copy, drop {
        vault_id: ID,
        payer: address,
        amount: u64,
        start_timestamp: u64,   // 0 = dynamic at unseal; non-zero = payer-fixed
    }

    public struct VaultUnsealed has copy, drop {
        vault_id: ID,
        paycard_id: ID,
        recipient: address,
        actual_start: u64,
    }

    public struct VaultCancelled has copy, drop {
        vault_id: ID,
        refund: u64,
    }

    public fun emit_vault_sealed(vault_id: ID, payer: address, amount: u64, start_timestamp: u64) {
        event::emit(VaultSealed { vault_id, payer, amount, start_timestamp });
    }

    public fun emit_vault_unsealed(vault_id: ID, paycard_id: ID, recipient: address, actual_start: u64) {
        event::emit(VaultUnsealed { vault_id, paycard_id, recipient, actual_start });
    }

    public fun emit_vault_cancelled(vault_id: ID, refund: u64) {
        event::emit(VaultCancelled { vault_id, refund });
    }
}
