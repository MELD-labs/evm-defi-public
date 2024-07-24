import { ONE_YEAR, RAY, PERCENTAGE_FACTOR } from "../constants";
import { MaxUint256, Contract } from "ethers";
import {
  IReserveParams,
  iMeldPoolAssets,
  Configuration,
  RateMode,
} from "../types";
import {
  LiquidationMultiplierParams,
  ReserveData,
  UserReserveData,
} from "../interfaces";
import { MeldPools } from "../types";
import "./math";
import {
  SampleERC20,
  MeldProtocolDataProvider,
  MeldPriceOracle,
  LendingPool,
} from "../../../typechain-types";
import { expect } from "chai";
import { getReservesConfigByPool } from "./utils";

export const configuration: Configuration = <Configuration>{};

export const calcExpectedUserDataAfterDeposit = (
  amountDeposited: bigint,
  reserveDataBeforeAction: ReserveData,
  reserveDataAfterAction: ReserveData,
  userDataBeforeAction: UserReserveData,
  txTimestamp: bigint,
  usageAsCollateralEnabled?: boolean
): UserReserveData => {
  const expectedUserData = <UserReserveData>{};

  expectedUserData.currentStableDebt = calcExpectedStableDebtTokenBalance(
    userDataBeforeAction.principalStableDebt,
    userDataBeforeAction.stableBorrowRate,
    userDataBeforeAction.stableRateLastUpdated,
    txTimestamp
  );

  expectedUserData.currentVariableDebt = calcExpectedVariableDebtTokenBalance(
    reserveDataBeforeAction,
    userDataBeforeAction,
    txTimestamp
  );

  expectedUserData.principalStableDebt =
    userDataBeforeAction.principalStableDebt;
  expectedUserData.scaledVariableDebt = userDataBeforeAction.scaledVariableDebt;
  expectedUserData.variableBorrowIndex =
    userDataBeforeAction.variableBorrowIndex;
  expectedUserData.stableBorrowRate = userDataBeforeAction.stableBorrowRate;
  expectedUserData.stableRateLastUpdated =
    userDataBeforeAction.stableRateLastUpdated;

  expectedUserData.liquidityRate = reserveDataAfterAction.liquidityRate;

  expectedUserData.scaledMTokenBalance = calcExpectedScaledMTokenBalance(
    userDataBeforeAction,
    reserveDataAfterAction.liquidityIndex,
    BigInt(amountDeposited),
    0n
  );
  expectedUserData.currentMTokenBalance =
    calcExpectedMTokenBalance(
      reserveDataBeforeAction,
      userDataBeforeAction,
      txTimestamp
    ) + BigInt(amountDeposited);

  if (usageAsCollateralEnabled !== undefined) {
    expectedUserData.usageAsCollateralEnabled = usageAsCollateralEnabled;
  } else {
    if (userDataBeforeAction.currentMTokenBalance == 0n) {
      expectedUserData.usageAsCollateralEnabled = true;
    } else {
      expectedUserData.usageAsCollateralEnabled =
        userDataBeforeAction.usageAsCollateralEnabled;
    }
  }

  expectedUserData.variableBorrowIndex =
    userDataBeforeAction.variableBorrowIndex;
  expectedUserData.walletBalanceUnderlyingAsset =
    userDataBeforeAction.walletBalanceUnderlyingAsset - amountDeposited;

  expectedUserData.currentStableDebt = expectedUserData.principalStableDebt =
    calcExpectedStableDebtTokenBalance(
      userDataBeforeAction.principalStableDebt,
      userDataBeforeAction.stableBorrowRate,
      userDataBeforeAction.stableRateLastUpdated,
      txTimestamp
    );

  expectedUserData.currentVariableDebt = expectedUserData.principalStableDebt =
    calcExpectedVariableDebtTokenBalance(
      reserveDataBeforeAction,
      userDataBeforeAction,
      txTimestamp
    );

  return expectedUserData;
};

export const calcExpectedReserveDataAfterDeposit = (
  amountDeposited: bigint,
  reserveDataBeforeAction: ReserveData,
  txTimestamp: bigint
): ReserveData => {
  const expectedReserveData: ReserveData = <ReserveData>{};

  expectedReserveData.address = reserveDataBeforeAction.address;

  expectedReserveData.totalLiquidity =
    reserveDataBeforeAction.totalLiquidity + BigInt(amountDeposited);
  expectedReserveData.availableLiquidity =
    reserveDataBeforeAction.availableLiquidity + amountDeposited;

  expectedReserveData.averageStableBorrowRate =
    reserveDataBeforeAction.averageStableBorrowRate;
  expectedReserveData.liquidityIndex = calcExpectedLiquidityIndex(
    reserveDataBeforeAction,
    txTimestamp
  );
  expectedReserveData.variableBorrowIndex = calcExpectedVariableBorrowIndex(
    reserveDataBeforeAction,
    txTimestamp
  );

  expectedReserveData.totalStableDebt = calcExpectedTotalStableDebt(
    reserveDataBeforeAction.principalStableDebt,
    reserveDataBeforeAction.averageStableBorrowRate,
    reserveDataBeforeAction.totalStableDebtLastUpdated,
    txTimestamp
  );
  expectedReserveData.totalVariableDebt = calcExpectedTotalVariableDebt(
    reserveDataBeforeAction,
    expectedReserveData.variableBorrowIndex
  );

  expectedReserveData.scaledVariableDebt =
    reserveDataBeforeAction.scaledVariableDebt;
  expectedReserveData.principalStableDebt =
    reserveDataBeforeAction.principalStableDebt;

  expectedReserveData.utilizationRate = calcExpectedUtilizationRate(
    expectedReserveData.totalStableDebt,
    expectedReserveData.totalVariableDebt,
    expectedReserveData.totalLiquidity
  );
  const rates = calcExpectedInterestRates(
    reserveDataBeforeAction.symbol,
    reserveDataBeforeAction.marketStableRate,
    expectedReserveData.utilizationRate,
    expectedReserveData.totalStableDebt,
    expectedReserveData.totalVariableDebt,
    expectedReserveData.averageStableBorrowRate
  );
  expectedReserveData.liquidityRate = rates[0];
  expectedReserveData.stableBorrowRate = rates[1];
  expectedReserveData.variableBorrowRate = rates[2];

  // Need to return these values as well so that comparison can be done in tests with like values
  expectedReserveData.mTokenAddress = reserveDataBeforeAction.mTokenAddress;
  expectedReserveData.symbol = reserveDataBeforeAction.symbol;
  expectedReserveData.decimals = reserveDataBeforeAction.decimals;
  expectedReserveData.stableDebtTokenAddress =
    reserveDataBeforeAction.stableDebtTokenAddress;
  expectedReserveData.variableDebtTokenAddress =
    reserveDataBeforeAction.variableDebtTokenAddress;
  expectedReserveData.lastUpdateTimestamp = txTimestamp;
  expectedReserveData.totalStableDebtLastUpdated =
    reserveDataBeforeAction.totalStableDebtLastUpdated;
  expectedReserveData.marketStableRate =
    reserveDataBeforeAction.marketStableRate;

  return expectedReserveData;
};

