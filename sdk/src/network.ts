import { WALRUS_ENDPOINTS } from "./walrus.js";

export const NETWORKS = {
  testnet: {
    rpc: "https://fullnode.testnet.sui.io:443",
    // DeepBook V3 — MystenLabs/ts-sdks packages/deepbook-v3/src/utils/constants.ts
    deepbookPackageId: "0x22be4cade64bf2d02412c7e8d0e8beea2f78828b948118d46735315409371a3c",
    deepTokenType: "0x36dbef866a1d62bf7328989a10fb2f07d769f4ee587c0de4a0a256e57e0a58a8::deep::DEEP",
    pools: {
      // Testnet has no real USDC — DeepBook uses DBUSDC as the test stablecoin
      suiDbusdc: "0x1c19362ca52b8ffd7a33cee805a67d40f31e6ba303753fd3a4cfdfacea7163a5",
      deepSui:   "0x48c95963e9eac37a316b7ae04a0deb761bcdcc2b67912374d6036e7f0e9bae9f",
    },
    coinTypes: {
      DEEP:   "0x36dbef866a1d62bf7328989a10fb2f07d769f4ee587c0de4a0a256e57e0a58a8::deep::DEEP",
      DBUSDC: "0xf7152c05930480cd740d7311b5b8b45c6f488e3a53a11c3f74a6fac36a52e0d7::DBUSDC::DBUSDC",
    },
    walrus: WALRUS_ENDPOINTS.testnet,
  },
  mainnet: {
    rpc: "https://fullnode.mainnet.sui.io:443",
    deepbookPackageId: "0x0e735f8c93a95722efd73521aca7a7652c0bb71ed1daf41b26dfd7d1ff71f748",
    deepTokenType: "0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP",
    pools: {
      suiUsdc: "0xe05dafb5133bcffb8d59f4e12465dc0e9faeaa05e3e342a08fe135800e3e4407",
      deepSui: "0xb663828d6217467c8a1838a03793da896cbe745b150ebd57d82f814ca579fc22",
    },
    coinTypes: {
      DEEP: "0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP",
      USDC: "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
    },
    walrus: WALRUS_ENDPOINTS.mainnet,
  },
} as const;

export type Network = keyof typeof NETWORKS;

export const DEFAULT_NETWORK: Network = "testnet";

export const SUI_CLOCK_ID = "0x6";

export const COIN_TYPES = {
  SUI:          "0x2::sui::SUI",
  USDC:         "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
  DEEP_MAINNET: "0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP",
  DEEP_TESTNET: "0x36dbef866a1d62bf7328989a10fb2f07d769f4ee587c0de4a0a256e57e0a58a8::deep::DEEP",
  DBUSDC:       "0xf7152c05930480cd740d7311b5b8b45c6f488e3a53a11c3f74a6fac36a52e0d7::DBUSDC::DBUSDC",
} as const;
