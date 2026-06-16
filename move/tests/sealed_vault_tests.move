#[test_only]
module open_rails::sealed_vault_tests {
    use sui::test_scenario::{Self as ts};
    use sui::coin::{Self};
    use sui::clock::{Self};
    use sui::sui::SUI;
    use open_rails::sealed_vault::{Self, SealedVault};
    use open_rails::paycard_v1::{Self, Paycard};

    const PAYER: address     = @0xA;
    const RECIPIENT: address = @0xB;
    const STRANGER: address  = @0xD;
    const RECOVERY: address  = @0xC;

    const RATE: u64     = 100;
    const POOL: u64     = 10000;
    const DURATION: u64 = 100;
    const NONCE: u64    = 42;

    // Non-zero dummy bytes for unit tests. All-zero pubkey is the Ed25519 identity
    // element and can accidentally satisfy verification — use non-zero bytes instead.
    // Real sig verification against an actual keypair is covered by integration tests.
    fun dummy_pubkey(): vector<u8> {
        let mut pk = vector::empty<u8>();
        let mut i = 1u8;
        // bytes [1..32] — not a valid keypair, so no valid signature exists for it
        while (i <= 32) { vector::push_back(&mut pk, i); i = i + 1 };
        pk
    }

    fun dummy_sig(): vector<u8> {
        let mut sig = vector::empty<u8>();
        let mut i = 0u8;
        // all 0xff — won't satisfy Ed25519 equation for any key
        while (i < 64) { vector::push_back(&mut sig, 0xffu8); i = i + 1 };
        sig
    }

    const GAS_RESERVE: u64 = 50; // Tier-2 gas dispensed to recipient at unseal

    fun create_vault(scenario: &mut ts::Scenario) {
        ts::next_tx(scenario, PAYER);
        {
            let ctx = ts::ctx(scenario);
            let mut coin = coin::mint_for_testing<SUI>(POOL * 2, ctx);
            let mut gas_coin = coin::mint_for_testing<SUI>(GAS_RESERVE * 2, ctx);
            sealed_vault::create_sealed_vault<SUI>(
                &mut coin,
                POOL,
                &mut gas_coin,
                GAS_RESERVE,
                dummy_pubkey(),
                RATE,
                DURATION,
                0,         // START_DYNAMIC
                RECOVERY,
                NONCE,
                sealed_vault::curve_ed25519(),
                ctx
            );
            transfer::public_transfer(coin, PAYER);
            transfer::public_transfer(gas_coin, PAYER);
        };
    }

    #[test]
    fun test_vault_created_as_shared() {
        let mut scenario = ts::begin(PAYER);
        create_vault(&mut scenario);

        // Vault is shared — any address can take it
        ts::next_tx(&mut scenario, STRANGER);
        {
            let vault = ts::take_shared<SealedVault<SUI>>(&scenario);
            assert!(sealed_vault::get_status(&vault) == sealed_vault::status_sealed(), 0);
            assert!(sealed_vault::get_payer(&vault) == PAYER, 0);
            assert!(sealed_vault::get_pool(&vault) == POOL, 0);
            assert!(sealed_vault::get_gas_reserve(&vault) == GAS_RESERVE, 0);
            assert!(sealed_vault::get_nonce(&vault) == NONCE, 0);
            assert!(sealed_vault::get_curve(&vault) == sealed_vault::curve_ed25519(), 0);
            assert!(sealed_vault::get_start_timestamp(&vault) == sealed_vault::start_dynamic(), 0);
            ts::return_shared(vault);
        };
        ts::end(scenario);
    }

    // Verifies that unseal_and_mint rejects a bad signature (all-zero bytes).
    // A valid sig requires actual Ed25519 key material — covered in integration tests.
    #[test]
    #[expected_failure(abort_code = open_rails::sealed_vault::EInvalidSignature)]
    fun test_unseal_rejects_invalid_signature() {
        let mut scenario = ts::begin(PAYER);
        create_vault(&mut scenario);

        ts::next_tx(&mut scenario, RECIPIENT);
        {
            let mut vault = ts::take_shared<SealedVault<SUI>>(&scenario);
            let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
            clock::set_for_testing(&mut clock, 5_000); // T=5s

            sealed_vault::unseal_and_mint<SUI>(
                &mut vault,
                dummy_sig(),
                RECIPIENT,
                vector::empty(),  // no Walrus blob
                &clock,
                ts::ctx(&mut scenario)
            );

            clock::destroy_for_testing(clock);
            ts::return_shared(vault);
        };
        ts::end(scenario);
    }

    #[test]
    fun test_cancel_vault_by_payer() {
        let mut scenario = ts::begin(PAYER);
        create_vault(&mut scenario);

        ts::next_tx(&mut scenario, PAYER);
        {
            let vault = ts::take_shared<SealedVault<SUI>>(&scenario);
            sealed_vault::cancel_vault<SUI>(vault, ts::ctx(&mut scenario));
            // vault consumed — refund coin now in PAYER's hands
        };
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = open_rails::sealed_vault::ENotVaultPayer)]
    fun test_cancel_vault_unauthorized() {
        let mut scenario = ts::begin(PAYER);
        create_vault(&mut scenario);

        ts::next_tx(&mut scenario, STRANGER);
        {
            let vault = ts::take_shared<SealedVault<SUI>>(&scenario);
            sealed_vault::cancel_vault<SUI>(vault, ts::ctx(&mut scenario));
        };
        ts::end(scenario);
    }

    #[test]
    fun test_dynamic_start_timestamp_is_zero() {
        // Confirms the sentinel value contract: start_dynamic() == 0
        assert!(sealed_vault::start_dynamic() == 0, 0);
    }
}
