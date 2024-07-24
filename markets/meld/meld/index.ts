import { IMeldConfiguration } from "../../../test/helpers/types";

import {
  strategyWBTC,
  strategyUSDC,
  strategyUSDT,
  strategyMELD,
  strategyWETH,
  strategyWAVAX,
  strategyADA,
  strategyDAI,
} from "./reservesConfigs";
import { _1e18 } from "../../../test/helpers/constants";

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
    WBTC: strategyWBTC,
    WETH: strategyWETH,
    WAVAX: strategyWAVAX,
    ADA: strategyADA,
    DAI: strategyDAI,
  },
  ReserveAssets: {
    MELD: "0x333000333528b1e38884a5d1ef13615b0c17a301",
    USDC: "0x333003370a882860ec176078a8939c9a3b4bbc05",
    USDT: "0x333002599c1bad8d3861baa959d0f9e2a4d57c06",
    WBTC: "0x333008cfcbfbefffbb546abf237adc4061331c01",
    WETH: "0x33300a997ec9572dd73f311749c02e2294397c02",
    WAVAX: "0x333007314d34337d97ab1e9b42e36a8649520c03",
    ADA: "0x333000991af20009d049bab8218de04d70811c04",
    DAI: "0x3330056063933f24588bc4f6abbdc74f0f0ffc07",
  },
  LendingRateOracleRatesCommon: {
    MELD: {
      borrowRate: "0",
    },
    USDC: {
      borrowRate: "0",
    },
    USDT: {
      borrowRate: "0",
    },
    WBTC: {
      borrowRate: "0",
    },
    WETH: {
      borrowRate: "0",
    },
    WAVAX: {
      borrowRate: "0",
    },
    ADA: {
      borrowRate: "0",
    },
    DAI: {
      borrowRate: "0",
    },
  },

  Mocks: {
    AllAssetsInitialPrices: {},
  },

  SupraPricePairPaths: {
    MELD: [153, 48],
    USDC: [47, 48],
    USDT: [48],
    WBTC: [0, 48],
    WETH: [1, 48],
    WAVAX: [5, 48],
    ADA: [16, 48],
    DAI: [41, 48],
  },

  ReserveFactorTreasuryAddress: "0x303b3D643753b86F2045F08b1dF0f910F42cB200",
  SupraOracleFeedAddress: "0x3E5E89d14576cE9f20a8347aA682517fe65B4ACB",
  MeldStakingStorageAddress: "0x33300055F7c370304a8Fa14E8854D9FcB5AEefc4",
  MeldBankerNFTAddress: "", // Deploy during deployment process
};

export default MeldConfig;