export const calcExpectedReserveDataAfterWithdraw = (
  amountWithdrawn: bigint,
  reserveDataBeforeAction: ReserveData,
  userDataBeforeAction: UserReserveData,
  txTimestamp: bigint
): ReserveData => {
  const expectedReserveData: ReserveData = <ReserveData>{};

  expectedReserveData.address = reserveDataBeforeAction.address;

  if (amountWithdrawn == MaxUint256) {
    amountWithdrawn = calcExpectedMTokenBalance(
      reserveDataBeforeAction,
      userDataBeforeAction,
      txTimestamp
    );
  }

  expectedReserveData.availableLiquidity =
    reserveDataBeforeAction.availableLiquidity - amountWithdrawn;

  expectedReserveData.principalStableDebt =
    reserveDataBeforeAction.principalStableDebt;
  expectedReserveData.scaledVariableDebt =
    reserveDataBeforeAction.scaledVariableDebt;

  expectedReserveData.liquidityIndex = calcExpectedLiquidityIndex(
    reserveDataBeforeAction,
    txTimestamp
  );
  expectedReserveData.variableBorrowIndex = calcExpectedVariableBorrowIndex(
    reserveDataBeforeAction,
    txTimestamp
  );

  expectedReserveData.totalStableDebt = calcExpectedTotalStableDebt(
    reserveDataBeforeAction.principalStableDebt,
    reserveDataBeforeAction.averageStableBorrowRate,
    reserveDataBeforeAction.totalStableDebtLastUpdated,
    txTimestamp
  );
  expectedReserveData.totalVariableDebt =
    expectedReserveData.scaledVariableDebt.rayMul(
      expectedReserveData.variableBorrowIndex
    );

  expectedReserveData.averageStableBorrowRate =
    reserveDataBeforeAction.averageStableBorrowRate;

  expectedReserveData.totalLiquidity =
    reserveDataBeforeAction.availableLiquidity -
    amountWithdrawn +
    expectedReserveData.totalVariableDebt +
    expectedReserveData.totalStableDebt;

  expectedReserveData.utilizationRate = calcExpectedUtilizationRate(
    expectedReserveData.totalStableDebt,
    expectedReserveData.totalVariableDebt,
    expectedReserveData.totalLiquidity
  );
  const rates = calcExpectedInterestRates(
    reserveDataBeforeAction.symbol,
    reserveDataBeforeAction.marketStableRate,
    expectedReserveData.utilizationRate,
    expectedReserveData.totalStableDebt,
    expectedReserveData.totalVariableDebt,
    expectedReserveData.averageStableBorrowRate
  );
  expectedReserveData.liquidityRate = rates[0];
  expectedReserveData.stableBorrowRate = rates[1];
  expectedReserveData.variableBorrowRate = rates[2];

  // Need to return these values as well so that comparison can be done in tests with like values
  expectedReserveData.mTokenAddress = reserveDataBeforeAction.mTokenAddress;
  expectedReserveData.symbol = reserveDataBeforeAction.symbol;
  expectedReserveData.decimals = reserveDataBeforeAction.decimals;
  expectedReserveData.stableDebtTokenAddress =
    reserveDataBeforeAction.stableDebtTokenAddress;
  expectedReserveData.variableDebtTokenAddress =
    reserveDataBeforeAction.variableDebtTokenAddress;
  expectedReserveData.lastUpdateTimestamp = txTimestamp;
  expectedReserveData.totalStableDebtLastUpdated =
    reserveDataBeforeAction.totalStableDebtLastUpdated;
  expectedReserveData.marketStableRate =
    reserveDataBeforeAction.marketStableRate;

  return expectedReserveData;
};

export const calcExpectedUserDataAfterWithdraw = (
  amountWithdrawn: bigint,
  reserveDataBeforeAction: ReserveData,
  reserveDataAfterAction: ReserveData,
  userDataBeforeAction: UserReserveData,
  txTimestamp: bigint
): UserReserveData => {
  const expectedUserData = <UserReserveData>{};

  const MTokenBalance = calcExpectedMTokenBalance(
    reserveDataBeforeAction,
    userDataBeforeAction,
    txTimestamp
  );

  if (amountWithdrawn == MaxUint256) {
    amountWithdrawn = MTokenBalance;
  }

  expectedUserData.scaledMTokenBalance = calcExpectedScaledMTokenBalance(
    userDataBeforeAction,
    reserveDataAfterAction.liquidityIndex,
    0n,
    amountWithdrawn
  );

  expectedUserData.currentMTokenBalance = MTokenBalance - amountWithdrawn;

  expectedUserData.principalStableDebt =
    userDataBeforeAction.principalStableDebt;
  expectedUserData.scaledVariableDebt = userDataBeforeAction.scaledVariableDebt;

  expectedUserData.currentStableDebt = calcExpectedStableDebtTokenBalance(
    userDataBeforeAction.principalStableDebt,
    userDataBeforeAction.stableBorrowRate,
    userDataBeforeAction.stableRateLastUpdated,
    txTimestamp
  );

  expectedUserData.currentVariableDebt = calcExpectedVariableDebtTokenBalance(
    reserveDataBeforeAction,
    userDataBeforeAction,
    txTimestamp
  );

  expectedUserData.variableBorrowIndex =
    userDataBeforeAction.variableBorrowIndex;
  expectedUserData.stableBorrowRate = userDataBeforeAction.stableBorrowRate;
  expectedUserData.stableRateLastUpdated =
    userDataBeforeAction.stableRateLastUpdated;

  expectedUserData.liquidityRate = reserveDataAfterAction.liquidityRate;

  if (userDataBeforeAction.currentMTokenBalance == 0n) {
    expectedUserData.usageAsCollateralEnabled = true;
  } else {
    //if the user is withdrawing everything, usageAsCollateralEnabled must be false
    if (expectedUserData.currentMTokenBalance == 0n) {
      expectedUserData.usageAsCollateralEnabled = false;
    } else {
      expectedUserData.usageAsCollateralEnabled =
        userDataBeforeAction.usageAsCollateralEnabled;
    }
  }

  expectedUserData.walletBalanceUnderlyingAsset =
    userDataBeforeAction.walletBalanceUnderlyingAsset + amountWithdrawn;

  // Need to return these values as well so that comparison can be done in tests with like values
  expectedUserData.mTokenAddress = reserveDataBeforeAction.mTokenAddress;
  expectedUserData.symbol = reserveDataBeforeAction.symbol;
  expectedUserData.decimals = reserveDataBeforeAction.decimals;
  expectedUserData.stableDebtTokenAddress =
    reserveDataBeforeAction.stableDebtTokenAddress;
  expectedUserData.variableDebtTokenAddress =
    reserveDataBeforeAction.variableDebtTokenAddress;
  expectedUserData.lastUpdateTimestamp = txTimestamp;
  expectedUserData.totalStableDebtLastUpdated =
    reserveDataBeforeAction.totalStableDebtLastUpdated;
  expectedUserData.marketStableRate = reserveDataBeforeAction.marketStableRate;

  return expectedUserData;
};

