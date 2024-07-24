/* eslint-disable @typescript-eslint/no-explicit-any */
import { ethers } from "hardhat";
import {
  LendingPool,
  MeldProtocolDataProvider,
} from "../../../typechain-types";
import { ReserveData, UserReserveData } from "../interfaces";
import {
  getLendingRateOracle,
  getIErc20Metadata,
  getMintableERC20,
  getMToken,
  getStableDebtToken,
  getVariableDebtToken,
} from "./contracts-getters";
import "./math";
import { tEthereumAddress } from "../types";
import chai from "chai";
const { expect } = chai;

export const getReserveData = async (
  helper: MeldProtocolDataProvider,
  reserve: tEthereumAddress,
  oracle: tEthereumAddress
): Promise<ReserveData> => {
  const [reserveData, tokenAddresses, rateOracle, token] = await Promise.all([
    helper.getReserveData(reserve),
    helper.getReserveTokensAddresses(reserve),
    getLendingRateOracle(oracle),
    getIErc20Metadata(reserve),
  ]);

  let stableDebtToken;
  let principalStableDebt;
  let totalStableDebtLastUpdated;
  let variableDebtToken;
  let scaledVariableDebt;

  // Need to take into consideration that some values will be zero before a reserve is initialized
  // Check if tokenAddresses.variableDebtTokenAddress is zero address and assign values accordingly
  if (tokenAddresses.stableDebtTokenAddress != ethers.ZeroAddress) {
    stableDebtToken = await getStableDebtToken(
      tokenAddresses.stableDebtTokenAddress
    );
    ({ 0: principalStableDebt } = await stableDebtToken.getSupplyData());
    totalStableDebtLastUpdated =
      await stableDebtToken.getTotalSupplyLastUpdated();
  } else {
    principalStableDebt = 0n;
    totalStableDebtLastUpdated = 0n;
  }

  // Check if tokenAddresses.variableDebtTokenAddress is zero address and assign values accordingly
  if (tokenAddresses.variableDebtTokenAddress != ethers.ZeroAddress) {
    variableDebtToken = await getVariableDebtToken(
      tokenAddresses.variableDebtTokenAddress
    );
    scaledVariableDebt = await variableDebtToken.scaledTotalSupply();
  } else {
    scaledVariableDebt = 0n;
  }

  const [rate] = await rateOracle.getMarketBorrowRate(reserve);
  const symbol = await token.symbol();
  const decimals = await token.decimals();
  const totalLiquidity =
    reserveData.availableLiquidity +
    reserveData.totalStableDebt +
    reserveData.totalVariableDebt;

  const utilizationRate =
    totalLiquidity == 0n
      ? 0n
      : (reserveData.totalStableDebt + reserveData.totalVariableDebt).rayDiv(
          totalLiquidity
        );
  return {
    totalLiquidity,
    utilizationRate,
    availableLiquidity: reserveData.availableLiquidity,
    totalStableDebt: reserveData.totalStableDebt,
    totalVariableDebt: reserveData.totalVariableDebt,
    liquidityRate: reserveData.liquidityRate,
    variableBorrowRate: reserveData.variableBorrowRate,
    stableBorrowRate: reserveData.stableBorrowRate,
    averageStableBorrowRate: reserveData.averageStableBorrowRate,
    liquidityIndex: reserveData.liquidityIndex,
    variableBorrowIndex: reserveData.variableBorrowIndex,
    lastUpdateTimestamp: BigInt(reserveData.lastUpdateTimestamp),
    totalStableDebtLastUpdated: BigInt(totalStableDebtLastUpdated),
    principalStableDebt: principalStableDebt,
    scaledVariableDebt: scaledVariableDebt,
    address: reserve,
    mTokenAddress: tokenAddresses.mTokenAddress,
    symbol,
    decimals,
    marketStableRate: BigInt(rate),
    stableDebtTokenAddress: tokenAddresses.stableDebtTokenAddress,
    variableDebtTokenAddress: tokenAddresses.variableDebtTokenAddress,
  };
};

