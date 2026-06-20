#[test_only]
module open_rails::nonce_account_tests {
    use sui::test_scenario::{Self as ts};
    use open_rails::nonce_account::{Self, NonceAccount};

    const PAYER: address    = @0xA;
    const STRANGER: address = @0xD;

    fun create(scenario: &mut ts::Scenario) {
        ts::next_tx(scenario, PAYER);
        { nonce_account::create_nonce_account(ts::ctx(scenario)); };
    }

    #[test]
    fun test_fresh_lane_starts_at_zero() {
        let mut scenario = ts::begin(PAYER);
        create(&mut scenario);
        ts::next_tx(&mut scenario, PAYER);
        {
            let acct = ts::take_shared<NonceAccount>(&scenario);
            assert!(nonce_account::next_nonce(&acct, 0) == 0, 0);
            assert!(nonce_account::next_nonce(&acct, 99) == 0, 0);
            assert!(nonce_account::get_payer(&acct) == PAYER, 0);
            ts::return_shared(acct);
        };
        ts::end(scenario);
    }

    #[test]
    fun test_consume_advances_lane() {
        let mut scenario = ts::begin(PAYER);
        create(&mut scenario);
        ts::next_tx(&mut scenario, PAYER);
        {
            let mut acct = ts::take_shared<NonceAccount>(&scenario);
            nonce_account::verify_and_consume(&mut acct, PAYER, 0, 0);
            assert!(nonce_account::next_nonce(&acct, 0) == 1, 0);
            nonce_account::verify_and_consume(&mut acct, PAYER, 0, 1);
            assert!(nonce_account::next_nonce(&acct, 0) == 2, 0);
            ts::return_shared(acct);
        };
        ts::end(scenario);
    }

    #[test]
    fun test_lanes_advance_independently() {
        let mut scenario = ts::begin(PAYER);
        create(&mut scenario);
        ts::next_tx(&mut scenario, PAYER);
        {
            let mut acct = ts::take_shared<NonceAccount>(&scenario);
            nonce_account::verify_and_consume(&mut acct, PAYER, 0, 0);
            // lane 7 is untouched by advancing lane 0
            assert!(nonce_account::next_nonce(&acct, 7) == 0, 0);
            nonce_account::verify_and_consume(&mut acct, PAYER, 7, 0);
            assert!(nonce_account::next_nonce(&acct, 7) == 1, 0);
            assert!(nonce_account::next_nonce(&acct, 0) == 1, 0);
            ts::return_shared(acct);
        };
        ts::end(scenario);
    }

    // Replaying a consumed value aborts — the core replay-protection guarantee.
    #[test]
    #[expected_failure(abort_code = open_rails::nonce_account::E_NONCE_MISMATCH)]
    fun test_replay_aborts() {
        let mut scenario = ts::begin(PAYER);
        create(&mut scenario);
        ts::next_tx(&mut scenario, PAYER);
        {
            let mut acct = ts::take_shared<NonceAccount>(&scenario);
            nonce_account::verify_and_consume(&mut acct, PAYER, 0, 0);
            nonce_account::verify_and_consume(&mut acct, PAYER, 0, 0); // expected 1, got 0 → abort
            ts::return_shared(acct);
        };
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = open_rails::nonce_account::E_WRONG_PAYER)]
    fun test_wrong_payer_aborts() {
        let mut scenario = ts::begin(PAYER);
        create(&mut scenario);
        ts::next_tx(&mut scenario, PAYER);
        {
            let mut acct = ts::take_shared<NonceAccount>(&scenario);
            nonce_account::verify_and_consume(&mut acct, STRANGER, 0, 0);
            ts::return_shared(acct);
        };
        ts::end(scenario);
    }
}
