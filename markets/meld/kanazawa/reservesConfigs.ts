import { eContractid, IReserveParams } from "../../../test/helpers/types";

import {
  rateStrategyStableTwo,
  rateStrategyStableThree,
  rateStrategyVolatileOne,
} from "./rateStrategies";

export const strategyUSDT: IReserveParams = {
  yieldBoostEnabled: false,
  strategy: rateStrategyStableTwo,
  baseLTVAsCollateral: "7500",
  liquidationThreshold: "8000",
  liquidationBonus: "10500",
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: "6",
  mTokenImpl: eContractid.MToken,
  reserveFactor: "1000",
  supplyCapUSD: "1000000",
  borrowCapUSD: "1000000",
  flashLoanLimitUSD: "1000000",
};

export const strategyUSDC: IReserveParams = {
  yieldBoostEnabled: false,
  strategy: rateStrategyStableTwo,
  baseLTVAsCollateral: "7500",
  liquidationThreshold: "8000",
  liquidationBonus: "10500",
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: "6",
  mTokenImpl: eContractid.MToken,
  reserveFactor: "1000",
  supplyCapUSD: "2000000",
  borrowCapUSD: "2000000",
  flashLoanLimitUSD: "2000000",
};

export const strategyWBTC: IReserveParams = {
  yieldBoostEnabled: false,
  strategy: rateStrategyStableThree,
  baseLTVAsCollateral: "7000",
  liquidationThreshold: "7500",
  liquidationBonus: "12000",
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: "8",
  mTokenImpl: eContractid.MToken,
  reserveFactor: "2000",
  supplyCapUSD: "2000000",
  borrowCapUSD: "2000000",
  flashLoanLimitUSD: "2000000",
};

export const strategyWETH: IReserveParams = {
  yieldBoostEnabled: false,
  strategy: rateStrategyStableThree,
  baseLTVAsCollateral: "7000",
  liquidationThreshold: "7250",
  liquidationBonus: "11500",
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: "18",
  mTokenImpl: eContractid.MToken,
  reserveFactor: "1255",
  supplyCapUSD: "5000000",
  borrowCapUSD: "5000000",
  flashLoanLimitUSD: "5000000",
};

export const strategyMELD: IReserveParams = {
  yieldBoostEnabled: false,
  strategy: rateStrategyVolatileOne,
  baseLTVAsCollateral: "6000",
  liquidationThreshold: "7000",
  liquidationBonus: "11000",
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: "18",
  mTokenImpl: eContractid.MToken,
  reserveFactor: "1500",
  supplyCapUSD: "1000000",
  borrowCapUSD: "1000000",
  flashLoanLimitUSD: "1000000",
};

export const strategyWAVAX: IReserveParams = {
  yieldBoostEnabled: false,
  strategy: rateStrategyStableTwo,
  baseLTVAsCollateral: "7000",
  liquidationThreshold: "7500",
  liquidationBonus: "11000",
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: "18",
  mTokenImpl: eContractid.MToken,
  reserveFactor: "2000",
  supplyCapUSD: "1000000",
  borrowCapUSD: "1000000",
  flashLoanLimitUSD: "1000000",
};

export const strategyADA: IReserveParams = {
  yieldBoostEnabled: false,
  strategy: rateStrategyStableTwo,
  baseLTVAsCollateral: "7000",
  liquidationThreshold: "7500",
  liquidationBonus: "11250",
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: "6",
  mTokenImpl: eContractid.MToken,
  reserveFactor: "1500",
  supplyCapUSD: "1000000",
  borrowCapUSD: "1000000",
  flashLoanLimitUSD: "1000000",
};

export const strategyWAVAXYieldBoost: IReserveParams = {
  yieldBoostEnabled: true,
  strategy: rateStrategyStableTwo,
  baseLTVAsCollateral: "7000",
  liquidationThreshold: "7500",
  liquidationBonus: "11000",
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: "18",
  mTokenImpl: eContractid.MToken,
  reserveFactor: "2000",
  supplyCapUSD: "1000000",
  borrowCapUSD: "1000000",
  flashLoanLimitUSD: "1000000",
};

export const strategyADAYieldBoost: IReserveParams = {
  yieldBoostEnabled: true,
  strategy: rateStrategyStableTwo,
  baseLTVAsCollateral: "7000",
  liquidationThreshold: "7500",
  liquidationBonus: "11250",
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: "6",
  mTokenImpl: eContractid.MToken,
  reserveFactor: "1500",
  supplyCapUSD: "1000000",
  borrowCapUSD: "1000000",
  flashLoanLimitUSD: "1000000",
};