export const getUserData = async (
  pool: LendingPool,
  helper: MeldProtocolDataProvider,
  reserve: string,
  user: tEthereumAddress,
  sender?: tEthereumAddress
): Promise<UserReserveData> => {
  const [userData, scaledMTokenBalance] = await Promise.all([
    helper.getUserReserveData(reserve, user),
    getMTokenUserData(reserve, user, helper),
  ]);

  const token = await getMintableERC20(reserve);
  const walletBalanceUnderlyingAsset = await token.balanceOf(sender || user);
  return {
    scaledMTokenBalance: BigInt(scaledMTokenBalance),
    currentMTokenBalance: userData.currentMTokenBalance,
    currentStableDebt: userData.currentStableDebt,
    currentVariableDebt: userData.currentVariableDebt,
    principalStableDebt: userData.principalStableDebt,
    scaledVariableDebt: userData.scaledVariableDebt,
    stableBorrowRate: userData.stableBorrowRate,
    liquidityRate: userData.liquidityRate,
    usageAsCollateralEnabled: userData.usageAsCollateralEnabled,
    stableRateLastUpdated: userData.stableRateLastUpdated,
    walletBalanceUnderlyingAsset,
  };
};

const getMTokenUserData = async (
  reserve: string,
  user: string,
  helpersContract: MeldProtocolDataProvider
) => {
  const mTokenAddress: string = (
    await helpersContract.getReserveTokensAddresses(reserve)
  ).mTokenAddress;

  const mToken = await getMToken(mTokenAddress);

  const scaledBalance = await mToken.scaledBalanceOf(user);
  return scaledBalance.toString();
};

const almostEqualOrEqual = function (
  this: any,
  expected: ReserveData | UserReserveData,
  actual: ReserveData | UserReserveData
) {
  const keys = Object.keys(actual);

  keys.forEach((key) => {
    this.assert(
      actual[key] != undefined,
      `Property ${key} is undefined in the actual data`
    );
    expect(
      expected[key] != undefined,
      `Property ${key} is undefined in the expected data`
    );

    if (expected[key] == null || actual[key] == null) {
      console.log(
        "Found a undefined value for Key ",
        key,
        " value ",
        expected[key],
        actual[key]
      );
    }

    if (
      typeof actual[key] === "bigint" ||
      (actual[key] as any) instanceof BigInt
    ) {
      const actualValue = actual[key] as bigint;
      const expectedValue = expected[key] as bigint;

      this.assert(
        actualValue == expectedValue ||
          actualValue + 1n == expectedValue ||
          actualValue == expectedValue + 1n ||
          actualValue + 2n == expectedValue ||
          actualValue == expectedValue + 2n ||
          actualValue + 3n == expectedValue ||
          actualValue == expectedValue + 3n,
        `expected #{act} to be almost equal or equal #{exp} for property ${key}`,
        `expected #{act} to be almost equal or equal #{exp} for property ${key}`,
        expectedValue.toString(),
        actualValue.toString()
      );
    } else {
      this.assert(
        actual[key] !== null &&
          expected[key] !== null &&
          actual[key].toString() === expected[key].toString(),
        `expected #{act} to be equal #{exp} for property ${key}`,
        `expected #{act} to be equal #{exp} for property ${key}`,
        expected[key],
        actual[key]
      );
    }
  });
};

chai.use(function (chai: any) {
  chai.Assertion.overwriteMethod("almostEqualOrEqual", function () {
    return function (this: any, expected: ReserveData | UserReserveData) {
      const actual = (expected as ReserveData)
        ? <ReserveData>this._obj
        : <UserReserveData>this._obj;

      almostEqualOrEqual.apply(this, [expected, actual]);
    };
  });
});

export const expectEqual = (
  actual: UserReserveData | ReserveData,
  expected: UserReserveData | ReserveData
) => {
  // @ts-expect-error Property 'almostEqualOrEqual' does not exist on type 'Assertion'.
  expect(actual).to.be.almostEqualOrEqual(expected);
};
