import { IMeldConfiguration } from "../../../test/helpers/types";

import {
  strategyUSDC,
  strategyUSDT,
  strategyMELD,
  strategyWBTC,
  strategyWETH,
  strategyWAVAX,
  strategyADA,
  strategyWAVAXYieldBoost,
  strategyADAYieldBoost,
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
    tUSDC: strategyUSDC,
    tUSDT: strategyUSDT,
    twBTC: strategyWBTC,
    twETH: strategyWETH,
    twAVAX: strategyWAVAX,
    tADA: strategyADA,
    AVAX: strategyWAVAXYieldBoost,
    ADA: strategyADAYieldBoost,
  },
  ReserveAssets: {
    MELD: "0x22200025a5bC2C7dA9C8Ed6c051A58E12EfA7501",
    tUSDC: "0x000000a3b29aa88C2086a4893408e3Df2aBc80eB",
    tUSDT: "0x111111abd9aef0413C2c8792803C68C6CBaa1BA2",
    twBTC: "0x333333Cf89D3FBbdDf44423c7e9251463b866Bcb",
    twETH: "0x222222A36B054B4067Eb52258797D922e9b44C28",
    twAVAX: "0x666666fa5Bec39Bbd0bE9158e51BC316428d0075",
    tADA: "0x9999998E5D8a3433b3ec639B4559C61D72b2A43b",
    AVAX: "0x96c650046EbE8fc99B19Bed26f6B8Bb88fDFd648",
    ADA: "0x7642c74aF49ca39B8C92243C868A5dbd17c51952",
  },
  LendingRateOracleRatesCommon: {
    MELD: {
      borrowRate: "0",
    },
    tUSDC: {
      borrowRate: "0",
    },
    tUSDT: {
      borrowRate: "0",
    },
    twBTC: {
      borrowRate: "0",
    },
    twETH: {
      borrowRate: "0",
    },
    twAVAX: {
      borrowRate: "0",
    },
    tADA: {
      borrowRate: "0",
    },
    AVAX: {
      borrowRate: "0",
    },
    ADA: {
      borrowRate: "0",
    },
  },
  Mocks: {
    AllAssetsInitialPrices: {
      // Only setting prices for assets that are used in testnet
      MELD: ((_1e18 * 175n) / 10000n).toString(), // $0.0175
      tUSDC: _1e18.toString(),
      tUSDT: _1e18.toString(),
      twBTC: ((_1e18 * 5349979n) / 100n).toString(), // $53,499.79
      twETH: ((_1e18 * 314770n) / 100n).toString(), // $3137.70
      twAVAX: ((_1e18 * 4355n) / 100n).toString(), // $43.55
      tADA: ((_1e18 * 7369n) / 10000n).toString(), // $0.7369
      AVAX: ((_1e18 * 4355n) / 100n).toString(), // $43.55    // this is the symbol returned by the contract at the address configured for twAVAXYieldBoost above. Symbol has to match actual symbol returned by the contract.
      ADA: ((_1e18 * 7369n) / 10000n).toString(), // $0.7369  // this is the symbol returned by the contract at the address configured for tADAYieldBoost above. Symbol has to match actual symbol returned by the contract.
    },
  },
  SupraPricePairPaths: {
    MELD: [153, 48],
    tUSDC: [47, 48],
    tUSDT: [48],
    twBTC: [0, 48],
    twETH: [1, 48],
    twAVAX: [5, 48],
    tADA: [16, 48],
    AVAX: [5, 48], // this is the symbol returned by the contract at the address configured for twAVAXYieldBoost above. Symbol has to match actual symbol returned by the contract.
    ADA: [16, 48], // this is the symbol returned by the contract at the address configured for tADAYieldBoost above. Symbol has to match actual symbol returned by the contract.
  },
  ReserveFactorTreasuryAddress: "0x33333506a912F2602Ff41368aE19db239E7DF184",
  SupraOracleFeedAddress: "0x8D53f34C06A873dA78B39f87cbBeCCdc8c31ACc0",
  MeldStakingStorageAddress: "0xcC7Ae6Bf1a72270243eEA35650F3c629D34b3dc0",
  MeldBankerNFTAddress: "0xd6Dc78A2A2c3CDb40f29d3A2EE2ce55E3748c6ff", // For kanazawa STAGING env. Make sure to update this address for future deployments
};

export default MeldConfig;
