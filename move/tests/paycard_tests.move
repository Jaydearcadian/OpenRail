#[test_only]
module open_rails::paycard_tests {
    use sui::test_scenario::{Self as ts};
    use sui::coin::{Self};
    use sui::clock::{Self};
    use sui::sui::SUI;
    use open_rails::paycard_v1::{Self, Paycard};

    const PAYER: address     = @0xA;
    const RECIPIENT: address = @0xB;
    const RECOVERY: address  = @0xC;
    const STRANGER: address  = @0xD;

    const RATE: u64     = 100;   // 100 units/second
    const POOL: u64     = 10000; // 10000 units total
    const DURATION: u64 = 100;   // 100 seconds → max accrual = 10000

    const START_MS: u64 = 1_000_000; // 1000 seconds in ms
    const OVERFUNDED_POOL: u64 = 12000;
    const U64_MAX: u64 = 18446744073709551615;

    // ---- Helpers ----

    fun mint_paycard(scenario: &mut ts::Scenario) {
        mint_paycard_with(scenario, POOL, RATE, DURATION);
    }

    fun mint_paycard_with(
        scenario: &mut ts::Scenario,
        pool: u64,
        rate: u64,
        duration: u64
    ) {
        ts::next_tx(scenario, PAYER);
        {
            let ctx = ts::ctx(scenario);
            let mut coin = coin::mint_for_testing<SUI>(pool * 2, ctx);
            paycard_v1::mint_and_fund_envelope<SUI>(
                &mut coin,
                pool,
                rate,
                RECIPIENT,
                START_MS / 1000,  // start_time in seconds
                duration,
                RECOVERY,
                vector::empty(),
                ctx
            );
            transfer::public_transfer(coin, PAYER);
        };
    }

    // ---- Tests ----

    #[test]
    fun test_mint_and_fund() {
        let mut scenario = ts::begin(PAYER);
        mint_paycard(&mut scenario);

        ts::next_tx(&mut scenario, RECIPIENT);
        {
            let paycard = ts::take_shared<Paycard<SUI>>(&scenario);
            assert!(paycard_v1::get_payer(&paycard) == PAYER, 0);
            assert!(paycard_v1::get_recipient(&paycard) == RECIPIENT, 0);
            assert!(paycard_v1::get_pool_balance(&paycard) == POOL, 0);
            assert!(paycard_v1::get_flow_rate(&paycard) == RATE, 0);
            assert!(paycard_v1::get_status(&paycard) == paycard_v1::status_active(), 0);
            ts::return_shared(paycard);
        };
        ts::end(scenario);
    }

    #[test]
    fun test_claim_partial() {
        let mut scenario = ts::begin(PAYER);
        mint_paycard(&mut scenario);

        ts::next_tx(&mut scenario, RECIPIENT);
        {
            let mut paycard = ts::take_shared<Paycard<SUI>>(&scenario);
            let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
            // Advance 10 seconds past start → 10 * 100 = 1000 units accrued
            clock::set_for_testing(&mut clock, START_MS + 10_000);

            paycard_v1::claim_settlement_round<SUI>(&mut paycard, &clock, ts::ctx(&mut scenario));

            assert!(paycard_v1::get_pool_balance(&paycard) == POOL - 1000, 0);
            assert!(paycard_v1::get_status(&paycard) == paycard_v1::status_active(), 0);

            clock::destroy_for_testing(clock);
            ts::return_shared(paycard);
        };
        ts::end(scenario);
    }

    #[test]
    fun test_claim_to_depletion() {
        let mut scenario = ts::begin(PAYER);
        mint_paycard(&mut scenario);

        ts::next_tx(&mut scenario, RECIPIENT);
        {
            let mut paycard = ts::take_shared<Paycard<SUI>>(&scenario);
            let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
            // Advance past full duration → full pool accrued
            clock::set_for_testing(&mut clock, START_MS + (DURATION * 1000));

            paycard_v1::claim_settlement_round<SUI>(&mut paycard, &clock, ts::ctx(&mut scenario));

            assert!(paycard_v1::get_pool_balance(&paycard) == 0, 0);
            assert!(paycard_v1::get_status(&paycard) == paycard_v1::status_depleted(), 0);

            clock::destroy_for_testing(clock);
            ts::return_shared(paycard);
        };
        ts::end(scenario);
    }

