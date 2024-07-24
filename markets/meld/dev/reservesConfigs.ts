import { eContractid, IReserveParams } from "../../../test/helpers/types";

import {
  rateStrategyStableTwo,
  rateStrategyStableThree,
  rateStrategyStableOne,
} from "./rateStrategies";

export const strategyDAI: IReserveParams = {
  yieldBoostEnabled: true,
  strategy: rateStrategyStableTwo,
  baseLTVAsCollateral: "7500",
  liquidationThreshold: "8000",
  liquidationBonus: "10500",
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: "18",
  mTokenImpl: eContractid.MToken,
  reserveFactor: "1000",
  supplyCapUSD: "1000000",
  borrowCapUSD: "1000000",
  flashLoanLimitUSD: "1000000",
};

export const strategyUSDC: IReserveParams = {
  yieldBoostEnabled: true,
  strategy: rateStrategyStableThree,
  baseLTVAsCollateral: "5000",
  liquidationThreshold: "5500",
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

// Not a collateral token
export const strategyUSDT: IReserveParams = {
  yieldBoostEnabled: false,
  strategy: rateStrategyStableThree,
  baseLTVAsCollateral: "0",
  liquidationThreshold: "0",
  liquidationBonus: "0",
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: "6",
  mTokenImpl: eContractid.MToken,
  reserveFactor: "1000",
  supplyCapUSD: "1000000",
  borrowCapUSD: "1000000",
  flashLoanLimitUSD: "1000000",
};

export const strategyMELD: IReserveParams = {
  yieldBoostEnabled: false,
  strategy: rateStrategyStableOne,
  baseLTVAsCollateral: "5000",
  liquidationThreshold: "5500",
  liquidationBonus: "11000",
  borrowingEnabled: false,
  stableBorrowRateEnabled: false,
  reserveDecimals: "18",
  mTokenImpl: eContractid.MToken,
  reserveFactor: "0",
  supplyCapUSD: "1000000",
  borrowCapUSD: "1000000",
  flashLoanLimitUSD: "1000000",
};