export const calcExpectedReserveDataAfterBorrow = (
  amountBorrowed: bigint,
  borrowRateMode: string,
  reserveDataBeforeAction: ReserveData,
  txTimestamp: bigint,
  currentTimestamp: bigint // latest block timestamp
): ReserveData => {
  const expectedReserveData = <ReserveData>{};
  expectedReserveData.address = reserveDataBeforeAction.address;

  expectedReserveData.liquidityIndex = calcExpectedLiquidityIndex(
    reserveDataBeforeAction,
    txTimestamp
  );

  expectedReserveData.variableBorrowIndex = calcExpectedVariableBorrowIndex(
    reserveDataBeforeAction,
    txTimestamp
  );

  expectedReserveData.availableLiquidity =
    reserveDataBeforeAction.availableLiquidity - amountBorrowed;

  expectedReserveData.lastUpdateTimestamp = txTimestamp;

  if (borrowRateMode == RateMode.Stable) {
    expectedReserveData.scaledVariableDebt =
      reserveDataBeforeAction.scaledVariableDebt;

    const expectedVariableDebtAfterTx =
      expectedReserveData.scaledVariableDebt.rayMul(
        expectedReserveData.variableBorrowIndex
      );

    const expectedStableDebtUntilTx = calcExpectedTotalStableDebt(
      reserveDataBeforeAction.principalStableDebt,
      reserveDataBeforeAction.averageStableBorrowRate,
      reserveDataBeforeAction.totalStableDebtLastUpdated,
      txTimestamp
    );

    expectedReserveData.principalStableDebt =
      expectedStableDebtUntilTx + amountBorrowed;

    expectedReserveData.averageStableBorrowRate =
      calcExpectedAverageStableBorrowRate(
        reserveDataBeforeAction.averageStableBorrowRate,
        expectedStableDebtUntilTx,
        amountBorrowed,
        reserveDataBeforeAction.stableBorrowRate
      );

    const totalLiquidityAfterTx =
      expectedReserveData.availableLiquidity +
      expectedReserveData.principalStableDebt +
      expectedVariableDebtAfterTx;

    const utilizationRateAfterTx = calcExpectedUtilizationRate(
      expectedReserveData.principalStableDebt, //the expected principal debt is the total debt immediately after the tx
      expectedVariableDebtAfterTx,
      totalLiquidityAfterTx
    );

    const ratesAfterTx = calcExpectedInterestRates(
      reserveDataBeforeAction.symbol,
      reserveDataBeforeAction.marketStableRate,
      utilizationRateAfterTx,
      expectedReserveData.principalStableDebt,
      expectedVariableDebtAfterTx,
      expectedReserveData.averageStableBorrowRate
    );

    expectedReserveData.liquidityRate = ratesAfterTx[0];

    expectedReserveData.stableBorrowRate = ratesAfterTx[1];

    expectedReserveData.variableBorrowRate = ratesAfterTx[2];

    expectedReserveData.totalStableDebt = calcExpectedTotalStableDebt(
      expectedReserveData.principalStableDebt,
      expectedReserveData.averageStableBorrowRate,
      txTimestamp,
      currentTimestamp
    );

    expectedReserveData.totalVariableDebt =
      reserveDataBeforeAction.scaledVariableDebt.rayMul(
        calcExpectedReserveNormalizedDebt(
          expectedReserveData.variableBorrowRate,
          expectedReserveData.variableBorrowIndex,
          txTimestamp,
          currentTimestamp
        )
      );

    expectedReserveData.totalLiquidity =
      expectedReserveData.availableLiquidity +
      expectedReserveData.totalVariableDebt +
      expectedReserveData.totalStableDebt;

    expectedReserveData.utilizationRate = calcExpectedUtilizationRate(
      expectedReserveData.totalStableDebt,
      expectedReserveData.totalVariableDebt,
      expectedReserveData.totalLiquidity
    );

    expectedReserveData.totalStableDebtLastUpdated = txTimestamp;
  } else {
    expectedReserveData.principalStableDebt =
      reserveDataBeforeAction.principalStableDebt;

    const totalStableDebtAfterTx = calcExpectedStableDebtTokenBalance(
      reserveDataBeforeAction.principalStableDebt,
      reserveDataBeforeAction.averageStableBorrowRate,
      reserveDataBeforeAction.totalStableDebtLastUpdated,
      txTimestamp
    );

    expectedReserveData.totalStableDebt = calcExpectedTotalStableDebt(
      reserveDataBeforeAction.principalStableDebt,
      reserveDataBeforeAction.averageStableBorrowRate,
      reserveDataBeforeAction.totalStableDebtLastUpdated,
      currentTimestamp
    );

    expectedReserveData.averageStableBorrowRate =
      reserveDataBeforeAction.averageStableBorrowRate;

    expectedReserveData.scaledVariableDebt =
      reserveDataBeforeAction.scaledVariableDebt +
      amountBorrowed.rayDiv(expectedReserveData.variableBorrowIndex);

    const totalVariableDebtAfterTx =
      expectedReserveData.scaledVariableDebt.rayMul(
        expectedReserveData.variableBorrowIndex
      );

    const utilizationRateAfterTx = calcExpectedUtilizationRate(
      totalStableDebtAfterTx,
      totalVariableDebtAfterTx,
      expectedReserveData.availableLiquidity +
        totalStableDebtAfterTx +
        totalVariableDebtAfterTx
    );

    const rates = calcExpectedInterestRates(
      reserveDataBeforeAction.symbol,
      reserveDataBeforeAction.marketStableRate,
      utilizationRateAfterTx,
      totalStableDebtAfterTx,
      totalVariableDebtAfterTx,
      expectedReserveData.averageStableBorrowRate
    );

    expectedReserveData.liquidityRate = rates[0];

    expectedReserveData.stableBorrowRate = rates[1];

    expectedReserveData.variableBorrowRate = rates[2];

    expectedReserveData.totalVariableDebt =
      expectedReserveData.scaledVariableDebt.rayMul(
        calcExpectedReserveNormalizedDebt(
          expectedReserveData.variableBorrowRate,
          expectedReserveData.variableBorrowIndex,
          txTimestamp,
          currentTimestamp
        )
      );

    expectedReserveData.totalLiquidity =
      expectedReserveData.availableLiquidity +
      expectedReserveData.totalStableDebt +
      expectedReserveData.totalVariableDebt;

    expectedReserveData.utilizationRate = calcExpectedUtilizationRate(
      expectedReserveData.totalStableDebt,
      expectedReserveData.totalVariableDebt,
      expectedReserveData.totalLiquidity
    );

    expectedReserveData.totalStableDebtLastUpdated =
      reserveDataBeforeAction.totalStableDebtLastUpdated;
  }

  // Need to return these values as well so that comparison can be done in tests with like values
  expectedReserveData.mTokenAddress = reserveDataBeforeAction.mTokenAddress;
  expectedReserveData.symbol = reserveDataBeforeAction.symbol;
  expectedReserveData.decimals = reserveDataBeforeAction.decimals;
  expectedReserveData.stableDebtTokenAddress =
    reserveDataBeforeAction.stableDebtTokenAddress;
  expectedReserveData.variableDebtTokenAddress =
    reserveDataBeforeAction.variableDebtTokenAddress;
  expectedReserveData.marketStableRate =
    reserveDataBeforeAction.marketStableRate;

  return expectedReserveData;
};
export const calcExpectedUserDataAfterBorrow = (
  amountBorrowed: bigint,
  interestRateMode: string,
  reserveDataBeforeAction: ReserveData,
  expectedDataAfterAction: ReserveData,
  userDataBeforeAction: UserReserveData,
  txTimestamp: bigint,
  currentTimestamp: bigint,
  delegator: boolean = false
): UserReserveData => {
  const expectedUserData = <UserReserveData>{};

  if (interestRateMode == RateMode.Stable) {
    const stableDebtUntilTx = calcExpectedStableDebtTokenBalance(
      userDataBeforeAction.principalStableDebt,
      userDataBeforeAction.stableBorrowRate,
      userDataBeforeAction.stableRateLastUpdated,
      txTimestamp
    );

    expectedUserData.principalStableDebt = stableDebtUntilTx + amountBorrowed;
    expectedUserData.stableRateLastUpdated = txTimestamp;

    expectedUserData.stableBorrowRate = calcExpectedUserStableRate(
      stableDebtUntilTx,
      userDataBeforeAction.stableBorrowRate,
      amountBorrowed,
      reserveDataBeforeAction.stableBorrowRate
    );

    expectedUserData.currentStableDebt = calcExpectedStableDebtTokenBalance(
      expectedUserData.principalStableDebt,
      expectedUserData.stableBorrowRate,
      txTimestamp,
      currentTimestamp
    );

    expectedUserData.scaledVariableDebt =
      userDataBeforeAction.scaledVariableDebt;
  } else {
    expectedUserData.scaledVariableDebt =
      userDataBeforeAction.scaledVariableDebt +
      amountBorrowed.rayDiv(expectedDataAfterAction.variableBorrowIndex);

    expectedUserData.principalStableDebt =
      userDataBeforeAction.principalStableDebt;

    expectedUserData.stableBorrowRate = userDataBeforeAction.stableBorrowRate;

    expectedUserData.stableRateLastUpdated =
      userDataBeforeAction.stableRateLastUpdated;

    expectedUserData.currentStableDebt = calcExpectedStableDebtTokenBalance(
      userDataBeforeAction.principalStableDebt,
      userDataBeforeAction.stableBorrowRate,
      userDataBeforeAction.stableRateLastUpdated,
      currentTimestamp
    );
  }

  expectedUserData.currentVariableDebt = calcExpectedVariableDebtTokenBalance(
    expectedDataAfterAction,
    expectedUserData,
    currentTimestamp
  );

  expectedUserData.liquidityRate = expectedDataAfterAction.liquidityRate;

  expectedUserData.usageAsCollateralEnabled =
    userDataBeforeAction.usageAsCollateralEnabled;

  expectedUserData.currentMTokenBalance = calcExpectedMTokenBalance(
    expectedDataAfterAction,
    userDataBeforeAction,
    currentTimestamp
  );

  expectedUserData.scaledMTokenBalance =
    userDataBeforeAction.scaledMTokenBalance;

  // Delegator's underlying asset value should not change.
  // Only the delegatee's (borrower's) underlying asset value should change.
  if (delegator) {
    expectedUserData.walletBalanceUnderlyingAsset = BigInt(
      userDataBeforeAction.walletBalanceUnderlyingAsset
    );
  } else {
    expectedUserData.walletBalanceUnderlyingAsset =
      BigInt(userDataBeforeAction.walletBalanceUnderlyingAsset) +
      amountBorrowed;
  }

  return expectedUserData;
};

