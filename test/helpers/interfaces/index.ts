import { Contract } from "ethers";

export interface UserReserveData {
  scaledMTokenBalance: bigint;
  currentMTokenBalance: bigint;
  currentStableDebt: bigint;
  currentVariableDebt: bigint;
  principalStableDebt: bigint;
  scaledVariableDebt: bigint;
  liquidityRate: bigint;
  stableBorrowRate: bigint;
  stableRateLastUpdated: bigint;
  usageAsCollateralEnabled: boolean;
  walletBalanceUnderlyingAsset: bigint;
  [key: string]: bigint | string | boolean;
}

export interface ReserveData {
  address: string;
  symbol: string;
  decimals: bigint;
  totalLiquidity: bigint;
  availableLiquidity: bigint;
  totalStableDebt: bigint;
  totalVariableDebt: bigint;
  principalStableDebt: bigint;
  scaledVariableDebt: bigint;
  averageStableBorrowRate: bigint;
  variableBorrowRate: bigint;
  stableBorrowRate: bigint;
  utilizationRate: bigint;
  liquidityIndex: bigint;
  variableBorrowIndex: bigint;
  mTokenAddress: string;
  stableDebtTokenAddress: string;
  variableDebtTokenAddress: string;
  marketStableRate: bigint;
  lastUpdateTimestamp: bigint;
  totalStableDebtLastUpdated: bigint;
  liquidityRate: bigint;
  [key: string]: bigint | string;
}

export interface BlockTimestamps {
  txTimestamp: bigint;
  latestBlockTimestamp: bigint;
}

export interface ReserveInitParams {
  underlyingAsset: Contract;
  interestRateStrategy: Contract;
}

export interface ReserveConfigParams {
  underlyingAsset: Contract;
  enableBorrowing: boolean;
  enableStableBorrowing: boolean;
}

export interface LiquidationMultiplierParams {
  liquidationMultiplier: bigint;
  liquidationBonus: bigint;
  liquidationProtocolFee: bigint;
  actualLiquidationProtocolFee: bigint;
}