    #[test]
    fun test_accrual_caps_before_rate_overflow() {
        let mut scenario = ts::begin(PAYER);
        mint_paycard_with(&mut scenario, 10, U64_MAX, DURATION);

        ts::next_tx(&mut scenario, RECIPIENT);
        {
            let mut paycard = ts::take_shared<Paycard<SUI>>(&scenario);
            let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
            clock::set_for_testing(&mut clock, START_MS + 2_000);

            paycard_v1::claim_settlement_round<SUI>(&mut paycard, &clock, ts::ctx(&mut scenario));

            assert!(paycard_v1::get_pool_balance(&paycard) == 0, 0);
            assert!(paycard_v1::get_status(&paycard) == paycard_v1::status_depleted(), 0);

            clock::destroy_for_testing(clock);
            ts::return_shared(paycard);
        };
        ts::end(scenario);
    }

    #[test]
    fun test_cancel_by_payer() {
        let mut scenario = ts::begin(PAYER);
        mint_paycard(&mut scenario);

        ts::next_tx(&mut scenario, PAYER);
        {
            let mut paycard = ts::take_shared<Paycard<SUI>>(&scenario);
            let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
            clock::set_for_testing(&mut clock, START_MS + 5_000); // 5s into stream
            paycard_v1::cancel_paycard<SUI>(&mut paycard, &clock, ts::ctx(&mut scenario));

            assert!(paycard_v1::get_pool_balance(&paycard) == 0, 0);
            assert!(paycard_v1::get_status(&paycard) == paycard_v1::status_cancelled(), 0);

            clock::destroy_for_testing(clock);
            ts::return_shared(paycard);
        };

        ts::next_tx(&mut scenario, RECIPIENT);
        {
            let accrued_coin = ts::take_from_sender<coin::Coin<SUI>>(&scenario);
            assert!(coin::value(&accrued_coin) == 500, 0);
            transfer::public_transfer(accrued_coin, RECIPIENT);
        };

        ts::next_tx(&mut scenario, RECOVERY);
        {
            let residual_coin = ts::take_from_sender<coin::Coin<SUI>>(&scenario);
            assert!(coin::value(&residual_coin) == POOL - 500, 0);
            transfer::public_transfer(residual_coin, RECOVERY);
        };
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = open_rails::paycard_v1::ENotAuthorized)]
    fun test_cancel_unauthorized() {
        let mut scenario = ts::begin(PAYER);
        mint_paycard(&mut scenario);

        ts::next_tx(&mut scenario, STRANGER);
        {
            let mut paycard = ts::take_shared<Paycard<SUI>>(&scenario);
            let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
            clock::set_for_testing(&mut clock, START_MS + 5_000);
            // STRANGER's sender context — auth check fires before any clock use
            paycard_v1::cancel_paycard<SUI>(&mut paycard, &clock, ts::ctx(&mut scenario));
            clock::destroy_for_testing(clock);
            ts::return_shared(paycard);
        };
        ts::end(scenario);
    }

    #[test]
    fun test_resolve_expiry() {
        let mut scenario = ts::begin(PAYER);
        mint_paycard(&mut scenario);

        ts::next_tx(&mut scenario, RECIPIENT);
        {
            let mut paycard = ts::take_shared<Paycard<SUI>>(&scenario);
            let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
            // Advance past expiry
            clock::set_for_testing(&mut clock, START_MS + (DURATION + 1) * 1000);

            paycard_v1::resolve_residual_delta_expiry<SUI>(
                &mut paycard, &clock, ts::ctx(&mut scenario)
            );

            assert!(paycard_v1::get_pool_balance(&paycard) == 0, 0);
            assert!(paycard_v1::get_status(&paycard) == paycard_v1::status_depleted(), 0);

            clock::destroy_for_testing(clock);
            ts::return_shared(paycard);
        };
        ts::end(scenario);
    }

    #[test]
    fun test_resolve_expiry_returns_only_residual() {
        let mut scenario = ts::begin(PAYER);
        mint_paycard_with(&mut scenario, OVERFUNDED_POOL, RATE, DURATION);

        ts::next_tx(&mut scenario, RECIPIENT);
        {
            let mut paycard = ts::take_shared<Paycard<SUI>>(&scenario);
            let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
            clock::set_for_testing(&mut clock, START_MS + (DURATION + 1) * 1000);

            paycard_v1::resolve_residual_delta_expiry<SUI>(
                &mut paycard, &clock, ts::ctx(&mut scenario)
            );

            assert!(paycard_v1::get_pool_balance(&paycard) == 0, 0);
            assert!(paycard_v1::get_status(&paycard) == paycard_v1::status_depleted(), 0);

            clock::destroy_for_testing(clock);
            ts::return_shared(paycard);
        };

        ts::next_tx(&mut scenario, RECIPIENT);
        {
            let accrued_coin = ts::take_from_sender<coin::Coin<SUI>>(&scenario);
            assert!(coin::value(&accrued_coin) == POOL, 0);
            transfer::public_transfer(accrued_coin, RECIPIENT);
        };

        ts::next_tx(&mut scenario, RECOVERY);
        {
            let residual_coin = ts::take_from_sender<coin::Coin<SUI>>(&scenario);
            assert!(coin::value(&residual_coin) == OVERFUNDED_POOL - POOL, 0);
            transfer::public_transfer(residual_coin, RECOVERY);
        };

        ts::end(scenario);
    }

    #[test]
    fun test_resolve_expiry_after_partial_claim() {
        let mut scenario = ts::begin(PAYER);
        mint_paycard(&mut scenario);

        ts::next_tx(&mut scenario, RECIPIENT);
        {
            let mut paycard = ts::take_shared<Paycard<SUI>>(&scenario);
            let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
            clock::set_for_testing(&mut clock, START_MS + 10_000);
            paycard_v1::claim_settlement_round<SUI>(&mut paycard, &clock, ts::ctx(&mut scenario));

            clock::set_for_testing(&mut clock, START_MS + (DURATION + 1) * 1000);
            paycard_v1::resolve_residual_delta_expiry<SUI>(
                &mut paycard, &clock, ts::ctx(&mut scenario)
            );

            assert!(paycard_v1::get_pool_balance(&paycard) == 0, 0);
            assert!(paycard_v1::get_status(&paycard) == paycard_v1::status_depleted(), 0);

            clock::destroy_for_testing(clock);
            ts::return_shared(paycard);
        };

        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = open_rails::paycard_v1::EStreamNotActive)]
    fun test_resolve_before_expiry() {
        let mut scenario = ts::begin(PAYER);
        mint_paycard(&mut scenario);

        ts::next_tx(&mut scenario, RECIPIENT);
        {
            let mut paycard = ts::take_shared<Paycard<SUI>>(&scenario);
            let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
            // Still within active window — must fail
            clock::set_for_testing(&mut clock, START_MS + 5_000);

            paycard_v1::resolve_residual_delta_expiry<SUI>(
                &mut paycard, &clock, ts::ctx(&mut scenario)
            );

            clock::destroy_for_testing(clock);
            ts::return_shared(paycard);
        };
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = open_rails::paycard_v1::ENotAuthorized)]
    fun test_execute_claim_round_by_non_recipient() {
        let mut scenario = ts::begin(PAYER);
        mint_paycard(&mut scenario);

        ts::next_tx(&mut scenario, STRANGER);
        {
            let mut paycard = ts::take_shared<Paycard<SUI>>(&scenario);
            let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
            clock::set_for_testing(&mut clock, START_MS + 10_000);

            let coin_out = paycard_v1::execute_claim_round<SUI>(
                &mut paycard, &clock, ts::ctx(&mut scenario)
            );
            transfer::public_transfer(coin_out, STRANGER);

            clock::destroy_for_testing(clock);
            ts::return_shared(paycard);
        };
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = open_rails::paycard_v1::ENotAuthorized)]
    fun test_claim_by_non_recipient() {
        let mut scenario = ts::begin(PAYER);
        mint_paycard(&mut scenario);

        ts::next_tx(&mut scenario, STRANGER);
        {
            let mut paycard = ts::take_shared<Paycard<SUI>>(&scenario);
            let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
            clock::set_for_testing(&mut clock, START_MS + 10_000);

            // STRANGER calls claim — must abort ENotAuthorized
            paycard_v1::claim_settlement_round<SUI>(&mut paycard, &clock, ts::ctx(&mut scenario));

            clock::destroy_for_testing(clock);
            ts::return_shared(paycard);
        };
        ts::end(scenario);
    }
}