export const calcExpectedReserveDataAfterRepay = (
  amountRepaid: bigint,
  borrowRateMode: RateMode,
  reserveDataBeforeAction: ReserveData,
  userDataBeforeAction: UserReserveData,
  txTimestamp: bigint
): ReserveData => {
  const expectedReserveData: ReserveData = <ReserveData>{};

  expectedReserveData.address = reserveDataBeforeAction.address;

  const userStableDebt = calcExpectedStableDebtTokenBalance(
    userDataBeforeAction.principalStableDebt,
    userDataBeforeAction.stableBorrowRate,
    userDataBeforeAction.stableRateLastUpdated,
    txTimestamp
  );

  const userVariableDebt = calcExpectedVariableDebtTokenBalance(
    reserveDataBeforeAction,
    userDataBeforeAction,
    txTimestamp
  );

  let paybackAmount =
    borrowRateMode == RateMode.Stable ? userStableDebt : userVariableDebt;

  // If the amountRepaid is equal to type(uint256).max, the user wants to repay all the debt. However,  if the underlying asset balance is not enough,
  // we should repay the maximum possible based on the underlying asset balance.
  if (amountRepaid == MaxUint256) {
    if (userDataBeforeAction.walletBalanceUnderlyingAsset < paybackAmount) {
      paybackAmount = userDataBeforeAction.walletBalanceUnderlyingAsset;
    }
  } else {
    if (amountRepaid < paybackAmount) {
      paybackAmount = amountRepaid;
    }
  }

  expectedReserveData.liquidityIndex = calcExpectedLiquidityIndex(
    reserveDataBeforeAction,
    txTimestamp
  );
  expectedReserveData.variableBorrowIndex = calcExpectedVariableBorrowIndex(
    reserveDataBeforeAction,
    txTimestamp
  );

  if (borrowRateMode == RateMode.Stable) {
    const expectedDebt = calcExpectedTotalStableDebt(
      reserveDataBeforeAction.principalStableDebt,
      reserveDataBeforeAction.averageStableBorrowRate,
      reserveDataBeforeAction.totalStableDebtLastUpdated,
      txTimestamp
    );

    expectedReserveData.principalStableDebt =
      expectedReserveData.totalStableDebt = expectedDebt - paybackAmount;

    //due to accumulation errors, the total stable debt might be smaller than the last user debt.
    //in this case we simply set the total supply and avg stable rate to 0.
    if (expectedReserveData.totalStableDebt < 0) {
      expectedReserveData.principalStableDebt =
        expectedReserveData.totalStableDebt =
        expectedReserveData.averageStableBorrowRate =
          0n;
    } else {
      expectedReserveData.averageStableBorrowRate =
        calcExpectedAverageStableBorrowRate(
          reserveDataBeforeAction.averageStableBorrowRate,
          expectedDebt,
          -paybackAmount,
          userDataBeforeAction.stableBorrowRate
        );

      //also due to accumulation errors, the final avg stable rate when the last user repays might be negative.
      //if that is the case, it means a small leftover of total stable debt is left, which can be erased.

      if (expectedReserveData.averageStableBorrowRate < 0) {
        expectedReserveData.principalStableDebt =
          expectedReserveData.totalStableDebt =
          expectedReserveData.averageStableBorrowRate =
            0n;
      }
    }

    expectedReserveData.scaledVariableDebt =
      reserveDataBeforeAction.scaledVariableDebt;

    expectedReserveData.totalVariableDebt =
      expectedReserveData.scaledVariableDebt.rayMul(
        expectedReserveData.variableBorrowIndex
      );

    expectedReserveData.totalStableDebtLastUpdated = txTimestamp;
  } else {
    expectedReserveData.scaledVariableDebt =
      reserveDataBeforeAction.scaledVariableDebt -
      paybackAmount.rayDiv(expectedReserveData.variableBorrowIndex);

    expectedReserveData.totalVariableDebt =
      expectedReserveData.scaledVariableDebt.rayMul(
        expectedReserveData.variableBorrowIndex
      );

    expectedReserveData.principalStableDebt =
      reserveDataBeforeAction.principalStableDebt;
    expectedReserveData.totalStableDebt =
      reserveDataBeforeAction.totalStableDebt;

    expectedReserveData.averageStableBorrowRate =
      reserveDataBeforeAction.averageStableBorrowRate;

    expectedReserveData.totalStableDebtLastUpdated =
      reserveDataBeforeAction.totalStableDebtLastUpdated;
  }

  expectedReserveData.availableLiquidity =
    reserveDataBeforeAction.availableLiquidity + paybackAmount;

  expectedReserveData.totalLiquidity =
    expectedReserveData.availableLiquidity +
    expectedReserveData.totalStableDebt +
    expectedReserveData.totalVariableDebt;

  expectedReserveData.utilizationRate = calcExpectedUtilizationRate(
    expectedReserveData.totalStableDebt,
    expectedReserveData.totalVariableDebt,
    expectedReserveData.totalLiquidity
  );

  const rates = calcExpectedInterestRates(
    reserveDataBeforeAction.symbol,
    reserveDataBeforeAction.marketStableRate,
    expectedReserveData.utilizationRate,
    expectedReserveData.totalStableDebt,
    expectedReserveData.totalVariableDebt,
    expectedReserveData.averageStableBorrowRate
  );
  expectedReserveData.liquidityRate = rates[0];

  expectedReserveData.stableBorrowRate = rates[1];

  expectedReserveData.variableBorrowRate = rates[2];

  expectedReserveData.lastUpdateTimestamp = txTimestamp;

  // Need to return these values as well so that comparison can be done in tests with like values
  expectedReserveData.mTokenAddress = reserveDataBeforeAction.mTokenAddress;
  expectedReserveData.symbol = reserveDataBeforeAction.symbol;
  expectedReserveData.decimals = reserveDataBeforeAction.decimals;
  expectedReserveData.stableDebtTokenAddress =
    reserveDataBeforeAction.stableDebtTokenAddress;
  expectedReserveData.variableDebtTokenAddress =
    reserveDataBeforeAction.variableDebtTokenAddress;
  expectedReserveData.marketStableRate =
    reserveDataBeforeAction.marketStableRate;

  return expectedReserveData;
};

