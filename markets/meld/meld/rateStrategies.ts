import { oneRay } from "../../../test/helpers/constants";
import { IInterestRateStrategyParams } from "../../../test/helpers/types";

export const rateStrategyStableOne: IInterestRateStrategyParams = {
  name: "rateStrategyStableOne",
  optimalUtilizationRate: oneRay.multipliedBy(0.8).toString(),
  baseVariableBorrowRate: oneRay.multipliedBy(0n).toString(),
  variableRateSlope1: oneRay.multipliedBy(0.04).toString(),
  variableRateSlope2: oneRay.multipliedBy(1).toString(),
  stableRateSlope1: "0",
  stableRateSlope2: "0",
};

export const rateStrategyStableTwo: IInterestRateStrategyParams = {
  name: "rateStrategyStableTwo",
  optimalUtilizationRate: oneRay.multipliedBy(0.8).toString(),
  baseVariableBorrowRate: oneRay.multipliedBy(0n).toString(),
  variableRateSlope1: oneRay.multipliedBy(0.04).toString(),
  variableRateSlope2: oneRay.multipliedBy(0.75).toString(),
  stableRateSlope1: oneRay.multipliedBy(0.02).toString(),
  stableRateSlope2: oneRay.multipliedBy(0.75).toString(),
};

export const rateStrategyStableThree: IInterestRateStrategyParams = {
  name: "rateStrategyStableThree",
  optimalUtilizationRate: oneRay.multipliedBy(0.9).toString(),
  baseVariableBorrowRate: oneRay.multipliedBy(0n).toString(),
  variableRateSlope1: oneRay.multipliedBy(0.04).toString(),
  variableRateSlope2: oneRay.multipliedBy(0.6).toString(),
  stableRateSlope1: oneRay.multipliedBy(0.02).toString(),
  stableRateSlope2: oneRay.multipliedBy(0.6).toString(),
};

export const rateStrategyWETH: IInterestRateStrategyParams = {
  name: "rateStrategyWETH",
  optimalUtilizationRate: oneRay.multipliedBy(0.65).toString(),
  baseVariableBorrowRate: oneRay.multipliedBy(0n).toString(),
  variableRateSlope1: oneRay.multipliedBy(0.08).toString(),
  variableRateSlope2: oneRay.multipliedBy(1).toString(),
  stableRateSlope1: oneRay.multipliedBy(0.1).toString(),
  stableRateSlope2: oneRay.multipliedBy(1).toString(),
};

export const rateStrategyMELD: IInterestRateStrategyParams = {
  name: "rateStrategyMELD",
  optimalUtilizationRate: oneRay.multipliedBy(0.45).toString(),
  baseVariableBorrowRate: "0",
  variableRateSlope1: "0",
  variableRateSlope2: "0",
  stableRateSlope1: "0",
  stableRateSlope2: "0",
};

export const rateStrategyVolatileOne: IInterestRateStrategyParams = {
  name: "rateStrategyVolatileOne",
  optimalUtilizationRate: oneRay.multipliedBy(0.45).toString(),
  baseVariableBorrowRate: oneRay.multipliedBy(0n).toString(),
  variableRateSlope1: oneRay.multipliedBy(0.07).toString(),
  variableRateSlope2: oneRay.multipliedBy(3).toString(),
  stableRateSlope1: oneRay.multipliedBy(0.1).toString(),
  stableRateSlope2: oneRay.multipliedBy(3).toString(),
};

export const rateStrategyVolatileTwo: IInterestRateStrategyParams = {
  name: "rateStrategyVolatileTwo",
  optimalUtilizationRate: oneRay.multipliedBy(0.65).toString(),
  baseVariableBorrowRate: oneRay.multipliedBy(0n).toString(),
  variableRateSlope1: oneRay.multipliedBy(0.08).toString(),
  variableRateSlope2: oneRay.multipliedBy(3).toString(),
  stableRateSlope1: oneRay.multipliedBy(0.1).toString(),
  stableRateSlope2: oneRay.multipliedBy(3).toString(),
};

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
