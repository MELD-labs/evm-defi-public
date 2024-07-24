import { oneRay } from "../../../test/helpers/constants";
import { IInterestRateStrategyParams } from "../../../test/helpers/types";
import "../../../test/helpers/utils/math";

// BUSD SUSD
export const rateStrategyStableOne: IInterestRateStrategyParams = {
  name: "rateStrategyStableOne",
  optimalUtilizationRate: oneRay.multipliedBy(0.8).toString(),
  baseVariableBorrowRate: oneRay.multipliedBy(0n).toString(),
  variableRateSlope1: oneRay.multipliedBy(0.04).toString(),
  variableRateSlope2: oneRay.multipliedBy(1).toString(),
  stableRateSlope1: "0",
  stableRateSlope2: "0",
};

// DAI TUSD
export const rateStrategyStableTwo: IInterestRateStrategyParams = {
  name: "rateStrategyStableTwo",
  optimalUtilizationRate: oneRay.multipliedBy(0.8).toString(),
  baseVariableBorrowRate: oneRay.multipliedBy(0n).toString(),
  variableRateSlope1: oneRay.multipliedBy(0.04).toString(),
  variableRateSlope2: oneRay.multipliedBy(0.75).toString(),
  stableRateSlope1: oneRay.multipliedBy(0.02).toString(),
  stableRateSlope2: oneRay.multipliedBy(0.75).toString(),
};

// USDC USDT
export const rateStrategyStableThree: IInterestRateStrategyParams = {
  name: "rateStrategyStableThree",
  optimalUtilizationRate: oneRay.multipliedBy(0.9).toString(),
  baseVariableBorrowRate: oneRay.multipliedBy(0n).toString(),
  variableRateSlope1: oneRay.multipliedBy(0.04).toString(),
  variableRateSlope2: oneRay.multipliedBy(0.6).toString(),
  stableRateSlope1: oneRay.multipliedBy(0.02).toString(),
  stableRateSlope2: oneRay.multipliedBy(0.6).toString(),
};

// WETH
export const rateStrategyWETH: IInterestRateStrategyParams = {
  name: "rateStrategyWETH",
  optimalUtilizationRate: oneRay.multipliedBy(0.65).toString(),
  baseVariableBorrowRate: oneRay.multipliedBy(0n).toString(),
  variableRateSlope1: oneRay.multipliedBy(0.08).toString(),
  variableRateSlope2: oneRay.multipliedBy(1).toString(),
  stableRateSlope1: oneRay.multipliedBy(0.1).toString(),
  stableRateSlope2: oneRay.multipliedBy(1).toString(),
};

// MELD
export const rateStrategyMELD: IInterestRateStrategyParams = {
  name: "rateStrategyMELD",
  optimalUtilizationRate: oneRay.multipliedBy(0.45).toString(),
  baseVariableBorrowRate: "0",
  variableRateSlope1: "0",
  variableRateSlope2: "0",
  stableRateSlope1: "0",
  stableRateSlope2: "0",
};

// BAT ENJ LINK MANA MKR REN YFI ZRX
export const rateStrategyVolatileOne: IInterestRateStrategyParams = {
  name: "rateStrategyVolatileOne",
  optimalUtilizationRate: oneRay.multipliedBy(0.45).toString(),
  baseVariableBorrowRate: oneRay.multipliedBy(0n).toString(),
  variableRateSlope1: oneRay.multipliedBy(0.07).toString(),
  variableRateSlope2: oneRay.multipliedBy(3).toString(),
  stableRateSlope1: oneRay.multipliedBy(0.1).toString(),
  stableRateSlope2: oneRay.multipliedBy(3).toString(),
};

// KNC WBTC
export const rateStrategyVolatileTwo: IInterestRateStrategyParams = {
  name: "rateStrategyVolatileTwo",
  optimalUtilizationRate: oneRay.multipliedBy(0.65).toString(),
  baseVariableBorrowRate: oneRay.multipliedBy(0n).toString(),
  variableRateSlope1: oneRay.multipliedBy(0.08).toString(),
  variableRateSlope2: oneRay.multipliedBy(3).toString(),
  stableRateSlope1: oneRay.multipliedBy(0.1).toString(),
  stableRateSlope2: oneRay.multipliedBy(3).toString(),
};

// SNX
export const rateStrategyVolatileThree: IInterestRateStrategyParams = {
  name: "rateStrategyVolatileThree",
  optimalUtilizationRate: oneRay.multipliedBy(0.65).toString(),
  baseVariableBorrowRate: oneRay.multipliedBy(0n).toString(),
  variableRateSlope1: oneRay.multipliedBy(0.08).toString(),
  variableRateSlope2: oneRay.multipliedBy(3).toString(),
  stableRateSlope1: oneRay.multipliedBy(0.1).toString(),
  stableRateSlope2: oneRay.multipliedBy(3).toString(),
};

export const rateStrategyVolatileFour: IInterestRateStrategyParams = {
  name: "rateStrategyVolatileFour",
  optimalUtilizationRate: oneRay.multipliedBy(0.45).toString(),
  baseVariableBorrowRate: "0",
  variableRateSlope1: oneRay.multipliedBy(0.07).toString(),
  variableRateSlope2: oneRay.multipliedBy(3).toString(),
  stableRateSlope1: "0",
  stableRateSlope2: "0",
};