export const calcExpectedUserDataAfterRepay = (
  totalRepaid: bigint,
  rateMode: RateMode,
  reserveDataBeforeAction: ReserveData,
  expectedDataAfterAction: ReserveData,
  userDataBeforeAction: UserReserveData,
  user: string,
  onBehalfOf: string,
  txTimestamp: bigint,
  currentTimestamp: bigint
): UserReserveData => {
  const expectedUserData = <UserReserveData>{};

  const variableDebt = calcExpectedVariableDebtTokenBalance(
    reserveDataBeforeAction,
    userDataBeforeAction,
    currentTimestamp
  );

  const stableDebt = calcExpectedStableDebtTokenBalance(
    userDataBeforeAction.principalStableDebt,
    userDataBeforeAction.stableBorrowRate,
    userDataBeforeAction.stableRateLastUpdated,
    currentTimestamp
  );

  let paybackAmount = rateMode == RateMode.Stable ? stableDebt : variableDebt;

  // If the totalRepaid is equal to type(uint256).max, the user wants to repay all the debt. However,  if the underlying asset balance is not enough,
  // we should repay the maximum possible based on the underlying asset balance.
  if (totalRepaid == MaxUint256) {
    if (userDataBeforeAction.walletBalanceUnderlyingAsset < paybackAmount) {
      paybackAmount = userDataBeforeAction.walletBalanceUnderlyingAsset;
    }
  } else {
    if (totalRepaid < paybackAmount) {
      paybackAmount = totalRepaid;
    }
  }

  if (rateMode == RateMode.Stable) {
    expectedUserData.scaledVariableDebt =
      userDataBeforeAction.scaledVariableDebt;
    expectedUserData.currentVariableDebt = variableDebt;

    expectedUserData.principalStableDebt = expectedUserData.currentStableDebt =
      stableDebt - paybackAmount;

    if (expectedUserData.currentStableDebt == 0n) {
      //user repaid everything
      expectedUserData.stableBorrowRate =
        expectedUserData.stableRateLastUpdated = 0n;
    } else {
      expectedUserData.stableBorrowRate = userDataBeforeAction.stableBorrowRate;
      expectedUserData.stableRateLastUpdated = txTimestamp;
    }
  } else {
    expectedUserData.currentStableDebt =
      userDataBeforeAction.principalStableDebt;
    expectedUserData.principalStableDebt = stableDebt;
    expectedUserData.stableBorrowRate = userDataBeforeAction.stableBorrowRate;
    expectedUserData.stableRateLastUpdated =
      userDataBeforeAction.stableRateLastUpdated;

    expectedUserData.scaledVariableDebt =
      userDataBeforeAction.scaledVariableDebt -
      paybackAmount.rayDiv(expectedDataAfterAction.variableBorrowIndex);

    expectedUserData.currentVariableDebt =
      expectedUserData.scaledVariableDebt.rayMul(
        expectedDataAfterAction.variableBorrowIndex
      );
  }

  expectedUserData.liquidityRate = expectedDataAfterAction.liquidityRate;

  expectedUserData.usageAsCollateralEnabled =
    userDataBeforeAction.usageAsCollateralEnabled;

  expectedUserData.currentMTokenBalance = calcExpectedMTokenBalance(
    reserveDataBeforeAction,
    userDataBeforeAction,
    txTimestamp
  );
  expectedUserData.scaledMTokenBalance =
    userDataBeforeAction.scaledMTokenBalance;

  if (user === onBehalfOf) {
    expectedUserData.walletBalanceUnderlyingAsset =
      userDataBeforeAction.walletBalanceUnderlyingAsset - paybackAmount;
  } else {
    //wallet balance didn't change
    expectedUserData.walletBalanceUnderlyingAsset =
      userDataBeforeAction.walletBalanceUnderlyingAsset;
  }

  return expectedUserData;
};

