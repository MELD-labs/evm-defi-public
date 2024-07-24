import { IMeldConfiguration } from "../../../test/helpers/types";

import {
  strategyDAI,
  strategyUSDC,
  strategyUSDT,
  strategyMELD,
} from "./reservesConfigs";
import { oneRay, _1e18 } from "../../../test/helpers/constants";

import "../../../test/helpers/utils/math";

// ----------------
// POOL--SPECIFIC PARAMS
// ----------------

export const MeldConfig: IMeldConfiguration = {
  MarketId: "Meld genesis market",
  MTokenNamePrefix: "Meld interest bearing",
  StableDebtTokenNamePrefix: "Meld stable debt bearing",
  VariableDebtTokenNamePrefix: "Meld variable debt bearing",
  SymbolPrefix: "m",
  OracleQuoteCurrency: "USD",
  OracleQuoteUnit: _1e18.toString(),
  ReservesConfig: {
    MELD: strategyMELD,
    USDC: strategyUSDC,
    USDT: strategyUSDT,
    DAI: strategyDAI,
  },
  ReserveAssets: {
    // These are the mock token addresses. They are always the same
    MELD: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
    USDC: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    USDT: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
    DAI: "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
  },

  LendingRateOracleRatesCommon: {
    MELD: {
      borrowRate: oneRay.multipliedBy(0.03).toString(),
    },
    USDC: {
      borrowRate: oneRay.multipliedBy(0.039).toString(),
    },
    USDT: {
      borrowRate: oneRay.multipliedBy(0.035).toString(),
    },
    DAI: {
      borrowRate: oneRay.multipliedBy(0.039).toString(),
    },
  },

  Mocks: {
    AllAssetsInitialPrices: {
      // Only setting prices for assets that are used in unit tests
      MELD: ((_1e18 * 83n) / 100n).toString(), // $0.83
      USDC: _1e18.toString(),
      USDT: _1e18.toString(),
      DAI: _1e18.toString(),
    },
  },

  SupraPricePairPaths: {
    MELD: [153, 48],
    USDC: [47, 48],
    USDT: [48],
    DAI: [54],
  },

  ReserveFactorTreasuryAddress: "0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199",
  SupraOracleFeedAddress: "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707",
  MeldStakingStorageAddress: "0x0165878A594ca255338adfa4d48449f69242Eb8F",
  MeldBankerNFTAddress: "0x9d4454B023096f34B160D6B654540c56A1F81688",
};

export default MeldConfig;
