import { eContractid, IReserveParams } from "../../../test/helpers/types";

import {
  rateStrategyStableTwo,
  rateStrategyVolatileTwo,
} from "./rateStrategies";

export const strategyUSDT: IReserveParams = {
  yieldBoostEnabled: false,
  strategy: rateStrategyStableTwo,
  baseLTVAsCollateral: "7000",
  liquidationThreshold: "8000",
  liquidationBonus: "10900",
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: "6",
  mTokenImpl: eContractid.MToken,
  reserveFactor: "1000",
  supplyCapUSD: "10000000",
  borrowCapUSD: "10000000",
  flashLoanLimitUSD: "10000000",
};

export const strategyUSDC: IReserveParams = {
  yieldBoostEnabled: false,
  strategy: rateStrategyStableTwo,
  baseLTVAsCollateral: "7000",
  liquidationThreshold: "8000",
  liquidationBonus: "10900",
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: "6",
  mTokenImpl: eContractid.MToken,
  reserveFactor: "1000",
  supplyCapUSD: "10000000",
  borrowCapUSD: "10000000",
  flashLoanLimitUSD: "10000000",
};

export const strategyWAVAX: IReserveParams = {
  yieldBoostEnabled: false,
  strategy: rateStrategyVolatileTwo,
  baseLTVAsCollateral: "5500",
  liquidationThreshold: "7000",
  liquidationBonus: "11300",
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: "18",
  mTokenImpl: eContractid.MToken,
  reserveFactor: "2000",
  supplyCapUSD: "10000000",
  borrowCapUSD: "10000000",
  flashLoanLimitUSD: "10000000",
};

export const strategyADA: IReserveParams = {
  yieldBoostEnabled: false,
  strategy: rateStrategyVolatileTwo,
  baseLTVAsCollateral: "5500",
  liquidationThreshold: "7000",
  liquidationBonus: "11300",
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: "6",
  mTokenImpl: eContractid.MToken,
  reserveFactor: "2000",
  supplyCapUSD: "10000000",
  borrowCapUSD: "10000000",
  flashLoanLimitUSD: "10000000",
};

export const strategyWBTC: IReserveParams = {
  yieldBoostEnabled: false,
  strategy: rateStrategyVolatileTwo,
  baseLTVAsCollateral: "6000",
  liquidationThreshold: "7500",
  liquidationBonus: "11300",
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: "8",
  mTokenImpl: eContractid.MToken,
  reserveFactor: "2000",
  supplyCapUSD: "10000000",
  borrowCapUSD: "10000000",
  flashLoanLimitUSD: "10000000",
};

export const strategyWETH: IReserveParams = {
  yieldBoostEnabled: false,
  strategy: rateStrategyVolatileTwo,
  baseLTVAsCollateral: "6000",
  liquidationThreshold: "7500",
  liquidationBonus: "11300",
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: "18",
  mTokenImpl: eContractid.MToken,
  reserveFactor: "2000",
  supplyCapUSD: "10000000",
  borrowCapUSD: "10000000",
  flashLoanLimitUSD: "10000000",
};

// Can be supplied but not borrowed
export const strategyMELD: IReserveParams = {
  yieldBoostEnabled: false,
  strategy: rateStrategyVolatileTwo,
  baseLTVAsCollateral: "1500",
  liquidationThreshold: "6000",
  liquidationBonus: "11500",
  borrowingEnabled: false,
  stableBorrowRateEnabled: false,
  reserveDecimals: "18",
  mTokenImpl: eContractid.MToken,
  reserveFactor: "1500",
  supplyCapUSD: "8000000",
  borrowCapUSD: "0",
  flashLoanLimitUSD: "8000000",
};

export const strategyDAI: IReserveParams = {
  yieldBoostEnabled: false,
  strategy: rateStrategyStableTwo,
  baseLTVAsCollateral: "7000",
  liquidationThreshold: "8000",
  liquidationBonus: "10900",
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: "18",
  mTokenImpl: eContractid.MToken,
  reserveFactor: "1000",
  supplyCapUSD: "10000000",
  borrowCapUSD: "10000000",
  flashLoanLimitUSD: "10000000",
};