export const calcLinearInterest = (
  rate: bigint,
  currentTimestamp: bigint,
  lastUpdateTimestamp: bigint
) => {
  const timeDifference = currentTimestamp - lastUpdateTimestamp;

  const cumulatedInterest =
    rate.multipliedBy(timeDifference) / BigInt(ONE_YEAR) + BigInt(RAY);

  return cumulatedInterest;
};

export const calcCompoundedInterest = (
  rate: bigint,
  currentTimestamp: bigint,
  lastUpdateTimestamp: bigint
) => {
  const timeDifference = currentTimestamp - lastUpdateTimestamp;

  if (timeDifference == 0n) {
    return BigInt(RAY);
  }

  const expMinusOne = timeDifference - 1n;
  const expMinusTwo = timeDifference > 2n ? timeDifference - 2n : 0n;

  const ratePerSecond = rate / BigInt(ONE_YEAR);

  const basePowerTwo = ratePerSecond.rayMul(ratePerSecond);
  const basePowerThree = basePowerTwo.rayMul(ratePerSecond);

  const secondTerm = (timeDifference * expMinusOne * basePowerTwo) / 2n;
  const thirdTerm =
    (timeDifference * expMinusOne * expMinusTwo * basePowerThree) / 6n;

  return BigInt(RAY) + ratePerSecond * timeDifference + secondTerm + thirdTerm;
};

export const calcExpectedInterestRates = (
  reserveSymbol: string,
  marketStableRate: bigint,
  utilizationRate: bigint,
  totalStableDebt: bigint,
  totalVariableDebt: bigint,
  averageStableBorrowRate: bigint
): bigint[] => {
  configuration.reservesParams = <iMeldPoolAssets<IReserveParams>>(
    getReservesConfigByPool(MeldPools.proto)
  );

  const { reservesParams } = configuration;

  const reserveIndex = Object.keys(reservesParams).findIndex(
    (value) => value === reserveSymbol
  );
  const [, reserveConfiguration] = (
    Object.entries(reservesParams) as [string, IReserveParams][]
  )[reserveIndex];

  let stableBorrowRate: bigint = marketStableRate;
  let variableBorrowRate = BigInt(
    reserveConfiguration.strategy.baseVariableBorrowRate
  );

  const optimalRate = BigInt(
    reserveConfiguration.strategy.optimalUtilizationRate
  );
  const excessRate = BigInt(RAY) - optimalRate;
  if (utilizationRate > optimalRate) {
    const excessUtilizationRateRatio = (
      utilizationRate -
      BigInt(reserveConfiguration.strategy.optimalUtilizationRate)
    ).rayDiv(excessRate);

    stableBorrowRate =
      stableBorrowRate +
      BigInt(reserveConfiguration.strategy.stableRateSlope1) +
      BigInt(reserveConfiguration.strategy.stableRateSlope2).rayMul(
        excessUtilizationRateRatio
      );

    variableBorrowRate =
      variableBorrowRate +
      BigInt(reserveConfiguration.strategy.variableRateSlope1) +
      BigInt(reserveConfiguration.strategy.variableRateSlope2).rayMul(
        excessUtilizationRateRatio
      );
  } else {
    stableBorrowRate =
      stableBorrowRate +
      BigInt(reserveConfiguration.strategy.stableRateSlope1).rayMul(
        utilizationRate.rayDiv(BigInt(optimalRate))
      );

    variableBorrowRate =
      variableBorrowRate +
      utilizationRate
        .rayDiv(optimalRate)
        .rayMul(BigInt(reserveConfiguration.strategy.variableRateSlope1));
  }

  const expectedOverallRate = calcExpectedOverallBorrowRate(
    totalStableDebt,
    totalVariableDebt,
    variableBorrowRate,
    averageStableBorrowRate
  );

  const liquidityRate = expectedOverallRate
    .rayMul(utilizationRate)
    .percentMul(
      BigInt(PERCENTAGE_FACTOR) - BigInt(reserveConfiguration.reserveFactor)
    );

  return [liquidityRate, stableBorrowRate, variableBorrowRate];
};

