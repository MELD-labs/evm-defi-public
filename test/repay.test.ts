import { ethers } from "hardhat";
import {
  allocateAndApproveTokens,
  getBlockTimestamps,
  isAlmostEqual,
  setRewards,
  setUpTestFixture,
} from "./helpers/utils/utils";

import {
  ReserveData,
  UserReserveData,
  BlockTimestamps,
} from "./helpers/interfaces";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { convertToCurrencyDecimals } from "./helpers/utils/contracts-helpers";
import {
  calcExpectedReserveDataAfterRepay,
  calcExpectedUserDataAfterRepay,
  calcCompoundedInterest,
} from "./helpers/utils/calculations";
import {
  getReserveData,
  getUserData,
  expectEqual,
} from "./helpers/utils/helpers";
import { RateMode, Action, MeldBankerType } from "./helpers/types";
import { ONE_YEAR, ONE_HOUR } from "./helpers/constants";
import { ZeroAddress, MaxUint256 } from "ethers";
import { expect } from "chai";
import { ProtocolErrors } from "./helpers/types";
import {
  anyUint,
  anyValue,
} from "@nomicfoundation/hardhat-chai-matchers/withArgs";

describe("Repay", function () {
  async function setUpDepositFixture() {
    const {
      owner,
      poolAdmin,
      oracleAdmin,
      treasury,
      depositor,
      meldBanker,
      goldenBanker,
      borrower,
      borrower3,
      borrower2,
      delegatee,
      rando,
      usdc,
      meld,
      dai,
      tether,
      unsupportedToken,
      meldBankerTokenId,
      goldenBankerTokenId,
      yieldBoostStorageUSDC,
      yieldBoostStakingUSDC,
      ...contracts
    } = await setUpTestFixture();

    // Deposit liquidity

    // USDC
    const depositAmountUSDC = await allocateAndApproveTokens(
      usdc,
      owner,
      borrower,
      contracts.lendingPool,
      20000n,
      0n
    );

    await contracts.lendingPool
      .connect(borrower)
      .deposit(
        await usdc.getAddress(),
        depositAmountUSDC,
        borrower.address,
        true,
        0
      );

    const depositAmountUSDC2 = await allocateAndApproveTokens(
      usdc,
      owner,
      borrower2,
      contracts.lendingPool,
      5000n,
      0n
    );

    await contracts.lendingPool
      .connect(borrower2)
      .deposit(
        await usdc.getAddress(),
        depositAmountUSDC2,
        borrower2.address,
        true,
        0
      );

    // DAI
    const depositAmountDAI = await allocateAndApproveTokens(
      dai,
      owner,
      borrower3,
      contracts.lendingPool,
      2000n,
      0n
    );

    await contracts.lendingPool
      .connect(borrower3)
      .deposit(
        await dai.getAddress(),
        depositAmountDAI,
        borrower3.address,
        true,
        0
      );

    // MELD
    // Approve double the amount to be deposited to test the max amount.
    const depositAmountMELD = await allocateAndApproveTokens(
      meld,
      owner,
      depositor,
      contracts.lendingPool,
      10000n,
      2n
    );

    const depositMELDTx = await contracts.lendingPool
      .connect(depositor)
      .deposit(
        await meld.getAddress(),
        depositAmountMELD,
        depositor.address,
        true,
        0
      );

    await expect(depositMELDTx)
      .to.emit(contracts.lendingPool, "ReserveUsedAsCollateralEnabled")
      .withArgs(await meld.getAddress(), depositor.address);

    // USDT
    const depositAmountTether = await allocateAndApproveTokens(
      tether,
      owner,
      depositor,
      contracts.lendingPool,
      50000n,
      0n
    );

    const depositTetherTx = await contracts.lendingPool
      .connect(depositor)
      .deposit(
        await tether.getAddress(),
        depositAmountTether,
        depositor.address,
        true,
        0
      );

    await expect(depositTetherTx)
      .to.emit(contracts.lendingPool, "ReserveUsedAsCollateralEnabled")
      .withArgs(await tether.getAddress(), depositor.address);

    return {
      owner,
      poolAdmin,
      oracleAdmin,
      treasury,
      depositor,
      meldBanker,
      goldenBanker,
      borrower,
      borrower3,
      borrower2,
      delegatee,
      rando,
      usdc,
      meld,
      dai,
      tether,
      unsupportedToken,
      meldBankerTokenId,
      goldenBankerTokenId,
      yieldBoostStorageUSDC,
      yieldBoostStakingUSDC,
      ...contracts,
    };
  }

  async function setUpSingleVariableBorrowMELDFixture() {
    const {
      owner,
      poolAdmin,
      oracleAdmin,
      treasury,
      depositor,
      borrower,
      borrower3,
      borrower2,
      delegatee,
      rando,
      usdc,
      meld,
      dai,
      tether,
      unsupportedToken,
      ...contracts
    } = await loadFixture(setUpDepositFixture);

    // Borrow borrows MELD from the lending pool
    const borrowAmount = await convertToCurrencyDecimals(
      await meld.getAddress(),
      "2000"
    );

    const borrowTx = await contracts.lendingPool
      .connect(borrower)
      .borrow(
        await meld.getAddress(),
        borrowAmount,
        RateMode.Variable,
        borrower.address,
        0
      );

    // The Borrow event is emitted by the BorrowLogic.sol library, so we need to get the contract instance with the BorrowLogic ABI
    const contractInstanceWithBorrowLibraryABI = await ethers.getContractAt(
      "BorrowLogic",
      await contracts.lendingPool.getAddress(),
      owner
    );

    await expect(borrowTx)
      .to.emit(contractInstanceWithBorrowLibraryABI, "Borrow")
      .withArgs(
        await meld.getAddress(),
        borrower.address,
        borrower.address,
        borrowAmount,
        RateMode.Variable,
        anyValue
      );

    // Borrower already has the amount borrowed. Make sure borrower has enough to pay off debt in test cases and has approved the lending pool to spend tokens.
    // In real life, the borrower would have to get these funds from somewhere.
    await allocateAndApproveTokens(
      meld,
      owner,
      borrower,
      contracts.lendingPool,
      2000n * 2n, // 2x the amount borrowed
      0n
    );

    return {
      owner,
      poolAdmin,
      oracleAdmin,
      treasury,
      depositor,
      borrower,
      borrower3,
      borrower2,
      delegatee,
      rando,
      usdc,
      meld,
      dai,
      tether,
      unsupportedToken,
      ...contracts,
    };
  }

  async function setUpSingleVariableBorrowTetherFixture() {
    const {
      lendingPool,
      meldProtocolDataProvider,
      reserveLogic,
      lendingRateOracleAggregator,
      meldLendingRateOracle,
      unsupportedToken,
      tether,
      owner,
      borrower,
      borrower2,
      rando,
      treasury,
    } = await loadFixture(setUpDepositFixture);

    // Borrow borrows USDT from the lending pool
    const borrowAmount = await convertToCurrencyDecimals(
      await tether.getAddress(),
      "1250"
    );

    const borrowTx = await lendingPool
      .connect(borrower)
      .borrow(
        await tether.getAddress(),
        borrowAmount,
        RateMode.Variable,
        borrower.address,
        0
      );

    // The Borrow event is emitted by the BorrowLogic.sol library, so we need to get the contract instance with the BorrowLogic ABI
    const contractInstanceWithBorrowLibraryABI = await ethers.getContractAt(
      "BorrowLogic",
      await lendingPool.getAddress(),
      owner
    );

    await expect(borrowTx)
      .to.emit(contractInstanceWithBorrowLibraryABI, "Borrow")
      .withArgs(
        await tether.getAddress(),
        borrower.address,
        borrower.address,
        borrowAmount,
        RateMode.Variable,
        anyValue
      );

    // Borrower already has the amount borrowed. Make sure borrower has enough to pay off debt in test cases and has approved the lending pool to spend tokens.
    // In real life, the borrower would have to get these funds from somewhere.
    await allocateAndApproveTokens(
      tether,
      owner,
      borrower,
      lendingPool,
      1250n * 2n, // 2x the amount borrowed
      0n
    );

    return {
      lendingPool,
      meldProtocolDataProvider,
      reserveLogic,
      lendingRateOracleAggregator,
      meldLendingRateOracle,
      unsupportedToken,
      tether,
      borrowAmount,
      borrower,
      borrower2,
      owner,
      rando,
      treasury,
    };
  }

  async function setUpSingleStableBorrowMELDFixture() {
    const {
      lendingPool,
      meldProtocolDataProvider,
      reserveLogic,
      lendingRateOracleAggregator,
      meldLendingRateOracle,
      unsupportedToken,
      meld,
      usdc,
      owner,
      borrower,
      borrower2,
      rando,
    } = await loadFixture(setUpDepositFixture);

    // Borrow borrows MELD from the lending pool
    const borrowAmount = await convertToCurrencyDecimals(
      await meld.getAddress(),
      "2000"
    );

    const borrowTx = await lendingPool
      .connect(borrower)
      .borrow(
        await meld.getAddress(),
        borrowAmount,
        RateMode.Stable,
        borrower.address,
        0
      );

    // The Borrow event is emitted by the BorrowLogic.sol library, so we need to get the contract instance with the BorrowLogic ABI
    const contractInstanceWithBorrowLibraryABI = await ethers.getContractAt(
      "BorrowLogic",
      await lendingPool.getAddress(),
      owner
    );

    await expect(borrowTx)
      .to.emit(contractInstanceWithBorrowLibraryABI, "Borrow")
      .withArgs(
        await meld.getAddress(),
        borrower.address,
        borrower.address,
        borrowAmount,
        RateMode.Stable,
        anyValue
      );

    // Borrower already has the amount borrowed. Make sure borrower has enough to pay off debt in test cases and has approved the lending pool to spend tokens.
    // In real life, the borrower would have to get these funds from somewhere.
    await allocateAndApproveTokens(
      meld,
      owner,
      borrower,
      lendingPool,
      2000n * 2n, // 2x the amount borrowed
      0n
    );

    return {
      lendingPool,
      meldProtocolDataProvider,
      reserveLogic,
      lendingRateOracleAggregator,
      meldLendingRateOracle,
      unsupportedToken,
      meld,
      usdc,
      borrowAmount,
      owner,
      borrower,
      borrower2,
      rando,
    };
  }

  async function setUpSingleStableBorrowTetherFixture() {
    const {
      lendingPool,
      meldProtocolDataProvider,
      reserveLogic,
      lendingRateOracleAggregator,
      meldLendingRateOracle,
      unsupportedToken,
      tether,
      dai,
      owner,
      borrower,
      borrower2,
      rando,
      treasury,
    } = await loadFixture(setUpDepositFixture);

    // Borrower borrows USDT from the lending pool
    const borrowAmount = await convertToCurrencyDecimals(
      await tether.getAddress(),
      "1250"
    );

    const borrowTx = await lendingPool
      .connect(borrower)
      .borrow(
        await tether.getAddress(),
        borrowAmount,
        RateMode.Stable,
        borrower.address,
        0
      );

    // The Borrow event is emitted by the BorrowLogic.sol library, so we need to get the contract instance with the BorrowLogic ABI
    const contractInstanceWithBorrowLibraryABI = await ethers.getContractAt(
      "BorrowLogic",
      await lendingPool.getAddress(),
      owner
    );

    await expect(borrowTx)
      .to.emit(contractInstanceWithBorrowLibraryABI, "Borrow")
      .withArgs(
        await tether.getAddress(),
        borrower.address,
        borrower.address,
        borrowAmount,
        RateMode.Stable,
        anyValue
      );

    // Borrower already has the amount borrowed. Make sure borrower has enough to pay off debt in test cases and has approved the lending pool to spend tokens.
    // In real life, the borrower would have to get these funds from somewhere
    await allocateAndApproveTokens(
      tether,
      owner,
      borrower,
      lendingPool,
      1250n * 2n, // 2x the amount borrowed
      0n
    );

    return {
      lendingPool,
      meldProtocolDataProvider,
      reserveLogic,
      lendingRateOracleAggregator,
      meldLendingRateOracle,
      unsupportedToken,
      tether,
      dai,
      borrowAmount,
      borrower,
      borrower2,
      owner,
      rando,
      treasury,
    };
  }

  async function setUpMeldBankersBorrowFixture() {
    const {
      owner,
      poolAdmin,
      oracleAdmin,
      treasury,
      depositor,
      meldBanker,
      goldenBanker,
      borrower3,
      delegatee,
      rando,
      usdc,
      meld,
      dai,
      tether,
      unsupportedToken,
      meldBankerTokenId,
      goldenBankerTokenId,
      ...contracts
    } = await setUpTestFixture();

    // Deposit liquidity

    // Golden banker deposits MELD without NFT
    const depositAmountMELD = await allocateAndApproveTokens(
      meld,
      owner,
      goldenBanker,
      contracts.lendingPool,
      20_000n,
      0n
    );

    await contracts.lendingPool
      .connect(goldenBanker)
      .deposit(
        await meld.getAddress(),
        depositAmountMELD,
        goldenBanker.address,
        true,
        0n
      );

    // MELD banker deposits MELD without NFT
    const depositAmountMELD2 = await allocateAndApproveTokens(
      meld,
      owner,
      meldBanker,
      contracts.lendingPool,
      5_000n,
      0n
    );

    await contracts.lendingPool
      .connect(meldBanker)
      .deposit(
        await meld.getAddress(),
        depositAmountMELD2,
        meldBanker.address,
        true,
        0n
      );

    // DAI
    const depositAmountDAI = await allocateAndApproveTokens(
      dai,
      owner,
      borrower3,
      contracts.lendingPool,
      2_000n,
      0n
    );

    await contracts.lendingPool
      .connect(borrower3)
      .deposit(
        await dai.getAddress(),
        depositAmountDAI,
        borrower3.address,
        true,
        0
      );

    // USDC liquidity
    // Approve double the amount to be deposited to test the max amount.
    const depositAmountUSDC = await allocateAndApproveTokens(
      usdc,
      owner,
      depositor,
      contracts.lendingPool,
      10_000n,
      2n
    );

    const depositMELDTx = await contracts.lendingPool
      .connect(depositor)
      .deposit(
        await usdc.getAddress(),
        depositAmountUSDC,
        depositor.address,
        true,
        0
      );

    await expect(depositMELDTx)
      .to.emit(contracts.lendingPool, "ReserveUsedAsCollateralEnabled")
      .withArgs(await usdc.getAddress(), depositor.address);

    // USDT liquidity
    const depositAmountTether = await allocateAndApproveTokens(
      tether,
      owner,
      depositor,
      contracts.lendingPool,
      50_000n,
      0n
    );

    const depositTetherTx = await contracts.lendingPool
      .connect(depositor)
      .deposit(
        await tether.getAddress(),
        depositAmountTether,
        depositor.address,
        true,
        0
      );

    await expect(depositTetherTx)
      .to.emit(contracts.lendingPool, "ReserveUsedAsCollateralEnabled")
      .withArgs(await tether.getAddress(), depositor.address);

    // Borrow - Meld Banker
    const borrowAmountMeldBankerUSDC = await convertToCurrencyDecimals(
      await usdc.getAddress(),
      "1000"
    );

    await contracts.lendingPool
      .connect(meldBanker)
      .borrow(
        await usdc.getAddress(),
        borrowAmountMeldBankerUSDC,
        RateMode.Variable,
        meldBanker.address,
        meldBankerTokenId
      );

    // Borrow - Golden Banker
    const borrowAmountGoldenBankerUSDC = await convertToCurrencyDecimals(
      await usdc.getAddress(),
      "1000"
    );

    await contracts.lendingPool
      .connect(goldenBanker)
      .borrow(
        await usdc.getAddress(),
        borrowAmountGoldenBankerUSDC,
        RateMode.Variable,
        goldenBanker.address,
        goldenBankerTokenId
      );

    // Borrower already has the amount borrowed. Make sure borrower has enough to pay off debt in test cases and has approved the lending pool to spend tokens.
    // In real life, the borrower would have to get these funds from somewhere.
    await allocateAndApproveTokens(
      usdc,
      owner,
      meldBanker,
      contracts.lendingPool,
      1000n * 2n, // 2x the amount borrowed
      0n
    );

    await allocateAndApproveTokens(
      usdc,
      owner,
      goldenBanker,
      contracts.lendingPool,
      1000n * 2n, // 2x the amount borrowed
      0n
    );

    return {
      ...contracts,
      usdc,
      unsupportedToken,
      meld,
      tether,
      dai,
      depositAmountMELD,
      depositAmountMELD2,
      borrowAmountMeldBankerUSDC,
      borrowAmountGoldenBankerUSDC,
      owner,
      poolAdmin,
      oracleAdmin,
      treasury,
      depositor,
      meldBanker,
      goldenBanker,
      delegatee,
      rando,
      meldBankerTokenId,
      goldenBankerTokenId,
    };
  }

  context("Happy Flow Test Cases", async function () {
    context("Regular User", async function () {
      context("Repay Single Stable Borrow", async function () {
        it("Should emit correct events when reserve factor == 0", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meld,
            owner,
            borrower,
          } = await loadFixture(setUpSingleStableBorrowMELDFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR / 12);

          // Get reserve data before repaying
          const reserveDataBeforeRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before repaying
          const userDataBeforeRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await meld.getAddress(),
            borrower.address
          );

          const mMELD = await ethers.getContractAt(
            "MToken",
            reserveDataBeforeRepay.mTokenAddress
          );

          const stableDebtToken = await ethers.getContractAt(
            "StableDebtToken",
            reserveDataBeforeRepay.stableDebtTokenAddress
          );

          const repaymentAmount = await convertToCurrencyDecimals(
            await meld.getAddress(),
            "1000" // half of borrowed principal
          );

          // Repay partial debt
          const repayTx = await lendingPool
            .connect(borrower)
            .repay(
              await meld.getAddress(),
              repaymentAmount,
              RateMode.Stable,
              borrower.address
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(repayTx);

          // Calculate expected reserve data after repaying
          const expectedReserveDataAfterRepay: ReserveData =
            calcExpectedReserveDataAfterRepay(
              repaymentAmount,
              RateMode.Stable,
              reserveDataBeforeRepay,
              userDataBeforeRepay,
              blockTimestamps.txTimestamp
            );

          const expectedAccumulatedInterest = calcCompoundedInterest(
            userDataBeforeRepay.stableBorrowRate,
            blockTimestamps.latestBlockTimestamp,
            userDataBeforeRepay.stableRateLastUpdated
          );

          const expectedCurrentBalance =
            userDataBeforeRepay.principalStableDebt.rayMul(
              expectedAccumulatedInterest
            );
          const expectedIncrease =
            expectedCurrentBalance - userDataBeforeRepay.principalStableDebt;

          // Check that the correct events were emitted
          await expect(repayTx)
            .to.emit(stableDebtToken, "Transfer")
            .withArgs(borrower.address, ZeroAddress, repaymentAmount);

          await expect(repayTx)
            .to.emit(stableDebtToken, "Burn")
            .withArgs(
              borrower.address,
              repaymentAmount - expectedIncrease,
              expectedCurrentBalance,
              expectedIncrease,
              expectedReserveDataAfterRepay.averageStableBorrowRate,
              expectedReserveDataAfterRepay.totalStableDebt
            );

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          await expect(repayTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await meld.getAddress(),
              expectedReserveDataAfterRepay.liquidityRate,
              isAlmostEqual(expectedReserveDataAfterRepay.stableBorrowRate),
              isAlmostEqual(expectedReserveDataAfterRepay.variableBorrowRate),
              expectedReserveDataAfterRepay.liquidityIndex,
              expectedReserveDataAfterRepay.variableBorrowIndex
            );

          await expect(repayTx)
            .to.emit(meld, "Transfer")
            .withArgs(
              borrower.address,
              await mMELD.getAddress(),
              repaymentAmount
            );

          // The Repay event is emitted by the RepayLogic.sol library, so we need to get the contract instance with the RepayLogic ABI
          const contractInstanceWithRepayLibraryABI =
            await ethers.getContractAt(
              "RepayLogic",
              await lendingPool.getAddress(),
              owner
            );

          await expect(repayTx)
            .to.emit(contractInstanceWithRepayLibraryABI, "Repay")
            .withArgs(
              await meld.getAddress(),
              borrower.address,
              borrower.address,
              repaymentAmount
            );

          await expect(repayTx).to.not.emit(mMELD, "Transfer");
          await expect(repayTx).to.not.emit(mMELD, "Mint");
          await expect(repayTx).to.not.emit(stableDebtToken, "Mint");
        });

        it("Should emit correct events when reserve factor > 0 and amountToMint == 0 and repayment amount is MaxUnit256", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            tether,
            owner,
            borrower,
          } = await loadFixture(setUpSingleStableBorrowTetherFixture);

          // Get reserve data before repaying
          const reserveDataBeforeRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await tether.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before repaying
          const userDataBeforeRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await tether.getAddress(),
            borrower.address
          );

          // Instantiate reserve token contracts for borrower's collateral
          const reserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await tether.getAddress()
            );

          const mUSDT = await ethers.getContractAt(
            "MToken",
            reserveTokenAddresses.mTokenAddress
          );

          const stableDebtToken = await ethers.getContractAt(
            "StableDebtToken",
            reserveTokenAddresses.stableDebtTokenAddress
          );

          // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
          time.setNextBlockTimestamp(await time.latest());

          // Repay full debt
          const repayTx = await lendingPool.connect(borrower).repay(
            await tether.getAddress(),
            MaxUint256, // flag for full debt repayment
            RateMode.Stable,
            borrower.address
          );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(repayTx);

          // Calculate expected reserve data after repaying
          const expectedReserveDataAfterRepay: ReserveData =
            calcExpectedReserveDataAfterRepay(
              MaxUint256,
              RateMode.Stable,
              reserveDataBeforeRepay,
              userDataBeforeRepay,
              blockTimestamps.txTimestamp
            );

          const expectedAccumulatedInterest = calcCompoundedInterest(
            userDataBeforeRepay.stableBorrowRate,
            blockTimestamps.latestBlockTimestamp,
            userDataBeforeRepay.stableRateLastUpdated
          );

          const expectedCurrentBalance =
            userDataBeforeRepay.principalStableDebt.rayMul(
              expectedAccumulatedInterest
            );
          const expectedIncrease =
            expectedCurrentBalance - userDataBeforeRepay.principalStableDebt;

          // Check that the correct events were emitted
          await expect(repayTx)
            .to.emit(stableDebtToken, "Transfer")
            .withArgs(
              borrower.address,
              ZeroAddress,
              isAlmostEqual(userDataBeforeRepay.currentStableDebt)
            );

          await expect(repayTx)
            .to.emit(stableDebtToken, "Burn")
            .withArgs(
              borrower.address,
              isAlmostEqual(
                userDataBeforeRepay.currentStableDebt - expectedIncrease
              ),
              expectedCurrentBalance,
              expectedIncrease,
              expectedReserveDataAfterRepay.averageStableBorrowRate,
              expectedReserveDataAfterRepay.totalStableDebt
            );

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          await expect(repayTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await tether.getAddress(),
              expectedReserveDataAfterRepay.liquidityRate,
              isAlmostEqual(expectedReserveDataAfterRepay.stableBorrowRate),
              isAlmostEqual(expectedReserveDataAfterRepay.variableBorrowRate),
              expectedReserveDataAfterRepay.liquidityIndex,
              expectedReserveDataAfterRepay.variableBorrowIndex
            );

          await expect(repayTx)
            .to.emit(tether, "Transfer")
            .withArgs(
              borrower.address,
              await mUSDT.getAddress(),
              isAlmostEqual(userDataBeforeRepay.currentStableDebt)
            );

          // The Repay event is emitted by the RepayLogic.sol library, so we need to get the contract instance with the RepayLogic ABI
          const contractInstanceWithRepayLibraryABI =
            await ethers.getContractAt(
              "RepayLogic",
              await lendingPool.getAddress(),
              owner
            );

          await expect(repayTx)
            .to.emit(contractInstanceWithRepayLibraryABI, "Repay")
            .withArgs(
              await tether.getAddress(),
              borrower.address,
              borrower.address,
              isAlmostEqual(userDataBeforeRepay.currentStableDebt)
            );

          await expect(repayTx).to.not.emit(mUSDT, "Transfer");
          await expect(repayTx).to.not.emit(mUSDT, "Mint");
          await expect(repayTx).to.not.emit(stableDebtToken, "Mint");
        });

        it("Should emit correct events when reserve factor > 0 and amountToMint > 0", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            tether,
            owner,
            borrower,
            treasury,
            borrowAmount,
          } = await loadFixture(setUpSingleStableBorrowTetherFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR);

          // Get reserve data before repaying
          const reserveDataBeforeRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await tether.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before repaying
          const userDataBeforeRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await tether.getAddress(),
            borrower.address
          );

          const mUSDT = await ethers.getContractAt(
            "MToken",
            reserveDataBeforeRepay.mTokenAddress
          );

          const stableDebtToken = await ethers.getContractAt(
            "StableDebtToken",
            reserveDataBeforeRepay.stableDebtTokenAddress
          );

          const repaymentAmount = await convertToCurrencyDecimals(
            await tether.getAddress(),
            "100" // part of borrowed amount
          );

          // Repay partial debt
          const repayTx = await lendingPool
            .connect(borrower)
            .repay(
              await tether.getAddress(),
              repaymentAmount,
              RateMode.Stable,
              borrower.address
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(repayTx);

          // Calculate expected reserve data after repaying
          const expectedReserveDataAfterRepay: ReserveData =
            calcExpectedReserveDataAfterRepay(
              repaymentAmount,
              RateMode.Stable,
              reserveDataBeforeRepay,
              userDataBeforeRepay,
              blockTimestamps.txTimestamp
            );

          const expectedAccumulatedInterest = calcCompoundedInterest(
            userDataBeforeRepay.stableBorrowRate,
            blockTimestamps.latestBlockTimestamp,
            userDataBeforeRepay.stableRateLastUpdated
          );

          const expectedCurrentBalance =
            userDataBeforeRepay.principalStableDebt.rayMul(
              expectedAccumulatedInterest
            );
          const expectedIncrease =
            expectedCurrentBalance - userDataBeforeRepay.principalStableDebt;

          // Check that the correct events were emitted
          await expect(repayTx)
            .to.emit(stableDebtToken, "Transfer")
            .withArgs(borrower.address, ZeroAddress, repaymentAmount);

          await expect(repayTx)
            .to.emit(stableDebtToken, "Burn")
            .withArgs(
              borrower.address,
              repaymentAmount - expectedIncrease,
              expectedCurrentBalance,
              expectedIncrease,
              anyUint, // Should be expectedReserveDataAfterRepay.averageStableBorrowRate, but due to differences TS vs solidity math, they're not the same
              expectedReserveDataAfterRepay.totalStableDebt
            );

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          await expect(repayTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await tether.getAddress(),
              anyUint, // Should be expectedReserveDataAfterRepay.averageStableBorrowRate, but due to differences TS vs solidity math, they're not the same
              isAlmostEqual(expectedReserveDataAfterRepay.stableBorrowRate),
              isAlmostEqual(expectedReserveDataAfterRepay.variableBorrowRate),
              expectedReserveDataAfterRepay.liquidityIndex,
              expectedReserveDataAfterRepay.variableBorrowIndex
            );

          await expect(repayTx)
            .to.emit(tether, "Transfer")
            .withArgs(
              borrower.address,
              await mUSDT.getAddress(),
              repaymentAmount
            );

          // The Repay event is emitted by the RepayLogic.sol library, so we need to get the contract instance with the RepayLogic ABI
          const contractInstanceWithRepayLibraryABI =
            await ethers.getContractAt(
              "RepayLogic",
              await lendingPool.getAddress(),
              owner
            );

          await expect(repayTx)
            .to.emit(contractInstanceWithRepayLibraryABI, "Repay")
            .withArgs(
              await tether.getAddress(),
              borrower.address,
              borrower.address,
              repaymentAmount
            );

          const currentVariableDebt = BigInt(0);
          const previousVariableDebt = BigInt(0);
          const currentStableDebt = BigInt(
            reserveDataBeforeRepay.totalStableDebt
          ); // The mint to treasury happens before debt token burning
          const previousStableDebt = BigInt(borrowAmount); // This is the amount borrowed in the borrow transaction

          const totalDebtAccrued =
            currentVariableDebt +
            currentStableDebt -
            previousVariableDebt -
            previousStableDebt;

          const { reserveFactor } =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await tether.getAddress()
            );
          const amountToMint = totalDebtAccrued.percentMul(
            BigInt(reserveFactor)
          );

          await expect(repayTx)
            .to.emit(mUSDT, "Transfer")
            .withArgs(ZeroAddress, treasury.address, amountToMint);

          await expect(repayTx)
            .to.emit(mUSDT, "Mint")
            .withArgs(
              treasury.address,
              isAlmostEqual(amountToMint),
              expectedReserveDataAfterRepay.liquidityIndex
            );

          await expect(repayTx).to.not.emit(stableDebtToken, "Mint");
        });

        it("Should emit correct events if repayment amount is more than debt owed", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            tether,
            owner,
            borrower,
          } = await loadFixture(setUpSingleStableBorrowTetherFixture);

          // Get reserve data before repaying
          const reserveDataBeforeRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await tether.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before repaying
          const userDataBeforeRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await tether.getAddress(),
            borrower.address
          );

          // userDataBeforeRepay.currentStableDebt == current stable debt owed, including interest
          const repaymentAmount =
            userDataBeforeRepay.currentStableDebt +
            10n ** reserveDataBeforeRepay.decimals;

          const mUSDT = await ethers.getContractAt(
            "MToken",
            reserveDataBeforeRepay.mTokenAddress
          );

          const stableDebtToken = await ethers.getContractAt(
            "StableDebtToken",
            reserveDataBeforeRepay.stableDebtTokenAddress
          );

          // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
          time.setNextBlockTimestamp(await time.latest());

          // Repay more than debt owed
          const repayTx = await lendingPool
            .connect(borrower)
            .repay(
              await tether.getAddress(),
              repaymentAmount,
              RateMode.Stable,
              borrower.address
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(repayTx);

          // Calculate expected reserve data after repaying
          const expectedReserveDataAfterRepay: ReserveData =
            calcExpectedReserveDataAfterRepay(
              repaymentAmount,
              RateMode.Stable,
              reserveDataBeforeRepay,
              userDataBeforeRepay,
              blockTimestamps.txTimestamp
            );

          const expectedAccumulatedInterest = calcCompoundedInterest(
            userDataBeforeRepay.stableBorrowRate,
            blockTimestamps.latestBlockTimestamp,
            userDataBeforeRepay.stableRateLastUpdated
          );

          const expectedCurrentBalance =
            userDataBeforeRepay.principalStableDebt.rayMul(
              expectedAccumulatedInterest
            );
          const expectedIncrease =
            expectedCurrentBalance - userDataBeforeRepay.principalStableDebt;

          // Check that the correct events were emitted
          await expect(repayTx)
            .to.emit(stableDebtToken, "Transfer")
            .withArgs(
              borrower.address,
              ZeroAddress,
              userDataBeforeRepay.currentStableDebt
            );

          await expect(repayTx)
            .to.emit(stableDebtToken, "Burn")
            .withArgs(
              borrower.address,
              expectedCurrentBalance - expectedIncrease,
              expectedCurrentBalance,
              expectedIncrease,
              expectedReserveDataAfterRepay.averageStableBorrowRate,
              expectedReserveDataAfterRepay.totalStableDebt
            );

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          await expect(repayTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await tether.getAddress(),
              expectedReserveDataAfterRepay.liquidityRate,
              isAlmostEqual(expectedReserveDataAfterRepay.stableBorrowRate),
              isAlmostEqual(expectedReserveDataAfterRepay.variableBorrowRate),
              expectedReserveDataAfterRepay.liquidityIndex,
              expectedReserveDataAfterRepay.variableBorrowIndex
            );

          await expect(repayTx)
            .to.emit(tether, "Transfer")
            .withArgs(
              borrower.address,
              await mUSDT.getAddress(),
              isAlmostEqual(userDataBeforeRepay.currentStableDebt)
            );

          // The Repay event is emitted by the RepayLogic.sol library, so we need to get the contract instance with the RepayLogic ABI
          const contractInstanceWithRepayLibraryABI =
            await ethers.getContractAt(
              "RepayLogic",
              await lendingPool.getAddress(),
              owner
            );

          await expect(repayTx)
            .to.emit(contractInstanceWithRepayLibraryABI, "Repay")
            .withArgs(
              await tether.getAddress(),
              borrower.address,
              borrower.address,
              isAlmostEqual(userDataBeforeRepay.currentStableDebt)
            );

          await expect(repayTx).to.not.emit(mUSDT, "Transfer");
          await expect(repayTx).to.not.emit(mUSDT, "Mint");
          await expect(repayTx).to.not.emit(stableDebtToken, "Mint");
        });

        it("Should emit correct events if another user repays debt on behalf of borrower", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meld,
            owner,
            borrower,
            rando,
          } = await loadFixture(setUpSingleStableBorrowMELDFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR * 1.5);

          // Get reserve data before repaying
          const reserveDataBeforeRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          const mMELD = await ethers.getContractAt(
            "MToken",
            reserveDataBeforeRepay.mTokenAddress
          );

          const stableDebtToken = await ethers.getContractAt(
            "StableDebtToken",
            reserveDataBeforeRepay.stableDebtTokenAddress
          );

          // Half of borrower's principal debt
          const repaymentAmount = await allocateAndApproveTokens(
            meld,
            owner,
            rando,
            lendingPool,
            1000n,
            0n
          );

          // Get user reserve data before repaying
          const userDataBeforeRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await meld.getAddress(),
            borrower.address
          );

          // Repay partial debt
          const repayTx = await lendingPool
            .connect(rando)
            .repay(
              await meld.getAddress(),
              repaymentAmount,
              RateMode.Stable,
              borrower.address
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(repayTx);

          // Calculate expected reserve data after repaying
          const expectedReserveDataAfterRepay: ReserveData =
            calcExpectedReserveDataAfterRepay(
              repaymentAmount,
              RateMode.Stable,
              reserveDataBeforeRepay,
              userDataBeforeRepay,
              blockTimestamps.txTimestamp
            );

          const expectedAccumulatedInterest = calcCompoundedInterest(
            userDataBeforeRepay.stableBorrowRate,
            blockTimestamps.latestBlockTimestamp,
            userDataBeforeRepay.stableRateLastUpdated
          );

          const expectedCurrentBalance =
            userDataBeforeRepay.principalStableDebt.rayMul(
              expectedAccumulatedInterest
            );
          const expectedIncrease =
            expectedCurrentBalance - userDataBeforeRepay.principalStableDebt;

          // Check that the correct events were emitted
          await expect(repayTx)
            .to.emit(stableDebtToken, "Transfer")
            .withArgs(borrower.address, ZeroAddress, repaymentAmount);

          await expect(repayTx)
            .to.emit(stableDebtToken, "Burn")
            .withArgs(
              borrower.address,
              repaymentAmount - expectedIncrease,
              expectedCurrentBalance,
              expectedIncrease,
              expectedReserveDataAfterRepay.averageStableBorrowRate,
              expectedReserveDataAfterRepay.totalStableDebt
            );

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          await expect(repayTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await meld.getAddress(),
              expectedReserveDataAfterRepay.liquidityRate,
              isAlmostEqual(expectedReserveDataAfterRepay.stableBorrowRate),
              isAlmostEqual(expectedReserveDataAfterRepay.variableBorrowRate),
              expectedReserveDataAfterRepay.liquidityIndex,
              expectedReserveDataAfterRepay.variableBorrowIndex
            );

          await expect(repayTx)
            .to.emit(meld, "Transfer")
            .withArgs(rando.address, await mMELD.getAddress(), repaymentAmount);

          // The Repay event is emitted by the RepayLogic.sol library, so we need to get the contract instance with the RepayLogic ABI
          const contractInstanceWithRepayLibraryABI =
            await ethers.getContractAt(
              "RepayLogic",
              await lendingPool.getAddress(),
              owner
            );

          await expect(repayTx)
            .to.emit(contractInstanceWithRepayLibraryABI, "Repay")
            .withArgs(
              await meld.getAddress(),
              borrower.address,
              rando.address,
              repaymentAmount
            );

          await expect(repayTx).to.not.emit(mMELD, "Transfer");
          await expect(repayTx).to.not.emit(mMELD, "Mint");
          await expect(repayTx).to.not.emit(stableDebtToken, "Mint");
        });

        it("Should emit correct events when balance increase > repayment amount", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meld,
            owner,
            borrower,
          } = await loadFixture(setUpSingleStableBorrowMELDFixture);
          // The StableDebtToken burn function can actually mint tokens under some circumstances (balance increase > repayment amount)

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR * 2);

          // Get reserve data before repaying
          const reserveDataBeforeRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before repaying
          const userDataBeforeRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await meld.getAddress(),
            borrower.address
          );

          const mMELD = await ethers.getContractAt(
            "MToken",
            reserveDataBeforeRepay.mTokenAddress
          );

          const stableDebtToken = await ethers.getContractAt(
            "StableDebtToken",
            reserveDataBeforeRepay.stableDebtTokenAddress
          );

          const repaymentAmount = await convertToCurrencyDecimals(
            await meld.getAddress(),
            "100" // part of borrowed amount
          );

          // Repay partial debt
          const repayTx = await lendingPool
            .connect(borrower)
            .repay(
              await meld.getAddress(),
              repaymentAmount,
              RateMode.Stable,
              borrower.address
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(repayTx);

          // Calculate expected reserve data after repaying
          const expectedReserveDataAfterRepay: ReserveData =
            calcExpectedReserveDataAfterRepay(
              repaymentAmount,
              RateMode.Stable,
              reserveDataBeforeRepay,
              userDataBeforeRepay,
              blockTimestamps.txTimestamp
            );

          // Calculate expected user data after repaying
          const expectedUserDataAfterRepay: UserReserveData =
            calcExpectedUserDataAfterRepay(
              repaymentAmount,
              RateMode.Stable,
              reserveDataBeforeRepay,
              expectedReserveDataAfterRepay,
              userDataBeforeRepay,
              borrower.address,
              borrower.address,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          const expectedAccumulatedInterest = calcCompoundedInterest(
            userDataBeforeRepay.stableBorrowRate,
            blockTimestamps.latestBlockTimestamp,
            userDataBeforeRepay.stableRateLastUpdated
          );

          const expectedCurrentBalance =
            userDataBeforeRepay.principalStableDebt.rayMul(
              expectedAccumulatedInterest
            );
          const expectedIncrease =
            expectedCurrentBalance - userDataBeforeRepay.principalStableDebt;

          // Check that the correct events were emitted
          await expect(repayTx)
            .to.emit(stableDebtToken, "Transfer")
            .withArgs(borrower.address, ZeroAddress, repaymentAmount);

          await expect(repayTx)
            .to.emit(stableDebtToken, "Mint")
            .withArgs(
              borrower.address,
              borrower.address,
              expectedIncrease - repaymentAmount,
              expectedCurrentBalance,
              expectedIncrease,
              expectedUserDataAfterRepay.stableBorrowRate,
              expectedReserveDataAfterRepay.averageStableBorrowRate,
              expectedReserveDataAfterRepay.principalStableDebt
            );

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          await expect(repayTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await meld.getAddress(),
              expectedReserveDataAfterRepay.liquidityRate,
              isAlmostEqual(expectedReserveDataAfterRepay.stableBorrowRate),
              isAlmostEqual(expectedReserveDataAfterRepay.variableBorrowRate),
              expectedReserveDataAfterRepay.liquidityIndex,
              expectedReserveDataAfterRepay.variableBorrowIndex
            );

          await expect(repayTx)
            .to.emit(meld, "Transfer")
            .withArgs(
              borrower.address,
              await mMELD.getAddress(),
              repaymentAmount
            );

          // The Repay event is emitted by the RepayLogic.sol library, so we need to get the contract instance with the RepayLogic ABI
          const contractInstanceWithRepayLibraryABI =
            await ethers.getContractAt(
              "RepayLogic",
              await lendingPool.getAddress(),
              owner
            );

          await expect(repayTx)
            .to.emit(contractInstanceWithRepayLibraryABI, "Repay")
            .withArgs(
              await meld.getAddress(),
              borrower.address,
              borrower.address,
              repaymentAmount
            );

          await expect(repayTx).to.not.emit(mMELD, "Transfer");
          await expect(repayTx).to.not.emit(mMELD, "Mint");
          await expect(repayTx).to.not.emit(stableDebtToken, "Burn");
        });

        it("Should update state correctly for partial repayment", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meld,
            borrower,
          } = await loadFixture(setUpSingleStableBorrowMELDFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR / 2);

          // Get reserve data before repaying
          const reserveDataBeforeRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before repaying
          const userDataBeforeRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await meld.getAddress(),
            borrower.address
          );

          const repaymentAmount = await convertToCurrencyDecimals(
            await meld.getAddress(),
            "1000" // half of borrowed principal
          );

          // Repay partial debt
          const repayTx = await lendingPool
            .connect(borrower)
            .repay(
              await meld.getAddress(),
              repaymentAmount,
              RateMode.Stable,
              borrower.address
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(repayTx);

          // Get reserve data after repaying
          const reserveDataAfterRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data after repaying
          const userDataAfterRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await meld.getAddress(),
            borrower.address
          );

          // Calculate expected reserve data after repaying
          const expectedReserveDataAfterRepay: ReserveData =
            calcExpectedReserveDataAfterRepay(
              repaymentAmount,
              RateMode.Stable,
              reserveDataBeforeRepay,
              userDataBeforeRepay,
              blockTimestamps.txTimestamp
            );

          // Calculate expected user data after repaying
          const expectedUserDataAfterRepay: UserReserveData =
            calcExpectedUserDataAfterRepay(
              repaymentAmount,
              RateMode.Stable,
              reserveDataBeforeRepay,
              expectedReserveDataAfterRepay,
              userDataBeforeRepay,
              borrower.address,
              borrower.address,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          expectEqual(reserveDataAfterRepay, expectedReserveDataAfterRepay);
          expectEqual(userDataAfterRepay, expectedUserDataAfterRepay);
        });

        it("Should update state correctly for full debt repayment (MaxUint256)", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            tether,
            borrower,
          } = await loadFixture(setUpSingleStableBorrowTetherFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR);

          // Get reserve data before repaying
          const reserveDataBeforeRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await tether.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before repaying
          const userDataBeforeRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await tether.getAddress(),
            borrower.address
          );

          // Repay full debt
          const repayTx = await lendingPool.connect(borrower).repay(
            await tether.getAddress(),
            MaxUint256, // flag for full debt repayment
            RateMode.Stable,
            borrower.address
          );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(repayTx);

          // Get reserve data after repaying
          const reserveDataAfterRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await tether.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data after repaying
          const userDataAfterRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await tether.getAddress(),
            borrower.address
          );

          // Calculate expected reserve data after repaying
          const expectedReserveDataAfterRepay: ReserveData =
            calcExpectedReserveDataAfterRepay(
              MaxUint256,
              RateMode.Stable,
              reserveDataBeforeRepay,
              userDataBeforeRepay,
              blockTimestamps.txTimestamp
            );

          // Calculate expected user data after repaying
          const expectedUserDataAfterRepay: UserReserveData =
            calcExpectedUserDataAfterRepay(
              MaxUint256,
              RateMode.Stable,
              reserveDataBeforeRepay,
              expectedReserveDataAfterRepay,
              userDataBeforeRepay,
              borrower.address,
              borrower.address,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          expectEqual(reserveDataAfterRepay, expectedReserveDataAfterRepay);
          expectEqual(userDataAfterRepay, expectedUserDataAfterRepay);
        });

        it("Should update state correctly if repayment amount is more than debt owed", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            tether,
            borrower,
          } = await loadFixture(setUpSingleStableBorrowTetherFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR / 4);

          // Get reserve data before repaying
          const reserveDataBeforeRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await tether.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before repaying
          const userDataBeforeRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await tether.getAddress(),
            borrower.address
          );

          // userDataBeforeRepay.currentStableDebt == current stable debt owed, including interest
          // This tests that the state is correct if the repaymentAmount is only one decimal unit more than the debt owed
          const repaymentAmount = userDataBeforeRepay.currentStableDebt + 1n;

          // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
          time.setNextBlockTimestamp(await time.latest());

          // Repay too much debt
          const repayTx = await lendingPool
            .connect(borrower)
            .repay(
              await tether.getAddress(),
              repaymentAmount,
              RateMode.Stable,
              borrower.address
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(repayTx);

          // Get reserve data after repaying
          const reserveDataAfterRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await tether.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data after repaying
          const userDataAfterRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await tether.getAddress(),
            borrower.address
          );

          // Calculate expected reserve data after repaying
          const expectedReserveDataAfterRepay: ReserveData =
            calcExpectedReserveDataAfterRepay(
              repaymentAmount,
              RateMode.Stable,
              reserveDataBeforeRepay,
              userDataBeforeRepay,
              blockTimestamps.txTimestamp
            );

          // Calculate expected user data after repaying
          const expectedUserDataAfterRepay: UserReserveData =
            calcExpectedUserDataAfterRepay(
              repaymentAmount,
              RateMode.Stable,
              reserveDataBeforeRepay,
              expectedReserveDataAfterRepay,
              userDataBeforeRepay,
              borrower.address,
              borrower.address,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          expectEqual(reserveDataAfterRepay, expectedReserveDataAfterRepay);
          expectEqual(userDataAfterRepay, expectedUserDataAfterRepay);
        });

        it("Should update state correctly if borrower only repays principal debt", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            tether,
            borrower,
          } = await loadFixture(setUpSingleStableBorrowTetherFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR * 1.5);

          // Get reserve data before repaying
          const reserveDataBeforeRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await tether.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before repaying
          const userDataBeforeRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await tether.getAddress(),
            borrower.address
          );

          const repaymentAmount = userDataBeforeRepay.principalStableDebt;

          // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
          time.setNextBlockTimestamp(await time.latest());

          // Repay principal debt but no interest
          const repayTx = await lendingPool
            .connect(borrower)
            .repay(
              await tether.getAddress(),
              repaymentAmount,
              RateMode.Stable,
              borrower.address
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(repayTx);

          // Get reserve data after repaying
          const reserveDataAfterRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await tether.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data after repaying
          const userDataAfterRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await tether.getAddress(),
            borrower.address
          );

          // Calculate expected reserve data after repaying
          const expectedReserveDataAfterRepay: ReserveData =
            calcExpectedReserveDataAfterRepay(
              repaymentAmount,
              RateMode.Stable,
              reserveDataBeforeRepay,
              userDataBeforeRepay,
              blockTimestamps.txTimestamp
            );

          // Calculate expected user data after repaying
          const expectedUserDataAfterRepay: UserReserveData =
            calcExpectedUserDataAfterRepay(
              repaymentAmount,
              RateMode.Stable,
              reserveDataBeforeRepay,
              expectedReserveDataAfterRepay,
              userDataBeforeRepay,
              borrower.address,
              borrower.address,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          // Checking state fields individually. Due to a difference in how solidity and TS calculate the
          // averageBorrowRate and other values, the expected and actual values are not exactly the same, so we can't use expectEqual
          // to compare the entire objects. Even with the same inputs, the TS code calulates averageStableBorrowRate to have
          // a last digit that is higher by 1 than the same calculation in solidity. This also affects the liquidityRate, so
          // those values can only be checked that value after repayment is lower than before repayment.
          expect(reserveDataAfterRepay.totalLiquidity).to.equal(
            expectedReserveDataAfterRepay.totalLiquidity
          );
          expect(reserveDataAfterRepay.utilizationRate).to.equal(
            expectedReserveDataAfterRepay.utilizationRate
          );
          expect(reserveDataAfterRepay.availableLiquidity).to.equal(
            expectedReserveDataAfterRepay.availableLiquidity
          );
          expect(reserveDataAfterRepay.totalStableDebt).to.equal(
            expectedReserveDataAfterRepay.totalStableDebt
          );
          expect(reserveDataAfterRepay.totalVariableDebt).to.equal(
            expectedReserveDataAfterRepay.totalVariableDebt
          );
          expect(reserveDataAfterRepay.liquidityRate).to.be.lessThan(
            expectedReserveDataAfterRepay.liquidityRate
          );
          expect(
            reserveDataAfterRepay.variableBorrowRate
          ).to.be.lessThanOrEqual(
            expectedReserveDataAfterRepay.variableBorrowRate
          );
          expect(reserveDataAfterRepay.stableBorrowRate).to.equal(
            expectedReserveDataAfterRepay.stableBorrowRate
          );
          expect(reserveDataAfterRepay.averageStableBorrowRate).to.be.lessThan(
            expectedReserveDataAfterRepay.averageStableBorrowRate
          );
          expect(reserveDataAfterRepay.liquidityIndex).to.equal(
            expectedReserveDataAfterRepay.liquidityIndex
          );
          expect(reserveDataAfterRepay.variableBorrowIndex).to.equal(
            expectedReserveDataAfterRepay.variableBorrowIndex
          );
          expect(reserveDataAfterRepay.lastUpdateTimestamp).to.equal(
            expectedReserveDataAfterRepay.lastUpdateTimestamp
          );
          expect(reserveDataAfterRepay.totalStableDebtLastUpdated).to.equal(
            expectedReserveDataAfterRepay.totalStableDebtLastUpdated
          );
          expect(reserveDataAfterRepay.principalStableDebt).to.equal(
            expectedReserveDataAfterRepay.principalStableDebt
          );
          expect(reserveDataAfterRepay.scaledVariableDebt).to.equal(
            expectedReserveDataAfterRepay.scaledVariableDebt
          );
          expect(reserveDataAfterRepay.marketStableRate).to.equal(
            expectedReserveDataAfterRepay.marketStableRate
          );

          expect(userDataAfterRepay.scaledMTokenBalance).to.equal(
            expectedUserDataAfterRepay.scaledMTokenBalance
          );
          expect(userDataAfterRepay.currentMTokenBalance).to.equal(
            expectedUserDataAfterRepay.currentMTokenBalance
          );
          expect(userDataAfterRepay.currentStableDebt).to.equal(
            expectedUserDataAfterRepay.currentStableDebt
          );
          expect(userDataAfterRepay.currentVariableDebt).to.equal(
            expectedUserDataAfterRepay.currentVariableDebt
          );
          expect(userDataAfterRepay.principalStableDebt).to.equal(
            expectedUserDataAfterRepay.principalStableDebt
          );
          expect(userDataAfterRepay.scaledVariableDebt).to.equal(
            expectedUserDataAfterRepay.scaledVariableDebt
          );
          expect(userDataAfterRepay.stableBorrowRate).to.equal(
            expectedUserDataAfterRepay.stableBorrowRate
          );
          expect(userDataAfterRepay.liquidityRate).to.be.lessThan(
            expectedUserDataAfterRepay.liquidityRate
          );
          expect(userDataAfterRepay.stableRateLastUpdated).to.equal(
            expectedUserDataAfterRepay.stableRateLastUpdated
          );
          expect(userDataAfterRepay.lastUpdateTimestamp).to.equal(
            expectedUserDataAfterRepay.lastUpdateTimestamp
          );
          expect(userDataAfterRepay.walletBalanceUnderlyingAsset).to.equal(
            expectedUserDataAfterRepay.walletBalanceUnderlyingAsset
          );

          // Specifically check that user still has debt since only principal was paid
          expect(userDataAfterRepay.currentStableDebt).to.be.gt(0n);
        });

        it("Should update state correctly if another user repays debt on behalf of borrower", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            tether,
            borrower,
            owner,
            rando,
          } = await loadFixture(setUpSingleStableBorrowTetherFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR / 6);

          // Get reserve data before repaying
          const reserveDataBeforeRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await tether.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before repaying
          const userDataBeforeRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await tether.getAddress(),
            borrower.address
          );

          const repaymentAmount = userDataBeforeRepay.principalStableDebt;

          // Make sure payer has some tokens to pay with
          await allocateAndApproveTokens(
            tether,
            owner,
            rando,
            lendingPool,
            1250n * 2n, // 2x the amount borrowed
            0n
          );

          // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
          time.setNextBlockTimestamp(await time.latest());

          // Repay principal debt
          const repayTx = await lendingPool
            .connect(rando)
            .repay(
              await tether.getAddress(),
              repaymentAmount,
              RateMode.Stable,
              borrower.address
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(repayTx);

          // Get reserve data after repaying
          const reserveDataAfterRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await tether.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data after repaying
          const userDataAfterRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await tether.getAddress(),
            borrower.address
          );

          // Calculate expected reserve data after repaying
          const expectedReserveDataAfterRepay: ReserveData =
            calcExpectedReserveDataAfterRepay(
              repaymentAmount,
              RateMode.Stable,
              reserveDataBeforeRepay,
              userDataBeforeRepay,
              blockTimestamps.txTimestamp
            );

          // Calculate expected user data after repaying
          const expectedUserDataAfterRepay: UserReserveData =
            calcExpectedUserDataAfterRepay(
              repaymentAmount,
              RateMode.Stable,
              reserveDataBeforeRepay,
              expectedReserveDataAfterRepay,
              userDataBeforeRepay,
              rando.address,
              borrower.address,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          // Checking state fields individually. Due to a difference in how solidity and TS calculate the
          // averageStableBorrowRate, the expected and actual values are not exactly the same, so we can't use expectEqual
          // to compare the entire objects. Even with the same inputs, the TS code calulates averageStableBorrowRate to have
          // a last digit that is higher by 1 than the same calculation in solidity. This also affects the liquidityRate, so
          // those values can only be checked that value after repayment is lower than before repayment.
          expect(reserveDataAfterRepay.totalLiquidity).to.equal(
            expectedReserveDataAfterRepay.totalLiquidity
          );
          expect(reserveDataAfterRepay.utilizationRate).to.equal(
            expectedReserveDataAfterRepay.utilizationRate
          );
          expect(reserveDataAfterRepay.availableLiquidity).to.equal(
            expectedReserveDataAfterRepay.availableLiquidity
          );
          expect(reserveDataAfterRepay.totalStableDebt).to.equal(
            expectedReserveDataAfterRepay.totalStableDebt
          );
          expect(reserveDataAfterRepay.totalVariableDebt).to.equal(
            expectedReserveDataAfterRepay.totalVariableDebt
          );
          expect(reserveDataAfterRepay.liquidityRate).to.be.lessThan(
            expectedReserveDataAfterRepay.liquidityRate
          );
          expect(reserveDataAfterRepay.variableBorrowRate).to.closeTo(
            expectedReserveDataAfterRepay.variableBorrowRate,
            1
          );
          expect(reserveDataAfterRepay.stableBorrowRate).to.equal(
            expectedReserveDataAfterRepay.stableBorrowRate
          );
          expect(reserveDataAfterRepay.averageStableBorrowRate).to.be.lessThan(
            expectedReserveDataAfterRepay.averageStableBorrowRate
          );
          expect(reserveDataAfterRepay.liquidityIndex).to.equal(
            expectedReserveDataAfterRepay.liquidityIndex
          );
          expect(reserveDataAfterRepay.variableBorrowIndex).to.equal(
            expectedReserveDataAfterRepay.variableBorrowIndex
          );
          expect(reserveDataAfterRepay.lastUpdateTimestamp).to.equal(
            expectedReserveDataAfterRepay.lastUpdateTimestamp
          );
          expect(reserveDataAfterRepay.totalStableDebtLastUpdated).to.equal(
            expectedReserveDataAfterRepay.totalStableDebtLastUpdated
          );
          expect(reserveDataAfterRepay.principalStableDebt).to.equal(
            expectedReserveDataAfterRepay.principalStableDebt
          );
          expect(reserveDataAfterRepay.scaledVariableDebt).to.equal(
            expectedReserveDataAfterRepay.scaledVariableDebt
          );
          expect(reserveDataAfterRepay.marketStableRate).to.equal(
            expectedReserveDataAfterRepay.marketStableRate
          );

          expect(userDataAfterRepay.scaledMTokenBalance).to.equal(
            expectedUserDataAfterRepay.scaledMTokenBalance
          );
          expect(userDataAfterRepay.currentMTokenBalance).to.equal(
            expectedUserDataAfterRepay.currentMTokenBalance
          );
          expect(userDataAfterRepay.currentStableDebt).to.equal(
            expectedUserDataAfterRepay.currentStableDebt
          );
          expect(userDataAfterRepay.currentVariableDebt).to.equal(
            expectedUserDataAfterRepay.currentVariableDebt
          );
          expect(userDataAfterRepay.principalStableDebt).to.equal(
            expectedUserDataAfterRepay.principalStableDebt
          );
          expect(userDataAfterRepay.scaledVariableDebt).to.equal(
            expectedUserDataAfterRepay.scaledVariableDebt
          );
          expect(userDataAfterRepay.stableBorrowRate).to.equal(
            expectedUserDataAfterRepay.stableBorrowRate
          );
          expect(userDataAfterRepay.liquidityRate).to.be.lessThan(
            expectedUserDataAfterRepay.liquidityRate
          );
          expect(userDataAfterRepay.stableRateLastUpdated).to.equal(
            expectedUserDataAfterRepay.stableRateLastUpdated
          );
          expect(userDataAfterRepay.lastUpdateTimestamp).to.equal(
            expectedUserDataAfterRepay.lastUpdateTimestamp
          );
          expect(userDataAfterRepay.walletBalanceUnderlyingAsset).to.equal(
            expectedUserDataAfterRepay.walletBalanceUnderlyingAsset
          );
        });

        it("Should update state correctly if multiple repayments are made on same loan", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meld,
            borrower,
          } = await loadFixture(setUpSingleStableBorrowMELDFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR / 2);

          const repaymentAmount = await convertToCurrencyDecimals(
            await meld.getAddress(),
            "1000" // half of borrowed principal
          );

          // Repay partial debt
          await lendingPool
            .connect(borrower)
            .repay(
              await meld.getAddress(),
              repaymentAmount,
              RateMode.Stable,
              borrower.address
            );

          // Simulate time passing
          await time.increase(ONE_YEAR / 4);

          // Get reserve data before repaying
          const reserveDataBeforeRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before repaying
          const userDataBeforeRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await meld.getAddress(),
            borrower.address
          );

          // Repay rest of debt
          const repayTx = await lendingPool.connect(borrower).repay(
            await meld.getAddress(),
            MaxUint256, // flag for full debt repayment
            RateMode.Stable,
            borrower.address
          );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(repayTx);

          // Get reserve data after repaying
          const reserveDataAfterRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data after repaying
          const userDataAfterRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await meld.getAddress(),
            borrower.address
          );

          // Calculate expected reserve data after repaying
          const expectedReserveDataAfterRepay: ReserveData =
            calcExpectedReserveDataAfterRepay(
              MaxUint256,
              RateMode.Stable,
              reserveDataBeforeRepay,
              userDataBeforeRepay,
              blockTimestamps.txTimestamp
            );

          // Calculate expected user data after repaying
          const expectedUserDataAfterRepay: UserReserveData =
            calcExpectedUserDataAfterRepay(
              MaxUint256,
              RateMode.Stable,
              reserveDataBeforeRepay,
              expectedReserveDataAfterRepay,
              userDataBeforeRepay,
              borrower.address,
              borrower.address,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          expectEqual(reserveDataAfterRepay, expectedReserveDataAfterRepay);
          expectEqual(userDataAfterRepay, expectedUserDataAfterRepay);
        });

        it("Should update token balances correctly for partial repayment", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meld,
            borrower,
          } = await loadFixture(setUpSingleStableBorrowMELDFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR);

          // Get reserve data before repaying
          const reserveDataBeforeRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before repaying
          const userDataBeforeRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await meld.getAddress(),
            borrower.address
          );

          const stableDebtToken = await ethers.getContractAt(
            "StableDebtToken",
            reserveDataBeforeRepay.stableDebtTokenAddress
          );

          const borrowerAssetBalanceBefore = await meld.balanceOf(
            borrower.address
          );
          const mTokenAssetBalanceBefore = await meld.balanceOf(
            reserveDataBeforeRepay.mTokenAddress
          );

          const repaymentAmount = await convertToCurrencyDecimals(
            await meld.getAddress(),
            "1500" // part of borrowed amount
          );

          // Repay partial debt
          const repayTx = await lendingPool
            .connect(borrower)
            .repay(
              await meld.getAddress(),
              repaymentAmount,
              RateMode.Stable,
              borrower.address
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(repayTx);

          // Calculate expected reserve data after repaying
          const expectedReserveDataAfterRepay: ReserveData =
            calcExpectedReserveDataAfterRepay(
              repaymentAmount,
              RateMode.Stable,
              reserveDataBeforeRepay,
              userDataBeforeRepay,
              blockTimestamps.txTimestamp
            );

          // Calculate expected user data after repaying
          const expectedUserDataAfterRepay: UserReserveData =
            calcExpectedUserDataAfterRepay(
              repaymentAmount,
              RateMode.Stable,
              reserveDataBeforeRepay,
              expectedReserveDataAfterRepay,
              userDataBeforeRepay,
              borrower.address,
              borrower.address,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          const { 0: principalSupply, 1: totalSupply } =
            await stableDebtToken.getSupplyData();

          // Check token balances
          expect(await stableDebtToken.balanceOf(borrower.address)).to.equal(
            expectedUserDataAfterRepay.currentStableDebt
          );

          expect(
            await stableDebtToken.principalBalanceOf(borrower.address)
          ).to.equal(expectedUserDataAfterRepay.principalStableDebt);

          // Check stable debt principal and total supply
          expect(principalSupply).to.equal(
            expectedReserveDataAfterRepay.principalStableDebt
          );

          expect(totalSupply).to.equal(
            expectedReserveDataAfterRepay.totalStableDebt
          );

          // Borrower should have balanceBefore minus amount repaid
          expect(await meld.balanceOf(borrower.address)).to.equal(
            borrowerAssetBalanceBefore - repaymentAmount
          );

          //mToken should have balanceBefore plus amount repaid
          expect(
            await meld.balanceOf(reserveDataBeforeRepay.mTokenAddress)
          ).to.equal(mTokenAssetBalanceBefore + repaymentAmount);
        });

        it("Should update token balances correctly for full debt repayment (MaxUint256)", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meld,
            borrower,
          } = await loadFixture(setUpSingleStableBorrowMELDFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR * 2);

          // Get reserve data before repaying
          const reserveDataBeforeRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before repaying
          const userDataBeforeRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await meld.getAddress(),
            borrower.address
          );

          const stableDebtToken = await ethers.getContractAt(
            "StableDebtToken",
            reserveDataBeforeRepay.stableDebtTokenAddress
          );

          const borrowerAssetBalanceBefore = await meld.balanceOf(
            borrower.address
          );
          const mTokenAssetBalanceBefore = await meld.balanceOf(
            reserveDataBeforeRepay.mTokenAddress
          );

          // Repay full debt
          const repayTx = await lendingPool.connect(borrower).repay(
            await meld.getAddress(),
            MaxUint256, // flag for full debt repayment
            RateMode.Stable,
            borrower.address
          );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(repayTx);

          const expectedAccumulatedInterest = calcCompoundedInterest(
            userDataBeforeRepay.stableBorrowRate,
            blockTimestamps.latestBlockTimestamp,
            userDataBeforeRepay.stableRateLastUpdated
          );

          const expectedCurrentBalance =
            userDataBeforeRepay.principalStableDebt.rayMul(
              expectedAccumulatedInterest
            );

          const { 0: principalSupply, 1: totalSupply } =
            await stableDebtToken.getSupplyData();

          // Check token balances
          expect(await stableDebtToken.balanceOf(borrower.address)).to.equal(
            0n
          );

          expect(
            await stableDebtToken.principalBalanceOf(borrower.address)
          ).to.equal(0n);

          // Check stable debt principal and total supply
          expect(principalSupply).to.equal(0n);

          expect(totalSupply).to.equal(0n);

          // Check borrower tokens after repayment
          expect(await meld.balanceOf(borrower.address)).to.equal(
            borrowerAssetBalanceBefore - expectedCurrentBalance
          );

          // mToken should have balanceBefore plus full debt
          expect(
            await meld.balanceOf(reserveDataBeforeRepay.mTokenAddress)
          ).to.equal(mTokenAssetBalanceBefore + expectedCurrentBalance);
        });

        it("Should update token balances correctly if repayment amount is more than debt owed", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            tether,
            borrower,
          } = await loadFixture(setUpSingleStableBorrowTetherFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR / 4);

          // Get reserve data before repaying
          const reserveDataBeforeRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await tether.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before repaying
          const userDataBeforeRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await tether.getAddress(),
            borrower.address
          );

          const stableDebtToken = await ethers.getContractAt(
            "StableDebtToken",
            reserveDataBeforeRepay.stableDebtTokenAddress
          );

          const borrowerAssetBalanceBefore = await tether.balanceOf(
            borrower.address
          );
          const mTokenAssetBalanceBefore = await tether.balanceOf(
            reserveDataBeforeRepay.mTokenAddress
          );

          // userDataBeforeRepay.currentStableDebt == current stable debt owed, including interest
          // This tests that the state is correct if the repaymentAmount is much greater than the debt owed
          const repaymentAmount =
            userDataBeforeRepay.currentStableDebt +
            100n ** reserveDataBeforeRepay.decimals;

          // Repay too much debt
          const repayTx = await lendingPool
            .connect(borrower)
            .repay(
              await tether.getAddress(),
              repaymentAmount,
              RateMode.Stable,
              borrower.address
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(repayTx);

          const expectedAccumulatedInterest = calcCompoundedInterest(
            userDataBeforeRepay.stableBorrowRate,
            blockTimestamps.latestBlockTimestamp,
            userDataBeforeRepay.stableRateLastUpdated
          );

          const expectedCurrentBalance =
            userDataBeforeRepay.principalStableDebt.rayMul(
              expectedAccumulatedInterest
            );

          const { 0: principalSupply, 1: totalSupply } =
            await stableDebtToken.getSupplyData();

          // Check token balances
          expect(await stableDebtToken.balanceOf(borrower.address)).to.equal(
            0n
          );

          expect(
            await stableDebtToken.principalBalanceOf(borrower.address)
          ).to.equal(0n);

          // Check stable debt principal and total supply
          expect(principalSupply).to.equal(0n);

          expect(totalSupply).to.equal(0n);

          // Check borrower has correct number of tokens after repayment. Should be balanceBefore minus the debt, not the repayment amount
          expect(await tether.balanceOf(borrower.address)).to.equal(
            borrowerAssetBalanceBefore - expectedCurrentBalance
          );

          // mToken should have balanceBefore plus whole debt amount, not the repayment amount
          expect(
            await tether.balanceOf(reserveDataBeforeRepay.mTokenAddress)
          ).to.equal(mTokenAssetBalanceBefore + expectedCurrentBalance);
        });

        it("Should update token balances correctly if borrower only repays principal debt", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            tether,
            borrower,
          } = await loadFixture(setUpSingleStableBorrowTetherFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR / 1.5);

          // Get reserve data before repaying
          const reserveDataBeforeRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await tether.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before repaying
          const userDataBeforeRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await tether.getAddress(),
            borrower.address
          );

          const stableDebtToken = await ethers.getContractAt(
            "StableDebtToken",
            reserveDataBeforeRepay.stableDebtTokenAddress
          );

          const borrowerAssetBalanceBefore = await tether.balanceOf(
            borrower.address
          );
          const mTokenAssetBalanceBefore = await tether.balanceOf(
            reserveDataBeforeRepay.mTokenAddress
          );

          const repaymentAmount = userDataBeforeRepay.principalStableDebt;

          // Repay principal debt
          const repayTx = await lendingPool
            .connect(borrower)
            .repay(
              await tether.getAddress(),
              repaymentAmount,
              RateMode.Stable,
              borrower.address
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(repayTx);

          // Calculate expected reserve data after repaying
          const expectedReserveDataAfterRepay: ReserveData =
            calcExpectedReserveDataAfterRepay(
              repaymentAmount,
              RateMode.Stable,
              reserveDataBeforeRepay,
              userDataBeforeRepay,
              blockTimestamps.txTimestamp
            );

          // Calculate expected user data after repaying
          const expectedUserDataAfterRepay: UserReserveData =
            calcExpectedUserDataAfterRepay(
              repaymentAmount,
              RateMode.Stable,
              reserveDataBeforeRepay,
              expectedReserveDataAfterRepay,
              userDataBeforeRepay,
              borrower.address,
              borrower.address,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          const { 0: principalSupply, 1: totalSupply } =
            await stableDebtToken.getSupplyData();

          // Check token balances
          expect(await stableDebtToken.balanceOf(borrower.address)).to.equal(
            expectedUserDataAfterRepay.currentStableDebt
          );

          expect(
            await stableDebtToken.principalBalanceOf(borrower.address)
          ).to.equal(expectedUserDataAfterRepay.principalStableDebt);

          // Check stable debt principal and total supply
          expect(principalSupply).to.equal(
            expectedReserveDataAfterRepay.principalStableDebt
          );

          expect(totalSupply).to.equal(
            expectedReserveDataAfterRepay.totalStableDebt
          );

          // Borrower should have balanceBefore minus amount repaid
          expect(await tether.balanceOf(borrower.address)).to.equal(
            borrowerAssetBalanceBefore - repaymentAmount
          );

          // mToken should have balanceBefore plus amount repaid
          expect(
            await tether.balanceOf(reserveDataBeforeRepay.mTokenAddress)
          ).to.equal(mTokenAssetBalanceBefore + repaymentAmount);
        });

        it("Should update token balances correctly if another user repays debt on behalf of borrower", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meld,
            usdc,
            borrower,
            owner,
            rando,
          } = await loadFixture(setUpSingleStableBorrowMELDFixture);

          // Get reserve data before repaying
          const reserveDataBeforeRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before repaying
          const userDataBeforeRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await meld.getAddress(),
            borrower.address
          );

          const mMELD = await ethers.getContractAt(
            "MToken",
            reserveDataBeforeRepay.mTokenAddress
          );

          const stableDebtToken = await ethers.getContractAt(
            "StableDebtToken",
            reserveDataBeforeRepay.stableDebtTokenAddress
          );

          // Instantiate reserve token contracts for borrower's collateral
          const reserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await usdc.getAddress()
            );

          const mUSDC = await ethers.getContractAt(
            "MToken",
            reserveTokenAddresses.mTokenAddress
          );

          const repaymentAmount = await convertToCurrencyDecimals(
            await meld.getAddress(),
            "1500" // part of borrowed amount
          );

          // Make sure payer has some tokens to pay with
          await allocateAndApproveTokens(
            meld,
            owner,
            rando,
            lendingPool,
            1500n,
            0n
          );

          const borrowerAssetBalanceBefore = await meld.balanceOf(
            borrower.address
          );
          const mTokenAssetBalanceBefore = await meld.balanceOf(
            reserveDataBeforeRepay.mTokenAddress
          );
          const payerAssetBalanceBefore = await meld.balanceOf(rando.address);
          const payerMTokenBalanceBefore = await mMELD.balanceOf(rando.address);
          const payerCollateralTokenBalanceBefore = await mUSDC.balanceOf(
            rando.address
          );

          // Repay partial debt
          const repayTx = await lendingPool
            .connect(rando)
            .repay(
              await meld.getAddress(),
              repaymentAmount,
              RateMode.Stable,
              borrower.address
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(repayTx);

          // Calculate expected reserve data after repaying
          const expectedReserveDataAfterRepay: ReserveData =
            calcExpectedReserveDataAfterRepay(
              repaymentAmount,
              RateMode.Stable,
              reserveDataBeforeRepay,
              userDataBeforeRepay,
              blockTimestamps.txTimestamp
            );

          // Calculate expected user data after repaying
          const expectedUserDataAfterRepay: UserReserveData =
            calcExpectedUserDataAfterRepay(
              repaymentAmount,
              RateMode.Stable,
              reserveDataBeforeRepay,
              expectedReserveDataAfterRepay,
              userDataBeforeRepay,
              borrower.address,
              rando.address,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          const { 0: principalSupply, 1: totalSupply } =
            await stableDebtToken.getSupplyData();

          // Check token balances
          expect(await stableDebtToken.balanceOf(borrower.address)).to.equal(
            expectedUserDataAfterRepay.currentStableDebt
          );

          expect(
            await stableDebtToken.principalBalanceOf(borrower.address)
          ).to.equal(expectedUserDataAfterRepay.principalStableDebt);

          // Check stable debt principal and total supply
          expect(principalSupply).to.equal(
            expectedReserveDataAfterRepay.principalStableDebt
          );

          expect(totalSupply).to.equal(
            expectedReserveDataAfterRepay.totalStableDebt
          );

          // Borrower should have balanceBefore because someone else paid the partial debt
          expect(await meld.balanceOf(borrower.address)).to.equal(
            borrowerAssetBalanceBefore
          );

          // mToken should have balanceBefore plus amount repaid
          expect(
            await meld.balanceOf(reserveDataBeforeRepay.mTokenAddress)
          ).to.equal(mTokenAssetBalanceBefore + repaymentAmount);

          // Payer should have balance before minus amount repaid
          expect(await meld.balanceOf(rando.address)).to.equal(
            payerAssetBalanceBefore - repaymentAmount
          );

          // Payer should not receive mTokens
          expect(await mMELD.balanceOf(rando.address)).to.equal(
            payerMTokenBalanceBefore
          );

          // Payer should  not receive borrower's collateral tokens
          expect(await mUSDC.balanceOf(rando.address)).to.equal(
            payerCollateralTokenBalanceBefore
          );
        });

        it("Should update token balances correctly if multiple repayments are made on same loan", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meld,
            borrower,
          } = await loadFixture(setUpSingleStableBorrowMELDFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR / 2);

          // Get reserve data before first repayment
          const reserveDataBeforeRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          const stableDebtToken = await ethers.getContractAt(
            "StableDebtToken",
            reserveDataBeforeRepay.stableDebtTokenAddress
          );

          const repaymentAmount = await convertToCurrencyDecimals(
            await meld.getAddress(),
            "1000" // half of borrowed principal
          );

          // Repay partial debt
          await lendingPool
            .connect(borrower)
            .repay(
              await meld.getAddress(),
              repaymentAmount,
              RateMode.Stable,
              borrower.address
            );

          // Get user reserve data before second repayment
          const userDataBeforeRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await meld.getAddress(),
            borrower.address
          );

          // Make second repayment right away
          const borrowerAssetBalanceBefore = await meld.balanceOf(
            borrower.address
          );
          const mTokenAssetBalanceBefore = await meld.balanceOf(
            reserveDataBeforeRepay.mTokenAddress
          );

          // Repay rest of debt
          const repayTx = await lendingPool.connect(borrower).repay(
            await meld.getAddress(),
            MaxUint256, // flag for full debt repayment
            RateMode.Stable,
            borrower.address
          );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(repayTx);

          const expectedAccumulatedInterest = calcCompoundedInterest(
            userDataBeforeRepay.stableBorrowRate,
            blockTimestamps.latestBlockTimestamp,
            userDataBeforeRepay.stableRateLastUpdated
          );

          const expectedCurrentBalance =
            userDataBeforeRepay.principalStableDebt.rayMul(
              expectedAccumulatedInterest
            );

          const { 0: principalSupply, 1: totalSupply } =
            await stableDebtToken.getSupplyData();

          // Check token balances
          expect(await stableDebtToken.balanceOf(borrower.address)).to.equal(
            0n
          );

          expect(
            await stableDebtToken.principalBalanceOf(borrower.address)
          ).to.equal(0n);

          // Check stable debt principal and total supply
          expect(principalSupply).to.equal(0n);

          expect(totalSupply).to.equal(0n);

          // Borrower should have same balance as before
          expect(await meld.balanceOf(borrower.address)).to.equal(
            borrowerAssetBalanceBefore - expectedCurrentBalance
          );

          // mToken should have balanceBefore plus total debt amount
          expect(
            await meld.balanceOf(reserveDataBeforeRepay.mTokenAddress)
          ).to.equal(mTokenAssetBalanceBefore + expectedCurrentBalance);
        });

        it("Should calculate correct stake amount when Regular user repays whole balance of a yield boost token", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            addressesProvider,
            meld,
            usdc,
            owner,
            depositor,
            rewardsSetter,
            yieldBoostStakingUSDC,
            yieldBoostStorageUSDC,
          } = await loadFixture(setUpDepositFixture);

          // Set Yield Boost Staking Rewards
          await setRewards(
            yieldBoostStorageUSDC,
            yieldBoostStakingUSDC,
            addressesProvider,
            rewardsSetter,
            owner,
            usdc,
            meld
          );

          // Depositor of MELD decides to borrow USDC and then repay the whole balance
          // USDC liquidity deposited in fixture

          const borrower = depositor;

          // Borrow USDC from the lending pool
          const amountToBorrow = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "3000"
          );

          await lendingPool
            .connect(borrower)
            .borrow(
              await usdc.getAddress(),
              amountToBorrow,
              RateMode.Stable,
              borrower.address,
              0n
            );

          // Make sure depositor has plenty of funds to repay the whole debt
          await allocateAndApproveTokens(
            usdc,
            owner,
            borrower,
            lendingPool,
            3000n,
            2n
          );

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR / 3);

          // Get reserve data before repaying
          const reserveDataBeforeRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before repaying
          const userDataBeforeRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await usdc.getAddress(),
            borrower.address
          );

          // Instantiate reserve token contracts for borrower's collateral
          const reserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await usdc.getAddress()
            );

          const mUSDC = await ethers.getContractAt(
            "MToken",
            reserveTokenAddresses.mTokenAddress
          );

          const stableDebtToken = await ethers.getContractAt(
            "StableDebtToken",
            reserveTokenAddresses.stableDebtTokenAddress
          );

          // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
          time.setNextBlockTimestamp(await time.latest());

          // Repay full debt
          const repayTx = await lendingPool.connect(borrower).repay(
            await usdc.getAddress(),
            MaxUint256, // flag for full debt repayment
            RateMode.Stable,
            borrower.address
          );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(repayTx);

          // Calculate expected reserve data after repaying
          const expectedReserveDataAfterRepay: ReserveData =
            calcExpectedReserveDataAfterRepay(
              MaxUint256,
              RateMode.Stable,
              reserveDataBeforeRepay,
              userDataBeforeRepay,
              blockTimestamps.txTimestamp
            );

          const expectedAccumulatedInterest = calcCompoundedInterest(
            userDataBeforeRepay.stableBorrowRate,
            blockTimestamps.latestBlockTimestamp,
            userDataBeforeRepay.stableRateLastUpdated
          );

          const expectedCurrentBalance =
            userDataBeforeRepay.principalStableDebt.rayMul(
              expectedAccumulatedInterest
            );
          const expectedIncrease =
            expectedCurrentBalance - userDataBeforeRepay.principalStableDebt;

          // Check that the correct events were emitted
          await expect(repayTx)
            .to.emit(stableDebtToken, "Transfer")
            .withArgs(
              borrower.address,
              ZeroAddress,
              isAlmostEqual(userDataBeforeRepay.currentStableDebt)
            );

          await expect(repayTx)
            .to.emit(stableDebtToken, "Burn")
            .withArgs(
              borrower.address,
              isAlmostEqual(
                userDataBeforeRepay.currentStableDebt - expectedIncrease
              ),
              expectedCurrentBalance,
              expectedIncrease,
              expectedReserveDataAfterRepay.averageStableBorrowRate,
              expectedReserveDataAfterRepay.totalStableDebt
            );

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          await expect(repayTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await usdc.getAddress(),
              expectedReserveDataAfterRepay.liquidityRate,
              isAlmostEqual(expectedReserveDataAfterRepay.stableBorrowRate),
              isAlmostEqual(expectedReserveDataAfterRepay.variableBorrowRate),
              expectedReserveDataAfterRepay.liquidityIndex,
              expectedReserveDataAfterRepay.variableBorrowIndex
            );

          await expect(repayTx)
            .to.emit(usdc, "Transfer")
            .withArgs(
              borrower.address,
              await mUSDC.getAddress(),
              isAlmostEqual(userDataBeforeRepay.currentStableDebt)
            );

          // The Repay event is emitted by the RepayLogic.sol library, so we need to get the contract instance with the RepayLogic ABI
          const contractInstanceWithRepayLibraryABI =
            await ethers.getContractAt(
              "RepayLogic",
              await lendingPool.getAddress(),
              owner
            );

          await expect(repayTx)
            .to.emit(contractInstanceWithRepayLibraryABI, "Repay")
            .withArgs(
              await usdc.getAddress(),
              borrower.address,
              borrower.address,
              isAlmostEqual(userDataBeforeRepay.currentStableDebt)
            );

          await expect(repayTx).to.emit(mUSDC, "Transfer");
          await expect(repayTx).to.emit(mUSDC, "Mint");
          await expect(repayTx).to.not.emit(stableDebtToken, "Mint");

          await expect(repayTx).to.not.emit(
            yieldBoostStakingUSDC,
            "StakePositionCreated"
          );

          await expect(repayTx).to.not.emit(
            yieldBoostStakingUSDC,
            "StakePositionUpdated"
          );

          await expect(repayTx).to.not.emit(
            yieldBoostStakingUSDC,
            "StakePositionRemoved"
          );

          await expect(repayTx).to.not.emit(
            yieldBoostStakingUSDC,
            "RewardsClaimed"
          );

          await expect(repayTx)
            .to.emit(lendingPool, "RefreshYieldBoostAmount")
            .withArgs(await usdc.getAddress(), borrower.address, 0n);

          await expect(repayTx).to.not.emit(lendingPool, "UnlockMeldBankerNFT");

          expect(await lendingPool.isUsingMeldBanker(borrower.address)).to.be
            .false;

          expect(await lendingPool.isMeldBankerBlocked(0n)).to.be.false;

          const meldBankerData = await lendingPool.userMeldBankerData(
            borrower.address
          );
          expect(meldBankerData.tokenId).to.equal(0n);
          expect(meldBankerData.asset).to.equal(ZeroAddress);
          expect(meldBankerData.meldBankerType).to.equal(MeldBankerType.NONE);
          expect(meldBankerData.action).to.equal(Action.NONE);

          expect(
            await yieldBoostStorageUSDC.getStakerStakedAmount(borrower.address)
          ).to.equal(0n);
        });

        it("Should calculate correct stake amount when Regular user repays partial balance of a yield boost token", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            addressesProvider,
            meld,
            usdc,
            owner,
            depositor,
            rewardsSetter,
            yieldBoostStakingUSDC,
            yieldBoostStorageUSDC,
          } = await loadFixture(setUpDepositFixture);

          // Set Yield Boost Staking Rewards
          await setRewards(
            yieldBoostStorageUSDC,
            yieldBoostStakingUSDC,
            addressesProvider,
            rewardsSetter,
            owner,
            usdc,
            meld
          );

          // Depositor of MELD decides to borrow USDC and then repay the whole balance
          // USDC liquidity deposited in fixture

          const borrower = depositor;

          // Borrow USDC from the lending pool
          const amountToBorrow = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "2000"
          );

          await lendingPool
            .connect(borrower)
            .borrow(
              await usdc.getAddress(),
              amountToBorrow,
              RateMode.Stable,
              borrower.address,
              0n
            );

          const repaymentAmount = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "1000" // part of principal
          );

          // Make sure depositor has plenty of funds to repay the whole debt
          await allocateAndApproveTokens(
            usdc,
            owner,
            borrower,
            lendingPool,
            1000n,
            2n
          );

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR / 12);

          // Get reserve data before repaying
          const reserveDataBeforeRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before repaying
          const userDataBeforeRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await usdc.getAddress(),
            borrower.address
          );

          // Instantiate reserve token contracts for borrower's collateral
          const reserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await usdc.getAddress()
            );

          const mUSDC = await ethers.getContractAt(
            "MToken",
            reserveTokenAddresses.mTokenAddress
          );

          const stableDebtToken = await ethers.getContractAt(
            "StableDebtToken",
            reserveTokenAddresses.stableDebtTokenAddress
          );

          // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
          time.setNextBlockTimestamp(await time.latest());

          // Repay partial debt
          const repayTx = await lendingPool
            .connect(borrower)
            .repay(
              await usdc.getAddress(),
              repaymentAmount,
              RateMode.Stable,
              borrower.address
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(repayTx);

          // Calculate expected reserve data after repaying
          const expectedReserveDataAfterRepay: ReserveData =
            calcExpectedReserveDataAfterRepay(
              repaymentAmount,
              RateMode.Stable,
              reserveDataBeforeRepay,
              userDataBeforeRepay,
              blockTimestamps.txTimestamp
            );

          const expectedAccumulatedInterest = calcCompoundedInterest(
            userDataBeforeRepay.stableBorrowRate,
            blockTimestamps.latestBlockTimestamp,
            userDataBeforeRepay.stableRateLastUpdated
          );

          const expectedCurrentBalance =
            userDataBeforeRepay.principalStableDebt.rayMul(
              expectedAccumulatedInterest
            );

          const expectedIncrease =
            expectedCurrentBalance - userDataBeforeRepay.principalStableDebt;

          // Check that the correct events were emitted
          await expect(repayTx)
            .to.emit(stableDebtToken, "Transfer")
            .withArgs(borrower.address, ZeroAddress, repaymentAmount);

          await expect(repayTx)
            .to.emit(stableDebtToken, "Burn")
            .withArgs(
              borrower.address,
              repaymentAmount - expectedIncrease,
              expectedCurrentBalance,
              expectedIncrease,
              anyUint, // not checking actual value because due to a difference in solidity and Javascript, the value is slightly different. It is tested in other test cases
              expectedReserveDataAfterRepay.totalStableDebt
            );

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          await expect(repayTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await usdc.getAddress(),
              anyUint, // not checking actual value because due to a difference in solidity and Javascript, the value is slightly different. It is tested in other test cases
              isAlmostEqual(expectedReserveDataAfterRepay.stableBorrowRate),
              isAlmostEqual(expectedReserveDataAfterRepay.variableBorrowRate),
              expectedReserveDataAfterRepay.liquidityIndex,
              expectedReserveDataAfterRepay.variableBorrowIndex
            );

          await expect(repayTx)
            .to.emit(usdc, "Transfer")
            .withArgs(
              borrower.address,
              await mUSDC.getAddress(),
              repaymentAmount
            );

          // The Repay event is emitted by the RepayLogic.sol library, so we need to get the contract instance with the RepayLogic ABI
          const contractInstanceWithRepayLibraryABI =
            await ethers.getContractAt(
              "RepayLogic",
              await lendingPool.getAddress(),
              owner
            );

          await expect(repayTx)
            .to.emit(contractInstanceWithRepayLibraryABI, "Repay")
            .withArgs(
              await usdc.getAddress(),
              borrower.address,
              borrower.address,
              repaymentAmount
            );

          await expect(repayTx).to.emit(mUSDC, "Transfer");
          await expect(repayTx).to.emit(mUSDC, "Mint");
          await expect(repayTx).to.not.emit(stableDebtToken, "Mint");

          await expect(repayTx).to.not.emit(
            yieldBoostStakingUSDC,
            "StakePositionCreated"
          );

          await expect(repayTx).to.not.emit(
            yieldBoostStakingUSDC,
            "StakePositionUpdated"
          );

          await expect(repayTx).to.not.emit(
            yieldBoostStakingUSDC,
            "StakePositionRemoved"
          );

          await expect(repayTx).to.not.emit(
            yieldBoostStakingUSDC,
            "RewardsClaimed"
          );

          await expect(repayTx)
            .to.emit(lendingPool, "RefreshYieldBoostAmount")
            .withArgs(await usdc.getAddress(), borrower.address, 0n);

          await expect(repayTx).to.not.emit(lendingPool, "UnlockMeldBankerNFT");

          expect(await lendingPool.isUsingMeldBanker(borrower.address)).to.be
            .false;

          expect(await lendingPool.isMeldBankerBlocked(0n)).to.be.false;

          const meldBankerData = await lendingPool.userMeldBankerData(
            borrower.address
          );
          expect(meldBankerData.tokenId).to.equal(0n);
          expect(meldBankerData.asset).to.equal(ZeroAddress);
          expect(meldBankerData.meldBankerType).to.equal(MeldBankerType.NONE);
          expect(meldBankerData.action).to.equal(Action.NONE);

          expect(
            await yieldBoostStorageUSDC.getStakerStakedAmount(borrower.address)
          ).to.equal(0n);
        });

        it("Should emit correct events when borrower tries to repay full debt (MaxUint256) but debt asset balance is too low", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            tether,
            owner,
            borrower,
            rando,
          } = await loadFixture(setUpSingleStableBorrowTetherFixture);

          // Simulate borrower spending some of the borrowed funds.
          // Debt is 1250 Tether, borrower has 3750 Tether
          const spendingAmount = await convertToCurrencyDecimals(
            await tether.getAddress(),
            "2650"
          );
          await tether
            .connect(borrower)
            .transfer(rando.address, spendingAmount);

          const payerDebtAssetBalance = await tether.balanceOf(
            borrower.address
          );

          // Get reserve data before repaying
          const reserveDataBeforeRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await tether.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before repaying
          const userDataBeforeRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await tether.getAddress(),
            borrower.address
          );

          // Instantiate reserve token contracts for borrower's collateral
          const reserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await tether.getAddress()
            );

          const mUSDT = await ethers.getContractAt(
            "MToken",
            reserveTokenAddresses.mTokenAddress
          );

          const stableDebtToken = await ethers.getContractAt(
            "StableDebtToken",
            reserveTokenAddresses.stableDebtTokenAddress
          );

          // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
          time.setNextBlockTimestamp(await time.latest());

          // Repay full debt
          const repayTx = await lendingPool.connect(borrower).repay(
            await tether.getAddress(),
            MaxUint256, // flag for full debt repayment
            RateMode.Stable,
            borrower.address
          );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(repayTx);

          // Calculate expected reserve data after repaying
          const expectedReserveDataAfterRepay: ReserveData =
            calcExpectedReserveDataAfterRepay(
              MaxUint256,
              RateMode.Stable,
              reserveDataBeforeRepay,
              userDataBeforeRepay,
              blockTimestamps.txTimestamp
            );

          const expectedAccumulatedInterest = calcCompoundedInterest(
            userDataBeforeRepay.stableBorrowRate,
            blockTimestamps.latestBlockTimestamp,
            userDataBeforeRepay.stableRateLastUpdated
          );

          const expectedCurrentBalance =
            userDataBeforeRepay.principalStableDebt.rayMul(
              expectedAccumulatedInterest
            );
          const expectedIncrease =
            expectedCurrentBalance - userDataBeforeRepay.principalStableDebt;

          // Check that the correct events were emitted
          await expect(repayTx)
            .to.emit(stableDebtToken, "Transfer")
            .withArgs(
              borrower.address,
              ZeroAddress,
              isAlmostEqual(payerDebtAssetBalance)
            );

          await expect(repayTx)
            .to.emit(stableDebtToken, "Burn")
            .withArgs(
              borrower.address,
              isAlmostEqual(payerDebtAssetBalance - expectedIncrease),
              expectedCurrentBalance,
              expectedIncrease,
              anyUint, // not checking actual value because due to a difference in solidity and Javascript, the value is different. It is tested in other test cases
              expectedReserveDataAfterRepay.totalStableDebt
            );

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          await expect(repayTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await tether.getAddress(),
              anyUint, // not checking actual value because due to a difference in solidity and Javascript, the value is different. It is tested in other test cases
              isAlmostEqual(expectedReserveDataAfterRepay.stableBorrowRate),
              isAlmostEqual(expectedReserveDataAfterRepay.variableBorrowRate),
              expectedReserveDataAfterRepay.liquidityIndex,
              expectedReserveDataAfterRepay.variableBorrowIndex
            );

          await expect(repayTx)
            .to.emit(tether, "Transfer")
            .withArgs(
              borrower.address,
              await mUSDT.getAddress(),
              isAlmostEqual(payerDebtAssetBalance)
            );

          // The Repay event is emitted by the RepayLogic.sol library, so we need to get the contract instance with the RepayLogic ABI
          const contractInstanceWithRepayLibraryABI =
            await ethers.getContractAt(
              "RepayLogic",
              await lendingPool.getAddress(),
              owner
            );

          await expect(repayTx)
            .to.emit(contractInstanceWithRepayLibraryABI, "Repay")
            .withArgs(
              await tether.getAddress(),
              borrower.address,
              borrower.address,
              isAlmostEqual(payerDebtAssetBalance)
            );

          await expect(repayTx).to.not.emit(mUSDT, "Transfer");
          await expect(repayTx).to.not.emit(mUSDT, "Mint");
          await expect(repayTx).to.not.emit(stableDebtToken, "Mint");
        });

        it("Should update state correctly when borrower tries to repay full debt (MaxUint256) but debt asset balance is too low", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            tether,
            borrower,
            rando,
          } = await loadFixture(setUpSingleStableBorrowTetherFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR);

          // Get reserve data before repaying
          const reserveDataBeforeRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await tether.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          const payerDebtAssetBalanceBeforeSpending = await tether.balanceOf(
            borrower.address
          );

          // Simulate borrower spending some of the borrowed funds.
          // Debt is 1250 Tether + interest, borrower has 3750 Tether
          const spendingAmount =
            payerDebtAssetBalanceBeforeSpending -
            reserveDataBeforeRepay.totalStableDebt;
          await tether
            .connect(borrower)
            .transfer(rando.address, spendingAmount);

          // Get user reserve data before repaying but after spending
          const userDataBeforeRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await tether.getAddress(),
            borrower.address
          );

          // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
          time.setNextBlockTimestamp(await time.latest());

          // Repay full debt
          const repayTx = await lendingPool.connect(borrower).repay(
            await tether.getAddress(),
            MaxUint256, // flag for full debt repayment
            RateMode.Stable,
            borrower.address
          );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(repayTx);

          // Get reserve data after repaying
          const reserveDataAfterRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await tether.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data after repaying
          const userDataAfterRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await tether.getAddress(),
            borrower.address
          );

          // Calculate expected reserve data after repaying
          const expectedReserveDataAfterRepay: ReserveData =
            calcExpectedReserveDataAfterRepay(
              MaxUint256,
              RateMode.Stable,
              reserveDataBeforeRepay,
              userDataBeforeRepay,
              blockTimestamps.txTimestamp
            );

          // Calculate expected user data after repaying
          const expectedUserDataAfterRepay: UserReserveData =
            calcExpectedUserDataAfterRepay(
              MaxUint256,
              RateMode.Stable,
              reserveDataBeforeRepay,
              expectedReserveDataAfterRepay,
              userDataBeforeRepay,
              borrower.address,
              borrower.address,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          // Because of differences in the way solidity and TS calculate values, the averageStableBorrowRate and liquididtyRate are not the same.
          // So we can't check those here. It has been confirmed that the difference in averageStableBorrowRate is due to the second term in the calculation
          // being off by 1 digit in TS from what solidity calculates. This has a knock-on effect on the liquidityRate calculation.
          expect(reserveDataAfterRepay.totalLiquidity).to.equal(
            expectedReserveDataAfterRepay.totalLiquidity
          );
          expect(reserveDataAfterRepay.utilizationRate).to.equal(
            expectedReserveDataAfterRepay.utilizationRate
          );
          expect(reserveDataAfterRepay.availableLiquidity).to.equal(
            expectedReserveDataAfterRepay.availableLiquidity
          );
          expect(reserveDataAfterRepay.totalStableDebt).to.equal(
            expectedReserveDataAfterRepay.totalStableDebt
          );
          expect(reserveDataAfterRepay.principalStableDebt).to.equal(
            expectedReserveDataAfterRepay.principalStableDebt
          );
          expect(reserveDataAfterRepay.stableBorrowRate).to.equal(
            expectedReserveDataAfterRepay.stableBorrowRate
          );
          expect(reserveDataAfterRepay.totalVariableDebt).to.equal(
            expectedReserveDataAfterRepay.totalVariableDebt
          );
          expect(reserveDataAfterRepay.scaledVariableDebt).to.equal(
            expectedReserveDataAfterRepay.scaledVariableDebt
          );
          expect(reserveDataAfterRepay.variableBorrowRate).to.closeTo(
            expectedReserveDataAfterRepay.variableBorrowRate,
            1
          );
          expect(reserveDataAfterRepay.variableBorrowIndex).to.equal(
            expectedReserveDataAfterRepay.variableBorrowIndex
          );
          expect(reserveDataAfterRepay.liquidityIndex).to.equal(
            expectedReserveDataAfterRepay.liquidityIndex
          );
          expect(reserveDataAfterRepay.lastUpdateTimestamp).to.equal(
            expectedReserveDataAfterRepay.lastUpdateTimestamp
          );
          expect(reserveDataAfterRepay.totalStableDebtLastUpdated).to.equal(
            expectedReserveDataAfterRepay.lastUpdateTimestamp
          );

          expect(userDataAfterRepay.currentStableDebt).to.equal(
            expectedUserDataAfterRepay.currentStableDebt
          );
          expect(userDataAfterRepay.principalStableDebt).to.equal(
            expectedUserDataAfterRepay.principalStableDebt
          );
          expect(userDataAfterRepay.stableBorrowRate).to.equal(
            expectedUserDataAfterRepay.stableBorrowRate
          );

          expect(userDataAfterRepay.currentVariableDebt).to.equal(
            expectedUserDataAfterRepay.currentVariableDebt
          );
          expect(userDataAfterRepay.scaledVariableDebt).to.equal(
            expectedUserDataAfterRepay.scaledVariableDebt
          );
          expect(userDataAfterRepay.scaledMTokenBalance).to.equal(
            expectedUserDataAfterRepay.scaledMTokenBalance
          );
          expect(userDataAfterRepay.currentMTokenBalance).to.equal(
            expectedUserDataAfterRepay.currentMTokenBalance
          );

          expect(userDataAfterRepay.usageAsCollateralEnabled).to.equal(
            expectedUserDataAfterRepay.usageAsCollateralEnabled
          );

          expect(userDataAfterRepay.stableRateLastUpdated).to.equal(
            expectedUserDataAfterRepay.stableRateLastUpdated
          );
          expect(userDataAfterRepay.walletBalanceUnderlyingAsset).to.equal(
            expectedUserDataAfterRepay.walletBalanceUnderlyingAsset
          );
        });

        it("Should update token balances correctly when borrower tries to repay full debt (MaxUint256) but debt asset balance is too low", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meld,
            borrower,
            rando,
          } = await loadFixture(setUpSingleStableBorrowMELDFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR * 2);

          // Simulate borrower spending some of the borrowed funds.
          // Debt is 2000 MELD + interest, borrower has 6000 MELD
          const spendingAmount = await convertToCurrencyDecimals(
            await meld.getAddress(),
            "5000"
          );
          await meld.connect(borrower).transfer(rando.address, spendingAmount);

          // Get reserve data before repaying
          const reserveDataBeforeRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before repaying
          const userDataBeforeRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await meld.getAddress(),
            borrower.address
          );

          const stableDebtToken = await ethers.getContractAt(
            "StableDebtToken",
            reserveDataBeforeRepay.stableDebtTokenAddress
          );

          const payerAssetBalanceBefore = await meld.balanceOf(
            borrower.address
          );
          const mTokenAssetBalanceBefore = await meld.balanceOf(
            reserveDataBeforeRepay.mTokenAddress
          );

          // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
          time.setNextBlockTimestamp(await time.latest());

          // Repay full debt
          const repayTx = await lendingPool.connect(borrower).repay(
            await meld.getAddress(),
            MaxUint256, // flag for full debt repayment
            RateMode.Stable,
            borrower.address
          );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(repayTx);

          // Calculate expected reserve data after repaying
          const expectedReserveDataAfterRepay: ReserveData =
            calcExpectedReserveDataAfterRepay(
              MaxUint256,
              RateMode.Stable,
              reserveDataBeforeRepay,
              userDataBeforeRepay,
              blockTimestamps.txTimestamp
            );

          // Calculate expected user data after repaying
          const expectedUserDataAfterRepay: UserReserveData =
            calcExpectedUserDataAfterRepay(
              MaxUint256,
              RateMode.Stable,
              reserveDataBeforeRepay,
              expectedReserveDataAfterRepay,
              userDataBeforeRepay,
              borrower.address,
              borrower.address,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          const { 0: principalSupply, 1: totalSupply } =
            await stableDebtToken.getSupplyData();

          // Check token balances
          expect(await stableDebtToken.balanceOf(borrower.address)).to.equal(
            expectedUserDataAfterRepay.currentStableDebt
          );

          expect(await stableDebtToken.balanceOf(borrower.address)).to.equal(
            userDataBeforeRepay.currentStableDebt - payerAssetBalanceBefore
          );

          expect(
            await stableDebtToken.principalBalanceOf(borrower.address)
          ).to.equal(expectedUserDataAfterRepay.principalStableDebt);

          // Check stable debt principal and total supply
          expect(principalSupply).to.equal(
            expectedReserveDataAfterRepay.principalStableDebt
          );

          expect(totalSupply).to.equal(
            expectedReserveDataAfterRepay.totalStableDebt
          );

          // Check borrower tokens after repayment
          expect(await meld.balanceOf(borrower.address)).to.equal(0n);

          // mToken should have balanceBefore plus full debt
          expect(
            await meld.balanceOf(reserveDataBeforeRepay.mTokenAddress)
          ).to.equal(mTokenAssetBalanceBefore + payerAssetBalanceBefore);
        });

        it("Should return correct value when making a static call", async function () {
          const { lendingPool, meldProtocolDataProvider, meld, borrower } =
            await loadFixture(setUpSingleStableBorrowMELDFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR / 2);

          // Get user reserve data before repaying
          const userDataBeforeRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await meld.getAddress(),
            borrower.address
          );

          // Repay full debt
          const returnedPaybackAmount = await lendingPool
            .connect(borrower)
            .repay.staticCall(
              await meld.getAddress(),
              MaxUint256,
              RateMode.Stable,
              borrower.address
            );

          expect(returnedPaybackAmount).to.equal(
            userDataBeforeRepay.currentStableDebt
          );

          const estimatedGas = await lendingPool
            .connect(borrower)
            .repay.estimateGas(
              await meld.getAddress(),
              MaxUint256,
              RateMode.Stable,
              borrower.address
            );

          expect(estimatedGas).to.be.gt(0);
        });
      }); // End Repay Single Stable Borrow Context

      context("Repay Single Variable Borrow", async function () {
        it("Should emit correct events when reserve factor == 0", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meld,
            owner,
            borrower,
          } = await loadFixture(setUpSingleVariableBorrowMELDFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR / 12);

          // Get reserve data before repaying
          const reserveDataBeforeRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          const mMELD = await ethers.getContractAt(
            "MToken",
            reserveDataBeforeRepay.mTokenAddress
          );

          const variableDebtToken = await ethers.getContractAt(
            "VariableDebtToken",
            reserveDataBeforeRepay.variableDebtTokenAddress
          );

          const repaymentAmount = await convertToCurrencyDecimals(
            await meld.getAddress(),
            "1000" // half of borrowed principal
          );

          // Get user reserve data before repaying
          const userDataBeforeRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await meld.getAddress(),
            borrower.address
          );

          // Repay partial debt
          const repayTx = await lendingPool
            .connect(borrower)
            .repay(
              await meld.getAddress(),
              repaymentAmount,
              RateMode.Variable,
              borrower.address
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(repayTx);

          // Calculate expected reserve data after repaying
          const expectedReserveDataAfterRepay: ReserveData =
            calcExpectedReserveDataAfterRepay(
              repaymentAmount,
              RateMode.Variable,
              reserveDataBeforeRepay,
              userDataBeforeRepay,
              blockTimestamps.txTimestamp
            );

          // Check that the correct events were emitted
          await expect(repayTx)
            .to.emit(variableDebtToken, "Transfer")
            .withArgs(borrower.address, ZeroAddress, repaymentAmount);

          await expect(repayTx)
            .to.emit(variableDebtToken, "Burn")
            .withArgs(
              borrower.address,
              repaymentAmount,
              expectedReserveDataAfterRepay.variableBorrowIndex
            );

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          await expect(repayTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await meld.getAddress(),
              expectedReserveDataAfterRepay.liquidityRate,
              isAlmostEqual(expectedReserveDataAfterRepay.stableBorrowRate),
              isAlmostEqual(expectedReserveDataAfterRepay.variableBorrowRate),
              expectedReserveDataAfterRepay.liquidityIndex,
              expectedReserveDataAfterRepay.variableBorrowIndex
            );

          await expect(repayTx)
            .to.emit(meld, "Transfer")
            .withArgs(
              borrower.address,
              await mMELD.getAddress(),
              repaymentAmount
            );

          // The Repay event is emitted by the RepayLogic.sol library, so we need to get the contract instance with the RepayLogic ABI
          const contractInstanceWithRepayLibraryABI =
            await ethers.getContractAt(
              "RepayLogic",
              await lendingPool.getAddress(),
              owner
            );

          await expect(repayTx)
            .to.emit(contractInstanceWithRepayLibraryABI, "Repay")
            .withArgs(
              await meld.getAddress(),
              borrower.address,
              borrower.address,
              repaymentAmount
            );

          await expect(repayTx).to.not.emit(mMELD, "Transfer");
          await expect(repayTx).to.not.emit(mMELD, "Mint");
        });

        it("Should emit correct events when reserve factor > 0 and amountToMint == 0 and repayment amount is MaxUnit256", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            tether,
            owner,
            borrower,
            borrowAmount,
          } = await loadFixture(setUpSingleVariableBorrowTetherFixture);

          // Get reserve data before repaying
          const reserveDataBeforeRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await tether.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before repaying
          const userDataBeforeRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await tether.getAddress(),
            borrower.address
          );

          const mUSDT = await ethers.getContractAt(
            "MToken",
            reserveDataBeforeRepay.mTokenAddress
          );

          const variableDebtToken = await ethers.getContractAt(
            "VariableDebtToken",
            reserveDataBeforeRepay.variableDebtTokenAddress
          );

          // Repay full debt
          const repayTx = await lendingPool.connect(borrower).repay(
            await tether.getAddress(),
            MaxUint256, // flag for full debt repayment
            RateMode.Variable,
            borrower.address
          );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(repayTx);

          // Calculate expected reserve data after repaying
          const expectedReserveDataAfterRepay: ReserveData =
            calcExpectedReserveDataAfterRepay(
              MaxUint256,
              RateMode.Variable,
              reserveDataBeforeRepay,
              userDataBeforeRepay,
              blockTimestamps.txTimestamp
            );

          // Check that the correct events were emitted
          await expect(repayTx)
            .to.emit(variableDebtToken, "Transfer")
            .withArgs(borrower.address, ZeroAddress, borrowAmount);

          await expect(repayTx)
            .to.emit(variableDebtToken, "Burn")
            .withArgs(
              borrower.address,
              borrowAmount,
              expectedReserveDataAfterRepay.variableBorrowIndex
            );

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          await expect(repayTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await tether.getAddress(),
              expectedReserveDataAfterRepay.liquidityRate,
              isAlmostEqual(expectedReserveDataAfterRepay.stableBorrowRate),
              isAlmostEqual(expectedReserveDataAfterRepay.variableBorrowRate),
              expectedReserveDataAfterRepay.liquidityIndex,
              expectedReserveDataAfterRepay.variableBorrowIndex
            );

          await expect(repayTx)
            .to.emit(tether, "Transfer")
            .withArgs(borrower.address, await mUSDT.getAddress(), borrowAmount);

          // The Repay event is emitted by the RepayLogic.sol library, so we need to get the contract instance with the RepayLogic ABI
          const contractInstanceWithRepayLibraryABI =
            await ethers.getContractAt(
              "RepayLogic",
              await lendingPool.getAddress(),
              owner
            );

          await expect(repayTx)
            .to.emit(contractInstanceWithRepayLibraryABI, "Repay")
            .withArgs(
              await tether.getAddress(),
              borrower.address,
              borrower.address,
              borrowAmount
            );

          await expect(repayTx).to.not.emit(mUSDT, "Transfer");
          await expect(repayTx).to.not.emit(mUSDT, "Mint");
        });

        it("Should emit correct events when reserve factor > 0 and amountToMint > 0", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            tether,
            owner,
            borrower,
            treasury,
            borrowAmount,
          } = await loadFixture(setUpSingleVariableBorrowTetherFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR);

          // Get reserve data before repaying
          const reserveDataBeforeRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await tether.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before repaying
          const userDataBeforeRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await tether.getAddress(),
            borrower.address
          );

          const mUSDT = await ethers.getContractAt(
            "MToken",
            reserveDataBeforeRepay.mTokenAddress
          );

          const variableDebtToken = await ethers.getContractAt(
            "VariableDebtToken",
            reserveDataBeforeRepay.variableDebtTokenAddress
          );

          const repaymentAmount = await convertToCurrencyDecimals(
            await tether.getAddress(),
            "100" // part of borrowed amount
          );

          // Repay partial debt
          const repayTx = await lendingPool
            .connect(borrower)
            .repay(
              await tether.getAddress(),
              repaymentAmount,
              RateMode.Variable,
              borrower.address
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(repayTx);

          // Calculate expected reserve data after repaying
          const expectedReserveDataAfterRepay: ReserveData =
            calcExpectedReserveDataAfterRepay(
              repaymentAmount,
              RateMode.Variable,
              reserveDataBeforeRepay,
              userDataBeforeRepay,
              blockTimestamps.txTimestamp
            );

          // Check that the correct events were emitted
          await expect(repayTx)
            .to.emit(variableDebtToken, "Transfer")
            .withArgs(borrower.address, ZeroAddress, repaymentAmount);

          await expect(repayTx)
            .to.emit(variableDebtToken, "Burn")
            .withArgs(
              borrower.address,
              repaymentAmount,
              expectedReserveDataAfterRepay.variableBorrowIndex
            );

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          await expect(repayTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await tether.getAddress(),
              expectedReserveDataAfterRepay.liquidityRate,
              isAlmostEqual(expectedReserveDataAfterRepay.stableBorrowRate),
              isAlmostEqual(expectedReserveDataAfterRepay.variableBorrowRate),
              expectedReserveDataAfterRepay.liquidityIndex,
              expectedReserveDataAfterRepay.variableBorrowIndex
            );

          await expect(repayTx)
            .to.emit(tether, "Transfer")
            .withArgs(
              borrower.address,
              await mUSDT.getAddress(),
              repaymentAmount
            );

          // The Repay event is emitted by the RepayLogic.sol library, so we need to get the contract instance with the RepayLogic ABI
          const contractInstanceWithRepayLibraryABI =
            await ethers.getContractAt(
              "RepayLogic",
              await lendingPool.getAddress(),
              owner
            );

          await expect(repayTx)
            .to.emit(contractInstanceWithRepayLibraryABI, "Repay")
            .withArgs(
              await tether.getAddress(),
              borrower.address,
              borrower.address,
              repaymentAmount
            );

          const currentVariableDebt = BigInt(
            reserveDataBeforeRepay.totalVariableDebt
          ); // The mint to treasury happens before debt token burning
          const previousVariableDebt = BigInt(borrowAmount); // This is the amount borrowed in the  borrow transaction
          const currentStableDebt = BigInt(0);
          const previousStableDebt = BigInt(0);

          const totalDebtAccrued =
            currentVariableDebt +
            currentStableDebt -
            previousVariableDebt -
            previousStableDebt;

          const { reserveFactor } =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await tether.getAddress()
            );
          const amountToMint = totalDebtAccrued.percentMul(
            BigInt(reserveFactor)
          );

          await expect(repayTx)
            .to.emit(mUSDT, "Transfer")
            .withArgs(ZeroAddress, treasury.address, amountToMint);

          await expect(repayTx)
            .to.emit(mUSDT, "Mint")
            .withArgs(
              treasury.address,
              isAlmostEqual(amountToMint),
              expectedReserveDataAfterRepay.liquidityIndex
            );
        });

        it("Should emit correct events if repayment amount is more than debt owed", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            tether,
            owner,
            borrower,
            borrowAmount,
          } = await loadFixture(setUpSingleVariableBorrowTetherFixture);

          // Get reserve data before repaying
          const reserveDataBeforeRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await tether.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before repaying
          const userDataBeforeRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await tether.getAddress(),
            borrower.address
          );

          const mUSDT = await ethers.getContractAt(
            "MToken",
            reserveDataBeforeRepay.mTokenAddress
          );

          const variableDebtToken = await ethers.getContractAt(
            "VariableDebtToken",
            reserveDataBeforeRepay.variableDebtTokenAddress
          );

          // userDataBeforeRepay.currentVariableDebt == current variable debt owed, including interest
          const repaymentAmount =
            userDataBeforeRepay.currentVariableDebt +
            10n ** reserveDataBeforeRepay.decimals;

          // Repay more than debt
          const repayTx = await lendingPool
            .connect(borrower)
            .repay(
              await tether.getAddress(),
              repaymentAmount,
              RateMode.Variable,
              borrower.address
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(repayTx);

          // Calculate expected reserve data after repaying
          const expectedReserveDataAfterRepay: ReserveData =
            calcExpectedReserveDataAfterRepay(
              repaymentAmount,
              RateMode.Variable,
              reserveDataBeforeRepay,
              userDataBeforeRepay,
              blockTimestamps.txTimestamp
            );

          // Check that the correct events were emitted
          await expect(repayTx)
            .to.emit(variableDebtToken, "Transfer")
            .withArgs(borrower.address, ZeroAddress, borrowAmount);

          await expect(repayTx)
            .to.emit(variableDebtToken, "Burn")
            .withArgs(
              borrower.address,
              borrowAmount,
              expectedReserveDataAfterRepay.variableBorrowIndex
            );

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          await expect(repayTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await tether.getAddress(),
              expectedReserveDataAfterRepay.liquidityRate,
              isAlmostEqual(expectedReserveDataAfterRepay.stableBorrowRate),
              isAlmostEqual(expectedReserveDataAfterRepay.variableBorrowRate),
              expectedReserveDataAfterRepay.liquidityIndex,
              expectedReserveDataAfterRepay.variableBorrowIndex
            );

          await expect(repayTx)
            .to.emit(tether, "Transfer")
            .withArgs(borrower.address, await mUSDT.getAddress(), borrowAmount);

          // The Repay event is emitted by the RepayLogic.sol library, so we need to get the contract instance with the RepayLogic ABI
          const contractInstanceWithRepayLibraryABI =
            await ethers.getContractAt(
              "RepayLogic",
              await lendingPool.getAddress(),
              owner
            );

          await expect(repayTx)
            .to.emit(contractInstanceWithRepayLibraryABI, "Repay")
            .withArgs(
              await tether.getAddress(),
              borrower.address,
              borrower.address,
              borrowAmount
            );

          await expect(repayTx).to.not.emit(mUSDT, "Transfer");
          await expect(repayTx).to.not.emit(mUSDT, "Mint");
        });

        it("Should emit correct events if another user repays debt on behalf of borrower", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meld,
            owner,
            borrower,
            rando,
          } = await loadFixture(setUpSingleVariableBorrowMELDFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR * 1.5);

          // Get reserve data before repaying
          const reserveDataBeforeRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          const mMELD = await ethers.getContractAt(
            "MToken",
            reserveDataBeforeRepay.mTokenAddress
          );

          const variableDebtToken = await ethers.getContractAt(
            "VariableDebtToken",
            reserveDataBeforeRepay.variableDebtTokenAddress
          );

          const repaymentAmount = await allocateAndApproveTokens(
            meld,
            owner,
            rando,
            lendingPool,
            1000n,
            0n
          );

          // Get user reserve data before repaying
          const userDataBeforeRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await meld.getAddress(),
            borrower.address
          );

          // Repay partial debt
          const repayTx = await lendingPool
            .connect(rando)
            .repay(
              await meld.getAddress(),
              repaymentAmount,
              RateMode.Variable,
              borrower.address
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(repayTx);

          // Calculate expected reserve data after repaying
          const expectedReserveDataAfterRepay: ReserveData =
            calcExpectedReserveDataAfterRepay(
              repaymentAmount,
              RateMode.Variable,
              reserveDataBeforeRepay,
              userDataBeforeRepay,
              blockTimestamps.txTimestamp
            );

          // Check that the correct events were emitted
          await expect(repayTx)
            .to.emit(variableDebtToken, "Transfer")
            .withArgs(borrower.address, ZeroAddress, repaymentAmount);

          await expect(repayTx)
            .to.emit(variableDebtToken, "Burn")
            .withArgs(
              borrower.address,
              repaymentAmount,
              expectedReserveDataAfterRepay.variableBorrowIndex
            );

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          await expect(repayTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await meld.getAddress(),
              isAlmostEqual(expectedReserveDataAfterRepay.liquidityRate),
              isAlmostEqual(expectedReserveDataAfterRepay.stableBorrowRate),
              isAlmostEqual(expectedReserveDataAfterRepay.variableBorrowRate),
              expectedReserveDataAfterRepay.liquidityIndex,
              expectedReserveDataAfterRepay.variableBorrowIndex
            );

          await expect(repayTx)
            .to.emit(meld, "Transfer")
            .withArgs(rando.address, await mMELD.getAddress(), repaymentAmount);

          // The Repay event is emitted by the RepayLogic.sol library, so we need to get the contract instance with the RepayLogic ABI
          const contractInstanceWithRepayLibraryABI =
            await ethers.getContractAt(
              "RepayLogic",
              await lendingPool.getAddress(),
              owner
            );

          await expect(repayTx)
            .to.emit(contractInstanceWithRepayLibraryABI, "Repay")
            .withArgs(
              await meld.getAddress(),
              borrower.address,
              rando.address,
              repaymentAmount
            );

          await expect(repayTx).to.not.emit(mMELD, "Transfer");
          await expect(repayTx).to.not.emit(mMELD, "Mint");
        });

        it("Should update state correctly for partial repayment", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meld,
            borrower,
          } = await loadFixture(setUpSingleVariableBorrowMELDFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR / 2);

          // Get reserve data before repaying
          const reserveDataBeforeRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before repaying
          const userDataBeforeRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await meld.getAddress(),
            borrower.address
          );

          const repaymentAmount = await convertToCurrencyDecimals(
            await meld.getAddress(),
            "1000" // half of borrowed principal
          );

          // Repay partial debt
          const repayTx = await lendingPool
            .connect(borrower)
            .repay(
              await meld.getAddress(),
              repaymentAmount,
              RateMode.Variable,
              borrower.address
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(repayTx);

          // Get reserve data after repaying
          const reserveDataAfterRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data after repaying
          const userDataAfterRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await meld.getAddress(),
            borrower.address
          );

          // Calculate expected reserve data after repaying
          const expectedReserveDataAfterRepay: ReserveData =
            calcExpectedReserveDataAfterRepay(
              repaymentAmount,
              RateMode.Variable,
              reserveDataBeforeRepay,
              userDataBeforeRepay,
              blockTimestamps.txTimestamp
            );

          // Calculate expected user data after repaying
          const expectedUserDataAfterRepay: UserReserveData =
            calcExpectedUserDataAfterRepay(
              repaymentAmount,
              RateMode.Variable,
              reserveDataBeforeRepay,
              expectedReserveDataAfterRepay,
              userDataBeforeRepay,
              borrower.address,
              borrower.address,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          expectEqual(reserveDataAfterRepay, expectedReserveDataAfterRepay);
          expectEqual(userDataAfterRepay, expectedUserDataAfterRepay);
        });

        it("Should update state correctly for full debt repayment (MaxUint256)", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            tether,
            borrower,
          } = await loadFixture(setUpSingleVariableBorrowTetherFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR);

          // Get reserve data before repaying
          const reserveDataBeforeRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await tether.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before repaying
          const userDataBeforeRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await tether.getAddress(),
            borrower.address
          );

          // Repay full debt
          const repayTx = await lendingPool.connect(borrower).repay(
            await tether.getAddress(),
            MaxUint256, // repay full amount
            RateMode.Variable,
            borrower.address
          );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(repayTx);

          // Get reserve data after repaying
          const reserveDataAfterRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await tether.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data after repaying
          const userDataAfterRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await tether.getAddress(),
            borrower.address
          );

          // Calculate expected reserve data after repaying
          const expectedReserveDataAfterRepay: ReserveData =
            calcExpectedReserveDataAfterRepay(
              MaxUint256,
              RateMode.Variable,
              reserveDataBeforeRepay,
              userDataBeforeRepay,
              blockTimestamps.txTimestamp
            );

          // Calculate expected user data after repaying
          const expectedUserDataAfterRepay: UserReserveData =
            calcExpectedUserDataAfterRepay(
              MaxUint256,
              RateMode.Variable,
              reserveDataBeforeRepay,
              expectedReserveDataAfterRepay,
              userDataBeforeRepay,
              borrower.address,
              borrower.address,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          expectEqual(reserveDataAfterRepay, expectedReserveDataAfterRepay);
          expectEqual(userDataAfterRepay, expectedUserDataAfterRepay);
        });

        it("Should update state correctly if repayment amount is more than debt owed", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            tether,
            borrower,
          } = await loadFixture(setUpSingleVariableBorrowTetherFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR / 4);

          // Get reserve data before repaying
          const reserveDataBeforeRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await tether.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before repaying
          const userDataBeforeRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await tether.getAddress(),
            borrower.address
          );

          // userDataBeforeRepay.currentVariableDebt == current variable debt owed, including interest
          // This tests that the state is correct if the repaymentAmount is only one decimal unit more than the debt owed
          const repaymentAmount = userDataBeforeRepay.currentVariableDebt + 1n;

          // Repay too much debt
          const repayTx = await lendingPool
            .connect(borrower)
            .repay(
              await tether.getAddress(),
              repaymentAmount,
              RateMode.Variable,
              borrower.address
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(repayTx);

          // Get reserve data after repaying
          const reserveDataAfterRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await tether.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data after repaying
          const userDataAfterRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await tether.getAddress(),
            borrower.address
          );

          // Calculate expected reserve data after repaying
          const expectedReserveDataAfterRepay: ReserveData =
            calcExpectedReserveDataAfterRepay(
              repaymentAmount,
              RateMode.Variable,
              reserveDataBeforeRepay,
              userDataBeforeRepay,
              blockTimestamps.txTimestamp
            );

          // Calculate expected user data after repaying
          const expectedUserDataAfterRepay: UserReserveData =
            calcExpectedUserDataAfterRepay(
              repaymentAmount,
              RateMode.Variable,
              reserveDataBeforeRepay,
              expectedReserveDataAfterRepay,
              userDataBeforeRepay,
              borrower.address,
              borrower.address,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          expectEqual(reserveDataAfterRepay, expectedReserveDataAfterRepay);
          expectEqual(userDataAfterRepay, expectedUserDataAfterRepay);
        });

        it("Should update state correctly if borrower only repays principal debt", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            tether,
            borrower,
          } = await loadFixture(setUpSingleVariableBorrowTetherFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR * 1.5);

          // Get reserve data before repaying
          const reserveDataBeforeRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await tether.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before repaying
          const userDataBeforeRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await tether.getAddress(),
            borrower.address
          );

          // scaledVariableDebt == user's principal variable debt
          const repaymentAmount = userDataBeforeRepay.scaledVariableDebt;

          // Repay principal debt only
          const repayTx = await lendingPool
            .connect(borrower)
            .repay(
              await tether.getAddress(),
              repaymentAmount,
              RateMode.Variable,
              borrower.address
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(repayTx);

          // Get reserve data after repaying
          const reserveDataAfterRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await tether.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data after repaying
          const userDataAfterRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await tether.getAddress(),
            borrower.address
          );

          // Calculate expected reserve data after repaying
          const expectedReserveDataAfterRepay: ReserveData =
            calcExpectedReserveDataAfterRepay(
              repaymentAmount,
              RateMode.Variable,
              reserveDataBeforeRepay,
              userDataBeforeRepay,
              blockTimestamps.txTimestamp
            );

          // Calculate expected user data after repaying
          const expectedUserDataAfterRepay: UserReserveData =
            calcExpectedUserDataAfterRepay(
              repaymentAmount,
              RateMode.Variable,
              reserveDataBeforeRepay,
              expectedReserveDataAfterRepay,
              userDataBeforeRepay,
              borrower.address,
              borrower.address,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          expectEqual(reserveDataAfterRepay, expectedReserveDataAfterRepay);
          expectEqual(userDataAfterRepay, expectedUserDataAfterRepay);

          // Specifically check that user still has debt since only principal was paid
          expect(userDataAfterRepay.currentVariableDebt).to.be.gt(0n);
        });

        it("Should update state correctly if another user repays debt on behalf of borrower", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            tether,
            borrower,
            owner,
            rando,
          } = await loadFixture(setUpSingleVariableBorrowTetherFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR / 6);

          // Get reserve data before repaying
          const reserveDataBeforeRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await tether.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before repaying
          const userDataBeforeRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await tether.getAddress(),
            borrower.address
          );

          // scaledVariableDebt == user's principal variable debt
          const repaymentAmount = userDataBeforeRepay.scaledVariableDebt;

          // Make sure payer has some tokens to pay with
          await allocateAndApproveTokens(
            tether,
            owner,
            rando,
            lendingPool,
            1250n * 2n, // 2x the amount borrowed
            0n
          );

          // Repay principal debt
          const repayTx = await lendingPool
            .connect(rando)
            .repay(
              await tether.getAddress(),
              repaymentAmount,
              RateMode.Variable,
              borrower.address
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(repayTx);

          // Get reserve data after repaying
          const reserveDataAfterRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await tether.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data after repaying
          const userDataAfterRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await tether.getAddress(),
            borrower.address
          );

          // Calculate expected reserve data after repaying
          const expectedReserveDataAfterRepay: ReserveData =
            calcExpectedReserveDataAfterRepay(
              repaymentAmount,
              RateMode.Variable,
              reserveDataBeforeRepay,
              userDataBeforeRepay,
              blockTimestamps.txTimestamp
            );

          // Calculate expected user data after repaying
          const expectedUserDataAfterRepay: UserReserveData =
            calcExpectedUserDataAfterRepay(
              repaymentAmount,
              RateMode.Variable,
              reserveDataBeforeRepay,
              expectedReserveDataAfterRepay,
              userDataBeforeRepay,
              rando.address,
              borrower.address,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          expectEqual(reserveDataAfterRepay, expectedReserveDataAfterRepay);
          expectEqual(userDataAfterRepay, expectedUserDataAfterRepay);
        });

        it("Should update state correctly if multiple repayments are made on same loan", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meld,
            borrower,
          } = await loadFixture(setUpSingleVariableBorrowMELDFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR / 2);

          // Get reserve data before repaying
          const reserveDataBeforeRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before repaying
          const userDataBeforeRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await meld.getAddress(),
            borrower.address
          );

          const repaymentAmount = await convertToCurrencyDecimals(
            await meld.getAddress(),
            "1000" // half of borrowed principal
          );

          // Repay partial debt
          await lendingPool
            .connect(borrower)
            .repay(
              await meld.getAddress(),
              repaymentAmount,
              RateMode.Variable,
              borrower.address
            );

          // Simulate time passing
          await time.increase(ONE_YEAR / 4);

          // Repay rest of debt
          const repayTx = await lendingPool.connect(borrower).repay(
            await meld.getAddress(),
            MaxUint256, // flag for full debt repayment
            RateMode.Variable,
            borrower.address
          );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(repayTx);

          // Get reserve data after repaying
          const reserveDataAfterRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data after repaying
          const userDataAfterRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await meld.getAddress(),
            borrower.address
          );

          // Calculate expected reserve data after repaying
          const expectedReserveDataAfterRepay: ReserveData =
            calcExpectedReserveDataAfterRepay(
              MaxUint256,
              RateMode.Variable,
              reserveDataBeforeRepay,
              userDataBeforeRepay,
              blockTimestamps.txTimestamp
            );

          // Calculate expected user data after repaying
          const expectedUserDataAfterRepay: UserReserveData =
            calcExpectedUserDataAfterRepay(
              MaxUint256,
              RateMode.Variable,
              reserveDataBeforeRepay,
              expectedReserveDataAfterRepay,
              userDataBeforeRepay,
              borrower.address,
              borrower.address,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          // Checking state fields individually. Due to a difference in how solidity and TS calculate
          // some values, the expected and actual values are not exactly the same, so we can't use expectEqual
          // to compare the entire objects. Even with the same inputs, the TS code calulates averageStableBorrowRate to have
          // a last digit that is higher by 1 than the same calculation in solidity. This also affects the liquidityRate, so
          // those values can only be checked that value after repayment is lower than before repayment.
          expect(reserveDataAfterRepay.totalLiquidity).to.be.lessThan(
            expectedReserveDataAfterRepay.totalLiquidity
          );
          expect(reserveDataAfterRepay.utilizationRate).to.equal(
            expectedReserveDataAfterRepay.utilizationRate
          );
          expect(reserveDataAfterRepay.availableLiquidity).to.be.lessThan(
            expectedReserveDataAfterRepay.availableLiquidity
          );
          expect(reserveDataAfterRepay.totalStableDebt).to.equal(
            expectedReserveDataAfterRepay.totalStableDebt
          );
          expect(reserveDataAfterRepay.totalVariableDebt).to.equal(
            expectedReserveDataAfterRepay.totalVariableDebt
          );
          expect(reserveDataAfterRepay.liquidityRate).to.be.equal(
            expectedReserveDataAfterRepay.liquidityRate
          );
          expect(reserveDataAfterRepay.variableBorrowRate).to.equal(
            expectedReserveDataAfterRepay.variableBorrowRate
          );
          expect(reserveDataAfterRepay.stableBorrowRate).to.equal(
            expectedReserveDataAfterRepay.stableBorrowRate
          );
          expect(reserveDataAfterRepay.averageStableBorrowRate).to.equal(
            expectedReserveDataAfterRepay.averageStableBorrowRate
          );
          expect(reserveDataAfterRepay.liquidityIndex).to.be.lessThan(
            expectedReserveDataAfterRepay.liquidityIndex
          );
          expect(reserveDataAfterRepay.variableBorrowIndex).to.be.lessThan(
            expectedReserveDataAfterRepay.variableBorrowIndex
          );
          expect(reserveDataAfterRepay.lastUpdateTimestamp).to.equal(
            expectedReserveDataAfterRepay.lastUpdateTimestamp
          );
          expect(reserveDataAfterRepay.totalStableDebtLastUpdated).to.equal(
            expectedReserveDataAfterRepay.totalStableDebtLastUpdated
          );
          expect(reserveDataAfterRepay.principalStableDebt).to.equal(
            expectedReserveDataAfterRepay.principalStableDebt
          );
          expect(reserveDataAfterRepay.scaledVariableDebt).to.equal(
            expectedReserveDataAfterRepay.scaledVariableDebt
          );
          expect(reserveDataAfterRepay.marketStableRate).to.equal(
            expectedReserveDataAfterRepay.marketStableRate
          );

          expect(userDataAfterRepay.scaledMTokenBalance).to.equal(
            expectedUserDataAfterRepay.scaledMTokenBalance
          );
          expect(userDataAfterRepay.currentMTokenBalance).to.equal(
            expectedUserDataAfterRepay.currentMTokenBalance
          );
          expect(userDataAfterRepay.currentStableDebt).to.equal(
            expectedUserDataAfterRepay.currentStableDebt
          );
          expect(userDataAfterRepay.currentVariableDebt).to.equal(
            expectedUserDataAfterRepay.currentVariableDebt
          );
          expect(userDataAfterRepay.principalStableDebt).to.equal(
            expectedUserDataAfterRepay.principalStableDebt
          );
          expect(userDataAfterRepay.scaledVariableDebt).to.equal(
            expectedUserDataAfterRepay.scaledVariableDebt
          );
          expect(userDataAfterRepay.stableBorrowRate).to.equal(
            expectedUserDataAfterRepay.stableBorrowRate
          );
          expect(userDataAfterRepay.liquidityRate).to.equal(
            expectedUserDataAfterRepay.liquidityRate
          );
          expect(userDataAfterRepay.stableRateLastUpdated).to.equal(
            expectedUserDataAfterRepay.stableRateLastUpdated
          );
          expect(userDataAfterRepay.lastUpdateTimestamp).to.equal(
            expectedUserDataAfterRepay.lastUpdateTimestamp
          );
          expect(
            userDataAfterRepay.walletBalanceUnderlyingAsset
          ).to.be.greaterThan(
            expectedUserDataAfterRepay.walletBalanceUnderlyingAsset
          );
        });

        it("Should update token balances correctly for partial repayment", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meld,
            borrower,
          } = await loadFixture(setUpSingleVariableBorrowMELDFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR);

          // Get reserve data before repaying
          const reserveDataBeforeRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before repaying
          const userDataBeforeRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await meld.getAddress(),
            borrower.address
          );

          const variableDebtToken = await ethers.getContractAt(
            "VariableDebtToken",
            reserveDataBeforeRepay.variableDebtTokenAddress
          );

          const borrowerAssetBalanceBefore = await meld.balanceOf(
            borrower.address
          );
          const mTokenAssetBalanceBefore = await meld.balanceOf(
            reserveDataBeforeRepay.mTokenAddress
          );

          const repaymentAmount = await convertToCurrencyDecimals(
            await meld.getAddress(),
            "1500" // part of borrowed amount
          );

          // Repay partial debt
          const repayTx = await lendingPool
            .connect(borrower)
            .repay(
              await meld.getAddress(),
              repaymentAmount,
              RateMode.Variable,
              borrower.address
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(repayTx);

          // Calculate expected reserve data after repaying
          const expectedReserveDataAfterRepay: ReserveData =
            calcExpectedReserveDataAfterRepay(
              repaymentAmount,
              RateMode.Variable,
              reserveDataBeforeRepay,
              userDataBeforeRepay,
              blockTimestamps.txTimestamp
            );

          // Calculate expected user data after repaying
          const expectedUserDataAfterRepay: UserReserveData =
            calcExpectedUserDataAfterRepay(
              repaymentAmount,
              RateMode.Variable,
              reserveDataBeforeRepay,
              expectedReserveDataAfterRepay,
              userDataBeforeRepay,
              borrower.address,
              borrower.address,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          // Check token balances
          expect(await variableDebtToken.balanceOf(borrower.address)).to.equal(
            expectedUserDataAfterRepay.currentVariableDebt
          );

          expect(
            await variableDebtToken.scaledBalanceOf(borrower.address)
          ).to.equal(expectedUserDataAfterRepay.scaledVariableDebt);

          // Check variable debt total and scaled supply
          expect(await variableDebtToken.totalSupply()).to.equal(
            expectedReserveDataAfterRepay.totalVariableDebt
          );

          expect(await variableDebtToken.scaledTotalSupply()).to.equal(
            expectedReserveDataAfterRepay.scaledVariableDebt
          );

          // Borrower should have balanceBefore minus amount repaid
          expect(await meld.balanceOf(borrower.address)).to.equal(
            borrowerAssetBalanceBefore - repaymentAmount
          );

          // mToken should have balanceBefore plus amount repaid
          expect(
            await meld.balanceOf(reserveDataBeforeRepay.mTokenAddress)
          ).to.equal(mTokenAssetBalanceBefore + repaymentAmount);
        });

        it("Should update token balances correctly for full debt repayment (MaxUint256)", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meld,
            borrower,
          } = await loadFixture(setUpSingleVariableBorrowMELDFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR * 2);

          // Get reserve data before repaying
          const reserveDataBeforeRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before repaying
          const userDataBeforeRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await meld.getAddress(),
            borrower.address
          );

          const variableDebtToken = await ethers.getContractAt(
            "VariableDebtToken",
            reserveDataBeforeRepay.variableDebtTokenAddress
          );

          const borrowerAssetBalanceBefore = await meld.balanceOf(
            borrower.address
          );
          const mTokenAssetBalanceBefore = await meld.balanceOf(
            reserveDataBeforeRepay.mTokenAddress
          );

          // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
          time.setNextBlockTimestamp(await time.latest());

          // Repay full debt
          await lendingPool.connect(borrower).repay(
            await meld.getAddress(),
            MaxUint256, // flag for full debt repayment
            RateMode.Variable,
            borrower.address
          );

          // Check token balances
          expect(await variableDebtToken.balanceOf(borrower.address)).to.equal(
            0n
          );

          expect(
            await variableDebtToken.scaledBalanceOf(borrower.address)
          ).to.equal(0n);

          // Check variable debt total and scaled supply
          expect(await variableDebtToken.totalSupply()).to.equal(0n);

          expect(await variableDebtToken.scaledTotalSupply()).to.equal(0n);

          // Check borrower tokens after repayment
          expect(await meld.balanceOf(borrower.address)).to.equal(
            borrowerAssetBalanceBefore - userDataBeforeRepay.currentVariableDebt
          );

          // mToken should have balanceBefore plus whole borrow amount
          expect(
            await meld.balanceOf(reserveDataBeforeRepay.mTokenAddress)
          ).to.equal(
            mTokenAssetBalanceBefore + userDataBeforeRepay.currentVariableDebt
          );
        });

        it("Should update token balances correctly if repayment amount is more than debt owed", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            tether,
            borrower,
          } = await loadFixture(setUpSingleVariableBorrowTetherFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR / 4);

          // Get reserve data before repaying
          const reserveDataBeforeRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await tether.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before repaying
          const userDataBeforeRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await tether.getAddress(),
            borrower.address
          );

          const variableDebtToken = await ethers.getContractAt(
            "VariableDebtToken",
            reserveDataBeforeRepay.variableDebtTokenAddress
          );

          const borrowerAssetBalanceBefore = await tether.balanceOf(
            borrower.address
          );
          const mTokenAssetBalanceBefore = await tether.balanceOf(
            reserveDataBeforeRepay.mTokenAddress
          );

          // userDataBeforeRepay.currentVariableDebt == current variable debt owed, including interest
          // This tests that the state is correct if the repaymentAmount is much greater than the debt owed
          const repaymentAmount =
            userDataBeforeRepay.currentVariableDebt +
            100n ** reserveDataBeforeRepay.decimals;

          // Repay too much debt
          await lendingPool
            .connect(borrower)
            .repay(
              await tether.getAddress(),
              repaymentAmount,
              RateMode.Variable,
              borrower.address
            );

          // Check token balances
          expect(await variableDebtToken.balanceOf(borrower.address)).to.equal(
            0n
          );

          expect(
            await variableDebtToken.scaledBalanceOf(borrower.address)
          ).to.equal(0n);

          // Check variable debt total and scaled supply
          expect(await variableDebtToken.totalSupply()).to.equal(0n);

          expect(await variableDebtToken.scaledTotalSupply()).to.equal(0n);

          // Check borrower has correct number of tokens after repayment. Should be balanceBefore minus the debt, not the repayment amount
          expect(await tether.balanceOf(borrower.address)).to.be.closeTo(
            borrowerAssetBalanceBefore -
              BigInt(userDataBeforeRepay.currentVariableDebt),
            1
          );

          // mToken should have balanceBefore plus whole debt amount, not the repayment amount
          expect(
            await tether.balanceOf(reserveDataBeforeRepay.mTokenAddress)
          ).to.equal(
            mTokenAssetBalanceBefore + userDataBeforeRepay.currentVariableDebt
          );
        });

        it("Should update token balances correctly if borrower only repays principal debt", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            tether,
            borrower,
          } = await loadFixture(setUpSingleVariableBorrowTetherFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR / 1.5);

          // Get reserve data before repaying
          const reserveDataBeforeRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await tether.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before repaying
          const userDataBeforeRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await tether.getAddress(),
            borrower.address
          );

          const variableDebtToken = await ethers.getContractAt(
            "VariableDebtToken",
            reserveDataBeforeRepay.variableDebtTokenAddress
          );

          const borrowerAssetBalanceBefore = await tether.balanceOf(
            borrower.address
          );
          const mTokenAssetBalanceBefore = await tether.balanceOf(
            reserveDataBeforeRepay.mTokenAddress
          );

          // scaledVariableDebt == user's principal variable debt
          const repaymentAmount = userDataBeforeRepay.scaledVariableDebt;

          // Repay principal debt
          const repayTx = await lendingPool
            .connect(borrower)
            .repay(
              await tether.getAddress(),
              repaymentAmount,
              RateMode.Variable,
              borrower.address
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(repayTx);

          // Calculate expected reserve data after repaying
          const expectedReserveDataAfterRepay: ReserveData =
            calcExpectedReserveDataAfterRepay(
              repaymentAmount,
              RateMode.Variable,
              reserveDataBeforeRepay,
              userDataBeforeRepay,
              blockTimestamps.txTimestamp
            );

          // Calculate expected user data after repaying
          const expectedUserDataAfterRepay: UserReserveData =
            calcExpectedUserDataAfterRepay(
              repaymentAmount,
              RateMode.Variable,
              reserveDataBeforeRepay,
              expectedReserveDataAfterRepay,
              userDataBeforeRepay,
              borrower.address,
              borrower.address,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          // Check token balances
          expect(await variableDebtToken.balanceOf(borrower.address)).to.equal(
            expectedUserDataAfterRepay.currentVariableDebt
          );

          expect(
            await variableDebtToken.scaledBalanceOf(borrower.address)
          ).to.equal(expectedUserDataAfterRepay.scaledVariableDebt);

          // Check variable debt total and scaled supply
          expect(await variableDebtToken.totalSupply()).to.equal(
            expectedReserveDataAfterRepay.totalVariableDebt
          );

          expect(await variableDebtToken.scaledTotalSupply()).to.equal(
            expectedReserveDataAfterRepay.scaledVariableDebt
          );

          // Check borrower has correct number of tokens after repayment.
          expect(await tether.balanceOf(borrower.address)).to.equal(
            borrowerAssetBalanceBefore - repaymentAmount
          );

          // mToken should have balanceBefore plus whole debt about, not the repayment amount
          expect(
            await tether.balanceOf(reserveDataBeforeRepay.mTokenAddress)
          ).to.equal(mTokenAssetBalanceBefore + repaymentAmount);
        });

        it("Should update token balances correctly if another user repays debt on behalf of borrower", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meld,
            usdc,
            borrower,
            owner,
            rando,
          } = await loadFixture(setUpSingleVariableBorrowMELDFixture);

          // Get reserve data before repaying
          const reserveDataBeforeRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before repaying
          const userDataBeforeRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await meld.getAddress(),
            borrower.address
          );

          const mMELD = await ethers.getContractAt(
            "MToken",
            reserveDataBeforeRepay.mTokenAddress
          );

          const variableDebtToken = await ethers.getContractAt(
            "VariableDebtToken",
            reserveDataBeforeRepay.variableDebtTokenAddress
          );

          // Instantiate reserve token contracts for borrower's collateral
          const reserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await usdc.getAddress()
            );

          const mUSDC = await ethers.getContractAt(
            "MToken",
            reserveTokenAddresses.mTokenAddress
          );

          const repaymentAmount = await convertToCurrencyDecimals(
            await meld.getAddress(),
            "1500" // part of borrowed amount
          );

          // Make sure payer has some tokens to pay with
          await allocateAndApproveTokens(
            meld,
            owner,
            rando,
            lendingPool,
            1500n,
            0n
          );

          const borrowerAssetBalanceBefore = await meld.balanceOf(
            borrower.address
          );
          const mTokenAssetBalanceBefore = await meld.balanceOf(
            reserveDataBeforeRepay.mTokenAddress
          );
          const payerAssetBalanceBefore = await meld.balanceOf(rando.address);
          const payerMTokenBalanceBefore = await mMELD.balanceOf(rando.address);
          const payerCollateralTokenBalanceBefore = await mUSDC.balanceOf(
            rando.address
          );

          // Repay partial debt
          const repayTx = await lendingPool
            .connect(rando)
            .repay(
              await meld.getAddress(),
              repaymentAmount,
              RateMode.Variable,
              borrower.address
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(repayTx);

          // Calculate expected reserve data after repaying
          const expectedReserveDataAfterRepay: ReserveData =
            calcExpectedReserveDataAfterRepay(
              repaymentAmount,
              RateMode.Variable,
              reserveDataBeforeRepay,
              userDataBeforeRepay,
              blockTimestamps.txTimestamp
            );

          // Calculate expected user data after repaying
          const expectedUserDataAfterRepay: UserReserveData =
            calcExpectedUserDataAfterRepay(
              repaymentAmount,
              RateMode.Variable,
              reserveDataBeforeRepay,
              expectedReserveDataAfterRepay,
              userDataBeforeRepay,
              borrower.address,
              rando.address,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          // Check token balances
          expect(await variableDebtToken.balanceOf(borrower.address)).to.equal(
            expectedUserDataAfterRepay.currentVariableDebt
          );

          expect(
            await variableDebtToken.scaledBalanceOf(borrower.address)
          ).to.equal(expectedUserDataAfterRepay.scaledVariableDebt);

          // Check variable debt total and scaled supply
          expect(await variableDebtToken.totalSupply()).to.equal(
            expectedReserveDataAfterRepay.totalVariableDebt
          );

          expect(await variableDebtToken.scaledTotalSupply()).to.equal(
            expectedReserveDataAfterRepay.scaledVariableDebt
          );

          // Borrower should have same balance as before
          expect(await meld.balanceOf(borrower.address)).to.equal(
            borrowerAssetBalanceBefore
          );

          // mToken should have balanceBefore plus amount repaid
          expect(
            await meld.balanceOf(reserveDataBeforeRepay.mTokenAddress)
          ).to.equal(mTokenAssetBalanceBefore + repaymentAmount);

          // Payer should have balance before minus amount repaid
          expect(await meld.balanceOf(rando.address)).to.equal(
            payerAssetBalanceBefore - repaymentAmount
          );

          // Payer should not receive mTokens
          expect(await mMELD.balanceOf(rando.address)).to.equal(
            payerMTokenBalanceBefore
          );

          // Payer should  not receive borrower's collateral tokens
          expect(await mUSDC.balanceOf(rando.address)).to.equal(
            payerCollateralTokenBalanceBefore
          );
        });

        it("Should update token balances correctly if multiple repayments are made on same loan", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meld,
            borrower,
          } = await loadFixture(setUpSingleVariableBorrowMELDFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR / 2);

          // Get reserve data before first repayment
          const reserveDataBeforeRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          const variableDebtToken = await ethers.getContractAt(
            "VariableDebtToken",
            reserveDataBeforeRepay.variableDebtTokenAddress
          );

          const repaymentAmount = await convertToCurrencyDecimals(
            await meld.getAddress(),
            "1000" // half of borrowed principal
          );

          // Repay partial debt
          await lendingPool
            .connect(borrower)
            .repay(
              await meld.getAddress(),
              repaymentAmount,
              RateMode.Variable,
              borrower.address
            );

          // Make second repayment right away
          const borrowerAssetBalanceBefore = await meld.balanceOf(
            borrower.address
          );
          const mTokenAssetBalanceBefore = await meld.balanceOf(
            reserveDataBeforeRepay.mTokenAddress
          );

          // Get user reserve data before repaying
          const userDataBeforeRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await meld.getAddress(),
            borrower.address
          );

          // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
          time.setNextBlockTimestamp(await time.latest());

          // Repay rest of debt
          await lendingPool
            .connect(borrower)
            .repay(
              await meld.getAddress(),
              MaxUint256,
              RateMode.Variable,
              borrower.address
            );

          // Check token balances after second repayment
          expect(await variableDebtToken.balanceOf(borrower.address)).to.equal(
            0n
          );

          expect(
            await variableDebtToken.scaledBalanceOf(borrower.address)
          ).to.equal(0n);

          // Check variable debt total and scaled supply
          expect(await variableDebtToken.totalSupply()).to.equal(0n);

          expect(await variableDebtToken.scaledTotalSupply()).to.equal(0n);

          // Borrower should have balance as before - amount repaid
          expect(await meld.balanceOf(borrower.address)).to.equal(
            borrowerAssetBalanceBefore - userDataBeforeRepay.currentVariableDebt
          );

          // mToken should have balanceBefore plus whole debt amount, not the repayment amount
          expect(
            await meld.balanceOf(reserveDataBeforeRepay.mTokenAddress)
          ).to.equal(
            mTokenAssetBalanceBefore + userDataBeforeRepay.currentVariableDebt
          );
        });

        it("Should emit correct events when borrower tries to repay full debt (MaxUint256) but debt asset balance is too low", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            tether,
            owner,
            borrower,
            rando,
          } = await loadFixture(setUpSingleVariableBorrowTetherFixture);

          // Simulate borrower spending some of the borrowed funds.
          // Debt is 1250 Tether, borrower has 3750 Tether
          const spendingAmount = await convertToCurrencyDecimals(
            await tether.getAddress(),
            "2650"
          );
          await tether
            .connect(borrower)
            .transfer(rando.address, spendingAmount);

          const payerDebtAssetBalance = await tether.balanceOf(
            borrower.address
          );

          // Get reserve data before repaying
          const reserveDataBeforeRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await tether.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before repaying
          const userDataBeforeRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await tether.getAddress(),
            borrower.address
          );

          // Instantiate reserve token contracts for borrower's collateral
          const reserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await tether.getAddress()
            );

          const mUSDT = await ethers.getContractAt(
            "MToken",
            reserveTokenAddresses.mTokenAddress
          );

          const variableDebtToken = await ethers.getContractAt(
            "VariableDebtToken",
            reserveTokenAddresses.variableDebtTokenAddress
          );

          // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
          time.setNextBlockTimestamp(await time.latest());

          // Repay full debt
          const repayTx = await lendingPool.connect(borrower).repay(
            await tether.getAddress(),
            MaxUint256, // flag for full debt repayment
            RateMode.Variable,
            borrower.address
          );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(repayTx);

          // Calculate expected reserve data after repaying
          const expectedReserveDataAfterRepay: ReserveData =
            calcExpectedReserveDataAfterRepay(
              MaxUint256,
              RateMode.Variable,
              reserveDataBeforeRepay,
              userDataBeforeRepay,
              blockTimestamps.txTimestamp
            );

          // Check that the correct events were emitted
          await expect(repayTx)
            .to.emit(variableDebtToken, "Transfer")
            .withArgs(
              borrower.address,
              ZeroAddress,
              isAlmostEqual(payerDebtAssetBalance)
            );

          await expect(repayTx)
            .to.emit(variableDebtToken, "Burn")
            .withArgs(
              borrower.address,
              payerDebtAssetBalance,
              expectedReserveDataAfterRepay.variableBorrowIndex
            );

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          await expect(repayTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await tether.getAddress(),
              anyUint, // not checking actual value because due to a difference in solidity and Javascript, the value is different. It is tested in other test cases
              isAlmostEqual(expectedReserveDataAfterRepay.stableBorrowRate),
              isAlmostEqual(expectedReserveDataAfterRepay.variableBorrowRate),
              expectedReserveDataAfterRepay.liquidityIndex,
              expectedReserveDataAfterRepay.variableBorrowIndex
            );

          await expect(repayTx)
            .to.emit(tether, "Transfer")
            .withArgs(
              borrower.address,
              await mUSDT.getAddress(),
              isAlmostEqual(payerDebtAssetBalance)
            );

          // The Repay event is emitted by the RepayLogic.sol library, so we need to get the contract instance with the RepayLogic ABI
          const contractInstanceWithRepayLibraryABI =
            await ethers.getContractAt(
              "RepayLogic",
              await lendingPool.getAddress(),
              owner
            );

          await expect(repayTx)
            .to.emit(contractInstanceWithRepayLibraryABI, "Repay")
            .withArgs(
              await tether.getAddress(),
              borrower.address,
              borrower.address,
              isAlmostEqual(payerDebtAssetBalance)
            );

          await expect(repayTx).to.not.emit(mUSDT, "Transfer");
          await expect(repayTx).to.not.emit(mUSDT, "Mint");
          await expect(repayTx).to.not.emit(variableDebtToken, "Mint");
        });

        it("Should update state correctly when borrower tries to repay full debt (MaxUint256) but debt asset balance is too low", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            tether,
            borrower,
            rando,
          } = await loadFixture(setUpSingleVariableBorrowTetherFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR);

          // Get reserve data before repaying
          const reserveDataBeforeRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await tether.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          const payerDebtAssetBalanceBeforeSpending = await tether.balanceOf(
            borrower.address
          );

          // Simulate borrower spending some of the borrowed funds.
          // Debt is 1250 Tether + interest, borrower has 3750 Tether
          const spendingAmount =
            payerDebtAssetBalanceBeforeSpending -
            reserveDataBeforeRepay.totalVariableDebt;
          await tether
            .connect(borrower)
            .transfer(rando.address, spendingAmount);

          // Get user reserve data before repaying but after spending
          const userDataBeforeRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await tether.getAddress(),
            borrower.address
          );

          // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
          time.setNextBlockTimestamp(await time.latest());

          // Repay full debt
          const repayTx = await lendingPool.connect(borrower).repay(
            await tether.getAddress(),
            MaxUint256, // flag for full debt repayment
            RateMode.Variable,
            borrower.address
          );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(repayTx);

          // Get reserve data after repaying
          const reserveDataAfterRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await tether.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data after repaying
          const userDataAfterRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await tether.getAddress(),
            borrower.address
          );

          // Calculate expected reserve data after repaying
          const expectedReserveDataAfterRepay: ReserveData =
            calcExpectedReserveDataAfterRepay(
              MaxUint256,
              RateMode.Variable,
              reserveDataBeforeRepay,
              userDataBeforeRepay,
              blockTimestamps.txTimestamp
            );

          // Calculate expected user data after repaying
          const expectedUserDataAfterRepay: UserReserveData =
            calcExpectedUserDataAfterRepay(
              MaxUint256,
              RateMode.Variable,
              reserveDataBeforeRepay,
              expectedReserveDataAfterRepay,
              userDataBeforeRepay,
              borrower.address,
              borrower.address,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          expectEqual(reserveDataAfterRepay, expectedReserveDataAfterRepay);
          expectEqual(userDataAfterRepay, expectedUserDataAfterRepay);
        });

        it("Should update token balances correctly when borrower tries to repay full debt (MaxUint256) but debt asset balance is too low", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meld,
            borrower,
            rando,
          } = await loadFixture(setUpSingleVariableBorrowMELDFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR * 2);

          // Simulate borrower spending some of the borrowed funds.
          // Debt is 2000 MELD + interest, borrower has 6000 MELD
          const spendingAmount = await convertToCurrencyDecimals(
            await meld.getAddress(),
            "5000"
          );
          await meld.connect(borrower).transfer(rando.address, spendingAmount);

          // Get reserve data before repaying
          const reserveDataBeforeRepay: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before repaying
          const userDataBeforeRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await meld.getAddress(),
            borrower.address
          );

          const variableDebtToken = await ethers.getContractAt(
            "VariableDebtToken",
            reserveDataBeforeRepay.variableDebtTokenAddress
          );

          const payerAssetBalanceBefore = await meld.balanceOf(
            borrower.address
          );

          const mTokenAssetBalanceBefore = await meld.balanceOf(
            reserveDataBeforeRepay.mTokenAddress
          );

          // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
          time.setNextBlockTimestamp(await time.latest());

          // Repay full debt
          const repayTx = await lendingPool.connect(borrower).repay(
            await meld.getAddress(),
            MaxUint256, // flag for full debt repayment
            RateMode.Variable,
            borrower.address
          );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(repayTx);

          // Calculate expected reserve data after repaying
          const expectedReserveDataAfterRepay: ReserveData =
            calcExpectedReserveDataAfterRepay(
              MaxUint256,
              RateMode.Variable,
              reserveDataBeforeRepay,
              userDataBeforeRepay,
              blockTimestamps.txTimestamp
            );

          // Calculate expected user data after repaying
          const expectedUserDataAfterRepay: UserReserveData =
            calcExpectedUserDataAfterRepay(
              MaxUint256,
              RateMode.Variable,
              reserveDataBeforeRepay,
              expectedReserveDataAfterRepay,
              userDataBeforeRepay,
              borrower.address,
              borrower.address,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          // Check token balances
          expect(await variableDebtToken.balanceOf(borrower.address)).to.equal(
            expectedUserDataAfterRepay.currentVariableDebt
          );

          expect(await variableDebtToken.balanceOf(borrower.address)).to.equal(
            userDataBeforeRepay.currentVariableDebt - payerAssetBalanceBefore
          );

          expect(
            await variableDebtToken.scaledBalanceOf(borrower.address)
          ).to.equal(expectedUserDataAfterRepay.scaledVariableDebt);

          // Check variable debt total and scaled supply
          expect(await variableDebtToken.totalSupply()).to.equal(
            expectedReserveDataAfterRepay.totalVariableDebt
          );

          expect(await variableDebtToken.scaledTotalSupply()).to.equal(
            expectedReserveDataAfterRepay.scaledVariableDebt
          );

          // Check borrower tokens after repayment
          expect(await meld.balanceOf(borrower.address)).to.equal(0n);

          // mToken should have balanceBefore plus full debt
          expect(
            await meld.balanceOf(reserveDataBeforeRepay.mTokenAddress)
          ).to.equal(mTokenAssetBalanceBefore + payerAssetBalanceBefore);
        });

        it("Should return correct value when making a static call", async function () {
          const { lendingPool, meldProtocolDataProvider, meld, borrower } =
            await loadFixture(setUpSingleVariableBorrowMELDFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR / 2);

          // Get user reserve data before repaying
          const userDataBeforeRepay: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await meld.getAddress(),
            borrower.address
          );

          // Repay full debt
          const returnedPaybackAmount = await lendingPool
            .connect(borrower)
            .repay.staticCall(
              await meld.getAddress(),
              MaxUint256,
              RateMode.Variable,
              borrower.address
            );

          expect(returnedPaybackAmount).to.equal(
            userDataBeforeRepay.currentVariableDebt
          );

          const estimatedGas = await lendingPool
            .connect(borrower)
            .repay.estimateGas(
              await meld.getAddress(),
              MaxUint256,
              RateMode.Variable,
              borrower.address
            );

          expect(estimatedGas).to.be.gt(0);
        });
      }); // End Single Variable Borrow

      context(
        "Repay multiple borrows of same asset by same borrower",
        async function () {
          context("Repay Multiple Stable Borrows", async function () {
            it("Should update state correctly for full debt repayment (MaxUint256)", async function () {
              const {
                lendingPool,
                meldProtocolDataProvider,
                lendingRateOracleAggregator,
                tether,
                borrower,
                owner,
              } = await loadFixture(setUpSingleStableBorrowTetherFixture);

              // Simulate time passing before second borrow
              await time.increase(ONE_YEAR / 3);

              // Borrower borrows again
              const borrowAmount = await convertToCurrencyDecimals(
                await tether.getAddress(),
                "5000"
              );

              await lendingPool
                .connect(borrower)
                .borrow(
                  await tether.getAddress(),
                  borrowAmount,
                  RateMode.Stable,
                  borrower.address,
                  0
                );

              // Simulate time passing so owed interest will accrue
              await time.increase(ONE_YEAR / 4);

              // Make sure borrower has some tokens to repay with
              await allocateAndApproveTokens(
                tether,
                owner,
                borrower,
                lendingPool,
                7000n,
                0n
              );

              // Get reserve data before repaying
              const reserveDataBeforeRepay: ReserveData = await getReserveData(
                meldProtocolDataProvider,
                await tether.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

              // Get user reserve data before repaying
              const userDataBeforeRepay: UserReserveData = await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await tether.getAddress(),
                borrower.address
              );

              // Repay full debt
              const repayTx = await lendingPool.connect(borrower).repay(
                await tether.getAddress(),
                MaxUint256, // flag for full debt repayment
                RateMode.Stable,
                borrower.address
              );

              const blockTimestamps: BlockTimestamps =
                await getBlockTimestamps(repayTx);

              // Get reserve data after repaying
              const reserveDataAfterRepay: ReserveData = await getReserveData(
                meldProtocolDataProvider,
                await tether.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

              // Get user reserve data after repaying
              const userDataAfterRepay: UserReserveData = await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await tether.getAddress(),
                borrower.address
              );

              // Calculate expected reserve data after repaying
              const expectedReserveDataAfterRepay: ReserveData =
                calcExpectedReserveDataAfterRepay(
                  MaxUint256,
                  RateMode.Stable,
                  reserveDataBeforeRepay,
                  userDataBeforeRepay,
                  blockTimestamps.txTimestamp
                );

              // Calculate expected user data after repaying
              const expectedUserDataAfterRepay: UserReserveData =
                calcExpectedUserDataAfterRepay(
                  MaxUint256,
                  RateMode.Stable,
                  reserveDataBeforeRepay,
                  expectedReserveDataAfterRepay,
                  userDataBeforeRepay,
                  borrower.address,
                  borrower.address,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              expectEqual(reserveDataAfterRepay, expectedReserveDataAfterRepay);
              expectEqual(userDataAfterRepay, expectedUserDataAfterRepay);
            });

            it("Should update token balances correctly for partial repayment", async function () {
              const {
                lendingPool,
                meldProtocolDataProvider,
                lendingRateOracleAggregator,
                meld,
                borrower,
              } = await loadFixture(setUpSingleStableBorrowMELDFixture);

              // Simulate time passing so owed interest will accrue
              await time.increase(ONE_YEAR);

              // Get reserve data before repaying
              const reserveDataBeforeRepay: ReserveData = await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

              // Get user reserve data before repaying
              const userDataBeforeRepay: UserReserveData = await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await meld.getAddress(),
                borrower.address
              );

              const stableDebtToken = await ethers.getContractAt(
                "StableDebtToken",
                reserveDataBeforeRepay.stableDebtTokenAddress
              );

              const borrowerAssetBalanceBefore = await meld.balanceOf(
                borrower.address
              );
              const mTokenAssetBalanceBefore = await meld.balanceOf(
                reserveDataBeforeRepay.mTokenAddress
              );

              const repaymentAmount = await convertToCurrencyDecimals(
                await meld.getAddress(),
                "1500" // part of borrowed amount
              );

              // Repay full debt
              const repayTx = await lendingPool
                .connect(borrower)
                .repay(
                  await meld.getAddress(),
                  repaymentAmount,
                  RateMode.Stable,
                  borrower.address
                );

              const blockTimestamps: BlockTimestamps =
                await getBlockTimestamps(repayTx);

              // Calculate expected reserve data after repaying
              const expectedReserveDataAfterRepay: ReserveData =
                calcExpectedReserveDataAfterRepay(
                  repaymentAmount,
                  RateMode.Stable,
                  reserveDataBeforeRepay,
                  userDataBeforeRepay,
                  blockTimestamps.txTimestamp
                );

              // Calculate expected user data after repaying
              const expectedUserDataAfterRepay: UserReserveData =
                calcExpectedUserDataAfterRepay(
                  repaymentAmount,
                  RateMode.Stable,
                  reserveDataBeforeRepay,
                  expectedReserveDataAfterRepay,
                  userDataBeforeRepay,
                  borrower.address,
                  borrower.address,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              const { 0: principalSupply, 1: totalSupply } =
                await stableDebtToken.getSupplyData();

              // Check token balances
              expect(
                await stableDebtToken.balanceOf(borrower.address)
              ).to.equal(expectedUserDataAfterRepay.currentStableDebt);

              expect(
                await stableDebtToken.principalBalanceOf(borrower.address)
              ).to.equal(expectedUserDataAfterRepay.principalStableDebt);

              // Check stable debt principal and total supply
              expect(principalSupply).to.equal(
                expectedReserveDataAfterRepay.principalStableDebt
              );

              expect(totalSupply).to.equal(
                expectedReserveDataAfterRepay.totalStableDebt
              );

              // Borrower should have balanceBefore minus amount repaid
              expect(await meld.balanceOf(borrower.address)).to.equal(
                borrowerAssetBalanceBefore - repaymentAmount
              );

              //mToken should have balanceBefore plus amount repaid
              expect(
                await meld.balanceOf(reserveDataBeforeRepay.mTokenAddress)
              ).to.equal(mTokenAssetBalanceBefore + repaymentAmount);
            });
          }); // End Repay Multiple Stable Borrows

          context("Repay Multiple Variable Borrows", async function () {
            it("Should update state correctly for full debt repayment (MaxUint256)", async function () {
              const {
                lendingPool,
                meldProtocolDataProvider,
                lendingRateOracleAggregator,
                tether,
                borrower,
                owner,
              } = await loadFixture(setUpSingleVariableBorrowTetherFixture);

              // Simulate time passing before second borrow
              await time.increase(ONE_YEAR / 12);

              // Borrower borrows again
              const borrowAmount = await convertToCurrencyDecimals(
                await tether.getAddress(),
                "5000"
              );

              await lendingPool
                .connect(borrower)
                .borrow(
                  await tether.getAddress(),
                  borrowAmount,
                  RateMode.Variable,
                  borrower.address,
                  0
                );

              // Simulate time passing so owed interest will accrue
              await time.increase(ONE_YEAR);

              // Make sure borrower has some tokens to repay with
              await allocateAndApproveTokens(
                tether,
                owner,
                borrower,
                lendingPool,
                7000n,
                0n
              );

              // Get reserve data before repaying
              const reserveDataBeforeRepay: ReserveData = await getReserveData(
                meldProtocolDataProvider,
                await tether.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

              // Get user reserve data before repaying
              const userDataBeforeRepay: UserReserveData = await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await tether.getAddress(),
                borrower.address
              );

              // Repay full debt
              const repayTx = await lendingPool.connect(borrower).repay(
                await tether.getAddress(),
                MaxUint256, // flag for full debt repayment
                RateMode.Variable,
                borrower.address
              );

              const blockTimestamps: BlockTimestamps =
                await getBlockTimestamps(repayTx);

              // Get reserve data after repaying
              const reserveDataAfterRepay: ReserveData = await getReserveData(
                meldProtocolDataProvider,
                await tether.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

              // Get user reserve data after repaying
              const userDataAfterRepay: UserReserveData = await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await tether.getAddress(),
                borrower.address
              );

              // Calculate expected reserve data after repaying
              const expectedReserveDataAfterRepay: ReserveData =
                calcExpectedReserveDataAfterRepay(
                  MaxUint256,
                  RateMode.Variable,
                  reserveDataBeforeRepay,
                  userDataBeforeRepay,
                  blockTimestamps.txTimestamp
                );

              // Calculate expected user data after repaying
              const expectedUserDataAfterRepay: UserReserveData =
                calcExpectedUserDataAfterRepay(
                  MaxUint256,
                  RateMode.Variable,
                  reserveDataBeforeRepay,
                  expectedReserveDataAfterRepay,
                  userDataBeforeRepay,
                  borrower.address,
                  borrower.address,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              expectEqual(reserveDataAfterRepay, expectedReserveDataAfterRepay);
              expectEqual(userDataAfterRepay, expectedUserDataAfterRepay);
            });

            it("Should update token balances correctly for partial repayment", async function () {
              const {
                lendingPool,
                meldProtocolDataProvider,
                lendingRateOracleAggregator,
                meld,
                borrower,
                owner,
              } = await loadFixture(setUpSingleVariableBorrowMELDFixture);

              // Simulate time passing before second borrow
              await time.increase(ONE_YEAR / 2);

              // Borrower borrows again
              const borrowAmount = await convertToCurrencyDecimals(
                await meld.getAddress(),
                "7000"
              );

              await lendingPool
                .connect(borrower)
                .borrow(
                  await meld.getAddress(),
                  borrowAmount,
                  RateMode.Variable,
                  borrower.address,
                  0
                );

              // Simulate time passing so owed interest will accrue
              await time.increase(ONE_YEAR * 1.5);

              // Make sure borrower has some tokens to repay with
              await allocateAndApproveTokens(
                meld,
                owner,
                borrower,
                lendingPool,
                10000n,
                0n
              );

              // Get reserve data before repaying
              const reserveDataBeforeRepay: ReserveData = await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

              // Get user reserve data before repaying
              const userDataBeforeRepay: UserReserveData = await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await meld.getAddress(),
                borrower.address
              );

              const variableDebtToken = await ethers.getContractAt(
                "VariableDebtToken",
                reserveDataBeforeRepay.variableDebtTokenAddress
              );

              const borrowerAssetBalanceBefore = await meld.balanceOf(
                borrower.address
              );
              const mTokenAssetBalanceBefore = await meld.balanceOf(
                reserveDataBeforeRepay.mTokenAddress
              );

              const repaymentAmount = await convertToCurrencyDecimals(
                await meld.getAddress(),
                "8000" // part of borrowed amount
              );

              // Repay partial debt
              const repayTx = await lendingPool
                .connect(borrower)
                .repay(
                  await meld.getAddress(),
                  repaymentAmount,
                  RateMode.Variable,
                  borrower.address
                );

              const blockTimestamps: BlockTimestamps =
                await getBlockTimestamps(repayTx);

              // Calculate expected reserve data after repaying
              const expectedReserveDataAfterRepay: ReserveData =
                calcExpectedReserveDataAfterRepay(
                  repaymentAmount,
                  RateMode.Variable,
                  reserveDataBeforeRepay,
                  userDataBeforeRepay,
                  blockTimestamps.txTimestamp
                );

              // Calculate expected user data after repaying
              const expectedUserDataAfterRepay: UserReserveData =
                calcExpectedUserDataAfterRepay(
                  repaymentAmount,
                  RateMode.Variable,
                  reserveDataBeforeRepay,
                  expectedReserveDataAfterRepay,
                  userDataBeforeRepay,
                  borrower.address,
                  borrower.address,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              // Check token balances
              expect(
                await variableDebtToken.balanceOf(borrower.address)
              ).to.equal(expectedUserDataAfterRepay.currentVariableDebt);

              expect(
                await variableDebtToken.scaledBalanceOf(borrower.address)
              ).to.equal(expectedUserDataAfterRepay.scaledVariableDebt);

              expect(
                expectedUserDataAfterRepay.walletBalanceUnderlyingAsset
              ).to.equal(borrowerAssetBalanceBefore - repaymentAmount);

              // Check variable debt total and scaled supply
              expect(await variableDebtToken.totalSupply()).to.equal(
                expectedReserveDataAfterRepay.totalVariableDebt
              );

              expect(await variableDebtToken.scaledTotalSupply()).to.equal(
                expectedReserveDataAfterRepay.scaledVariableDebt
              );

              // Borrower should have balanceBefore minus amount repaid
              expect(await meld.balanceOf(borrower.address)).to.equal(
                borrowerAssetBalanceBefore - repaymentAmount
              );

              // mToken should have balanceBefore plus amount repaid
              expect(
                await meld.balanceOf(reserveDataBeforeRepay.mTokenAddress)
              ).to.equal(mTokenAssetBalanceBefore + repaymentAmount);
            });
          }); // End Repay Multiple Variable Borrows
        }
      ); // End Repay multiple borrows of same asset by same borrower Context

      context(
        "Repay Multiple borrows of same asset by different borrowers",
        async function () {
          context("Multiple Stable Borrows", async function () {
            it("Should update state correctly for full debt repayment (MaxUint256)", async function () {
              const {
                lendingPool,
                meldProtocolDataProvider,
                lendingRateOracleAggregator,
                tether,
                borrower2,
                owner,
              } = await loadFixture(setUpSingleStableBorrowTetherFixture);

              // Simulate time passing before second borrow
              await time.increase(ONE_HOUR);

              // Borrower2 borrows
              const borrowAmount = await convertToCurrencyDecimals(
                await tether.getAddress(),
                "1200"
              );

              await lendingPool
                .connect(borrower2)
                .borrow(
                  await tether.getAddress(),
                  borrowAmount,
                  RateMode.Stable,
                  borrower2.address,
                  0
                );

              // Simulate time passing so owed interest will accrue
              await time.increase(ONE_YEAR / 2);

              // Make sure borrower2 has some tokens to repay with
              await allocateAndApproveTokens(
                tether,
                owner,
                borrower2,
                lendingPool,
                7000n,
                0n
              );

              // Get reserve data before repaying
              const reserveDataBeforeRepay: ReserveData = await getReserveData(
                meldProtocolDataProvider,
                await tether.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

              // Get user reserve data before repaying
              const userDataBeforeRepay: UserReserveData = await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await tether.getAddress(),
                borrower2.address
              );

              // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
              time.setNextBlockTimestamp(await time.latest());

              // Repay full debt
              const repayTx = await lendingPool.connect(borrower2).repay(
                await tether.getAddress(),
                MaxUint256, // flag for full debt repayment
                RateMode.Stable,
                borrower2.address
              );

              const blockTimestamps: BlockTimestamps =
                await getBlockTimestamps(repayTx);

              // Get reserve data after repaying
              const reserveDataAfterRepay: ReserveData = await getReserveData(
                meldProtocolDataProvider,
                await tether.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

              // Get user reserve data after repaying
              const userDataAfterRepay: UserReserveData = await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await tether.getAddress(),
                borrower2.address
              );

              // Calculate expected reserve data after repaying
              const expectedReserveDataAfterRepay: ReserveData =
                calcExpectedReserveDataAfterRepay(
                  MaxUint256,
                  RateMode.Stable,
                  reserveDataBeforeRepay,
                  userDataBeforeRepay,
                  blockTimestamps.txTimestamp
                );

              // Calculate expected user data after repaying
              const expectedUserDataAfterRepay: UserReserveData =
                calcExpectedUserDataAfterRepay(
                  MaxUint256,
                  RateMode.Stable,
                  reserveDataBeforeRepay,
                  expectedReserveDataAfterRepay,
                  userDataBeforeRepay,
                  borrower2.address,
                  borrower2.address,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              // Checking state fields individually. Due to a difference in how solidity and TS calculate the
              // averageStableBorrowRate, the expected and actual values are not exactly the same, so we can't use expectEqual
              // to compare the entire objects. Even with the same inputs, the TS code calulates averageStableBorrowRate to have
              // a last digit that is higher by 1 than the same calculation in solidity. This also affects the liquidityRate, so
              // those values can only be checked that value after repayment is lower than before repayment.
              expect(reserveDataAfterRepay.totalLiquidity).to.equal(
                expectedReserveDataAfterRepay.totalLiquidity
              );
              expect(reserveDataAfterRepay.utilizationRate).to.equal(
                expectedReserveDataAfterRepay.utilizationRate
              );
              expect(reserveDataAfterRepay.availableLiquidity).to.equal(
                expectedReserveDataAfterRepay.availableLiquidity
              );
              expect(reserveDataAfterRepay.totalStableDebt).to.equal(
                expectedReserveDataAfterRepay.totalStableDebt
              );
              expect(reserveDataAfterRepay.totalVariableDebt).to.equal(
                expectedReserveDataAfterRepay.totalVariableDebt
              );
              expect(reserveDataAfterRepay.liquidityRate).to.be.lessThan(
                expectedReserveDataAfterRepay.liquidityRate
              );
              expect(reserveDataAfterRepay.variableBorrowRate).to.be.closeTo(
                expectedReserveDataAfterRepay.variableBorrowRate,
                1
              );
              expect(reserveDataAfterRepay.stableBorrowRate).to.equal(
                expectedReserveDataAfterRepay.stableBorrowRate
              );
              expect(
                reserveDataAfterRepay.averageStableBorrowRate
              ).to.be.lessThan(
                expectedReserveDataAfterRepay.averageStableBorrowRate
              );
              expect(reserveDataAfterRepay.liquidityIndex).to.equal(
                expectedReserveDataAfterRepay.liquidityIndex
              );
              expect(reserveDataAfterRepay.variableBorrowIndex).to.equal(
                expectedReserveDataAfterRepay.variableBorrowIndex
              );
              expect(reserveDataAfterRepay.lastUpdateTimestamp).to.equal(
                expectedReserveDataAfterRepay.lastUpdateTimestamp
              );
              expect(reserveDataAfterRepay.totalStableDebtLastUpdated).to.equal(
                expectedReserveDataAfterRepay.totalStableDebtLastUpdated
              );
              expect(reserveDataAfterRepay.principalStableDebt).to.equal(
                expectedReserveDataAfterRepay.principalStableDebt
              );
              expect(reserveDataAfterRepay.scaledVariableDebt).to.equal(
                expectedReserveDataAfterRepay.scaledVariableDebt
              );
              expect(reserveDataAfterRepay.marketStableRate).to.equal(
                expectedReserveDataAfterRepay.marketStableRate
              );

              expect(userDataAfterRepay.scaledMTokenBalance).to.equal(
                expectedUserDataAfterRepay.scaledMTokenBalance
              );
              expect(userDataAfterRepay.currentMTokenBalance).to.equal(
                expectedUserDataAfterRepay.currentMTokenBalance
              );
              expect(userDataAfterRepay.currentStableDebt).to.equal(
                expectedUserDataAfterRepay.currentStableDebt
              );
              expect(userDataAfterRepay.currentVariableDebt).to.equal(
                expectedUserDataAfterRepay.currentVariableDebt
              );
              expect(userDataAfterRepay.principalStableDebt).to.equal(
                expectedUserDataAfterRepay.principalStableDebt
              );
              expect(userDataAfterRepay.scaledVariableDebt).to.equal(
                expectedUserDataAfterRepay.scaledVariableDebt
              );
              expect(userDataAfterRepay.stableBorrowRate).to.equal(
                expectedUserDataAfterRepay.stableBorrowRate
              );
              expect(userDataAfterRepay.liquidityRate).to.be.lessThan(
                expectedUserDataAfterRepay.liquidityRate
              );
              expect(userDataAfterRepay.stableRateLastUpdated).to.equal(
                expectedUserDataAfterRepay.stableRateLastUpdated
              );
              expect(userDataAfterRepay.lastUpdateTimestamp).to.equal(
                expectedUserDataAfterRepay.lastUpdateTimestamp
              );
              expect(userDataAfterRepay.walletBalanceUnderlyingAsset).to.equal(
                expectedUserDataAfterRepay.walletBalanceUnderlyingAsset
              );
            });

            it("Should update token balances correctly for partial repayment", async function () {
              const {
                lendingPool,
                meldProtocolDataProvider,
                lendingRateOracleAggregator,
                meld,
                borrower2,
                owner,
              } = await loadFixture(setUpSingleStableBorrowMELDFixture);

              // Simulate time passing before second borrow
              await time.increase(ONE_HOUR);

              // Borrower2 borrows
              const borrowAmount = await convertToCurrencyDecimals(
                await meld.getAddress(),
                "2000"
              );

              await lendingPool
                .connect(borrower2)
                .borrow(
                  await meld.getAddress(),
                  borrowAmount,
                  RateMode.Stable,
                  borrower2.address,
                  0
                );

              // Simulate time passing so owed interest will accrue
              await time.increase(ONE_YEAR * 3);

              // Make sure borrower2 has some tokens to repay with
              await allocateAndApproveTokens(
                meld,
                owner,
                borrower2,
                lendingPool,
                10000n,
                0n
              );

              // Get reserve data before repaying
              const reserveDataBeforeRepay: ReserveData = await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

              // Get user reserve data before repaying
              const userDataBeforeRepay: UserReserveData = await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await meld.getAddress(),
                borrower2.address
              );

              const stableDebtToken = await ethers.getContractAt(
                "StableDebtToken",
                reserveDataBeforeRepay.stableDebtTokenAddress
              );

              const borrowerAssetBalanceBefore = await meld.balanceOf(
                borrower2.address
              );
              const mTokenAssetBalanceBefore = await meld.balanceOf(
                reserveDataBeforeRepay.mTokenAddress
              );

              const repaymentAmount = await convertToCurrencyDecimals(
                await meld.getAddress(),
                "1500" // part of borrowed amount
              );

              // Repay partial debt
              const repayTx = await lendingPool
                .connect(borrower2)
                .repay(
                  await meld.getAddress(),
                  repaymentAmount,
                  RateMode.Stable,
                  borrower2.address
                );

              const blockTimestamps: BlockTimestamps =
                await getBlockTimestamps(repayTx);

              // Calculate expected reserve data after repaying
              const expectedReserveDataAfterRepay: ReserveData =
                calcExpectedReserveDataAfterRepay(
                  repaymentAmount,
                  RateMode.Stable,
                  reserveDataBeforeRepay,
                  userDataBeforeRepay,
                  blockTimestamps.txTimestamp
                );

              // Calculate expected user data after repaying
              const expectedUserDataAfterRepay: UserReserveData =
                calcExpectedUserDataAfterRepay(
                  repaymentAmount,
                  RateMode.Stable,
                  reserveDataBeforeRepay,
                  expectedReserveDataAfterRepay,
                  userDataBeforeRepay,
                  borrower2.address,
                  borrower2.address,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              const { 0: principalSupply, 1: totalSupply } =
                await stableDebtToken.getSupplyData();

              // Check token balances
              expect(
                await stableDebtToken.balanceOf(borrower2.address)
              ).to.equal(expectedUserDataAfterRepay.currentStableDebt);

              expect(
                await stableDebtToken.principalBalanceOf(borrower2.address)
              ).to.equal(expectedUserDataAfterRepay.principalStableDebt);

              // Check stable debt principal and total supply
              expect(principalSupply).to.equal(
                expectedReserveDataAfterRepay.principalStableDebt
              );

              expect(totalSupply).to.equal(
                expectedReserveDataAfterRepay.totalStableDebt
              );

              // Borrower should have balanceBefore minus amount repaid
              expect(await meld.balanceOf(borrower2.address)).to.equal(
                borrowerAssetBalanceBefore - repaymentAmount
              );

              // mToken should have balanceBefore plus amount repaid
              expect(
                await meld.balanceOf(reserveDataBeforeRepay.mTokenAddress)
              ).to.equal(mTokenAssetBalanceBefore + repaymentAmount);
            });
          }); // End Multiple Stable Borrows Context

          context("Multiple Variable Borrows", async function () {
            it("Should update state correctly for full debt repayment (MaxUint256)", async function () {
              const {
                lendingPool,
                meldProtocolDataProvider,
                lendingRateOracleAggregator,
                tether,
                borrower2,
                owner,
              } = await loadFixture(setUpSingleVariableBorrowTetherFixture);

              // Simulate time passing before second borrow
              await time.increase(ONE_HOUR);

              // Borrower2 borrows
              const borrowAmount = await convertToCurrencyDecimals(
                await tether.getAddress(),
                "2500"
              );

              await lendingPool
                .connect(borrower2)
                .borrow(
                  await tether.getAddress(),
                  borrowAmount,
                  RateMode.Variable,
                  borrower2.address,
                  0
                );

              // Simulate time passing so owed interest will accrue
              await time.increase(ONE_YEAR / 2);

              // Make sure borrower2 has some tokens to repay with
              await allocateAndApproveTokens(
                tether,
                owner,
                borrower2,
                lendingPool,
                7000n,
                0n
              );

              // Get reserve data before repaying
              const reserveDataBeforeRepay: ReserveData = await getReserveData(
                meldProtocolDataProvider,
                await tether.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

              // Get user reserve data before repaying
              const userDataBeforeRepay: UserReserveData = await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await tether.getAddress(),
                borrower2.address
              );

              // Repay full debt - borrower2
              const repayTx = await lendingPool.connect(borrower2).repay(
                await tether.getAddress(),
                MaxUint256, // flag for full debt repayment
                RateMode.Variable,
                borrower2.address
              );

              const blockTimestamps: BlockTimestamps =
                await getBlockTimestamps(repayTx);

              // Get reserve data after repaying
              const reserveDataAfterRepay: ReserveData = await getReserveData(
                meldProtocolDataProvider,
                await tether.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

              // Get user reserve data after repaying
              const userDataAfterRepay: UserReserveData = await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await tether.getAddress(),
                borrower2.address
              );

              // Calculate expected reserve data after repaying
              const expectedReserveDataAfterRepay: ReserveData =
                calcExpectedReserveDataAfterRepay(
                  MaxUint256,
                  RateMode.Variable,
                  reserveDataBeforeRepay,
                  userDataBeforeRepay,
                  blockTimestamps.txTimestamp
                );

              // Calculate expected user data after repaying
              const expectedUserDataAfterRepay: UserReserveData =
                calcExpectedUserDataAfterRepay(
                  MaxUint256,
                  RateMode.Variable,
                  reserveDataBeforeRepay,
                  expectedReserveDataAfterRepay,
                  userDataBeforeRepay,
                  borrower2.address,
                  borrower2.address,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              expectEqual(reserveDataAfterRepay, expectedReserveDataAfterRepay);
              expectEqual(userDataAfterRepay, expectedUserDataAfterRepay);
            });

            it("Should update token balances correctly for partial repayment", async function () {
              const {
                lendingPool,
                meldProtocolDataProvider,
                lendingRateOracleAggregator,
                meld,
                borrower,
                borrower2,
                owner,
              } = await loadFixture(setUpSingleVariableBorrowMELDFixture);

              // Simulate time passing before second borrow
              await time.increase(ONE_HOUR / 60);

              // Borrower2 borrows
              const borrowAmount = await convertToCurrencyDecimals(
                await meld.getAddress(),
                "2000"
              );

              await lendingPool
                .connect(borrower2)
                .borrow(
                  await meld.getAddress(),
                  borrowAmount,
                  RateMode.Variable,
                  borrower2.address,
                  0
                );

              // Simulate time passing so owed interest will accrue
              await time.increase(ONE_YEAR * 2);

              // Make sure borrower2 has some tokens to repay with
              await allocateAndApproveTokens(
                meld,
                owner,
                borrower2,
                lendingPool,
                10000n,
                0n
              );

              // Get reserve data before repaying
              const reserveDataBeforeRepay: ReserveData = await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

              // Get borrower reserve data before repaying
              const borrowerDataBeforeRepay: UserReserveData =
                await getUserData(
                  lendingPool,
                  meldProtocolDataProvider,
                  await meld.getAddress(),
                  borrower.address
                );

              // Get borrower2 reserve data before repaying
              const borrower2DataBeforeRepay: UserReserveData =
                await getUserData(
                  lendingPool,
                  meldProtocolDataProvider,
                  await meld.getAddress(),
                  borrower2.address
                );

              const variableDebtToken = await ethers.getContractAt(
                "VariableDebtToken",
                reserveDataBeforeRepay.variableDebtTokenAddress
              );

              const borrowerAssetBalanceBefore = await meld.balanceOf(
                borrower.address
              );
              const borrower2AssetBalanceBefore = await meld.balanceOf(
                borrower2.address
              );
              const mTokenAssetBalanceBefore = await meld.balanceOf(
                reserveDataBeforeRepay.mTokenAddress
              );

              const repaymentAmount = await convertToCurrencyDecimals(
                await meld.getAddress(),
                "500" // part of borrowed amount
              );

              // Repay partial debt - borrower2
              const repayTx = await lendingPool
                .connect(borrower2)
                .repay(
                  await meld.getAddress(),
                  repaymentAmount,
                  RateMode.Variable,
                  borrower2.address
                );

              const blockTimestamps: BlockTimestamps =
                await getBlockTimestamps(repayTx);

              // Calculate expected reserve data, including borrower data, after borrower2 repays
              const expectedReserveDataWithBorrowerAfterRepay: ReserveData =
                calcExpectedReserveDataAfterRepay(
                  repaymentAmount,
                  RateMode.Variable,
                  reserveDataBeforeRepay,
                  borrowerDataBeforeRepay,
                  blockTimestamps.txTimestamp
                );

              // Calculate expected reserve data, including borrower2 data, after repaying
              const expectedReserveDataWithBorrower2AfterRepay: ReserveData =
                calcExpectedReserveDataAfterRepay(
                  repaymentAmount,
                  RateMode.Variable,
                  reserveDataBeforeRepay,
                  borrower2DataBeforeRepay,
                  blockTimestamps.txTimestamp
                );

              // Calculate expected borrower data after borrower2 repays
              const expectedBorrowerDataAfterRepay: UserReserveData =
                calcExpectedUserDataAfterRepay(
                  0n,
                  RateMode.Variable,
                  reserveDataBeforeRepay,
                  expectedReserveDataWithBorrowerAfterRepay,
                  borrowerDataBeforeRepay,
                  borrower.address,
                  borrower.address,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              // Calculate expected borrower2 data after repaying
              const expectedBorrower2DataAfterRepay: UserReserveData =
                calcExpectedUserDataAfterRepay(
                  repaymentAmount,
                  RateMode.Variable,
                  reserveDataBeforeRepay,
                  expectedReserveDataWithBorrower2AfterRepay,
                  borrower2DataBeforeRepay,
                  borrower2.address,
                  borrower2.address,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              // Check token balances for borrower2
              expect(
                await variableDebtToken.balanceOf(borrower2.address)
              ).to.equal(expectedBorrower2DataAfterRepay.currentVariableDebt);

              expect(
                await variableDebtToken.scaledBalanceOf(borrower2.address)
              ).to.equal(expectedBorrower2DataAfterRepay.scaledVariableDebt);

              expect(
                expectedBorrower2DataAfterRepay.walletBalanceUnderlyingAsset
              ).to.equal(borrower2AssetBalanceBefore - repaymentAmount);

              // Check variable debt total and scaled supply
              expect(await variableDebtToken.totalSupply()).to.equal(
                expectedReserveDataWithBorrower2AfterRepay.totalVariableDebt
              );

              expect(await variableDebtToken.scaledTotalSupply()).to.equal(
                expectedReserveDataWithBorrower2AfterRepay.scaledVariableDebt
              );

              // Borrower should have balanceBefore minus amount repaid
              expect(await meld.balanceOf(borrower2.address)).to.equal(
                borrower2AssetBalanceBefore - repaymentAmount
              );

              // Check token balances for borrower - should be no change
              expect(
                await variableDebtToken.balanceOf(borrower.address)
              ).to.equal(expectedBorrowerDataAfterRepay.currentVariableDebt);

              expect(
                await variableDebtToken.scaledBalanceOf(borrower.address)
              ).to.equal(expectedBorrowerDataAfterRepay.scaledVariableDebt);

              expect(
                expectedBorrowerDataAfterRepay.walletBalanceUnderlyingAsset
              ).to.equal(borrowerAssetBalanceBefore);

              // Check variable debt total and scaled supply
              expect(await variableDebtToken.totalSupply()).to.equal(
                expectedReserveDataWithBorrowerAfterRepay.totalVariableDebt
              );

              expect(await variableDebtToken.scaledTotalSupply()).to.equal(
                expectedReserveDataWithBorrowerAfterRepay.scaledVariableDebt
              );

              // Borrower should have balanceBefore minus amount repaid
              expect(await meld.balanceOf(borrower.address)).to.equal(
                borrowerAssetBalanceBefore
              );

              // mToken should have balanceBefore plus amount repaid
              expect(
                await meld.balanceOf(reserveDataBeforeRepay.mTokenAddress)
              ).to.equal(mTokenAssetBalanceBefore + repaymentAmount);
            });
          }); // End Multiple Variable Borrows Context
        }
      ); // End Repay Multiple borrows of same asset by different borrowers Context

      context(
        "Repay Multiple borrows of different assets by same borrower",
        async function () {
          it("Should update state correctly for full debt repayment (MaxUint256)", async function () {
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              tether,
              dai,
              borrower,
              owner,
            } = await loadFixture(setUpSingleStableBorrowTetherFixture);

            // Simulate time passing before second borrow
            await time.increase(ONE_YEAR / 3);

            // Borrower borrows dai at variable rate
            const borrowAmount = await convertToCurrencyDecimals(
              await dai.getAddress(),
              "1800"
            );

            await lendingPool
              .connect(borrower)
              .borrow(
                await dai.getAddress(),
                borrowAmount,
                RateMode.Variable,
                borrower.address,
                0
              );

            // Simulate time passing so owed interest will accrue
            await time.increase(ONE_YEAR / 4);

            // Make sure borrower has some USDT tokens to repay with
            await allocateAndApproveTokens(
              tether,
              owner,
              borrower,
              lendingPool,
              1500n,
              0n
            );

            // Make sure borrower has some DAI tokens to repay with
            await allocateAndApproveTokens(
              dai,
              owner,
              borrower,
              lendingPool,
              2500n,
              0n
            );

            // Get USDT reserve data before repaying
            const usdtReserveDataBeforeRepay: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await tether.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get user USDT reserve data before repaying
            const userUSDTDataBeforeRepay: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await tether.getAddress(),
              borrower.address
            );

            // Repay full stable debt
            const repayTx1 = await lendingPool.connect(borrower).repay(
              await tether.getAddress(),
              MaxUint256, // flag for full debt repayment
              RateMode.Stable,
              borrower.address
            );

            const blockTimestamps1: BlockTimestamps =
              await getBlockTimestamps(repayTx1);

            // Simulate time passing between repayments
            await time.increase(ONE_YEAR / 2);

            // Get DAI reserve data before repaying
            const daiReserveDataBeforeRepay: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await dai.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Get user DAI reserve data before repaying
            const userDAIDataBeforeRepay: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await dai.getAddress(),
              borrower.address
            );

            // Repay full variable debt
            const repayTx2 = await lendingPool.connect(borrower).repay(
              await dai.getAddress(),
              MaxUint256, // flag for full debt repayment
              RateMode.Variable,
              borrower.address
            );

            const blockTimestamps2: BlockTimestamps =
              await getBlockTimestamps(repayTx2);

            // Get USDT reserve data after repaying
            const usdtReserveDataAfterRepay: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await tether.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Get user USDT reserve data after repaying
            const userUSDTDataAfterRepay: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await tether.getAddress(),
              borrower.address
            );

            // Calculate expected USDT reserve data after repaying
            const expectedUSDTReserveDataAfterRepay: ReserveData =
              calcExpectedReserveDataAfterRepay(
                MaxUint256,
                RateMode.Stable,
                usdtReserveDataBeforeRepay,
                userUSDTDataBeforeRepay,
                blockTimestamps1.txTimestamp
              );

            // Calculate expected user USDT data after repaying
            const expectedUserUSDTDataAfterRepay: UserReserveData =
              calcExpectedUserDataAfterRepay(
                MaxUint256,
                RateMode.Stable,
                usdtReserveDataBeforeRepay,
                expectedUSDTReserveDataAfterRepay,
                userUSDTDataBeforeRepay,
                borrower.address,
                borrower.address,
                blockTimestamps1.txTimestamp,
                blockTimestamps1.latestBlockTimestamp
              );

            // Get DAI reserve data after repaying
            const daiReserveDataAfterRepay: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await dai.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Get user DAI reserve data after repaying
            const userDAIDataAfterRepay: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await dai.getAddress(),
              borrower.address
            );

            // Calculate expected DAI reserve data after repaying
            const expectedDAIReserveDataAfterRepay: ReserveData =
              calcExpectedReserveDataAfterRepay(
                MaxUint256,
                RateMode.Variable,
                daiReserveDataBeforeRepay,
                userDAIDataBeforeRepay,
                blockTimestamps2.txTimestamp
              );

            // Calculate expected user DAI data after repaying
            const expectedUserDAIDataAfterRepay: UserReserveData =
              calcExpectedUserDataAfterRepay(
                MaxUint256,
                RateMode.Variable,
                daiReserveDataBeforeRepay,
                expectedDAIReserveDataAfterRepay,
                userDAIDataBeforeRepay,
                borrower.address,
                borrower.address,
                blockTimestamps2.txTimestamp,
                blockTimestamps2.latestBlockTimestamp
              );

            // Check state after both repayments are done
            expectEqual(
              usdtReserveDataAfterRepay,
              expectedUSDTReserveDataAfterRepay
            );
            expectEqual(userUSDTDataAfterRepay, expectedUserUSDTDataAfterRepay);
            expectEqual(
              daiReserveDataAfterRepay,
              expectedDAIReserveDataAfterRepay
            );
            expectEqual(userDAIDataAfterRepay, expectedUserDAIDataAfterRepay);
          });
          it("Should update token balances correctly for partial repayment", async function () {
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              meld,
              dai,
              borrower,
              owner,
            } = await loadFixture(setUpSingleVariableBorrowMELDFixture);

            // Simulate time passing before second borrow
            await time.increase(ONE_YEAR / 2);

            // Borrower borrows dai at stable rate
            const borrowAmount = await convertToCurrencyDecimals(
              await dai.getAddress(),
              "500"
            );

            await lendingPool
              .connect(borrower)
              .borrow(
                await dai.getAddress(),
                borrowAmount,
                RateMode.Stable,
                borrower.address,
                0
              );

            // Simulate time passing so owed interest will accrue
            await time.increase(ONE_YEAR * 1.5);

            // Make sure borrower has some DAI tokens to repay with
            await allocateAndApproveTokens(
              dai,
              owner,
              borrower,
              lendingPool,
              600n,
              0n
            );

            // Instantiate MELD reserve token contracts
            const meldReserveTokenAddresses =
              await meldProtocolDataProvider.getReserveTokensAddresses(
                await meld.getAddress()
              );

            const variableDebtToken = await ethers.getContractAt(
              "VariableDebtToken",
              meldReserveTokenAddresses.variableDebtTokenAddress
            );

            // Instantiate DAI reserve token contracts
            const daiReserveTokenAddresses =
              await meldProtocolDataProvider.getReserveTokensAddresses(
                await dai.getAddress()
              );

            const stableDebtToken = await ethers.getContractAt(
              "StableDebtToken",
              daiReserveTokenAddresses.stableDebtTokenAddress
            );

            const borrowerMELDBalanceBefore = await meld.balanceOf(
              borrower.address
            );
            const mTokenMELDBalanceBefore = await meld.balanceOf(
              meldReserveTokenAddresses.mTokenAddress
            );
            const borrowerDAIBalanceBefore = await dai.balanceOf(
              borrower.address
            );
            const mTokenDAIBalanceBefore = await dai.balanceOf(
              daiReserveTokenAddresses.mTokenAddress
            );

            const meldRepaymentAmount = await convertToCurrencyDecimals(
              await meld.getAddress(),
              "1000" // part of borrowed amount
            );

            // Get MELD reserve data before repaying
            const meldReserveDataBeforeRepay: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get user MELD reserve data before repaying
            const userMELDDataBeforeRepay: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              borrower.address
            );

            // Get DAI reserve data before repaying
            const daiReserveDataBeforeRepay: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await dai.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Get user DAI reserve data before repaying
            const userDAIDataBeforeRepay: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await dai.getAddress(),
              borrower.address
            );

            // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
            time.setNextBlockTimestamp(await time.latest());

            // Repay partial debt
            const repayTx1 = await lendingPool
              .connect(borrower)
              .repay(
                await meld.getAddress(),
                meldRepaymentAmount,
                RateMode.Variable,
                borrower.address
              );

            const blockTimestamps1: BlockTimestamps =
              await getBlockTimestamps(repayTx1);

            const daiRepaymentAmount = await convertToCurrencyDecimals(
              await dai.getAddress(),
              "450" // part of borrowed amount
            );

            // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
            time.setNextBlockTimestamp(await time.latest());

            // Repay partial debt
            const repayTx2 = await lendingPool
              .connect(borrower)
              .repay(
                await dai.getAddress(),
                daiRepaymentAmount,
                RateMode.Stable,
                borrower.address
              );

            const blockTimestamps2: BlockTimestamps =
              await getBlockTimestamps(repayTx2);

            // Calculate expected MELD reserve data after repaying
            const expectedMELDReserveDataAfterRepay: ReserveData =
              calcExpectedReserveDataAfterRepay(
                meldRepaymentAmount,
                RateMode.Variable,
                meldReserveDataBeforeRepay,
                userMELDDataBeforeRepay,
                blockTimestamps1.txTimestamp
              );

            // Calculate expected user MELD  data after repaying
            const expectedUserMELDDataAfterRepay: UserReserveData =
              calcExpectedUserDataAfterRepay(
                meldRepaymentAmount,
                RateMode.Variable,
                meldReserveDataBeforeRepay,
                expectedMELDReserveDataAfterRepay,
                userMELDDataBeforeRepay,
                borrower.address,
                borrower.address,
                blockTimestamps1.txTimestamp,
                blockTimestamps1.latestBlockTimestamp
              );

            // Calculate expected DAI reserve data after repaying
            const expectedDAIReserveDataAfterRepay: ReserveData =
              calcExpectedReserveDataAfterRepay(
                daiRepaymentAmount,
                RateMode.Stable,
                daiReserveDataBeforeRepay,
                userDAIDataBeforeRepay,
                blockTimestamps2.txTimestamp
              );

            // Calculate expected user DAI data after repaying
            const expectedUserDAIDataAfterRepay: UserReserveData =
              calcExpectedUserDataAfterRepay(
                daiRepaymentAmount,
                RateMode.Stable,
                daiReserveDataBeforeRepay,
                expectedDAIReserveDataAfterRepay,
                userDAIDataBeforeRepay,
                borrower.address,
                borrower.address,
                blockTimestamps2.txTimestamp,
                blockTimestamps2.latestBlockTimestamp
              );

            // Check token balances
            expect(
              await variableDebtToken.balanceOf(borrower.address)
            ).to.equal(expectedUserMELDDataAfterRepay.currentVariableDebt);

            expect(
              await variableDebtToken.scaledBalanceOf(borrower.address)
            ).to.equal(expectedUserMELDDataAfterRepay.scaledVariableDebt);

            // Check variable debt total and scaled supply
            expect(await variableDebtToken.totalSupply()).to.equal(
              expectedMELDReserveDataAfterRepay.totalVariableDebt
            );

            expect(await variableDebtToken.scaledTotalSupply()).to.equal(
              expectedMELDReserveDataAfterRepay.scaledVariableDebt
            );

            const { 0: principalSupply, 1: totalSupply } =
              await stableDebtToken.getSupplyData();

            expect(await stableDebtToken.balanceOf(borrower.address)).to.equal(
              expectedUserDAIDataAfterRepay.currentStableDebt
            );

            expect(
              await stableDebtToken.principalBalanceOf(borrower.address)
            ).to.equal(expectedUserDAIDataAfterRepay.principalStableDebt);

            // Check stable debt principal and total supply
            expect(principalSupply).to.equal(
              expectedDAIReserveDataAfterRepay.principalStableDebt
            );

            expect(totalSupply).to.equal(
              expectedDAIReserveDataAfterRepay.totalStableDebt
            );

            // Borrower should have MELD balanceBefore minus amount repaid
            expect(await meld.balanceOf(borrower.address)).to.equal(
              borrowerMELDBalanceBefore - meldRepaymentAmount
            );

            // mToken should have MELD balance Before plus amount repaid
            expect(
              await meld.balanceOf(meldReserveDataBeforeRepay.mTokenAddress)
            ).to.equal(mTokenMELDBalanceBefore + meldRepaymentAmount);

            // Borrower should have DAI balanceBefore minus amount repaid
            expect(await dai.balanceOf(borrower.address)).to.equal(
              borrowerDAIBalanceBefore - daiRepaymentAmount
            );

            // mToken should have DAI balanceBefore plus amount repaid
            expect(
              await dai.balanceOf(daiReserveDataBeforeRepay.mTokenAddress)
            ).to.equal(mTokenDAIBalanceBefore + daiRepaymentAmount);
          });
        }
      ); // End Repay Multiple borrows of different assets by same borrower

      context(
        "Repay Multiple borrows of different assets by different borrowers",
        async function () {
          it("Should update state correctly for full debt repayment (MaxUint256)", async function () {
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              tether,
              dai,
              borrower,
              borrower2,
              owner,
            } = await loadFixture(setUpSingleStableBorrowTetherFixture);

            // Simulate time passing before second borrow
            await time.increase(ONE_YEAR / 3);

            // Borrower2 borrows DAI at variable rate
            const borrowAmount = await convertToCurrencyDecimals(
              await dai.getAddress(),
              "1800"
            );

            await lendingPool
              .connect(borrower2)
              .borrow(
                await dai.getAddress(),
                borrowAmount,
                RateMode.Variable,
                borrower2.address,
                0
              );

            // Simulate time passing so owed interest will accrue
            await time.increase(ONE_YEAR / 4);

            // Make sure borrower has some USDT tokens to repay with
            await allocateAndApproveTokens(
              tether,
              owner,
              borrower,
              lendingPool,
              1500n,
              0n
            );

            // Make sure borrower2 has some DAI tokens to repay with
            await allocateAndApproveTokens(
              dai,
              owner,
              borrower2,
              lendingPool,
              2500n,
              0n
            );

            // Get USDT reserve data before repaying
            const usdtReserveDataBeforeRepay: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await tether.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get user USDT reserve data before repaying
            const userUSDTDataBeforeRepay: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await tether.getAddress(),
              borrower.address
            );

            // Repay full stable debt
            const repayTx1 = await lendingPool.connect(borrower).repay(
              await tether.getAddress(),
              MaxUint256, // flag for full debt repayment
              RateMode.Stable,
              borrower.address
            );

            const blockTimestamps1: BlockTimestamps =
              await getBlockTimestamps(repayTx1);

            // Simulate time passing between repayments
            await time.increase(ONE_YEAR / 2);

            // Get DAI reserve data before repaying
            const daiReserveDataBeforeRepay: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await dai.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Get user DAI reserve data before repaying
            const userDAIDataBeforeRepay: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await dai.getAddress(),
              borrower2.address
            );

            // Repay full variable debt
            const repayTx2 = await lendingPool.connect(borrower2).repay(
              await dai.getAddress(),
              MaxUint256, // flag for full debt repayment
              RateMode.Variable,
              borrower2.address
            );

            const blockTimestamps2: BlockTimestamps =
              await getBlockTimestamps(repayTx2);

            // Get USDT reserve data after repaying
            const usdtReserveDataAfterRepay: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await tether.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Get user USDT reserve data after repaying
            const userUSDTDataAfterRepay: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await tether.getAddress(),
              borrower.address
            );

            // Calculate expected USDT reserve data after repaying
            const expectedUSDTReserveDataAfterRepay: ReserveData =
              calcExpectedReserveDataAfterRepay(
                MaxUint256,
                RateMode.Stable,
                usdtReserveDataBeforeRepay,
                userUSDTDataBeforeRepay,
                blockTimestamps1.txTimestamp
              );

            // Calculate expected user USDT data after repaying
            const expectedUserUSDTDataAfterRepay: UserReserveData =
              calcExpectedUserDataAfterRepay(
                MaxUint256,
                RateMode.Stable,
                usdtReserveDataBeforeRepay,
                expectedUSDTReserveDataAfterRepay,
                userUSDTDataBeforeRepay,
                borrower.address,
                borrower.address,
                blockTimestamps1.txTimestamp,
                blockTimestamps1.latestBlockTimestamp
              );

            // Get DAI reserve data after repaying
            const daiReserveDataAfterRepay: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await dai.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Get user DAI reserve data after repaying
            const userDAIDataAfterRepay: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await dai.getAddress(),
              borrower2.address
            );

            // Calculate expected DAI reserve data after repaying
            const expectedDAIReserveDataAfterRepay: ReserveData =
              calcExpectedReserveDataAfterRepay(
                MaxUint256,
                RateMode.Variable,
                daiReserveDataBeforeRepay,
                userDAIDataBeforeRepay,
                blockTimestamps2.txTimestamp
              );

            // Calculate expected user DAI data after repaying
            const expectedUserDAIDataAfterRepay: UserReserveData =
              calcExpectedUserDataAfterRepay(
                MaxUint256,
                RateMode.Variable,
                daiReserveDataBeforeRepay,
                expectedDAIReserveDataAfterRepay,
                userDAIDataBeforeRepay,
                borrower2.address,
                borrower2.address,
                blockTimestamps2.txTimestamp,
                blockTimestamps2.latestBlockTimestamp
              );

            // Check state after both repayments are done
            expectEqual(
              usdtReserveDataAfterRepay,
              expectedUSDTReserveDataAfterRepay
            );
            expectEqual(userUSDTDataAfterRepay, expectedUserUSDTDataAfterRepay);
            expectEqual(
              daiReserveDataAfterRepay,
              expectedDAIReserveDataAfterRepay
            );
            expectEqual(userDAIDataAfterRepay, expectedUserDAIDataAfterRepay);
          });

          it("Should update token balances correctly for partial repayment", async function () {
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              meld,
              dai,
              borrower,
              borrower2,
              owner,
            } = await loadFixture(setUpSingleVariableBorrowMELDFixture);

            // Simulate time passing before second borrow
            await time.increase(ONE_YEAR / 2);

            // Borrower 2 borrows DAI at stable rate
            const borrowAmount = await convertToCurrencyDecimals(
              await dai.getAddress(),
              "500"
            );

            await lendingPool
              .connect(borrower2)
              .borrow(
                await dai.getAddress(),
                borrowAmount,
                RateMode.Stable,
                borrower2.address,
                0
              );

            // Simulate time passing so owed interest will accrue
            await time.increase(ONE_YEAR * 1.5);

            // Make sure borrower2 has some DAI tokens to repay with
            await allocateAndApproveTokens(
              dai,
              owner,
              borrower2,
              lendingPool,
              600n,
              0n
            );

            // Get MELD reserve data before repaying
            const meldReserveDataBeforeRepay: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get user MELD reserve data before repaying
            const userMELDDataBeforeRepay: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              borrower.address
            );

            const variableDebtToken = await ethers.getContractAt(
              "VariableDebtToken",
              meldReserveDataBeforeRepay.variableDebtTokenAddress
            );

            // Get DAI reserve data before repaying
            const daiReserveDataBeforeRepay: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await dai.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Get user DAI reserve data before repaying
            const userDAIDataBeforeRepay: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await dai.getAddress(),
              borrower2.address
            );

            const stableDebtToken = await ethers.getContractAt(
              "StableDebtToken",
              daiReserveDataBeforeRepay.stableDebtTokenAddress
            );

            const borrowerMELDBalanceBefore = await meld.balanceOf(
              borrower.address
            );
            const mTokenMELDBalanceBefore = await meld.balanceOf(
              meldReserveDataBeforeRepay.mTokenAddress
            );
            const borrower2DAIBalanceBefore = await dai.balanceOf(
              borrower2.address
            );
            const mTokenDAIBalanceBefore = await dai.balanceOf(
              daiReserveDataBeforeRepay.mTokenAddress
            );

            const meldRepaymentAmount = await convertToCurrencyDecimals(
              await meld.getAddress(),
              "1000" // part of borrowed amount
            );

            // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
            time.setNextBlockTimestamp(await time.latest());

            // Repay partial debt
            const repayTx1 = await lendingPool
              .connect(borrower)
              .repay(
                await meld.getAddress(),
                meldRepaymentAmount,
                RateMode.Variable,
                borrower.address
              );

            const blockTimestamps1: BlockTimestamps =
              await getBlockTimestamps(repayTx1);

            const daiRepaymentAmount = await convertToCurrencyDecimals(
              await dai.getAddress(),
              "450" // part of borrowed amount
            );

            // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
            time.setNextBlockTimestamp(await time.latest());

            // Repay partial debt
            const repayTx2 = await lendingPool
              .connect(borrower2)
              .repay(
                await dai.getAddress(),
                daiRepaymentAmount,
                RateMode.Stable,
                borrower2.address
              );

            const blockTimestamps2: BlockTimestamps =
              await getBlockTimestamps(repayTx2);

            // Calculate expected MELD reserve data after repaying
            const expectedMELDReserveDataAfterRepay: ReserveData =
              calcExpectedReserveDataAfterRepay(
                meldRepaymentAmount,
                RateMode.Variable,
                meldReserveDataBeforeRepay,
                userMELDDataBeforeRepay,
                blockTimestamps1.txTimestamp
              );

            // Calculate expected user MELD data after repaying
            const expectedUserMELDDataAfterRepay: UserReserveData =
              calcExpectedUserDataAfterRepay(
                meldRepaymentAmount,
                RateMode.Variable,
                meldReserveDataBeforeRepay,
                expectedMELDReserveDataAfterRepay,
                userMELDDataBeforeRepay,
                borrower.address,
                borrower.address,
                blockTimestamps1.txTimestamp,
                blockTimestamps1.latestBlockTimestamp
              );

            // Calculate expected DAI reserve data after repaying
            const expectedDAIReserveDataAfterRepay: ReserveData =
              calcExpectedReserveDataAfterRepay(
                daiRepaymentAmount,
                RateMode.Stable,
                daiReserveDataBeforeRepay,
                userDAIDataBeforeRepay,
                blockTimestamps2.txTimestamp
              );

            // Calculate expected user DAI data after repaying
            const expectedUserDAIDataAfterRepay: UserReserveData =
              calcExpectedUserDataAfterRepay(
                daiRepaymentAmount,
                RateMode.Stable,
                daiReserveDataBeforeRepay,
                expectedDAIReserveDataAfterRepay,
                userDAIDataBeforeRepay,
                borrower2.address,
                borrower2.address,
                blockTimestamps2.txTimestamp,
                blockTimestamps2.latestBlockTimestamp
              );

            // Check token balances
            expect(
              await variableDebtToken.balanceOf(borrower.address)
            ).to.equal(expectedUserMELDDataAfterRepay.currentVariableDebt);

            expect(
              await variableDebtToken.scaledBalanceOf(borrower.address)
            ).to.equal(expectedUserMELDDataAfterRepay.scaledVariableDebt);

            // Check variable debt total and scaled supply
            expect(await variableDebtToken.totalSupply()).to.equal(
              expectedMELDReserveDataAfterRepay.totalVariableDebt
            );

            expect(await variableDebtToken.scaledTotalSupply()).to.equal(
              expectedMELDReserveDataAfterRepay.scaledVariableDebt
            );

            const { 0: principalSupply, 1: totalSupply } =
              await stableDebtToken.getSupplyData();

            expect(await stableDebtToken.balanceOf(borrower2.address)).to.equal(
              expectedUserDAIDataAfterRepay.currentStableDebt
            );

            expect(
              await stableDebtToken.principalBalanceOf(borrower2.address)
            ).to.equal(expectedUserDAIDataAfterRepay.principalStableDebt);

            // Check stable debt principal and total supply
            expect(principalSupply).to.equal(
              expectedDAIReserveDataAfterRepay.principalStableDebt
            );

            expect(totalSupply).to.equal(
              expectedDAIReserveDataAfterRepay.totalStableDebt
            );

            // Borrower should have MELD balanceBefore minus amount repaid
            expect(await meld.balanceOf(borrower.address)).to.equal(
              borrowerMELDBalanceBefore - meldRepaymentAmount
            );

            // mToken should have MELD balanceBefore plus amount repaid
            expect(
              await meld.balanceOf(meldReserveDataBeforeRepay.mTokenAddress)
            ).to.equal(mTokenMELDBalanceBefore + meldRepaymentAmount);

            // Borrower should have DAI balanceBefore minus amount repaid
            expect(await dai.balanceOf(borrower2.address)).to.equal(
              borrower2DAIBalanceBefore - daiRepaymentAmount
            );

            // mToken should have DAI balanceBefore plus amount repaid
            expect(
              await dai.balanceOf(daiReserveDataBeforeRepay.mTokenAddress)
            ).to.equal(mTokenDAIBalanceBefore + daiRepaymentAmount);
          });
        }
      ); // End Repay Multiple borrows of different assets by different borrowers
    }); // End Regular UserContext

    context("MELD Banker", async function () {
      it("Should unlock MELD Banker NFT if MELD Banker repays whole balance of yield boost token (MaxUint256)", async function () {
        const {
          lendingPool,
          meldProtocolDataProvider,
          lendingRateOracleAggregator,
          addressesProvider,
          meld,
          usdc,
          owner,
          rewardsSetter,
          meldBanker,
          meldBankerTokenId,
          yieldBoostStakingUSDC,
          yieldBoostStorageUSDC,
          borrowAmountMeldBankerUSDC,
        } = await loadFixture(setUpMeldBankersBorrowFixture);

        // Set Yield Boost Staking Rewards
        await setRewards(
          yieldBoostStorageUSDC,
          yieldBoostStakingUSDC,
          addressesProvider,
          rewardsSetter,
          owner,
          usdc,
          meld
        );

        // Get reserve data before repaying
        const reserveDataBeforeRepay: ReserveData = await getReserveData(
          meldProtocolDataProvider,
          await usdc.getAddress(),
          await lendingRateOracleAggregator.getAddress()
        );

        // Get user reserve data before repaying
        const userDataBeforeRepay: UserReserveData = await getUserData(
          lendingPool,
          meldProtocolDataProvider,
          await usdc.getAddress(),
          meldBanker.address
        );

        const meldBankerDataBefore = await lendingPool.userMeldBankerData(
          meldBanker.address
        );

        const yieldBoostMultiplier = await lendingPool.yieldBoostMultipliers(
          meldBankerDataBefore.meldBankerType,
          meldBankerDataBefore.action
        );

        const mUSDC = await ethers.getContractAt(
          "MToken",
          reserveDataBeforeRepay.mTokenAddress
        );

        const variableDebtToken = await ethers.getContractAt(
          "VariableDebtToken",
          reserveDataBeforeRepay.variableDebtTokenAddress
        );

        // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
        time.setNextBlockTimestamp(await time.latest());

        // Repay full debt
        const repayTx = await lendingPool.connect(meldBanker).repay(
          await usdc.getAddress(),
          MaxUint256, // flag for full debt repayment
          RateMode.Variable,
          meldBanker.address
        );

        const blockTimestamps: BlockTimestamps =
          await getBlockTimestamps(repayTx);

        // Calculate expected reserve data after repaying
        const expectedReserveDataAfterRepay: ReserveData =
          calcExpectedReserveDataAfterRepay(
            MaxUint256,
            RateMode.Variable,
            reserveDataBeforeRepay,
            userDataBeforeRepay,
            blockTimestamps.txTimestamp
          );

        // Check that the correct events were emitted
        await expect(repayTx)
          .to.emit(variableDebtToken, "Transfer")
          .withArgs(
            meldBanker.address,
            ZeroAddress,
            userDataBeforeRepay.currentVariableDebt
          );

        await expect(repayTx)
          .to.emit(variableDebtToken, "Burn")
          .withArgs(
            meldBanker.address,
            userDataBeforeRepay.currentVariableDebt,
            expectedReserveDataAfterRepay.variableBorrowIndex
          );

        // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
        const contractInstanceWithLibraryABI = await ethers.getContractAt(
          "ReserveLogic",
          await lendingPool.getAddress(),
          owner
        );

        await expect(repayTx)
          .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
          .withArgs(
            await usdc.getAddress(),
            expectedReserveDataAfterRepay.liquidityRate,
            isAlmostEqual(expectedReserveDataAfterRepay.stableBorrowRate),
            isAlmostEqual(expectedReserveDataAfterRepay.variableBorrowRate),
            expectedReserveDataAfterRepay.liquidityIndex,
            expectedReserveDataAfterRepay.variableBorrowIndex
          );

        await expect(repayTx)
          .to.emit(usdc, "Transfer")
          .withArgs(
            meldBanker.address,
            await mUSDC.getAddress(),
            userDataBeforeRepay.currentVariableDebt
          );

        // The Repay event is emitted by the RepayLogic.sol library, so we need to get the contract instance with the RepayLogic ABI
        const contractInstanceWithRepayLibraryABI = await ethers.getContractAt(
          "RepayLogic",
          await lendingPool.getAddress(),
          owner
        );

        await expect(repayTx)
          .to.emit(contractInstanceWithRepayLibraryABI, "Repay")
          .withArgs(
            await usdc.getAddress(),
            meldBanker.address,
            meldBanker.address,
            userDataBeforeRepay.currentVariableDebt
          );

        await expect(repayTx).to.emit(mUSDC, "Transfer");
        await expect(repayTx).to.emit(mUSDC, "Mint");

        const expectedOldStakedAmount =
          borrowAmountMeldBankerUSDC.percentMul(yieldBoostMultiplier);

        await expect(repayTx)
          .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
          .withArgs(meldBanker.address, expectedOldStakedAmount, 0n);

        await expect(repayTx)
          .to.emit(yieldBoostStakingUSDC, "StakePositionRemoved")
          .withArgs(meldBanker.address, expectedOldStakedAmount);

        await expect(repayTx)
          .to.emit(yieldBoostStakingUSDC, "RewardsClaimed")
          .withArgs(meldBanker.address, meldBanker.address, anyUint, anyUint);

        await expect(repayTx)
          .to.emit(lendingPool, "RefreshYieldBoostAmount")
          .withArgs(await usdc.getAddress(), meldBanker.address, 0n);

        await expect(repayTx)
          .to.emit(lendingPool, "UnlockMeldBankerNFT")
          .withArgs(
            await usdc.getAddress(),
            meldBanker.address,
            meldBankerTokenId,
            MeldBankerType.BANKER,
            Action.BORROW
          );

        expect(await lendingPool.isUsingMeldBanker(meldBanker.address)).to.be
          .false;

        expect(await lendingPool.isMeldBankerBlocked(meldBankerTokenId)).to.be
          .false;

        const meldBankerData = await lendingPool.userMeldBankerData(
          meldBanker.address
        );
        expect(meldBankerData.tokenId).to.equal(0n);
        expect(meldBankerData.asset).to.equal(ZeroAddress);
        expect(meldBankerData.meldBankerType).to.equal(MeldBankerType.NONE);
        expect(meldBankerData.action).to.equal(Action.NONE);

        expect(
          await yieldBoostStorageUSDC.getStakerStakedAmount(meldBanker.address)
        ).to.equal(0n);
      });

      it("Should NOT unlock MELD Banker NFT if MELD Banker repays whole balance of a different yield boost token (MaxUint256)", async function () {
        const {
          lendingPool,
          meldProtocolDataProvider,
          lendingRateOracleAggregator,
          addressesProvider,
          meld,
          usdc,
          dai,
          owner,
          meldBanker,
          meldBankerTokenId,
          rewardsSetter,
          yieldBoostStorageUSDC,
          yieldBoostStakingUSDC,
          borrowAmountMeldBankerUSDC,
        } = await loadFixture(setUpMeldBankersBorrowFixture);
        // MELD Banker already borrowed USDC using tokenId. DAI is also a yield boost token. MELD banker is not using tokenId

        // Set Yield Boost Staking Rewards
        await setRewards(
          yieldBoostStorageUSDC,
          yieldBoostStakingUSDC,
          addressesProvider,
          rewardsSetter,
          owner,
          usdc,
          meld
        );

        const borrowAmountMeldBankerDAI = await convertToCurrencyDecimals(
          await dai.getAddress(),
          "1000"
        );

        await lendingPool
          .connect(meldBanker)
          .borrow(
            await dai.getAddress(),
            borrowAmountMeldBankerDAI,
            RateMode.Variable,
            meldBanker.address,
            0n
          );

        // Allocate DAI to MELD Banker so can repay later
        await allocateAndApproveTokens(
          dai,
          owner,
          meldBanker,
          lendingPool,
          1000n * 2n, // 2x the amount borrowed
          0n
        );

        // Get reserve data before repay
        const reserveDataBeforeRepay: ReserveData = await getReserveData(
          meldProtocolDataProvider,
          await dai.getAddress(),
          await lendingRateOracleAggregator.getAddress()
        );

        // Get user reserve data before repay
        const userDataBeforeRepay: UserReserveData = await getUserData(
          lendingPool,
          meldProtocolDataProvider,
          await dai.getAddress(),
          meldBanker.address
        );

        // Instantiate mDAI contract
        const mDAI = await ethers.getContractAt(
          "MToken",
          reserveDataBeforeRepay.mTokenAddress
        );

        const variableDebtToken = await ethers.getContractAt(
          "VariableDebtToken",
          reserveDataBeforeRepay.variableDebtTokenAddress
        );

        // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
        time.setNextBlockTimestamp(await time.latest());

        // Passing in MaxUint256 to repay the full user balance of dai
        const repayTx = await lendingPool.connect(meldBanker).repay(
          await dai.getAddress(),
          MaxUint256, // flag for full debt repayment
          RateMode.Variable,
          meldBanker.address
        );

        const blockTimestamps: BlockTimestamps =
          await getBlockTimestamps(repayTx);

        // Calculate expected reserve data after repaying
        const expectedReserveDataAfterRepay: ReserveData =
          calcExpectedReserveDataAfterRepay(
            MaxUint256,
            RateMode.Variable,
            reserveDataBeforeRepay,
            userDataBeforeRepay,
            blockTimestamps.txTimestamp
          );

        // Check that the correct events were emitted
        await expect(repayTx)
          .to.emit(variableDebtToken, "Transfer")
          .withArgs(
            meldBanker.address,
            ZeroAddress,
            userDataBeforeRepay.currentVariableDebt
          );

        await expect(repayTx)
          .to.emit(variableDebtToken, "Burn")
          .withArgs(
            meldBanker.address,
            userDataBeforeRepay.currentVariableDebt,
            expectedReserveDataAfterRepay.variableBorrowIndex
          );

        // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
        const contractInstanceWithLibraryABI = await ethers.getContractAt(
          "ReserveLogic",
          await lendingPool.getAddress(),
          owner
        );

        await expect(repayTx)
          .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
          .withArgs(
            await dai.getAddress(),
            expectedReserveDataAfterRepay.liquidityRate,
            isAlmostEqual(expectedReserveDataAfterRepay.stableBorrowRate),
            isAlmostEqual(expectedReserveDataAfterRepay.variableBorrowRate),
            expectedReserveDataAfterRepay.liquidityIndex,
            expectedReserveDataAfterRepay.variableBorrowIndex
          );

        await expect(repayTx)
          .to.emit(dai, "Transfer")
          .withArgs(
            meldBanker.address,
            await mDAI.getAddress(),
            userDataBeforeRepay.currentVariableDebt
          );

        // The Repay event is emitted by the RepayLogic.sol library, so we need to get the contract instance with the RepayLogic ABI
        const contractInstanceWithRepayLibraryABI = await ethers.getContractAt(
          "RepayLogic",
          await lendingPool.getAddress(),
          owner
        );

        await expect(repayTx)
          .to.emit(contractInstanceWithRepayLibraryABI, "Repay")
          .withArgs(
            await dai.getAddress(),
            meldBanker.address,
            meldBanker.address,
            userDataBeforeRepay.currentVariableDebt
          );

        const meldBankerData = await lendingPool.userMeldBankerData(
          meldBanker.address
        );

        await expect(repayTx).to.not.emit(
          yieldBoostStakingUSDC,
          "StakePositionUpdated"
        );

        await expect(repayTx).to.not.emit(
          yieldBoostStakingUSDC,
          "StakePositionRemoved"
        );

        await expect(repayTx).to.not.emit(
          yieldBoostStakingUSDC,
          "RewardsClaimed"
        );

        await expect(repayTx)
          .to.emit(lendingPool, "RefreshYieldBoostAmount")
          .withArgs(await dai.getAddress(), meldBanker.address, 0n);

        await expect(repayTx).to.not.emit(lendingPool, "UnlockMeldBankerNFT");

        expect(await lendingPool.isUsingMeldBanker(meldBanker.address)).to.be
          .true;

        expect(await lendingPool.isMeldBankerBlocked(meldBankerTokenId)).to.be
          .true;

        expect(meldBankerData.tokenId).to.equal(meldBankerTokenId);
        expect(meldBankerData.asset).to.equal(await usdc.getAddress());
        expect(meldBankerData.meldBankerType).to.equal(MeldBankerType.BANKER);
        expect(meldBankerData.action).to.equal(Action.BORROW);

        const yieldBoostMultiplier = await lendingPool.yieldBoostMultipliers(
          meldBankerData.meldBankerType,
          meldBankerData.action
        );
        const expectedStakedAmount =
          borrowAmountMeldBankerUSDC.percentMul(yieldBoostMultiplier);

        expect(
          await yieldBoostStorageUSDC.getStakerStakedAmount(meldBanker.address)
        ).to.equal(expectedStakedAmount);
      });

      it("Should NOT unlock MELD Banker NFT if MELD Banker repays partial balance of yield boost token", async function () {
        const {
          lendingPool,
          meldProtocolDataProvider,
          lendingRateOracleAggregator,
          addressesProvider,
          meld,
          usdc,
          owner,
          meldBanker,
          meldBankerTokenId,
          rewardsSetter,
          yieldBoostStorageUSDC,
          yieldBoostStakingUSDC,
          borrowAmountMeldBankerUSDC,
        } = await loadFixture(setUpMeldBankersBorrowFixture);

        // Set Yield Boost Staking Rewards
        await setRewards(
          yieldBoostStorageUSDC,
          yieldBoostStakingUSDC,
          addressesProvider,
          rewardsSetter,
          owner,
          usdc,
          meld
        );

        // Get reserve data before repaying
        const reserveDataBeforeRepay: ReserveData = await getReserveData(
          meldProtocolDataProvider,
          await usdc.getAddress(),
          await lendingRateOracleAggregator.getAddress()
        );

        // Get user reserve data before repaying
        const userDataBeforeRepay: UserReserveData = await getUserData(
          lendingPool,
          meldProtocolDataProvider,
          await usdc.getAddress(),
          meldBanker.address
        );

        const mUSDC = await ethers.getContractAt(
          "MToken",
          reserveDataBeforeRepay.mTokenAddress
        );

        const variableDebtToken = await ethers.getContractAt(
          "VariableDebtToken",
          reserveDataBeforeRepay.variableDebtTokenAddress
        );

        const repaymentAmount = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "500" // half of borrowed principal
        );

        // Repay partial debt
        const repayTx = await lendingPool
          .connect(meldBanker)
          .repay(
            await usdc.getAddress(),
            repaymentAmount,
            RateMode.Variable,
            meldBanker.address
          );

        const blockTimestamps: BlockTimestamps =
          await getBlockTimestamps(repayTx);

        // Calculate expected reserve data after repaying
        const expectedReserveDataAfterRepay: ReserveData =
          calcExpectedReserveDataAfterRepay(
            repaymentAmount,
            RateMode.Variable,
            reserveDataBeforeRepay,
            userDataBeforeRepay,
            blockTimestamps.txTimestamp
          );

        // Calculate expected user data after repaying
        const expectedUserDataAfterRepay: UserReserveData =
          calcExpectedUserDataAfterRepay(
            repaymentAmount,
            RateMode.Variable,
            reserveDataBeforeRepay,
            expectedReserveDataAfterRepay,
            userDataBeforeRepay,
            meldBanker.address,
            meldBanker.address,
            blockTimestamps.txTimestamp,
            blockTimestamps.latestBlockTimestamp
          );

        // Check that the correct events were emitted
        await expect(repayTx)
          .to.emit(variableDebtToken, "Transfer")
          .withArgs(meldBanker.address, ZeroAddress, repaymentAmount);

        await expect(repayTx)
          .to.emit(variableDebtToken, "Burn")
          .withArgs(
            meldBanker.address,
            repaymentAmount,
            expectedReserveDataAfterRepay.variableBorrowIndex
          );

        // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
        const contractInstanceWithLibraryABI = await ethers.getContractAt(
          "ReserveLogic",
          await lendingPool.getAddress(),
          owner
        );

        await expect(repayTx)
          .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
          .withArgs(
            await usdc.getAddress(),
            expectedReserveDataAfterRepay.liquidityRate,
            isAlmostEqual(expectedReserveDataAfterRepay.stableBorrowRate),
            isAlmostEqual(expectedReserveDataAfterRepay.variableBorrowRate),
            expectedReserveDataAfterRepay.liquidityIndex,
            expectedReserveDataAfterRepay.variableBorrowIndex
          );

        await expect(repayTx)
          .to.emit(usdc, "Transfer")
          .withArgs(
            meldBanker.address,
            await mUSDC.getAddress(),
            repaymentAmount
          );

        // The Repay event is emitted by the RepayLogic.sol library, so we need to get the contract instance with the RepayLogic ABI
        const contractInstanceWithRepayLibraryABI = await ethers.getContractAt(
          "RepayLogic",
          await lendingPool.getAddress(),
          owner
        );

        await expect(repayTx)
          .to.emit(contractInstanceWithRepayLibraryABI, "Repay")
          .withArgs(
            await usdc.getAddress(),
            meldBanker.address,
            meldBanker.address,
            repaymentAmount
          );

        await expect(repayTx).to.emit(mUSDC, "Transfer");
        await expect(repayTx).to.emit(mUSDC, "Mint");

        const meldBankerData = await lendingPool.userMeldBankerData(
          meldBanker.address
        );

        const yieldBoostMultiplier = await lendingPool.yieldBoostMultipliers(
          meldBankerData.meldBankerType,
          meldBankerData.action
        );

        const expectedOldStakedAmount =
          borrowAmountMeldBankerUSDC.percentMul(yieldBoostMultiplier);

        // Interest has accrued, so can't use the borrowed amount
        const expectedNewStakedAmount =
          expectedUserDataAfterRepay.currentVariableDebt.percentMul(
            yieldBoostMultiplier
          );

        await expect(repayTx)
          .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
          .withArgs(
            meldBanker.address,
            expectedOldStakedAmount,
            expectedNewStakedAmount
          );

        await expect(repayTx).to.not.emit(
          yieldBoostStakingUSDC,
          "StakePositionRemoved"
        );

        await expect(repayTx).to.not.emit(
          yieldBoostStakingUSDC,
          "RewardsClaimed"
        );

        await expect(repayTx)
          .to.emit(lendingPool, "RefreshYieldBoostAmount")
          .withArgs(
            await usdc.getAddress(),
            meldBanker.address,
            expectedNewStakedAmount
          );

        await expect(repayTx).to.not.emit(lendingPool, "UnlockMeldBankerNFT");

        expect(await lendingPool.isUsingMeldBanker(meldBanker.address)).to.be
          .true;

        expect(await lendingPool.isMeldBankerBlocked(meldBankerTokenId)).to.be
          .true;

        expect(meldBankerData.tokenId).to.equal(meldBankerTokenId);
        expect(meldBankerData.asset).to.equal(await usdc.getAddress());
        expect(meldBankerData.meldBankerType).to.equal(MeldBankerType.BANKER);
        expect(meldBankerData.action).to.equal(Action.BORROW);

        expect(
          await yieldBoostStorageUSDC.getStakerStakedAmount(meldBanker.address)
        ).to.equal(expectedNewStakedAmount);
      });
      it("Should unlock MELD Banker NFT if another user repays whole balance of yield boost token on behalf of MELD Banker", async function () {
        const {
          lendingPool,
          meldProtocolDataProvider,
          lendingRateOracleAggregator,
          addressesProvider,
          meld,
          usdc,
          owner,
          rewardsSetter,
          rando,
          meldBanker,
          meldBankerTokenId,
          yieldBoostStakingUSDC,
          yieldBoostStorageUSDC,
          borrowAmountMeldBankerUSDC,
        } = await loadFixture(setUpMeldBankersBorrowFixture);

        // Set Yield Boost Staking Rewards
        await setRewards(
          yieldBoostStorageUSDC,
          yieldBoostStakingUSDC,
          addressesProvider,
          rewardsSetter,
          owner,
          usdc,
          meld
        );

        // Make sure repayer has USDC tokens to repay debt
        await allocateAndApproveTokens(
          usdc,
          owner,
          rando,
          lendingPool,
          1000n * 2n, // 2x the amount borrowed
          0n
        );

        // Get reserve data before repaying
        const reserveDataBeforeRepay: ReserveData = await getReserveData(
          meldProtocolDataProvider,
          await usdc.getAddress(),
          await lendingRateOracleAggregator.getAddress()
        );

        // Get user reserve data before repaying
        const userDataBeforeRepay: UserReserveData = await getUserData(
          lendingPool,
          meldProtocolDataProvider,
          await usdc.getAddress(),
          meldBanker.address
        );

        const meldBankerDataBefore = await lendingPool.userMeldBankerData(
          meldBanker.address
        );

        const yieldBoostMultiplier = await lendingPool.yieldBoostMultipliers(
          meldBankerDataBefore.meldBankerType,
          meldBankerDataBefore.action
        );

        const mUSDC = await ethers.getContractAt(
          "MToken",
          reserveDataBeforeRepay.mTokenAddress
        );

        const variableDebtToken = await ethers.getContractAt(
          "VariableDebtToken",
          reserveDataBeforeRepay.variableDebtTokenAddress
        );

        // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
        time.setNextBlockTimestamp(await time.latest());

        // Repay full debt
        const repayTx = await lendingPool
          .connect(rando)
          .repay(
            await usdc.getAddress(),
            userDataBeforeRepay.currentVariableDebt,
            RateMode.Variable,
            meldBanker.address
          );

        const blockTimestamps: BlockTimestamps =
          await getBlockTimestamps(repayTx);

        // Calculate expected reserve data after repaying
        const expectedReserveDataAfterRepay: ReserveData =
          calcExpectedReserveDataAfterRepay(
            userDataBeforeRepay.currentVariableDebt,
            RateMode.Variable,
            reserveDataBeforeRepay,
            userDataBeforeRepay,
            blockTimestamps.txTimestamp
          );

        // Check that the correct events were emitted
        await expect(repayTx)
          .to.emit(variableDebtToken, "Transfer")
          .withArgs(
            meldBanker.address,
            ZeroAddress,
            userDataBeforeRepay.currentVariableDebt
          );

        await expect(repayTx)
          .to.emit(variableDebtToken, "Burn")
          .withArgs(
            meldBanker.address,
            userDataBeforeRepay.currentVariableDebt,
            expectedReserveDataAfterRepay.variableBorrowIndex
          );

        // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
        const contractInstanceWithLibraryABI = await ethers.getContractAt(
          "ReserveLogic",
          await lendingPool.getAddress(),
          owner
        );

        await expect(repayTx)
          .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
          .withArgs(
            await usdc.getAddress(),
            expectedReserveDataAfterRepay.liquidityRate,
            isAlmostEqual(expectedReserveDataAfterRepay.stableBorrowRate),
            isAlmostEqual(expectedReserveDataAfterRepay.variableBorrowRate),
            expectedReserveDataAfterRepay.liquidityIndex,
            expectedReserveDataAfterRepay.variableBorrowIndex
          );

        await expect(repayTx)
          .to.emit(usdc, "Transfer")
          .withArgs(
            rando.address,
            await mUSDC.getAddress(),
            userDataBeforeRepay.currentVariableDebt
          );

        // The Repay event is emitted by the RepayLogic.sol library, so we need to get the contract instance with the RepayLogic ABI
        const contractInstanceWithRepayLibraryABI = await ethers.getContractAt(
          "RepayLogic",
          await lendingPool.getAddress(),
          owner
        );

        await expect(repayTx)
          .to.emit(contractInstanceWithRepayLibraryABI, "Repay")
          .withArgs(
            await usdc.getAddress(),
            meldBanker.address,
            rando.address,
            userDataBeforeRepay.currentVariableDebt
          );

        await expect(repayTx).to.emit(mUSDC, "Transfer");
        await expect(repayTx).to.emit(mUSDC, "Mint");

        const expectedOldStakedAmount =
          borrowAmountMeldBankerUSDC.percentMul(yieldBoostMultiplier);

        await expect(repayTx)
          .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
          .withArgs(meldBanker.address, expectedOldStakedAmount, 0n);

        await expect(repayTx)
          .to.emit(yieldBoostStakingUSDC, "StakePositionRemoved")
          .withArgs(meldBanker.address, expectedOldStakedAmount);

        await expect(repayTx)
          .to.emit(yieldBoostStakingUSDC, "RewardsClaimed")
          .withArgs(meldBanker.address, meldBanker.address, anyUint, anyUint);

        await expect(repayTx)
          .to.emit(lendingPool, "RefreshYieldBoostAmount")
          .withArgs(await usdc.getAddress(), meldBanker.address, 0n);

        await expect(repayTx)
          .to.emit(lendingPool, "UnlockMeldBankerNFT")
          .withArgs(
            await usdc.getAddress(),
            meldBanker.address,
            meldBankerTokenId,
            MeldBankerType.BANKER,
            Action.BORROW
          );

        expect(await lendingPool.isUsingMeldBanker(meldBanker.address)).to.be
          .false;

        expect(await lendingPool.isMeldBankerBlocked(meldBankerTokenId)).to.be
          .false;

        const meldBankerData = await lendingPool.userMeldBankerData(
          meldBanker.address
        );
        expect(meldBankerData.tokenId).to.equal(0n);
        expect(meldBankerData.asset).to.equal(ZeroAddress);
        expect(meldBankerData.meldBankerType).to.equal(MeldBankerType.NONE);
        expect(meldBankerData.action).to.equal(Action.NONE);

        expect(
          await yieldBoostStorageUSDC.getStakerStakedAmount(meldBanker.address)
        ).to.equal(0n);
      });
    }); // End MELD Banker Context

    context("Golden Banker", async function () {
      it("Should unlock MELD Banker NFT if Golden Banker repays whole balance of yield boost token (MaxUint256)", async function () {
        const {
          lendingPool,
          meldProtocolDataProvider,
          lendingRateOracleAggregator,
          addressesProvider,
          meld,
          usdc,
          owner,
          rewardsSetter,
          goldenBanker,
          goldenBankerTokenId,
          yieldBoostStakingUSDC,
          yieldBoostStorageUSDC,
          borrowAmountMeldBankerUSDC,
        } = await loadFixture(setUpMeldBankersBorrowFixture);

        // Set Yield Boost Staking Rewards
        await setRewards(
          yieldBoostStorageUSDC,
          yieldBoostStakingUSDC,
          addressesProvider,
          rewardsSetter,
          owner,
          usdc,
          meld
        );

        // Get reserve data before repaying
        const reserveDataBeforeRepay: ReserveData = await getReserveData(
          meldProtocolDataProvider,
          await usdc.getAddress(),
          await lendingRateOracleAggregator.getAddress()
        );

        // Get user reserve data before repaying
        const userDataBeforeRepay: UserReserveData = await getUserData(
          lendingPool,
          meldProtocolDataProvider,
          await usdc.getAddress(),
          goldenBanker.address
        );

        const meldBankerDataBefore = await lendingPool.userMeldBankerData(
          goldenBanker.address
        );

        const yieldBoostMultiplier = await lendingPool.yieldBoostMultipliers(
          meldBankerDataBefore.meldBankerType,
          meldBankerDataBefore.action
        );

        const mUSDC = await ethers.getContractAt(
          "MToken",
          reserveDataBeforeRepay.mTokenAddress
        );

        const variableDebtToken = await ethers.getContractAt(
          "VariableDebtToken",
          reserveDataBeforeRepay.variableDebtTokenAddress
        );

        // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
        time.setNextBlockTimestamp(await time.latest());

        // Repay full debt
        const repayTx = await lendingPool.connect(goldenBanker).repay(
          await usdc.getAddress(),
          MaxUint256, // flag for full debt repayment
          RateMode.Variable,
          goldenBanker.address
        );

        const blockTimestamps: BlockTimestamps =
          await getBlockTimestamps(repayTx);

        // Calculate expected reserve data after repaying
        const expectedReserveDataAfterRepay: ReserveData =
          calcExpectedReserveDataAfterRepay(
            MaxUint256,
            RateMode.Variable,
            reserveDataBeforeRepay,
            userDataBeforeRepay,
            blockTimestamps.txTimestamp
          );

        // Check that the correct events were emitted
        await expect(repayTx)
          .to.emit(variableDebtToken, "Transfer")
          .withArgs(
            goldenBanker.address,
            ZeroAddress,
            userDataBeforeRepay.currentVariableDebt
          );

        await expect(repayTx)
          .to.emit(variableDebtToken, "Burn")
          .withArgs(
            goldenBanker.address,
            userDataBeforeRepay.currentVariableDebt,
            expectedReserveDataAfterRepay.variableBorrowIndex
          );

        // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
        const contractInstanceWithLibraryABI = await ethers.getContractAt(
          "ReserveLogic",
          await lendingPool.getAddress(),
          owner
        );

        await expect(repayTx)
          .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
          .withArgs(
            await usdc.getAddress(),
            expectedReserveDataAfterRepay.liquidityRate,
            isAlmostEqual(expectedReserveDataAfterRepay.stableBorrowRate),
            isAlmostEqual(expectedReserveDataAfterRepay.variableBorrowRate),
            expectedReserveDataAfterRepay.liquidityIndex,
            expectedReserveDataAfterRepay.variableBorrowIndex
          );

        await expect(repayTx)
          .to.emit(usdc, "Transfer")
          .withArgs(
            goldenBanker.address,
            await mUSDC.getAddress(),
            userDataBeforeRepay.currentVariableDebt
          );

        // The Repay event is emitted by the RepayLogic.sol library, so we need to get the contract instance with the RepayLogic ABI
        const contractInstanceWithRepayLibraryABI = await ethers.getContractAt(
          "RepayLogic",
          await lendingPool.getAddress(),
          owner
        );

        await expect(repayTx)
          .to.emit(contractInstanceWithRepayLibraryABI, "Repay")
          .withArgs(
            await usdc.getAddress(),
            goldenBanker.address,
            goldenBanker.address,
            userDataBeforeRepay.currentVariableDebt
          );

        await expect(repayTx).to.emit(mUSDC, "Transfer");
        await expect(repayTx).to.emit(mUSDC, "Mint");

        const expectedOldStakedAmount =
          borrowAmountMeldBankerUSDC.percentMul(yieldBoostMultiplier);

        await expect(repayTx)
          .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
          .withArgs(goldenBanker.address, expectedOldStakedAmount, 0n);

        await expect(repayTx)
          .to.emit(yieldBoostStakingUSDC, "StakePositionRemoved")
          .withArgs(goldenBanker.address, expectedOldStakedAmount);

        await expect(repayTx)
          .to.emit(yieldBoostStakingUSDC, "RewardsClaimed")
          .withArgs(
            goldenBanker.address,
            goldenBanker.address,
            anyUint,
            anyUint
          );

        await expect(repayTx)
          .to.emit(lendingPool, "RefreshYieldBoostAmount")
          .withArgs(await usdc.getAddress(), goldenBanker.address, 0n);

        await expect(repayTx)
          .to.emit(lendingPool, "UnlockMeldBankerNFT")
          .withArgs(
            await usdc.getAddress(),
            goldenBanker.address,
            goldenBankerTokenId,
            MeldBankerType.GOLDEN,
            Action.BORROW
          );

        expect(await lendingPool.isUsingMeldBanker(goldenBanker.address)).to.be
          .false;

        expect(await lendingPool.isMeldBankerBlocked(goldenBankerTokenId)).to.be
          .false;

        const meldBankerData = await lendingPool.userMeldBankerData(
          goldenBanker.address
        );
        expect(meldBankerData.tokenId).to.equal(0n);
        expect(meldBankerData.asset).to.equal(ZeroAddress);
        expect(meldBankerData.meldBankerType).to.equal(MeldBankerType.NONE);
        expect(meldBankerData.action).to.equal(Action.NONE);

        expect(
          await yieldBoostStorageUSDC.getStakerStakedAmount(
            goldenBanker.address
          )
        ).to.equal(0n);
      });

      it("Should NOT unlock MELD Banker NFT if Golden Banker repays whole balance of a different yield boost token (MaxUint256)", async function () {
        const {
          lendingPool,
          meldProtocolDataProvider,
          lendingRateOracleAggregator,
          addressesProvider,
          meld,
          usdc,
          dai,
          owner,
          goldenBanker,
          goldenBankerTokenId,
          rewardsSetter,
          yieldBoostStorageUSDC,
          yieldBoostStakingUSDC,
          borrowAmountMeldBankerUSDC,
        } = await loadFixture(setUpMeldBankersBorrowFixture);
        // MELD Banker already borrowed USDC using tokenId. DAI is also a yield boost token. MELD banker is not using tokenId

        // Set Yield Boost Staking Rewards
        await setRewards(
          yieldBoostStorageUSDC,
          yieldBoostStakingUSDC,
          addressesProvider,
          rewardsSetter,
          owner,
          usdc,
          meld
        );

        const borrowAmountMeldBankerDAI = await convertToCurrencyDecimals(
          await dai.getAddress(),
          "1000"
        );

        await lendingPool
          .connect(goldenBanker)
          .borrow(
            await dai.getAddress(),
            borrowAmountMeldBankerDAI,
            RateMode.Variable,
            goldenBanker.address,
            0n
          );

        // Allocate DAI to meldBanker so can repay later
        await allocateAndApproveTokens(
          dai,
          owner,
          goldenBanker,
          lendingPool,
          1000n * 2n, // 2x the amount borrowed
          0n
        );

        // Get reserve data before repay
        const reserveDataBeforeRepay: ReserveData = await getReserveData(
          meldProtocolDataProvider,
          await dai.getAddress(),
          await lendingRateOracleAggregator.getAddress()
        );

        // Get user reserve data before repay
        const userDataBeforeRepay: UserReserveData = await getUserData(
          lendingPool,
          meldProtocolDataProvider,
          await dai.getAddress(),
          goldenBanker.address
        );

        // Instantiate mDAI contract
        const mDAI = await ethers.getContractAt(
          "MToken",
          reserveDataBeforeRepay.mTokenAddress
        );

        const variableDebtToken = await ethers.getContractAt(
          "VariableDebtToken",
          reserveDataBeforeRepay.variableDebtTokenAddress
        );

        // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
        time.setNextBlockTimestamp(await time.latest());

        // Passing in MaxUint256 to repay the full user balance of dai
        const repayTx = await lendingPool.connect(goldenBanker).repay(
          await dai.getAddress(),
          MaxUint256, // flag for full debt repayment
          RateMode.Variable,
          goldenBanker.address
        );

        const blockTimestamps: BlockTimestamps =
          await getBlockTimestamps(repayTx);

        // Calculate expected reserve data after repaying
        const expectedReserveDataAfterRepay: ReserveData =
          calcExpectedReserveDataAfterRepay(
            MaxUint256,
            RateMode.Variable,
            reserveDataBeforeRepay,
            userDataBeforeRepay,
            blockTimestamps.txTimestamp
          );

        // Check that the correct events were emitted
        await expect(repayTx)
          .to.emit(variableDebtToken, "Transfer")
          .withArgs(
            goldenBanker.address,
            ZeroAddress,
            userDataBeforeRepay.currentVariableDebt
          );

        await expect(repayTx)
          .to.emit(variableDebtToken, "Burn")
          .withArgs(
            goldenBanker.address,
            userDataBeforeRepay.currentVariableDebt,
            expectedReserveDataAfterRepay.variableBorrowIndex
          );

        // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
        const contractInstanceWithLibraryABI = await ethers.getContractAt(
          "ReserveLogic",
          await lendingPool.getAddress(),
          owner
        );

        await expect(repayTx)
          .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
          .withArgs(
            await dai.getAddress(),
            expectedReserveDataAfterRepay.liquidityRate,
            isAlmostEqual(expectedReserveDataAfterRepay.stableBorrowRate),
            isAlmostEqual(expectedReserveDataAfterRepay.variableBorrowRate),
            expectedReserveDataAfterRepay.liquidityIndex,
            expectedReserveDataAfterRepay.variableBorrowIndex
          );

        await expect(repayTx)
          .to.emit(dai, "Transfer")
          .withArgs(
            goldenBanker.address,
            await mDAI.getAddress(),
            userDataBeforeRepay.currentVariableDebt
          );

        // The Repay event is emitted by the RepayLogic.sol library, so we need to get the contract instance with the RepayLogic ABI
        const contractInstanceWithRepayLibraryABI = await ethers.getContractAt(
          "RepayLogic",
          await lendingPool.getAddress(),
          owner
        );

        await expect(repayTx)
          .to.emit(contractInstanceWithRepayLibraryABI, "Repay")
          .withArgs(
            await dai.getAddress(),
            goldenBanker.address,
            goldenBanker.address,
            userDataBeforeRepay.currentVariableDebt
          );

        const meldBankerData = await lendingPool.userMeldBankerData(
          goldenBanker.address
        );

        await expect(repayTx).to.not.emit(
          yieldBoostStakingUSDC,
          "StakePositionUpdated"
        );

        await expect(repayTx).to.not.emit(
          yieldBoostStakingUSDC,
          "StakePositionRemoved"
        );

        await expect(repayTx).to.not.emit(
          yieldBoostStakingUSDC,
          "RewardsClaimed"
        );

        await expect(repayTx)
          .to.emit(lendingPool, "RefreshYieldBoostAmount")
          .withArgs(await dai.getAddress(), goldenBanker.address, 0n);

        await expect(repayTx).to.not.emit(lendingPool, "UnlockMeldBankerNFT");

        expect(await lendingPool.isUsingMeldBanker(goldenBanker.address)).to.be
          .true;

        expect(await lendingPool.isMeldBankerBlocked(goldenBankerTokenId)).to.be
          .true;

        expect(meldBankerData.tokenId).to.equal(goldenBankerTokenId);
        expect(meldBankerData.asset).to.equal(await usdc.getAddress());
        expect(meldBankerData.meldBankerType).to.equal(MeldBankerType.GOLDEN);
        expect(meldBankerData.action).to.equal(Action.BORROW);

        const yieldBoostMultiplier = await lendingPool.yieldBoostMultipliers(
          meldBankerData.meldBankerType,
          meldBankerData.action
        );
        const expectedStakedAmount =
          borrowAmountMeldBankerUSDC.percentMul(yieldBoostMultiplier);

        expect(
          await yieldBoostStorageUSDC.getStakerStakedAmount(
            goldenBanker.address
          )
        ).to.equal(expectedStakedAmount);
      });

      it("Should NOT unlock MELD Banker NFT if Golden Banker repays partial balance of yield boost token", async function () {
        const {
          lendingPool,
          meldProtocolDataProvider,
          lendingRateOracleAggregator,
          addressesProvider,
          meld,
          usdc,
          owner,
          goldenBanker,
          goldenBankerTokenId,
          rewardsSetter,
          yieldBoostStorageUSDC,
          yieldBoostStakingUSDC,
          borrowAmountMeldBankerUSDC,
        } = await loadFixture(setUpMeldBankersBorrowFixture);

        // Set Yield Boost Staking Rewards
        await setRewards(
          yieldBoostStorageUSDC,
          yieldBoostStakingUSDC,
          addressesProvider,
          rewardsSetter,
          owner,
          usdc,
          meld
        );

        // Get reserve data before repaying
        const reserveDataBeforeRepay: ReserveData = await getReserveData(
          meldProtocolDataProvider,
          await usdc.getAddress(),
          await lendingRateOracleAggregator.getAddress()
        );

        // Get user reserve data before repaying
        const userDataBeforeRepay: UserReserveData = await getUserData(
          lendingPool,
          meldProtocolDataProvider,
          await usdc.getAddress(),
          goldenBanker.address
        );

        const mUSDC = await ethers.getContractAt(
          "MToken",
          reserveDataBeforeRepay.mTokenAddress
        );

        const variableDebtToken = await ethers.getContractAt(
          "VariableDebtToken",
          reserveDataBeforeRepay.variableDebtTokenAddress
        );

        const repaymentAmount = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "500" // half of borrowed principal
        );

        // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
        time.setNextBlockTimestamp(await time.latest());

        // Repay partial debt
        const repayTx = await lendingPool
          .connect(goldenBanker)
          .repay(
            await usdc.getAddress(),
            repaymentAmount,
            RateMode.Variable,
            goldenBanker.address
          );

        const blockTimestamps: BlockTimestamps =
          await getBlockTimestamps(repayTx);

        // Calculate expected reserve data after repaying
        const expectedReserveDataAfterRepay: ReserveData =
          calcExpectedReserveDataAfterRepay(
            repaymentAmount,
            RateMode.Variable,
            reserveDataBeforeRepay,
            userDataBeforeRepay,
            blockTimestamps.txTimestamp
          );

        // Calculate expected user data after repaying
        const expectedUserDataAfterRepay: UserReserveData =
          calcExpectedUserDataAfterRepay(
            repaymentAmount,
            RateMode.Variable,
            reserveDataBeforeRepay,
            expectedReserveDataAfterRepay,
            userDataBeforeRepay,
            goldenBanker.address,
            goldenBanker.address,
            blockTimestamps.txTimestamp,
            blockTimestamps.latestBlockTimestamp
          );

        // Check that the correct events were emitted
        await expect(repayTx)
          .to.emit(variableDebtToken, "Transfer")
          .withArgs(goldenBanker.address, ZeroAddress, repaymentAmount);

        await expect(repayTx)
          .to.emit(variableDebtToken, "Burn")
          .withArgs(
            goldenBanker.address,
            repaymentAmount,
            expectedReserveDataAfterRepay.variableBorrowIndex
          );

        // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
        const contractInstanceWithLibraryABI = await ethers.getContractAt(
          "ReserveLogic",
          await lendingPool.getAddress(),
          owner
        );

        await expect(repayTx)
          .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
          .withArgs(
            await usdc.getAddress(),
            expectedReserveDataAfterRepay.liquidityRate,
            isAlmostEqual(expectedReserveDataAfterRepay.stableBorrowRate),
            isAlmostEqual(expectedReserveDataAfterRepay.variableBorrowRate),
            expectedReserveDataAfterRepay.liquidityIndex,
            expectedReserveDataAfterRepay.variableBorrowIndex
          );

        await expect(repayTx)
          .to.emit(usdc, "Transfer")
          .withArgs(
            goldenBanker.address,
            await mUSDC.getAddress(),
            repaymentAmount
          );

        // The Repay event is emitted by the RepayLogic.sol library, so we need to get the contract instance with the RepayLogic ABI
        const contractInstanceWithRepayLibraryABI = await ethers.getContractAt(
          "RepayLogic",
          await lendingPool.getAddress(),
          owner
        );

        await expect(repayTx)
          .to.emit(contractInstanceWithRepayLibraryABI, "Repay")
          .withArgs(
            await usdc.getAddress(),
            goldenBanker.address,
            goldenBanker.address,
            repaymentAmount
          );

        await expect(repayTx).to.emit(mUSDC, "Transfer");
        await expect(repayTx).to.emit(mUSDC, "Mint");

        const meldBankerData = await lendingPool.userMeldBankerData(
          goldenBanker.address
        );

        const yieldBoostMultiplier = await lendingPool.yieldBoostMultipliers(
          meldBankerData.meldBankerType,
          meldBankerData.action
        );

        const expectedOldStakedAmount =
          borrowAmountMeldBankerUSDC.percentMul(yieldBoostMultiplier);

        // Interest has accrued, so can't use the borrowed amount
        const expectedNewStakedAmount =
          expectedUserDataAfterRepay.currentVariableDebt.percentMul(
            yieldBoostMultiplier
          );

        await expect(repayTx)
          .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
          .withArgs(
            goldenBanker.address,
            expectedOldStakedAmount,
            expectedNewStakedAmount
          );

        await expect(repayTx).to.not.emit(
          yieldBoostStakingUSDC,
          "StakePositionRemoved"
        );

        await expect(repayTx).to.not.emit(
          yieldBoostStakingUSDC,
          "RewardsClaimed"
        );

        await expect(repayTx)
          .to.emit(lendingPool, "RefreshYieldBoostAmount")
          .withArgs(
            await usdc.getAddress(),
            goldenBanker.address,
            expectedNewStakedAmount
          );

        await expect(repayTx).to.not.emit(lendingPool, "UnlockMeldBankerNFT");

        expect(await lendingPool.isUsingMeldBanker(goldenBanker.address)).to.be
          .true;

        expect(await lendingPool.isMeldBankerBlocked(goldenBankerTokenId)).to.be
          .true;

        expect(meldBankerData.tokenId).to.equal(goldenBankerTokenId);
        expect(meldBankerData.asset).to.equal(await usdc.getAddress());
        expect(meldBankerData.meldBankerType).to.equal(MeldBankerType.GOLDEN);
        expect(meldBankerData.action).to.equal(Action.BORROW);

        expect(
          await yieldBoostStorageUSDC.getStakerStakedAmount(
            goldenBanker.address
          )
        ).to.equal(expectedNewStakedAmount);
      });
      it("Should unlock MELD Banker NFT if another user repays whole balance of yield boost token on behalf of Golden Banker", async function () {
        const {
          lendingPool,
          meldProtocolDataProvider,
          lendingRateOracleAggregator,
          addressesProvider,
          meld,
          usdc,
          owner,
          rewardsSetter,
          rando,
          goldenBanker,
          goldenBankerTokenId,
          yieldBoostStakingUSDC,
          yieldBoostStorageUSDC,
          borrowAmountMeldBankerUSDC,
        } = await loadFixture(setUpMeldBankersBorrowFixture);

        // Set Yield Boost Staking Rewards
        await setRewards(
          yieldBoostStorageUSDC,
          yieldBoostStakingUSDC,
          addressesProvider,
          rewardsSetter,
          owner,
          usdc,
          meld
        );

        // Make sure repayer has USDC tokens to repay debt
        await allocateAndApproveTokens(
          usdc,
          owner,
          rando,
          lendingPool,
          1000n * 2n, // 2x the amount borrowed
          0n
        );

        // Get reserve data before repaying
        const reserveDataBeforeRepay: ReserveData = await getReserveData(
          meldProtocolDataProvider,
          await usdc.getAddress(),
          await lendingRateOracleAggregator.getAddress()
        );

        // Get user reserve data before repaying
        const userDataBeforeRepay: UserReserveData = await getUserData(
          lendingPool,
          meldProtocolDataProvider,
          await usdc.getAddress(),
          goldenBanker.address
        );

        const meldBankerDataBefore = await lendingPool.userMeldBankerData(
          goldenBanker.address
        );

        const yieldBoostMultiplier = await lendingPool.yieldBoostMultipliers(
          meldBankerDataBefore.meldBankerType,
          meldBankerDataBefore.action
        );

        const mUSDC = await ethers.getContractAt(
          "MToken",
          reserveDataBeforeRepay.mTokenAddress
        );

        const variableDebtToken = await ethers.getContractAt(
          "VariableDebtToken",
          reserveDataBeforeRepay.variableDebtTokenAddress
        );

        // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
        time.setNextBlockTimestamp(await time.latest());

        // Repay full debt
        const repayTx = await lendingPool
          .connect(rando)
          .repay(
            await usdc.getAddress(),
            userDataBeforeRepay.currentVariableDebt,
            RateMode.Variable,
            goldenBanker.address
          );

        const blockTimestamps: BlockTimestamps =
          await getBlockTimestamps(repayTx);

        // Calculate expected reserve data after repaying
        const expectedReserveDataAfterRepay: ReserveData =
          calcExpectedReserveDataAfterRepay(
            userDataBeforeRepay.currentVariableDebt,
            RateMode.Variable,
            reserveDataBeforeRepay,
            userDataBeforeRepay,
            blockTimestamps.txTimestamp
          );

        // Check that the correct events were emitted
        await expect(repayTx)
          .to.emit(variableDebtToken, "Transfer")
          .withArgs(
            goldenBanker.address,
            ZeroAddress,
            userDataBeforeRepay.currentVariableDebt
          );

        await expect(repayTx)
          .to.emit(variableDebtToken, "Burn")
          .withArgs(
            goldenBanker.address,
            userDataBeforeRepay.currentVariableDebt,
            expectedReserveDataAfterRepay.variableBorrowIndex
          );

        // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
        const contractInstanceWithLibraryABI = await ethers.getContractAt(
          "ReserveLogic",
          await lendingPool.getAddress(),
          owner
        );

        await expect(repayTx)
          .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
          .withArgs(
            await usdc.getAddress(),
            expectedReserveDataAfterRepay.liquidityRate,
            isAlmostEqual(expectedReserveDataAfterRepay.stableBorrowRate),
            isAlmostEqual(expectedReserveDataAfterRepay.variableBorrowRate),
            expectedReserveDataAfterRepay.liquidityIndex,
            expectedReserveDataAfterRepay.variableBorrowIndex
          );

        await expect(repayTx)
          .to.emit(usdc, "Transfer")
          .withArgs(
            rando.address,
            await mUSDC.getAddress(),
            userDataBeforeRepay.currentVariableDebt
          );

        // The Repay event is emitted by the RepayLogic.sol library, so we need to get the contract instance with the RepayLogic ABI
        const contractInstanceWithRepayLibraryABI = await ethers.getContractAt(
          "RepayLogic",
          await lendingPool.getAddress(),
          owner
        );

        await expect(repayTx)
          .to.emit(contractInstanceWithRepayLibraryABI, "Repay")
          .withArgs(
            await usdc.getAddress(),
            goldenBanker.address,
            rando.address,
            userDataBeforeRepay.currentVariableDebt
          );

        await expect(repayTx).to.emit(mUSDC, "Transfer");
        await expect(repayTx).to.emit(mUSDC, "Mint");

        const expectedOldStakedAmount =
          borrowAmountMeldBankerUSDC.percentMul(yieldBoostMultiplier);

        await expect(repayTx)
          .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
          .withArgs(goldenBanker.address, expectedOldStakedAmount, 0n);

        await expect(repayTx)
          .to.emit(yieldBoostStakingUSDC, "StakePositionRemoved")
          .withArgs(goldenBanker.address, expectedOldStakedAmount);

        await expect(repayTx)
          .to.emit(yieldBoostStakingUSDC, "RewardsClaimed")
          .withArgs(
            goldenBanker.address,
            goldenBanker.address,
            anyUint,
            anyUint
          );

        await expect(repayTx)
          .to.emit(lendingPool, "RefreshYieldBoostAmount")
          .withArgs(await usdc.getAddress(), goldenBanker.address, 0n);

        await expect(repayTx)
          .to.emit(lendingPool, "UnlockMeldBankerNFT")
          .withArgs(
            await usdc.getAddress(),
            goldenBanker.address,
            goldenBankerTokenId,
            MeldBankerType.GOLDEN,
            Action.BORROW
          );

        expect(await lendingPool.isUsingMeldBanker(goldenBanker.address)).to.be
          .false;

        expect(await lendingPool.isMeldBankerBlocked(goldenBankerTokenId)).to.be
          .false;

        const meldBankerData = await lendingPool.userMeldBankerData(
          goldenBanker.address
        );
        expect(meldBankerData.tokenId).to.equal(0n);
        expect(meldBankerData.asset).to.equal(ZeroAddress);
        expect(meldBankerData.meldBankerType).to.equal(MeldBankerType.NONE);
        expect(meldBankerData.action).to.equal(Action.NONE);

        expect(
          await yieldBoostStorageUSDC.getStakerStakedAmount(
            goldenBanker.address
          )
        ).to.equal(0n);
      });
    }); // End Golden Banker Context
  }); // End Happy Flow Test Cases Context

  context("Error Test Cases", async function () {
    context("Meld Banker NFT and Yield Boost", async function () {
      it("Should not unlock NFT if repay reverts", async function () {
        const { lendingPool, usdc, meldBanker, meldBankerTokenId } =
          await loadFixture(setUpMeldBankersBorrowFixture);

        await expect(
          lendingPool
            .connect(meldBanker)
            .repay(
              await usdc.getAddress(),
              0n,
              RateMode.Variable,
              meldBanker.address
            )
        ).to.revertedWith(ProtocolErrors.VL_INVALID_AMOUNT);

        expect(await lendingPool.isUsingMeldBanker(meldBanker.address)).to.be
          .true;

        expect(await lendingPool.isMeldBankerBlocked(meldBankerTokenId)).to.be
          .true;
      });
    });
    it("Should revert if the asset address is the zero address", async function () {
      const { lendingPool, borrower } = await loadFixture(
        setUpSingleVariableBorrowMELDFixture
      );

      await expect(
        lendingPool
          .connect(borrower)
          .repay(ZeroAddress, MaxUint256, RateMode.Variable, borrower.address)
      ).to.revertedWith(ProtocolErrors.INVALID_ADDRESS);
    });

    it("Should revert if onBehalfOf address is the zero address", async function () {
      const { lendingPool, meld, borrower } = await loadFixture(
        setUpSingleVariableBorrowMELDFixture
      );

      await expect(
        lendingPool
          .connect(borrower)
          .repay(
            await meld.getAddress(),
            MaxUint256,
            RateMode.Variable,
            ZeroAddress
          )
      ).to.revertedWith(ProtocolErrors.INVALID_ADDRESS);
    });

    it("Should revert if the asset address is an unsupported token", async function () {
      const { lendingPool, unsupportedToken, borrower } = await loadFixture(
        setUpSingleVariableBorrowMELDFixture
      );

      await expect(
        lendingPool
          .connect(borrower)
          .repay(
            unsupportedToken,
            MaxUint256,
            RateMode.Variable,
            borrower.address
          )
      ).to.revertedWith(ProtocolErrors.VL_NO_ACTIVE_RESERVE);
    });

    it("Should revert if amount is 0", async function () {
      const { lendingPool, meld, borrower } = await loadFixture(
        setUpSingleVariableBorrowMELDFixture
      );

      await expect(
        lendingPool
          .connect(borrower)
          .repay(
            await meld.getAddress(),
            0n,
            RateMode.Variable,
            borrower.address
          )
      ).to.revertedWith(ProtocolErrors.VL_INVALID_AMOUNT);
    });

    it("Should revert if user holds no debt for the specified asset", async function () {
      const { lendingPool, meld, borrower2 } = await loadFixture(
        setUpSingleStableBorrowMELDFixture
      );

      const repaymentAmount = await convertToCurrencyDecimals(
        await meld.getAddress(),
        "450"
      );

      // borrower2 has no debt
      await expect(
        lendingPool
          .connect(borrower2)
          .repay(
            await meld.getAddress(),
            repaymentAmount,
            RateMode.Stable,
            borrower2.address
          )
      ).to.revertedWith(ProtocolErrors.VL_NO_DEBT_OF_SELECTED_TYPE);
    });

    it("Should revert if user does not hold the specified RateMode for the asset", async function () {
      const { lendingPool, meld, borrower } = await loadFixture(
        setUpSingleVariableBorrowMELDFixture
      );

      const repaymentAmount = await convertToCurrencyDecimals(
        await meld.getAddress(),
        "450"
      );

      // borrower has variable debt, but no stable debt
      await expect(
        lendingPool
          .connect(borrower)
          .repay(
            await meld.getAddress(),
            repaymentAmount,
            RateMode.Stable,
            borrower.address
          )
      ).to.revertedWith(ProtocolErrors.VL_NO_DEBT_OF_SELECTED_TYPE);
    });

    it("Should revert if interest rate mode is invalid", async function () {
      const { lendingPool, meld, borrower } = await loadFixture(
        setUpSingleVariableBorrowMELDFixture
      );

      const repaymentAmount = await convertToCurrencyDecimals(
        await meld.getAddress(),
        "1200"
      );

      await expect(
        lendingPool
          .connect(borrower)
          .repay(await meld.getAddress(), repaymentAmount, 3, borrower.address)
      ).to.revertedWith(ProtocolErrors.VL_INVALID_INTEREST_RATE_MODE_SELECTED);

      await expect(
        lendingPool
          .connect(borrower)
          .repay(
            await meld.getAddress(),
            repaymentAmount,
            "3",
            borrower.address
          )
      ).to.revertedWith(ProtocolErrors.VL_INVALID_INTEREST_RATE_MODE_SELECTED);

      await expect(
        lendingPool
          .connect(borrower)
          .repay(
            await meld.getAddress(),
            repaymentAmount,
            RateMode.None,
            borrower.address
          )
      ).to.revertedWith(ProtocolErrors.VL_INVALID_INTEREST_RATE_MODE_SELECTED);
    });

    it("Should revert if reserve is not active", async function () {
      const {
        lendingPool,
        lendingPoolConfigurator,
        meld,
        borrower,
        poolAdmin,
      } = await loadFixture(setUpTestFixture);

      const repaymentAmount = await convertToCurrencyDecimals(
        await meld.getAddress(),
        "1000"
      );

      await expect(
        await lendingPoolConfigurator
          .connect(poolAdmin)
          .deactivateReserve(await meld.getAddress())
      )
        .to.emit(lendingPoolConfigurator, "ReserveDeactivated")
        .withArgs(await meld.getAddress());

      await expect(
        lendingPool
          .connect(borrower)
          .repay(
            await meld.getAddress(),
            repaymentAmount,
            RateMode.Variable,
            borrower.address
          )
      ).to.revertedWith(ProtocolErrors.VL_NO_ACTIVE_RESERVE);
    });

    it("Should revert if payer does not have enough of asset to make payment", async function () {
      const { lendingPool, meld, borrower, borrower2 } = await loadFixture(
        setUpSingleVariableBorrowMELDFixture
      );

      const repaymentAmount = await convertToCurrencyDecimals(
        await meld.getAddress(),
        "450"
      );

      await expect(
        lendingPool
          .connect(borrower2)
          .repay(
            await meld.getAddress(),
            repaymentAmount,
            RateMode.Variable,
            borrower.address
          )
      ).to.revertedWith("ERC20: insufficient allowance");
    });

    it("Should revert if another user tries to repay full debt using Maxuint256", async function () {
      const { lendingPool, meld, borrower, borrower2 } = await loadFixture(
        setUpSingleVariableBorrowMELDFixture
      );

      await expect(
        lendingPool
          .connect(borrower2)
          .repay(
            await meld.getAddress(),
            MaxUint256,
            RateMode.Variable,
            borrower.address
          )
      ).to.revertedWith(
        ProtocolErrors.VL_NO_EXPLICIT_AMOUNT_TO_REPAY_ON_BEHALF
      );
    });
  }); // End of Error Test Cases Context
}); // End of Repay Describe