const calcExpectedLiquidityIndex = (
  reserveData: ReserveData,
  timestamp: bigint
) => {
  //if utilization rate is 0, nothing to compound
  if (reserveData.utilizationRate == 0n) {
    return reserveData.liquidityIndex;
  }

  const cumulatedInterest = calcLinearInterest(
    reserveData.liquidityRate,
    timestamp,
    reserveData.lastUpdateTimestamp
  );

  return cumulatedInterest.rayMul(reserveData.liquidityIndex);
};

const calcExpectedVariableBorrowIndex = (
  reserveData: ReserveData,
  timestamp: bigint
) => {
  //if totalVariableDebt is 0, nothing to compound
  if (reserveData.totalVariableDebt == 0n) {
    return reserveData.variableBorrowIndex;
  }

  const cumulatedInterest = calcCompoundedInterest(
    reserveData.variableBorrowRate,
    timestamp,
    reserveData.lastUpdateTimestamp
  );

  return cumulatedInterest.rayMul(reserveData.variableBorrowIndex);
};

const calcExpectedTotalStableDebt = (
  principalStableDebt: bigint,
  averageStableBorrowRate: bigint,
  lastUpdateTimestamp: bigint,
  currentTimestamp: bigint
) => {
  const cumulatedInterest = calcCompoundedInterest(
    averageStableBorrowRate,
    currentTimestamp,
    lastUpdateTimestamp
  );

  return cumulatedInterest.rayMul(principalStableDebt);
};

const calcExpectedUserStableRate = (
  balanceBefore: bigint,
  rateBefore: bigint,
  amount: bigint,
  rateNew: bigint
) => {
  const amountInRay = amount.wadToRay();

  return (
    rateBefore.rayMul(balanceBefore.wadToRay()) + amountInRay.rayMul(rateNew)
  ).rayDiv((balanceBefore + amount).wadToRay());
};

const calcExpectedTotalVariableDebt = (
  reserveData: ReserveData,
  expectedVariableDebtIndex: bigint
) => {
  return reserveData.scaledVariableDebt.rayMul(expectedVariableDebtIndex);
};

export const calcExpectedOverallBorrowRate = (
  totalStableDebt: bigint,
  totalVariableDebt: bigint,
  currentVariableBorrowRate: bigint,
  currentAverageStableBorrowRate: bigint
): bigint => {
  const totalBorrows = totalStableDebt + totalVariableDebt;

  if (totalBorrows == 0n) return 0n;

  const weightedVariableRate = totalVariableDebt
    .wadToRay()
    .rayMul(currentVariableBorrowRate);

  const weightedStableRate = totalStableDebt
    .wadToRay()
    .rayMul(currentAverageStableBorrowRate);

  const overallBorrowRate = (weightedVariableRate + weightedStableRate).rayDiv(
    totalBorrows.wadToRay()
  );

  return overallBorrowRate;
};

export const calcExpectedUtilizationRate = (
  totalStableDebt: bigint,
  totalVariableDebt: bigint,
  totalLiquidity: bigint
): bigint => {
  if (totalStableDebt == 0n && totalVariableDebt == 0n) {
    return 0n;
  }

  const utilization = (totalStableDebt + totalVariableDebt).rayDiv(
    totalLiquidity
  );

  return utilization;
};

const calcExpectedScaledMTokenBalance = (
  userDataBeforeAction: UserReserveData,
  index: bigint,
  amountAdded: bigint,
  amountTaken: bigint
) => {
  return (
    userDataBeforeAction.scaledMTokenBalance +
    amountAdded.rayDiv(index) -
    amountTaken.rayDiv(index)
  );
};

export const calcExpectedMTokenBalance = (
  reserveData: ReserveData,
  userData: UserReserveData,
  currentTimestamp: bigint
) => {
  const index = calcExpectedReserveNormalizedIncome(
    reserveData,
    currentTimestamp
  );

  const { scaledMTokenBalance: scaledBalanceBeforeAction } = userData;

  return scaledBalanceBeforeAction.rayMul(index);
};

export const calcExpectedVariableDebtTokenBalance = (
  reserveData: ReserveData,
  userData: UserReserveData,
  currentTimestamp: bigint
) => {
  const normalizedDebt = calcExpectedReserveNormalizedDebt(
    reserveData.variableBorrowRate,
    reserveData.variableBorrowIndex,
    reserveData.lastUpdateTimestamp,
    currentTimestamp
  );

  const { scaledVariableDebt } = userData;

  return scaledVariableDebt.rayMul(normalizedDebt);
};

export const calcExpectedStableDebtTokenBalance = (
  principalStableDebt: bigint,
  stableBorrowRate: bigint,
  stableRateLastUpdated: bigint,
  currentTimestamp: bigint
) => {
  if (
    stableBorrowRate == 0n ||
    currentTimestamp == stableRateLastUpdated ||
    stableRateLastUpdated == 0n
  ) {
    return principalStableDebt;
  }

  const cumulatedInterest = calcCompoundedInterest(
    stableBorrowRate,
    currentTimestamp,
    stableRateLastUpdated
  );

  return principalStableDebt.rayMul(cumulatedInterest);
};

export const calcExpectedReserveNormalizedIncome = (
  reserveData: ReserveData,
  currentTimestamp: bigint
) => {
  const { liquidityRate, liquidityIndex, lastUpdateTimestamp } = reserveData;

  //if utilization rate is 0, nothing to compound
  if (liquidityRate == 0n) {
    return liquidityIndex;
  }

  const cumulatedInterest = calcLinearInterest(
    liquidityRate,
    currentTimestamp,
    lastUpdateTimestamp
  );

  const income = cumulatedInterest.rayMul(liquidityIndex);

  return income;
};

export const calculateReserveDataAfterTime = (
  reserveData: ReserveData,
  currentTimestamp: bigint
) => {
  const newIndex = calcExpectedReserveNormalizedIncome(
    reserveData,
    currentTimestamp
  );

  const newReserveData = { ...reserveData };
  newReserveData.liquidityIndex = newIndex;
  newReserveData.lastUpdateTimestamp = currentTimestamp;
  newReserveData.variableBorrowIndex = calcExpectedVariableBorrowIndex(
    reserveData,
    currentTimestamp
  );
  newReserveData.totalVariableDebt = calcExpectedTotalVariableDebt(
    reserveData,
    newReserveData.variableBorrowIndex
  );
  newReserveData.totalStableDebt = calcExpectedTotalStableDebt(
    reserveData.principalStableDebt,
    reserveData.averageStableBorrowRate,
    reserveData.totalStableDebtLastUpdated,
    currentTimestamp
  );
  newReserveData.totalLiquidity =
    (newReserveData.totalLiquidity * newIndex) / reserveData.liquidityIndex;

  return newReserveData;
};

const calcExpectedReserveNormalizedDebt = (
  variableBorrowRate: bigint,
  variableBorrowIndex: bigint,
  lastUpdateTimestamp: bigint,
  currentTimestamp: bigint
) => {
  //if variable borrow rate is 0, nothing to compound
  if (variableBorrowRate == 0n) {
    return variableBorrowIndex;
  }

  const cumulatedInterest = calcCompoundedInterest(
    variableBorrowRate,
    currentTimestamp,
    lastUpdateTimestamp
  );

  const debt = cumulatedInterest.rayMul(variableBorrowIndex);

  return debt;
};

const calcExpectedAverageStableBorrowRate = (
  avgStableRateBefore: bigint,
  totalStableDebtBefore: bigint,
  amountChanged: bigint,
  rate: bigint
) => {
  const weightedTotalBorrows = avgStableRateBefore.rayMul(
    totalStableDebtBefore.wadToRay()
  );

  const weightedAmountBorrowed = rate.rayMul(amountChanged.wadToRay());

  const totalBorrowedStable =
    totalStableDebtBefore.wadToRay() + amountChanged.wadToRay();

  if (totalBorrowedStable == 0n) return 0n;

  return (weightedTotalBorrows + weightedAmountBorrowed).rayDiv(
    totalBorrowedStable
  );
};

export const calcLiquidationMultiplierParams = async (
  collateralAsset: SampleERC20,
  lendingPool: Contract | LendingPool,
  meldProtocolDataProvider: Contract | MeldProtocolDataProvider
): Promise<LiquidationMultiplierParams> => {
  const { liquidationBonus } =
    await meldProtocolDataProvider.getReserveConfigurationData(collateralAsset);

  const liquidationProtocolFee =
    await lendingPool.liquidationProtocolFeePercentage();

  const actualLiquidationProtocolFee = liquidationProtocolFee.percentMul(
    liquidationBonus - BigInt(PERCENTAGE_FACTOR)
  );

  return {
    liquidationMultiplier: liquidationBonus + actualLiquidationProtocolFee,
    liquidationBonus,
    liquidationProtocolFee,
    actualLiquidationProtocolFee,
  };
};

// The maximum amount that is possible to liquidate given all the liquidation constraints (borrower balance, close factor)
export const calcMaxLiquidatableCollateral = async (
  collateralAsset: SampleERC20,
  debtAsset: SampleERC20,
  meldPriceOracle: Contract | MeldPriceOracle,
  liquidationMultiplier: bigint,
  debtToCover: bigint
): Promise<bigint> => {
  let debtAssetPrice: bigint;
  let collateralAssetPrice: bigint;

  {
    let success: boolean;
    [debtAssetPrice, success] = await meldPriceOracle.getAssetPrice(
      await debtAsset.getAddress()
    );
    expect(success).to.be.true;
  }

  {
    let success: boolean;
    [collateralAssetPrice, success] = await meldPriceOracle.getAssetPrice(
      await collateralAsset.getAddress()
    );

    expect(success).to.be.true;
  }

  const collateralDecimals = await collateralAsset.decimals();
  const debtAssetDecimals = await debtAsset.decimals();

  // The maximum amount that is possible to liquidate given all the liquidation constraints (borrower balance, close factor)
  const maxLiquidatableCollateral =
    (debtAssetPrice *
      debtToCover *
      (10n ** collateralDecimals).percentMul(liquidationMultiplier)) /
    (collateralAssetPrice * 10n ** debtAssetDecimals);

  return maxLiquidatableCollateral;
};

// Calculates the maximum amount of debt that can be liquidated given the max caculated collateral
export const calcMaxDebtNeeded = async (
  collateralAsset: SampleERC20,
  debtAsset: SampleERC20,
  meldPriceOracle: Contract | MeldPriceOracle,
  liquidationMultiplier: bigint,
  collateralAmount: bigint
): Promise<bigint> => {
  let debtAssetPrice: bigint;
  let collateralAssetPrice: bigint;

  {
    let success: boolean;
    [debtAssetPrice, success] = await meldPriceOracle.getAssetPrice(
      await debtAsset.getAddress()
    );
    expect(success).to.be.true;
  }

  {
    let success: boolean;
    [collateralAssetPrice, success] = await meldPriceOracle.getAssetPrice(
      await collateralAsset.getAddress()
    );

    expect(success).to.be.true;
  }

  const collateralDecimals = await collateralAsset.decimals();
  const debtAssetDecimals = await debtAsset.decimals();

  // This is the max debt that can be liquidated because the borrower doesn't have enough collateral to cover the full debt
  const maxLiquidatableDebt = (
    (collateralAssetPrice * collateralAmount * 10n ** debtAssetDecimals) /
    (debtAssetPrice * 10n ** collateralDecimals)
  ).percentDiv(liquidationMultiplier);

  return maxLiquidatableDebt;
};
