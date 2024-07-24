import { ethers } from "hardhat";
import {
  allocateAndApproveTokens,
  getBlockTimestamps,
  simulateAssetPriceCrash,
  isAlmostEqual,
  setUpTestFixture,
  setRewards,
} from "./helpers/utils/utils";
import {
  ReserveData,
  UserReserveData,
  BlockTimestamps,
} from "./helpers/interfaces";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { convertToCurrencyDecimals } from "./helpers/utils/contracts-helpers";
import {
  calcExpectedReserveNormalizedIncome,
  calcMaxLiquidatableCollateral,
  calcMaxDebtNeeded,
  calcLiquidationMultiplierParams,
} from "./helpers/utils/calculations";
import { getReserveData, getUserData } from "./helpers/utils/helpers";
import "./helpers/utils/math";
import { RateMode, MeldBankerType, Action } from "./helpers/types";
import {
  ONE_YEAR,
  LIQUIDATION_CLOSE_FACTOR_PERCENT,
  _1e18,
} from "./helpers/constants";
import { ZeroAddress, MaxUint256 } from "ethers";
import { expect } from "chai";
import { ProtocolErrors } from "./helpers/types";
import {
  anyUint,
  anyValue,
} from "@nomicfoundation/hardhat-chai-matchers/withArgs";

describe("Liquidation", function () {
  async function setUpDepositFixture() {
    const {
      unsupportedToken,
      meld,
      usdc,
      dai,
      tether,
      owner,
      depositor,
      depositor2,
      borrower,
      borrower2,
      borrower3,
      liquidator,
      rando,
      treasury,
      oracleAdmin,
      poolAdmin,
      yieldBoostStakingUSDC,
      yieldBoostStorageUSDC,
      ...contracts
    } = await setUpTestFixture();

    // Deposit liquidity

    // borrower deposits USDC
    const depositAmountUSDC = await allocateAndApproveTokens(
      usdc,
      owner,
      borrower,
      contracts.lendingPool,
      10000n,
      0n
    );

    const depositUSDCTx = await contracts.lendingPool
      .connect(borrower)
      .deposit(
        await usdc.getAddress(),
        depositAmountUSDC,
        borrower.address,
        true,
        0
      );

    await expect(depositUSDCTx)
      .to.emit(contracts.lendingPool, "ReserveUsedAsCollateralEnabled")
      .withArgs(await usdc.getAddress(), borrower.address);

    // borrower2 deposits MELD
    const depositAmountMELD = await allocateAndApproveTokens(
      meld,
      owner,
      borrower2,
      contracts.lendingPool,
      1500n,
      0n
    );

    const depositMELDTx = await contracts.lendingPool
      .connect(borrower2)
      .deposit(
        await meld.getAddress(),
        depositAmountMELD,
        borrower2.address,
        true,
        0
      );

    await expect(depositMELDTx)
      .to.emit(contracts.lendingPool, "ReserveUsedAsCollateralEnabled")
      .withArgs(await meld.getAddress(), borrower2.address);

    // borrower 3 deposits DAI
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

    // borrower3 deposits MELD
    const depositAmountMELD2 = await allocateAndApproveTokens(
      meld,
      owner,
      borrower3,
      contracts.lendingPool,
      500n,
      0n
    );

    await contracts.lendingPool
      .connect(borrower3)
      .deposit(
        await meld.getAddress(),
        depositAmountMELD2,
        borrower3.address,
        true,
        0
      );

    // MELD, USDC, USDT liquidity also provided by depositors (who don't borrow)

    // Approve double the amount to be deposited to test the max amount.
    const depositAmountMELD3 = await allocateAndApproveTokens(
      meld,
      owner,
      depositor,
      contracts.lendingPool,
      10000n,
      2n
    );

    const depositMELDTx2 = await contracts.lendingPool
      .connect(depositor)
      .deposit(
        await meld.getAddress(),
        depositAmountMELD3,
        depositor.address,
        true,
        0
      );

    await expect(depositMELDTx2)
      .to.emit(contracts.lendingPool, "ReserveUsedAsCollateralEnabled")
      .withArgs(await meld.getAddress(), depositor.address);

    const depositAmountUSDC2 = await allocateAndApproveTokens(
      usdc,
      owner,
      depositor2,
      contracts.lendingPool,
      5000n,
      0n
    );

    await contracts.lendingPool
      .connect(depositor2)
      .deposit(
        await usdc.getAddress(),
        depositAmountUSDC2,
        depositor2.address,
        true,
        0
      );

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
      usdc,
      unsupportedToken,
      meld,
      tether,
      dai,
      depositAmountUSDC,
      depositAmountMELD,
      owner,
      treasury,
      depositor,
      depositor2,
      borrower,
      borrower2,
      borrower3,
      liquidator,
      rando,
      oracleAdmin,
      poolAdmin,
      yieldBoostStakingUSDC,
      yieldBoostStorageUSDC,
      ...contracts,
    };
  }

  async function setUpSingleVariableBorrowUSDCFixture() {
    const {
      lendingPool,
      lendingPoolConfigurator,
      meldProtocolDataProvider,
      reserveLogic,
      lendingRateOracleAggregator,
      meldLendingRateOracle,
      meldPriceOracle,
      unsupportedToken,
      meld,
      usdc,
      dai,
      owner,
      borrower,
      borrower2,
      liquidator,
      rando,
      treasury,
      oracleAdmin,
    } = await setUpDepositFixture();

    // Borrow2 borrows USDC from the lending pool
    const borrowAmountUSDC = await convertToCurrencyDecimals(
      await usdc.getAddress(),
      "400"
    );

    const borrowTx = await lendingPool
      .connect(borrower2)
      .borrow(
        await usdc.getAddress(),
        borrowAmountUSDC,
        RateMode.Variable,
        borrower2.address,
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
        await usdc.getAddress(),
        borrower2.address,
        borrower2.address,
        borrowAmountUSDC,
        RateMode.Variable,
        anyValue
      );

    return {
      lendingPool,
      lendingPoolConfigurator,
      meldProtocolDataProvider,
      reserveLogic,
      lendingRateOracleAggregator,
      meldLendingRateOracle,
      meldPriceOracle,
      unsupportedToken,
      meld,
      usdc,
      dai,
      borrowAmountUSDC,
      owner,
      borrower,
      borrower2,
      liquidator,
      rando,
      treasury,
      oracleAdmin,
    };
  }

  async function setUpSingleVariableBorrowTetherFixture() {
    const {
      lendingPool,
      meldProtocolDataProvider,
      reserveLogic,
      meldPriceOracle,
      lendingRateOracleAggregator,
      meldLendingRateOracle,
      unsupportedToken,
      tether,
      dai,
      meld,
      usdc,
      owner,
      borrower3,
      rando,
      treasury,
      liquidator,
      oracleAdmin,
    } = await loadFixture(setUpDepositFixture);

    // borrower3 borrows USDT from the lending pool
    const borrowAmount = await convertToCurrencyDecimals(
      await tether.getAddress(),
      "1250"
    );

    const borrowTx = await lendingPool
      .connect(borrower3)
      .borrow(
        await tether.getAddress(),
        borrowAmount,
        RateMode.Variable,
        borrower3.address,
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
        borrower3.address,
        borrower3.address,
        borrowAmount,
        RateMode.Variable,
        anyValue
      );

    return {
      lendingPool,
      meldProtocolDataProvider,
      reserveLogic,
      meldPriceOracle,
      lendingRateOracleAggregator,
      meldLendingRateOracle,
      unsupportedToken,
      tether,
      dai,
      meld,
      usdc,
      borrowAmount,
      borrower3,
      owner,
      rando,
      treasury,
      liquidator,
      oracleAdmin,
    };
  }

  async function setUpSingleStableBorrowMELDFixture() {
    const {
      unsupportedToken,
      meld,
      usdc,
      tether,
      dai,
      owner,
      depositor2,
      borrower,
      borrower2,
      liquidator,
      rando,
      treasury,
      oracleAdmin,
      poolAdmin,
      yieldBoostStakingUSDC,
      yieldBoostStorageUSDC,
      ...contracts
    } = await setUpDepositFixture();

    // Borrower borrows MELD from the lending pool
    const borrowAmount = await convertToCurrencyDecimals(
      await meld.getAddress(),
      "2000"
    );

    const borrowTx = await contracts.lendingPool
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
        RateMode.Stable,
        anyValue
      );

    return {
      unsupportedToken,
      meld,
      usdc,
      tether,
      dai,
      borrowAmount,
      owner,
      depositor2,
      borrower,
      borrower2,
      rando,
      liquidator,
      treasury,
      oracleAdmin,
      poolAdmin,
      yieldBoostStakingUSDC,
      yieldBoostStorageUSDC,
      ...contracts,
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
      rewardsSetter,
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

    // borrower3 deposits DAI
    const depositAmountDAI = await allocateAndApproveTokens(
      dai,
      owner,
      borrower3,
      contracts.lendingPool,
      10_000n,
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

    const depositUSDCTx = await contracts.lendingPool
      .connect(depositor)
      .deposit(
        await usdc.getAddress(),
        depositAmountUSDC,
        depositor.address,
        true,
        0
      );

    await expect(depositUSDCTx)
      .to.emit(contracts.lendingPool, "ReserveUsedAsCollateralEnabled")
      .withArgs(await usdc.getAddress(), depositor.address);

    // Borrow - Meld Banker
    const borrowAmountMeldBankerUSDC = await convertToCurrencyDecimals(
      await usdc.getAddress(),
      "1350"
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
      "5000"
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
      rewardsSetter,
      meldBankerTokenId,
      goldenBankerTokenId,
      yieldBoostStorageUSDC,
      yieldBoostStakingUSDC,
    };
  }

  async function setUpMeldBankersBorrowWithDAICollateralFixture() {
    const {
      owner,
      poolAdmin,
      oracleAdmin,
      treasury,
      depositor,
      meldBanker,
      goldenBanker,
      delegatee,
      rando,
      rewardsSetter,
      usdc,
      meld,
      dai,
      tether,
      unsupportedToken,
      meldBankerTokenId,
      goldenBankerTokenId,
      yieldBoostStakingUSDC,
      yieldBoostStorageUSDC,
      yieldBoostStakingDAI,
      yieldBoostStorageDAI,
      ...contracts
    } = await setUpTestFixture();

    // Deposit liquidity

    // Golden banker deposits DAI without NFT
    const depositAmountDAIGoldenBanker = await allocateAndApproveTokens(
      dai,
      owner,
      goldenBanker,
      contracts.lendingPool,
      20_000n,
      0n
    );

    await contracts.lendingPool
      .connect(goldenBanker)
      .deposit(
        await dai.getAddress(),
        depositAmountDAIGoldenBanker,
        goldenBanker.address,
        true,
        0n
      );

    // MELD banker deposits DAI without NFT
    const depositAmountDAIMeldBanker = await allocateAndApproveTokens(
      dai,
      owner,
      meldBanker,
      contracts.lendingPool,
      10_000n,
      0n
    );

    await contracts.lendingPool
      .connect(meldBanker)
      .deposit(
        await dai.getAddress(),
        depositAmountDAIMeldBanker,
        meldBanker.address,
        true,
        0n
      );

    // USDC liquidity
    // Approve double the amount to be deposited to test the max amount.
    const depositAmountUSDC = await allocateAndApproveTokens(
      usdc,
      owner,
      depositor,
      contracts.lendingPool,
      50_000n,
      2n
    );

    const depositUSDCTx = await contracts.lendingPool
      .connect(depositor)
      .deposit(
        await usdc.getAddress(),
        depositAmountUSDC,
        depositor.address,
        true,
        0
      );

    await expect(depositUSDCTx)
      .to.emit(contracts.lendingPool, "ReserveUsedAsCollateralEnabled")
      .withArgs(await usdc.getAddress(), depositor.address);

    // Borrow - Meld Banker
    const borrowAmountMeldBankerUSDC = await convertToCurrencyDecimals(
      await usdc.getAddress(),
      "7500"
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
      "15000"
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
      rewardsSetter,
      meldBankerTokenId,
      goldenBankerTokenId,
      yieldBoostStakingUSDC,
      yieldBoostStorageUSDC,
      yieldBoostStakingDAI,
      yieldBoostStorageDAI,
    };
  }

  context("Happy Flow Test Cases", async function () {
    context("Regular User", async function () {
      context("Liquidate Stable Debt", async function () {
        // These test cases have USDC as the collateral token and MELD as the debt token.
        // Principal debt is 2000 MELD and collateral is 10,000 USDC for all test cases in this context.
        it("Should emit correct events when liquidator receives collateral mToken and previously had collateral mToken balance of 0", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meldPriceOracle,
            meld,
            usdc,
            owner,
            borrower,
            liquidator,
            treasury,
            oracleAdmin,
          } = await loadFixture(setUpSingleStableBorrowMELDFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR / 12);

          // Instantiate debt reserve token contracts
          const meldReserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await meld.getAddress()
            );

          const mMELD = await ethers.getContractAt(
            "MToken",
            meldReserveTokenAddresses.mTokenAddress
          );

          const stableDebtToken = await ethers.getContractAt(
            "StableDebtToken",
            meldReserveTokenAddresses.stableDebtTokenAddress
          );

          const variableDebtToken = await ethers.getContractAt(
            "VariableDebtToken",
            meldReserveTokenAddresses.variableDebtTokenAddress
          );

          // Instantiate collateral reserve token contracts
          const usdcReserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await usdc.getAddress()
            );

          const mUSDC = await ethers.getContractAt(
            "MToken",
            usdcReserveTokenAddresses.mTokenAddress
          );

          // Make sure liquidator has funds with which to liquidate
          const debtToCover = await allocateAndApproveTokens(
            meld,
            owner,
            liquidator,
            lendingPool,
            1000n, // half of principal debt
            0n
          );

          // Simulate debt token price increase so that debt is liquidatable
          const [currentPrice, success] = await meldPriceOracle.getAssetPrice(
            await meld.getAddress()
          );

          expect(success).to.be.true;

          await meldPriceOracle
            .connect(oracleAdmin)
            .setAssetPrice(await meld.getAddress(), currentPrice * 4n);

          // Get borrower MELD reserve data before liquidation
          const borrowerMELDDataBeforeLiquidation: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              borrower.address
            );

          // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
          time.setNextBlockTimestamp(await time.latest());

          // Liquidator liquidates partial debt
          const liquidationTx = await lendingPool
            .connect(liquidator)
            .liquidationCall(
              await usdc.getAddress(), // collateral asset
              await meld.getAddress(), // debt asset
              borrower.address,
              debtToCover,
              true // receive mToken
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(liquidationTx);

          // Get USDC reserve data after liquidation
          const usdcReserveDataAfterLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          const expectedIncrease =
            borrowerMELDDataBeforeLiquidation.currentStableDebt -
            borrowerMELDDataBeforeLiquidation.principalStableDebt;

          // Check that the correct events were emitted //

          await expect(liquidationTx)
            .to.emit(stableDebtToken, "Transfer")
            .withArgs(borrower.address, ZeroAddress, debtToCover);

          await expect(liquidationTx)
            .to.emit(stableDebtToken, "Burn")
            .withArgs(
              borrower.address,
              debtToCover - expectedIncrease,
              borrowerMELDDataBeforeLiquidation.currentStableDebt,
              expectedIncrease,
              anyUint,
              anyUint
            );

          await expect(liquidationTx).to.not.emit(stableDebtToken, "Mint"); // expected increase too low
          await expect(liquidationTx).to.not.emit(
            variableDebtToken,
            "Transfer"
          ); // not liquidating variable debt
          await expect(liquidationTx).to.not.emit(variableDebtToken, "Burn"); // not liquidating variable debt

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          // The important thing here is checking that the event is emitted for the debt token. The values are checked in other test files.
          await expect(liquidationTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await meld.getAddress(),
              anyUint,
              anyUint,
              anyUint,
              anyUint,
              anyUint
            );

          // No mint to treasury because debt token has reserFactor == 0
          await expect(liquidationTx).to.not.emit(mMELD, "Transfer");
          await expect(liquidationTx).to.not.emit(mMELD, "Mint");

          const { liquidationMultiplier, actualLiquidationProtocolFee } =
            await calcLiquidationMultiplierParams(
              usdc,
              lendingPool,
              meldProtocolDataProvider
            );

          const maxLiquidatableCollateral = await calcMaxLiquidatableCollateral(
            usdc,
            meld,
            meldPriceOracle,
            liquidationMultiplier,
            debtToCover
          );

          const liquidationProtocolFeeAmount =
            actualLiquidationProtocolFee.percentMul(maxLiquidatableCollateral);

          const liquidatorAmount =
            maxLiquidatableCollateral - liquidationProtocolFeeAmount;

          // Events emitted when liquidator receives collateral mToken
          const liquidityIndex = calcExpectedReserveNormalizedIncome(
            usdcReserveDataAfterLiquidation,
            blockTimestamps.txTimestamp
          );

          await expect(liquidationTx)
            .to.emit(mUSDC, "BalanceTransfer")
            .withArgs(
              borrower.address,
              treasury.address,
              liquidationProtocolFeeAmount,
              liquidityIndex
            );

          await expect(liquidationTx)
            .to.emit(mUSDC, "BalanceTransfer")
            .withArgs(
              borrower.address,
              liquidator.address,
              liquidatorAmount,
              liquidityIndex
            );

          await expect(liquidationTx)
            .to.emit(mUSDC, "Transfer")
            .withArgs(
              borrower.address,
              treasury.address,
              liquidationProtocolFeeAmount
            );

          await expect(liquidationTx)
            .to.emit(mUSDC, "Transfer")
            .withArgs(borrower.address, liquidator.address, liquidatorAmount);

          // liquidator chose mTokens instead of underlying collateral asset
          await expect(liquidationTx).to.not.emit(usdc, "Transfer");

          // Event emitted when debt token is transferred from liquidator to pay off debt
          await expect(liquidationTx)
            .to.emit(meld, "Transfer")
            .withArgs(
              liquidator.address,
              await mMELD.getAddress(),
              debtToCover
            );

          // ReserveUsedAsCollateralDisabled, ReserveUsedAsCollateralEnabled, and LiquidationCall events are emitted by library LiquidationLogic.sol,
          // so we need to get the contract instance with the LiquidationLogic ABI
          const contractInstanceWithLogicLibraryABI =
            await ethers.getContractAt(
              "LiquidationLogic",
              await lendingPool.getAddress(),
              owner
            );

          // Event emitted when collateral token is set as collateral for liquidator because liquidator previously had 0 balance
          await expect(liquidationTx)
            .to.emit(
              contractInstanceWithLogicLibraryABI,
              "ReserveUsedAsCollateralEnabled"
            )
            .withArgs(await usdc.getAddress(), liquidator.address);

          // borrower's balance of collateral mTokens did not go to 0
          await expect(liquidationTx).to.not.emit(
            contractInstanceWithLogicLibraryABI,
            "ReserveUsedAsCollateralDisabled"
          );

          // liquidator liquidates partial debt
          await expect(liquidationTx)
            .to.emit(contractInstanceWithLogicLibraryABI, "LiquidationCall")
            .withArgs(
              await usdc.getAddress(),
              await meld.getAddress(),
              borrower.address,
              debtToCover,
              maxLiquidatableCollateral,
              liquidator.address,
              true
            );
        });

        it("Should emit correct events when liquidator receives collateral mToken and previously had collateral mToken balance of 0, and the protocol fee is 0", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meldPriceOracle,
            meld,
            usdc,
            owner,
            borrower,
            liquidator,
            treasury,
            oracleAdmin,
            poolAdmin,
          } = await loadFixture(setUpSingleStableBorrowMELDFixture);

          await lendingPool
            .connect(poolAdmin)
            .setLiquidationProtocolFeePercentage(0);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR / 12);

          // Instantiate debt reserve token contracts
          const meldReserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await meld.getAddress()
            );

          const mMELD = await ethers.getContractAt(
            "MToken",
            meldReserveTokenAddresses.mTokenAddress
          );

          const stableDebtToken = await ethers.getContractAt(
            "StableDebtToken",
            meldReserveTokenAddresses.stableDebtTokenAddress
          );

          const variableDebtToken = await ethers.getContractAt(
            "VariableDebtToken",
            meldReserveTokenAddresses.variableDebtTokenAddress
          );

          // Instantiate collateral reserve token contracts
          const usdcReserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await usdc.getAddress()
            );

          const mUSDC = await ethers.getContractAt(
            "MToken",
            usdcReserveTokenAddresses.mTokenAddress
          );

          // Make sure liquidator has funds with which to liquidate
          const debtToCover = await allocateAndApproveTokens(
            meld,
            owner,
            liquidator,
            lendingPool,
            1000n, // half of principal debt
            0n
          );

          // Simulate debt token price increase so that debt is liquidatable
          const [currentPrice, success] = await meldPriceOracle.getAssetPrice(
            await meld.getAddress()
          );

          expect(success).to.be.true;

          await meldPriceOracle
            .connect(oracleAdmin)
            .setAssetPrice(await meld.getAddress(), currentPrice * 4n);

          // Get borrower MELD reserve data before liquidation
          const borrowerMELDDataBeforeLiquidation: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              borrower.address
            );

          // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
          time.setNextBlockTimestamp(await time.latest());

          // Liquidator liquidates partial debt
          const liquidationTx = await lendingPool
            .connect(liquidator)
            .liquidationCall(
              await usdc.getAddress(), // collateral asset
              await meld.getAddress(), // debt asset
              borrower.address,
              debtToCover,
              true // receive mToken
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(liquidationTx);

          // Get USDC reserve data after liquidation
          const usdcReserveDataAfterLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          const expectedIncrease =
            borrowerMELDDataBeforeLiquidation.currentStableDebt -
            borrowerMELDDataBeforeLiquidation.principalStableDebt;

          // Check that the correct events were emitted //

          await expect(liquidationTx)
            .to.emit(stableDebtToken, "Transfer")
            .withArgs(borrower.address, ZeroAddress, debtToCover);

          await expect(liquidationTx)
            .to.emit(stableDebtToken, "Burn")
            .withArgs(
              borrower.address,
              debtToCover - expectedIncrease,
              borrowerMELDDataBeforeLiquidation.currentStableDebt,
              expectedIncrease,
              anyUint,
              anyUint
            );

          await expect(liquidationTx).to.not.emit(stableDebtToken, "Mint"); // expected increase too low
          await expect(liquidationTx).to.not.emit(
            variableDebtToken,
            "Transfer"
          ); // not liquidating variable debt
          await expect(liquidationTx).to.not.emit(variableDebtToken, "Burn"); // not liquidating variable debt

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          // The important thing here is checking that the event is emitted for the debt token. The values are checked in other test files.
          await expect(liquidationTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await meld.getAddress(),
              anyUint,
              anyUint,
              anyUint,
              anyUint,
              anyUint
            );

          // No mint to treasury because debt token has reserFactor == 0
          await expect(liquidationTx).to.not.emit(mMELD, "Transfer");
          await expect(liquidationTx).to.not.emit(mMELD, "Mint");

          const { liquidationMultiplier, actualLiquidationProtocolFee } =
            await calcLiquidationMultiplierParams(
              usdc,
              lendingPool,
              meldProtocolDataProvider
            );

          const maxLiquidatableCollateral = await calcMaxLiquidatableCollateral(
            usdc,
            meld,
            meldPriceOracle,
            liquidationMultiplier,
            debtToCover
          );

          const liquidationProtocolFeeAmount =
            actualLiquidationProtocolFee.percentMul(maxLiquidatableCollateral);

          const liquidatorAmount =
            maxLiquidatableCollateral - liquidationProtocolFeeAmount;

          expect(liquidationProtocolFeeAmount).to.equal(0);
          expect(liquidatorAmount).to.equal(maxLiquidatableCollateral);

          // Events emitted when liquidator receives collateral mToken
          const liquidityIndex = calcExpectedReserveNormalizedIncome(
            usdcReserveDataAfterLiquidation,
            blockTimestamps.txTimestamp
          );

          await expect(liquidationTx)
            .to.emit(mUSDC, "BalanceTransfer")
            .withArgs(
              borrower.address,
              treasury.address,
              liquidationProtocolFeeAmount,
              liquidityIndex
            );

          await expect(liquidationTx)
            .to.emit(mUSDC, "BalanceTransfer")
            .withArgs(
              borrower.address,
              liquidator.address,
              liquidatorAmount,
              liquidityIndex
            );

          await expect(liquidationTx)
            .to.emit(mUSDC, "Transfer")
            .withArgs(
              borrower.address,
              treasury.address,
              liquidationProtocolFeeAmount
            );

          await expect(liquidationTx)
            .to.emit(mUSDC, "Transfer")
            .withArgs(borrower.address, liquidator.address, liquidatorAmount);

          // liquidator chose mTokens instead of underlying collateral asset
          await expect(liquidationTx).to.not.emit(usdc, "Transfer");

          // Event emitted when debt token is transferred from liquidator to pay off debt
          await expect(liquidationTx)
            .to.emit(meld, "Transfer")
            .withArgs(
              liquidator.address,
              await mMELD.getAddress(),
              debtToCover
            );

          // ReserveUsedAsCollateralDisabled and ReserveUsedAsCollateralEnabled Events are emitted by library LiquidationLogic.sol,
          // so we need to get the contract instance with the LiquidationLogic ABI
          const contractInstanceWithLogicLibraryABI =
            await ethers.getContractAt(
              "LiquidationLogic",
              await lendingPool.getAddress(),
              owner
            );

          // Event emitted when collateral token is set as collateral for liquidator because liquidator previously had 0 balance
          await expect(liquidationTx)
            .to.emit(
              contractInstanceWithLogicLibraryABI,
              "ReserveUsedAsCollateralEnabled"
            )
            .withArgs(await usdc.getAddress(), liquidator.address);

          // borrower's balance of collateral mTokens did not go to 0
          await expect(liquidationTx).to.not.emit(
            contractInstanceWithLogicLibraryABI,
            "ReserveUsedAsCollateralDisabled"
          );

          // liquidator liquidates partial debt
          await expect(liquidationTx)
            .to.emit(contractInstanceWithLogicLibraryABI, "LiquidationCall")
            .withArgs(
              await usdc.getAddress(),
              await meld.getAddress(),
              borrower.address,
              debtToCover,
              maxLiquidatableCollateral,
              liquidator.address,
              true
            );
        });

        it("Should emit correct events when liquidator receives collateral mToken and previously had a balance of collateral mTokens", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meldPriceOracle,
            meld,
            usdc,
            owner,
            borrower,
            liquidator,
            treasury,
            oracleAdmin,
          } = await loadFixture(setUpSingleStableBorrowMELDFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR);

          // Liquidator deposits USDC collateral (ensures liquidator has a balance of USDC mTokens)
          const depositAmountUSDC = await allocateAndApproveTokens(
            usdc,
            owner,
            liquidator,
            lendingPool,
            500n,
            0n
          );

          await lendingPool
            .connect(liquidator)
            .deposit(
              await usdc.getAddress(),
              depositAmountUSDC,
              liquidator.address,
              true,
              0
            );

          // Instantiate debt reserve token contracts
          const meldReserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await meld.getAddress()
            );

          const mMELD = await ethers.getContractAt(
            "MToken",
            meldReserveTokenAddresses.mTokenAddress
          );

          const stableDebtToken = await ethers.getContractAt(
            "StableDebtToken",
            meldReserveTokenAddresses.stableDebtTokenAddress
          );

          const variableDebtToken = await ethers.getContractAt(
            "VariableDebtToken",
            meldReserveTokenAddresses.variableDebtTokenAddress
          );

          // Instantiate collateral reserve token contracts
          const usdcReserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await usdc.getAddress()
            );

          const mUSDC = await ethers.getContractAt(
            "MToken",
            usdcReserveTokenAddresses.mTokenAddress
          );

          // Make sure liquidator has funds with which to liquidate
          await allocateAndApproveTokens(
            meld,
            owner,
            liquidator,
            lendingPool,
            2500n,
            0n
          );

          // Simulate debt token price increase so that debt is liquidatable
          const [currentPrice, success] = await meldPriceOracle.getAssetPrice(
            await meld.getAddress()
          );

          expect(success).to.be.true;

          await meldPriceOracle
            .connect(oracleAdmin)
            .setAssetPrice(await meld.getAddress(), currentPrice * 4n);

          // Get borrower MELD reserve data before liquidation
          const borrowerMELDDataBeforeLiquidation: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              borrower.address
            );

          // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
          time.setNextBlockTimestamp(await time.latest());

          // Liquidator liquidates all liquidatable debt (up to close factor)
          const liquidationTx = await lendingPool
            .connect(liquidator)
            .liquidationCall(
              await usdc.getAddress(), // collateral asset
              await meld.getAddress(), // debt asset
              borrower.address,
              MaxUint256, // flag for all liquidatable debt
              true // receive mToken
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(liquidationTx);

          // Get USDC reserve data after liquidation
          const usdcReserveDataAfterLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          const expectedIncrease =
            borrowerMELDDataBeforeLiquidation.currentStableDebt -
            borrowerMELDDataBeforeLiquidation.principalStableDebt;

          const maxLiquidatableDebt = (
            borrowerMELDDataBeforeLiquidation.currentStableDebt +
            borrowerMELDDataBeforeLiquidation.currentVariableDebt
          ).percentMul(LIQUIDATION_CLOSE_FACTOR_PERCENT);

          // Check that the correct events were emitted //

          await expect(liquidationTx)
            .to.emit(stableDebtToken, "Transfer")
            .withArgs(borrower.address, ZeroAddress, maxLiquidatableDebt);

          await expect(liquidationTx)
            .to.emit(stableDebtToken, "Burn")
            .withArgs(
              borrower.address,
              maxLiquidatableDebt - expectedIncrease,
              borrowerMELDDataBeforeLiquidation.currentStableDebt,
              expectedIncrease,
              anyUint,
              anyUint
            );

          await expect(liquidationTx).to.not.emit(stableDebtToken, "Mint"); // expected increase too low
          await expect(liquidationTx).to.not.emit(
            variableDebtToken,
            "Transfer"
          ); // not liquidating variable debt
          await expect(liquidationTx).to.not.emit(variableDebtToken, "Burn"); // not liquidating variable debt

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          // The important thing here is checking that the event is emitted for the debt token. The values are checked in other test files.
          await expect(liquidationTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await meld.getAddress(),
              anyUint,
              anyUint,
              anyUint,
              anyUint,
              anyUint
            );

          // No mint to treasury because debt token has reserFactor == 0
          await expect(liquidationTx).to.not.emit(mMELD, "Transfer");
          await expect(liquidationTx).to.not.emit(mMELD, "Mint");

          const { liquidationMultiplier, actualLiquidationProtocolFee } =
            await calcLiquidationMultiplierParams(
              usdc,
              lendingPool,
              meldProtocolDataProvider
            );

          const maxLiquidatableCollateral = await calcMaxLiquidatableCollateral(
            usdc,
            meld,
            meldPriceOracle,
            liquidationMultiplier,
            maxLiquidatableDebt
          );

          const liquidationProtocolFeeAmount =
            actualLiquidationProtocolFee.percentMul(maxLiquidatableCollateral);

          const liquidatorAmount =
            maxLiquidatableCollateral - liquidationProtocolFeeAmount;

          // Events emitted when liquidator receives collateral mToken
          const liquidityIndex = calcExpectedReserveNormalizedIncome(
            usdcReserveDataAfterLiquidation,
            blockTimestamps.txTimestamp
          );

          await expect(liquidationTx)
            .to.emit(mUSDC, "BalanceTransfer")
            .withArgs(
              borrower.address,
              treasury.address,
              liquidationProtocolFeeAmount,
              liquidityIndex
            );

          await expect(liquidationTx)
            .to.emit(mUSDC, "BalanceTransfer")
            .withArgs(
              borrower.address,
              liquidator.address,
              liquidatorAmount,
              liquidityIndex
            );

          await expect(liquidationTx)
            .to.emit(mUSDC, "Transfer")
            .withArgs(
              borrower.address,
              treasury.address,
              liquidationProtocolFeeAmount
            );

          await expect(liquidationTx)
            .to.emit(mUSDC, "Transfer")
            .withArgs(borrower.address, liquidator.address, liquidatorAmount);

          // liquidator chose mTokens instead of underlying collateral asset
          await expect(liquidationTx).to.not.emit(usdc, "Transfer");

          // Event emitted when debt token is transferred from liquidator to pay off debt
          await expect(liquidationTx)
            .to.emit(meld, "Transfer")
            .withArgs(
              liquidator.address,
              await mMELD.getAddress(),
              maxLiquidatableDebt
            );

          // ReserveUsedAsCollateralDisabled and ReserveUsedAsCollateralEnabled Events are emitted by library LiquidationLogic.sol,
          // so we need to get the contract instance with the LiquidationLogic ABI
          const contractInstanceWithLogicLibraryABI =
            await ethers.getContractAt(
              "LiquidationLogic",
              await lendingPool.getAddress(),
              owner
            );

          await expect(liquidationTx).to.not.emit(
            contractInstanceWithLogicLibraryABI,
            "ReserveUsedAsCollateralDisabled"
          ); // borrower's balance of collateral mTokens did not go to 0
          await expect(liquidationTx).to.not.emit(
            contractInstanceWithLogicLibraryABI,
            "ReserveUsedAsCollateralEnabled"
          ); // liquidator already had balance of collateral mTokens

          await expect(liquidationTx)
            .to.emit(contractInstanceWithLogicLibraryABI, "LiquidationCall")
            .withArgs(
              await usdc.getAddress(),
              await meld.getAddress(),
              borrower.address,
              maxLiquidatableDebt,
              maxLiquidatableCollateral,
              liquidator.address,
              true
            );
        });

        it("Should emit correct events when liquidator receives underlying collateral asset", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meldPriceOracle,
            meld,
            usdc,
            owner,
            borrower,
            liquidator,
            treasury,
            oracleAdmin,
          } = await loadFixture(setUpSingleStableBorrowMELDFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR / 2);

          // Instantiate debt reserve token contracts
          const meldReserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await meld.getAddress()
            );

          const mMELD = await ethers.getContractAt(
            "MToken",
            meldReserveTokenAddresses.mTokenAddress
          );

          const stableDebtToken = await ethers.getContractAt(
            "StableDebtToken",
            meldReserveTokenAddresses.stableDebtTokenAddress
          );

          const variableDebtToken = await ethers.getContractAt(
            "VariableDebtToken",
            meldReserveTokenAddresses.variableDebtTokenAddress
          );

          // Instantiate collateral reserve token contracts
          const usdcReserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await usdc.getAddress()
            );

          const mUSDC = await ethers.getContractAt(
            "MToken",
            usdcReserveTokenAddresses.mTokenAddress
          );

          // Make sure liquidator has funds with which to liquidate
          const debtToCover = await allocateAndApproveTokens(
            meld,
            owner,
            liquidator,
            lendingPool,
            500n, // partial debt
            0n
          );

          // Simulate debt token price increase so that debt is liquidatable
          const [currentPrice, success] = await meldPriceOracle.getAssetPrice(
            await meld.getAddress()
          );

          expect(success).to.be.true;

          await meldPriceOracle
            .connect(oracleAdmin)
            .setAssetPrice(await meld.getAddress(), currentPrice * 4n);

          // Get borrower MELD reserve data before liquidation
          const borrowerMELDDataBeforeLiquidation: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              borrower.address
            );

          // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
          time.setNextBlockTimestamp(await time.latest());

          // Liquidator liquidates partial debt
          const liquidationTx = await lendingPool
            .connect(liquidator)
            .liquidationCall(
              await usdc.getAddress(), // collateral asset
              await meld.getAddress(), // debt asset
              borrower.address,
              debtToCover,
              false // receive collateral token
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(liquidationTx);

          // Get USDC reserve data after liquidation
          const usdcReserveDataAfterLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          const expectedIncrease =
            borrowerMELDDataBeforeLiquidation.currentStableDebt -
            borrowerMELDDataBeforeLiquidation.principalStableDebt;

          // Check that the correct events were emitted //
          await expect(liquidationTx)
            .to.emit(stableDebtToken, "Transfer")
            .withArgs(borrower.address, ZeroAddress, debtToCover);

          await expect(liquidationTx)
            .to.emit(stableDebtToken, "Burn")
            .withArgs(
              borrower.address,
              debtToCover - expectedIncrease,
              borrowerMELDDataBeforeLiquidation.currentStableDebt,
              expectedIncrease,
              anyUint,
              anyUint
            );

          await expect(liquidationTx).to.not.emit(stableDebtToken, "Mint"); // expected increase too low
          await expect(liquidationTx).to.not.emit(
            variableDebtToken,
            "Transfer"
          ); // not liquidating variable debt
          await expect(liquidationTx).to.not.emit(variableDebtToken, "Burn"); // not liquidating variable debt

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          // The important thing here is checking that the event is emitted for the debt token. The values are checked in other test files.
          await expect(liquidationTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await meld.getAddress(),
              anyUint,
              anyUint,
              anyUint,
              anyUint,
              anyUint
            );

          // Collateral reserve should get updated too because liquidator will receive underlying collateral asset
          await expect(liquidationTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await usdc.getAddress(),
              anyUint,
              anyUint,
              anyUint,
              anyUint,
              anyUint
            );

          // No mint to treasury because debt token has reserFactor == 0
          await expect(liquidationTx).to.not.emit(mMELD, "Transfer");
          await expect(liquidationTx).to.not.emit(mMELD, "Mint");

          const { liquidationMultiplier, actualLiquidationProtocolFee } =
            await calcLiquidationMultiplierParams(
              usdc,
              lendingPool,
              meldProtocolDataProvider
            );

          const maxLiquidatableCollateral = await calcMaxLiquidatableCollateral(
            usdc,
            meld,
            meldPriceOracle,
            liquidationMultiplier,
            debtToCover
          );

          const liquidationProtocolFeeAmount =
            actualLiquidationProtocolFee.percentMul(maxLiquidatableCollateral);

          const liquidatorAmount =
            maxLiquidatableCollateral - liquidationProtocolFeeAmount;

          // Events emitted when collateral mToken is burned, which sends underlying asset to liquidator
          const liquidityIndex = calcExpectedReserveNormalizedIncome(
            usdcReserveDataAfterLiquidation,
            blockTimestamps.txTimestamp
          );

          await expect(liquidationTx)
            .to.emit(mUSDC, "Transfer")
            .withArgs(
              borrower.address,
              ZeroAddress,
              liquidationProtocolFeeAmount
            );

          await expect(liquidationTx)
            .to.emit(mUSDC, "Transfer")
            .withArgs(borrower.address, ZeroAddress, liquidatorAmount);

          await expect(liquidationTx)
            .to.emit(usdc, "Transfer")
            .withArgs(
              await mUSDC.getAddress(),
              treasury.address,
              liquidationProtocolFeeAmount
            );

          await expect(liquidationTx)
            .to.emit(usdc, "Transfer")
            .withArgs(
              await mUSDC.getAddress(),
              liquidator.address,
              liquidatorAmount
            );

          await expect(liquidationTx)
            .to.emit(mUSDC, "Burn")
            .withArgs(
              borrower.address,
              treasury.address,
              liquidationProtocolFeeAmount,
              liquidityIndex
            );

          await expect(liquidationTx)
            .to.emit(mUSDC, "Burn")
            .withArgs(
              borrower.address,
              liquidator.address,
              liquidatorAmount,
              liquidityIndex
            );

          await expect(liquidationTx).to.not.emit(mUSDC, "BalanceTransfer"); // liquidator elected to not receive mTokens

          // Event emitted when debt token is transferred from liquidator to pay off debt
          await expect(liquidationTx)
            .to.emit(meld, "Transfer")
            .withArgs(
              liquidator.address,
              await mMELD.getAddress(),
              debtToCover
            );

          // ReserveUsedAsCollateralDisabled and ReserveUsedAsCollateralEnabled Events are emitted by library LiquidationLogic.sol,
          // so we need to get the contract instance with the LiquidationLogic ABI
          const contractInstanceWithLogicLibraryABI =
            await ethers.getContractAt(
              "LiquidationLogic",
              await lendingPool.getAddress(),
              owner
            );

          // Event not emitted because liquidator elected not to receive mTokens
          await expect(liquidationTx).to.not.emit(
            contractInstanceWithLogicLibraryABI,
            "ReserveUsedAsCollateralEnabled"
          );

          // borrower's balance of collateral mTokens did not go to 0
          await expect(liquidationTx).to.not.emit(
            contractInstanceWithLogicLibraryABI,
            "ReserveUsedAsCollateralDisabled"
          );

          // liquidator liquidated partial debt
          await expect(liquidationTx)
            .to.emit(contractInstanceWithLogicLibraryABI, "LiquidationCall")
            .withArgs(
              await usdc.getAddress(),
              await meld.getAddress(),
              borrower.address,
              debtToCover,
              maxLiquidatableCollateral,
              liquidator.address,
              false
            );
        });

        it("Should update state correctly for max debtToCover (MaxUint256)", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meldPriceOracle,
            meld,
            usdc,
            owner,
            borrower,
            liquidator,
            oracleAdmin,
          } = await loadFixture(setUpSingleStableBorrowMELDFixture);
          // This test case also tests the scenario where the liquidator receives mTokens instead of the underlying collateral asset and does NOT already have mTokens

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR);

          // Make sure liquidator has funds with which to liquidate
          await allocateAndApproveTokens(
            meld,
            owner,
            liquidator,
            lendingPool,
            2500n,
            0n
          );

          // Simulate debt token price increase so that debt is liquidatable
          const [currentPrice, success] = await meldPriceOracle.getAssetPrice(
            await meld.getAddress()
          );

          expect(success).to.be.true;

          await meldPriceOracle
            .connect(oracleAdmin)
            .setAssetPrice(await meld.getAddress(), currentPrice * 4n);

          // Get USDC reserve data before liquidation
          const usdcReserveDataBeforeLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Get MELD reserve data before liquidation
          const meldReserveDataBeforeLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await meld.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Get borrower MELD reserve data before liquidation
          const borrowerMELDDataBeforeLiquidation: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              borrower.address
            );

          // Get borrower account data (over all reserves) before liquidation
          const borrowerAccountDataBefore =
            await lendingPool.getUserAccountData(borrower.address);

          // Get liquidator USDC reserve data after liquidation
          const liquidatorUSDCDataBeforeLiquidation: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              liquidator.address
            );

          expect(liquidatorUSDCDataBeforeLiquidation.usageAsCollateralEnabled)
            .to.be.false;

          // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
          time.setNextBlockTimestamp(await time.latest());

          // Liquidator liquidates all liquidatable debt (up to close factor)
          await lendingPool.connect(liquidator).liquidationCall(
            await usdc.getAddress(), // collateral asset
            await meld.getAddress(), // debt asset
            borrower.address,
            MaxUint256, // flag for all liquidatable debt
            true // receive mToken
          );

          // Get USDC reserve data after liquidation
          const usdcReserveDataAfterLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Get MELD reserve data after liquidation
          const meldReserveDataAfterLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await meld.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Get borrower MELD reserve data after liquidation
          const borrowerMELDDataAfterLiquidation: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              borrower.address
            );

          // Get borrower account data (over all reserves) after liquidation
          const borrowerAccountDataAfter = await lendingPool.getUserAccountData(
            borrower.address
          );

          // Get liquidator USDC reserve data after liquidation
          const liquidatorUSDCDataAfterLiquidation: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              liquidator.address
            );

          const maxLiquidatableDebt = (
            borrowerMELDDataBeforeLiquidation.currentStableDebt +
            borrowerMELDDataBeforeLiquidation.currentVariableDebt
          ).percentMul(LIQUIDATION_CLOSE_FACTOR_PERCENT);

          // Check state //

          // borrower's health factor should go up after liquidation
          expect(borrowerAccountDataAfter.healthFactor).to.be.greaterThan(
            borrowerAccountDataBefore.healthFactor
          );

          // health factor should be >= 1 after liquidation
          expect(
            borrowerAccountDataAfter.healthFactor
          ).to.be.greaterThanOrEqual(_1e18); // health factor is expressed with 18 decimals (1e18)

          // stable debt should be the less after liquidation
          expect(
            borrowerMELDDataAfterLiquidation.currentStableDebt
          ).to.be.equal(
            borrowerMELDDataBeforeLiquidation.currentStableDebt -
              maxLiquidatableDebt
          );

          // stable borrow rate should be lower after liquidation
          expect(
            meldReserveDataAfterLiquidation.stableBorrowRate
          ).to.be.lessThanOrEqual(
            meldReserveDataBeforeLiquidation.stableBorrowRate
          );

          // average stable borrow rate should be same or lower after liquidation
          expect(
            meldReserveDataAfterLiquidation.averageStableBorrowRate
          ).to.be.lessThanOrEqual(
            meldReserveDataBeforeLiquidation.averageStableBorrowRate
          );

          // available liquidity of the debt reserve should be greater after liquidation
          expect(
            meldReserveDataAfterLiquidation.availableLiquidity
          ).to.be.equal(
            meldReserveDataBeforeLiquidation.availableLiquidity +
              maxLiquidatableDebt
          );

          // the liquidity index of the debt reserve should be greater than or equal to the index before
          expect(
            meldReserveDataAfterLiquidation.liquidityIndex
          ).to.be.greaterThanOrEqual(
            meldReserveDataBeforeLiquidation.liquidityIndex
          );

          // the principal APY after a liquidation should belower than the APY before
          expect(meldReserveDataAfterLiquidation.liquidityRate).to.be.lessThan(
            meldReserveDataBeforeLiquidation.liquidityRate
          );

          // available liquidity of the collateral reserve should be the same after liquidation (mTokens changed ownership but not burned)
          expect(
            usdcReserveDataAfterLiquidation.availableLiquidity
          ).to.be.equal(usdcReserveDataBeforeLiquidation.availableLiquidity);

          // liquidator should now have USDC as collateral
          expect(liquidatorUSDCDataAfterLiquidation.usageAsCollateralEnabled).to
            .be.true;
        });

        it("Should update state correctly when debtToCover < max", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meldPriceOracle,
            meld,
            usdc,
            owner,
            borrower,
            liquidator,
            oracleAdmin,
          } = await loadFixture(setUpSingleStableBorrowMELDFixture);
          // This test case also tests the scenario where the liquidator receives mTokens instead of the underlying collateral asset and already has mTokens

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR / 2);

          // Liquidator deposits USDC collateral (ensures liquidator has a balance of USDC mTokens)
          const depositAmountUSDC = await allocateAndApproveTokens(
            usdc,
            owner,
            liquidator,
            lendingPool,
            500n,
            0n
          );

          await lendingPool
            .connect(liquidator)
            .deposit(
              await usdc.getAddress(),
              depositAmountUSDC,
              liquidator.address,
              true,
              0
            );

          // Make sure liquidator has funds with which to liquidate
          const debtToCover = await allocateAndApproveTokens(
            meld,
            owner,
            liquidator,
            lendingPool,
            800n, // less than half of principal debt
            0n
          );

          // Simulate debt token price increase so that debt is liquidatable
          const [currentPrice, success] = await meldPriceOracle.getAssetPrice(
            await meld.getAddress()
          );

          expect(success).to.be.true;

          await meldPriceOracle
            .connect(oracleAdmin)
            .setAssetPrice(await meld.getAddress(), currentPrice * 4n);

          // Get USDC reserve data before liquidation
          const usdcReserveDataBeforeLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Get MELD reserve data before liquidation
          const meldReserveDataBeforeLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await meld.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Get borrower MELD reserve data before liquidation
          const borrowerMELDDataBeforeLiquidation: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              borrower.address
            );

          // Get borrower account data (over all reserves) before liquidation
          const borrowerAccountDataBefore =
            await lendingPool.getUserAccountData(borrower.address);

          // Get liquidator USDC reserve data after liquidation
          const liquidatorUSDCDataBeforeLiquidation: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              liquidator.address
            );

          expect(liquidatorUSDCDataBeforeLiquidation.usageAsCollateralEnabled)
            .to.be.true;

          // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
          time.setNextBlockTimestamp(await time.latest());

          // Liquidator liquidates partial debt
          await lendingPool.connect(liquidator).liquidationCall(
            await usdc.getAddress(), // collateral asset
            await meld.getAddress(), // debt asset
            borrower.address,
            debtToCover,
            true // receive mToken
          );

          // Get USDC reserve data after liquidation
          const usdcReserveDataAfterLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Get MELD reserve data after liquidation
          const meldReserveDataAfterLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await meld.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Get borrower MELD reserve data after liquidation
          const borrowerMELDDataAfterLiquidation: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              borrower.address
            );

          // Get borrower account data (over all reserves) after liquidation
          const borrowerAccountDataAfter = await lendingPool.getUserAccountData(
            borrower.address
          );

          // Get liquidator USDC reserve data after liquidation
          const liquidatorUSDCDataAfterLiquidation: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              liquidator.address
            );

          // Check state //

          // borrower's health factor should go up after liquidation
          expect(borrowerAccountDataAfter.healthFactor).to.be.greaterThan(
            borrowerAccountDataBefore.healthFactor
          );

          // health factor doesn't get to 1 because liquidator didn't cover enough debt
          expect(borrowerAccountDataAfter.healthFactor).to.be.lessThan(_1e18); // health factor is expressed with 18 decimals (1e18)

          // stable debt should be less after liquidation
          expect(
            borrowerMELDDataAfterLiquidation.currentStableDebt
          ).to.be.equal(
            borrowerMELDDataBeforeLiquidation.currentStableDebt - debtToCover
          );

          // stable borrow rate should be lower after liquidation
          expect(
            meldReserveDataAfterLiquidation.stableBorrowRate
          ).to.be.lessThanOrEqual(
            meldReserveDataBeforeLiquidation.stableBorrowRate
          );

          // average stable borrow rate should be same or lower after liquidation
          expect(
            meldReserveDataAfterLiquidation.averageStableBorrowRate
          ).to.be.lessThanOrEqual(
            meldReserveDataBeforeLiquidation.averageStableBorrowRate
          );

          // available liquidity of the debt reserve should be greater after liquidation
          expect(
            meldReserveDataAfterLiquidation.availableLiquidity
          ).to.be.equal(
            meldReserveDataBeforeLiquidation.availableLiquidity + debtToCover
          );

          // the liquidity index of the debt reserve should be greater than the index before
          expect(
            meldReserveDataAfterLiquidation.liquidityIndex
          ).to.be.greaterThanOrEqual(
            meldReserveDataBeforeLiquidation.liquidityIndex
          );

          // the principal APY after a liquidation should belower than the APY before
          expect(meldReserveDataAfterLiquidation.liquidityRate).to.be.lessThan(
            meldReserveDataBeforeLiquidation.liquidityRate
          );

          // available liquidity of the collateral reserve should be the same after liquidation (mTokens changed ownership but not burned)
          expect(
            usdcReserveDataAfterLiquidation.availableLiquidity
          ).to.be.equal(usdcReserveDataBeforeLiquidation.availableLiquidity);

          // liquidator should still have USDC as collateral
          expect(liquidatorUSDCDataAfterLiquidation.usageAsCollateralEnabled).to
            .be.true;
        });

        it("Should update state correctly when liquidator receives underlying collateral asset", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meldPriceOracle,
            meld,
            usdc,
            owner,
            borrower,
            liquidator,
            oracleAdmin,
          } = await loadFixture(setUpSingleStableBorrowMELDFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR / 4);

          // Make sure liquidator has funds with which to liquidate
          const debtToCover = await allocateAndApproveTokens(
            meld,
            owner,
            liquidator,
            lendingPool,
            1000n, // half of principal debt
            0n
          );

          // Simulate debt token price increase so that debt is liquidatable
          const [currentPrice, success] = await meldPriceOracle.getAssetPrice(
            await meld.getAddress()
          );

          expect(success).to.be.true;

          await meldPriceOracle
            .connect(oracleAdmin)
            .setAssetPrice(await meld.getAddress(), currentPrice * 4n);

          // Get USDC reserve data before liquidation
          const usdcReserveDataBeforeLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Get MELD reserve data before liquidation
          const meldReserveDataBeforeLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await meld.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Get borrower MELD reserve data before liquidation
          const borrowerMELDDataBeforeLiquidation: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              borrower.address
            );

          // Get borrower account data (over all reserves) before liquidation
          const borrowerAccountDataBefore =
            await lendingPool.getUserAccountData(borrower.address);

          // Get liquidator USDC reserve data after liquidation
          const liquidatorUSDCDataBeforeLiquidation: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              liquidator.address
            );

          expect(liquidatorUSDCDataBeforeLiquidation.usageAsCollateralEnabled)
            .to.be.false;

          // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
          time.setNextBlockTimestamp(await time.latest());

          // Liquidator liquidates partial debt
          await lendingPool.connect(liquidator).liquidationCall(
            await usdc.getAddress(), // collateral asset
            await meld.getAddress(), // debt asset
            borrower.address,
            debtToCover,
            false // receive mToken
          );

          // Get USDC reserve data after liquidation
          const usdcReserveDataAfterLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Get MELD reserve data after liquidation
          const meldReserveDataAfterLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await meld.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Get borrower MELD reserve data after liquidation
          const borrowerMELDDataAfterLiquidation: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              borrower.address
            );

          // Get borrower account data (over all reserves) after liquidation
          const borrowerAccountDataAfter = await lendingPool.getUserAccountData(
            borrower.address
          );

          // Get liquidator USDC reserve data after liquidation
          const liquidatorUSDCDataAfterLiquidation: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              liquidator.address
            );

          // Check state //

          // borrower's health factor should go up after liquidation
          expect(borrowerAccountDataAfter.healthFactor).to.be.greaterThan(
            borrowerAccountDataBefore.healthFactor
          );

          // health factor should be >= 1 after liquidation
          expect(
            borrowerAccountDataAfter.healthFactor
          ).to.be.greaterThanOrEqual(_1e18); // health factor is expressed with 18 decimals (1e18)

          // stable debt should be less after liquidation
          expect(
            borrowerMELDDataAfterLiquidation.currentStableDebt
          ).to.be.equal(
            borrowerMELDDataBeforeLiquidation.currentStableDebt - debtToCover
          );

          // stable borrow rate should be lower after liquidation
          expect(
            meldReserveDataAfterLiquidation.stableBorrowRate
          ).to.be.lessThanOrEqual(
            meldReserveDataBeforeLiquidation.stableBorrowRate
          );

          // average stable borrow rate should be same or lower after liquidation
          expect(
            meldReserveDataAfterLiquidation.averageStableBorrowRate
          ).to.be.lessThanOrEqual(
            meldReserveDataBeforeLiquidation.averageStableBorrowRate
          );

          // available liquidity of the debt reserve should be greater after liquidation
          expect(
            meldReserveDataAfterLiquidation.availableLiquidity
          ).to.be.equal(
            meldReserveDataBeforeLiquidation.availableLiquidity + debtToCover
          );

          // the liquidity index of the debt reserve should be greater than or equal to the index before
          expect(
            meldReserveDataAfterLiquidation.liquidityIndex
          ).to.be.greaterThanOrEqual(
            meldReserveDataBeforeLiquidation.liquidityIndex
          );

          // the principal APY after a liquidation should belower than the APY before
          expect(meldReserveDataAfterLiquidation.liquidityRate).to.be.lessThan(
            meldReserveDataBeforeLiquidation.liquidityRate
          );

          // available liquidity of the collateral reserve should go down after liquidation because liquidator gets underlying tokens
          expect(
            usdcReserveDataAfterLiquidation.availableLiquidity
          ).to.be.lessThan(usdcReserveDataBeforeLiquidation.availableLiquidity);

          // liquidator should not have USDC (mTokens) as collateral
          expect(liquidatorUSDCDataAfterLiquidation.usageAsCollateralEnabled).to
            .be.false;
        });

        it("Should update state correctly after two liquidations of same borrower position in a row", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meldPriceOracle,
            meld,
            usdc,
            owner,
            borrower,
            liquidator,
            oracleAdmin,
          } = await loadFixture(setUpSingleStableBorrowMELDFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR * 2);

          // Make sure liquidator has funds with which to liquidate
          const debtToCover = await allocateAndApproveTokens(
            meld,
            owner,
            liquidator,
            lendingPool,
            1000n, // half of principal debt
            3n
          );

          // Simulate debt token price increase so that debt is liquidatable
          const [currentPrice, success] = await meldPriceOracle.getAssetPrice(
            await meld.getAddress()
          );

          expect(success).to.be.true;
          await meldPriceOracle
            .connect(oracleAdmin)
            .setAssetPrice(await meld.getAddress(), currentPrice * 4n);

          // Liquidator liquidates partial liquidatable debt
          await lendingPool.connect(liquidator).liquidationCall(
            await usdc.getAddress(), // collateral asset
            await meld.getAddress(), // debt asset
            borrower.address,
            debtToCover,
            false // receive mToken
          );

          // Get USDC reserve data before second liquidation
          const usdcReserveDataBeforeLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Get MELD reserve data before second liquidation
          const meldReserveDataBeforeLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await meld.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Get borrower MELD reserve data before second liquidation
          const borrowerMELDDataBeforeLiquidation: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              borrower.address
            );

          // Get borrower account data (over all reserves) before liquidation
          const borrowerAccountDataBefore =
            await lendingPool.getUserAccountData(borrower.address);

          // Get liquidator USDC reserve data before second liquidation
          const liquidatorUSDCDataBeforeLiquidation: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              liquidator.address
            );

          expect(liquidatorUSDCDataBeforeLiquidation.usageAsCollateralEnabled)
            .to.be.false;

          // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
          time.setNextBlockTimestamp(await time.latest());

          // Liquidator liquidates rest of liquidatable debt (up to close factor)
          await lendingPool.connect(liquidator).liquidationCall(
            await usdc.getAddress(), // collateral asset
            await meld.getAddress(), // debt asset
            borrower.address,
            MaxUint256, // flag for all liquidatable debt
            true // receive mToken
          );

          // Get USDC reserve data after second liquidation
          const usdcReserveDataAfterLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Get MELD reserve data after second liquidation
          const meldReserveDataAfterLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await meld.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Get borrower MELD reserve data after second liquidation
          const borrowerMELDDataAfterLiquidation: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              borrower.address
            );

          // Get borrower account data (over all reserves) after second liquidation
          const borrowerAccountDataAfter = await lendingPool.getUserAccountData(
            borrower.address
          );

          // Get liquidator USDC reserve data after second liquidation
          const liquidatorUSDCDataAfterLiquidation: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              liquidator.address
            );

          const maxLiquidatableDebt = (
            borrowerMELDDataBeforeLiquidation.currentStableDebt +
            borrowerMELDDataBeforeLiquidation.currentVariableDebt
          ).percentMul(LIQUIDATION_CLOSE_FACTOR_PERCENT);

          // Check state //

          // borrower's health factor should go up after liquidation
          expect(borrowerAccountDataAfter.healthFactor).to.be.greaterThan(
            borrowerAccountDataBefore.healthFactor
          );

          // health factor should be >= 1 after liquidation
          expect(
            borrowerAccountDataAfter.healthFactor
          ).to.be.greaterThanOrEqual(_1e18); // health factor is expressed with 18 decimals (1e18)

          // stable debt should be less after liquidation
          expect(
            borrowerMELDDataAfterLiquidation.currentStableDebt
          ).to.be.equal(
            borrowerMELDDataBeforeLiquidation.currentStableDebt -
              maxLiquidatableDebt
          );

          // stable borrow rate should be lower after liquidation
          expect(
            meldReserveDataAfterLiquidation.stableBorrowRate
          ).to.be.lessThanOrEqual(
            meldReserveDataBeforeLiquidation.stableBorrowRate
          );

          // average stable borrow rate should be same or lower after liquidation
          expect(
            meldReserveDataAfterLiquidation.averageStableBorrowRate
          ).to.be.lessThanOrEqual(
            meldReserveDataBeforeLiquidation.averageStableBorrowRate
          );

          // available liquidity of the debt reserve should be greater after liquidation
          expect(
            meldReserveDataAfterLiquidation.availableLiquidity
          ).to.be.equal(
            meldReserveDataBeforeLiquidation.availableLiquidity +
              maxLiquidatableDebt
          );

          // the liquidity index of the debt reserve should be greater than or equal the index before
          expect(
            meldReserveDataAfterLiquidation.liquidityIndex
          ).to.be.greaterThanOrEqual(
            meldReserveDataBeforeLiquidation.liquidityIndex
          );

          // the principal APY after a liquidation should belower than the APY before
          expect(meldReserveDataAfterLiquidation.liquidityRate).to.be.lessThan(
            meldReserveDataBeforeLiquidation.liquidityRate
          );

          // available liquidity of the collateral reserve should be the same after second liquidation (mTokens changed ownership but not burned)
          expect(
            usdcReserveDataAfterLiquidation.availableLiquidity
          ).to.be.equal(usdcReserveDataBeforeLiquidation.availableLiquidity);

          // liquidator should have received mTokens after second liquidation
          expect(liquidatorUSDCDataAfterLiquidation.usageAsCollateralEnabled).to
            .be.true;
        });

        it("Should update token balances correctly for max debtToCover (MaxUint256)", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            meldPriceOracle,
            meld,
            usdc,
            owner,
            borrower,
            liquidator,
            treasury,
            oracleAdmin,
          } = await loadFixture(setUpSingleStableBorrowMELDFixture);
          // This test case also tests the scenario where the liquidator receives mTokens instead of the underlying collateral asset

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR);

          // Make sure liquidator has funds with which to liquidate
          await allocateAndApproveTokens(
            meld,
            owner,
            liquidator,
            lendingPool,
            2500n,
            0n
          );

          // Instantiate debt reserve token contracts
          const meldReserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await meld.getAddress()
            );

          const stableDebtToken = await ethers.getContractAt(
            "StableDebtToken",
            meldReserveTokenAddresses.stableDebtTokenAddress
          );

          // Instantiate collateral reserve token contracts
          const usdcReserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await usdc.getAddress()
            );

          const mUSDC = await ethers.getContractAt(
            "MToken",
            usdcReserveTokenAddresses.mTokenAddress
          );

          // Simulate debt token price increase so that debt is liquidatable
          const [currentPrice, success] = await meldPriceOracle.getAssetPrice(
            await meld.getAddress()
          );

          expect(success).to.be.true;

          await meldPriceOracle
            .connect(oracleAdmin)
            .setAssetPrice(await meld.getAddress(), currentPrice * 4n);

          // Get borrower MELD reserve data before liquidation
          const borrowerMELDDataBeforeLiquidation: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              borrower.address
            );

          // Get token balances before liquidation
          const borrowerStableDebtBalanceBeforeLiquidation =
            await stableDebtToken.balanceOf(borrower.address);
          const borrowerMUSDCBalanceBeforeLiquidation = await mUSDC.balanceOf(
            borrower.address
          );
          const mTokenBalanceBeforeLiquidation = await meld.balanceOf(
            meldReserveTokenAddresses.mTokenAddress
          );
          const liquidatorMUSDCBalanceBeforeLiquidation = await mUSDC.balanceOf(
            liquidator.address
          );
          const treasuryMUSDCBalanceBeforeLiquidation = await mUSDC.balanceOf(
            treasury.address
          );

          // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
          time.setNextBlockTimestamp(await time.latest());

          // Liquidator liquidates all liquidatable debt (up to close factor)
          await lendingPool.connect(liquidator).liquidationCall(
            await usdc.getAddress(), // collateral asset
            await meld.getAddress(), // debt asset
            borrower.address,
            MaxUint256, // flag for all liquidatable debt
            true // receive mToken
          );

          const maxLiquidatableDebt = (
            borrowerMELDDataBeforeLiquidation.currentStableDebt +
            borrowerMELDDataBeforeLiquidation.currentVariableDebt
          ).percentMul(LIQUIDATION_CLOSE_FACTOR_PERCENT);

          const { liquidationMultiplier, actualLiquidationProtocolFee } =
            await calcLiquidationMultiplierParams(
              usdc,
              lendingPool,
              meldProtocolDataProvider
            );

          const maxLiquidatableCollateral = await calcMaxLiquidatableCollateral(
            usdc,
            meld,
            meldPriceOracle,
            liquidationMultiplier,
            maxLiquidatableDebt
          );

          const liquidationProtocolFeeAmount =
            actualLiquidationProtocolFee.percentMul(maxLiquidatableCollateral);

          const liquidatorAmount =
            maxLiquidatableCollateral - liquidationProtocolFeeAmount;

          // Get token balances after liquidation
          const borrowerStableDebtBalanceAfterLiquidation =
            await stableDebtToken.balanceOf(borrower.address);
          const borrowerMUSDCBalanceAfterLiquidation = await mUSDC.balanceOf(
            borrower.address
          );
          const mTokenBalanceAfterLiquidation = await meld.balanceOf(
            meldReserveTokenAddresses.mTokenAddress
          );
          const liquidatorMUSDCBalanceAfterLiquidation = await mUSDC.balanceOf(
            liquidator.address
          );
          const liquidatorUSDCBalanceAfterLiquidation = await usdc.balanceOf(
            liquidator.address
          );
          const treasuryMUSDCBalanceAfterLiquidation = await mUSDC.balanceOf(
            treasury.address
          );

          // Check token balances //

          // borrower stable debt balance should be lower after liquidation
          expect(borrowerStableDebtBalanceAfterLiquidation).to.be.equal(
            borrowerStableDebtBalanceBeforeLiquidation - maxLiquidatableDebt
          );

          // debt mToken balance should be higher after liquidation
          expect(mTokenBalanceAfterLiquidation).to.be.equal(
            mTokenBalanceBeforeLiquidation + maxLiquidatableDebt
          );

          // borrower collateral mToken balance should be lower after liquidation
          expect(borrowerMUSDCBalanceAfterLiquidation).to.be.equal(
            borrowerMUSDCBalanceBeforeLiquidation - maxLiquidatableCollateral
          );

          // liquidator collateral mToken balance should be higher after liquidation
          expect(liquidatorMUSDCBalanceAfterLiquidation).to.be.equal(
            liquidatorMUSDCBalanceBeforeLiquidation + liquidatorAmount
          );

          // treasury collateral mToken balance should be higher after liquidation
          expect(treasuryMUSDCBalanceAfterLiquidation).to.be.equal(
            treasuryMUSDCBalanceBeforeLiquidation + liquidationProtocolFeeAmount
          );

          // liquidator underlying collateral token balance should be 0 after liquidation because liquidator received mTokens instead
          expect(liquidatorUSDCBalanceAfterLiquidation).to.be.equal(0n);
        });

        it("Should update token balances correctly when debtToCover < max", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            meldPriceOracle,
            meld,
            usdc,
            owner,
            borrower,
            liquidator,
            treasury,
            oracleAdmin,
          } = await loadFixture(setUpSingleStableBorrowMELDFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR * 1.5);

          // Instantiate debt reserve token contracts
          const meldReserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await meld.getAddress()
            );

          const stableDebtToken = await ethers.getContractAt(
            "StableDebtToken",
            meldReserveTokenAddresses.stableDebtTokenAddress
          );

          // Instantiate collateral reserve token contracts
          const usdcReserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await usdc.getAddress()
            );

          const mUSDC = await ethers.getContractAt(
            "MToken",
            usdcReserveTokenAddresses.mTokenAddress
          );

          // Make sure liquidator has funds with which to liquidate
          const debtToCover = await allocateAndApproveTokens(
            meld,
            owner,
            liquidator,
            lendingPool,
            500n, // less than half of principal debt
            0n
          );

          // Simulate price of collateral (USDC) going down drastically so that position is liquidatable
          // In reality, USDC is not likely to so drastically go down in value, but this is the easist way to
          // get the health factor < 1
          await simulateAssetPriceCrash(usdc, meldPriceOracle, 5n, oracleAdmin);

          // Get token balances before liquidation
          const borrowerStableDebtBalanceBeforeLiquidation =
            await stableDebtToken.balanceOf(borrower.address);
          const borrowerMUSDCBalanceBeforeLiquidation = await mUSDC.balanceOf(
            borrower.address
          );
          const mTokenBalanceBeforeLiquidation = await meld.balanceOf(
            meldReserveTokenAddresses.mTokenAddress
          );
          const liquidatorMUSDCBalanceBeforeLiquidation = await mUSDC.balanceOf(
            liquidator.address
          );
          const treasuryMUSDCBalanceBeforeLiquidation = await mUSDC.balanceOf(
            treasury.address
          );

          // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
          time.setNextBlockTimestamp(await time.latest());

          // Liquidator liquidates partial debt
          await lendingPool.connect(liquidator).liquidationCall(
            await usdc.getAddress(), // collateral asset
            await meld.getAddress(), // debt asset
            borrower.address,
            debtToCover,
            true // receive mToken
          );

          const { liquidationMultiplier, actualLiquidationProtocolFee } =
            await calcLiquidationMultiplierParams(
              usdc,
              lendingPool,
              meldProtocolDataProvider
            );

          const maxLiquidatableCollateral = await calcMaxLiquidatableCollateral(
            usdc,
            meld,
            meldPriceOracle,
            liquidationMultiplier,
            debtToCover
          );

          const liquidationProtocolFeeAmount =
            actualLiquidationProtocolFee.percentMul(maxLiquidatableCollateral);

          const liquidatorAmount =
            maxLiquidatableCollateral - liquidationProtocolFeeAmount;

          // Get token balances after liquidation
          const borrowerStableDebtBalanceAfterLiquidation =
            await stableDebtToken.balanceOf(borrower.address);
          const borrowerMUSDCBalanceAfterLiquidation = await mUSDC.balanceOf(
            borrower.address
          );
          const mTokenBalanceAfterLiquidation = await meld.balanceOf(
            meldReserveTokenAddresses.mTokenAddress
          );
          const liquidatorMUSDCBalanceAfterLiquidation = await mUSDC.balanceOf(
            liquidator.address
          );
          const liquidatorUSDCBalanceAfterLiquidation = await usdc.balanceOf(
            liquidator.address
          );
          const treasuryMUSDCBalanceAfterLiquidation = await mUSDC.balanceOf(
            treasury.address
          );

          // Check token balances //

          // borrower stable debt balance should be lower after liquidation
          expect(borrowerStableDebtBalanceAfterLiquidation).to.be.equal(
            borrowerStableDebtBalanceBeforeLiquidation - debtToCover
          );

          // debt mToken balance should be higher after liquidation
          expect(mTokenBalanceAfterLiquidation).to.be.equal(
            mTokenBalanceBeforeLiquidation + debtToCover
          );

          // borrower collateral mToken balance should be less after liquidation
          expect(borrowerMUSDCBalanceAfterLiquidation).to.be.equal(
            borrowerMUSDCBalanceBeforeLiquidation - maxLiquidatableCollateral
          );

          // liquidator collateral mToken balance should be more after liquidation
          expect(liquidatorMUSDCBalanceAfterLiquidation).to.be.equal(
            liquidatorMUSDCBalanceBeforeLiquidation + liquidatorAmount
          );

          // treasury collateral mToken balance should be higher after liquidation
          expect(treasuryMUSDCBalanceAfterLiquidation).to.be.equal(
            treasuryMUSDCBalanceBeforeLiquidation + liquidationProtocolFeeAmount
          );

          // liquidator underlying collateral token balance should be same after liquidation because liquidator received mTokens, not underlying asset
          expect(liquidatorUSDCBalanceAfterLiquidation).to.be.equal(0n);
        });

        it("Should update token balances correctly when liquidator receives underlying collateral asset", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            meldPriceOracle,
            meld,
            usdc,
            owner,
            borrower,
            liquidator,
            treasury,
            oracleAdmin,
          } = await loadFixture(setUpSingleStableBorrowMELDFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR / 4);

          // Instantiate debt reserve token contracts
          const meldReserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await meld.getAddress()
            );

          const stableDebtToken = await ethers.getContractAt(
            "StableDebtToken",
            meldReserveTokenAddresses.stableDebtTokenAddress
          );

          // Instantiate collateral reserve token contracts
          const usdcReserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await usdc.getAddress()
            );

          const mUSDC = await ethers.getContractAt(
            "MToken",
            usdcReserveTokenAddresses.mTokenAddress
          );

          // Make sure liquidator has funds with which to liquidate
          const debtToCover = await allocateAndApproveTokens(
            meld,
            owner,
            liquidator,
            lendingPool,
            500n, // part of principal debt
            0n
          );

          // Simulate debt token price increase so that debt is liquidatable
          const [currentPrice, success] = await meldPriceOracle.getAssetPrice(
            await meld.getAddress()
          );

          expect(success).to.be.true;

          await meldPriceOracle
            .connect(oracleAdmin)
            .setAssetPrice(await meld.getAddress(), currentPrice * 4n);

          // Get token balances before liquidation
          const borrowerStableDebtBalanceBeforeLiquidation =
            await stableDebtToken.balanceOf(borrower.address);
          const borrowerMUSDCBalanceBeforeLiquidation = await mUSDC.balanceOf(
            borrower.address
          );
          const mTokenBalanceBeforeLiquidation = await meld.balanceOf(
            meldReserveTokenAddresses.mTokenAddress
          );
          const liquidatorUSDCBalanceBeforeLiquidation = await usdc.balanceOf(
            liquidator.address
          );
          const treasuryUSDCBalanceBeforeLiquidation = await usdc.balanceOf(
            treasury.address
          );

          // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
          time.setNextBlockTimestamp(await time.latest());

          // Liquidator liquidates partial debt
          await lendingPool.connect(liquidator).liquidationCall(
            await usdc.getAddress(), // collateral asset
            await meld.getAddress(), // debt asset
            borrower.address,
            debtToCover,
            false // receive mToken
          );

          const { liquidationMultiplier, actualLiquidationProtocolFee } =
            await calcLiquidationMultiplierParams(
              usdc,
              lendingPool,
              meldProtocolDataProvider
            );

          const maxLiquidatableCollateral = await calcMaxLiquidatableCollateral(
            usdc,
            meld,
            meldPriceOracle,
            liquidationMultiplier,
            debtToCover
          );

          const liquidationProtocolFeeAmount =
            actualLiquidationProtocolFee.percentMul(maxLiquidatableCollateral);

          const liquidatorAmount =
            maxLiquidatableCollateral - liquidationProtocolFeeAmount;

          // Get token balances after liquidation
          const borrowerStableDebtBalanceAfterLiquidation =
            await stableDebtToken.balanceOf(borrower.address);
          const borrowerMUSDCBalanceAfterLiquidation = await mUSDC.balanceOf(
            borrower.address
          );
          const mTokenBalanceAfterLiquidation = await meld.balanceOf(
            meldReserveTokenAddresses.mTokenAddress
          );
          const liquidatorMUSDCBalanceAfterLiquidation = await mUSDC.balanceOf(
            liquidator.address
          );
          const liquidatorUSDCBalanceAfterLiquidation = await usdc.balanceOf(
            liquidator.address
          );
          const treasuryUSDCBalanceAfterLiquidation = await usdc.balanceOf(
            treasury.address
          );

          // Check token balances //

          // borrower stable debt balance should be lower after liquidation
          expect(borrowerStableDebtBalanceAfterLiquidation).to.be.equal(
            borrowerStableDebtBalanceBeforeLiquidation - debtToCover
          );

          // debt mToken balance should be higher after liquidation
          expect(mTokenBalanceAfterLiquidation).to.be.equal(
            mTokenBalanceBeforeLiquidation + debtToCover
          );

          // borrower collateral mToken balance should be the lower
          expect(borrowerMUSDCBalanceAfterLiquidation).to.be.equal(
            borrowerMUSDCBalanceBeforeLiquidation - maxLiquidatableCollateral
          );

          // liquidator collateral mToken balance should be 0 because liquidator receives underlying collateral asset instead of mToken
          expect(liquidatorMUSDCBalanceAfterLiquidation).to.be.equal(0n);

          // liquidator underlying collateral token balance should be higher after liquidation
          expect(liquidatorUSDCBalanceAfterLiquidation).to.be.equal(
            liquidatorUSDCBalanceBeforeLiquidation + liquidatorAmount
          );

          // treasury underlying collateral token balance should be higher after liquidation
          expect(treasuryUSDCBalanceAfterLiquidation).to.be.equal(
            treasuryUSDCBalanceBeforeLiquidation + liquidationProtocolFeeAmount
          );
        });

        it("Should calculate correct stake amount when  Regular user liquidates whole balance of a yield boost token for a regular user", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meldPriceOracle,
            addressesProvider,
            meld,
            usdc,
            owner,
            borrower,
            liquidator,
            treasury,
            oracleAdmin,
            rewardsSetter,
            yieldBoostStorageUSDC,
            yieldBoostStakingUSDC,
          } = await loadFixture(setUpSingleStableBorrowMELDFixture);

          // Yield boost token (USDC) is collateral token
          // Non-yield boost token (MELD) is debt token

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

          // Liquidator deposits USDC collateral (ensures liquidator has a balance of USDC mTokens)
          const depositAmountUSDC = await allocateAndApproveTokens(
            usdc,
            owner,
            liquidator,
            lendingPool,
            500n,
            0n
          );

          await lendingPool
            .connect(liquidator)
            .deposit(
              await usdc.getAddress(),
              depositAmountUSDC,
              liquidator.address,
              true,
              0
            );

          // Instantiate debt reserve token contracts
          const meldReserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await meld.getAddress()
            );

          const mMELD = await ethers.getContractAt(
            "MToken",
            meldReserveTokenAddresses.mTokenAddress
          );

          const stableDebtToken = await ethers.getContractAt(
            "StableDebtToken",
            meldReserveTokenAddresses.stableDebtTokenAddress
          );

          const variableDebtToken = await ethers.getContractAt(
            "VariableDebtToken",
            meldReserveTokenAddresses.variableDebtTokenAddress
          );

          // Instantiate collateral reserve token contracts
          const usdcReserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await usdc.getAddress()
            );

          const mUSDC = await ethers.getContractAt(
            "MToken",
            usdcReserveTokenAddresses.mTokenAddress
          );

          // Make sure liquidator has funds with which to liquidate
          await allocateAndApproveTokens(
            meld,
            owner,
            liquidator,
            lendingPool,
            2500n,
            0n
          );

          // Simulate debt token price increase so that debt is liquidatable
          const [currentPrice, success] = await meldPriceOracle.getAssetPrice(
            await meld.getAddress()
          );

          expect(success).to.be.true;

          await meldPriceOracle
            .connect(oracleAdmin)
            .setAssetPrice(await meld.getAddress(), currentPrice * 4n);

          // Get borrower MELD reserve data before liquidation
          const borrowerMELDDataBeforeLiquidation: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              borrower.address
            );

          // Get borrower USDC reserve data before liquidation
          const borrowerUSDCDataBeforeLiquidation: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              borrower.address
            );

          const liquidatorMTokenBalanceBeforeLiquidation =
            await mUSDC.balanceOf(liquidator.address);

          // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
          time.setNextBlockTimestamp(await time.latest());

          // Liquidator liquidates all liquidatable debt (up to close factor)
          const liquidationTx = await lendingPool
            .connect(liquidator)
            .liquidationCall(
              await usdc.getAddress(), // collateral asset
              await meld.getAddress(), // debt asset
              borrower.address,
              MaxUint256, // flag for all liquidatable debt
              true // receive mToken
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(liquidationTx);

          // Get USDC reserve data after liquidation
          const usdcReserveDataAfterLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Get borrower USDC reserve data after liquidation
          const borrowerUSDCDataAfterLiquidation: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              borrower.address
            );

          const expectedIncrease =
            borrowerMELDDataBeforeLiquidation.currentStableDebt -
            borrowerMELDDataBeforeLiquidation.principalStableDebt;

          const maxLiquidatableDebt = (
            borrowerMELDDataBeforeLiquidation.currentStableDebt +
            borrowerMELDDataBeforeLiquidation.currentVariableDebt
          ).percentMul(LIQUIDATION_CLOSE_FACTOR_PERCENT);

          // Check that the correct events were emitted //

          await expect(liquidationTx)
            .to.emit(stableDebtToken, "Transfer")
            .withArgs(borrower.address, ZeroAddress, maxLiquidatableDebt);

          await expect(liquidationTx)
            .to.emit(stableDebtToken, "Burn")
            .withArgs(
              borrower.address,
              maxLiquidatableDebt - expectedIncrease,
              borrowerMELDDataBeforeLiquidation.currentStableDebt,
              expectedIncrease,
              anyUint,
              anyUint
            );

          await expect(liquidationTx).to.not.emit(stableDebtToken, "Mint"); // expected increase too low
          await expect(liquidationTx).to.not.emit(
            variableDebtToken,
            "Transfer"
          ); // not liquidating variable debt
          await expect(liquidationTx).to.not.emit(variableDebtToken, "Burn"); // not liquidating variable debt

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          // The important thing here is checking that the event is emitted for the debt token. The values are checked in other test files.
          await expect(liquidationTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await meld.getAddress(),
              anyUint,
              anyUint,
              anyUint,
              anyUint,
              anyUint
            );

          // No mint to treasury because debt token has reserFactor == 0
          await expect(liquidationTx).to.not.emit(mMELD, "Transfer");
          await expect(liquidationTx).to.not.emit(mMELD, "Mint");

          const { liquidationMultiplier, actualLiquidationProtocolFee } =
            await calcLiquidationMultiplierParams(
              usdc,
              lendingPool,
              meldProtocolDataProvider
            );

          const maxLiquidatableCollateral = await calcMaxLiquidatableCollateral(
            usdc,
            meld,
            meldPriceOracle,
            liquidationMultiplier,
            maxLiquidatableDebt
          );

          const liquidationProtocolFeeAmount =
            actualLiquidationProtocolFee.percentMul(maxLiquidatableCollateral);

          const liquidatorAmount =
            maxLiquidatableCollateral - liquidationProtocolFeeAmount;

          // Events emitted when liquidator receives collateral mToken
          const liquidityIndex = calcExpectedReserveNormalizedIncome(
            usdcReserveDataAfterLiquidation,
            blockTimestamps.txTimestamp
          );

          await expect(liquidationTx)
            .to.emit(mUSDC, "BalanceTransfer")
            .withArgs(
              borrower.address,
              treasury.address,
              liquidationProtocolFeeAmount,
              liquidityIndex
            );

          await expect(liquidationTx)
            .to.emit(mUSDC, "BalanceTransfer")
            .withArgs(
              borrower.address,
              liquidator.address,
              liquidatorAmount,
              liquidityIndex
            );

          await expect(liquidationTx)
            .to.emit(mUSDC, "Transfer")
            .withArgs(
              borrower.address,
              treasury.address,
              liquidationProtocolFeeAmount
            );

          await expect(liquidationTx)
            .to.emit(mUSDC, "Transfer")
            .withArgs(borrower.address, liquidator.address, liquidatorAmount);

          // liquidator chose mTokens instead of underlying collateral asset
          await expect(liquidationTx).to.not.emit(usdc, "Transfer");

          // Event emitted when debt token is transferred from liquidator to pay off debt
          await expect(liquidationTx)
            .to.emit(meld, "Transfer")
            .withArgs(
              liquidator.address,
              await mMELD.getAddress(),
              maxLiquidatableDebt
            );

          // ReserveUsedAsCollateralDisabled and ReserveUsedAsCollateralEnabled Events are emitted by library LiquidationLogic.sol,
          // so we need to get the contract instance with the LiquidationLogic ABI
          const contractInstanceWithLogicLibraryABI =
            await ethers.getContractAt(
              "LiquidationLogic",
              await lendingPool.getAddress(),
              owner
            );

          await expect(liquidationTx).to.not.emit(
            contractInstanceWithLogicLibraryABI,
            "ReserveUsedAsCollateralDisabled"
          ); // borrower's balance of collateral mTokens did not go to 0
          await expect(liquidationTx).to.not.emit(
            contractInstanceWithLogicLibraryABI,
            "ReserveUsedAsCollateralEnabled"
          ); // liquidator already had balance of collateral mTokens

          await expect(liquidationTx)
            .to.emit(contractInstanceWithLogicLibraryABI, "LiquidationCall")
            .withArgs(
              await usdc.getAddress(),
              await meld.getAddress(),
              borrower.address,
              maxLiquidatableDebt,
              maxLiquidatableCollateral,
              liquidator.address,
              true
            );

          // Borrower
          // borrower gets the regular user yield boost multiplier for the deposited USDC collateral
          const yieldBoostMultiplier = await lendingPool.yieldBoostMultipliers(
            MeldBankerType.NONE,
            Action.DEPOSIT
          );

          const expectedBorrowerOldStakedAmount = (
            borrowerUSDCDataBeforeLiquidation.currentMTokenBalance -
            liquidationProtocolFeeAmount
          ).percentMul(yieldBoostMultiplier);

          // Interest has accrued, so can't use the borrowed amount
          const expectedBorrowerNewStakedAmount =
            borrowerUSDCDataAfterLiquidation.currentMTokenBalance.percentMul(
              yieldBoostMultiplier
            );

          await expect(liquidationTx)
            .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
            .withArgs(
              borrower.address,
              expectedBorrowerOldStakedAmount,
              expectedBorrowerNewStakedAmount
            );

          // Borrower still has some collateral left
          await expect(liquidationTx).to.not.emit(
            yieldBoostStakingUSDC,
            "StakePositionRemoved"
          );

          await expect(liquidationTx).to.not.emit(
            yieldBoostStakingUSDC,
            "RewardsClaimed"
          );

          await expect(liquidationTx)
            .to.emit(lendingPool, "RefreshYieldBoostAmount")
            .withArgs(
              await usdc.getAddress(),
              borrower.address,
              expectedBorrowerNewStakedAmount
            );

          await expect(liquidationTx).to.not.emit(
            lendingPool,
            "UnlockMeldBankerNFT"
          );

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
          ).to.equal(expectedBorrowerNewStakedAmount);

          // Liquidator gets mDAI transferred, which is  a yield boost token
          // Liquidator gets treated like a regular user because there is no actual deposit with a MELD Banker NFT tokenId
          const liquidaterMeldBankerData = await lendingPool.userMeldBankerData(
            liquidator.address
          );

          // Liquidator and treasury are regular users and gets mTokens, which is the same as doing a deposit
          const yieldBoostMultiplierRegularUserDeposit =
            await lendingPool.yieldBoostMultipliers(
              MeldBankerType.NONE,
              Action.DEPOSIT
            );

          const expectedLiquidatorStakedAmount = (
            liquidatorMTokenBalanceBeforeLiquidation +
            maxLiquidatableCollateral -
            liquidationProtocolFeeAmount
          ).percentMul(yieldBoostMultiplierRegularUserDeposit);

          // Liquidator already had some mUSDC, so no StakePositionCreated for liquidater.
          // Can't test for this because StakePositionCreated gets emitted for the treasury in the same transaction

          await expect(liquidationTx)
            .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
            .withArgs(
              liquidator.address,
              liquidatorMTokenBalanceBeforeLiquidation,
              expectedLiquidatorStakedAmount
            );

          await expect(liquidationTx)
            .to.emit(lendingPool, "RefreshYieldBoostAmount")
            .withArgs(
              await usdc.getAddress(),
              liquidator.address,
              expectedLiquidatorStakedAmount
            );

          expect(liquidaterMeldBankerData.tokenId).to.equal(0n);
          expect(liquidaterMeldBankerData.asset).to.equal(ZeroAddress);
          expect(liquidaterMeldBankerData.meldBankerType).to.equal(
            MeldBankerType.NONE
          );
          expect(liquidaterMeldBankerData.action).to.equal(Action.NONE);

          expect(
            await yieldBoostStorageUSDC.getStakerStakedAmount(
              liquidator.address
            )
          ).to.equal(expectedLiquidatorStakedAmount);

          // Treasury
          const expectedTreasuryStakedAmount =
            liquidationProtocolFeeAmount.percentMul(
              yieldBoostMultiplierRegularUserDeposit
            );

          await expect(liquidationTx)
            .to.emit(yieldBoostStakingUSDC, "StakePositionCreated")
            .withArgs(treasury.address, expectedTreasuryStakedAmount);

          await expect(liquidationTx)
            .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
            .withArgs(treasury.address, 0n, expectedTreasuryStakedAmount);

          await expect(liquidationTx)
            .to.emit(lendingPool, "RefreshYieldBoostAmount")
            .withArgs(
              await usdc.getAddress(),
              treasury.address,
              expectedTreasuryStakedAmount
            );

          const treasuryMeldBankerData = await lendingPool.userMeldBankerData(
            treasury.address
          );

          expect(treasuryMeldBankerData.tokenId).to.equal(0n);
          expect(treasuryMeldBankerData.asset).to.equal(ZeroAddress);
          expect(treasuryMeldBankerData.meldBankerType).to.equal(
            MeldBankerType.NONE
          );
          expect(treasuryMeldBankerData.action).to.equal(Action.NONE);

          expect(
            await yieldBoostStorageUSDC.getStakerStakedAmount(treasury.address)
          ).to.equal(expectedTreasuryStakedAmount);
        });

        it("Should calculate correct stake amount when  Regular user liquidates partial balance of a yield boost token for a regular user", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meldPriceOracle,
            addressesProvider,
            meld,
            usdc,
            owner,
            borrower,
            liquidator,
            treasury,
            oracleAdmin,
            rewardsSetter,
            yieldBoostStorageUSDC,
            yieldBoostStakingUSDC,
          } = await loadFixture(setUpSingleStableBorrowMELDFixture);

          // Yield boost token (USDC) is collateral token
          // Non-yield boost token (MELD) is debt token

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

          // Instantiate debt reserve token contracts
          const meldReserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await meld.getAddress()
            );

          const mMELD = await ethers.getContractAt(
            "MToken",
            meldReserveTokenAddresses.mTokenAddress
          );

          const stableDebtToken = await ethers.getContractAt(
            "StableDebtToken",
            meldReserveTokenAddresses.stableDebtTokenAddress
          );

          const variableDebtToken = await ethers.getContractAt(
            "VariableDebtToken",
            meldReserveTokenAddresses.variableDebtTokenAddress
          );

          // Instantiate collateral reserve token contracts
          const usdcReserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await usdc.getAddress()
            );

          const mUSDC = await ethers.getContractAt(
            "MToken",
            usdcReserveTokenAddresses.mTokenAddress
          );

          // Make sure liquidator has funds with which to liquidate
          const debtToCover = await allocateAndApproveTokens(
            meld,
            owner,
            liquidator,
            lendingPool,
            1000n, // half of principal debt
            0n
          );

          // Simulate debt token price increase so that debt is liquidatable
          const [currentPrice, success] = await meldPriceOracle.getAssetPrice(
            await meld.getAddress()
          );

          expect(success).to.be.true;

          await meldPriceOracle
            .connect(oracleAdmin)
            .setAssetPrice(await meld.getAddress(), currentPrice * 4n);

          // Get borrower MELD reserve data before liquidation
          const borrowerMELDDataBeforeLiquidation: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              borrower.address
            );

          // Get borrower USDC reserve data before liquidation
          const borrowerUSDCDataBeforeLiquidation: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              borrower.address
            );

          const liquidatorMTokenBalanceBeforeLiquidation =
            await mUSDC.balanceOf(liquidator.address);

          // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
          time.setNextBlockTimestamp(await time.latest());

          // Liquidator liquidates partial debt
          const liquidationTx = await lendingPool
            .connect(liquidator)
            .liquidationCall(
              await usdc.getAddress(), // collateral asset
              await meld.getAddress(), // debt asset
              borrower.address,
              debtToCover,
              true // receive mToken
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(liquidationTx);

          // Get USDC reserve data after liquidation
          const usdcReserveDataAfterLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Get borrower USDC reserve data after liquidation
          const borrowerUSDCDataAfterLiquidation: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              borrower.address
            );

          const expectedIncrease =
            borrowerMELDDataBeforeLiquidation.currentStableDebt -
            borrowerMELDDataBeforeLiquidation.principalStableDebt;

          // Check that the correct events were emitted //

          await expect(liquidationTx)
            .to.emit(stableDebtToken, "Transfer")
            .withArgs(borrower.address, ZeroAddress, debtToCover);

          await expect(liquidationTx)
            .to.emit(stableDebtToken, "Burn")
            .withArgs(
              borrower.address,
              debtToCover - expectedIncrease,
              borrowerMELDDataBeforeLiquidation.currentStableDebt,
              expectedIncrease,
              anyUint,
              anyUint
            );

          await expect(liquidationTx).to.not.emit(stableDebtToken, "Mint"); // expected increase too low
          await expect(liquidationTx).to.not.emit(
            variableDebtToken,
            "Transfer"
          ); // not liquidating variable debt
          await expect(liquidationTx).to.not.emit(variableDebtToken, "Burn"); // not liquidating variable debt

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          // The important thing here is checking that the event is emitted for the debt token. The values are checked in other test files.
          await expect(liquidationTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await meld.getAddress(),
              anyUint,
              anyUint,
              anyUint,
              anyUint,
              anyUint
            );

          // No mint to treasury because debt token has reserFactor == 0
          await expect(liquidationTx).to.not.emit(mMELD, "Transfer");
          await expect(liquidationTx).to.not.emit(mMELD, "Mint");

          const { liquidationMultiplier, actualLiquidationProtocolFee } =
            await calcLiquidationMultiplierParams(
              usdc,
              lendingPool,
              meldProtocolDataProvider
            );

          const maxLiquidatableCollateral = await calcMaxLiquidatableCollateral(
            usdc,
            meld,
            meldPriceOracle,
            liquidationMultiplier,
            debtToCover
          );

          const liquidationProtocolFeeAmount =
            actualLiquidationProtocolFee.percentMul(maxLiquidatableCollateral);

          const liquidatorAmount =
            maxLiquidatableCollateral - liquidationProtocolFeeAmount;

          // Events emitted when liquidator receives collateral mToken
          const liquidityIndex = calcExpectedReserveNormalizedIncome(
            usdcReserveDataAfterLiquidation,
            blockTimestamps.txTimestamp
          );

          await expect(liquidationTx)
            .to.emit(mUSDC, "BalanceTransfer")
            .withArgs(
              borrower.address,
              treasury.address,
              liquidationProtocolFeeAmount,
              liquidityIndex
            );

          await expect(liquidationTx)
            .to.emit(mUSDC, "BalanceTransfer")
            .withArgs(
              borrower.address,
              liquidator.address,
              liquidatorAmount,
              liquidityIndex
            );

          await expect(liquidationTx)
            .to.emit(mUSDC, "Transfer")
            .withArgs(
              borrower.address,
              treasury.address,
              liquidationProtocolFeeAmount
            );

          await expect(liquidationTx)
            .to.emit(mUSDC, "Transfer")
            .withArgs(borrower.address, liquidator.address, liquidatorAmount);

          // liquidator chose mTokens instead of underlying collateral asset
          await expect(liquidationTx).to.not.emit(usdc, "Transfer");

          // Event emitted when debt token is transferred from liquidator to pay off debt
          await expect(liquidationTx)
            .to.emit(meld, "Transfer")
            .withArgs(
              liquidator.address,
              await mMELD.getAddress(),
              debtToCover
            );

          // ReserveUsedAsCollateralDisabled, ReserveUsedAsCollateralEnabled, and LiquidationCall events are emitted by library LiquidationLogic.sol,
          // so we need to get the contract instance with the LiquidationLogic ABI
          const contractInstanceWithLogicLibraryABI =
            await ethers.getContractAt(
              "LiquidationLogic",
              await lendingPool.getAddress(),
              owner
            );

          // Event emitted when collateral token is set as collateral for liquidator because liquidator previously had 0 balance
          await expect(liquidationTx)
            .to.emit(
              contractInstanceWithLogicLibraryABI,
              "ReserveUsedAsCollateralEnabled"
            )
            .withArgs(await usdc.getAddress(), liquidator.address);

          // borrower's balance of collateral mTokens did not go to 0
          await expect(liquidationTx).to.not.emit(
            contractInstanceWithLogicLibraryABI,
            "ReserveUsedAsCollateralDisabled"
          );

          // liquidator liquidates partial debt
          await expect(liquidationTx)
            .to.emit(contractInstanceWithLogicLibraryABI, "LiquidationCall")
            .withArgs(
              await usdc.getAddress(),
              await meld.getAddress(),
              borrower.address,
              debtToCover,
              maxLiquidatableCollateral,
              liquidator.address,
              true
            );

          // Borrower

          // borrower gets the regular user yield boost multiplier for the deposited USDC collateral
          const yieldBoostMultiplier = await lendingPool.yieldBoostMultipliers(
            MeldBankerType.NONE,
            Action.DEPOSIT
          );

          const expectedBorrowerOldStakedAmount = (
            borrowerUSDCDataBeforeLiquidation.currentMTokenBalance -
            liquidationProtocolFeeAmount
          ).percentMul(yieldBoostMultiplier);

          const borrowerDataAfter = await lendingPool.userMeldBankerData(
            borrower.address
          );

          // Interest has accrued, so can't use the borrowed amount
          const expectedBorrowerNewStakedAmount =
            borrowerUSDCDataAfterLiquidation.currentMTokenBalance.percentMul(
              yieldBoostMultiplier
            );

          await expect(liquidationTx)
            .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
            .withArgs(
              borrower.address,
              expectedBorrowerOldStakedAmount,
              expectedBorrowerNewStakedAmount
            );

          await expect(liquidationTx).to.not.emit(
            yieldBoostStakingUSDC,
            "StakePositionRemoved"
          );

          await expect(liquidationTx).to.not.emit(
            yieldBoostStakingUSDC,
            "RewardsClaimed"
          );

          await expect(liquidationTx)
            .to.emit(lendingPool, "RefreshYieldBoostAmount")
            .withArgs(
              await usdc.getAddress(),
              borrower.address,
              expectedBorrowerNewStakedAmount
            );

          expect(await lendingPool.isUsingMeldBanker(borrower.address)).to.be
            .false;

          expect(await lendingPool.isMeldBankerBlocked(0n)).to.be.false;

          expect(borrowerDataAfter.tokenId).to.equal(0n);
          expect(borrowerDataAfter.asset).to.equal(ZeroAddress);
          expect(borrowerDataAfter.meldBankerType).to.equal(
            MeldBankerType.NONE
          );
          expect(borrowerDataAfter.action).to.equal(Action.NONE);

          expect(
            await yieldBoostStorageUSDC.getStakerStakedAmount(borrower.address)
          ).to.equal(expectedBorrowerNewStakedAmount);

          // Liquidator gets mUSDC transferred, which is  a yield boost token
          // Liquidator gets treated like a regular user because there is no actual deposit with a MELD Banker NFT tokenId
          const liquidaterMeldBankerData = await lendingPool.userMeldBankerData(
            liquidator.address
          );

          // Liquidator and treasury are regular users and gets mTokens, which is the same as doing a deposit
          const yieldBoostMultiplierRegularUserDeposit =
            await lendingPool.yieldBoostMultipliers(
              MeldBankerType.NONE,
              Action.DEPOSIT
            );

          const expectedLiquidatorStakedAmount = (
            liquidatorMTokenBalanceBeforeLiquidation +
            maxLiquidatableCollateral -
            liquidationProtocolFeeAmount
          ).percentMul(yieldBoostMultiplierRegularUserDeposit);

          await expect(liquidationTx)
            .to.emit(yieldBoostStakingUSDC, "StakePositionCreated")
            .withArgs(liquidator.address, expectedLiquidatorStakedAmount);

          await expect(liquidationTx)
            .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
            .withArgs(liquidator.address, 0n, expectedLiquidatorStakedAmount);

          await expect(liquidationTx)
            .to.emit(lendingPool, "RefreshYieldBoostAmount")
            .withArgs(
              await usdc.getAddress(),
              liquidator.address,
              expectedLiquidatorStakedAmount
            );

          expect(liquidaterMeldBankerData.tokenId).to.equal(0n);
          expect(liquidaterMeldBankerData.asset).to.equal(ZeroAddress);
          expect(liquidaterMeldBankerData.meldBankerType).to.equal(
            MeldBankerType.NONE
          );
          expect(liquidaterMeldBankerData.action).to.equal(Action.NONE);

          expect(
            await yieldBoostStorageUSDC.getStakerStakedAmount(
              liquidator.address
            )
          ).to.equal(expectedLiquidatorStakedAmount);

          // Treasury
          const expectedTreasuryStakedAmount =
            liquidationProtocolFeeAmount.percentMul(
              yieldBoostMultiplierRegularUserDeposit
            );

          await expect(liquidationTx)
            .to.emit(yieldBoostStakingUSDC, "StakePositionCreated")
            .withArgs(treasury.address, expectedTreasuryStakedAmount);

          await expect(liquidationTx)
            .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
            .withArgs(treasury.address, 0n, expectedTreasuryStakedAmount);

          await expect(liquidationTx)
            .to.emit(lendingPool, "RefreshYieldBoostAmount")
            .withArgs(
              await usdc.getAddress(),
              treasury.address,
              expectedTreasuryStakedAmount
            );

          const treasuryMeldBankerData = await lendingPool.userMeldBankerData(
            treasury.address
          );

          expect(treasuryMeldBankerData.tokenId).to.equal(0n);
          expect(treasuryMeldBankerData.asset).to.equal(ZeroAddress);
          expect(treasuryMeldBankerData.meldBankerType).to.equal(
            MeldBankerType.NONE
          );
          expect(treasuryMeldBankerData.action).to.equal(Action.NONE);

          expect(
            await yieldBoostStorageUSDC.getStakerStakedAmount(treasury.address)
          ).to.equal(expectedTreasuryStakedAmount);
        });

        it("Should return correct values when making a static call", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            meldPriceOracle,
            meld,
            usdc,
            owner,
            borrower,
            liquidator,
            oracleAdmin,
          } = await loadFixture(setUpSingleStableBorrowMELDFixture);
          // This test case also tests the scenario where the liquidator receives mTokens instead of the underlying collateral asset and already has mTokens

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR / 2);

          // Make sure liquidator has funds with which to liquidate
          const debtToCover = await allocateAndApproveTokens(
            meld,
            owner,
            liquidator,
            lendingPool,
            1000n, // half of principal debt
            0n
          );

          // Simulate debt token price increase so that debt is liquidatable
          const [currentPrice, success] = await meldPriceOracle.getAssetPrice(
            await meld.getAddress()
          );

          expect(success).to.be.true;

          await meldPriceOracle
            .connect(oracleAdmin)
            .setAssetPrice(await meld.getAddress(), currentPrice * 4n);

          // Liquidator liquidates partial debt
          const returnedValues = await lendingPool
            .connect(liquidator)
            .liquidationCall.staticCall(
              await usdc.getAddress(), // collateral asset
              await meld.getAddress(), // debt asset
              borrower.address,
              debtToCover,
              true // receive mToken
            );

          const { liquidationMultiplier } =
            await calcLiquidationMultiplierParams(
              usdc,
              lendingPool,
              meldProtocolDataProvider
            );

          const maxLiquidatableCollateral = await calcMaxLiquidatableCollateral(
            usdc,
            meld,
            meldPriceOracle,
            liquidationMultiplier,
            debtToCover
          );

          expect(returnedValues[0]).to.equal(debtToCover);
          expect(returnedValues[1]).to.equal(maxLiquidatableCollateral);

          const estimatedGas = await lendingPool
            .connect(liquidator)
            .liquidationCall.estimateGas(
              await usdc.getAddress(), // collateral asset
              await meld.getAddress(), // debt asset
              borrower.address,
              debtToCover,
              true // receive mToken
            );

          expect(estimatedGas).to.be.gt(0);
        });
      }); // End Liquidate Stable Debt

      context("Liquidate Variable Debt", async function () {
        // These test cases have MELD as the collateral token and USDC as the debt token
        // Principal debt is 400 USDC and collateral is 1500 MELD for all test cases in this context.
        it("Should emit correct events when liquidator receives collateral mToken and previously had collateral mToken balance of 0", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meldPriceOracle,
            meld,
            usdc,
            owner,
            borrower2,
            liquidator,
            treasury,
            oracleAdmin,
          } = await loadFixture(setUpSingleVariableBorrowUSDCFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR / 12);

          // Instantiate collateral reserve token contracts
          const meldReserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await meld.getAddress()
            );

          const mMELD = await ethers.getContractAt(
            "MToken",
            meldReserveTokenAddresses.mTokenAddress
          );

          // Instantiate debt reserve token contracts
          const usdcReserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await usdc.getAddress()
            );

          const mUSDC = await ethers.getContractAt(
            "MToken",
            usdcReserveTokenAddresses.mTokenAddress
          );

          const stableDebtToken = await ethers.getContractAt(
            "StableDebtToken",
            usdcReserveTokenAddresses.stableDebtTokenAddress
          );

          const variableDebtToken = await ethers.getContractAt(
            "VariableDebtToken",
            usdcReserveTokenAddresses.variableDebtTokenAddress
          );

          // Make sure liquidator has funds with which to liquidate
          const debtToCover = await allocateAndApproveTokens(
            usdc,
            owner,
            liquidator,
            lendingPool,
            150n, //part of principal debt
            0n
          );

          // Simulate price of collateral (MELD) going down drastically so that position is liquidatable
          await simulateAssetPriceCrash(meld, meldPriceOracle, 2n, oracleAdmin);

          // Get USDC reserve data before liquidation
          const usdcReserveDataBeforeLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Liquidator liquidates partial debt
          const liquidationTx = await lendingPool
            .connect(liquidator)
            .liquidationCall(
              await meld.getAddress(), // collateral asset
              await usdc.getAddress(), // debt asset
              borrower2.address,
              debtToCover,
              true // receive mToken
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(liquidationTx);

          // Get USDC reserve data after liquidation
          const usdcReserveDataAfterLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Get MELD reserve data after liquidation
          const meldReserveDataAfterLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await meld.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Check that the correct events were emitted //

          await expect(liquidationTx)
            .to.emit(variableDebtToken, "Transfer")
            .withArgs(borrower2.address, ZeroAddress, debtToCover);

          await expect(liquidationTx)
            .to.emit(variableDebtToken, "Burn")
            .withArgs(
              borrower2.address,
              debtToCover,
              usdcReserveDataAfterLiquidation.variableBorrowIndex
            );

          await expect(liquidationTx).to.not.emit(stableDebtToken, "Transfer"); // not liquidating stable debt
          await expect(liquidationTx).to.not.emit(stableDebtToken, "Burn"); // not liquidating stable debt
          await expect(liquidationTx).to.not.emit(stableDebtToken, "Mint"); // not liquidating stable debt

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          // The important thing here is checking that the event is emitted for the debt token. The values are checked in other test files.
          await expect(liquidationTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await usdc.getAddress(),
              anyUint,
              anyUint,
              anyUint,
              anyUint,
              anyUint
            );

          // Mint to treasury because debt token (USDC) has reserveFactor > 0 and debt has accrued
          const currentVariableDebt =
            usdcReserveDataBeforeLiquidation.totalVariableDebt; // accrued
          const previousVariableDebt =
            usdcReserveDataBeforeLiquidation.scaledVariableDebt; // principal
          const currentStableDebt = BigInt(0); // no stable debt
          const previousStableDebt = BigInt(0); // no stable debt

          const totalDebtAccrued =
            currentVariableDebt +
            currentStableDebt -
            previousVariableDebt -
            previousStableDebt;

          const { reserveFactor } =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await usdc.getAddress()
            );
          const amountToMint = totalDebtAccrued.percentMul(
            BigInt(reserveFactor)
          );

          await expect(liquidationTx)
            .to.emit(mUSDC, "Transfer")
            .withArgs(
              ZeroAddress,
              treasury.address,
              isAlmostEqual(amountToMint)
            );

          await expect(liquidationTx)
            .to.emit(mUSDC, "Mint")
            .withArgs(
              treasury.address,
              isAlmostEqual(amountToMint),
              usdcReserveDataAfterLiquidation.liquidityIndex
            );

          const { liquidationMultiplier, actualLiquidationProtocolFee } =
            await calcLiquidationMultiplierParams(
              meld,
              lendingPool,
              meldProtocolDataProvider
            );

          const maxLiquidatableCollateral = await calcMaxLiquidatableCollateral(
            meld,
            usdc,
            meldPriceOracle,
            liquidationMultiplier,
            debtToCover
          );

          const liquidationProtocolFeeAmount =
            actualLiquidationProtocolFee.percentMul(maxLiquidatableCollateral);

          const liquidatorAmount =
            maxLiquidatableCollateral - liquidationProtocolFeeAmount;

          // Events emitted when liquidator receives collateral mToken
          const liquidityIndex = calcExpectedReserveNormalizedIncome(
            meldReserveDataAfterLiquidation,
            blockTimestamps.txTimestamp
          );

          await expect(liquidationTx)
            .to.emit(mMELD, "BalanceTransfer")
            .withArgs(
              borrower2.address,
              treasury.address,
              liquidationProtocolFeeAmount,
              liquidityIndex
            );

          await expect(liquidationTx)
            .to.emit(mMELD, "BalanceTransfer")
            .withArgs(
              borrower2.address,
              liquidator.address,
              liquidatorAmount,
              liquidityIndex
            );

          await expect(liquidationTx)
            .to.emit(mMELD, "Transfer")
            .withArgs(
              borrower2.address,
              treasury.address,
              liquidationProtocolFeeAmount
            );

          await expect(liquidationTx)
            .to.emit(mMELD, "Transfer")
            .withArgs(borrower2.address, liquidator.address, liquidatorAmount);

          // liquidator chose mTokens instead of underlying collateral asset
          await expect(liquidationTx).to.not.emit(meld, "Transfer");

          // Event emitted when debt token is transferred from liquidator to pay off debt
          await expect(liquidationTx)
            .to.emit(usdc, "Transfer")
            .withArgs(
              liquidator.address,
              await mUSDC.getAddress(),
              debtToCover
            );

          // ReserveUsedAsCollateralDisabled and  ReserveUsedAsCollateralEnabled Events are defined in library LiquidationLogic.sol,
          // so we need to get the contract instance with the LiquidationLogic ABI
          const contractInstanceWithLogicLibraryABI =
            await ethers.getContractAt(
              "LiquidationLogic",
              await lendingPool.getAddress(),
              owner
            );

          // Event emitted when collateral token is set as collateral for liquidator because liquidator previously had 0 balance
          await expect(liquidationTx)
            .to.emit(
              contractInstanceWithLogicLibraryABI,
              "ReserveUsedAsCollateralEnabled"
            )
            .withArgs(await meld.getAddress(), liquidator.address);

          // borrower2's balance of collateral mTokens did not go to 0
          await expect(liquidationTx).to.not.emit(
            contractInstanceWithLogicLibraryABI,
            "ReserveUsedAsCollateralDisabled"
          );

          // liquidator liquidates partial debt
          await expect(liquidationTx)
            .to.emit(contractInstanceWithLogicLibraryABI, "LiquidationCall")
            .withArgs(
              await meld.getAddress(),
              await usdc.getAddress(),
              borrower2.address,
              debtToCover,
              maxLiquidatableCollateral,
              liquidator.address,
              true
            );
        });

        it("Should emit correct events when liquidator receives collateral mToken and previously had a balance of collateral mTokens", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meldPriceOracle,
            meld,
            usdc,
            owner,
            borrower2,
            liquidator,
            treasury,
            oracleAdmin,
          } = await loadFixture(setUpSingleVariableBorrowUSDCFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR);

          // Liquidator deposits MELD collateral (ensures liquidator has a balance of MELD mTokens)
          const depositAmountMELD = await allocateAndApproveTokens(
            meld,
            owner,
            liquidator,
            lendingPool,
            500n,
            0n
          );

          await lendingPool
            .connect(liquidator)
            .deposit(
              await meld.getAddress(),
              depositAmountMELD,
              liquidator.address,
              true,
              0
            );

          // Instantiate collateral reserve token contracts
          const meldReserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await meld.getAddress()
            );

          const mMELD = await ethers.getContractAt(
            "MToken",
            meldReserveTokenAddresses.mTokenAddress
          );

          // Instantiate debt reserve token contracts
          const usdcReserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await usdc.getAddress()
            );

          const mUSDC = await ethers.getContractAt(
            "MToken",
            usdcReserveTokenAddresses.mTokenAddress
          );

          const stableDebtToken = await ethers.getContractAt(
            "StableDebtToken",
            usdcReserveTokenAddresses.stableDebtTokenAddress
          );

          const variableDebtToken = await ethers.getContractAt(
            "VariableDebtToken",
            usdcReserveTokenAddresses.variableDebtTokenAddress
          );

          // Make sure liquidator has funds with which to liquidate
          await allocateAndApproveTokens(
            usdc,
            owner,
            liquidator,
            lendingPool,
            600n,
            0n
          );

          // Simulate price of collateral (MELD) going down drastically so that position is liquidatable
          await simulateAssetPriceCrash(meld, meldPriceOracle, 2n, oracleAdmin);

          // Get borrower USDC reserve data before liquidation
          const borrowerUSDCDataBeforeLiquidation: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              borrower2.address
            );

          // Liquidator liquidates all liquidatable debt (up to close factor)
          const liquidationTx = await lendingPool
            .connect(liquidator)
            .liquidationCall(
              await meld.getAddress(), // collateral asset
              await usdc.getAddress(), // debt asset
              borrower2.address,
              MaxUint256, // flag for all liquidatable debt
              true // receive mToken
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(liquidationTx);

          // Get USDC reserve data after liquidation
          const usdcReserveDataAfterLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Get MELD reserve data after liquidation
          const meldReserveDataAfterLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await meld.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          const maxLiquidatableDebt = (
            borrowerUSDCDataBeforeLiquidation.currentStableDebt +
            borrowerUSDCDataBeforeLiquidation.currentVariableDebt
          ).percentMul(LIQUIDATION_CLOSE_FACTOR_PERCENT);

          // Check that the correct events were emitted //

          await expect(liquidationTx)
            .to.emit(variableDebtToken, "Transfer")
            .withArgs(borrower2.address, ZeroAddress, maxLiquidatableDebt);

          await expect(liquidationTx)
            .to.emit(variableDebtToken, "Burn")
            .withArgs(
              borrower2.address,
              maxLiquidatableDebt,
              usdcReserveDataAfterLiquidation.variableBorrowIndex
            );

          await expect(liquidationTx).to.not.emit(stableDebtToken, "Transfer"); // not liquidating stable debt
          await expect(liquidationTx).to.not.emit(stableDebtToken, "Burn"); // not liquidating stable debt
          await expect(liquidationTx).to.not.emit(stableDebtToken, "Mint"); // not liquidating stable debt

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          // The important thing here is checking that the event is emitted for the debt token. The values are checked in other test files.
          await expect(liquidationTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await usdc.getAddress(),
              anyUint,
              anyUint,
              anyUint,
              anyUint,
              anyUint
            );

          // Mint to treasury because debt token (USDC) has reserveFactor > 0
          const currentVariableDebt =
            borrowerUSDCDataBeforeLiquidation.currentVariableDebt; // accrued
          const previousVariableDebt =
            borrowerUSDCDataBeforeLiquidation.scaledVariableDebt; // principal
          const currentStableDebt = BigInt(0); // no stable debt
          const previousStableDebt = BigInt(0); // no stable debt

          const totalDebtAccrued =
            currentVariableDebt +
            currentStableDebt -
            previousVariableDebt -
            previousStableDebt;

          const { reserveFactor } =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await usdc.getAddress()
            );
          const amountToMint = totalDebtAccrued.percentMul(
            BigInt(reserveFactor)
          );

          await expect(liquidationTx)
            .to.emit(mUSDC, "Transfer")
            .withArgs(
              ZeroAddress,
              treasury.address,
              isAlmostEqual(amountToMint)
            );

          await expect(liquidationTx)
            .to.emit(mUSDC, "Mint")
            .withArgs(
              treasury.address,
              isAlmostEqual(amountToMint),
              usdcReserveDataAfterLiquidation.liquidityIndex
            );

          const { liquidationMultiplier, actualLiquidationProtocolFee } =
            await calcLiquidationMultiplierParams(
              meld,
              lendingPool,
              meldProtocolDataProvider
            );

          const maxLiquidatableCollateral = await calcMaxLiquidatableCollateral(
            meld,
            usdc,
            meldPriceOracle,
            liquidationMultiplier,
            maxLiquidatableDebt
          );

          const liquidationProtocolFeeAmount =
            actualLiquidationProtocolFee.percentMul(maxLiquidatableCollateral);

          const liquidatorAmount =
            maxLiquidatableCollateral - liquidationProtocolFeeAmount;

          // Events emitted when liquidator receives collateral mToken
          const liquidityIndex = calcExpectedReserveNormalizedIncome(
            meldReserveDataAfterLiquidation,
            blockTimestamps.txTimestamp
          );

          await expect(liquidationTx)
            .to.emit(mMELD, "BalanceTransfer")
            .withArgs(
              borrower2.address,
              treasury.address,
              liquidationProtocolFeeAmount,
              liquidityIndex
            );

          await expect(liquidationTx)
            .to.emit(mMELD, "BalanceTransfer")
            .withArgs(
              borrower2.address,
              liquidator.address,
              liquidatorAmount,
              liquidityIndex
            );

          await expect(liquidationTx)
            .to.emit(mMELD, "Transfer")
            .withArgs(
              borrower2.address,
              treasury.address,
              liquidationProtocolFeeAmount
            );

          await expect(liquidationTx)
            .to.emit(mMELD, "Transfer")
            .withArgs(borrower2.address, liquidator.address, liquidatorAmount);

          // liquidator chose mTokens instead of underlying collateral asset
          await expect(liquidationTx).to.not.emit(meld, "Transfer");

          // Event emitted when debt token is transferred from liquidator to pay off debt
          await expect(liquidationTx)
            .to.emit(usdc, "Transfer")
            .withArgs(
              liquidator.address,
              await mUSDC.getAddress(),
              maxLiquidatableDebt
            );

          // ReserveUsedAsCollateralDisabled and  ReserveUsedAsCollateralEnabled Events are defined in library LiquidationLogic.sol,
          //so we need to get the contract instance with the LiquidationLogic ABI
          const contractInstanceWithLogicLibraryABI =
            await ethers.getContractAt(
              "LiquidationLogic",
              await lendingPool.getAddress(),
              owner
            );

          await expect(liquidationTx).to.not.emit(
            contractInstanceWithLogicLibraryABI,
            "ReserveUsedAsCollateralDisabled"
          ); // borrower's balance of collateral mTokens did not go to 0
          await expect(liquidationTx).to.not.emit(
            contractInstanceWithLogicLibraryABI,
            "ReserveUsedAsCollateralEnabled"
          ); // liquidator already had balance of collateral mTokens

          await expect(liquidationTx)
            .to.emit(contractInstanceWithLogicLibraryABI, "LiquidationCall")
            .withArgs(
              await meld.getAddress(),
              await usdc.getAddress(),
              borrower2.address,
              maxLiquidatableDebt,
              maxLiquidatableCollateral,
              liquidator.address,
              true
            );
        });

        it("Should emit correct events when liquidator receives underlying collateral asset", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meldPriceOracle,
            meld,
            usdc,
            owner,
            borrower2,
            liquidator,
            treasury,
            oracleAdmin,
          } = await loadFixture(setUpSingleVariableBorrowUSDCFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR / 2);

          // Instantiate collateral reserve token contracts
          const meldReserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await meld.getAddress()
            );

          const mMELD = await ethers.getContractAt(
            "MToken",
            meldReserveTokenAddresses.mTokenAddress
          );

          // Instantiate debt reserve token contracts
          const usdcReserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await usdc.getAddress()
            );

          const mUSDC = await ethers.getContractAt(
            "MToken",
            usdcReserveTokenAddresses.mTokenAddress
          );

          const stableDebtToken = await ethers.getContractAt(
            "StableDebtToken",
            usdcReserveTokenAddresses.stableDebtTokenAddress
          );

          const variableDebtToken = await ethers.getContractAt(
            "VariableDebtToken",
            usdcReserveTokenAddresses.variableDebtTokenAddress
          );

          // Make sure liquidator has funds with which to liquidate
          const debtToCover = await allocateAndApproveTokens(
            usdc,
            owner,
            liquidator,
            lendingPool,
            200n, // principal debt
            0n
          );

          // Simulate price of collateral (MELD) going down drastically so that position is liquidatable
          await simulateAssetPriceCrash(meld, meldPriceOracle, 2n, oracleAdmin);

          // Get USDC reserve data before liquidation
          const usdcReserveDataBeforeLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Liquidator liquidates partial debt
          const liquidationTx = await lendingPool
            .connect(liquidator)
            .liquidationCall(
              await meld.getAddress(), // collateral asset
              await usdc.getAddress(), // debt asset
              borrower2.address,
              debtToCover,
              false // receive mToken
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(liquidationTx);

          // Get USDC reserve data after liquidation
          const usdcReserveDataAfterLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Get MELD reserve data after liquidation
          const meldReserveDataAfterLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await meld.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Check that the correct events were emitted //
          await expect(liquidationTx)
            .to.emit(variableDebtToken, "Transfer")
            .withArgs(borrower2.address, ZeroAddress, debtToCover);

          await expect(liquidationTx)
            .to.emit(variableDebtToken, "Burn")
            .withArgs(
              borrower2.address,
              debtToCover,
              usdcReserveDataAfterLiquidation.variableBorrowIndex
            );

          await expect(liquidationTx).to.not.emit(stableDebtToken, "Transfer"); // not liquidating stable debt
          await expect(liquidationTx).to.not.emit(stableDebtToken, "Burn"); // not liquidating stable debt
          await expect(liquidationTx).to.not.emit(stableDebtToken, "Mint"); // not liquidating stable debt

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          // The important thing here is checking that the event is emitted for the debt token. The values are checked in other test files.
          await expect(liquidationTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await usdc.getAddress(),
              anyUint,
              anyUint,
              anyUint,
              anyUint,
              anyUint
            );

          // Mint to treasury because debt token (USDC) has reserveFactor > 0
          const currentVariableDebt =
            usdcReserveDataBeforeLiquidation.totalVariableDebt; // accrued
          const previousVariableDebt =
            usdcReserveDataBeforeLiquidation.scaledVariableDebt; // principal
          const currentStableDebt = BigInt(0); // no stable debt
          const previousStableDebt = BigInt(0); // no stable debt

          const totalDebtAccrued =
            currentVariableDebt +
            currentStableDebt -
            previousVariableDebt -
            previousStableDebt;

          const { reserveFactor } =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await usdc.getAddress()
            );
          const amountToMint = totalDebtAccrued.percentMul(
            BigInt(reserveFactor)
          );

          await expect(liquidationTx)
            .to.emit(mUSDC, "Transfer")
            .withArgs(
              ZeroAddress,
              treasury.address,
              isAlmostEqual(amountToMint)
            );

          await expect(liquidationTx)
            .to.emit(mUSDC, "Mint")
            .withArgs(
              treasury.address,
              isAlmostEqual(amountToMint),
              usdcReserveDataAfterLiquidation.liquidityIndex
            );

          const { liquidationMultiplier, actualLiquidationProtocolFee } =
            await calcLiquidationMultiplierParams(
              meld,
              lendingPool,
              meldProtocolDataProvider
            );

          const maxLiquidatableCollateral = await calcMaxLiquidatableCollateral(
            meld,
            usdc,
            meldPriceOracle,
            liquidationMultiplier,
            debtToCover
          );

          const liquidationProtocolFeeAmount =
            actualLiquidationProtocolFee.percentMul(maxLiquidatableCollateral);

          const liquidatorAmount =
            maxLiquidatableCollateral - liquidationProtocolFeeAmount;

          // Events emitted when collateral mToken is burned, which sends underlying asset to liquidator
          const liquidityIndex = calcExpectedReserveNormalizedIncome(
            meldReserveDataAfterLiquidation,
            blockTimestamps.txTimestamp
          );

          await expect(liquidationTx)
            .to.emit(mMELD, "Transfer")
            .withArgs(
              borrower2.address,
              ZeroAddress,
              liquidationProtocolFeeAmount
            );

          await expect(liquidationTx)
            .to.emit(mMELD, "Transfer")
            .withArgs(borrower2.address, ZeroAddress, liquidatorAmount);

          await expect(liquidationTx)
            .to.emit(meld, "Transfer")
            .withArgs(
              await mMELD.getAddress(),
              treasury.address,
              liquidationProtocolFeeAmount
            );

          await expect(liquidationTx)
            .to.emit(meld, "Transfer")
            .withArgs(
              await mMELD.getAddress(),
              liquidator.address,
              liquidatorAmount
            );

          await expect(liquidationTx)
            .to.emit(mMELD, "Burn")
            .withArgs(
              borrower2.address,
              treasury.address,
              liquidationProtocolFeeAmount,
              liquidityIndex
            );

          await expect(liquidationTx)
            .to.emit(mMELD, "Burn")
            .withArgs(
              borrower2.address,
              liquidator.address,
              liquidatorAmount,
              liquidityIndex
            );

          await expect(liquidationTx).to.not.emit(mMELD, "BalanceTransfer"); // liquidator elected to not receive mTokens

          // Event emitted when debt token is transferred from liquidator to pay off debt
          await expect(liquidationTx)
            .to.emit(usdc, "Transfer")
            .withArgs(
              liquidator.address,
              await mUSDC.getAddress(),
              debtToCover
            );

          // ReserveUsedAsCollateralDisabled and  ReserveUsedAsCollateralEnabled Events are defined in library LiquidationLogic.sol,
          // so we need to get the contract instance with the LiquidationLogic ABI
          const contractInstanceWithLogicLibraryABI =
            await ethers.getContractAt(
              "LiquidationLogic",
              await lendingPool.getAddress(),
              owner
            );

          // Event not emitted because liquidator elected not to receive mTokens
          await expect(liquidationTx).to.not.emit(
            contractInstanceWithLogicLibraryABI,
            "ReserveUsedAsCollateralEnabled"
          );

          // borrower2's balance of collateral mTokens did not go to 0
          await expect(liquidationTx).to.not.emit(
            contractInstanceWithLogicLibraryABI,
            "ReserveUsedAsCollateralDisabled"
          );

          // liquidator liquidated partial debt
          await expect(liquidationTx)
            .to.emit(contractInstanceWithLogicLibraryABI, "LiquidationCall")
            .withArgs(
              await meld.getAddress(),
              await usdc.getAddress(),
              borrower2.address,
              debtToCover,
              maxLiquidatableCollateral,
              liquidator.address,
              false
            );
        });

        it("Should update state correctly for max debtToCover (MaxUint256)", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meldPriceOracle,
            meld,
            usdc,
            owner,
            borrower2,
            liquidator,
            oracleAdmin,
          } = await loadFixture(setUpSingleVariableBorrowUSDCFixture);
          // This test case also tests the scenario where the liquidator receives mTokens instead of the underlying collateral asset and does NOT already have mTokens

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR);

          // Make sure liquidator has funds with which to liquidate
          await allocateAndApproveTokens(
            usdc,
            owner,
            liquidator,
            lendingPool,
            1000n,
            0n
          );

          // Simulate price of collateral (MELD) going down drastically so that position is liquidatable
          await simulateAssetPriceCrash(meld, meldPriceOracle, 2n, oracleAdmin);

          // Get USDC reserve data before liquidation
          const usdcReserveDataBeforeLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Get MELD reserve data before liquidation
          const meldReserveDataBeforeLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await meld.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Get borrower account data (over all reserves) before liquidation
          const borrowerAccountDataBefore =
            await lendingPool.getUserAccountData(borrower2.address);

          // Get liquidator MELD reserve data after liquidation
          const liquidatorMELDDataBeforeLiquidation: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              liquidator.address
            );

          expect(liquidatorMELDDataBeforeLiquidation.usageAsCollateralEnabled)
            .to.be.false;

          // Get borrower USDC reserve data before liquidation
          const borrowerUSDCDataBeforeLiquidation: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              borrower2.address
            );

          // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
          time.setNextBlockTimestamp(await time.latest());

          // Liquidator liquidates all liquidatable debt (up to close factor)
          await lendingPool.connect(liquidator).liquidationCall(
            await meld.getAddress(), // collateral asset
            await usdc.getAddress(), // debt asset
            borrower2.address,
            MaxUint256, // flag for all liquidatable debt
            true // receive mToken
          );

          // Get USDC reserve data after liquidation
          const usdcReserveDataAfterLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Get MELD reserve data after liquidation
          const meldReserveDataAfterLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await meld.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Get borrower USDC reserve data after liquidation
          const borrowerUSDCDataAfterLiquidation: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              borrower2.address
            );

          // Get borrower account data (over all reserves) after liquidation
          const borrowerAccountDataAfter = await lendingPool.getUserAccountData(
            borrower2.address
          );

          // Get liquidator MELD reserve data after liquidation
          const liquidatorMELDDataAfterLiquidation: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              liquidator.address
            );

          const maxLiquidatableDebt = (
            borrowerUSDCDataBeforeLiquidation.currentStableDebt +
            borrowerUSDCDataBeforeLiquidation.currentVariableDebt
          ).percentMul(LIQUIDATION_CLOSE_FACTOR_PERCENT);

          // Check state //

          // borrower's health factor should go up after liquidation
          expect(borrowerAccountDataAfter.healthFactor).to.be.greaterThan(
            borrowerAccountDataBefore.healthFactor
          );

          // health factor should be >= 1 after liquidation
          expect(
            borrowerAccountDataAfter.healthFactor
          ).to.be.greaterThanOrEqual(_1e18); // health factor is expressed with 18 decimals (1e18)

          // variable debt should be lower after liquidation. Numbers are off by one digit because of difference in math in solidity and js
          expect(
            borrowerUSDCDataAfterLiquidation.currentVariableDebt
          ).to.be.closeTo(
            borrowerUSDCDataBeforeLiquidation.currentVariableDebt -
              maxLiquidatableDebt,
            1
          );

          // variable borrow index should be higher after liquidation because interest accrued since last updateState (during borrow)
          expect(
            usdcReserveDataAfterLiquidation.variableBorrowIndex
          ).to.be.greaterThan(
            usdcReserveDataBeforeLiquidation.variableBorrowIndex
          );

          // variable borrow rate should be lower after liquidation
          expect(
            usdcReserveDataAfterLiquidation.variableBorrowRate
          ).to.be.lessThan(usdcReserveDataBeforeLiquidation.variableBorrowRate);

          // available liquidity of the debt reserve should be higher after liquidation
          expect(
            usdcReserveDataAfterLiquidation.availableLiquidity
          ).to.be.equal(
            usdcReserveDataBeforeLiquidation.availableLiquidity +
              maxLiquidatableDebt
          );

          // the liquidity index of the debt reserve should behigher than the index before
          expect(
            usdcReserveDataAfterLiquidation.liquidityIndex
          ).to.be.greaterThanOrEqual(
            usdcReserveDataBeforeLiquidation.liquidityIndex
          );

          // the principal APY after a liquidation should belower than the APY before
          expect(usdcReserveDataAfterLiquidation.liquidityRate).to.be.lessThan(
            usdcReserveDataBeforeLiquidation.liquidityRate
          );

          // available liquidity of the collateral reserve should be the same after liquidation (mTokens changed ownership but not burned)
          expect(
            meldReserveDataAfterLiquidation.availableLiquidity
          ).to.be.equal(meldReserveDataBeforeLiquidation.availableLiquidity);

          // liquidator should now have MELD as collateral
          expect(liquidatorMELDDataAfterLiquidation.usageAsCollateralEnabled).to
            .be.true;
        });

        it("Should update state correctly when debtToCover < max", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meldPriceOracle,
            meld,
            usdc,
            owner,
            borrower2,
            liquidator,
            oracleAdmin,
          } = await loadFixture(setUpSingleVariableBorrowUSDCFixture);
          // This test case also tests the scenario where the liquidator receives mTokens instead of the underlying collateral asset and already has mTokens

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR / 2);

          // Liquidator deposits MELD collateral (ensures liquidator has a balance of MELD mTokens)
          const depositAmountMELD = await allocateAndApproveTokens(
            meld,
            owner,
            liquidator,
            lendingPool,
            500n,
            0n
          );

          await lendingPool
            .connect(liquidator)
            .deposit(
              await meld.getAddress(),
              depositAmountMELD,
              liquidator.address,
              true,
              0
            );

          // Make sure liquidator has funds with which to liquidate
          const debtToCover = await allocateAndApproveTokens(
            usdc,
            owner,
            liquidator,
            lendingPool,
            150n, // less than half of principal debt
            0n
          );

          // Simulate price of collateral (MELD) going down drastically so that position is liquidatable
          await simulateAssetPriceCrash(meld, meldPriceOracle, 2n, oracleAdmin);

          // Get USDC reserve data before liquidation
          const usdcReserveDataBeforeLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Get MELD reserve data before liquidation
          const meldReserveDataBeforeLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await meld.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Get borrower USDC reserve data before liquidation
          const borrowerUSDCDataBeforeLiquidation: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              borrower2.address
            );

          // Get borrower account data (over all reserves) before liquidation
          const borrowerAccountDataBefore =
            await lendingPool.getUserAccountData(borrower2.address);

          // Get liquidator MELD reserve data after liquidation
          const liquidatorMELDataBeforeLiquidation: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              liquidator.address
            );

          expect(liquidatorMELDataBeforeLiquidation.usageAsCollateralEnabled).to
            .be.true;

          // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
          time.setNextBlockTimestamp(await time.latest());

          // Liquidator liquidates partial debt
          await lendingPool.connect(liquidator).liquidationCall(
            await meld.getAddress(), // collateral asset
            await usdc.getAddress(), // debt asset
            borrower2.address,
            debtToCover,
            true // receive mToken
          );

          // Get USDC reserve data after liquidation
          const usdcReserveDataAfterLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Get MELD reserve data after liquidation
          const meldReserveDataAfterLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await meld.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Get borrower USDC reserve data after liquidation
          const borrowerUSDCDataAfterLiquidation: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              borrower2.address
            );

          // Get borrower account data (over all reserves) after liquidation
          const borrowerAccountDataAfter = await lendingPool.getUserAccountData(
            borrower2.address
          );

          // Get liquidator MELD reserve data after liquidation
          const liquidatorMELDDataAfterLiquidation: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              liquidator.address
            );

          // Check state //

          // borrower's health factor should go up after liquidation
          expect(borrowerAccountDataAfter.healthFactor).to.be.greaterThan(
            borrowerAccountDataBefore.healthFactor
          );

          // health factor should be >= 1 after liquidation
          expect(
            borrowerAccountDataAfter.healthFactor
          ).to.be.greaterThanOrEqual(_1e18); // health factor is expressed with 18 decimals (1e18)

          // variable debt should be lower after liquidation. Numbers are off by one digit because of difference in math in solidity and js
          expect(
            borrowerUSDCDataAfterLiquidation.currentVariableDebt
          ).to.be.closeTo(
            borrowerUSDCDataBeforeLiquidation.currentVariableDebt - debtToCover,
            1
          );

          // variable borrow index should be higher after liquidation because interest accrued since last updateState (during borrow)
          expect(
            usdcReserveDataAfterLiquidation.variableBorrowIndex
          ).to.be.greaterThan(
            usdcReserveDataBeforeLiquidation.variableBorrowIndex
          );

          // variable borrow rate should be lower after liquidation
          expect(
            usdcReserveDataAfterLiquidation.variableBorrowRate
          ).to.be.lessThan(usdcReserveDataBeforeLiquidation.variableBorrowRate);

          // available liquidity of the debt reserve should be higher after liquidation
          expect(
            usdcReserveDataAfterLiquidation.availableLiquidity
          ).to.be.equal(
            usdcReserveDataBeforeLiquidation.availableLiquidity + debtToCover
          );

          // the liquidity index of the debt reserve should behigher than the index before
          expect(
            usdcReserveDataAfterLiquidation.liquidityIndex
          ).to.be.greaterThanOrEqual(
            usdcReserveDataBeforeLiquidation.liquidityIndex
          );

          // the principal APY after a liquidation should belower than the APY before
          expect(usdcReserveDataAfterLiquidation.liquidityRate).to.be.lessThan(
            usdcReserveDataBeforeLiquidation.liquidityRate
          );

          // available liquidity of the collateral reserve should be the same after liquidation (mTokens changed ownership but not burned)
          expect(
            meldReserveDataAfterLiquidation.availableLiquidity
          ).to.be.equal(meldReserveDataBeforeLiquidation.availableLiquidity);

          // liquidator should now have MELD as collateral
          expect(liquidatorMELDDataAfterLiquidation.usageAsCollateralEnabled).to
            .be.true;
        });

        it("Should update state correctly when liquidator receives underlying collateral asset", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meldPriceOracle,
            meld,
            usdc,
            owner,
            borrower2,
            liquidator,
            oracleAdmin,
          } = await loadFixture(setUpSingleVariableBorrowUSDCFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR / 4);

          // Make sure liquidator has funds with which to liquidate
          const debtToCover = await allocateAndApproveTokens(
            usdc,
            owner,
            liquidator,
            lendingPool,
            200n, // half of pricinpal debt
            0n
          );

          // Simulate price of collateral (MELD) going down drastically so that position is liquidatable
          await simulateAssetPriceCrash(meld, meldPriceOracle, 2n, oracleAdmin);

          // Get USDC reserve data before liquidation
          const usdcReserveDataBeforeLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Get MELD reserve data before liquidation
          const meldReserveDataBeforeLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await meld.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Get borrower USDC reserve data before liquidation
          const borrowerUSDCDataBeforeLiquidation: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              borrower2.address
            );

          // Get borrower account data (over all reserves) before liquidation
          const borrowerAccountDataBefore =
            await lendingPool.getUserAccountData(borrower2.address);

          // Get liquidator MELD reserve data after liquidation
          const liquidatorMELDDataBeforeLiquidation: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              liquidator.address
            );

          expect(liquidatorMELDDataBeforeLiquidation.usageAsCollateralEnabled)
            .to.be.false;

          // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
          time.setNextBlockTimestamp(await time.latest());

          // Liquidator liquidates partial debt
          await lendingPool.connect(liquidator).liquidationCall(
            await meld.getAddress(), // collateral asset
            await usdc.getAddress(), // debt asset
            borrower2.address,
            debtToCover,
            false // receive mToken
          );

          // Get USDC reserve data after liquidation
          const usdcReserveDataAfterLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Get MELD reserve data after liquidation
          const meldReserveDataAfterLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await meld.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Get borrower USDC reserve data after liquidation
          const borrowerUSDCDataAfterLiquidation: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              borrower2.address
            );

          // Get borrower account data (over all reserves) after liquidation
          const borrowerAccountDataAfter = await lendingPool.getUserAccountData(
            borrower2.address
          );

          // Get liquidator MELD reserve data after liquidation
          const liquidatorMELDDataAfterLiquidation: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              liquidator.address
            );

          // Check state //

          // borrower's health factor should go up after liquidation
          expect(borrowerAccountDataAfter.healthFactor).to.be.greaterThan(
            borrowerAccountDataBefore.healthFactor
          );

          // health factor should be >= 1 after liquidation
          expect(
            borrowerAccountDataAfter.healthFactor
          ).to.be.greaterThanOrEqual(_1e18); // health factor is expressed with 18 decimals (1e18)

          // variable debt should be lower after liquidation. Numbers are off by one digit because of difference in math in solidity and js
          expect(
            borrowerUSDCDataAfterLiquidation.currentVariableDebt
          ).to.be.closeTo(
            borrowerUSDCDataBeforeLiquidation.currentVariableDebt - debtToCover,
            1
          );

          // variable borrow index should be >= because interest may have accrued since last updateState
          expect(
            meldReserveDataAfterLiquidation.variableBorrowIndex
          ).to.be.greaterThanOrEqual(
            usdcReserveDataBeforeLiquidation.variableBorrowIndex
          );

          // variable borrow rate should be lower after liquidation
          expect(
            usdcReserveDataAfterLiquidation.variableBorrowRate
          ).to.be.lessThan(usdcReserveDataBeforeLiquidation.variableBorrowRate);

          // available liquidity of the debt reserve should be greater after liquidation
          expect(
            usdcReserveDataAfterLiquidation.availableLiquidity
          ).to.be.equal(
            usdcReserveDataBeforeLiquidation.availableLiquidity + debtToCover
          );

          // the liquidity index of the debt reserve should be greater than the index before
          expect(
            usdcReserveDataAfterLiquidation.liquidityIndex
          ).to.be.greaterThanOrEqual(
            usdcReserveDataBeforeLiquidation.liquidityIndex
          );

          // the principal APY after a liquidation should belower than the APY before
          expect(usdcReserveDataAfterLiquidation.liquidityRate).to.be.lessThan(
            usdcReserveDataBeforeLiquidation.liquidityRate
          );

          // available liquidity of the collateral reserve should be lower after liquidation because liquidator gets underlying tokens
          expect(
            meldReserveDataAfterLiquidation.availableLiquidity
          ).to.be.lessThan(meldReserveDataBeforeLiquidation.availableLiquidity);

          // liquidator should not have USDC (mTokens) as collateral
          expect(liquidatorMELDDataAfterLiquidation.usageAsCollateralEnabled).to
            .be.false;
        });

        it("Should update state correctly after two liquidations of same borrower position in a row", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meldPriceOracle,
            meld,
            usdc,
            owner,
            borrower2,
            liquidator,
            oracleAdmin,
          } = await loadFixture(setUpSingleVariableBorrowUSDCFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR * 2);

          // Make sure liquidator has funds with which to liquidate
          const debtToCover = await allocateAndApproveTokens(
            usdc,
            owner,
            liquidator,
            lendingPool,
            100n, // partial principal debt
            5n
          );

          // Simulate price of collateral (MELD) going down drastically so that position is liquidatable
          await simulateAssetPriceCrash(meld, meldPriceOracle, 2n, oracleAdmin);

          // Liquidator liquidates partial debt
          await lendingPool.connect(liquidator).liquidationCall(
            await meld.getAddress(), // collateral asset
            await usdc.getAddress(), // debt asset
            borrower2.address,
            debtToCover,
            false // receive mToken
          );

          // Get USDC reserve data before second liquidation
          const usdcReserveDataBeforeLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Get MELD reserve data before second liquidation
          const meldReserveDataBeforeLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await meld.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Get borrower USDC reserve data before second liquidation
          const borrowerUSDCDataBeforeLiquidation: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              borrower2.address
            );

          // Get borrower account data (over all reserves) before liquidation
          const borrowerAccountDataBefore =
            await lendingPool.getUserAccountData(borrower2.address);

          // Get liquidator MELD reserve data before second liquidation
          const liquidatorUSDCDataBeforeLiquidation: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              liquidator.address
            );

          expect(liquidatorUSDCDataBeforeLiquidation.usageAsCollateralEnabled)
            .to.be.false;

          // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
          time.setNextBlockTimestamp(await time.latest());

          // Liquidator liquidates rest of liquidatable debt (up to close factor)
          await lendingPool.connect(liquidator).liquidationCall(
            await meld.getAddress(), // collateral asset
            await usdc.getAddress(), // debt asset
            borrower2.address,
            MaxUint256, // flag for all liquidatable debt
            true // receive mToken
          );

          // Get USDC reserve data after second liquidation
          const usdcReserveDataAfterLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Get MELD reserve data after second liquidation
          const meldReserveDataAfterLiquidation: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await meld.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Get borrower USDC reserve data after second liquidation
          const borrowerUSDCDataAfterLiquidation: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              borrower2.address
            );

          // Get borrower account data (over all reserves) after second liquidation
          const borrowerAccountDataAfter = await lendingPool.getUserAccountData(
            borrower2.address
          );

          // Get liquidator MELD reserve data after second liquidation
          const liquidatorMELDDataAfterLiquidation: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              liquidator.address
            );

          const maxLiquidatableDebt = (
            borrowerUSDCDataBeforeLiquidation.currentStableDebt +
            borrowerUSDCDataBeforeLiquidation.currentVariableDebt
          ).percentMul(LIQUIDATION_CLOSE_FACTOR_PERCENT);

          // Check state //

          // borrower's health factor should go up after liquidation
          expect(borrowerAccountDataAfter.healthFactor).to.be.greaterThan(
            borrowerAccountDataBefore.healthFactor
          );

          // health factor should be >= 1 after liquidation
          expect(
            borrowerAccountDataAfter.healthFactor
          ).to.be.greaterThanOrEqual(_1e18); // health factor is expressed with 18 decimals (1e18)

          // variable debt should be lower after liquidation. Numbers are off by one digit because of difference in math in solidity and js
          expect(
            borrowerUSDCDataAfterLiquidation.currentVariableDebt
          ).to.be.closeTo(
            borrowerUSDCDataBeforeLiquidation.currentVariableDebt -
              maxLiquidatableDebt,
            1
          );

          // variable borrow index should be the same after liquidation because NO interest accrued since last updateState (during first liquidation)
          expect(
            usdcReserveDataAfterLiquidation.variableBorrowIndex
          ).to.be.equal(usdcReserveDataBeforeLiquidation.variableBorrowIndex);

          // variable borrow rate should be lower after liquidation
          expect(
            usdcReserveDataAfterLiquidation.variableBorrowRate
          ).to.be.lessThan(usdcReserveDataBeforeLiquidation.variableBorrowRate);

          // available liquidity of the debt reserve should be greater after liquidation
          expect(
            usdcReserveDataAfterLiquidation.availableLiquidity
          ).to.be.equal(
            usdcReserveDataBeforeLiquidation.availableLiquidity +
              maxLiquidatableDebt
          );

          // the liquidity index of the debt reserve should be greater than or equal to the index before
          expect(
            usdcReserveDataAfterLiquidation.liquidityIndex
          ).to.be.greaterThanOrEqual(
            usdcReserveDataBeforeLiquidation.liquidityIndex
          );

          // the principal APY after a liquidation should belower than the APY before
          expect(usdcReserveDataAfterLiquidation.liquidityRate).to.be.lessThan(
            usdcReserveDataBeforeLiquidation.liquidityRate
          );

          // available liquidity of the collateral reserve should be the same after liquidation (mTokens changed ownership but not burned)
          expect(
            meldReserveDataAfterLiquidation.availableLiquidity
          ).to.be.equal(meldReserveDataBeforeLiquidation.availableLiquidity);

          // liquidator should now have USDC as collateral (from first liquidation)
          expect(liquidatorMELDDataAfterLiquidation.usageAsCollateralEnabled).to
            .be.true;
        });

        it("Should update token balances correctly for max debtToCover (MaxUint256)", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            meldPriceOracle,
            meld,
            usdc,
            owner,
            borrower2,
            liquidator,
            treasury,
            oracleAdmin,
          } = await loadFixture(setUpSingleVariableBorrowUSDCFixture);
          // This test case also tests the scenario where the liquidator receives mTokens instead of the underlying collateral asset

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR);

          // Make sure liquidator has funds with which to liquidate
          await allocateAndApproveTokens(
            usdc,
            owner,
            liquidator,
            lendingPool,
            1000n,
            0n
          );

          // Instantiate collateral reserve token contracts
          const meldReserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await meld.getAddress()
            );

          const mMELD = await ethers.getContractAt(
            "MToken",
            meldReserveTokenAddresses.mTokenAddress
          );

          // Instantiate debt reserve token contracts
          const usdcReserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await usdc.getAddress()
            );

          const variableDebtToken = await ethers.getContractAt(
            "VariableDebtToken",
            usdcReserveTokenAddresses.variableDebtTokenAddress
          );

          // Simulate price of collateral (MELD) going down drastically so that position is liquidatable
          await simulateAssetPriceCrash(meld, meldPriceOracle, 2n, oracleAdmin);

          // Get borrower USDC reserve data before liquidation
          const borrowerUSDCDataBeforeLiquidation: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              borrower2.address
            );

          // Get token balances before liquidation
          const borrowerVariableDebtBalanceBeforeLiquidation =
            await variableDebtToken.balanceOf(borrower2.address);
          const borrowerMMELDBalanceBeforeLiquidation = await mMELD.balanceOf(
            borrower2.address
          );
          const mTokenBalanceBeforeLiquidation = await usdc.balanceOf(
            usdcReserveTokenAddresses.mTokenAddress
          );
          const liquidatorMMELDBalanceBeforeLiquidation = await mMELD.balanceOf(
            liquidator.address
          );
          const treasuryMMELDBalanceBeforeLiquidation = await mMELD.balanceOf(
            treasury.address
          );

          // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
          time.setNextBlockTimestamp(await time.latest());

          // Liquidator liquidates all liquidatable debt (up to close factor)
          await lendingPool.connect(liquidator).liquidationCall(
            await meld.getAddress(), // collateral asset
            await usdc.getAddress(), // debt asset
            borrower2.address,
            MaxUint256, // flag for all liquidatable debt
            true // receive mToken
          );

          const maxLiquidatableDebt = (
            borrowerUSDCDataBeforeLiquidation.currentStableDebt +
            borrowerUSDCDataBeforeLiquidation.currentVariableDebt
          ).percentMul(LIQUIDATION_CLOSE_FACTOR_PERCENT);

          const { liquidationMultiplier, actualLiquidationProtocolFee } =
            await calcLiquidationMultiplierParams(
              meld,
              lendingPool,
              meldProtocolDataProvider
            );

          const maxLiquidatableCollateral = await calcMaxLiquidatableCollateral(
            meld,
            usdc,
            meldPriceOracle,
            liquidationMultiplier,
            maxLiquidatableDebt
          );

          const liquidationProtocolFeeAmount =
            actualLiquidationProtocolFee.percentMul(maxLiquidatableCollateral);

          const liquidatorAmount =
            maxLiquidatableCollateral - liquidationProtocolFeeAmount;

          // Get token balances after liquidation
          const borrowerVariableDebtBalanceAfterLiquidation =
            await variableDebtToken.balanceOf(borrower2.address);
          const borrowerMMELDBalanceAfterLiquidation = await mMELD.balanceOf(
            borrower2.address
          );
          const mTokenBalanceAfterLiquidation = await usdc.balanceOf(
            usdcReserveTokenAddresses.mTokenAddress
          );
          const liquidatorMMELDBalanceAfterLiquidation = await mMELD.balanceOf(
            liquidator.address
          );
          const treasuryMMELDBalanceAfterLiquidation = await mMELD.balanceOf(
            treasury.address
          );
          const liquidatorMELDBalanceAfterLiquidation = await meld.balanceOf(
            liquidator.address
          );

          // Check token balances //

          // borrower variable debt balance should be lower after liquidation. Numbers are off by one digit because of difference in math in solidity and js
          expect(borrowerVariableDebtBalanceAfterLiquidation).to.be.closeTo(
            borrowerVariableDebtBalanceBeforeLiquidation - maxLiquidatableDebt,
            1
          );

          // debt mToken balance should be higher after liquidation
          expect(mTokenBalanceAfterLiquidation).to.be.equal(
            mTokenBalanceBeforeLiquidation + maxLiquidatableDebt
          );

          // borrower collateral mToken balance should be lower after liquidation
          expect(borrowerMMELDBalanceAfterLiquidation).to.be.equal(
            borrowerMMELDBalanceBeforeLiquidation - maxLiquidatableCollateral
          );

          // liquidator collateral mToken balance should be higher after liquidation
          expect(liquidatorMMELDBalanceAfterLiquidation).to.be.equal(
            liquidatorMMELDBalanceBeforeLiquidation + liquidatorAmount
          );

          // treasury collateral mToken balance should be higher after liquidation
          expect(treasuryMMELDBalanceAfterLiquidation).to.be.equal(
            treasuryMMELDBalanceBeforeLiquidation + liquidationProtocolFeeAmount
          );

          // liquidator underlying collateral token balance should be 0 after liquidation because liquidator received mTokens instead
          expect(liquidatorMELDBalanceAfterLiquidation).to.be.equal(0n);
        });

        it("Should update token balances correctly when debtToCover < max", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            meldPriceOracle,
            meld,
            usdc,
            owner,
            borrower2,
            liquidator,
            treasury,
            oracleAdmin,
          } = await loadFixture(setUpSingleVariableBorrowUSDCFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR * 1.5);

          // Instantiate collateral reserve token contracts
          const meldReserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await meld.getAddress()
            );

          const mMELD = await ethers.getContractAt(
            "MToken",
            meldReserveTokenAddresses.mTokenAddress
          );

          // Instantiate debt reserve token contracts
          const usdcReserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await usdc.getAddress()
            );

          const variableDebtToken = await ethers.getContractAt(
            "VariableDebtToken",
            usdcReserveTokenAddresses.variableDebtTokenAddress
          );

          // Simulate price of collateral (MELD) going down drastically so that position is liquidatable
          await simulateAssetPriceCrash(meld, meldPriceOracle, 2n, oracleAdmin);

          // Get token balances before liquidation
          const borrowerVariableDebtBalanceBeforeLiquidation =
            await variableDebtToken.balanceOf(borrower2.address);
          const borrowerMMELDBalanceBeforeLiquidation = await mMELD.balanceOf(
            borrower2.address
          );
          const mTokenBalanceBeforeLiquidation = await usdc.balanceOf(
            usdcReserveTokenAddresses.mTokenAddress
          );
          const liquidatorMMELDBalanceBeforeLiquidation = await mMELD.balanceOf(
            liquidator.address
          );
          const treasuryMMELDBalanceBeforeLiquidation = await mMELD.balanceOf(
            treasury.address
          );

          // Make sure liquidator has funds with which to liquidate
          const debtToCover = await allocateAndApproveTokens(
            usdc,
            owner,
            liquidator,
            lendingPool,
            100n, // less than half of principal debt
            0n
          );

          // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
          time.setNextBlockTimestamp(await time.latest());

          // Liquidator liquidates partial debt
          await lendingPool.connect(liquidator).liquidationCall(
            await meld.getAddress(), // collateral asset
            await usdc.getAddress(), // debt asset
            borrower2.address,
            debtToCover,
            true // receive mToken
          );

          const { liquidationMultiplier, actualLiquidationProtocolFee } =
            await calcLiquidationMultiplierParams(
              meld,
              lendingPool,
              meldProtocolDataProvider
            );

          const maxLiquidatableCollateral = await calcMaxLiquidatableCollateral(
            meld,
            usdc,
            meldPriceOracle,
            liquidationMultiplier,
            debtToCover
          );

          const liquidationProtocolFeeAmount =
            actualLiquidationProtocolFee.percentMul(maxLiquidatableCollateral);

          const liquidatorAmount =
            maxLiquidatableCollateral - liquidationProtocolFeeAmount;

          // Get token balances after liquidation
          const borrowerVariableDebtBalanceAfterLiquidation =
            await variableDebtToken.balanceOf(borrower2.address);
          const borrowerMMELDBalanceAfterLiquidation = await mMELD.balanceOf(
            borrower2.address
          );
          const mTokenBalanceAfterLiquidation = await usdc.balanceOf(
            usdcReserveTokenAddresses.mTokenAddress
          );
          const liquidatorMMELDBalanceAfterLiquidation = await mMELD.balanceOf(
            liquidator.address
          );
          const treasuryMMELDBalanceAfterLiquidation = await mMELD.balanceOf(
            treasury.address
          );
          const liquidatorMELDBalanceAfterLiquidation = await meld.balanceOf(
            liquidator.address
          );

          // Check token balances //

          // borrower variable debt balance should be lower after liquidation. Numbers are off by one digit because of difference in math in solidity and js
          expect(borrowerVariableDebtBalanceAfterLiquidation).to.be.closeTo(
            borrowerVariableDebtBalanceBeforeLiquidation - debtToCover,
            1
          );

          // debt mToken balance should be higher after liquidation
          expect(mTokenBalanceAfterLiquidation).to.be.equal(
            mTokenBalanceBeforeLiquidation + debtToCover
          );

          // borrower collateral mToken balance should be lower after liquidation
          expect(borrowerMMELDBalanceAfterLiquidation).to.be.equal(
            borrowerMMELDBalanceBeforeLiquidation - maxLiquidatableCollateral
          );

          // liquidator collateral mToken balance should be higher after liquidation
          expect(liquidatorMMELDBalanceAfterLiquidation).to.be.equal(
            liquidatorMMELDBalanceBeforeLiquidation + liquidatorAmount
          );

          // treasury collateral mToken balance should be higher after liquidation
          expect(treasuryMMELDBalanceAfterLiquidation).to.be.equal(
            treasuryMMELDBalanceBeforeLiquidation + liquidationProtocolFeeAmount
          );

          // liquidator underlying collateral token balance should be 0 after liquidation because liquidator received mTokens instead
          expect(liquidatorMELDBalanceAfterLiquidation).to.be.equal(0n);
        });

        it("Should update token balances correctly when liquidator receives underlying collateral asset", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            meldPriceOracle,
            meld,
            usdc,
            owner,
            borrower2,
            liquidator,
            treasury,
            oracleAdmin,
          } = await loadFixture(setUpSingleVariableBorrowUSDCFixture);

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR / 4);

          // Instantiate collateral reserve token contracts
          const meldReserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await meld.getAddress()
            );

          const mMELD = await ethers.getContractAt(
            "MToken",
            meldReserveTokenAddresses.mTokenAddress
          );

          // Instantiate debt reserve token contracts
          const usdcReserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await usdc.getAddress()
            );

          const variableDebtToken = await ethers.getContractAt(
            "VariableDebtToken",
            usdcReserveTokenAddresses.variableDebtTokenAddress
          );

          // Simulate price of collateral (MELD) going down drastically so that position is liquidatable
          await simulateAssetPriceCrash(meld, meldPriceOracle, 2n, oracleAdmin);

          // Make sure liquidator has funds with which to liquidate
          const debtToCover = await allocateAndApproveTokens(
            usdc,
            owner,
            liquidator,
            lendingPool,
            350n, // part of principal debt
            0n
          );

          // Get token balances before liquidation
          const borrowerVariableDebtBalanceBeforeLiquidation =
            await variableDebtToken.balanceOf(borrower2.address);
          const borrowerMMELDBalanceBeforeLiquidation = await mMELD.balanceOf(
            borrower2.address
          );
          const mTokenBalanceBeforeLiquidation = await usdc.balanceOf(
            usdcReserveTokenAddresses.mTokenAddress
          );
          const liquidatorMELDBalanceBeforeLiquidation = await meld.balanceOf(
            liquidator.address
          );
          const treasuryMELDBalanceBeforeLiquidation = await meld.balanceOf(
            treasury.address
          );

          // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
          time.setNextBlockTimestamp(await time.latest());

          // Liquidator liquidates partial debt
          await lendingPool.connect(liquidator).liquidationCall(
            await meld.getAddress(), // collateral asset
            await usdc.getAddress(), // debt asset
            borrower2.address,
            debtToCover,
            false // receive mToken
          );

          const { liquidationMultiplier, actualLiquidationProtocolFee } =
            await calcLiquidationMultiplierParams(
              meld,
              lendingPool,
              meldProtocolDataProvider
            );

          const maxLiquidatableCollateral = await calcMaxLiquidatableCollateral(
            meld,
            usdc,
            meldPriceOracle,
            liquidationMultiplier,
            debtToCover
          );

          const liquidationProtocolFeeAmount =
            actualLiquidationProtocolFee.percentMul(maxLiquidatableCollateral);

          const liquidatorAmount =
            maxLiquidatableCollateral - liquidationProtocolFeeAmount;

          // Get token balances after liquidation
          const borrowerVariableDebtBalanceAfterLiquidation =
            await variableDebtToken.balanceOf(borrower2.address);
          const borrowerMMELDBalanceAfterLiquidation = await mMELD.balanceOf(
            borrower2.address
          );
          const mTokenBalanceAfterLiquidation = await usdc.balanceOf(
            usdcReserveTokenAddresses.mTokenAddress
          );
          const liquidatorMMELDBalanceAfterLiquidation = await mMELD.balanceOf(
            liquidator.address
          );
          const liquidatorMELDBalanceAfterLiquidation = await meld.balanceOf(
            liquidator.address
          );
          const treasuryMELDBalanceAfterLiquidation = await meld.balanceOf(
            treasury.address
          );

          // Check token balances //

          // borrower variable debt balance should be lower after liquidation. Numbers are off by one digit because of difference in math in solidity and js
          expect(borrowerVariableDebtBalanceAfterLiquidation).to.be.closeTo(
            borrowerVariableDebtBalanceBeforeLiquidation - debtToCover,
            1
          );

          // debt mToken balance should be higher after liquidation
          expect(mTokenBalanceAfterLiquidation).to.be.equal(
            mTokenBalanceBeforeLiquidation + debtToCover
          );

          // borrower collateral mToken balance should be lower after liquidation
          expect(borrowerMMELDBalanceAfterLiquidation).to.be.equal(
            borrowerMMELDBalanceBeforeLiquidation - maxLiquidatableCollateral
          );

          // liquidator collateral mToken balance should be 0 because liquidator receives underlying collateral asset instead of mToken
          expect(liquidatorMMELDBalanceAfterLiquidation).to.be.equal(0n);

          // liquidator underlying collateral token balance should be higher after liquidation
          expect(liquidatorMELDBalanceAfterLiquidation).to.be.equal(
            liquidatorMELDBalanceBeforeLiquidation + liquidatorAmount
          );

          // treasury underlying collateral token balance should be higher after liquidation
          expect(treasuryMELDBalanceAfterLiquidation).to.be.equal(
            treasuryMELDBalanceBeforeLiquidation + liquidationProtocolFeeAmount
          );
        });
        it("Should return correct values when making a static call", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            meldPriceOracle,
            meld,
            usdc,
            owner,
            borrower2,
            liquidator,
            oracleAdmin,
          } = await loadFixture(setUpSingleVariableBorrowUSDCFixture);

          // This test case also tests the scenario where the liquidator receives mTokens instead of the underlying collateral asset and already has mTokens

          // Simulate time passing so owed interest will accrue
          await time.increase(ONE_YEAR / 2);

          // Make sure liquidator has funds with which to liquidate
          const debtToCover = await allocateAndApproveTokens(
            usdc,
            owner,
            liquidator,
            lendingPool,
            150n, // less than half of principal debt
            0n
          );

          // Simulate price of collateral (MELD) going down drastically so that position is liquidatable
          await simulateAssetPriceCrash(meld, meldPriceOracle, 2n, oracleAdmin);

          // Liquidator liquidates partial debt
          const returnedValues = await lendingPool
            .connect(liquidator)
            .liquidationCall.staticCall(
              await meld.getAddress(), // collateral asset
              await usdc.getAddress(), // debt asset
              borrower2.address,
              debtToCover,
              true // receive mToken
            );

          const { liquidationMultiplier } =
            await calcLiquidationMultiplierParams(
              meld,
              lendingPool,
              meldProtocolDataProvider
            );

          const maxLiquidatableCollateral = await calcMaxLiquidatableCollateral(
            meld,
            usdc,
            meldPriceOracle,
            liquidationMultiplier,
            debtToCover
          );

          expect(returnedValues[0]).to.equal(debtToCover);
          expect(returnedValues[1]).to.equal(maxLiquidatableCollateral);

          const estimatedGas = await lendingPool
            .connect(liquidator)
            .liquidationCall.estimateGas(
              await meld.getAddress(), // collateral asset
              await usdc.getAddress(), // debt asset
              borrower2.address,
              debtToCover,
              true // receive mToken
            );

          expect(estimatedGas).to.be.gt(0);
        });
      }); // End Liquidate Variable Debt

      context(
        "Liquidate When Borrower has Combination of Stable and Variable Debt for Same Debt Asset",
        async function () {
          // Some of these test cases have MELD as the collateral token and USDC as the debt token. Others have USDC as collateral and MELD as debt token
          // Variable debt gets liquidated first, then stable debt if necessary
          it("Should emit correct events when variable debt > actual debt to liquidate", async function () {
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              meldPriceOracle,
              meld,
              usdc,
              owner,
              borrower2,
              liquidator,
              treasury,
              oracleAdmin,
            } = await loadFixture(setUpSingleVariableBorrowUSDCFixture);

            // Simulate time passing so owed interest will accrue
            await time.increase(ONE_YEAR / 12);

            // Borrower borrows USDC again at stable rate. Variable debt is 400
            const borrowAmount = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "200"
            );

            // Get USDC reserve data before liquidation
            const usdcReserveDataBeforeSecondBorrow: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await usdc.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Borrow USDC again at stable rate
            await lendingPool
              .connect(borrower2)
              .borrow(
                await usdc.getAddress(),
                borrowAmount,
                RateMode.Stable,
                borrower2.address,
                0
              );

            // Simulate time passing so owed interest will accrue
            await time.increase(ONE_YEAR / 4);

            // Instantiate collateral reserve token contracts
            const meldReserveTokenAddresses =
              await meldProtocolDataProvider.getReserveTokensAddresses(
                await meld.getAddress()
              );

            const mMELD = await ethers.getContractAt(
              "MToken",
              meldReserveTokenAddresses.mTokenAddress
            );

            // Instantiate debt reserve token contracts
            const usdcReserveTokenAddresses =
              await meldProtocolDataProvider.getReserveTokensAddresses(
                await usdc.getAddress()
              );

            const mUSDC = await ethers.getContractAt(
              "MToken",
              usdcReserveTokenAddresses.mTokenAddress
            );

            const stableDebtToken = await ethers.getContractAt(
              "StableDebtToken",
              usdcReserveTokenAddresses.stableDebtTokenAddress
            );

            const variableDebtToken = await ethers.getContractAt(
              "VariableDebtToken",
              usdcReserveTokenAddresses.variableDebtTokenAddress
            );

            // Make sure liquidator has funds with which to liquidate
            const debtToCover = await allocateAndApproveTokens(
              usdc,
              owner,
              liquidator,
              lendingPool,
              100n, // part of principal variable debt
              0n
            );

            // Simulate price of collateral (MELD) going down drastically so that position is liquidatable
            await simulateAssetPriceCrash(
              meld,
              meldPriceOracle,
              2n,
              oracleAdmin
            );

            // Get USDC reserve data before liquidation
            const usdcReserveDataBeforeLiquidation: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await usdc.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Liquidator liquidates partial debt
            const liquidationTx = await lendingPool
              .connect(liquidator)
              .liquidationCall(
                await meld.getAddress(), // collateral asset
                await usdc.getAddress(), // debt asset
                borrower2.address,
                debtToCover,
                true // receive mToken
              );

            const blockTimestamps: BlockTimestamps =
              await getBlockTimestamps(liquidationTx);

            // Get USDC reserve data after liquidation
            const usdcReserveDataAfterLiquidation: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await usdc.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get MELD reserve data after liquidation
            const meldReserveDataAfterLiquidation: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Check that the correct events were emitted //
            await expect(liquidationTx)
              .to.emit(variableDebtToken, "Transfer")
              .withArgs(borrower2.address, ZeroAddress, debtToCover);

            await expect(liquidationTx)
              .to.emit(variableDebtToken, "Burn")
              .withArgs(
                borrower2.address,
                debtToCover,
                usdcReserveDataAfterLiquidation.variableBorrowIndex
              );

            await expect(liquidationTx).to.not.emit(
              stableDebtToken,
              "Transfer"
            ); // not liquidating stable debt because variable debt > actual debt to liquidate
            await expect(liquidationTx).to.not.emit(stableDebtToken, "Burn"); // not liquidating stable debt because variable debt > actual debt to liquidate
            await expect(liquidationTx).to.not.emit(stableDebtToken, "Mint"); // not liquidating stable debt because variable debt > actual debt to liquidate

            // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
            const contractInstanceWithLibraryABI = await ethers.getContractAt(
              "ReserveLogic",
              await lendingPool.getAddress(),
              owner
            );

            // The important thing here is checking that the event is emitted for the debt token. The values are checked in other test files.
            await expect(liquidationTx)
              .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
              .withArgs(
                await usdc.getAddress(),
                anyUint,
                anyUint,
                anyUint,
                anyUint,
                anyUint
              );

            // Mint to treasury because debt token (USDC) has reserveFactor > 0 and debt has accrued
            const currentVariableDebt =
              usdcReserveDataBeforeLiquidation.totalVariableDebt;
            const previousVariableDebt =
              usdcReserveDataBeforeSecondBorrow.totalVariableDebt;
            const currentStableDebt =
              usdcReserveDataBeforeLiquidation.totalStableDebt;
            const previousStableDebt =
              usdcReserveDataBeforeLiquidation.principalStableDebt;

            const totalDebtAccrued =
              currentVariableDebt +
              currentStableDebt -
              previousVariableDebt -
              previousStableDebt;

            const { reserveFactor } =
              await meldProtocolDataProvider.getReserveConfigurationData(
                await usdc.getAddress()
              );
            const amountToMint = totalDebtAccrued.percentMul(
              BigInt(reserveFactor)
            );

            await expect(liquidationTx)
              .to.emit(mUSDC, "Transfer")
              .withArgs(
                ZeroAddress,
                treasury.address,
                isAlmostEqual(amountToMint)
              );

            await expect(liquidationTx)
              .to.emit(mUSDC, "Mint")
              .withArgs(
                treasury.address,
                isAlmostEqual(amountToMint),
                usdcReserveDataAfterLiquidation.liquidityIndex
              );

            const { liquidationMultiplier, actualLiquidationProtocolFee } =
              await calcLiquidationMultiplierParams(
                meld,
                lendingPool,
                meldProtocolDataProvider
              );

            const maxLiquidatableCollateral =
              await calcMaxLiquidatableCollateral(
                meld,
                usdc,
                meldPriceOracle,
                liquidationMultiplier,
                debtToCover
              );

            const liquidationProtocolFeeAmount =
              actualLiquidationProtocolFee.percentMul(
                maxLiquidatableCollateral
              );

            const liquidatorAmount =
              maxLiquidatableCollateral - liquidationProtocolFeeAmount;

            // Check that the correct events were emitted //

            // Events emitted when liquidator receives collateral mToken
            const liquidityIndex = calcExpectedReserveNormalizedIncome(
              meldReserveDataAfterLiquidation,
              blockTimestamps.txTimestamp
            );

            await expect(liquidationTx)
              .to.emit(mMELD, "BalanceTransfer")
              .withArgs(
                borrower2.address,
                treasury.address,
                liquidationProtocolFeeAmount,
                liquidityIndex
              );

            await expect(liquidationTx)
              .to.emit(mMELD, "BalanceTransfer")
              .withArgs(
                borrower2.address,
                liquidator.address,
                liquidatorAmount,
                liquidityIndex
              );

            await expect(liquidationTx)
              .to.emit(mMELD, "Transfer")
              .withArgs(
                borrower2.address,
                treasury.address,
                liquidationProtocolFeeAmount
              );

            await expect(liquidationTx)
              .to.emit(mMELD, "Transfer")
              .withArgs(
                borrower2.address,
                liquidator.address,
                liquidatorAmount
              );

            // liquidator chose mTokens instead of underlying collateral asset
            await expect(liquidationTx).to.not.emit(meld, "Transfer");

            // Event emitted when debt token is transferred from liquidator to pay off debt
            await expect(liquidationTx)
              .to.emit(usdc, "Transfer")
              .withArgs(
                liquidator.address,
                await mUSDC.getAddress(),
                debtToCover
              );

            // ReserveUsedAsCollateralDisabled and  ReserveUsedAsCollateralEnabled Events are defined in library LiquidationLogic.sol,
            // so we need to get the contract instance with the LiquidationLogic ABI
            const contractInstanceWithLogicLibraryABI =
              await ethers.getContractAt(
                "LiquidationLogic",
                await lendingPool.getAddress(),
                owner
              );

            // Event emitted when collateral token is set as collateral for liquidator because liquidator previously had 0 balance
            await expect(liquidationTx)
              .to.emit(
                contractInstanceWithLogicLibraryABI,
                "ReserveUsedAsCollateralEnabled"
              )
              .withArgs(await meld.getAddress(), liquidator.address);

            // borrower's balance of collateral mTokens did not go to 0
            await expect(liquidationTx).to.not.emit(
              contractInstanceWithLogicLibraryABI,
              "ReserveUsedAsCollateralDisabled"
            );

            // liquidator liquidates partial debt
            await expect(liquidationTx)
              .to.emit(contractInstanceWithLogicLibraryABI, "LiquidationCall")
              .withArgs(
                await meld.getAddress(),
                await usdc.getAddress(),
                borrower2.address,
                debtToCover,
                maxLiquidatableCollateral,
                liquidator.address,
                true
              );
          });

          it("Should emit correct events when variable debt == actual debt to liquidate", async function () {
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              meldPriceOracle,
              meld,
              usdc,
              owner,
              borrower,
              liquidator,
              treasury,
              oracleAdmin,
            } = await loadFixture(setUpSingleStableBorrowMELDFixture);

            // Borrower borrows MELD again at variable rate. Stable debt is 2000 MELD
            const borrowAmount = await convertToCurrencyDecimals(
              await meld.getAddress(),
              "500"
            );

            // Borrow MELD again at variable rate
            await lendingPool
              .connect(borrower)
              .borrow(
                await meld.getAddress(),
                borrowAmount,
                RateMode.Variable,
                borrower.address,
                0
              );

            // Instantiate debt reserve token contracts
            const meldReserveTokenAddresses =
              await meldProtocolDataProvider.getReserveTokensAddresses(
                await meld.getAddress()
              );

            const mMELD = await ethers.getContractAt(
              "MToken",
              meldReserveTokenAddresses.mTokenAddress
            );

            const stableDebtToken = await ethers.getContractAt(
              "StableDebtToken",
              meldReserveTokenAddresses.stableDebtTokenAddress
            );

            const variableDebtToken = await ethers.getContractAt(
              "VariableDebtToken",
              meldReserveTokenAddresses.variableDebtTokenAddress
            );

            // Instantiate collateral reserve token contracts
            const usdcReserveTokenAddresses =
              await meldProtocolDataProvider.getReserveTokensAddresses(
                await usdc.getAddress()
              );

            const mUSDC = await ethers.getContractAt(
              "MToken",
              usdcReserveTokenAddresses.mTokenAddress
            );

            // Make sure liquidator has funds with which to liquidate
            const debtToCover = await allocateAndApproveTokens(
              meld,
              owner,
              liquidator,
              lendingPool,
              500n, // equal to principal variable debt
              0n
            );

            // Simulate debt token price increase so that debt is liquidatable
            const [currentPrice, success] = await meldPriceOracle.getAssetPrice(
              await meld.getAddress()
            );

            expect(success).to.be.true;

            await meldPriceOracle
              .connect(oracleAdmin)
              .setAssetPrice(await meld.getAddress(), currentPrice * 4n);

            // Liquidator liquidates partial debt
            const liquidationTx = await lendingPool
              .connect(liquidator)
              .liquidationCall(
                await usdc.getAddress(), // collateral asset
                await meld.getAddress(), // debt asset
                borrower.address,
                debtToCover,
                true // receive mToken
              );

            const blockTimestamps: BlockTimestamps =
              await getBlockTimestamps(liquidationTx);

            // Get USDC reserve data after liquidation
            const usdcReserveDataAfterLiquidation: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await usdc.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get MELD reserve data after liquidation
            const meldReserveDataAfterLiquidation: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Check that the correct events were emitted //
            await expect(liquidationTx)
              .to.emit(variableDebtToken, "Transfer")
              .withArgs(borrower.address, ZeroAddress, debtToCover);

            await expect(liquidationTx)
              .to.emit(variableDebtToken, "Burn")
              .withArgs(
                borrower.address,
                debtToCover,
                meldReserveDataAfterLiquidation.variableBorrowIndex
              );

            await expect(liquidationTx).to.not.emit(
              stableDebtToken,
              "Transfer"
            ); // not liquidating stable debt because variable debt == actual debt to liquidate
            await expect(liquidationTx).to.not.emit(stableDebtToken, "Burn"); // not liquidating stable debt because variable debt == actual debt to liquidate
            await expect(liquidationTx).to.not.emit(stableDebtToken, "Mint"); // not liquidating stable debt because variable debt == actual debt to liquidate

            // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
            const contractInstanceWithLibraryABI = await ethers.getContractAt(
              "ReserveLogic",
              await lendingPool.getAddress(),
              owner
            );

            // The important thing here is checking that the event is emitted for the debt token. The values are checked in other test files.
            await expect(liquidationTx)
              .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
              .withArgs(
                await meld.getAddress(),
                anyUint,
                anyUint,
                anyUint,
                anyUint,
                anyUint
              );

            // No mint to treasury because no debt accrued since last update
            await expect(liquidationTx).to.not.emit(mMELD, "Transfer");
            await expect(liquidationTx).to.not.emit(mMELD, "Mint");

            const { liquidationMultiplier, actualLiquidationProtocolFee } =
              await calcLiquidationMultiplierParams(
                usdc,
                lendingPool,
                meldProtocolDataProvider
              );

            const maxLiquidatableCollateral =
              await calcMaxLiquidatableCollateral(
                usdc,
                meld,
                meldPriceOracle,
                liquidationMultiplier,
                debtToCover
              );

            const liquidationProtocolFeeAmount =
              actualLiquidationProtocolFee.percentMul(
                maxLiquidatableCollateral
              );

            const liquidatorAmount =
              maxLiquidatableCollateral - liquidationProtocolFeeAmount;

            // Check that the correct events were emitted //

            // Events emitted when liquidator receives collateral mToken
            const liquidityIndex = calcExpectedReserveNormalizedIncome(
              usdcReserveDataAfterLiquidation,
              blockTimestamps.txTimestamp
            );

            await expect(liquidationTx)
              .to.emit(mUSDC, "BalanceTransfer")
              .withArgs(
                borrower.address,
                treasury.address,
                liquidationProtocolFeeAmount,
                liquidityIndex
              );

            await expect(liquidationTx)
              .to.emit(mUSDC, "BalanceTransfer")
              .withArgs(
                borrower.address,
                liquidator.address,
                liquidatorAmount,
                liquidityIndex
              );

            await expect(liquidationTx)
              .to.emit(mUSDC, "Transfer")
              .withArgs(
                borrower.address,
                treasury.address,
                liquidationProtocolFeeAmount
              );

            await expect(liquidationTx)
              .to.emit(mUSDC, "Transfer")
              .withArgs(borrower.address, liquidator.address, liquidatorAmount);

            // liquidator chose mTokens instead of underlying collateral asset
            await expect(liquidationTx).to.not.emit(usdc, "Transfer");

            // Event emitted when debt token is transferred from liquidator to pay off debt
            await expect(liquidationTx)
              .to.emit(meld, "Transfer")
              .withArgs(
                liquidator.address,
                await mMELD.getAddress(),
                debtToCover
              );

            // ReserveUsedAsCollateralDisabled and ReserveUsedAsCollateralEnabled Events are emitted by library LiquidationLogic.sol,
            // so we need to get the contract instance with the LiquidationLogic ABI
            const contractInstanceWithLogicLibraryABI =
              await ethers.getContractAt(
                "LiquidationLogic",
                await lendingPool.getAddress(),
                owner
              );

            // Event emitted when collateral token is set as collateral for liquidator because liquidator previously had 0 balance
            await expect(liquidationTx)
              .to.emit(
                contractInstanceWithLogicLibraryABI,
                "ReserveUsedAsCollateralEnabled"
              )
              .withArgs(await usdc.getAddress(), liquidator.address);

            // borrower's balance of collateral mTokens did not go to 0
            await expect(liquidationTx).to.not.emit(
              contractInstanceWithLogicLibraryABI,
              "ReserveUsedAsCollateralDisabled"
            );

            // liquidator liquidates partial debt
            await expect(liquidationTx)
              .to.emit(contractInstanceWithLogicLibraryABI, "LiquidationCall")
              .withArgs(
                await usdc.getAddress(),
                await meld.getAddress(),
                borrower.address,
                debtToCover,
                maxLiquidatableCollateral,
                liquidator.address,
                true
              );
          });

          it("Should emit correct events when variable debt < actual debt to liquidate", async function () {
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              meldPriceOracle,
              meld,
              usdc,
              owner,
              borrower,
              liquidator,
              treasury,
              oracleAdmin,
            } = await loadFixture(setUpSingleStableBorrowMELDFixture);

            // Simulate time passing so owed interest will accrue
            await time.increase(ONE_YEAR / 4);

            // Borrower borrows MELD again at variable rate. Stable debt is 2000 MELD
            const borrowAmount = await convertToCurrencyDecimals(
              await meld.getAddress(),
              "500"
            );

            // Borrow MELD again at variable rate.
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
            await time.increase(ONE_YEAR / 2);

            // Liquidator deposits USDC collateral (ensures liquidator has a balance of USDC mTokens)
            const depositAmountUSDC = await allocateAndApproveTokens(
              usdc,
              owner,
              liquidator,
              lendingPool,
              500n,
              0n
            );

            await lendingPool
              .connect(liquidator)
              .deposit(
                await usdc.getAddress(),
                depositAmountUSDC,
                liquidator.address,
                true,
                0
              );

            // Instantiate debt reserve token contracts
            const meldReserveTokenAddresses =
              await meldProtocolDataProvider.getReserveTokensAddresses(
                await meld.getAddress()
              );

            const mMELD = await ethers.getContractAt(
              "MToken",
              meldReserveTokenAddresses.mTokenAddress
            );

            const stableDebtToken = await ethers.getContractAt(
              "StableDebtToken",
              meldReserveTokenAddresses.stableDebtTokenAddress
            );

            const variableDebtToken = await ethers.getContractAt(
              "VariableDebtToken",
              meldReserveTokenAddresses.variableDebtTokenAddress
            );

            // Instantiate collateral reserve token contracts
            const usdcReserveTokenAddresses =
              await meldProtocolDataProvider.getReserveTokensAddresses(
                await usdc.getAddress()
              );

            const mUSDC = await ethers.getContractAt(
              "MToken",
              usdcReserveTokenAddresses.mTokenAddress
            );

            // Make sure liquidator has funds with which to liquidate
            await allocateAndApproveTokens(
              meld,
              owner,
              liquidator,
              lendingPool,
              3000n,
              0n
            );

            // Simulate debt token price increase so that debt is liquidatable
            const [currentPrice, success] = await meldPriceOracle.getAssetPrice(
              await meld.getAddress()
            );

            expect(success).to.be.true;

            await meldPriceOracle
              .connect(oracleAdmin)
              .setAssetPrice(await meld.getAddress(), currentPrice * 4n);

            // Get borrower MELD reserve data before liquidation
            const borrowerMELDDataBeforeLiquidation: UserReserveData =
              await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await meld.getAddress(),
                borrower.address
              );

            // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
            time.setNextBlockTimestamp(await time.latest());

            // Liquidator liquidates all liquidatable debt (up to close factor)
            const liquidationTx = await lendingPool
              .connect(liquidator)
              .liquidationCall(
                await usdc.getAddress(), // collateral asset
                await meld.getAddress(), // debt asset
                borrower.address,
                MaxUint256, // flag for all liquidatable debt
                true // receive mToken
              );

            const blockTimestamps: BlockTimestamps =
              await getBlockTimestamps(liquidationTx);

            // Get USDC reserve data after liquidation
            const usdcReserveDataAfterLiquidation: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await usdc.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get MELD reserve data after liquidation
            const meldReserveDataAfterLiquidation: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            const expectedIncrease =
              borrowerMELDDataBeforeLiquidation.currentStableDebt -
              borrowerMELDDataBeforeLiquidation.principalStableDebt;

            const maxLiquidatableDebt = (
              borrowerMELDDataBeforeLiquidation.currentStableDebt +
              borrowerMELDDataBeforeLiquidation.currentVariableDebt
            ).percentMul(LIQUIDATION_CLOSE_FACTOR_PERCENT);

            const stableDebtToLiquidate =
              maxLiquidatableDebt -
              borrowerMELDDataBeforeLiquidation.currentVariableDebt;

            // Check that the correct events were emitted //

            await expect(liquidationTx)
              .to.emit(variableDebtToken, "Transfer")
              .withArgs(
                borrower.address,
                ZeroAddress,
                borrowerMELDDataBeforeLiquidation.currentVariableDebt
              );

            await expect(liquidationTx)
              .to.emit(variableDebtToken, "Burn")
              .withArgs(
                borrower.address,
                borrowerMELDDataBeforeLiquidation.currentVariableDebt,
                meldReserveDataAfterLiquidation.variableBorrowIndex
              );

            await expect(liquidationTx)
              .to.emit(stableDebtToken, "Transfer")
              .withArgs(borrower.address, ZeroAddress, stableDebtToLiquidate);

            await expect(liquidationTx)
              .to.emit(stableDebtToken, "Burn")
              .withArgs(
                borrower.address,
                stableDebtToLiquidate - expectedIncrease,
                borrowerMELDDataBeforeLiquidation.currentStableDebt,
                expectedIncrease,
                anyUint,
                anyUint
              );

            await expect(liquidationTx).to.not.emit(stableDebtToken, "Mint"); // expected increase too low

            // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
            const contractInstanceWithLibraryABI = await ethers.getContractAt(
              "ReserveLogic",
              await lendingPool.getAddress(),
              owner
            );

            // The important thing here is checking that the event is emitted for the debt token. The values are checked in other test files.
            await expect(liquidationTx)
              .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
              .withArgs(
                await meld.getAddress(),
                anyUint,
                anyUint,
                anyUint,
                anyUint,
                anyUint
              );

            // No mint to treasury because debt token has reserveFactor == 0
            await expect(liquidationTx).to.not.emit(mMELD, "Transfer");
            await expect(liquidationTx).to.not.emit(mMELD, "Mint");

            const { liquidationMultiplier, actualLiquidationProtocolFee } =
              await calcLiquidationMultiplierParams(
                usdc,
                lendingPool,
                meldProtocolDataProvider
              );

            const maxLiquidatableCollateral =
              await calcMaxLiquidatableCollateral(
                usdc,
                meld,
                meldPriceOracle,
                liquidationMultiplier,
                maxLiquidatableDebt
              );

            const liquidationProtocolFeeAmount =
              actualLiquidationProtocolFee.percentMul(
                maxLiquidatableCollateral
              );

            const liquidatorAmount =
              maxLiquidatableCollateral - liquidationProtocolFeeAmount;

            // Events emitted when liquidator receives collateral mToken
            const liquidityIndex = calcExpectedReserveNormalizedIncome(
              usdcReserveDataAfterLiquidation,
              blockTimestamps.txTimestamp
            );

            await expect(liquidationTx)
              .to.emit(mUSDC, "BalanceTransfer")
              .withArgs(
                borrower.address,
                treasury.address,
                liquidationProtocolFeeAmount,
                liquidityIndex
              );

            await expect(liquidationTx)
              .to.emit(mUSDC, "BalanceTransfer")
              .withArgs(
                borrower.address,
                liquidator.address,
                liquidatorAmount,
                liquidityIndex
              );

            await expect(liquidationTx)
              .to.emit(mUSDC, "Transfer")
              .withArgs(
                borrower.address,
                treasury.address,
                liquidationProtocolFeeAmount
              );

            await expect(liquidationTx)
              .to.emit(mUSDC, "Transfer")
              .withArgs(borrower.address, liquidator.address, liquidatorAmount);

            // liquidator chose mTokens instead of underlying collateral asset
            await expect(liquidationTx).to.not.emit(usdc, "Transfer");

            // Event emitted when debt token is transferred from liquidator to pay off debt
            await expect(liquidationTx)
              .to.emit(meld, "Transfer")
              .withArgs(
                liquidator.address,
                await mMELD.getAddress(),
                maxLiquidatableDebt
              );

            // ReserveUsedAsCollateralDisabled and ReserveUsedAsCollateralEnabled Events are emitted by library LiquidationLogic.sol,
            // so we need to get the contract instance with the LiquidationLogic ABI
            const contractInstanceWithLogicLibraryABI =
              await ethers.getContractAt(
                "LiquidationLogic",
                await lendingPool.getAddress(),
                owner
              );

            await expect(liquidationTx).to.not.emit(
              contractInstanceWithLogicLibraryABI,
              "ReserveUsedAsCollateralDisabled"
            ); // borrower's balance of collateral mTokens did not go to 0
            await expect(liquidationTx).to.not.emit(
              contractInstanceWithLogicLibraryABI,
              "ReserveUsedAsCollateralEnabled"
            ); // liquidator already had balance of collateral mTokens

            await expect(liquidationTx)
              .to.emit(contractInstanceWithLogicLibraryABI, "LiquidationCall")
              .withArgs(
                await usdc.getAddress(),
                await meld.getAddress(),
                borrower.address,
                maxLiquidatableDebt,
                maxLiquidatableCollateral,
                liquidator.address,
                true
              );
          });

          it("Should update state correctly when variable debt > actual debt to liquidate", async function () {
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              meldPriceOracle,
              meld,
              usdc,
              owner,
              borrower2,
              liquidator,
              oracleAdmin,
            } = await loadFixture(setUpSingleVariableBorrowUSDCFixture);

            // Simulate time passing so owed interest will accrue
            await time.increase(ONE_YEAR / 2);

            // Borrower borrows USDC again at stable rate. Variable debt is 400
            const borrowAmount = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "200"
            );

            // Borrow USDC again at stable rate
            await lendingPool
              .connect(borrower2)
              .borrow(
                await usdc.getAddress(),
                borrowAmount,
                RateMode.Stable,
                borrower2.address,
                0
              );

            // Simulate time passing so owed interest will accrue
            await time.increase(ONE_YEAR);

            // Liquidator deposits MELD collateral (ensures liquidator has a balance of MELD mTokens)
            const depositAmountMELD = await allocateAndApproveTokens(
              meld,
              owner,
              liquidator,
              lendingPool,
              500n,
              0n
            );

            await lendingPool
              .connect(liquidator)
              .deposit(
                await meld.getAddress(),
                depositAmountMELD,
                liquidator.address,
                true,
                0
              );

            // Make sure liquidator has funds with which to liquidate
            const debtToCover = await allocateAndApproveTokens(
              usdc,
              owner,
              liquidator,
              lendingPool,
              100n, // less than half of principal variable debt
              0n
            );

            const [currentPrice, success] = await meldPriceOracle.getAssetPrice(
              await meld.getAddress()
            );

            expect(success).to.be.true;

            // Simulate price of collateral (MELD) going down so that position is liquidatable
            const newPrice = (10n * currentPrice) / 12n; // price goes down by 1.2 times (currentPrice/1.2). workaround because can't use decimals with bigint
            await meldPriceOracle
              .connect(oracleAdmin)
              .setAssetPrice(await meld.getAddress(), newPrice);

            // Get USDC reserve data before liquidation
            const usdcReserveDataBeforeLiquidation: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await usdc.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get MELD reserve data before liquidation
            const meldReserveDataBeforeLiquidation: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get borrower USDC reserve data before liquidation
            const borrowerUSDCDataBeforeLiquidation: UserReserveData =
              await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await usdc.getAddress(),
                borrower2.address
              );

            // Get borrower account data (over all reserves) before liquidation
            const borrowerAccountDataBefore =
              await lendingPool.getUserAccountData(borrower2.address);

            // Get liquidator MELD reserve data after liquidation
            const liquidatorMELDDataBeforeLiquidation: UserReserveData =
              await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await meld.getAddress(),
                liquidator.address
              );

            expect(liquidatorMELDDataBeforeLiquidation.usageAsCollateralEnabled)
              .to.be.true;

            // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
            time.setNextBlockTimestamp(await time.latest());

            // Liquidator liquidates partial debt
            await lendingPool.connect(liquidator).liquidationCall(
              await meld.getAddress(), // collateral asset
              await usdc.getAddress(), // debt asset
              borrower2.address,
              debtToCover,
              true // receive mToken
            );

            // Get USDC reserve data after liquidation
            const usdcReserveDataAfterLiquidation: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await usdc.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get MELD reserve data after liquidation
            const meldReserveDataAfterLiquidation: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get borrower USDC reserve data after liquidation
            const borrowerUSDCDataAfterLiquidation: UserReserveData =
              await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await usdc.getAddress(),
                borrower2.address
              );

            // Get borrower account data (over all reserves) after liquidation
            const borrowerAccountDataAfter =
              await lendingPool.getUserAccountData(borrower2.address);

            // Get liquidator MELD reserve data after liquidation
            const liquidatorMELDDataAfterLiquidation: UserReserveData =
              await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await meld.getAddress(),
                liquidator.address
              );

            // Check state //

            // borrower's health factor should go up after liquidation
            expect(borrowerAccountDataAfter.healthFactor).to.be.greaterThan(
              borrowerAccountDataBefore.healthFactor
            );

            // variable debt should be lower after liquidation. Numbers are off by one digit because of difference in math in solidity and js
            expect(
              borrowerUSDCDataAfterLiquidation.currentVariableDebt
            ).to.be.closeTo(
              borrowerUSDCDataBeforeLiquidation.currentVariableDebt -
                debtToCover,
              1
            );

            // stable debt should be the same after liquidation because variable debt is liquidated first.
            expect(
              borrowerUSDCDataAfterLiquidation.currentStableDebt
            ).to.be.equal(borrowerUSDCDataBeforeLiquidation.currentStableDebt);

            // variable borrow index should be higher after liquidation because interest accrued since last updateState (during borrow)
            expect(
              usdcReserveDataAfterLiquidation.variableBorrowIndex
            ).to.be.greaterThan(
              usdcReserveDataBeforeLiquidation.variableBorrowIndex
            );

            // variable borrow rate should be lower after liquidation
            expect(
              usdcReserveDataAfterLiquidation.variableBorrowRate
            ).to.be.lessThan(
              usdcReserveDataBeforeLiquidation.variableBorrowRate
            );

            // available liquidity of the debt reserve should be higher after liquidation
            expect(
              usdcReserveDataAfterLiquidation.availableLiquidity
            ).to.be.equal(
              usdcReserveDataBeforeLiquidation.availableLiquidity + debtToCover
            );

            // the liquidity index of the debt reserve should be greater than or equal to the index before
            expect(
              usdcReserveDataAfterLiquidation.liquidityIndex
            ).to.be.greaterThanOrEqual(
              usdcReserveDataBeforeLiquidation.liquidityIndex
            );

            // the principal APY after a liquidation should be greater than the APY before because overall borrow rate went up due to stable debt interest
            expect(
              usdcReserveDataAfterLiquidation.liquidityRate
            ).to.be.greaterThan(usdcReserveDataBeforeLiquidation.liquidityRate);

            // available liquidity of the collateral reserve should be the same after liquidation (mTokens changed ownership but not burned)
            expect(
              meldReserveDataAfterLiquidation.availableLiquidity
            ).to.be.equal(meldReserveDataBeforeLiquidation.availableLiquidity);

            // liquidator should now have MELD as collateral
            expect(liquidatorMELDDataAfterLiquidation.usageAsCollateralEnabled)
              .to.be.true;
          });

          it("Should update state correctly when variable debt == actual debt to liquidate", async function () {
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              meldPriceOracle,
              meld,
              usdc,
              owner,
              borrower,
              liquidator,
              oracleAdmin,
            } = await loadFixture(setUpSingleStableBorrowMELDFixture);

            // Borrower borrows MELD again at variable rate. Stable debt is 2000 MELD
            const borrowAmount = await convertToCurrencyDecimals(
              await meld.getAddress(),
              "500"
            );

            // Borrow MELD again at variable rate
            await lendingPool
              .connect(borrower)
              .borrow(
                await meld.getAddress(),
                borrowAmount,
                RateMode.Variable,
                borrower.address,
                0
              );

            // Make sure liquidator has funds with which to liquidate
            const debtToCover = await allocateAndApproveTokens(
              meld,
              owner,
              liquidator,
              lendingPool,
              500n, // equal to principal variable debt
              0n
            );

            // Simulate debt token price increase so that debt is liquidatable
            const [currentPrice, success] = await meldPriceOracle.getAssetPrice(
              await meld.getAddress()
            );

            expect(success).to.be.true;

            await meldPriceOracle
              .connect(oracleAdmin)
              .setAssetPrice(await meld.getAddress(), currentPrice * 4n);

            // Get USDC reserve data before liquidation
            const usdcReserveDataBeforeLiquidation: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await usdc.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get MELD reserve data before liquidation
            const meldReserveDataBeforeLiquidation: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get borrower MELD reserve data before liquidation
            const borrowerMELDDataBeforeLiquidation: UserReserveData =
              await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await meld.getAddress(),
                borrower.address
              );

            // Get borrower account data (over all reserves) before liquidation
            const borrowerAccountDataBefore =
              await lendingPool.getUserAccountData(borrower.address);

            // Get liquidator USDC reserve data before liquidation
            const liquidatorUSDCDataBeforeLiquidation: UserReserveData =
              await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await usdc.getAddress(),
                liquidator.address
              );

            expect(liquidatorUSDCDataBeforeLiquidation.usageAsCollateralEnabled)
              .to.be.false;

            // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
            time.setNextBlockTimestamp(await time.latest());

            // Liquidator liquidates partial debt
            await lendingPool.connect(liquidator).liquidationCall(
              await usdc.getAddress(), // collateral asset
              await meld.getAddress(), // debt asset
              borrower.address,
              debtToCover,
              true // receive mToken
            );

            // Get USDC reserve data after liquidation
            const usdcReserveDataAfterLiquidation: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await usdc.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get MELD reserve data after liquidation
            const meldReserveDataAfterLiquidation: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get borrower MELD reserve data after liquidation
            const borrowerMELDDataAfterLiquidation: UserReserveData =
              await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await meld.getAddress(),
                borrower.address
              );

            // Get borrower account data (over all reserves) after liquidation
            const borrowerAccountDataAfter =
              await lendingPool.getUserAccountData(borrower.address);

            // Get liquidator USDC reserve data after liquidation
            const liquidatorUSDCDataAfterLiquidation: UserReserveData =
              await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await usdc.getAddress(),
                liquidator.address
              );

            // Check state //

            // borrower's health factor should go up after liquidation
            expect(borrowerAccountDataAfter.healthFactor).to.be.greaterThan(
              borrowerAccountDataBefore.healthFactor
            );

            // variable debt should be less after liquidation. Numbers are off by one digit because of difference in math in solidity and js
            expect(
              borrowerMELDDataAfterLiquidation.currentVariableDebt
            ).to.be.closeTo(
              borrowerMELDDataBeforeLiquidation.currentVariableDebt -
                debtToCover,
              1
            );

            // stable debt should be the same after liquidation because variable debt is liquidated first.
            expect(
              borrowerMELDDataAfterLiquidation.currentStableDebt
            ).to.be.equal(borrowerMELDDataBeforeLiquidation.currentStableDebt);

            // variable borrow index should be >= because interest may have accrued since last updateState
            expect(
              meldReserveDataAfterLiquidation.variableBorrowIndex
            ).to.be.greaterThanOrEqual(
              meldReserveDataBeforeLiquidation.variableBorrowIndex
            );

            // variable borrow rate should be lower after liquidation
            expect(
              meldReserveDataAfterLiquidation.variableBorrowRate
            ).to.be.lessThan(
              meldReserveDataBeforeLiquidation.variableBorrowRate
            );

            // available liquidity of the debt reserve should be higher after liquidation
            expect(
              meldReserveDataAfterLiquidation.availableLiquidity
            ).to.be.equal(
              meldReserveDataBeforeLiquidation.availableLiquidity + debtToCover
            );

            // the liquidity index of the debt reserve should be greater than or equal the index before
            expect(
              meldReserveDataAfterLiquidation.liquidityIndex
            ).to.be.greaterThanOrEqual(
              meldReserveDataBeforeLiquidation.liquidityIndex
            );

            // the principal APY after a liquidation should belower than the APY before
            expect(
              meldReserveDataAfterLiquidation.liquidityRate
            ).to.be.lessThan(meldReserveDataBeforeLiquidation.liquidityRate);

            // available liquidity of the collateral reserve should be the same after liquidation (mTokens changed ownership but not burned)
            expect(
              usdcReserveDataAfterLiquidation.availableLiquidity
            ).to.be.equal(usdcReserveDataBeforeLiquidation.availableLiquidity);

            // liquidator should now have USDC as collateral
            expect(liquidatorUSDCDataAfterLiquidation.usageAsCollateralEnabled)
              .to.be.true;
          });

          it("Should update state correctly when variable debt < actual debt to liquidate", async function () {
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              meldPriceOracle,
              meld,
              usdc,
              owner,
              borrower,
              liquidator,
              oracleAdmin,
            } = await loadFixture(setUpSingleStableBorrowMELDFixture);

            // Borrower borrows MELD again at variable rate. Stable debt is 2000 MELD
            const borrowAmount = await convertToCurrencyDecimals(
              await meld.getAddress(),
              "800"
            );

            // Borrow MELD again at variable rate
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
            await time.increase(ONE_YEAR / 2);

            // Liquidator deposits USDC collateral (ensures liquidator has a balance of USDC mTokens)
            const depositAmountUSDC = await allocateAndApproveTokens(
              usdc,
              owner,
              liquidator,
              lendingPool,
              500n,
              0n
            );

            await lendingPool
              .connect(liquidator)
              .deposit(
                await usdc.getAddress(),
                depositAmountUSDC,
                liquidator.address,
                true,
                0
              );

            // Make sure liquidator has funds with which to liquidate
            await allocateAndApproveTokens(
              meld,
              owner,
              liquidator,
              lendingPool,
              3000n,
              0n
            );

            // Simulate debt token price increase so that debt is liquidatable
            const [currentPrice, success] = await meldPriceOracle.getAssetPrice(
              await meld.getAddress()
            );

            expect(success).to.be.true;

            await meldPriceOracle
              .connect(oracleAdmin)
              .setAssetPrice(await meld.getAddress(), currentPrice * 4n);

            // Get USDC reserve data before liquidation
            const usdcReserveDataBeforeLiquidation: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await usdc.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get MELD reserve data before liquidation
            const meldReserveDataBeforeLiquidation: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get borrower MELD reserve data before liquidation
            const borrowerMELDDataBeforeLiquidation: UserReserveData =
              await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await meld.getAddress(),
                borrower.address
              );

            // Get borrower account data (over all reserves) before liquidation
            const borrowerAccountDataBefore =
              await lendingPool.getUserAccountData(borrower.address);

            // Get liquidator USDC reserve data before liquidation
            const liquidatorUSDCDataBeforeLiquidation: UserReserveData =
              await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await usdc.getAddress(),
                liquidator.address
              );

            expect(liquidatorUSDCDataBeforeLiquidation.usageAsCollateralEnabled)
              .to.be.true;

            // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
            time.setNextBlockTimestamp(await time.latest());

            // Liquidator liquidates all liquidatable debt (up to close factor)
            await lendingPool.connect(liquidator).liquidationCall(
              await usdc.getAddress(), // collateral asset
              await meld.getAddress(), // debt asset
              borrower.address,
              MaxUint256, // flag for all liquidatable debt
              true // receive mToken
            );

            // Get USDC reserve data after liquidation
            const usdcReserveDataAfterLiquidation: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await usdc.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get MELD reserve data after liquidation
            const meldReserveDataAfterLiquidation: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get borrower MELD reserve data after liquidation
            const borrowerMELDDataAfterLiquidation: UserReserveData =
              await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await meld.getAddress(),
                borrower.address
              );

            // Get borrower account data (over all reserves) after liquidation
            const borrowerAccountDataAfter =
              await lendingPool.getUserAccountData(borrower.address);

            // Get liquidator MELD reserve data after liquidation
            const liquidatorUSDCDataAfterLiquidation: UserReserveData =
              await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await usdc.getAddress(),
                liquidator.address
              );

            const maxLiquidatableDebt = (
              borrowerMELDDataBeforeLiquidation.currentStableDebt +
              borrowerMELDDataBeforeLiquidation.currentVariableDebt
            ).percentMul(LIQUIDATION_CLOSE_FACTOR_PERCENT);

            // Check state //

            // borrower's health factor should go up after liquidation
            expect(borrowerAccountDataAfter.healthFactor).to.be.greaterThan(
              borrowerAccountDataBefore.healthFactor
            );

            // health factor should be >= 1 after liquidation
            expect(
              borrowerAccountDataAfter.healthFactor
            ).to.be.greaterThanOrEqual(_1e18); // health factor is expressed with 18 decimals (1e18)

            // variable debt should be 0 after liquidation because all debt is being liquidated
            expect(
              borrowerMELDDataAfterLiquidation.currentVariableDebt
            ).to.be.equal(0n);

            // stable debt should be 0 after liquidation because all debt is being liquidated
            expect(
              borrowerMELDDataAfterLiquidation.currentStableDebt
            ).to.be.equal(0);

            // variable borrow index should be >= because interest may have accrued since last updateState
            expect(
              meldReserveDataAfterLiquidation.variableBorrowIndex
            ).to.be.greaterThanOrEqual(
              meldReserveDataBeforeLiquidation.variableBorrowIndex
            );

            // variable borrow rate should be lower after liquidation
            expect(
              meldReserveDataAfterLiquidation.variableBorrowRate
            ).to.be.lessThan(
              meldReserveDataBeforeLiquidation.variableBorrowRate
            );

            // available liquidity of the debt reserve should be greater after liquidation
            expect(
              meldReserveDataAfterLiquidation.availableLiquidity
            ).to.be.equal(
              meldReserveDataBeforeLiquidation.availableLiquidity +
                maxLiquidatableDebt
            );

            // the liquidity index of the debt reserve should be greater than or equal tothe index before
            expect(
              meldReserveDataAfterLiquidation.liquidityIndex
            ).to.be.greaterThanOrEqual(
              meldReserveDataBeforeLiquidation.liquidityIndex
            );

            // the principal APY after a liquidation should belower than the APY before
            expect(
              meldReserveDataAfterLiquidation.liquidityRate
            ).to.be.lessThan(meldReserveDataBeforeLiquidation.liquidityRate);

            // available liquidity of the collateral reserve should be the same after liquidation (mTokens changed ownership but not burned)
            expect(
              usdcReserveDataAfterLiquidation.availableLiquidity
            ).to.be.equal(usdcReserveDataBeforeLiquidation.availableLiquidity);

            // liquidator should still have USDC as collateral
            expect(liquidatorUSDCDataAfterLiquidation.usageAsCollateralEnabled)
              .to.be.true;
          });

          it("Should update token balances correctly when variable debt > actual debt to liquidate", async function () {
            const {
              lendingPool,
              meldProtocolDataProvider,
              meldPriceOracle,
              meld,
              usdc,
              owner,
              borrower2,
              liquidator,
              treasury,
              oracleAdmin,
            } = await loadFixture(setUpSingleVariableBorrowUSDCFixture);

            // Simulate time passing so owed interest will accrue
            await time.increase(ONE_YEAR * 1.5);

            // Borrower borrows USDC again at stable rate. Variable debt is 400 USDC
            const borrowAmount = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "200"
            );

            await lendingPool
              .connect(borrower2)
              .borrow(
                await usdc.getAddress(),
                borrowAmount,
                RateMode.Stable,
                borrower2.address,
                0
              );

            // Simulate time passing so owed interest will accrue
            await time.increase(ONE_YEAR);

            // Instantiate collateral reserve token contracts
            const meldReserveTokenAddresses =
              await meldProtocolDataProvider.getReserveTokensAddresses(
                await meld.getAddress()
              );

            const mMELD = await ethers.getContractAt(
              "MToken",
              meldReserveTokenAddresses.mTokenAddress
            );

            // Instantiate debt reserve token contracts
            const usdcReserveTokenAddresses =
              await meldProtocolDataProvider.getReserveTokensAddresses(
                await usdc.getAddress()
              );

            const stableDebtToken = await ethers.getContractAt(
              "StableDebtToken",
              usdcReserveTokenAddresses.stableDebtTokenAddress
            );

            const variableDebtToken = await ethers.getContractAt(
              "VariableDebtToken",
              usdcReserveTokenAddresses.variableDebtTokenAddress
            );

            // Make sure liquidator has funds with which to liquidate
            const debtToCover = await allocateAndApproveTokens(
              usdc,
              owner,
              liquidator,
              lendingPool,
              200n, // partial debt
              0n
            );

            // Simulate price of collateral (MELD) going down drastically so that position is liquidatable
            await simulateAssetPriceCrash(
              meld,
              meldPriceOracle,
              2n,
              oracleAdmin
            );

            // Get token balances before liquidation
            const borrowerVariableDebtBalanceBeforeLiquidation =
              await variableDebtToken.balanceOf(borrower2.address);
            const borrowerStableDebtBalanceBeforeLiquidation =
              await stableDebtToken.balanceOf(borrower2.address);
            const borrowerMMELDBalanceBeforeLiquidation = await mMELD.balanceOf(
              borrower2.address
            );
            const mTokenBalanceBeforeLiquidation = await usdc.balanceOf(
              usdcReserveTokenAddresses.mTokenAddress
            );
            const liquidatorMMELDBalanceBeforeLiquidation =
              await mMELD.balanceOf(liquidator.address);
            const treasuryMMELDBalanceBeforeLiquidation = await mMELD.balanceOf(
              treasury.address
            );

            // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
            time.setNextBlockTimestamp(await time.latest());

            // Liquidator liquidates partial debt
            await lendingPool.connect(liquidator).liquidationCall(
              await meld.getAddress(), // collateral asset
              await usdc.getAddress(), // debt asset
              borrower2.address,
              debtToCover,
              true // receive mToken
            );

            const { liquidationMultiplier, actualLiquidationProtocolFee } =
              await calcLiquidationMultiplierParams(
                meld,
                lendingPool,
                meldProtocolDataProvider
              );

            const maxLiquidatableCollateral =
              await calcMaxLiquidatableCollateral(
                meld,
                usdc,
                meldPriceOracle,
                liquidationMultiplier,
                debtToCover
              );

            const liquidationProtocolFeeAmount =
              actualLiquidationProtocolFee.percentMul(
                maxLiquidatableCollateral
              );

            const liquidatorAmount =
              maxLiquidatableCollateral - liquidationProtocolFeeAmount;

            // Get token balances after liquidation
            const borrowerVariableDebtBalanceAfterLiquidation =
              await variableDebtToken.balanceOf(borrower2.address);
            const borrowerStableDebtBalanceAfterLiquidation =
              await stableDebtToken.balanceOf(borrower2.address);
            const borrowerMMELDBalanceAfterLiquidation = await mMELD.balanceOf(
              borrower2.address
            );
            const mTokenBalanceAfterLiquidation = await usdc.balanceOf(
              usdcReserveTokenAddresses.mTokenAddress
            );
            const liquidatorMMELDBalanceAfterLiquidation =
              await mMELD.balanceOf(liquidator.address);
            const treasuryMMELDBalanceAfterLiquidation = await mMELD.balanceOf(
              treasury.address
            );
            const liquidatorMELDBalanceAfterLiquidation = await meld.balanceOf(
              liquidator.address
            );

            // Check token balances //

            // borrower variable debt balance should be lower after liquidation. Numbers are off by one digit because of difference in math in solidity and js
            expect(borrowerVariableDebtBalanceAfterLiquidation).to.be.closeTo(
              borrowerVariableDebtBalanceBeforeLiquidation - debtToCover,
              1
            );

            // borrower stable debt balance should be the same after liquidation
            expect(borrowerStableDebtBalanceAfterLiquidation).to.be.equal(
              borrowerStableDebtBalanceBeforeLiquidation
            );

            // debt mToken balance should be higher after liquidation
            expect(mTokenBalanceAfterLiquidation).to.be.equal(
              mTokenBalanceBeforeLiquidation + debtToCover
            );

            // borrower collateral mToken balance should be lower after liquidation
            expect(borrowerMMELDBalanceAfterLiquidation).to.be.equal(
              borrowerMMELDBalanceBeforeLiquidation - maxLiquidatableCollateral
            );

            // liquidator collateral mToken balance should be higher after liquidation
            expect(liquidatorMMELDBalanceAfterLiquidation).to.be.equal(
              liquidatorMMELDBalanceBeforeLiquidation + liquidatorAmount
            );

            // treasury collateral mToken balance should be higher after liquidation
            expect(treasuryMMELDBalanceAfterLiquidation).to.be.equal(
              treasuryMMELDBalanceBeforeLiquidation +
                liquidationProtocolFeeAmount
            );

            // liquidator underlying collateral token balance should be same after liquidation because liquidator received mTokens, not underlying asset
            expect(liquidatorMELDBalanceAfterLiquidation).to.be.equal(0n);
          });

          it("Should update token balances correctly when variable debt == actual debt to liquidate", async function () {
            const {
              lendingPool,
              meldProtocolDataProvider,
              meldPriceOracle,
              meld,
              usdc,
              owner,
              borrower,
              liquidator,
              treasury,
              oracleAdmin,
            } = await loadFixture(setUpSingleStableBorrowMELDFixture);

            // Borrower borrows MELD again at variable rate. Stable debt is 2000 MELD
            const borrowAmount = await convertToCurrencyDecimals(
              await meld.getAddress(),
              "500"
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

            // Instantiate debt reserve token contracts
            const meldReserveTokenAddresses =
              await meldProtocolDataProvider.getReserveTokensAddresses(
                await meld.getAddress()
              );

            const variableDebtToken = await ethers.getContractAt(
              "VariableDebtToken",
              meldReserveTokenAddresses.variableDebtTokenAddress
            );

            const stableDebtToken = await ethers.getContractAt(
              "StableDebtToken",
              meldReserveTokenAddresses.stableDebtTokenAddress
            );

            // Instantiate collateral reserve token contracts
            const usdcReserveTokenAddresses =
              await meldProtocolDataProvider.getReserveTokensAddresses(
                await usdc.getAddress()
              );

            const mUSDC = await ethers.getContractAt(
              "MToken",
              usdcReserveTokenAddresses.mTokenAddress
            );

            // Make sure liquidator has funds with which to liquidate
            const debtToCover = await allocateAndApproveTokens(
              meld,
              owner,
              liquidator,
              lendingPool,
              500n, // equal to principal variable debt
              0n
            );

            // Simulate price of collateral (USDC) going down drastically so that position is liquidatable
            // In reality, USDC is not likely to so drastically go down in value, but this is the easist way to
            // get the health factor < 1
            await simulateAssetPriceCrash(
              usdc,
              meldPriceOracle,
              5n,
              oracleAdmin
            );

            // Get token balances before liquidation
            const borrowerVariableDebtBalanceBeforeLiquidation =
              await variableDebtToken.balanceOf(borrower.address);
            const borrowerStableDebtBalanceBeforeLiquidation =
              await stableDebtToken.balanceOf(borrower.address);
            const borrowerMUSDCBalanceBeforeLiquidation = await mUSDC.balanceOf(
              borrower.address
            );
            const mTokenBalanceBeforeLiquidation = await meld.balanceOf(
              meldReserveTokenAddresses.mTokenAddress
            );
            const liquidatorMUSDCBalanceBeforeLiquidation =
              await mUSDC.balanceOf(liquidator.address);
            const treasuryMUSDCBalanceBeforeLiquidation = await mUSDC.balanceOf(
              treasury.address
            );

            // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
            time.setNextBlockTimestamp(await time.latest());

            // Liquidator liquidates partial debt
            await lendingPool.connect(liquidator).liquidationCall(
              await usdc.getAddress(), // collateral asset
              await meld.getAddress(), // debt asset
              borrower.address,
              debtToCover,
              true // receive mToken
            );

            const { liquidationMultiplier, actualLiquidationProtocolFee } =
              await calcLiquidationMultiplierParams(
                usdc,
                lendingPool,
                meldProtocolDataProvider
              );

            const maxLiquidatableCollateral =
              await calcMaxLiquidatableCollateral(
                usdc,
                meld,
                meldPriceOracle,
                liquidationMultiplier,
                debtToCover
              );

            const liquidationProtocolFeeAmount =
              actualLiquidationProtocolFee.percentMul(
                maxLiquidatableCollateral
              );

            const liquidatorAmount =
              maxLiquidatableCollateral - liquidationProtocolFeeAmount;

            // Get token balances after liquidation
            const borrowerVariableDebtBalanceAfterLiquidation =
              await variableDebtToken.balanceOf(borrower.address);
            const borrowerStableDebtBalanceAfterLiquidation =
              await stableDebtToken.balanceOf(borrower.address);
            const borrowerMUSDCBalanceAfterLiquidation = await mUSDC.balanceOf(
              borrower.address
            );
            const mTokenBalanceAfterLiquidation = await meld.balanceOf(
              meldReserveTokenAddresses.mTokenAddress
            );
            const liquidatorMUSDCBalanceAfterLiquidation =
              await mUSDC.balanceOf(liquidator.address);
            const treasuryMUSDCBalanceAfterLiquidation = await mUSDC.balanceOf(
              treasury.address
            );
            const liquidatorUSDCBalanceAfterLiquidation = await usdc.balanceOf(
              liquidator.address
            );

            // Check token balances //

            // borrower variable debt balance should be lower after liquidation. Numbers are off by one digit because of difference in math in solidity and js
            expect(borrowerVariableDebtBalanceAfterLiquidation).to.be.closeTo(
              borrowerVariableDebtBalanceBeforeLiquidation - debtToCover,
              1
            );

            // borrower stable debt balance should be the same after liquidation
            expect(borrowerStableDebtBalanceAfterLiquidation).to.be.equal(
              borrowerStableDebtBalanceBeforeLiquidation
            );

            // debt mToken balance should be higher after liquidation
            expect(mTokenBalanceAfterLiquidation).to.be.equal(
              mTokenBalanceBeforeLiquidation + debtToCover
            );

            // borrower collateral mToken balance should be lower after liquidation
            expect(borrowerMUSDCBalanceAfterLiquidation).to.be.equal(
              borrowerMUSDCBalanceBeforeLiquidation - maxLiquidatableCollateral
            );

            // liquidator collateral mToken balance should be higher after liquidation
            expect(liquidatorMUSDCBalanceAfterLiquidation).to.be.equal(
              liquidatorMUSDCBalanceBeforeLiquidation + liquidatorAmount
            );

            // treasury collateral mToken balance should be higher after liquidation
            expect(treasuryMUSDCBalanceAfterLiquidation).to.be.equal(
              treasuryMUSDCBalanceBeforeLiquidation +
                liquidationProtocolFeeAmount
            );

            // liquidator underlying collateral token balance should be same after liquidation because liquidator received mTokens, not underlying asset
            expect(liquidatorUSDCBalanceAfterLiquidation).to.be.equal(0n);
          });

          it("Should update token balances correctly when variable debt < actual debt to liquidate", async function () {
            const {
              lendingPool,
              meldProtocolDataProvider,
              meldPriceOracle,
              meld,
              usdc,
              owner,
              borrower,
              liquidator,
              treasury,
              oracleAdmin,
            } = await loadFixture(setUpSingleStableBorrowMELDFixture);

            // Simulate time passing so owed interest will accrue
            await time.increase(ONE_YEAR);

            // Borrower borrows MELD again at variable rate. Stable debt is 2000 MELD
            const borrowAmount = await convertToCurrencyDecimals(
              await meld.getAddress(),
              "100"
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
            await time.increase(ONE_YEAR / 2);

            // Instantiate debt reserve token contracts
            const meldReserveTokenAddresses =
              await meldProtocolDataProvider.getReserveTokensAddresses(
                await meld.getAddress()
              );

            const variableDebtToken = await ethers.getContractAt(
              "VariableDebtToken",
              meldReserveTokenAddresses.variableDebtTokenAddress
            );

            const stableDebtToken = await ethers.getContractAt(
              "StableDebtToken",
              meldReserveTokenAddresses.stableDebtTokenAddress
            );

            // Instantiate collateral reserve token contracts
            const usdcReserveTokenAddresses =
              await meldProtocolDataProvider.getReserveTokensAddresses(
                await usdc.getAddress()
              );

            const mUSDC = await ethers.getContractAt(
              "MToken",
              usdcReserveTokenAddresses.mTokenAddress
            );

            // Make sure liquidator has funds with which to liquidate
            await allocateAndApproveTokens(
              meld,
              owner,
              liquidator,
              lendingPool,
              2500n,
              0n
            );

            // Simulate price of collateral (USDC) going down drastically so that position is liquidatable
            // In reality, USDC is not likely to so drastically go down in value, but this is the easist way to
            // get the health factor < 1
            await simulateAssetPriceCrash(
              usdc,
              meldPriceOracle,
              5n,
              oracleAdmin
            );

            // Get token balances before liquidation
            const borrowerMUSDCBalanceBeforeLiquidation = await mUSDC.balanceOf(
              borrower.address
            );
            const mTokenBalanceBeforeLiquidation = await meld.balanceOf(
              meldReserveTokenAddresses.mTokenAddress
            );
            const liquidatorMUSDCBalanceBeforeLiquidation =
              await mUSDC.balanceOf(liquidator.address);
            const treasuryMUSDCBalanceBeforeLiquidation = await mUSDC.balanceOf(
              treasury.address
            );

            // Get borrower MELD reserve data before liquidation
            const borrowerMELDDataBeforeLiquidation: UserReserveData =
              await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await meld.getAddress(),
                borrower.address
              );

            // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
            time.setNextBlockTimestamp(await time.latest());

            // Liquidator liquidates all liquidatable debt (up to close factor)
            await lendingPool.connect(liquidator).liquidationCall(
              await usdc.getAddress(), // collateral asset
              await meld.getAddress(), // debt asset
              borrower.address,
              MaxUint256, // flag for all liquidatable debt
              true // receive mToken
            );

            const maxLiquidatableDebt = (
              borrowerMELDDataBeforeLiquidation.currentStableDebt +
              borrowerMELDDataBeforeLiquidation.currentVariableDebt
            ).percentMul(LIQUIDATION_CLOSE_FACTOR_PERCENT);

            const { liquidationMultiplier, actualLiquidationProtocolFee } =
              await calcLiquidationMultiplierParams(
                usdc,
                lendingPool,
                meldProtocolDataProvider
              );

            const maxLiquidatableCollateral =
              await calcMaxLiquidatableCollateral(
                usdc,
                meld,
                meldPriceOracle,
                liquidationMultiplier,
                maxLiquidatableDebt
              );

            const liquidationProtocolFeeAmount =
              actualLiquidationProtocolFee.percentMul(
                maxLiquidatableCollateral
              );

            const liquidatorAmount =
              maxLiquidatableCollateral - liquidationProtocolFeeAmount;

            // Get token balances after liquidation
            const borrowerVariableDebtBalanceAfterLiquidation =
              await variableDebtToken.balanceOf(borrower.address);
            const borrowerStableDebtBalanceAfterLiquidation =
              await stableDebtToken.balanceOf(borrower.address);
            const borrowerMUSDCBalanceAfterLiquidation = await mUSDC.balanceOf(
              borrower.address
            );
            const mTokenBalanceAfterLiquidation = await meld.balanceOf(
              meldReserveTokenAddresses.mTokenAddress
            );
            const liquidatorMUSDCBalanceAfterLiquidation =
              await mUSDC.balanceOf(liquidator.address);
            const treasuryMUSDCBalanceAfterLiquidation = await mUSDC.balanceOf(
              treasury.address
            );
            const liquidatorUSDCBalanceAfterLiquidation = await usdc.balanceOf(
              liquidator.address
            );

            // Check token balances //

            // Variable debt should be 0 after liquidation
            expect(borrowerVariableDebtBalanceAfterLiquidation).to.equal(0n);

            // borrower stable debt balance should be the stable debt before liquidation minus variable debt before liquidation. Variable debt was completely liquidated as first step in liquidation.
            expect(borrowerStableDebtBalanceAfterLiquidation).to.be.equal(
              borrowerMELDDataBeforeLiquidation.currentStableDebt -
                (maxLiquidatableDebt -
                  borrowerMELDDataBeforeLiquidation.currentVariableDebt)
            );

            // debt mToken balance should be higher after liquidation
            expect(mTokenBalanceAfterLiquidation).to.be.equal(
              mTokenBalanceBeforeLiquidation + maxLiquidatableDebt
            );

            // borrower collateral mToken balance should be lower after liquidation
            expect(borrowerMUSDCBalanceAfterLiquidation).to.be.equal(
              borrowerMUSDCBalanceBeforeLiquidation - maxLiquidatableCollateral
            );

            // liquidator collateral mToken balance should be higher after liquidation
            expect(liquidatorMUSDCBalanceAfterLiquidation).to.be.equal(
              liquidatorMUSDCBalanceBeforeLiquidation + liquidatorAmount
            );

            // treasury collateral mToken balance should be higher after liquidation
            expect(treasuryMUSDCBalanceAfterLiquidation).to.be.equal(
              treasuryMUSDCBalanceBeforeLiquidation +
                liquidationProtocolFeeAmount
            );

            // liquidator underlying collateral token balance should be same after liquidation because liquidator received mTokens, not underlying asset
            expect(liquidatorUSDCBalanceAfterLiquidation).to.be.equal(0n);
          });
        }
      ); // End Liquidate When Borrower has combination of Stable and Variable Debt for Same Debt Asset Context

      context(
        "Liquidate When Borrower has Combination of Stable and Variable Debt for Different Debt assets and Multiple Collateral Assets",
        async function () {
          // These test cases have USDT and USDC as debt assets and both MELD and DAI as collateral assets.
          // USDT debt = 1250, DAI collateral = 2000, MELD collateral = 500
          // This context has a subset of test cases from previous contexts

          it("Should emit correct events for correct assets", async function () {
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              meldPriceOracle,
              tether,
              dai,
              meld,
              usdc,
              owner,
              borrower3,
              liquidator,
              treasury,
              oracleAdmin,
            } = await loadFixture(setUpSingleVariableBorrowTetherFixture);
            // Borrower has deposited DAI and MELD as collateral

            // Simulate time passing so owed interest will accrue
            await time.increase(ONE_YEAR / 12);

            // Borrower borrows USDC at stable rate. Variable debt is 1250 Tether
            const borrowAmount = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "450"
            );

            // Borrow USDC at stable rate
            await lendingPool
              .connect(borrower3)
              .borrow(
                await usdc.getAddress(),
                borrowAmount,
                RateMode.Stable,
                borrower3.address,
                0
              );

            // Simulate time passing so owed interest will accrue
            await time.increase(ONE_YEAR / 4);

            // Instantiate collateral reserve token contracts
            const meldReserveTokenAddresses =
              await meldProtocolDataProvider.getReserveTokensAddresses(
                await meld.getAddress()
              );

            const mMELD = await ethers.getContractAt(
              "MToken",
              meldReserveTokenAddresses.mTokenAddress
            );

            const daiReserveTokenAddresses =
              await meldProtocolDataProvider.getReserveTokensAddresses(
                await dai.getAddress()
              );

            const mDAI = await ethers.getContractAt(
              "MToken",
              daiReserveTokenAddresses.mTokenAddress
            );

            // Instantiate debt reserve token contracts
            const usdcReserveTokenAddresses =
              await meldProtocolDataProvider.getReserveTokensAddresses(
                await usdc.getAddress()
              );

            const mUSDC = await ethers.getContractAt(
              "MToken",
              usdcReserveTokenAddresses.mTokenAddress
            );

            const usdcVariableDebtToken = await ethers.getContractAt(
              "VariableDebtToken",
              usdcReserveTokenAddresses.variableDebtTokenAddress
            );

            const usdcStableDebtToken = await ethers.getContractAt(
              "StableDebtToken",
              usdcReserveTokenAddresses.stableDebtTokenAddress
            );

            const tetherReserveTokenAddresses =
              await meldProtocolDataProvider.getReserveTokensAddresses(
                await tether.getAddress()
              );

            const mTether = await ethers.getContractAt(
              "MToken",
              tetherReserveTokenAddresses.mTokenAddress
            );

            const tetherVariableDebtToken = await ethers.getContractAt(
              "VariableDebtToken",
              tetherReserveTokenAddresses.variableDebtTokenAddress
            );

            const tetherStableDebtToken = await ethers.getContractAt(
              "StableDebtToken",
              tetherReserveTokenAddresses.stableDebtTokenAddress
            );

            // Make sure liquidator has funds with which to liquidate Tether debt
            const debtToCover = await allocateAndApproveTokens(
              tether,
              owner,
              liquidator,
              lendingPool,
              150n, // part of principal debt
              0n
            );

            // Simulate price of collateral (MELD) going down so that position is liquidatable
            const [currentPrice, success] = await meldPriceOracle.getAssetPrice(
              await meld.getAddress()
            );

            expect(success).to.be.true;
            const newPrice = (10n * currentPrice) / 23n; // price goes down by 2.3 times (currentPrice/2.3). workaround because can't use decimals with bigint
            await meldPriceOracle
              .connect(oracleAdmin)
              .setAssetPrice(await meld.getAddress(), newPrice);

            // Get Tether reserve data before liquidation
            const tetherReserveDataBeforeLiquidation: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await tether.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Liquidator liquidates the Tether debt and receives MELD collateral
            const liquidationTx = await lendingPool
              .connect(liquidator)
              .liquidationCall(
                await meld.getAddress(), // collateral asset
                await tether.getAddress(), // debt asset
                borrower3.address,
                debtToCover,
                true // receive mToken
              );

            const blockTimestamps: BlockTimestamps =
              await getBlockTimestamps(liquidationTx);

            // Get MELD reserve data after liquidation
            const meldReserveDataAfterLiquidation: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get Tether reserve data after liquidation
            const tetherReserveDataAfterLiquidation: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await tether.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Check that the correct events were emitted //

            // Tether variable debt token should emit events, but not stable debt token
            // USDC reserve's debt tokens should not emit events
            await expect(liquidationTx)
              .to.emit(tetherVariableDebtToken, "Transfer")
              .withArgs(borrower3.address, ZeroAddress, debtToCover);

            await expect(liquidationTx)
              .to.emit(tetherVariableDebtToken, "Burn")
              .withArgs(
                borrower3.address,
                debtToCover,
                tetherReserveDataAfterLiquidation.variableBorrowIndex
              );

            await expect(liquidationTx).to.not.emit(
              tetherStableDebtToken,
              "Transfer"
            ); // not liquidating stable debt because variable debt > actual debt to liquidate
            await expect(liquidationTx).to.not.emit(
              tetherStableDebtToken,
              "Burn"
            ); // not liquidating stable debt because variable debt > actual debt to liquidate
            await expect(liquidationTx).to.not.emit(
              tetherStableDebtToken,
              "Mint"
            ); // not liquidating stable debt because variable debt > actual debt to liquidate

            await expect(liquidationTx).to.not.emit(
              usdcVariableDebtToken,
              "Transfer"
            ); // not liquidating usdc debt
            await expect(liquidationTx).to.not.emit(
              usdcVariableDebtToken,
              "Burn"
            ); // not liquidating usdc debt
            await expect(liquidationTx).to.not.emit(
              usdcVariableDebtToken,
              "Mint"
            ); // not liquidating usdc debt

            await expect(liquidationTx).to.not.emit(
              usdcStableDebtToken,
              "Transfer"
            ); // not liquidating usdc debt
            await expect(liquidationTx).to.not.emit(
              usdcStableDebtToken,
              "Burn"
            ); // not liquidating usdc debt
            await expect(liquidationTx).to.not.emit(
              usdcStableDebtToken,
              "Mint"
            ); // not liquidating usdc debt

            // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
            const contractInstanceWithLibraryABI = await ethers.getContractAt(
              "ReserveLogic",
              await lendingPool.getAddress(),
              owner
            );

            // The important thing here is checking that the event is emitted for the debt token. The values are checked in other test files.
            await expect(liquidationTx)
              .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
              .withArgs(
                await tether.getAddress(),
                anyUint,
                anyUint,
                anyUint,
                anyUint,
                anyUint
              );

            // Mint to treasury because debt token (Tether) has reserveFactor > 0 and debt has accrued
            const currentVariableDebt =
              tetherReserveDataBeforeLiquidation.totalVariableDebt;
            const previousVariableDebt =
              tetherReserveDataBeforeLiquidation.scaledVariableDebt;
            const currentStableDebt = 0n;
            const previousStableDebt = 0n;

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

            await expect(liquidationTx)
              .to.emit(mTether, "Transfer")
              .withArgs(
                ZeroAddress,
                treasury.address,
                isAlmostEqual(amountToMint)
              );

            await expect(liquidationTx)
              .to.emit(mTether, "Mint")
              .withArgs(
                treasury.address,
                isAlmostEqual(amountToMint),
                tetherReserveDataAfterLiquidation.liquidityIndex
              );

            // No mint to treasury of mUSDC because USDC debt not liquidated
            await expect(liquidationTx).to.not.emit(mUSDC, "Transfer");
            await expect(liquidationTx).to.not.emit(mUSDC, "Mint");

            // No mint to treasury of mMELD because liquidator elected to receive collateral in mTokens.
            // Can't check Transfer to treasury event not emitted because it is emitted when liquidator receives mTokens
            // It's not possible to check "not emit" with arguments
            await expect(liquidationTx).to.not.emit(mMELD, "Mint");

            // No mint to treasury of mDAI because DAI not involved in liquidation
            await expect(liquidationTx).to.not.emit(mDAI, "Transfer");
            await expect(liquidationTx).to.not.emit(mDAI, "Mint");

            const { liquidationMultiplier, actualLiquidationProtocolFee } =
              await calcLiquidationMultiplierParams(
                meld,
                lendingPool,
                meldProtocolDataProvider
              );

            const maxLiquidatableCollateral =
              await calcMaxLiquidatableCollateral(
                meld,
                usdc,
                meldPriceOracle,
                liquidationMultiplier,
                debtToCover
              );

            const liquidationProtocolFeeAmount =
              actualLiquidationProtocolFee.percentMul(
                maxLiquidatableCollateral
              );

            const liquidatorAmount =
              maxLiquidatableCollateral - liquidationProtocolFeeAmount;

            // Events emitted when liquidator receives collateral mToken
            const liquidityIndex = calcExpectedReserveNormalizedIncome(
              meldReserveDataAfterLiquidation,
              blockTimestamps.txTimestamp
            );

            await expect(liquidationTx)
              .to.emit(mMELD, "BalanceTransfer")
              .withArgs(
                borrower3.address,
                treasury.address,
                liquidationProtocolFeeAmount,
                liquidityIndex
              );

            await expect(liquidationTx)
              .to.emit(mMELD, "BalanceTransfer")
              .withArgs(
                borrower3.address,
                liquidator.address,
                liquidatorAmount,
                liquidityIndex
              );

            await expect(liquidationTx)
              .to.emit(mMELD, "Transfer")
              .withArgs(
                borrower3.address,
                treasury.address,
                liquidationProtocolFeeAmount
              );

            await expect(liquidationTx)
              .to.emit(mMELD, "Transfer")
              .withArgs(
                borrower3.address,
                liquidator.address,
                liquidatorAmount
              );

            // liquidator chose mTokens instead of underlying collateral asset
            await expect(liquidationTx).to.not.emit(meld, "Transfer");

            // Event emitted when debt token is transferred from liquidator to pay off debt
            await expect(liquidationTx)
              .to.emit(tether, "Transfer")
              .withArgs(
                liquidator.address,
                await mTether.getAddress(),
                debtToCover
              );

            // USDC debt not being liquidated
            await expect(liquidationTx).to.not.emit(usdc, "Transfer");

            // DAI collateral not being liquidated
            await expect(liquidationTx).to.not.emit(dai, "Transfer");

            // ReserveUsedAsCollateralDisabled and ReserveUsedAsCollateralEnabled Events are emitted by library LiquidationLogic.sol,
            // so we need to get the contract instance with the LiquidationLogic ABI
            const contractInstanceWithLogicLibraryABI =
              await ethers.getContractAt(
                "LiquidationLogic",
                await lendingPool.getAddress(),
                owner
              );

            // Event emitted when collateral token is set as collateral for liquidator because liquidator previously had 0 balance
            await expect(liquidationTx)
              .to.emit(
                contractInstanceWithLogicLibraryABI,
                "ReserveUsedAsCollateralEnabled"
              )
              .withArgs(await meld.getAddress(), liquidator.address);

            // borrower's balance of collateral mTokens did not go to 0
            await expect(liquidationTx).to.not.emit(
              contractInstanceWithLogicLibraryABI,
              "ReserveUsedAsCollateralDisabled"
            );

            // liquidator liquidates partial debt
            await expect(liquidationTx)
              .to.emit(contractInstanceWithLogicLibraryABI, "LiquidationCall")
              .withArgs(
                await meld.getAddress(),
                await tether.getAddress(),
                borrower3.address,
                debtToCover,
                maxLiquidatableCollateral,
                liquidator.address,
                true
              );
          });

          it("Should update state correctly for correct assets", async function () {
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              meldPriceOracle,
              tether,
              dai,
              usdc,
              owner,
              borrower3,
              liquidator,
              oracleAdmin,
            } = await loadFixture(setUpSingleVariableBorrowTetherFixture);
            // Borrower has deposited DAI and MELD as collateral

            // Simulate time passing so owed interest will accrue
            await time.increase(ONE_YEAR / 2);

            // Borrower borrows USDC at stable rate. Variable debt is 1250 Tether.
            const borrowAmount = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "450"
            );

            // Borrow USDC at stable rate
            await lendingPool
              .connect(borrower3)
              .borrow(
                await usdc.getAddress(),
                borrowAmount,
                RateMode.Stable,
                borrower3.address,
                0
              );

            // Simulate time passing so owed interest will accrue
            await time.increase(ONE_YEAR);

            // Liquidator deposits DAI collateral (ensures liquidator has a balance of DAI mTokens)
            const depositAmountDAI = await allocateAndApproveTokens(
              dai,
              owner,
              liquidator,
              lendingPool,
              100n,
              0n
            );

            await lendingPool
              .connect(liquidator)
              .deposit(
                await dai.getAddress(),
                depositAmountDAI,
                liquidator.address,
                true,
                0
              );

            // Make sure liquidator has funds with which to liquidate
            const debtToCover = await allocateAndApproveTokens(
              usdc,
              owner,
              liquidator,
              lendingPool,
              350n, // part of stable principal debt
              0n
            );

            const [currentPrice, success] = await meldPriceOracle.getAssetPrice(
              await dai.getAddress()
            );

            expect(success).to.be.true;

            // Simulate price of collateral (DAI) going down drastically so that position is liquidatable
            // In reality, DAI is not likely to so drastically go down in value, but this is the easist way to
            // get the health factor < 1
            const newPrice = (10n * currentPrice) / 11n; // price goes down by 1.1 times (currentPrice/1.1). workaround because can't use decimals with bigint
            await meldPriceOracle
              .connect(oracleAdmin)
              .setAssetPrice(await dai.getAddress(), newPrice);

            // Get USDC reserve data before liquidation
            const usdcReserveDataBeforeLiquidation: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await usdc.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get DAI reserve data before liquidation
            const daiReserveDataBeforeLiquidation: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await dai.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get borrower USDC reserve data before liquidation
            const borrowerUSDCDataBeforeLiquidation: UserReserveData =
              await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await usdc.getAddress(),
                borrower3.address
              );

            // Get borrower Tether reserve data before liquidation
            const borrowerTetherDataBeforeLiquidation: UserReserveData =
              await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await tether.getAddress(),
                borrower3.address
              );

            // Get borrower account data (over all reserves) before liquidation
            const borrowerAccountDataBefore =
              await lendingPool.getUserAccountData(borrower3.address);

            // Get liquidator DAI reserve data after liquidation
            const liquidatorDAIDataBeforeLiquidation: UserReserveData =
              await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await dai.getAddress(),
                liquidator.address
              );

            expect(liquidatorDAIDataBeforeLiquidation.usageAsCollateralEnabled)
              .to.be.true;

            // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
            time.setNextBlockTimestamp(await time.latest());

            // Liquidator liquidates partial USDC debt and receives DAI collateral
            await lendingPool.connect(liquidator).liquidationCall(
              await dai.getAddress(), // collateral asset
              await usdc.getAddress(), // debt asset
              borrower3.address,
              debtToCover,
              true // receive mToken
            );

            // Get USDC reserve data after liquidation
            const usdcReserveDataAfterLiquidation: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await usdc.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get DAI reserve data after liquidation
            const daiReserveDataAfterLiquidation: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await dai.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get borrower USDC reserve data after liquidation
            const borrowerUSDCDataAfterLiquidation: UserReserveData =
              await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await usdc.getAddress(),
                borrower3.address
              );

            // Get borrower Tether reserve data after liquidation
            const borrowerTetherDataAfterLiquidation: UserReserveData =
              await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await tether.getAddress(),
                borrower3.address
              );

            // Get borrower account data (over all reserves) after liquidation
            const borrowerAccountDataAfter =
              await lendingPool.getUserAccountData(borrower3.address);

            // Get liquidator DAI reserve data after liquidation
            const liquidatorDAIDataAfterLiquidation: UserReserveData =
              await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await dai.getAddress(),
                liquidator.address
              );

            // Check State //

            expect(borrowerAccountDataAfter.healthFactor).to.be.greaterThan(
              borrowerAccountDataBefore.healthFactor
            );

            // USDC stable debt should be lower after liquidation. Numbers are off by one digit because of difference in math in solidity and js
            expect(
              borrowerUSDCDataAfterLiquidation.currentStableDebt
            ).to.be.closeTo(
              borrowerUSDCDataBeforeLiquidation.currentStableDebt - debtToCover,
              1
            );

            // USDC variable debt should be the same after liquidation because borrower has no USDC variable debt
            expect(
              borrowerUSDCDataAfterLiquidation.currentVariableDebt
            ).to.be.equal(
              borrowerUSDCDataBeforeLiquidation.currentVariableDebt
            );

            // Tether stable debt should be the same after liquidation because Tether debt was not liquidated
            expect(
              borrowerTetherDataAfterLiquidation.currentStableDebt
            ).to.be.equal(
              borrowerTetherDataBeforeLiquidation.currentStableDebt
            );

            // Tether variable debt should be the same after liquidation because Tether debt was not liquidated
            expect(
              borrowerTetherDataAfterLiquidation.currentVariableDebt
            ).to.be.equal(
              borrowerTetherDataBeforeLiquidation.currentVariableDebt
            );

            // USDC stable borrow rate should be lower after liquidation
            expect(
              usdcReserveDataAfterLiquidation.stableBorrowRate
            ).to.be.lessThan(usdcReserveDataBeforeLiquidation.stableBorrowRate);

            // USDC average stable borrow rate should be same or lower after liquidation
            expect(
              usdcReserveDataAfterLiquidation.averageStableBorrowRate
            ).to.be.lessThanOrEqual(
              usdcReserveDataBeforeLiquidation.averageStableBorrowRate
            );

            // available liquidity of the debt reserve should be greater after liquidation
            expect(
              usdcReserveDataAfterLiquidation.availableLiquidity
            ).to.be.equal(
              usdcReserveDataBeforeLiquidation.availableLiquidity + debtToCover
            );

            // the liquidity index of the debt reserve should be greater than the index before
            expect(
              usdcReserveDataAfterLiquidation.liquidityIndex
            ).to.be.greaterThanOrEqual(
              usdcReserveDataBeforeLiquidation.liquidityIndex
            );

            // the principal APY after a liquidation should belower than the APY before because overal borrow rate went up due to stable debt interest
            expect(
              usdcReserveDataAfterLiquidation.liquidityRate
            ).to.be.lessThan(usdcReserveDataBeforeLiquidation.liquidityRate);

            // available liquidity of the collateral reserve should be the same after liquidation (mTokens changed ownership but not burned)
            expect(
              daiReserveDataAfterLiquidation.availableLiquidity
            ).to.be.equal(daiReserveDataBeforeLiquidation.availableLiquidity);

            // liquidator should now have DAI as collateral
            expect(liquidatorDAIDataAfterLiquidation.usageAsCollateralEnabled)
              .to.be.true;
          });

          it("Should update state correctly when both debt assets are liquidated", async function () {
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              meldPriceOracle,
              tether,
              dai,
              meld,
              usdc,
              owner,
              borrower3,
              liquidator,
              oracleAdmin,
            } = await loadFixture(setUpSingleVariableBorrowTetherFixture);
            // Borrower has deposited DAI and MELD as collateral

            // Simulate time passing so owed interest will accrue
            await time.increase(ONE_YEAR / 4);

            // Borrower borrows USDC at stable rate. Variable debt is 1250 Tether.
            const borrowAmount = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "450"
            );

            // Borrow USDC at stable rate
            await lendingPool
              .connect(borrower3)
              .borrow(
                await usdc.getAddress(),
                borrowAmount,
                RateMode.Stable,
                borrower3.address,
                0
              );

            // Simulate time passing so owed interest will accrue
            await time.increase(ONE_YEAR);

            // Instantiate collateral reserve token contracts
            const meldReserveTokenAddresses =
              await meldProtocolDataProvider.getReserveTokensAddresses(
                await meld.getAddress()
              );

            const mMELD = await ethers.getContractAt(
              "MToken",
              meldReserveTokenAddresses.mTokenAddress
            );

            // Liquidator deposits DAI collateral (ensures liquidator has a balance of DAI mTokens)
            const depositAmountDAI = await allocateAndApproveTokens(
              dai,
              owner,
              liquidator,
              lendingPool,
              100n,
              0n
            );

            await lendingPool
              .connect(liquidator)
              .deposit(
                await dai.getAddress(),
                depositAmountDAI,
                liquidator.address,
                true,
                0
              );

            // Make sure liquidator has funds with which to liquidate
            await allocateAndApproveTokens(
              usdc,
              owner,
              liquidator,
              lendingPool,
              1000n,
              0n
            );

            await allocateAndApproveTokens(
              tether,
              owner,
              liquidator,
              lendingPool,
              1500n,
              0n
            );

            const [currentPrice, success] = await meldPriceOracle.getAssetPrice(
              await dai.getAddress()
            );

            expect(success).to.be.true;

            // Simulate price of collateral (DAI) going down drastically so that position is liquidatable
            // In reality, DAI is not likely to so drastically go down in value, but this is the easist way to
            // get the health factor < 1
            const newPrice = (10n * currentPrice) / 12n; // price goes down by 1.2 times (currentPrice/1.2). workaround because can't use decimals with bigint
            await meldPriceOracle
              .connect(oracleAdmin)
              .setAssetPrice(await dai.getAddress(), newPrice);

            // Get USDC reserve data before liquidation
            const usdcReserveDataBeforeLiquidation: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await usdc.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get DAI reserve data before liquidation
            const daiReserveDataBeforeLiquidation: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await dai.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get Tether reserve data before liquidation
            const tetherReserveDataBeforeLiquidation: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await tether.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get MELD reserve data before liquidation
            const meldReserveDataBeforeLiquidation: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get borrower USDC reserve data before liquidation
            const borrowerUSDCDataBeforeLiquidation: UserReserveData =
              await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await usdc.getAddress(),
                borrower3.address
              );

            // Get borrower Tether reserve data before liquidation
            const borrowerTetherDataBeforeLiquidation: UserReserveData =
              await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await tether.getAddress(),
                borrower3.address
              );

            // Get borrower account data (over all reserves) before liquidation
            const borrowerAccountDataBefore =
              await lendingPool.getUserAccountData(borrower3.address);

            // Get liquidator DAI reserve data after liquidation
            const liquidatorDAIDataBeforeLiquidation: UserReserveData =
              await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await dai.getAddress(),
                liquidator.address
              );

            expect(liquidatorDAIDataBeforeLiquidation.usageAsCollateralEnabled)
              .to.be.true;

            // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
            time.setNextBlockTimestamp(await time.latest());

            // Liquidator liquidates full USDC debt and receives DAI collateral
            await lendingPool.connect(liquidator).liquidationCall(
              await dai.getAddress(), // collateral asset
              await usdc.getAddress(), // debt asset
              borrower3.address,
              MaxUint256, // flag to liquidate full debt
              true // receive mToken
            );

            // Borrower doesn't have enough MELD collateral to cover liquidation of the full debt, so a lower amount of debt will be covered instead of the total.
            // The value is calculated based on taking the borrower's collateral balance instead of the maxLiquidatableCollateral
            const collateralAmount = await mMELD.balanceOf(borrower3.address);

            // Liquidator immedately liquidates full Tether debt and receives MELD collateral
            await lendingPool.connect(liquidator).liquidationCall(
              await meld.getAddress(), // collateral asset
              await tether.getAddress(), // debt asset
              borrower3.address,
              MaxUint256, // flag to liquidate full debt
              false // receive mToken
            );

            // Get USDC reserve data after liquidation
            const usdcReserveDataAfterLiquidation: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await usdc.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get DAI reserve data after liquidation
            const daiReserveDataAfterLiquidation: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await dai.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get Tether reserve data after liquidation
            const tetherReserveDataAfterLiquidation: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await tether.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get MELD reserve data after liquidation
            const meldReserveDataAfterLiquidation: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get borrower USDC reserve data after liquidation
            const borrowerUSDCDataAfterLiquidation: UserReserveData =
              await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await usdc.getAddress(),
                borrower3.address
              );

            // Get borrower Tether reserve data after liquidation
            const borrowerTetherDataAfterLiquidation: UserReserveData =
              await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await tether.getAddress(),
                borrower3.address
              );

            // Get borrower account data (over all reserves) after liquidation
            const borrowerAccountDataAfter =
              await lendingPool.getUserAccountData(borrower3.address);

            // Get liquidator DAI reserve data after liquidation
            const liquidatorDAIDataAfterLiquidation: UserReserveData =
              await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await dai.getAddress(),
                liquidator.address
              );

            // Get liquidator MELD reserve data after liquidation
            const liquidatorMELDDataAfterLiquidation: UserReserveData =
              await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await meld.getAddress(),
                liquidator.address
              );

            // Calculates the maximum amount of debt that can be liquidated
            const maxLiquidatableUSDCDebt = (
              borrowerUSDCDataBeforeLiquidation.currentStableDebt +
              borrowerUSDCDataBeforeLiquidation.currentVariableDebt
            ).percentMul(LIQUIDATION_CLOSE_FACTOR_PERCENT);

            const { liquidationMultiplier } =
              await calcLiquidationMultiplierParams(
                meld,
                lendingPool,
                meldProtocolDataProvider
              );

            // Calculates the maximum amount of debt that can be liquidated given the max caculated collateral
            const maxLiquidatableTetherDebt = await calcMaxDebtNeeded(
              meld,
              tether,
              meldPriceOracle,
              liquidationMultiplier,
              collateralAmount
            );

            // Check State //

            // borrower's health factor should go up after liquidation
            expect(borrowerAccountDataAfter.healthFactor).to.be.greaterThan(
              borrowerAccountDataBefore.healthFactor
            );

            expect(borrowerAccountDataAfter.healthFactor).to.be.greaterThan(
              _1e18
            ); // health factor is expressed with 18 decimals (1e18)

            // USDC stable debt should be 0 after liquidation.
            expect(
              borrowerUSDCDataAfterLiquidation.currentStableDebt
            ).to.be.equal(0n);

            // USDC variable debt should be the same after liquidation because borrower has no USDC variable debt
            expect(
              borrowerUSDCDataAfterLiquidation.currentVariableDebt
            ).to.be.equal(
              borrowerUSDCDataBeforeLiquidation.currentVariableDebt
            );

            // Tether stable debt should be the same after liquidation because the borrower has no Tether stable debt
            expect(
              borrowerTetherDataAfterLiquidation.currentStableDebt
            ).to.be.equal(
              borrowerTetherDataBeforeLiquidation.currentStableDebt
            );

            // Tether variable debt should be lower after liquidation
            expect(
              borrowerTetherDataAfterLiquidation.currentVariableDebt
            ).to.be.equal(
              borrowerTetherDataBeforeLiquidation.currentVariableDebt -
                maxLiquidatableTetherDebt
            );

            // USDC stable borrow rate should be lower after liquidation
            expect(
              usdcReserveDataAfterLiquidation.stableBorrowRate
            ).to.be.lessThan(usdcReserveDataBeforeLiquidation.stableBorrowRate);

            // USDC average stable borrow rate should be same or lower after liquidation
            expect(
              usdcReserveDataAfterLiquidation.averageStableBorrowRate
            ).to.be.lessThanOrEqual(
              usdcReserveDataBeforeLiquidation.averageStableBorrowRate
            );

            // available liquidity of the USDC debt reserve should be greater after liquidation
            expect(
              usdcReserveDataAfterLiquidation.availableLiquidity
            ).to.be.equal(
              usdcReserveDataBeforeLiquidation.availableLiquidity +
                maxLiquidatableUSDCDebt
            );

            // the liquidity index of the USDC debt reserve should be greater than or equal to the index before
            expect(
              usdcReserveDataAfterLiquidation.liquidityIndex
            ).to.be.greaterThanOrEqual(
              usdcReserveDataBeforeLiquidation.liquidityIndex
            );

            // the principal APY after a liquidation  of the USDC debt reserve should be lower after liquidation
            expect(
              usdcReserveDataAfterLiquidation.liquidityRate
            ).to.be.lessThan(usdcReserveDataBeforeLiquidation.liquidityRate);

            // Tether variable borrow index should be higher after liquidation because interest accrued since last updateState (during borrow)
            expect(
              tetherReserveDataAfterLiquidation.variableBorrowIndex
            ).to.be.greaterThan(
              tetherReserveDataBeforeLiquidation.variableBorrowIndex
            );

            // Tether variable borrow rate should be lower after liquidation
            expect(
              tetherReserveDataAfterLiquidation.variableBorrowRate
            ).to.be.lessThan(
              tetherReserveDataBeforeLiquidation.variableBorrowRate
            );

            // available liquidity of the Tether debt reserve should be higher after liquidation
            expect(
              tetherReserveDataAfterLiquidation.availableLiquidity
            ).to.be.equal(
              tetherReserveDataBeforeLiquidation.availableLiquidity +
                maxLiquidatableTetherDebt
            );

            // the liquidity index of the Tether debt reserve should be greater than or equal to the index before
            expect(
              tetherReserveDataAfterLiquidation.liquidityIndex
            ).to.be.greaterThanOrEqual(
              tetherReserveDataBeforeLiquidation.liquidityIndex
            );

            // the principal APY after a liquidation  of the Tether debt reserve should be lower after liquidation
            expect(
              tetherReserveDataAfterLiquidation.liquidityRate
            ).to.be.lessThan(tetherReserveDataBeforeLiquidation.liquidityRate);

            // available liquidity of the DAI collateral reserve should be the same after liquidation (mTokens changed ownership but not burned)
            expect(
              daiReserveDataAfterLiquidation.availableLiquidity
            ).to.be.equal(daiReserveDataBeforeLiquidation.availableLiquidity);

            // liquidator should now have DAI as collateral
            expect(liquidatorDAIDataAfterLiquidation.usageAsCollateralEnabled)
              .to.be.true;

            // available liquidity of the MELD collateral reserve should go down after liquidation because liquidator gets underlying tokens
            expect(
              meldReserveDataAfterLiquidation.availableLiquidity
            ).to.be.lessThan(
              meldReserveDataBeforeLiquidation.availableLiquidity
            );

            // liquidator should not have MELD (mTokens) as collateral
            expect(liquidatorMELDDataAfterLiquidation.usageAsCollateralEnabled)
              .to.be.false;
          });

          it("Should update token balances correctly for correct assets", async function () {
            const {
              lendingPool,
              meldProtocolDataProvider,
              meldPriceOracle,
              tether,
              dai,
              meld,
              usdc,
              owner,
              borrower3,
              liquidator,
              treasury,
              oracleAdmin,
            } = await loadFixture(setUpSingleVariableBorrowTetherFixture);
            // Borrower has deposited DAI and MELD as collateral

            // Simulate time passing so owed interest will accrue
            await time.increase(ONE_YEAR / 12);

            // Borrower borrows USDC at stable rate. Variable debt is 1250 USDT
            const borrowAmount = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "450"
            );

            // Borrow USDC at stable rate
            await lendingPool
              .connect(borrower3)
              .borrow(
                await usdc.getAddress(),
                borrowAmount,
                RateMode.Stable,
                borrower3.address,
                0
              );

            // Simulate time passing so owed interest will accrue
            await time.increase(ONE_YEAR / 4);

            // Instantiate collateral reserve token contracts
            const meldReserveTokenAddresses =
              await meldProtocolDataProvider.getReserveTokensAddresses(
                await meld.getAddress()
              );

            const mMELD = await ethers.getContractAt(
              "MToken",
              meldReserveTokenAddresses.mTokenAddress
            );

            const daiReserveTokenAddresses =
              await meldProtocolDataProvider.getReserveTokensAddresses(
                await dai.getAddress()
              );

            const mDAI = await ethers.getContractAt(
              "MToken",
              daiReserveTokenAddresses.mTokenAddress
            );

            // Instantiate debt reserve token contracts
            const usdcReserveTokenAddresses =
              await meldProtocolDataProvider.getReserveTokensAddresses(
                await usdc.getAddress()
              );

            const usdcStableDebtToken = await ethers.getContractAt(
              "StableDebtToken",
              usdcReserveTokenAddresses.stableDebtTokenAddress
            );

            const tetherReserveTokenAddresses =
              await meldProtocolDataProvider.getReserveTokensAddresses(
                await tether.getAddress()
              );

            const tetherVariableDebtToken = await ethers.getContractAt(
              "VariableDebtToken",
              tetherReserveTokenAddresses.variableDebtTokenAddress
            );

            // Make sure liquidator has funds with which to liquidate Tether debt
            const debtToCover = await allocateAndApproveTokens(
              tether,
              owner,
              liquidator,
              lendingPool,
              150n, // part of principal debt
              0n
            );

            // Simulate price of collateral (MELD) going down so that position is liquidatable
            const [currentPrice, success] = await meldPriceOracle.getAssetPrice(
              await meld.getAddress()
            );

            expect(success).to.be.true;
            const newPrice = (10n * currentPrice) / 23n; // price goes down by 2.3 times (currentPrice/2.3). workaround because can't use decimals with bigint
            await meldPriceOracle
              .connect(oracleAdmin)
              .setAssetPrice(await meld.getAddress(), newPrice);

            // Get token balances before liquidation
            const borrowerTetherVariableDebtBalanceBeforeLiquidation =
              await tetherVariableDebtToken.balanceOf(borrower3.address);
            const borrowerUSDCStableDebtBalanceBeforeLiquidation =
              await usdcStableDebtToken.balanceOf(borrower3.address);
            const borrowerMMELDBalanceBeforeLiquidation = await mMELD.balanceOf(
              borrower3.address
            );
            const borrowerMDAIBalanceBeforeLiquidation = await mDAI.balanceOf(
              borrower3.address
            );
            const mTetherBalanceBeforeLiquidation = await tether.balanceOf(
              tetherReserveTokenAddresses.mTokenAddress
            );
            const mUSDCBalanceBeforeLiquidation = await usdc.balanceOf(
              usdcReserveTokenAddresses.mTokenAddress
            );
            const liquidatorMMELDBalanceBeforeLiquidation =
              await mMELD.balanceOf(liquidator.address);
            const treasuryMMELDBalanceBeforeLiquidation = await mMELD.balanceOf(
              treasury.address
            );
            const liquidatorMDAIBalanceBeforeLiquidation = await mDAI.balanceOf(
              liquidator.address
            );

            // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
            time.setNextBlockTimestamp(await time.latest());

            // Liquidator liquidates the Tether debt and receives MELD collateral
            await lendingPool.connect(liquidator).liquidationCall(
              await meld.getAddress(), // collateral asset
              await tether.getAddress(), // debt asset
              borrower3.address,
              debtToCover,
              true // receive mToken
            );

            const { liquidationMultiplier, actualLiquidationProtocolFee } =
              await calcLiquidationMultiplierParams(
                meld,
                lendingPool,
                meldProtocolDataProvider
              );

            const maxLiquidatableCollateral =
              await calcMaxLiquidatableCollateral(
                meld,
                usdc,
                meldPriceOracle,
                liquidationMultiplier,
                debtToCover
              );

            const liquidationProtocolFeeAmount =
              actualLiquidationProtocolFee.percentMul(
                maxLiquidatableCollateral
              );

            const liquidatorAmount =
              maxLiquidatableCollateral - liquidationProtocolFeeAmount;

            // Get token balances after liquidation
            const borrowerTetherVariableDebtBalanceAfterLiquidation =
              await tetherVariableDebtToken.balanceOf(borrower3.address);
            const borrowerUSDCStableDebtBalanceAfterLiquidation =
              await usdcStableDebtToken.balanceOf(borrower3.address);
            const borrowerMMELDBalanceAfterLiquidation = await mMELD.balanceOf(
              borrower3.address
            );
            const borrowerMDAIBalanceAfterLiquidation = await mDAI.balanceOf(
              borrower3.address
            );
            const mTetherBalanceAfterLiquidation = await tether.balanceOf(
              tetherReserveTokenAddresses.mTokenAddress
            );
            const mUSDCBalanceAfterLiquidation = await usdc.balanceOf(
              usdcReserveTokenAddresses.mTokenAddress
            );
            const liquidatorMMELDBalanceAfterLiquidation =
              await mMELD.balanceOf(liquidator.address);
            const treasuryMMELDBalanceAfterLiquidation = await mMELD.balanceOf(
              treasury.address
            );
            const liquidatorMELDBalanceAfterLiquidation = await meld.balanceOf(
              liquidator.address
            );
            const liquidatorMDAIBalanceAfterLiquidation = await mDAI.balanceOf(
              liquidator.address
            );
            const liquidatorDAIBalanceAfterLiquidation = await dai.balanceOf(
              liquidator.address
            );

            // Check token balances //

            // borrower Tether variable debt balance should be lower after liquidation. Numbers are off by one digit because of difference in math in solidity and js
            expect(
              borrowerTetherVariableDebtBalanceAfterLiquidation
            ).to.be.closeTo(
              borrowerTetherVariableDebtBalanceBeforeLiquidation - debtToCover,
              1
            );

            // borrower USDC stable debt balance should be the same after liquidation because USDC debt was not liquidated
            expect(borrowerUSDCStableDebtBalanceAfterLiquidation).to.be.equal(
              borrowerUSDCStableDebtBalanceBeforeLiquidation
            );

            // Tether debt mToken balance should be higher after liquidation
            expect(mTetherBalanceAfterLiquidation).to.be.equal(
              mTetherBalanceBeforeLiquidation + debtToCover
            );

            // USDC debt mToken balance should be the same after liquidataion because USDC was not liquidated
            expect(mUSDCBalanceAfterLiquidation).to.be.equal(
              mUSDCBalanceBeforeLiquidation
            );

            // borrower MELD collateral mToken balance should be lower after liquidation
            expect(borrowerMMELDBalanceAfterLiquidation).to.be.equal(
              borrowerMMELDBalanceBeforeLiquidation - maxLiquidatableCollateral
            );

            // liquidator MELD collateral mToken balance should be higher after liquidation
            expect(liquidatorMMELDBalanceAfterLiquidation).to.be.equal(
              liquidatorMMELDBalanceBeforeLiquidation + liquidatorAmount
            );

            // liquidator MELD collateral mToken balance should be higher after liquidation
            expect(treasuryMMELDBalanceAfterLiquidation).to.be.equal(
              treasuryMMELDBalanceBeforeLiquidation +
                liquidationProtocolFeeAmount
            );

            // liquidator underlying MELD collateral token balance should be same (0) after liquidation because liquidator received mTokens, not underlying asset
            expect(liquidatorMELDBalanceAfterLiquidation).to.be.equal(0n);

            // borrower DAI collateral mToken balance should be the same after liquidation because DAI was not liquidated
            expect(borrowerMDAIBalanceAfterLiquidation).to.be.equal(
              borrowerMDAIBalanceBeforeLiquidation
            );

            // liquidator DAI collateral mToken balance should be the same after liquidation because DAI was not liquidated
            expect(liquidatorMDAIBalanceAfterLiquidation).to.be.equal(
              liquidatorMDAIBalanceBeforeLiquidation
            );

            // liquidator underlying DAI collateral token balance should be same(0) after liquidation because liquidator received mTokens, not underlying asset
            expect(liquidatorDAIBalanceAfterLiquidation).to.be.equal(0n);
          });
        }
      ); // End Liquidate When Borrower has Combination of Stable and Variable Debt for Different Debt assets and Multiple Collateral Assets Context
    }); // End Reguler User Context

    context("MELD Banker", async function () {
      it("Should unlock MELD Banker NFT if MELD Banker liquidates whole balance of yield boost token", async function () {
        const {
          lendingPool,
          meldProtocolDataProvider,
          lendingRateOracleAggregator,
          meldPriceOracle,
          addressesProvider,
          meld,
          usdc,
          owner,
          liquidator,
          treasury,
          oracleAdmin,
          rewardsSetter,
          meldBanker,
          meldBankerTokenId,
          yieldBoostStakingUSDC,
          yieldBoostStorageUSDC,
          borrowAmountMeldBankerUSDC,
        } = await loadFixture(setUpMeldBankersBorrowFixture);

        // Non-yield boost token (MELD)is collateral token
        // Yield boost token (USDC) is debt token

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

        // Instantiate collateral reserve token contracts
        const meldReserveTokenAddresses =
          await meldProtocolDataProvider.getReserveTokensAddresses(
            await meld.getAddress()
          );

        const mMELD = await ethers.getContractAt(
          "MToken",
          meldReserveTokenAddresses.mTokenAddress
        );

        // Instantiate debt reserve token contracts
        const usdcReserveTokenAddresses =
          await meldProtocolDataProvider.getReserveTokensAddresses(
            await usdc.getAddress()
          );

        const mUSDC = await ethers.getContractAt(
          "MToken",
          usdcReserveTokenAddresses.mTokenAddress
        );

        const stableDebtToken = await ethers.getContractAt(
          "StableDebtToken",
          usdcReserveTokenAddresses.stableDebtTokenAddress
        );

        const variableDebtToken = await ethers.getContractAt(
          "VariableDebtToken",
          usdcReserveTokenAddresses.variableDebtTokenAddress
        );

        // Make sure liquidator has funds with which to liquidate
        await allocateAndApproveTokens(
          usdc,
          owner,
          liquidator,
          lendingPool,
          1400n,
          0n
        );

        // Simulate price of collateral (MELD) going down drastically so that position is liquidatable
        await simulateAssetPriceCrash(meld, meldPriceOracle, 2n, oracleAdmin);

        // Get USDC reserve data before liquidation
        const usdcReserveDataBeforeLiquidation: ReserveData =
          await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

        // Get borrower USDC reserve data before liquidation
        const borrowerUSDCDataBeforeLiquidation: UserReserveData =
          await getUserData(
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

        // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
        time.setNextBlockTimestamp(await time.latest());

        // Liquidator liquidates all liquidatable debt (up to close factor)
        const liquidationTx = await lendingPool
          .connect(liquidator)
          .liquidationCall(
            await meld.getAddress(), // collateral asset
            await usdc.getAddress(), // debt asset
            meldBanker.address,
            MaxUint256, // flag for all liquidatable debt
            false // liquidator will receive underlying token
          );

        const blockTimestamps: BlockTimestamps =
          await getBlockTimestamps(liquidationTx);

        // Get USDC reserve data after liquidation
        const usdcReserveDataAfterLiquidation: ReserveData =
          await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

        // Get MELD reserve data after liquidation
        const meldReserveDataAfterLiquidation: ReserveData =
          await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

        const maxLiquidatableDebt = (
          borrowerUSDCDataBeforeLiquidation.currentStableDebt +
          borrowerUSDCDataBeforeLiquidation.currentVariableDebt
        ).percentMul(LIQUIDATION_CLOSE_FACTOR_PERCENT);

        // Check that the correct events were emitted //

        await expect(liquidationTx)
          .to.emit(variableDebtToken, "Transfer")
          .withArgs(
            meldBanker.address,
            ZeroAddress,
            isAlmostEqual(maxLiquidatableDebt)
          );

        await expect(liquidationTx)
          .to.emit(variableDebtToken, "Burn")
          .withArgs(
            meldBanker.address,
            maxLiquidatableDebt,
            usdcReserveDataAfterLiquidation.variableBorrowIndex
          );

        await expect(liquidationTx).to.not.emit(stableDebtToken, "Transfer"); // not liquidating stable debt
        await expect(liquidationTx).to.not.emit(stableDebtToken, "Burn"); // not liquidating stable debt
        await expect(liquidationTx).to.not.emit(stableDebtToken, "Mint"); // not liquidating stable debt

        // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
        const contractInstanceWithLibraryABI = await ethers.getContractAt(
          "ReserveLogic",
          await lendingPool.getAddress(),
          owner
        );

        // The important thing here is checking that the event is emitted for the debt token. The values are checked in other test files.
        await expect(liquidationTx)
          .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
          .withArgs(
            await usdc.getAddress(),
            anyUint,
            anyUint,
            anyUint,
            anyUint,
            anyUint
          );

        // Mint to treasury because debt token (USDC) has reserveFactor > 0
        const currentVariableDebt =
          usdcReserveDataBeforeLiquidation.totalVariableDebt;
        const previousVariableDebt =
          usdcReserveDataBeforeLiquidation.scaledVariableDebt;
        const currentStableDebt =
          usdcReserveDataBeforeLiquidation.totalStableDebt;
        const previousStableDebt =
          usdcReserveDataBeforeLiquidation.principalStableDebt;

        const totalDebtAccrued =
          currentVariableDebt +
          currentStableDebt -
          previousVariableDebt -
          previousStableDebt;

        const { reserveFactor } =
          await meldProtocolDataProvider.getReserveConfigurationData(
            await usdc.getAddress()
          );
        const amountToMint = totalDebtAccrued.percentMul(BigInt(reserveFactor));

        await expect(liquidationTx)
          .to.emit(mUSDC, "Transfer")
          .withArgs(ZeroAddress, treasury.address, isAlmostEqual(amountToMint));

        await expect(liquidationTx)
          .to.emit(mUSDC, "Mint")
          .withArgs(
            treasury.address,
            isAlmostEqual(amountToMint),
            usdcReserveDataAfterLiquidation.liquidityIndex
          );

        const { liquidationMultiplier, actualLiquidationProtocolFee } =
          await calcLiquidationMultiplierParams(
            meld,
            lendingPool,
            meldProtocolDataProvider
          );

        const maxLiquidatableCollateral = await calcMaxLiquidatableCollateral(
          meld,
          usdc,
          meldPriceOracle,
          liquidationMultiplier,
          maxLiquidatableDebt
        );

        const liquidationProtocolFeeAmount =
          actualLiquidationProtocolFee.percentMul(maxLiquidatableCollateral);

        const liquidatorAmount =
          maxLiquidatableCollateral - liquidationProtocolFeeAmount;

        // Events emitted when liquidator receives collateral mToken
        const liquidityIndex = calcExpectedReserveNormalizedIncome(
          meldReserveDataAfterLiquidation,
          blockTimestamps.txTimestamp
        );

        // liquidator chose to receive underlying collateral asset
        await expect(liquidationTx)
          .to.emit(mMELD, "Transfer")
          .withArgs(
            meldBanker.address,
            ZeroAddress,
            liquidationProtocolFeeAmount
          );

        await expect(liquidationTx)
          .to.emit(mMELD, "Transfer")
          .withArgs(meldBanker.address, ZeroAddress, liquidatorAmount);

        await expect(liquidationTx)
          .to.emit(meld, "Transfer")
          .withArgs(
            await mMELD.getAddress(),
            treasury.address,
            liquidationProtocolFeeAmount
          );

        await expect(liquidationTx)
          .to.emit(meld, "Transfer")
          .withArgs(
            await mMELD.getAddress(),
            liquidator.address,
            liquidatorAmount
          );

        await expect(liquidationTx)
          .to.emit(mMELD, "Burn")
          .withArgs(
            meldBanker.address,
            treasury.address,
            liquidationProtocolFeeAmount,
            liquidityIndex
          );

        await expect(liquidationTx)
          .to.emit(mMELD, "Burn")
          .withArgs(
            meldBanker.address,
            liquidator.address,
            liquidatorAmount,
            liquidityIndex
          );

        await expect(liquidationTx).to.not.emit(mMELD, "BalanceTransfer"); // liquidator elected to not receive mTokens

        // Event emitted when debt token is transferred from liquidator to pay off debt
        await expect(liquidationTx)
          .to.emit(usdc, "Transfer")
          .withArgs(
            liquidator.address,
            await mUSDC.getAddress(),
            maxLiquidatableDebt
          );

        // ReserveUsedAsCollateralDisabled and  ReserveUsedAsCollateralEnabled Events are defined in library LiquidationLogic.sol,
        //so we need to get the contract instance with the LiquidationLogic ABI
        const contractInstanceWithLogicLibraryABI = await ethers.getContractAt(
          "LiquidationLogic",
          await lendingPool.getAddress(),
          owner
        );

        await expect(liquidationTx).to.not.emit(
          contractInstanceWithLogicLibraryABI,
          "ReserveUsedAsCollateralDisabled"
        );

        await expect(liquidationTx).to.not.emit(
          contractInstanceWithLogicLibraryABI,
          "ReserveUsedAsCollateralEnabled"
        ); // liquidator did not receive mTokens

        await expect(liquidationTx)
          .to.emit(contractInstanceWithLogicLibraryABI, "LiquidationCall")
          .withArgs(
            await meld.getAddress(),
            await usdc.getAddress(),
            meldBanker.address,
            maxLiquidatableDebt,
            maxLiquidatableCollateral,
            liquidator.address,
            false
          );

        // MELD Banker
        const expectedOldMeldBankerStakedAmount =
          borrowAmountMeldBankerUSDC.percentMul(yieldBoostMultiplier);

        await expect(liquidationTx)
          .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
          .withArgs(meldBanker.address, expectedOldMeldBankerStakedAmount, 0n);

        await expect(liquidationTx)
          .to.emit(yieldBoostStakingUSDC, "StakePositionRemoved")
          .withArgs(meldBanker.address, expectedOldMeldBankerStakedAmount);

        await expect(liquidationTx)
          .to.emit(yieldBoostStakingUSDC, "RewardsClaimed")
          .withArgs(meldBanker.address, meldBanker.address, anyUint, anyUint);

        await expect(liquidationTx)
          .to.emit(lendingPool, "RefreshYieldBoostAmount")
          .withArgs(await usdc.getAddress(), meldBanker.address, 0n);

        await expect(liquidationTx)
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

        // Liquidator gets MELD transferred, which is not a yield boost token
        await expect(liquidationTx).to.not.emit(
          yieldBoostStakingUSDC,
          "StakePositionCreated"
        );

        //Can't check that StakePositionUpdated is not emitted because it is emitted in the same tx for the meldBanker
        //Can't check that RefreshYieldBoostAmount is not emitted because it is emitted in the same tx for the meldBanker

        const liquidaterMeldBankerData = await lendingPool.userMeldBankerData(
          liquidator.address
        );

        expect(await lendingPool.isUsingMeldBanker(liquidator.address)).to.be
          .false;

        expect(await lendingPool.isMeldBankerBlocked(0n)).to.be.false;

        expect(liquidaterMeldBankerData.tokenId).to.equal(0n);
        expect(liquidaterMeldBankerData.asset).to.equal(ZeroAddress);
        expect(liquidaterMeldBankerData.meldBankerType).to.equal(
          MeldBankerType.NONE
        );
        expect(liquidaterMeldBankerData.action).to.equal(Action.NONE);

        expect(
          await yieldBoostStorageUSDC.getStakerStakedAmount(liquidator.address)
        ).to.equal(0n);

        // Treasury is a regular user. Treasury gets MELD transferred, which is not a yield boost token
        const treasuryMeldBankerData = await lendingPool.userMeldBankerData(
          treasury.address
        );

        expect(treasuryMeldBankerData.tokenId).to.equal(0n);
        expect(treasuryMeldBankerData.asset).to.equal(ZeroAddress);
        expect(treasuryMeldBankerData.meldBankerType).to.equal(
          MeldBankerType.NONE
        );
        expect(treasuryMeldBankerData.action).to.equal(Action.NONE);

        expect(
          await yieldBoostStorageUSDC.getStakerStakedAmount(treasury.address)
        ).to.equal(0n);
      });

      it("Should NOT unlock MELD Banker NFT if MELD Banker liquidates whole balance of a different yield boost token", async function () {
        const {
          lendingPool,
          meldProtocolDataProvider,
          lendingRateOracleAggregator,
          meldPriceOracle,
          addressesProvider,
          meld,
          usdc,
          dai,
          owner,
          liquidator,
          treasury,
          oracleAdmin,
          rewardsSetter,
          meldBanker,
          meldBankerTokenId,
          yieldBoostStakingUSDC,
          yieldBoostStorageUSDC,
          borrowAmountMeldBankerUSDC,
        } = await loadFixture(setUpMeldBankersBorrowFixture);

        // Non-yield boost token (MELD)is collateral token
        // Yield boost token (DAI) is debt token
        // MELD banker is not using tokenId to borrow DAI.

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
          "500"
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

        // Allocate DAI to liquidator so can repay later
        await allocateAndApproveTokens(
          dai,
          owner,
          liquidator,
          lendingPool,
          1000n * 2n, // 2x the amount borrowed
          0n
        );

        // Instantiate collateral reserve token contracts
        const meldReserveTokenAddresses =
          await meldProtocolDataProvider.getReserveTokensAddresses(
            await meld.getAddress()
          );

        const mMELD = await ethers.getContractAt(
          "MToken",
          meldReserveTokenAddresses.mTokenAddress
        );

        // Instantiate debt reserve token contracts
        const daiReserveTokenAddresses =
          await meldProtocolDataProvider.getReserveTokensAddresses(
            await dai.getAddress()
          );

        const mDAI = await ethers.getContractAt(
          "MToken",
          daiReserveTokenAddresses.mTokenAddress
        );

        const stableDebtToken = await ethers.getContractAt(
          "StableDebtToken",
          daiReserveTokenAddresses.stableDebtTokenAddress
        );

        const variableDebtToken = await ethers.getContractAt(
          "VariableDebtToken",
          daiReserveTokenAddresses.variableDebtTokenAddress
        );

        // Make sure liquidator has funds with which to liquidate
        await allocateAndApproveTokens(
          dai,
          owner,
          liquidator,
          lendingPool,
          1400n,
          0n
        );

        // Simulate price of collateral (MELD) going down drastically so that position is liquidatable
        await simulateAssetPriceCrash(meld, meldPriceOracle, 2n, oracleAdmin);

        // Get borrower DAI reserve data before liquidation
        const borrowerDAIDataBeforeLiquidation: UserReserveData =
          await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await dai.getAddress(),
            meldBanker.address
          );

        // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
        time.setNextBlockTimestamp(await time.latest());

        // Liquidator liquidates all liquidatable debt (up to close factor)
        const liquidationTx = await lendingPool
          .connect(liquidator)
          .liquidationCall(
            await meld.getAddress(), // collateral asset
            await dai.getAddress(), // debt asset
            meldBanker.address,
            MaxUint256, // flag for all liquidatable debt
            true // receive mToken
          );

        const blockTimestamps: BlockTimestamps =
          await getBlockTimestamps(liquidationTx);

        // Get DAI reserve data after liquidation
        const daiReserveDataAfterLiquidation: ReserveData =
          await getReserveData(
            meldProtocolDataProvider,
            await dai.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

        // Get MELD reserve data after liquidation
        const meldReserveDataAfterLiquidation: ReserveData =
          await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

        const maxLiquidatableDebt = (
          borrowerDAIDataBeforeLiquidation.currentStableDebt +
          borrowerDAIDataBeforeLiquidation.currentVariableDebt
        ).percentMul(LIQUIDATION_CLOSE_FACTOR_PERCENT);

        // Check that the correct events were emitted //

        await expect(liquidationTx)
          .to.emit(variableDebtToken, "Transfer")
          .withArgs(meldBanker.address, ZeroAddress, maxLiquidatableDebt);

        await expect(liquidationTx)
          .to.emit(variableDebtToken, "Burn")
          .withArgs(
            meldBanker.address,
            maxLiquidatableDebt,
            daiReserveDataAfterLiquidation.variableBorrowIndex
          );

        await expect(liquidationTx).to.not.emit(stableDebtToken, "Transfer"); // not liquidating stable debt
        await expect(liquidationTx).to.not.emit(stableDebtToken, "Burn"); // not liquidating stable debt
        await expect(liquidationTx).to.not.emit(stableDebtToken, "Mint"); // not liquidating stable debt

        // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
        const contractInstanceWithLibraryABI = await ethers.getContractAt(
          "ReserveLogic",
          await lendingPool.getAddress(),
          owner
        );

        // The important thing here is checking that the event is emitted for the debt token. The values are checked in other test files.
        await expect(liquidationTx)
          .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
          .withArgs(
            await dai.getAddress(),
            anyUint,
            anyUint,
            anyUint,
            anyUint,
            anyUint
          );

        const { liquidationMultiplier, actualLiquidationProtocolFee } =
          await calcLiquidationMultiplierParams(
            meld,
            lendingPool,
            meldProtocolDataProvider
          );

        const maxLiquidatableCollateral = await calcMaxLiquidatableCollateral(
          meld,
          dai,
          meldPriceOracle,
          liquidationMultiplier,
          maxLiquidatableDebt
        );

        const liquidationProtocolFeeAmount =
          actualLiquidationProtocolFee.percentMul(maxLiquidatableCollateral);

        const liquidatorAmount =
          maxLiquidatableCollateral - liquidationProtocolFeeAmount;

        // Events emitted when liquidator receives collateral mToken
        const liquidityIndex = calcExpectedReserveNormalizedIncome(
          meldReserveDataAfterLiquidation,
          blockTimestamps.txTimestamp
        );

        await expect(liquidationTx)
          .to.emit(mMELD, "BalanceTransfer")
          .withArgs(
            meldBanker.address,
            treasury.address,
            liquidationProtocolFeeAmount,
            liquidityIndex
          );

        await expect(liquidationTx)
          .to.emit(mMELD, "BalanceTransfer")
          .withArgs(
            meldBanker.address,
            liquidator.address,
            liquidatorAmount,
            liquidityIndex
          );

        await expect(liquidationTx)
          .to.emit(mMELD, "Transfer")
          .withArgs(
            meldBanker.address,
            treasury.address,
            liquidationProtocolFeeAmount
          );

        await expect(liquidationTx)
          .to.emit(mMELD, "Transfer")
          .withArgs(meldBanker.address, liquidator.address, liquidatorAmount);

        // liquidator chose mTokens instead of underlying collateral asset
        await expect(liquidationTx).to.not.emit(meld, "Transfer");

        // Event emitted when debt token is transferred from liquidator to pay off debt
        await expect(liquidationTx)
          .to.emit(dai, "Transfer")
          .withArgs(
            liquidator.address,
            await mDAI.getAddress(),
            maxLiquidatableDebt
          );

        // ReserveUsedAsCollateralDisabled and  ReserveUsedAsCollateralEnabled Events are defined in library LiquidationLogic.sol,
        //so we need to get the contract instance with the LiquidationLogic ABI
        const contractInstanceWithLogicLibraryABI = await ethers.getContractAt(
          "LiquidationLogic",
          await lendingPool.getAddress(),
          owner
        );

        await expect(liquidationTx).to.not.emit(
          contractInstanceWithLogicLibraryABI,
          "ReserveUsedAsCollateralDisabled"
        ); // borrower's balance of collateral mTokens did not go to 0

        await expect(liquidationTx).to.emit(
          contractInstanceWithLogicLibraryABI,
          "ReserveUsedAsCollateralEnabled"
        ); // liquidator did not already have balance of collateral mTokens

        await expect(liquidationTx)
          .to.emit(contractInstanceWithLogicLibraryABI, "LiquidationCall")
          .withArgs(
            await meld.getAddress(),
            await dai.getAddress(),
            meldBanker.address,
            maxLiquidatableDebt,
            maxLiquidatableCollateral,
            liquidator.address,
            true
          );

        // MELD Banker
        const meldBankerData = await lendingPool.userMeldBankerData(
          meldBanker.address
        );

        // USDC is the yield boost token that the MELD Banker borrowed when locking the NFT
        await expect(liquidationTx).to.not.emit(
          yieldBoostStakingUSDC,
          "StakePositionUpdated"
        );

        await expect(liquidationTx).to.not.emit(
          yieldBoostStakingUSDC,
          "StakePositionRemoved"
        );

        await expect(liquidationTx).to.not.emit(
          yieldBoostStakingUSDC,
          "RewardsClaimed"
        );

        await expect(liquidationTx)
          .to.emit(lendingPool, "RefreshYieldBoostAmount")
          .withArgs(await dai.getAddress(), meldBanker.address, 0n);

        await expect(liquidationTx).to.not.emit(
          lendingPool,
          "UnlockMeldBankerNFT"
        );

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

        // Liquidator getsm MELD transferred, which is not a yield boost token
        await expect(liquidationTx).to.not.emit(
          yieldBoostStakingUSDC,
          "StakePositionCreated"
        );

        //Can't check that StakePositionUpdated is not emitted because it is emitted in the same tx for the meldBanker
        //Can't check that RefreshYieldBoostAmount is not emitted because it is emitted in the same tx for the meldBanker

        const liquidaterMeldBankerData = await lendingPool.userMeldBankerData(
          liquidator.address
        );

        expect(await lendingPool.isUsingMeldBanker(liquidator.address)).to.be
          .false;

        expect(await lendingPool.isMeldBankerBlocked(0n)).to.be.false;

        expect(liquidaterMeldBankerData.tokenId).to.equal(0n);
        expect(liquidaterMeldBankerData.asset).to.equal(ZeroAddress);
        expect(liquidaterMeldBankerData.meldBankerType).to.equal(
          MeldBankerType.NONE
        );
        expect(liquidaterMeldBankerData.action).to.equal(Action.NONE);

        expect(
          await yieldBoostStorageUSDC.getStakerStakedAmount(liquidator.address)
        ).to.equal(0n);

        // Treasury is a regular user. Treasury gets mMELD transferred, which is not a yield boost token
        const treasuryMeldBankerData = await lendingPool.userMeldBankerData(
          treasury.address
        );

        expect(treasuryMeldBankerData.tokenId).to.equal(0n);
        expect(treasuryMeldBankerData.asset).to.equal(ZeroAddress);
        expect(treasuryMeldBankerData.meldBankerType).to.equal(
          MeldBankerType.NONE
        );
        expect(treasuryMeldBankerData.action).to.equal(Action.NONE);

        expect(
          await yieldBoostStorageUSDC.getStakerStakedAmount(treasury.address)
        ).to.equal(0n);
      });

      it("Should unlock MELD Banker NFT if collateral is using NFT and gets fully liquidated", async function () {
        const {
          owner,
          oracleAdmin,
          meldBanker,
          goldenBanker,
          borrower3,
          liquidator,
          usdc,
          dai,
          goldenBankerTokenId,
          ...contracts
        } = await setUpTestFixture();

        // USDC will be borrowed token
        // Yield boost token (DAI) will be collateral token

        // Deposit liquidity

        // Golden banker deposits 20k DAI with NFT
        const depositAmountDAI = await allocateAndApproveTokens(
          dai,
          owner,
          goldenBanker,
          contracts.lendingPool,
          20_000n,
          0n
        );

        await contracts.lendingPool
          .connect(goldenBanker)
          .deposit(
            await dai.getAddress(),
            depositAmountDAI,
            goldenBanker.address,
            true,
            goldenBankerTokenId
          );

        // borrower3 deposits 20k USDC
        const depositAmountUSDC = await allocateAndApproveTokens(
          usdc,
          owner,
          borrower3,
          contracts.lendingPool,
          20_000n,
          0n
        );

        await contracts.lendingPool
          .connect(borrower3)
          .deposit(
            await usdc.getAddress(),
            depositAmountUSDC,
            borrower3.address,
            true,
            0
          );

        // Borrow 10k USDC - No NFT
        const borrowAmountGoldenBankerUSDC = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "10000"
        );

        await contracts.lendingPool
          .connect(goldenBanker)
          .borrow(
            await usdc.getAddress(),
            borrowAmountGoldenBankerUSDC,
            RateMode.Variable,
            goldenBanker.address,
            0n
          );

        // Allocate USDC to liquidator so can repay later
        await allocateAndApproveTokens(
          usdc,
          owner,
          liquidator,
          contracts.lendingPool,
          20_000n * 2n, // 2x the amount borrowed
          0n
        );

        // Simulate price of collateral (DAI) going down drastically so that position is liquidatable
        await simulateAssetPriceCrash(
          dai,
          contracts.meldPriceOracle,
          5n,
          oracleAdmin
        );

        // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
        time.setNextBlockTimestamp(await time.latest());

        // Liquidator liquidates all liquidatable debt (up to close factor)
        await contracts.lendingPool.connect(liquidator).liquidationCall(
          await dai.getAddress(), // collateral asset
          await usdc.getAddress(), // debt asset
          goldenBanker.address,
          MaxUint256, // flag for all liquidatable debt
          true // receive mToken
        );

        // Check current balance of collateral for the user

        // Instantiate collateral reserve token contracts
        const daiReserveTokenAddresses =
          await contracts.meldProtocolDataProvider.getReserveTokensAddresses(
            await dai.getAddress()
          );
        const mDai = await ethers.getContractAt(
          "MToken",
          daiReserveTokenAddresses.mTokenAddress
        );
        const userCollateralBalance = await mDai.balanceOf(
          goldenBanker.address
        );
        expect(userCollateralBalance).to.equal(0n);

        // MELD Banker should be unlocked
        const meldBankerData = await contracts.lendingPool.userMeldBankerData(
          meldBanker.address
        );

        expect(meldBankerData.tokenId).to.equal(0);
        expect(meldBankerData.asset).to.equal(ZeroAddress);
        expect(meldBankerData.meldBankerType).to.equal(0);
        expect(meldBankerData.action).to.equal(0);
      });

      it("Should NOT unlock MELD Banker NFT if MELD Banker liquidates partial balance of yield boost token", async function () {
        const {
          lendingPool,
          meldProtocolDataProvider,
          lendingRateOracleAggregator,
          meldPriceOracle,
          addressesProvider,
          meld,
          usdc,
          dai,
          owner,
          liquidator,
          treasury,
          oracleAdmin,
          rewardsSetter,
          meldBanker,
          meldBankerTokenId,
          yieldBoostStakingUSDC,
          yieldBoostStorageUSDC,
          borrowAmountMeldBankerUSDC,
        } = await loadFixture(setUpMeldBankersBorrowFixture);

        // Non-yield boost token (MELD)is collateral token
        // Yield boost token (USDC) is debt token

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
          "500"
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

        // Allocate DAI to liquidator so can repay later
        await allocateAndApproveTokens(
          dai,
          owner,
          liquidator,
          lendingPool,
          1000n * 2n, // 2x the amount borrowed
          0n
        );

        // Instantiate collateral reserve token contracts
        const meldReserveTokenAddresses =
          await meldProtocolDataProvider.getReserveTokensAddresses(
            await meld.getAddress()
          );

        const mMELD = await ethers.getContractAt(
          "MToken",
          meldReserveTokenAddresses.mTokenAddress
        );

        // Instantiate debt reserve token contracts
        const usdcReserveTokenAddresses =
          await meldProtocolDataProvider.getReserveTokensAddresses(
            await usdc.getAddress()
          );

        const mUSDC = await ethers.getContractAt(
          "MToken",
          usdcReserveTokenAddresses.mTokenAddress
        );

        const stableDebtToken = await ethers.getContractAt(
          "StableDebtToken",
          usdcReserveTokenAddresses.stableDebtTokenAddress
        );

        const variableDebtToken = await ethers.getContractAt(
          "VariableDebtToken",
          usdcReserveTokenAddresses.variableDebtTokenAddress
        );

        // Make sure liquidator has funds with which to liquidate
        const debtToCover = await allocateAndApproveTokens(
          usdc,
          owner,
          liquidator,
          lendingPool,
          200n, // principal debt
          0n
        );

        // Simulate price of collateral (MELD) going down drastically so that position is liquidatable
        await simulateAssetPriceCrash(meld, meldPriceOracle, 2n, oracleAdmin);

        // Get USDC reserve data before liquidation
        const usdcReserveDataBeforeLiquidation: ReserveData =
          await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

        // Liquidator liquidates partial debt
        const liquidationTx = await lendingPool
          .connect(liquidator)
          .liquidationCall(
            await meld.getAddress(), // collateral asset
            await usdc.getAddress(), // debt asset
            meldBanker.address,
            debtToCover,
            false // receive mToken
          );

        const blockTimestamps: BlockTimestamps =
          await getBlockTimestamps(liquidationTx);

        // Get USDC reserve data after liquidation
        const usdcReserveDataAfterLiquidation: ReserveData =
          await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

        // Get MELD reserve data after liquidation
        const meldReserveDataAfterLiquidation: ReserveData =
          await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

        // Get borrower USDC reserve data after liquidation
        const borrowerUSDCDataAfterLiquidation: UserReserveData =
          await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await usdc.getAddress(),
            meldBanker.address
          );

        // Check that the correct events were emitted //
        await expect(liquidationTx)
          .to.emit(variableDebtToken, "Transfer")
          .withArgs(meldBanker.address, ZeroAddress, debtToCover);

        await expect(liquidationTx)
          .to.emit(variableDebtToken, "Burn")
          .withArgs(
            meldBanker.address,
            debtToCover,
            usdcReserveDataAfterLiquidation.variableBorrowIndex
          );

        await expect(liquidationTx).to.not.emit(stableDebtToken, "Transfer"); // not liquidating stable debt
        await expect(liquidationTx).to.not.emit(stableDebtToken, "Burn"); // not liquidating stable debt
        await expect(liquidationTx).to.not.emit(stableDebtToken, "Mint"); // not liquidating stable debt

        // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
        const contractInstanceWithLibraryABI = await ethers.getContractAt(
          "ReserveLogic",
          await lendingPool.getAddress(),
          owner
        );

        // The important thing here is checking that the event is emitted for the debt token. The values are checked in other test files.
        await expect(liquidationTx)
          .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
          .withArgs(
            await usdc.getAddress(),
            anyUint,
            anyUint,
            anyUint,
            anyUint,
            anyUint
          );

        // Mint to treasury because debt token (USDC) has reserveFactor > 0
        const currentVariableDebt =
          usdcReserveDataBeforeLiquidation.totalVariableDebt; // accrued
        const previousVariableDebt =
          usdcReserveDataBeforeLiquidation.scaledVariableDebt; // principal
        const currentStableDebt = BigInt(0); // no stable debt
        const previousStableDebt = BigInt(0); // no stable debt

        const totalDebtAccrued =
          currentVariableDebt +
          currentStableDebt -
          previousVariableDebt -
          previousStableDebt;

        const { reserveFactor } =
          await meldProtocolDataProvider.getReserveConfigurationData(
            await usdc.getAddress()
          );
        const amountToMint = totalDebtAccrued.percentMul(BigInt(reserveFactor));

        await expect(liquidationTx)
          .to.emit(mUSDC, "Transfer")
          .withArgs(ZeroAddress, treasury.address, isAlmostEqual(amountToMint));

        await expect(liquidationTx)
          .to.emit(mUSDC, "Mint")
          .withArgs(
            treasury.address,
            isAlmostEqual(amountToMint),
            usdcReserveDataAfterLiquidation.liquidityIndex
          );

        const { liquidationMultiplier, actualLiquidationProtocolFee } =
          await calcLiquidationMultiplierParams(
            meld,
            lendingPool,
            meldProtocolDataProvider
          );

        const maxLiquidatableCollateral = await calcMaxLiquidatableCollateral(
          meld,
          usdc,
          meldPriceOracle,
          liquidationMultiplier,
          debtToCover
        );

        const liquidationProtocolFeeAmount =
          actualLiquidationProtocolFee.percentMul(maxLiquidatableCollateral);

        const liquidatorAmount =
          maxLiquidatableCollateral - liquidationProtocolFeeAmount;

        // Events emitted when collateral mToken is burned, which sends underlying asset to liquidator
        const liquidityIndex = calcExpectedReserveNormalizedIncome(
          meldReserveDataAfterLiquidation,
          blockTimestamps.txTimestamp
        );

        await expect(liquidationTx)
          .to.emit(mMELD, "Transfer")
          .withArgs(
            meldBanker.address,
            ZeroAddress,
            liquidationProtocolFeeAmount
          );

        await expect(liquidationTx)
          .to.emit(mMELD, "Transfer")
          .withArgs(meldBanker.address, ZeroAddress, liquidatorAmount);

        await expect(liquidationTx)
          .to.emit(meld, "Transfer")
          .withArgs(
            await mMELD.getAddress(),
            treasury.address,
            liquidationProtocolFeeAmount
          );

        await expect(liquidationTx)
          .to.emit(meld, "Transfer")
          .withArgs(
            await mMELD.getAddress(),
            liquidator.address,
            liquidatorAmount
          );

        await expect(liquidationTx)
          .to.emit(mMELD, "Burn")
          .withArgs(
            meldBanker.address,
            treasury.address,
            liquidationProtocolFeeAmount,
            liquidityIndex
          );

        await expect(liquidationTx)
          .to.emit(mMELD, "Burn")
          .withArgs(
            meldBanker.address,
            liquidator.address,
            liquidatorAmount,
            liquidityIndex
          );

        await expect(liquidationTx).to.not.emit(mMELD, "BalanceTransfer"); // liquidator elected to not receive mTokens

        // Event emitted when debt token is transferred from liquidator to pay off debt
        await expect(liquidationTx)
          .to.emit(usdc, "Transfer")
          .withArgs(liquidator.address, await mUSDC.getAddress(), debtToCover);

        // ReserveUsedAsCollateralDisabled and  ReserveUsedAsCollateralEnabled Events are defined in library LiquidationLogic.sol,
        // so we need to get the contract instance with the LiquidationLogic ABI
        const contractInstanceWithLogicLibraryABI = await ethers.getContractAt(
          "LiquidationLogic",
          await lendingPool.getAddress(),
          owner
        );

        // Event not emitted because liquidator elected not to receive mTokens
        await expect(liquidationTx).to.not.emit(
          contractInstanceWithLogicLibraryABI,
          "ReserveUsedAsCollateralEnabled"
        );

        // borrower's balance of collateral mTokens did not go to 0
        await expect(liquidationTx).to.not.emit(
          contractInstanceWithLogicLibraryABI,
          "ReserveUsedAsCollateralDisabled"
        );

        // liquidator liquidated partial debt
        await expect(liquidationTx)
          .to.emit(contractInstanceWithLogicLibraryABI, "LiquidationCall")
          .withArgs(
            await meld.getAddress(),
            await usdc.getAddress(),
            meldBanker.address,
            debtToCover,
            maxLiquidatableCollateral,
            liquidator.address,
            false
          );

        // MELD Banker
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
          borrowerUSDCDataAfterLiquidation.currentVariableDebt.percentMul(
            yieldBoostMultiplier
          );

        await expect(liquidationTx)
          .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
          .withArgs(
            meldBanker.address,
            expectedOldStakedAmount,
            expectedNewStakedAmount
          );

        await expect(liquidationTx).to.not.emit(
          yieldBoostStakingUSDC,
          "StakePositionRemoved"
        );

        await expect(liquidationTx).to.not.emit(
          yieldBoostStakingUSDC,
          "RewardsClaimed"
        );

        await expect(liquidationTx)
          .to.emit(lendingPool, "RefreshYieldBoostAmount")
          .withArgs(
            await usdc.getAddress(),
            meldBanker.address,
            expectedNewStakedAmount
          );

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

        // Liquidator gets MELD transferred, which is not a yield boost token
        await expect(liquidationTx).to.not.emit(
          yieldBoostStakingUSDC,
          "StakePositionCreated"
        );

        //Can't check that StakePositionUpdated is not emitted because it is emitted in the same tx for the meldBanker
        //Can't check that RefreshYieldBoostAmount is not emitted because it is emitted in the same tx for the meldBanker

        await expect(liquidationTx).to.not.emit(
          lendingPool,
          "UnlockMeldBankerNFT"
        );

        const liquidaterMeldBankerData = await lendingPool.userMeldBankerData(
          liquidator.address
        );

        expect(await lendingPool.isUsingMeldBanker(liquidator.address)).to.be
          .false;

        expect(await lendingPool.isMeldBankerBlocked(0n)).to.be.false;

        expect(liquidaterMeldBankerData.tokenId).to.equal(0n);
        expect(liquidaterMeldBankerData.asset).to.equal(ZeroAddress);
        expect(liquidaterMeldBankerData.meldBankerType).to.equal(
          MeldBankerType.NONE
        );
        expect(liquidaterMeldBankerData.action).to.equal(Action.NONE);

        expect(
          await yieldBoostStorageUSDC.getStakerStakedAmount(liquidator.address)
        ).to.equal(0n);
      });

      it("Should calculate correct stake amounts if liquidator receives collateral mToken that is a yield boost token", async function () {
        const {
          lendingPool,
          meldProtocolDataProvider,
          lendingRateOracleAggregator,
          meldPriceOracle,
          addressesProvider,
          meld,
          dai,
          usdc,
          owner,
          liquidator,
          treasury,
          oracleAdmin,
          rewardsSetter,
          meldBanker,
          meldBankerTokenId,
          yieldBoostStakingUSDC,
          yieldBoostStorageUSDC,
          yieldBoostStakingDAI,
          yieldBoostStorageDAI,
          borrowAmountMeldBankerUSDC,
        } = await loadFixture(setUpMeldBankersBorrowWithDAICollateralFixture);
        // Meld Banker deposited DAI collateral without using NFT tokenId and borrowed USDC using NFT tokenId

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

        // Instantiate collateral reserve token contracts
        const daiReserveTokenAddresses =
          await meldProtocolDataProvider.getReserveTokensAddresses(
            await dai.getAddress()
          );

        const mDAI = await ethers.getContractAt(
          "MToken",
          daiReserveTokenAddresses.mTokenAddress
        );

        // Instantiate debt reserve token contracts
        const usdcReserveTokenAddresses =
          await meldProtocolDataProvider.getReserveTokensAddresses(
            await usdc.getAddress()
          );

        const mUSDC = await ethers.getContractAt(
          "MToken",
          usdcReserveTokenAddresses.mTokenAddress
        );

        const stableDebtToken = await ethers.getContractAt(
          "StableDebtToken",
          usdcReserveTokenAddresses.stableDebtTokenAddress
        );

        const variableDebtToken = await ethers.getContractAt(
          "VariableDebtToken",
          usdcReserveTokenAddresses.variableDebtTokenAddress
        );

        // Make sure liquidator has funds with which to liquidate
        await allocateAndApproveTokens(
          usdc,
          owner,
          liquidator,
          lendingPool,
          10_000n,
          0n
        );

        const [currentPrice, success] = await meldPriceOracle.getAssetPrice(
          await dai.getAddress()
        );

        expect(success).to.be.true;

        // Simulate price of collateral (DAI) going down drastically so that position is liquidatable
        // In reality, DAI is not likely to so drastically go down in value, but this is the easist way to
        // get the health factor < 1
        const newPrice = (10n * currentPrice) / 12n; // price goes down by 1.2 times (currentPrice/1.2). workaround because can't use decimals with bigint
        await meldPriceOracle
          .connect(oracleAdmin)
          .setAssetPrice(await dai.getAddress(), newPrice);

        // Get borrower USDC reserve data before liquidation
        const borrowerUSDCDataBeforeLiquidation: UserReserveData =
          await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await usdc.getAddress(),
            meldBanker.address
          );

        const liquidatorMTokenBalanceBeforeLiquidation = await mDAI.balanceOf(
          liquidator.address
        );

        const meldBankerDataBefore = await lendingPool.userMeldBankerData(
          meldBanker.address
        );

        const yieldBoostMultiplier = await lendingPool.yieldBoostMultipliers(
          meldBankerDataBefore.meldBankerType,
          meldBankerDataBefore.action
        );

        // Get USDC reserve data before liquidation
        const usdcReserveDataBeforeLiquidation: ReserveData =
          await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

        // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
        time.setNextBlockTimestamp(await time.latest());

        // Liquidator liquidates all liquidatable debt (up to close factor)
        const liquidationTx = await lendingPool
          .connect(liquidator)
          .liquidationCall(
            await dai.getAddress(), // collateral asset
            await usdc.getAddress(), // debt asset
            meldBanker.address,
            MaxUint256, // flag for all liquidatable debt
            true // receive mToken
          );

        const blockTimestamps: BlockTimestamps =
          await getBlockTimestamps(liquidationTx);

        // Get USDC reserve data after liquidation
        const usdcReserveDataAfterLiquidation: ReserveData =
          await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

        // Get MELD reserve data after liquidation
        const meldReserveDataAfterLiquidation: ReserveData =
          await getReserveData(
            meldProtocolDataProvider,
            await dai.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

        const maxLiquidatableDebt = (
          borrowerUSDCDataBeforeLiquidation.currentStableDebt +
          borrowerUSDCDataBeforeLiquidation.currentVariableDebt
        ).percentMul(LIQUIDATION_CLOSE_FACTOR_PERCENT);

        // Check that the correct events were emitted //

        await expect(liquidationTx)
          .to.emit(variableDebtToken, "Transfer")
          .withArgs(meldBanker.address, ZeroAddress, maxLiquidatableDebt);

        await expect(liquidationTx)
          .to.emit(variableDebtToken, "Burn")
          .withArgs(
            meldBanker.address,
            maxLiquidatableDebt,
            usdcReserveDataAfterLiquidation.variableBorrowIndex
          );

        await expect(liquidationTx).to.not.emit(stableDebtToken, "Transfer"); // not liquidating stable debt
        await expect(liquidationTx).to.not.emit(stableDebtToken, "Burn"); // not liquidating stable debt
        await expect(liquidationTx).to.not.emit(stableDebtToken, "Mint"); // not liquidating stable debt

        // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
        const contractInstanceWithLibraryABI = await ethers.getContractAt(
          "ReserveLogic",
          await lendingPool.getAddress(),
          owner
        );

        // The important thing here is checking that the event is emitted for the debt token. The values are checked in other test files.
        await expect(liquidationTx)
          .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
          .withArgs(
            await usdc.getAddress(),
            anyUint,
            anyUint,
            anyUint,
            anyUint,
            anyUint
          );

        // Mint to treasury because debt token (USDC) has reserveFactor > 0
        const currentVariableDebt =
          usdcReserveDataBeforeLiquidation.totalVariableDebt;
        const previousVariableDebt =
          usdcReserveDataBeforeLiquidation.scaledVariableDebt;
        const currentStableDebt =
          usdcReserveDataBeforeLiquidation.totalStableDebt;
        const previousStableDebt =
          usdcReserveDataBeforeLiquidation.principalStableDebt;

        const totalDebtAccrued =
          currentVariableDebt +
          currentStableDebt -
          previousVariableDebt -
          previousStableDebt;

        const { reserveFactor } =
          await meldProtocolDataProvider.getReserveConfigurationData(
            await usdc.getAddress()
          );
        const amountToMint = totalDebtAccrued.percentMul(BigInt(reserveFactor));

        await expect(liquidationTx)
          .to.emit(mUSDC, "Transfer")
          .withArgs(ZeroAddress, treasury.address, isAlmostEqual(amountToMint));

        await expect(liquidationTx)
          .to.emit(mUSDC, "Mint")
          .withArgs(
            treasury.address,
            isAlmostEqual(amountToMint),
            usdcReserveDataAfterLiquidation.liquidityIndex
          );

        const { liquidationMultiplier, actualLiquidationProtocolFee } =
          await calcLiquidationMultiplierParams(
            dai,
            lendingPool,
            meldProtocolDataProvider
          );

        const maxLiquidatableCollateral = await calcMaxLiquidatableCollateral(
          dai,
          usdc,
          meldPriceOracle,
          liquidationMultiplier,
          maxLiquidatableDebt
        );

        const liquidationProtocolFeeAmount =
          actualLiquidationProtocolFee.percentMul(maxLiquidatableCollateral);

        const liquidatorAmount =
          maxLiquidatableCollateral - liquidationProtocolFeeAmount;

        // Events emitted when liquidator receives collateral mToken
        const liquidityIndex = calcExpectedReserveNormalizedIncome(
          meldReserveDataAfterLiquidation,
          blockTimestamps.txTimestamp
        );

        await expect(liquidationTx)
          .to.emit(mDAI, "BalanceTransfer")
          .withArgs(
            meldBanker.address,
            treasury.address,
            liquidationProtocolFeeAmount,
            liquidityIndex
          );

        await expect(liquidationTx)
          .to.emit(mDAI, "BalanceTransfer")
          .withArgs(
            meldBanker.address,
            liquidator.address,
            liquidatorAmount,
            liquidityIndex
          );

        await expect(liquidationTx)
          .to.emit(mDAI, "Transfer")
          .withArgs(
            meldBanker.address,
            treasury.address,
            liquidationProtocolFeeAmount
          );

        await expect(liquidationTx)
          .to.emit(mDAI, "Transfer")
          .withArgs(meldBanker.address, liquidator.address, liquidatorAmount);

        // liquidator chose mTokens instead of underlying collateral asset
        expect(await mDAI.balanceOf(liquidator.address)).to.be.greaterThan(
          liquidatorMTokenBalanceBeforeLiquidation
        );

        // Event emitted when debt token is transferred from liquidator to pay off debt
        await expect(liquidationTx)
          .to.emit(usdc, "Transfer")
          .withArgs(
            liquidator.address,
            await mUSDC.getAddress(),
            maxLiquidatableDebt
          );

        // ReserveUsedAsCollateralDisabled and  ReserveUsedAsCollateralEnabled Events are defined in library LiquidationLogic.sol,
        //so we need to get the contract instance with the LiquidationLogic ABI
        const contractInstanceWithLogicLibraryABI = await ethers.getContractAt(
          "LiquidationLogic",
          await lendingPool.getAddress(),
          owner
        );

        await expect(liquidationTx).to.not.emit(
          contractInstanceWithLogicLibraryABI,
          "ReserveUsedAsCollateralDisabled"
        ); // borrower's balance of collateral mTokens did not go to 0
        await expect(liquidationTx).to.emit(
          contractInstanceWithLogicLibraryABI,
          "ReserveUsedAsCollateralEnabled"
        ); // liquidator did not have balance of collateral mTokens

        await expect(liquidationTx)
          .to.emit(contractInstanceWithLogicLibraryABI, "LiquidationCall")
          .withArgs(
            await dai.getAddress(),
            await usdc.getAddress(),
            meldBanker.address,
            maxLiquidatableDebt,
            maxLiquidatableCollateral,
            liquidator.address,
            true
          );

        // MELD Banker
        const expectedOldMeldBankerStakedAmount =
          borrowAmountMeldBankerUSDC.percentMul(yieldBoostMultiplier);

        await expect(liquidationTx)
          .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
          .withArgs(meldBanker.address, expectedOldMeldBankerStakedAmount, 0n);

        await expect(liquidationTx)
          .to.emit(yieldBoostStakingUSDC, "StakePositionRemoved")
          .withArgs(meldBanker.address, expectedOldMeldBankerStakedAmount);

        await expect(liquidationTx)
          .to.emit(yieldBoostStakingUSDC, "RewardsClaimed")
          .withArgs(meldBanker.address, meldBanker.address, anyUint, anyUint);

        await expect(liquidationTx)
          .to.emit(lendingPool, "RefreshYieldBoostAmount")
          .withArgs(await usdc.getAddress(), meldBanker.address, 0n);

        await expect(liquidationTx)
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

        // Liquidator gets mDAI transferred, which is  a yield boost token
        // Liquidator gets treated like a regular user because there is no actual deposit with a MELD Banker NFT tokenId
        const liquidaterMeldBankerData = await lendingPool.userMeldBankerData(
          liquidator.address
        );

        // Liquidator and treasury are regular users and gets mTokens, which is the same as doing a deposit
        const yieldBoostMultiplierRegularUserDeposit =
          await lendingPool.yieldBoostMultipliers(
            MeldBankerType.NONE,
            Action.DEPOSIT
          );

        const expectedLiquidatorStakedAmount = (
          liquidatorMTokenBalanceBeforeLiquidation +
          maxLiquidatableCollateral -
          liquidationProtocolFeeAmount
        ).percentMul(yieldBoostMultiplierRegularUserDeposit);

        await expect(liquidationTx)
          .to.emit(yieldBoostStakingDAI, "StakePositionCreated")
          .withArgs(liquidator.address, expectedLiquidatorStakedAmount);

        await expect(liquidationTx)
          .to.emit(yieldBoostStakingDAI, "StakePositionUpdated")
          .withArgs(liquidator.address, 0n, expectedLiquidatorStakedAmount);

        await expect(liquidationTx)
          .to.emit(lendingPool, "RefreshYieldBoostAmount")
          .withArgs(
            await dai.getAddress(),
            liquidator.address,
            expectedLiquidatorStakedAmount
          );

        expect(liquidaterMeldBankerData.tokenId).to.equal(0n);
        expect(liquidaterMeldBankerData.asset).to.equal(ZeroAddress);
        expect(liquidaterMeldBankerData.meldBankerType).to.equal(
          MeldBankerType.NONE
        );
        expect(liquidaterMeldBankerData.action).to.equal(Action.NONE);

        expect(
          await yieldBoostStorageDAI.getStakerStakedAmount(liquidator.address)
        ).to.equal(expectedLiquidatorStakedAmount);

        expect(
          await yieldBoostStorageUSDC.getStakerStakedAmount(liquidator.address)
        ).to.equal(0n);

        // Treasury
        const expectedTreasuryStakedAmount =
          liquidationProtocolFeeAmount.percentMul(
            yieldBoostMultiplierRegularUserDeposit
          );

        await expect(liquidationTx)
          .to.emit(yieldBoostStakingDAI, "StakePositionCreated")
          .withArgs(treasury.address, expectedTreasuryStakedAmount);

        await expect(liquidationTx)
          .to.emit(yieldBoostStakingDAI, "StakePositionUpdated")
          .withArgs(treasury.address, 0n, expectedTreasuryStakedAmount);

        await expect(liquidationTx)
          .to.emit(lendingPool, "RefreshYieldBoostAmount")
          .withArgs(
            await dai.getAddress(),
            treasury.address,
            expectedTreasuryStakedAmount
          );

        const treasuryMeldBankerData = await lendingPool.userMeldBankerData(
          treasury.address
        );

        expect(treasuryMeldBankerData.tokenId).to.equal(0n);
        expect(treasuryMeldBankerData.asset).to.equal(ZeroAddress);
        expect(treasuryMeldBankerData.meldBankerType).to.equal(
          MeldBankerType.NONE
        );
        expect(treasuryMeldBankerData.action).to.equal(Action.NONE);

        expect(
          await yieldBoostStorageDAI.getStakerStakedAmount(treasury.address)
        ).to.equal(expectedTreasuryStakedAmount);

        expect(
          await yieldBoostStorageUSDC.getStakerStakedAmount(treasury.address)
        ).to.equal(0n);
      });

      it("Should calculate correct stake amounts if liquidator is also Meld Banker and already used Meld Banker NFT to deposit same collateral asset", async function () {
        const {
          lendingPool,
          meldProtocolDataProvider,
          lendingRateOracleAggregator,
          meldPriceOracle,
          meldBankerNft,
          addressesProvider,
          dai,
          usdc,
          meld,
          owner,
          liquidator,
          treasury,
          oracleAdmin,
          bankerAdmin,
          rewardsSetter,
          meldBanker,
          meldBankerTokenId,
          yieldBoostStakingUSDC,
          yieldBoostStorageUSDC,
          yieldBoostStakingDAI,
          yieldBoostStorageDAI,
          borrowAmountMeldBankerUSDC,
        } = await loadFixture(setUpMeldBankersBorrowWithDAICollateralFixture);

        // Both collateral and debt tokens are yield boost tokens.
        // Meld Banker deposited DAI collateral without using NFT tokenId and borrowed USDC using NFT tokenId
        // Liquidator is also a MELD Banker and uses an NFT tokenId to deposit DAI collateral

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

        // First mint NFT to liquidator
        const liquidatorTokenId = 3n;
        const golden = false;
        await meldBankerNft
          .connect(bankerAdmin)
          .mint(liquidator, liquidatorTokenId, golden);

        // liquidator deposits DAI with NFT
        const depositAmountDAILiquidator = await allocateAndApproveTokens(
          dai,
          owner,
          liquidator,
          lendingPool,
          1000n,
          0n
        );

        await lendingPool
          .connect(liquidator)
          .deposit(
            await dai.getAddress(),
            depositAmountDAILiquidator,
            liquidator.address,
            true,
            liquidatorTokenId
          );

        // Instantiate collateral reserve token contracts
        const daiReserveTokenAddresses =
          await meldProtocolDataProvider.getReserveTokensAddresses(
            await dai.getAddress()
          );

        const mDAI = await ethers.getContractAt(
          "MToken",
          daiReserveTokenAddresses.mTokenAddress
        );

        // Instantiate debt reserve token contracts
        const usdcReserveTokenAddresses =
          await meldProtocolDataProvider.getReserveTokensAddresses(
            await usdc.getAddress()
          );

        const mUSDC = await ethers.getContractAt(
          "MToken",
          usdcReserveTokenAddresses.mTokenAddress
        );

        const stableDebtToken = await ethers.getContractAt(
          "StableDebtToken",
          usdcReserveTokenAddresses.stableDebtTokenAddress
        );

        const variableDebtToken = await ethers.getContractAt(
          "VariableDebtToken",
          usdcReserveTokenAddresses.variableDebtTokenAddress
        );

        // Make sure liquidator has funds with which to liquidate
        await allocateAndApproveTokens(
          usdc,
          owner,
          liquidator,
          lendingPool,
          10_000n,
          0n
        );

        const [currentPrice, success] = await meldPriceOracle.getAssetPrice(
          await dai.getAddress()
        );

        expect(success).to.be.true;

        // Simulate price of collateral (DAI) going down drastically so that position is liquidatable
        // In reality, DAI is not likely to so drastically go down in value, but this is the easist way to
        // get the health factor < 1
        const newPrice = (10n * currentPrice) / 12n; // price goes down by 1.2 times (currentPrice/1.2). workaround because can't use decimals with bigint
        await meldPriceOracle
          .connect(oracleAdmin)
          .setAssetPrice(await dai.getAddress(), newPrice);

        // Get borrower USDC reserve data before liquidation
        const borrowerUSDCDataBeforeLiquidation: UserReserveData =
          await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await usdc.getAddress(),
            meldBanker.address
          );

        const liquidatorMTokenBalanceBeforeLiquidation = await mDAI.balanceOf(
          liquidator.address
        );

        const meldBankerDataBefore = await lendingPool.userMeldBankerData(
          meldBanker.address
        );

        const yieldBoostMultiplier = await lendingPool.yieldBoostMultipliers(
          meldBankerDataBefore.meldBankerType,
          meldBankerDataBefore.action
        );

        // Get USDC reserve data before liquidation
        const usdcReserveDataBeforeLiquidation: ReserveData =
          await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

        // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
        time.setNextBlockTimestamp(await time.latest());

        // Liquidator liquidates all liquidatable debt (up to close factor)
        const liquidationTx = await lendingPool
          .connect(liquidator)
          .liquidationCall(
            await dai.getAddress(), // collateral asset
            await usdc.getAddress(), // debt asset
            meldBanker.address,
            MaxUint256, // flag for all liquidatable debt
            true // receive mToken
          );

        const blockTimestamps: BlockTimestamps =
          await getBlockTimestamps(liquidationTx);

        // Get USDC reserve data after liquidation
        const usdcReserveDataAfterLiquidation: ReserveData =
          await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

        // Get MELD reserve data after liquidation
        const meldReserveDataAfterLiquidation: ReserveData =
          await getReserveData(
            meldProtocolDataProvider,
            await dai.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

        const maxLiquidatableDebt = (
          borrowerUSDCDataBeforeLiquidation.currentStableDebt +
          borrowerUSDCDataBeforeLiquidation.currentVariableDebt
        ).percentMul(LIQUIDATION_CLOSE_FACTOR_PERCENT);

        // Check that the correct events were emitted //

        await expect(liquidationTx)
          .to.emit(variableDebtToken, "Transfer")
          .withArgs(meldBanker.address, ZeroAddress, maxLiquidatableDebt);

        await expect(liquidationTx)
          .to.emit(variableDebtToken, "Burn")
          .withArgs(
            meldBanker.address,
            maxLiquidatableDebt,
            usdcReserveDataAfterLiquidation.variableBorrowIndex
          );

        await expect(liquidationTx).to.not.emit(stableDebtToken, "Transfer"); // not liquidating stable debt
        await expect(liquidationTx).to.not.emit(stableDebtToken, "Burn"); // not liquidating stable debt
        await expect(liquidationTx).to.not.emit(stableDebtToken, "Mint"); // not liquidating stable debt

        // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
        const contractInstanceWithLibraryABI = await ethers.getContractAt(
          "ReserveLogic",
          await lendingPool.getAddress(),
          owner
        );

        // The important thing here is checking that the event is emitted for the debt token. The values are checked in other test files.
        await expect(liquidationTx)
          .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
          .withArgs(
            await usdc.getAddress(),
            anyUint,
            anyUint,
            anyUint,
            anyUint,
            anyUint
          );

        // Mint to treasury because debt token (USDC) has reserveFactor > 0
        const currentVariableDebt =
          usdcReserveDataBeforeLiquidation.totalVariableDebt;
        const previousVariableDebt =
          usdcReserveDataBeforeLiquidation.scaledVariableDebt;
        const currentStableDebt =
          usdcReserveDataBeforeLiquidation.totalStableDebt;
        const previousStableDebt =
          usdcReserveDataBeforeLiquidation.principalStableDebt;

        const totalDebtAccrued =
          currentVariableDebt +
          currentStableDebt -
          previousVariableDebt -
          previousStableDebt;

        const { reserveFactor } =
          await meldProtocolDataProvider.getReserveConfigurationData(
            await usdc.getAddress()
          );
        const amountToMint = totalDebtAccrued.percentMul(BigInt(reserveFactor));

        await expect(liquidationTx)
          .to.emit(mUSDC, "Transfer")
          .withArgs(ZeroAddress, treasury.address, isAlmostEqual(amountToMint));

        await expect(liquidationTx)
          .to.emit(mUSDC, "Mint")
          .withArgs(
            treasury.address,
            isAlmostEqual(amountToMint),
            usdcReserveDataAfterLiquidation.liquidityIndex
          );

        const { liquidationMultiplier, actualLiquidationProtocolFee } =
          await calcLiquidationMultiplierParams(
            dai,
            lendingPool,
            meldProtocolDataProvider
          );

        const maxLiquidatableCollateral = await calcMaxLiquidatableCollateral(
          dai,
          usdc,
          meldPriceOracle,
          liquidationMultiplier,
          maxLiquidatableDebt
        );

        const liquidationProtocolFeeAmount =
          actualLiquidationProtocolFee.percentMul(maxLiquidatableCollateral);

        const liquidatorAmount =
          maxLiquidatableCollateral - liquidationProtocolFeeAmount;

        // Events emitted when liquidator receives collateral mToken
        const liquidityIndex = calcExpectedReserveNormalizedIncome(
          meldReserveDataAfterLiquidation,
          blockTimestamps.txTimestamp
        );

        await expect(liquidationTx)
          .to.emit(mDAI, "BalanceTransfer")
          .withArgs(
            meldBanker.address,
            treasury.address,
            liquidationProtocolFeeAmount,
            liquidityIndex
          );

        await expect(liquidationTx)
          .to.emit(mDAI, "BalanceTransfer")
          .withArgs(
            meldBanker.address,
            liquidator.address,
            liquidatorAmount,
            liquidityIndex
          );

        await expect(liquidationTx)
          .to.emit(mDAI, "Transfer")
          .withArgs(
            meldBanker.address,
            treasury.address,
            liquidationProtocolFeeAmount
          );

        await expect(liquidationTx)
          .to.emit(mDAI, "Transfer")
          .withArgs(meldBanker.address, liquidator.address, liquidatorAmount);

        // liquidator chose mTokens instead of underlying collateral asset
        expect(await mDAI.balanceOf(liquidator.address)).to.be.greaterThan(
          liquidatorMTokenBalanceBeforeLiquidation
        );

        // Event emitted when debt token is transferred from liquidator to pay off debt
        await expect(liquidationTx)
          .to.emit(usdc, "Transfer")
          .withArgs(
            liquidator.address,
            await mUSDC.getAddress(),
            maxLiquidatableDebt
          );

        // ReserveUsedAsCollateralDisabled and  ReserveUsedAsCollateralEnabled Events are defined in library LiquidationLogic.sol,
        //so we need to get the contract instance with the LiquidationLogic ABI
        const contractInstanceWithLogicLibraryABI = await ethers.getContractAt(
          "LiquidationLogic",
          await lendingPool.getAddress(),
          owner
        );

        await expect(liquidationTx).to.not.emit(
          contractInstanceWithLogicLibraryABI,
          "ReserveUsedAsCollateralDisabled"
        ); // borrower's balance of collateral mTokens did not go to 0
        await expect(liquidationTx).to.not.emit(
          contractInstanceWithLogicLibraryABI,
          "ReserveUsedAsCollateralEnabled"
        ); // liquidator did not have balance of collateral mTokens

        await expect(liquidationTx)
          .to.emit(contractInstanceWithLogicLibraryABI, "LiquidationCall")
          .withArgs(
            await dai.getAddress(),
            await usdc.getAddress(),
            meldBanker.address,
            maxLiquidatableDebt,
            maxLiquidatableCollateral,
            liquidator.address,
            true
          );

        // MELD Banker
        const expectedOldMeldBankerStakedAmount =
          borrowAmountMeldBankerUSDC.percentMul(yieldBoostMultiplier);

        await expect(liquidationTx)
          .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
          .withArgs(meldBanker.address, expectedOldMeldBankerStakedAmount, 0n);

        await expect(liquidationTx)
          .to.emit(yieldBoostStakingUSDC, "StakePositionRemoved")
          .withArgs(meldBanker.address, expectedOldMeldBankerStakedAmount);

        await expect(liquidationTx)
          .to.emit(yieldBoostStakingUSDC, "RewardsClaimed")
          .withArgs(meldBanker.address, meldBanker.address, anyUint, anyUint);

        await expect(liquidationTx)
          .to.emit(lendingPool, "RefreshYieldBoostAmount")
          .withArgs(await usdc.getAddress(), meldBanker.address, 0n);

        await expect(liquidationTx)
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

        // Liquidator gets mDAI transferred, which is a yield boost token
        // Liquidator is a MELD banker
        const liquidaterMeldBankerData = await lendingPool.userMeldBankerData(
          liquidator.address
        );

        // Liquidator is a MELD Banker and gets DAI mTokens, which is the same as doing a deposit
        const yieldBoostMultiplierLiquidator =
          await lendingPool.yieldBoostMultipliers(
            liquidaterMeldBankerData.meldBankerType,
            liquidaterMeldBankerData.action
          );

        const expectedLiquidatorOldStakedAmount =
          depositAmountDAILiquidator.percentMul(yieldBoostMultiplierLiquidator);
        const expectedLiquidatorNewStakedAmount = (
          liquidatorMTokenBalanceBeforeLiquidation +
          maxLiquidatableCollateral -
          liquidationProtocolFeeAmount
        ).percentMul(yieldBoostMultiplierLiquidator);

        await expect(liquidationTx)
          .to.emit(yieldBoostStakingDAI, "StakePositionUpdated")
          .withArgs(
            liquidator.address,
            expectedLiquidatorOldStakedAmount,
            expectedLiquidatorNewStakedAmount
          );

        await expect(liquidationTx)
          .to.emit(lendingPool, "RefreshYieldBoostAmount")
          .withArgs(
            await dai.getAddress(),
            liquidator.address,
            expectedLiquidatorNewStakedAmount
          );

        expect(liquidaterMeldBankerData.tokenId).to.equal(liquidatorTokenId);
        expect(liquidaterMeldBankerData.asset).to.equal(await dai.getAddress());
        expect(liquidaterMeldBankerData.meldBankerType).to.equal(
          MeldBankerType.BANKER
        );
        expect(liquidaterMeldBankerData.action).to.equal(Action.DEPOSIT);

        expect(
          await yieldBoostStorageDAI.getStakerStakedAmount(liquidator.address)
        ).to.equal(expectedLiquidatorNewStakedAmount);

        expect(
          await yieldBoostStorageUSDC.getStakerStakedAmount(liquidator.address)
        ).to.equal(0n);

        // Treasury
        // Treasury is a  regular user  and gets DAI mTokens, which is the same as doing a deposit
        const yieldBoostMultiplierRegularUserDeposit =
          await lendingPool.yieldBoostMultipliers(
            MeldBankerType.NONE,
            Action.DEPOSIT
          );

        const expectedTreasuryStakedAmount =
          liquidationProtocolFeeAmount.percentMul(
            yieldBoostMultiplierRegularUserDeposit
          );

        await expect(liquidationTx)
          .to.emit(yieldBoostStakingDAI, "StakePositionCreated")
          .withArgs(treasury.address, expectedTreasuryStakedAmount);

        await expect(liquidationTx)
          .to.emit(yieldBoostStakingDAI, "StakePositionUpdated")
          .withArgs(treasury.address, 0n, expectedTreasuryStakedAmount);

        await expect(liquidationTx)
          .to.emit(lendingPool, "RefreshYieldBoostAmount")
          .withArgs(
            await dai.getAddress(),
            treasury.address,
            expectedTreasuryStakedAmount
          );

        const treasuryMeldBankerData = await lendingPool.userMeldBankerData(
          treasury.address
        );

        expect(treasuryMeldBankerData.tokenId).to.equal(0n);
        expect(treasuryMeldBankerData.asset).to.equal(ZeroAddress);
        expect(treasuryMeldBankerData.meldBankerType).to.equal(
          MeldBankerType.NONE
        );
        expect(treasuryMeldBankerData.action).to.equal(Action.NONE);

        expect(
          await yieldBoostStorageDAI.getStakerStakedAmount(treasury.address)
        ).to.equal(expectedTreasuryStakedAmount);

        expect(
          await yieldBoostStorageUSDC.getStakerStakedAmount(treasury.address)
        ).to.equal(0n);
      });
    }); // End MELD Banker Context

    context("Golden Banker", async function () {
      it("Should unlock MELD Banker NFT if Golden Banker liquidates whole balance of yield boost token", async function () {
        const {
          lendingPool,
          meldProtocolDataProvider,
          lendingRateOracleAggregator,
          meldPriceOracle,
          addressesProvider,
          meld,
          usdc,
          owner,
          liquidator,
          treasury,
          oracleAdmin,
          rewardsSetter,
          goldenBanker,
          goldenBankerTokenId,
          borrowAmountGoldenBankerUSDC,
          yieldBoostStakingUSDC,
          yieldBoostStorageUSDC,
        } = await loadFixture(setUpMeldBankersBorrowFixture);

        // Non-yield boost token (MELD)is collateral token
        // Yield boost token (USDC) is debt token

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

        // Instantiate collateral reserve token contracts
        const meldReserveTokenAddresses =
          await meldProtocolDataProvider.getReserveTokensAddresses(
            await meld.getAddress()
          );

        const mMELD = await ethers.getContractAt(
          "MToken",
          meldReserveTokenAddresses.mTokenAddress
        );

        // Instantiate debt reserve token contracts
        const usdcReserveTokenAddresses =
          await meldProtocolDataProvider.getReserveTokensAddresses(
            await usdc.getAddress()
          );

        const mUSDC = await ethers.getContractAt(
          "MToken",
          usdcReserveTokenAddresses.mTokenAddress
        );

        const stableDebtToken = await ethers.getContractAt(
          "StableDebtToken",
          usdcReserveTokenAddresses.stableDebtTokenAddress
        );

        const variableDebtToken = await ethers.getContractAt(
          "VariableDebtToken",
          usdcReserveTokenAddresses.variableDebtTokenAddress
        );

        // Make sure liquidator has funds with which to liquidate
        await allocateAndApproveTokens(
          usdc,
          owner,
          liquidator,
          lendingPool,
          10_000n,
          0n
        );

        // Simulate price of collateral (MELD) going down drastically so that position is liquidatable
        await simulateAssetPriceCrash(meld, meldPriceOracle, 2n, oracleAdmin);

        // Get USDC reserve data before liquidation
        const usdcReserveDataBeforeLiquidation: ReserveData =
          await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

        // Get borrower USDC reserve data before liquidation
        const borrowerUSDCDataBeforeLiquidation: UserReserveData =
          await getUserData(
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

        // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
        time.setNextBlockTimestamp(await time.latest());

        // Liquidator liquidates all liquidatable debt (up to close factor)
        const liquidationTx = await lendingPool
          .connect(liquidator)
          .liquidationCall(
            await meld.getAddress(), // collateral asset
            await usdc.getAddress(), // debt asset
            goldenBanker.address,
            MaxUint256, // flag for all liquidatable debt
            false // liquidator will receive underlying token
          );

        const blockTimestamps: BlockTimestamps =
          await getBlockTimestamps(liquidationTx);

        // Get USDC reserve data after liquidation
        const usdcReserveDataAfterLiquidation: ReserveData =
          await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

        // Get MELD reserve data after liquidation
        const meldReserveDataAfterLiquidation: ReserveData =
          await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

        const maxLiquidatableDebt = (
          borrowerUSDCDataBeforeLiquidation.currentStableDebt +
          borrowerUSDCDataBeforeLiquidation.currentVariableDebt
        ).percentMul(LIQUIDATION_CLOSE_FACTOR_PERCENT);

        // Check that the correct events were emitted //

        await expect(liquidationTx)
          .to.emit(variableDebtToken, "Transfer")
          .withArgs(goldenBanker.address, ZeroAddress, maxLiquidatableDebt);

        await expect(liquidationTx)
          .to.emit(variableDebtToken, "Burn")
          .withArgs(
            goldenBanker.address,
            maxLiquidatableDebt,
            usdcReserveDataAfterLiquidation.variableBorrowIndex
          );

        await expect(liquidationTx).to.not.emit(stableDebtToken, "Transfer"); // not liquidating stable debt
        await expect(liquidationTx).to.not.emit(stableDebtToken, "Burn"); // not liquidating stable debt
        await expect(liquidationTx).to.not.emit(stableDebtToken, "Mint"); // not liquidating stable debt

        // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
        const contractInstanceWithLibraryABI = await ethers.getContractAt(
          "ReserveLogic",
          await lendingPool.getAddress(),
          owner
        );

        // The important thing here is checking that the event is emitted for the debt token. The values are checked in other test files.
        await expect(liquidationTx)
          .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
          .withArgs(
            await usdc.getAddress(),
            anyUint,
            anyUint,
            anyUint,
            anyUint,
            anyUint
          );

        // Mint to treasury because debt token (USDC) has reserveFactor > 0
        const currentVariableDebt =
          usdcReserveDataBeforeLiquidation.totalVariableDebt;
        const previousVariableDebt =
          usdcReserveDataBeforeLiquidation.scaledVariableDebt;
        const currentStableDebt =
          usdcReserveDataBeforeLiquidation.totalStableDebt;
        const previousStableDebt =
          usdcReserveDataBeforeLiquidation.principalStableDebt;

        const totalDebtAccrued =
          currentVariableDebt +
          currentStableDebt -
          previousVariableDebt -
          previousStableDebt;

        const { reserveFactor } =
          await meldProtocolDataProvider.getReserveConfigurationData(
            await usdc.getAddress()
          );
        const amountToMint = totalDebtAccrued.percentMul(BigInt(reserveFactor));

        await expect(liquidationTx)
          .to.emit(mUSDC, "Transfer")
          .withArgs(ZeroAddress, treasury.address, isAlmostEqual(amountToMint));

        await expect(liquidationTx)
          .to.emit(mUSDC, "Mint")
          .withArgs(
            treasury.address,
            isAlmostEqual(amountToMint),
            usdcReserveDataAfterLiquidation.liquidityIndex
          );

        const { liquidationMultiplier, actualLiquidationProtocolFee } =
          await calcLiquidationMultiplierParams(
            meld,
            lendingPool,
            meldProtocolDataProvider
          );

        const maxLiquidatableCollateral = await calcMaxLiquidatableCollateral(
          meld,
          usdc,
          meldPriceOracle,
          liquidationMultiplier,
          maxLiquidatableDebt
        );

        const liquidationProtocolFeeAmount =
          actualLiquidationProtocolFee.percentMul(maxLiquidatableCollateral);

        const liquidatorAmount =
          maxLiquidatableCollateral - liquidationProtocolFeeAmount;

        // Events emitted when liquidator receives collateral mToken
        const liquidityIndex = calcExpectedReserveNormalizedIncome(
          meldReserveDataAfterLiquidation,
          blockTimestamps.txTimestamp
        );

        // liquidator chose to receive underlying collateral asset
        await expect(liquidationTx)
          .to.emit(mMELD, "Transfer")
          .withArgs(
            goldenBanker.address,
            ZeroAddress,
            liquidationProtocolFeeAmount
          );

        await expect(liquidationTx)
          .to.emit(mMELD, "Transfer")
          .withArgs(goldenBanker.address, ZeroAddress, liquidatorAmount);

        await expect(liquidationTx)
          .to.emit(meld, "Transfer")
          .withArgs(
            await mMELD.getAddress(),
            treasury.address,
            liquidationProtocolFeeAmount
          );

        await expect(liquidationTx)
          .to.emit(meld, "Transfer")
          .withArgs(
            await mMELD.getAddress(),
            liquidator.address,
            liquidatorAmount
          );

        await expect(liquidationTx)
          .to.emit(mMELD, "Burn")
          .withArgs(
            goldenBanker.address,
            treasury.address,
            liquidationProtocolFeeAmount,
            liquidityIndex
          );

        await expect(liquidationTx)
          .to.emit(mMELD, "Burn")
          .withArgs(
            goldenBanker.address,
            liquidator.address,
            liquidatorAmount,
            liquidityIndex
          );

        await expect(liquidationTx).to.not.emit(mMELD, "BalanceTransfer"); // liquidator elected to not receive mTokens

        // Event emitted when debt token is transferred from liquidator to pay off debt
        await expect(liquidationTx)
          .to.emit(usdc, "Transfer")
          .withArgs(
            liquidator.address,
            await mUSDC.getAddress(),
            maxLiquidatableDebt
          );

        // ReserveUsedAsCollateralDisabled and  ReserveUsedAsCollateralEnabled Events are defined in library LiquidationLogic.sol,
        //so we need to get the contract instance with the LiquidationLogic ABI
        const contractInstanceWithLogicLibraryABI = await ethers.getContractAt(
          "LiquidationLogic",
          await lendingPool.getAddress(),
          owner
        );

        await expect(liquidationTx).to.not.emit(
          contractInstanceWithLogicLibraryABI,
          "ReserveUsedAsCollateralDisabled"
        );

        await expect(liquidationTx).to.not.emit(
          contractInstanceWithLogicLibraryABI,
          "ReserveUsedAsCollateralEnabled"
        ); // liquidator did not receive mTokens

        await expect(liquidationTx)
          .to.emit(contractInstanceWithLogicLibraryABI, "LiquidationCall")
          .withArgs(
            await meld.getAddress(),
            await usdc.getAddress(),
            goldenBanker.address,
            maxLiquidatableDebt,
            maxLiquidatableCollateral,
            liquidator.address,
            false
          );

        // MELD Banker
        const expectedOldMeldBankerStakedAmount =
          borrowAmountGoldenBankerUSDC.percentMul(yieldBoostMultiplier);

        await expect(liquidationTx)
          .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
          .withArgs(
            goldenBanker.address,
            expectedOldMeldBankerStakedAmount,
            0n
          );

        await expect(liquidationTx)
          .to.emit(yieldBoostStakingUSDC, "StakePositionRemoved")
          .withArgs(goldenBanker.address, expectedOldMeldBankerStakedAmount);

        await expect(liquidationTx)
          .to.emit(yieldBoostStakingUSDC, "RewardsClaimed")
          .withArgs(
            goldenBanker.address,
            goldenBanker.address,
            anyUint,
            anyUint
          );

        await expect(liquidationTx)
          .to.emit(lendingPool, "RefreshYieldBoostAmount")
          .withArgs(await usdc.getAddress(), goldenBanker.address, 0n);

        await expect(liquidationTx)
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

        // Liquidator gets MELD transferred, which is not a yield boost token
        await expect(liquidationTx).to.not.emit(
          yieldBoostStakingUSDC,
          "StakePositionCreated"
        );

        //Can't check that StakePositionUpdated is not emitted because it is emitted in the same tx for the meldBanker
        //Can't check that RefreshYieldBoostAmount is not emitted because it is emitted in the same tx for the meldBanker

        const liquidaterMeldBankerData = await lendingPool.userMeldBankerData(
          liquidator.address
        );

        expect(await lendingPool.isUsingMeldBanker(liquidator.address)).to.be
          .false;

        expect(await lendingPool.isMeldBankerBlocked(0n)).to.be.false;

        expect(liquidaterMeldBankerData.tokenId).to.equal(0n);
        expect(liquidaterMeldBankerData.asset).to.equal(ZeroAddress);
        expect(liquidaterMeldBankerData.meldBankerType).to.equal(
          MeldBankerType.NONE
        );
        expect(liquidaterMeldBankerData.action).to.equal(Action.NONE);

        expect(
          await yieldBoostStorageUSDC.getStakerStakedAmount(liquidator.address)
        ).to.equal(0n);

        // Treasury is a regular user. Gets no yield boost because liquidator chose to receive underlying asset instead of mTokens
        const treasuryMeldBankerData = await lendingPool.userMeldBankerData(
          treasury.address
        );

        expect(treasuryMeldBankerData.tokenId).to.equal(0n);
        expect(treasuryMeldBankerData.asset).to.equal(ZeroAddress);
        expect(treasuryMeldBankerData.meldBankerType).to.equal(
          MeldBankerType.NONE
        );
        expect(treasuryMeldBankerData.action).to.equal(Action.NONE);

        expect(
          await yieldBoostStorageUSDC.getStakerStakedAmount(treasury.address)
        ).to.equal(0n);
      });

      it("Should NOT unlock MELD Banker NFT if Golden Banker liquidates whole balance of a different yield boost token", async function () {
        const {
          lendingPool,
          meldProtocolDataProvider,
          lendingRateOracleAggregator,
          meldPriceOracle,
          addressesProvider,
          meld,
          usdc,
          dai,
          owner,
          liquidator,
          treasury,
          oracleAdmin,
          rewardsSetter,
          goldenBanker,
          goldenBankerTokenId,
          borrowAmountGoldenBankerUSDC,
          yieldBoostStakingUSDC,
          yieldBoostStorageUSDC,
        } = await loadFixture(setUpMeldBankersBorrowFixture);
        // Non-yield boost token (MELD)is collateral token
        // Yield boost token (DAI) is debt token
        // Golden banker is not using tokenId to borrow DAI.

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
          "500"
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

        // Allocate DAI to liquidator so can repay later
        await allocateAndApproveTokens(
          dai,
          owner,
          liquidator,
          lendingPool,
          1000n * 2n, // 2x the amount borrowed
          0n
        );

        // Instantiate collateral reserve token contracts
        const meldReserveTokenAddresses =
          await meldProtocolDataProvider.getReserveTokensAddresses(
            await meld.getAddress()
          );

        const mMELD = await ethers.getContractAt(
          "MToken",
          meldReserveTokenAddresses.mTokenAddress
        );

        // Instantiate debt reserve token contracts
        const daiReserveTokenAddresses =
          await meldProtocolDataProvider.getReserveTokensAddresses(
            await dai.getAddress()
          );

        const mDAI = await ethers.getContractAt(
          "MToken",
          daiReserveTokenAddresses.mTokenAddress
        );

        const stableDebtToken = await ethers.getContractAt(
          "StableDebtToken",
          daiReserveTokenAddresses.stableDebtTokenAddress
        );

        const variableDebtToken = await ethers.getContractAt(
          "VariableDebtToken",
          daiReserveTokenAddresses.variableDebtTokenAddress
        );

        // Make sure liquidator has funds with which to liquidate
        await allocateAndApproveTokens(
          dai,
          owner,
          liquidator,
          lendingPool,
          1400n,
          0n
        );

        // Simulate price of collateral (MELD) going down drastically so that position is liquidatable
        await simulateAssetPriceCrash(meld, meldPriceOracle, 2n, oracleAdmin);

        // Get borrower DAI reserve data before liquidation
        const borrowerDAIDataBeforeLiquidation: UserReserveData =
          await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await dai.getAddress(),
            goldenBanker.address
          );

        // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
        time.setNextBlockTimestamp(await time.latest());

        // Liquidator liquidates all liquidatable debt (up to close factor)
        const liquidationTx = await lendingPool
          .connect(liquidator)
          .liquidationCall(
            await meld.getAddress(), // collateral asset
            await dai.getAddress(), // debt asset
            goldenBanker.address,
            MaxUint256, // flag for all liquidatable debt
            true // receive mToken
          );

        const blockTimestamps: BlockTimestamps =
          await getBlockTimestamps(liquidationTx);

        // Get DAI reserve data after liquidation
        const daiReserveDataAfterLiquidation: ReserveData =
          await getReserveData(
            meldProtocolDataProvider,
            await dai.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

        // Get MELD reserve data after liquidation
        const meldReserveDataAfterLiquidation: ReserveData =
          await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

        const maxLiquidatableDebt = (
          borrowerDAIDataBeforeLiquidation.currentStableDebt +
          borrowerDAIDataBeforeLiquidation.currentVariableDebt
        ).percentMul(LIQUIDATION_CLOSE_FACTOR_PERCENT);

        // Check that the correct events were emitted //

        await expect(liquidationTx)
          .to.emit(variableDebtToken, "Transfer")
          .withArgs(goldenBanker.address, ZeroAddress, maxLiquidatableDebt);

        await expect(liquidationTx)
          .to.emit(variableDebtToken, "Burn")
          .withArgs(
            goldenBanker.address,
            maxLiquidatableDebt,
            daiReserveDataAfterLiquidation.variableBorrowIndex
          );

        await expect(liquidationTx).to.not.emit(stableDebtToken, "Transfer"); // not liquidating stable debt
        await expect(liquidationTx).to.not.emit(stableDebtToken, "Burn"); // not liquidating stable debt
        await expect(liquidationTx).to.not.emit(stableDebtToken, "Mint"); // not liquidating stable debt

        // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
        const contractInstanceWithLibraryABI = await ethers.getContractAt(
          "ReserveLogic",
          await lendingPool.getAddress(),
          owner
        );

        // The important thing here is checking that the event is emitted for the debt token. The values are checked in other test files.
        await expect(liquidationTx)
          .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
          .withArgs(
            await dai.getAddress(),
            anyUint,
            anyUint,
            anyUint,
            anyUint,
            anyUint
          );

        const { liquidationMultiplier, actualLiquidationProtocolFee } =
          await calcLiquidationMultiplierParams(
            meld,
            lendingPool,
            meldProtocolDataProvider
          );

        const maxLiquidatableCollateral = await calcMaxLiquidatableCollateral(
          meld,
          dai,
          meldPriceOracle,
          liquidationMultiplier,
          maxLiquidatableDebt
        );

        const liquidationProtocolFeeAmount =
          actualLiquidationProtocolFee.percentMul(maxLiquidatableCollateral);

        const liquidatorAmount =
          maxLiquidatableCollateral - liquidationProtocolFeeAmount;

        // Events emitted when liquidator receives collateral mToken
        const liquidityIndex = calcExpectedReserveNormalizedIncome(
          meldReserveDataAfterLiquidation,
          blockTimestamps.txTimestamp
        );

        await expect(liquidationTx)
          .to.emit(mMELD, "BalanceTransfer")
          .withArgs(
            goldenBanker.address,
            treasury.address,
            liquidationProtocolFeeAmount,
            liquidityIndex
          );

        await expect(liquidationTx)
          .to.emit(mMELD, "BalanceTransfer")
          .withArgs(
            goldenBanker.address,
            liquidator.address,
            liquidatorAmount,
            liquidityIndex
          );

        await expect(liquidationTx)
          .to.emit(mMELD, "Transfer")
          .withArgs(
            goldenBanker.address,
            treasury.address,
            liquidationProtocolFeeAmount
          );

        await expect(liquidationTx)
          .to.emit(mMELD, "Transfer")
          .withArgs(goldenBanker.address, liquidator.address, liquidatorAmount);

        // liquidator chose mTokens instead of underlying collateral asset
        await expect(liquidationTx).to.not.emit(meld, "Transfer");

        // Event emitted when debt token is transferred from liquidator to pay off debt
        await expect(liquidationTx)
          .to.emit(dai, "Transfer")
          .withArgs(
            liquidator.address,
            await mDAI.getAddress(),
            maxLiquidatableDebt
          );

        // ReserveUsedAsCollateralDisabled and  ReserveUsedAsCollateralEnabled Events are defined in library LiquidationLogic.sol,
        //so we need to get the contract instance with the LiquidationLogic ABI
        const contractInstanceWithLogicLibraryABI = await ethers.getContractAt(
          "LiquidationLogic",
          await lendingPool.getAddress(),
          owner
        );

        await expect(liquidationTx).to.not.emit(
          contractInstanceWithLogicLibraryABI,
          "ReserveUsedAsCollateralDisabled"
        ); // borrower's balance of collateral mTokens did not go to 0

        await expect(liquidationTx).to.emit(
          contractInstanceWithLogicLibraryABI,
          "ReserveUsedAsCollateralEnabled"
        ); // liquidator did not already have balance of collateral mTokens

        await expect(liquidationTx)
          .to.emit(contractInstanceWithLogicLibraryABI, "LiquidationCall")
          .withArgs(
            await meld.getAddress(),
            await dai.getAddress(),
            goldenBanker.address,
            maxLiquidatableDebt,
            maxLiquidatableCollateral,
            liquidator.address,
            true
          );

        const meldBankerData = await lendingPool.userMeldBankerData(
          goldenBanker.address
        );

        await expect(liquidationTx).to.not.emit(
          yieldBoostStakingUSDC,
          "StakePositionUpdated"
        );

        await expect(liquidationTx).to.not.emit(
          yieldBoostStakingUSDC,
          "StakePositionRemoved"
        );

        await expect(liquidationTx).to.not.emit(
          yieldBoostStakingUSDC,
          "RewardsClaimed"
        );

        await expect(liquidationTx)
          .to.emit(lendingPool, "RefreshYieldBoostAmount")
          .withArgs(await dai.getAddress(), goldenBanker.address, 0n);

        await expect(liquidationTx).to.not.emit(
          lendingPool,
          "UnlockMeldBankerNFT"
        );

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
          borrowAmountGoldenBankerUSDC.percentMul(yieldBoostMultiplier);

        expect(
          await yieldBoostStorageUSDC.getStakerStakedAmount(
            goldenBanker.address
          )
        ).to.equal(expectedStakedAmount);
      });

      it("Should NOT unlock MELD Banker NFT if Golden Banker liquidates partial balance of yield boost token", async function () {
        const {
          lendingPool,
          meldProtocolDataProvider,
          lendingRateOracleAggregator,
          meldPriceOracle,
          addressesProvider,
          meld,
          usdc,
          dai,
          owner,
          liquidator,
          treasury,
          oracleAdmin,
          rewardsSetter,
          goldenBanker,
          goldenBankerTokenId,
          borrowAmountGoldenBankerUSDC,
          yieldBoostStakingUSDC,
          yieldBoostStorageUSDC,
        } = await loadFixture(setUpMeldBankersBorrowFixture);

        // Non-yield boost token (MELD)is collateral token
        // Yield boost token (USDC) is debt token

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
          "500"
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

        // Allocate DAI to liquidator so can repay later
        await allocateAndApproveTokens(
          dai,
          owner,
          liquidator,
          lendingPool,
          1000n * 2n, // 2x the amount borrowed
          0n
        );

        // Instantiate collateral reserve token contracts
        const meldReserveTokenAddresses =
          await meldProtocolDataProvider.getReserveTokensAddresses(
            await meld.getAddress()
          );

        const mMELD = await ethers.getContractAt(
          "MToken",
          meldReserveTokenAddresses.mTokenAddress
        );

        // Instantiate debt reserve token contracts
        const usdcReserveTokenAddresses =
          await meldProtocolDataProvider.getReserveTokensAddresses(
            await usdc.getAddress()
          );

        const mUSDC = await ethers.getContractAt(
          "MToken",
          usdcReserveTokenAddresses.mTokenAddress
        );

        const stableDebtToken = await ethers.getContractAt(
          "StableDebtToken",
          usdcReserveTokenAddresses.stableDebtTokenAddress
        );

        const variableDebtToken = await ethers.getContractAt(
          "VariableDebtToken",
          usdcReserveTokenAddresses.variableDebtTokenAddress
        );

        // Make sure liquidator has funds with which to liquidate
        const debtToCover = await allocateAndApproveTokens(
          usdc,
          owner,
          liquidator,
          lendingPool,
          200n, // principal debt
          0n
        );

        // Simulate price of collateral (MELD) going down drastically so that position is liquidatable
        await simulateAssetPriceCrash(meld, meldPriceOracle, 2n, oracleAdmin);

        // Get USDC reserve data before liquidation
        const usdcReserveDataBeforeLiquidation: ReserveData =
          await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

        // Liquidator liquidates partial debt
        const liquidationTx = await lendingPool
          .connect(liquidator)
          .liquidationCall(
            await meld.getAddress(), // collateral asset
            await usdc.getAddress(), // debt asset
            goldenBanker.address,
            debtToCover,
            false // receive mToken
          );

        const blockTimestamps: BlockTimestamps =
          await getBlockTimestamps(liquidationTx);

        // Get USDC reserve data after liquidation
        const usdcReserveDataAfterLiquidation: ReserveData =
          await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

        // Get MELD reserve data after liquidation
        const meldReserveDataAfterLiquidation: ReserveData =
          await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

        // Get borrower USDC reserve data after liquidation
        const borrowerUSDCDataAfterLiquidation: UserReserveData =
          await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await usdc.getAddress(),
            goldenBanker.address
          );

        // Check that the correct events were emitted //
        await expect(liquidationTx)
          .to.emit(variableDebtToken, "Transfer")
          .withArgs(goldenBanker.address, ZeroAddress, debtToCover);

        await expect(liquidationTx)
          .to.emit(variableDebtToken, "Burn")
          .withArgs(
            goldenBanker.address,
            debtToCover,
            usdcReserveDataAfterLiquidation.variableBorrowIndex
          );

        await expect(liquidationTx).to.not.emit(stableDebtToken, "Transfer"); // not liquidating stable debt
        await expect(liquidationTx).to.not.emit(stableDebtToken, "Burn"); // not liquidating stable debt
        await expect(liquidationTx).to.not.emit(stableDebtToken, "Mint"); // not liquidating stable debt

        // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
        const contractInstanceWithLibraryABI = await ethers.getContractAt(
          "ReserveLogic",
          await lendingPool.getAddress(),
          owner
        );

        // The important thing here is checking that the event is emitted for the debt token. The values are checked in other test files.
        await expect(liquidationTx)
          .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
          .withArgs(
            await usdc.getAddress(),
            anyUint,
            anyUint,
            anyUint,
            anyUint,
            anyUint
          );

        // Mint to treasury because debt token (USDC) has reserveFactor > 0
        const currentVariableDebt =
          usdcReserveDataBeforeLiquidation.totalVariableDebt; // accrued
        const previousVariableDebt =
          usdcReserveDataBeforeLiquidation.scaledVariableDebt; // principal
        const currentStableDebt = BigInt(0); // no stable debt
        const previousStableDebt = BigInt(0); // no stable debt

        const totalDebtAccrued =
          currentVariableDebt +
          currentStableDebt -
          previousVariableDebt -
          previousStableDebt;

        const { reserveFactor } =
          await meldProtocolDataProvider.getReserveConfigurationData(
            await usdc.getAddress()
          );
        const amountToMint = totalDebtAccrued.percentMul(BigInt(reserveFactor));

        await expect(liquidationTx)
          .to.emit(mUSDC, "Transfer")
          .withArgs(ZeroAddress, treasury.address, isAlmostEqual(amountToMint));

        await expect(liquidationTx)
          .to.emit(mUSDC, "Mint")
          .withArgs(
            treasury.address,
            isAlmostEqual(amountToMint),
            usdcReserveDataAfterLiquidation.liquidityIndex
          );

        const { liquidationMultiplier, actualLiquidationProtocolFee } =
          await calcLiquidationMultiplierParams(
            meld,
            lendingPool,
            meldProtocolDataProvider
          );

        const maxLiquidatableCollateral = await calcMaxLiquidatableCollateral(
          meld,
          usdc,
          meldPriceOracle,
          liquidationMultiplier,
          debtToCover
        );

        const liquidationProtocolFeeAmount =
          actualLiquidationProtocolFee.percentMul(maxLiquidatableCollateral);

        const liquidatorAmount =
          maxLiquidatableCollateral - liquidationProtocolFeeAmount;

        // Events emitted when collateral mToken is burned, which sends underlying asset to liquidator
        const liquidityIndex = calcExpectedReserveNormalizedIncome(
          meldReserveDataAfterLiquidation,
          blockTimestamps.txTimestamp
        );

        await expect(liquidationTx)
          .to.emit(mMELD, "Transfer")
          .withArgs(
            goldenBanker.address,
            ZeroAddress,
            liquidationProtocolFeeAmount
          );

        await expect(liquidationTx)
          .to.emit(mMELD, "Transfer")
          .withArgs(goldenBanker.address, ZeroAddress, liquidatorAmount);

        await expect(liquidationTx)
          .to.emit(meld, "Transfer")
          .withArgs(
            await mMELD.getAddress(),
            treasury.address,
            liquidationProtocolFeeAmount
          );

        await expect(liquidationTx)
          .to.emit(meld, "Transfer")
          .withArgs(
            await mMELD.getAddress(),
            liquidator.address,
            liquidatorAmount
          );

        await expect(liquidationTx)
          .to.emit(mMELD, "Burn")
          .withArgs(
            goldenBanker.address,
            treasury.address,
            liquidationProtocolFeeAmount,
            liquidityIndex
          );

        await expect(liquidationTx)
          .to.emit(mMELD, "Burn")
          .withArgs(
            goldenBanker.address,
            liquidator.address,
            liquidatorAmount,
            liquidityIndex
          );

        await expect(liquidationTx).to.not.emit(mMELD, "BalanceTransfer"); // liquidator elected to not receive mTokens

        // Event emitted when debt token is transferred from liquidator to pay off debt
        await expect(liquidationTx)
          .to.emit(usdc, "Transfer")
          .withArgs(liquidator.address, await mUSDC.getAddress(), debtToCover);

        // ReserveUsedAsCollateralDisabled and  ReserveUsedAsCollateralEnabled Events are defined in library LiquidationLogic.sol,
        // so we need to get the contract instance with the LiquidationLogic ABI
        const contractInstanceWithLogicLibraryABI = await ethers.getContractAt(
          "LiquidationLogic",
          await lendingPool.getAddress(),
          owner
        );

        // Event not emitted because liquidator elected not to receive mTokens
        await expect(liquidationTx).to.not.emit(
          contractInstanceWithLogicLibraryABI,
          "ReserveUsedAsCollateralEnabled"
        );

        // borrower's balance of collateral mTokens did not go to 0
        await expect(liquidationTx).to.not.emit(
          contractInstanceWithLogicLibraryABI,
          "ReserveUsedAsCollateralDisabled"
        );

        // liquidator liquidated partial debt
        await expect(liquidationTx)
          .to.emit(contractInstanceWithLogicLibraryABI, "LiquidationCall")
          .withArgs(
            await meld.getAddress(),
            await usdc.getAddress(),
            goldenBanker.address,
            debtToCover,
            maxLiquidatableCollateral,
            liquidator.address,
            false
          );

        // MELD Banker
        const meldBankerData = await lendingPool.userMeldBankerData(
          goldenBanker.address
        );

        const yieldBoostMultiplier = await lendingPool.yieldBoostMultipliers(
          meldBankerData.meldBankerType,
          meldBankerData.action
        );

        const expectedOldStakedAmount =
          borrowAmountGoldenBankerUSDC.percentMul(yieldBoostMultiplier);

        // Interest has accrued, so can't use the borrowed amount
        const expectedNewStakedAmount =
          borrowerUSDCDataAfterLiquidation.currentVariableDebt.percentMul(
            yieldBoostMultiplier
          );

        // USDC is the yield boost token that the MELD Banker borrowed when locking the NFT
        await expect(liquidationTx)
          .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
          .withArgs(
            goldenBanker.address,
            expectedOldStakedAmount,
            expectedNewStakedAmount
          );

        await expect(liquidationTx).to.not.emit(
          yieldBoostStakingUSDC,
          "StakePositionRemoved"
        );

        await expect(liquidationTx).to.not.emit(
          yieldBoostStakingUSDC,
          "RewardsClaimed"
        );

        await expect(liquidationTx)
          .to.emit(lendingPool, "RefreshYieldBoostAmount")
          .withArgs(
            await usdc.getAddress(),
            goldenBanker.address,
            expectedNewStakedAmount
          );

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

        // Liquidator gets MELD transferred, which is not a yield boost token
        await expect(liquidationTx).to.not.emit(
          yieldBoostStakingUSDC,
          "StakePositionCreated"
        );

        //Can't check that StakePositionUpdated is not emitted because it is emitted in the same tx for the meldBanker
        //Can't check that RefreshYieldBoostAmount is not emitted because it is emitted in the same tx for the meldBanker

        await expect(liquidationTx).to.not.emit(
          lendingPool,
          "UnlockMeldBankerNFT"
        );

        const liquidaterMeldBankerData = await lendingPool.userMeldBankerData(
          liquidator.address
        );

        expect(await lendingPool.isUsingMeldBanker(liquidator.address)).to.be
          .false;

        expect(await lendingPool.isMeldBankerBlocked(0n)).to.be.false;

        expect(liquidaterMeldBankerData.tokenId).to.equal(0n);
        expect(liquidaterMeldBankerData.asset).to.equal(ZeroAddress);
        expect(liquidaterMeldBankerData.meldBankerType).to.equal(
          MeldBankerType.NONE
        );
        expect(liquidaterMeldBankerData.action).to.equal(Action.NONE);

        expect(
          await yieldBoostStorageUSDC.getStakerStakedAmount(liquidator.address)
        ).to.equal(0n);

        // Treasury is a regular user. Treasury gets mMELD transferred, which is not a yield boost token
        const treasuryMeldBankerData = await lendingPool.userMeldBankerData(
          treasury.address
        );

        expect(treasuryMeldBankerData.tokenId).to.equal(0n);
        expect(treasuryMeldBankerData.asset).to.equal(ZeroAddress);
        expect(treasuryMeldBankerData.meldBankerType).to.equal(
          MeldBankerType.NONE
        );
        expect(treasuryMeldBankerData.action).to.equal(Action.NONE);

        expect(
          await yieldBoostStorageUSDC.getStakerStakedAmount(treasury.address)
        ).to.equal(0n);
      });

      it("Should calculate correct stake amounts if liquidator receives collateral mToken that is a yield boost token", async function () {
        const {
          lendingPool,
          meldProtocolDataProvider,
          lendingRateOracleAggregator,
          meldPriceOracle,
          addressesProvider,
          meld,
          dai,
          usdc,
          owner,
          liquidator,
          treasury,
          oracleAdmin,
          rewardsSetter,
          goldenBanker,
          goldenBankerTokenId,
          borrowAmountGoldenBankerUSDC,
          yieldBoostStakingUSDC,
          yieldBoostStorageUSDC,
          yieldBoostStakingDAI,
          yieldBoostStorageDAI,
        } = await loadFixture(setUpMeldBankersBorrowWithDAICollateralFixture);

        // Non-yield boost token (MELD)is collateral token
        // Yield boost token (USDC) is debt token

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

        // Instantiate collateral reserve token contracts
        const daiReserveTokenAddresses =
          await meldProtocolDataProvider.getReserveTokensAddresses(
            await dai.getAddress()
          );

        const mDAI = await ethers.getContractAt(
          "MToken",
          daiReserveTokenAddresses.mTokenAddress
        );

        // Instantiate debt reserve token contracts
        const usdcReserveTokenAddresses =
          await meldProtocolDataProvider.getReserveTokensAddresses(
            await usdc.getAddress()
          );

        const mUSDC = await ethers.getContractAt(
          "MToken",
          usdcReserveTokenAddresses.mTokenAddress
        );

        const stableDebtToken = await ethers.getContractAt(
          "StableDebtToken",
          usdcReserveTokenAddresses.stableDebtTokenAddress
        );

        const variableDebtToken = await ethers.getContractAt(
          "VariableDebtToken",
          usdcReserveTokenAddresses.variableDebtTokenAddress
        );

        // Make sure liquidator has funds with which to liquidate
        await allocateAndApproveTokens(
          usdc,
          owner,
          liquidator,
          lendingPool,
          10_000n,
          2n
        );

        const [currentPrice, success] = await meldPriceOracle.getAssetPrice(
          await dai.getAddress()
        );

        expect(success).to.be.true;

        // Simulate price of collateral (DAI) going down drastically so that position is liquidatable
        // In reality, DAI is not likely to so drastically go down in value, but this is the easist way to
        // get the health factor < 1
        const newPrice = (10n * currentPrice) / 12n; // price goes down by 1.2 times (currentPrice/1.2). workaround because can't use decimals with bigint
        await meldPriceOracle
          .connect(oracleAdmin)
          .setAssetPrice(await dai.getAddress(), newPrice);

        // Get borrower USDC reserve data before liquidation
        const borrowerUSDCDataBeforeLiquidation: UserReserveData =
          await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await usdc.getAddress(),
            goldenBanker.address
          );

        const liquidatorMTokenBalanceBeforeLiquidation = await mDAI.balanceOf(
          liquidator.address
        );

        const meldBankerDataBefore = await lendingPool.userMeldBankerData(
          goldenBanker.address
        );

        const yieldBoostMultiplier = await lendingPool.yieldBoostMultipliers(
          meldBankerDataBefore.meldBankerType,
          meldBankerDataBefore.action
        );

        // Get USDC reserve data before liquidation
        const usdcReserveDataBeforeLiquidation: ReserveData =
          await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

        // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
        time.setNextBlockTimestamp(await time.latest());

        // Liquidator liquidates all liquidatable debt (up to close factor)
        const liquidationTx = await lendingPool
          .connect(liquidator)
          .liquidationCall(
            await dai.getAddress(), // collateral asset
            await usdc.getAddress(), // debt asset
            goldenBanker.address,
            MaxUint256, // flag for all liquidatable debt
            true // receive mToken
          );

        const blockTimestamps: BlockTimestamps =
          await getBlockTimestamps(liquidationTx);

        // Get USDC reserve data after liquidation
        const usdcReserveDataAfterLiquidation: ReserveData =
          await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

        // Get MELD reserve data after liquidation
        const meldReserveDataAfterLiquidation: ReserveData =
          await getReserveData(
            meldProtocolDataProvider,
            await dai.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

        const maxLiquidatableDebt = (
          borrowerUSDCDataBeforeLiquidation.currentStableDebt +
          borrowerUSDCDataBeforeLiquidation.currentVariableDebt
        ).percentMul(LIQUIDATION_CLOSE_FACTOR_PERCENT);

        // Check that the correct events were emitted //

        await expect(liquidationTx)
          .to.emit(variableDebtToken, "Transfer")
          .withArgs(goldenBanker.address, ZeroAddress, maxLiquidatableDebt);

        await expect(liquidationTx)
          .to.emit(variableDebtToken, "Burn")
          .withArgs(
            goldenBanker.address,
            maxLiquidatableDebt,
            usdcReserveDataAfterLiquidation.variableBorrowIndex
          );

        await expect(liquidationTx).to.not.emit(stableDebtToken, "Transfer"); // not liquidating stable debt
        await expect(liquidationTx).to.not.emit(stableDebtToken, "Burn"); // not liquidating stable debt
        await expect(liquidationTx).to.not.emit(stableDebtToken, "Mint"); // not liquidating stable debt

        // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
        const contractInstanceWithLibraryABI = await ethers.getContractAt(
          "ReserveLogic",
          await lendingPool.getAddress(),
          owner
        );

        // The important thing here is checking that the event is emitted for the debt token. The values are checked in other test files.
        await expect(liquidationTx)
          .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
          .withArgs(
            await usdc.getAddress(),
            anyUint,
            anyUint,
            anyUint,
            anyUint,
            anyUint
          );

        // Mint to treasury because debt token (USDC) has reserveFactor > 0
        const currentVariableDebt =
          usdcReserveDataBeforeLiquidation.totalVariableDebt;
        const previousVariableDebt =
          usdcReserveDataBeforeLiquidation.scaledVariableDebt;
        const currentStableDebt =
          usdcReserveDataBeforeLiquidation.totalStableDebt;
        const previousStableDebt =
          usdcReserveDataBeforeLiquidation.principalStableDebt;

        const totalDebtAccrued =
          currentVariableDebt +
          currentStableDebt -
          previousVariableDebt -
          previousStableDebt;

        const { reserveFactor } =
          await meldProtocolDataProvider.getReserveConfigurationData(
            await usdc.getAddress()
          );
        const amountToMint = totalDebtAccrued.percentMul(BigInt(reserveFactor));

        await expect(liquidationTx)
          .to.emit(mUSDC, "Transfer")
          .withArgs(ZeroAddress, treasury.address, isAlmostEqual(amountToMint));

        await expect(liquidationTx)
          .to.emit(mUSDC, "Mint")
          .withArgs(
            treasury.address,
            isAlmostEqual(amountToMint),
            usdcReserveDataAfterLiquidation.liquidityIndex
          );

        const { liquidationMultiplier, actualLiquidationProtocolFee } =
          await calcLiquidationMultiplierParams(
            dai,
            lendingPool,
            meldProtocolDataProvider
          );

        const maxLiquidatableCollateral = await calcMaxLiquidatableCollateral(
          dai,
          usdc,
          meldPriceOracle,
          liquidationMultiplier,
          maxLiquidatableDebt
        );

        const liquidationProtocolFeeAmount =
          actualLiquidationProtocolFee.percentMul(maxLiquidatableCollateral);

        const liquidatorAmount =
          maxLiquidatableCollateral - liquidationProtocolFeeAmount;

        // Events emitted when liquidator receives collateral mToken
        const liquidityIndex = calcExpectedReserveNormalizedIncome(
          meldReserveDataAfterLiquidation,
          blockTimestamps.txTimestamp
        );

        await expect(liquidationTx)
          .to.emit(mDAI, "BalanceTransfer")
          .withArgs(
            goldenBanker.address,
            treasury.address,
            liquidationProtocolFeeAmount,
            liquidityIndex
          );

        await expect(liquidationTx)
          .to.emit(mDAI, "BalanceTransfer")
          .withArgs(
            goldenBanker.address,
            liquidator.address,
            liquidatorAmount,
            liquidityIndex
          );

        await expect(liquidationTx)
          .to.emit(mDAI, "Transfer")
          .withArgs(
            goldenBanker.address,
            treasury.address,
            liquidationProtocolFeeAmount
          );

        await expect(liquidationTx)
          .to.emit(mDAI, "Transfer")
          .withArgs(goldenBanker.address, liquidator.address, liquidatorAmount);

        // liquidator chose mTokens instead of underlying collateral asset
        expect(await mDAI.balanceOf(liquidator.address)).to.be.greaterThan(
          liquidatorMTokenBalanceBeforeLiquidation
        );

        // Event emitted when debt token is transferred from liquidator to pay off debt
        await expect(liquidationTx)
          .to.emit(usdc, "Transfer")
          .withArgs(
            liquidator.address,
            await mUSDC.getAddress(),
            maxLiquidatableDebt
          );

        // ReserveUsedAsCollateralDisabled and  ReserveUsedAsCollateralEnabled Events are defined in library LiquidationLogic.sol,
        //so we need to get the contract instance with the LiquidationLogic ABI
        const contractInstanceWithLogicLibraryABI = await ethers.getContractAt(
          "LiquidationLogic",
          await lendingPool.getAddress(),
          owner
        );

        await expect(liquidationTx).to.not.emit(
          contractInstanceWithLogicLibraryABI,
          "ReserveUsedAsCollateralDisabled"
        ); // borrower's balance of collateral mTokens did not go to 0
        await expect(liquidationTx).to.emit(
          contractInstanceWithLogicLibraryABI,
          "ReserveUsedAsCollateralEnabled"
        ); // liquidator did not have balance of collateral mTokens

        await expect(liquidationTx)
          .to.emit(contractInstanceWithLogicLibraryABI, "LiquidationCall")
          .withArgs(
            await dai.getAddress(),
            await usdc.getAddress(),
            goldenBanker.address,
            maxLiquidatableDebt,
            maxLiquidatableCollateral,
            liquidator.address,
            true
          );

        // MELD Banker
        const expectedOldMeldBankerStakedAmount =
          borrowAmountGoldenBankerUSDC.percentMul(yieldBoostMultiplier);

        await expect(liquidationTx)
          .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
          .withArgs(
            goldenBanker.address,
            expectedOldMeldBankerStakedAmount,
            0n
          );

        await expect(liquidationTx)
          .to.emit(yieldBoostStakingUSDC, "StakePositionRemoved")
          .withArgs(goldenBanker.address, expectedOldMeldBankerStakedAmount);

        await expect(liquidationTx)
          .to.emit(yieldBoostStakingUSDC, "RewardsClaimed")
          .withArgs(
            goldenBanker.address,
            goldenBanker.address,
            anyUint,
            anyUint
          );

        await expect(liquidationTx)
          .to.emit(lendingPool, "RefreshYieldBoostAmount")
          .withArgs(await usdc.getAddress(), goldenBanker.address, 0n);

        await expect(liquidationTx)
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

        // Liquidator gets mDAI transferred, which is  a yield boost token
        // Liquidator gets treated like a regular user because there is no actual deposit with a MELD Banker NFT tokenId
        const liquidaterMeldBankerData = await lendingPool.userMeldBankerData(
          liquidator.address
        );

        // Liquidator and treasury are regular users and gets mTokens, which is the same as doing a deposit
        const yieldBoostMultiplierRegularUserDeposit =
          await lendingPool.yieldBoostMultipliers(
            MeldBankerType.NONE,
            Action.DEPOSIT
          );

        const expectedLiquidatorStakedAmount = (
          liquidatorMTokenBalanceBeforeLiquidation +
          maxLiquidatableCollateral -
          liquidationProtocolFeeAmount
        ).percentMul(yieldBoostMultiplierRegularUserDeposit);

        await expect(liquidationTx)
          .to.emit(yieldBoostStakingDAI, "StakePositionCreated")
          .withArgs(liquidator.address, expectedLiquidatorStakedAmount);

        await expect(liquidationTx)
          .to.emit(yieldBoostStakingDAI, "StakePositionUpdated")
          .withArgs(liquidator.address, 0n, expectedLiquidatorStakedAmount);

        await expect(liquidationTx)
          .to.emit(lendingPool, "RefreshYieldBoostAmount")
          .withArgs(
            await dai.getAddress(),
            liquidator.address,
            expectedLiquidatorStakedAmount
          );

        expect(liquidaterMeldBankerData.tokenId).to.equal(0n);
        expect(liquidaterMeldBankerData.asset).to.equal(ZeroAddress);
        expect(liquidaterMeldBankerData.meldBankerType).to.equal(
          MeldBankerType.NONE
        );
        expect(liquidaterMeldBankerData.action).to.equal(Action.NONE);

        expect(
          await yieldBoostStorageDAI.getStakerStakedAmount(liquidator.address)
        ).to.equal(expectedLiquidatorStakedAmount);

        expect(
          await yieldBoostStorageUSDC.getStakerStakedAmount(liquidator.address)
        ).to.equal(0n);

        // Treasury
        const expectedTreasuryStakedAmount =
          liquidationProtocolFeeAmount.percentMul(
            yieldBoostMultiplierRegularUserDeposit
          );

        await expect(liquidationTx)
          .to.emit(yieldBoostStakingDAI, "StakePositionCreated")
          .withArgs(treasury.address, expectedTreasuryStakedAmount);

        await expect(liquidationTx)
          .to.emit(yieldBoostStakingDAI, "StakePositionUpdated")
          .withArgs(treasury.address, 0n, expectedTreasuryStakedAmount);

        await expect(liquidationTx)
          .to.emit(lendingPool, "RefreshYieldBoostAmount")
          .withArgs(
            await dai.getAddress(),
            treasury.address,
            expectedTreasuryStakedAmount
          );

        const treasuryMeldBankerData = await lendingPool.userMeldBankerData(
          treasury.address
        );

        expect(treasuryMeldBankerData.tokenId).to.equal(0n);
        expect(treasuryMeldBankerData.asset).to.equal(ZeroAddress);
        expect(treasuryMeldBankerData.meldBankerType).to.equal(
          MeldBankerType.NONE
        );
        expect(treasuryMeldBankerData.action).to.equal(Action.NONE);

        expect(
          await yieldBoostStorageDAI.getStakerStakedAmount(treasury.address)
        ).to.equal(expectedTreasuryStakedAmount);

        expect(
          await yieldBoostStorageUSDC.getStakerStakedAmount(treasury.address)
        ).to.equal(0n);
      });

      it("Should calculate correct stake amounts if liquidator is also Golden Banker and already used Golden Banker NFT to deposit same collateral asset", async function () {
        const {
          lendingPool,
          meldProtocolDataProvider,
          lendingRateOracleAggregator,
          meldPriceOracle,
          meldBankerNft,
          addressesProvider,
          meld,
          dai,
          usdc,
          owner,
          liquidator,
          treasury,
          oracleAdmin,
          bankerAdmin,
          rewardsSetter,
          goldenBanker,
          goldenBankerTokenId,
          borrowAmountGoldenBankerUSDC,
          yieldBoostStakingUSDC,
          yieldBoostStorageUSDC,
          yieldBoostStakingDAI,
          yieldBoostStorageDAI,
        } = await loadFixture(setUpMeldBankersBorrowWithDAICollateralFixture);

        // Both collateral and debt tokens are yield boost tokens.
        // Meld Banker deposited DAI collateral without using NFT tokenId and borrowed USDC using NFT tokenId
        // Liquidator is also a MELD Banker and uses an NFT tokenId to deposit DAI collateral

        // Set Yield Boost Staking Rewards for USDC
        await setRewards(
          yieldBoostStorageUSDC,
          yieldBoostStakingUSDC,
          addressesProvider,
          rewardsSetter,
          owner,
          usdc,
          meld
        );

        // Set Yield Boost Staking Rewards for DAI
        // Can't call setRewards function again because it has already advanced the time to a new epoch
        await allocateAndApproveTokens(
          dai,
          owner,
          rewardsSetter,
          yieldBoostStakingDAI,
          100_000n,
          1n
        );
        await allocateAndApproveTokens(
          meld,
          owner,
          rewardsSetter,
          yieldBoostStakingDAI,
          100_000n,
          1n
        );

        const rewards = {
          assetRewards: await convertToCurrencyDecimals(
            await dai.getAddress(),
            "100"
          ),
          meldRewards: await convertToCurrencyDecimals(
            await meld.getAddress(),
            "3000"
          ),
        };

        const currentEpoch = await yieldBoostStorageDAI.getCurrentEpoch();
        const rewardsEpoch = currentEpoch - 1n;

        await yieldBoostStakingDAI
          .connect(rewardsSetter)
          .setRewards(rewards, rewardsEpoch);

        // Golden Banker deposited DAI collateral without using NFT tokenId and borrowed USDC using NFT tokenId
        // Liquidator is also a MELD Banker and an NFT tokenId to deposit DAI collateral

        // First mint NFT to liquidator
        const liquidatorTokenId = 3n;
        const golden = true;
        await meldBankerNft
          .connect(bankerAdmin)
          .mint(liquidator, liquidatorTokenId, golden);

        // liquidator deposits DAI with NFT
        const depositAmountDAILiquidator = await allocateAndApproveTokens(
          dai,
          owner,
          liquidator,
          lendingPool,
          1000n,
          0n
        );

        await lendingPool
          .connect(liquidator)
          .deposit(
            await dai.getAddress(),
            depositAmountDAILiquidator,
            liquidator.address,
            true,
            liquidatorTokenId
          );

        // Instantiate collateral reserve token contracts
        const daiReserveTokenAddresses =
          await meldProtocolDataProvider.getReserveTokensAddresses(
            await dai.getAddress()
          );

        const mDAI = await ethers.getContractAt(
          "MToken",
          daiReserveTokenAddresses.mTokenAddress
        );

        // Instantiate debt reserve token contracts
        const usdcReserveTokenAddresses =
          await meldProtocolDataProvider.getReserveTokensAddresses(
            await usdc.getAddress()
          );

        const mUSDC = await ethers.getContractAt(
          "MToken",
          usdcReserveTokenAddresses.mTokenAddress
        );

        const stableDebtToken = await ethers.getContractAt(
          "StableDebtToken",
          usdcReserveTokenAddresses.stableDebtTokenAddress
        );

        const variableDebtToken = await ethers.getContractAt(
          "VariableDebtToken",
          usdcReserveTokenAddresses.variableDebtTokenAddress
        );

        // Make sure liquidator has funds with which to liquidate
        await allocateAndApproveTokens(
          usdc,
          owner,
          liquidator,
          lendingPool,
          10_000n,
          2n
        );

        const [currentPrice, success] = await meldPriceOracle.getAssetPrice(
          await dai.getAddress()
        );

        expect(success).to.be.true;

        // Simulate price of collateral (DAI) going down drastically so that position is liquidatable
        // In reality, DAI is not likely to so drastically go down in value, but this is the easist way to
        // get the health factor < 1
        const newPrice = (10n * currentPrice) / 12n; // price goes down by 1.2 times (currentPrice/1.2). workaround because can't use decimals with bigint
        await meldPriceOracle
          .connect(oracleAdmin)
          .setAssetPrice(await dai.getAddress(), newPrice);

        // Get borrower USDC reserve data before liquidation
        const borrowerUSDCDataBeforeLiquidation: UserReserveData =
          await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await usdc.getAddress(),
            goldenBanker.address
          );

        const liquidatorMTokenBalanceBeforeLiquidation = await mDAI.balanceOf(
          liquidator.address
        );

        const meldBankerDataBefore = await lendingPool.userMeldBankerData(
          goldenBanker.address
        );

        const yieldBoostMultiplier = await lendingPool.yieldBoostMultipliers(
          meldBankerDataBefore.meldBankerType,
          meldBankerDataBefore.action
        );

        // Get USDC reserve data before liquidation
        const usdcReserveDataBeforeLiquidation: ReserveData =
          await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

        // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
        time.setNextBlockTimestamp(await time.latest());

        // Liquidator liquidates all liquidatable debt (up to close factor)
        const liquidationTx = await lendingPool
          .connect(liquidator)
          .liquidationCall(
            await dai.getAddress(), // collateral asset
            await usdc.getAddress(), // debt asset
            goldenBanker.address,
            MaxUint256, // flag for all liquidatable debt
            true // receive mToken
          );

        const blockTimestamps: BlockTimestamps =
          await getBlockTimestamps(liquidationTx);

        // Get USDC reserve data after liquidation
        const usdcReserveDataAfterLiquidation: ReserveData =
          await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

        // Get MELD reserve data after liquidation
        const meldReserveDataAfterLiquidation: ReserveData =
          await getReserveData(
            meldProtocolDataProvider,
            await dai.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

        const maxLiquidatableDebt = (
          borrowerUSDCDataBeforeLiquidation.currentStableDebt +
          borrowerUSDCDataBeforeLiquidation.currentVariableDebt
        ).percentMul(LIQUIDATION_CLOSE_FACTOR_PERCENT);

        // Check that the correct events were emitted //

        await expect(liquidationTx)
          .to.emit(variableDebtToken, "Transfer")
          .withArgs(goldenBanker.address, ZeroAddress, maxLiquidatableDebt);

        await expect(liquidationTx)
          .to.emit(variableDebtToken, "Burn")
          .withArgs(
            goldenBanker.address,
            maxLiquidatableDebt,
            usdcReserveDataAfterLiquidation.variableBorrowIndex
          );

        await expect(liquidationTx).to.not.emit(stableDebtToken, "Transfer"); // not liquidating stable debt
        await expect(liquidationTx).to.not.emit(stableDebtToken, "Burn"); // not liquidating stable debt
        await expect(liquidationTx).to.not.emit(stableDebtToken, "Mint"); // not liquidating stable debt

        // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
        const contractInstanceWithLibraryABI = await ethers.getContractAt(
          "ReserveLogic",
          await lendingPool.getAddress(),
          owner
        );

        // The important thing here is checking that the event is emitted for the debt token. The values are checked in other test files.
        await expect(liquidationTx)
          .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
          .withArgs(
            await usdc.getAddress(),
            anyUint,
            anyUint,
            anyUint,
            anyUint,
            anyUint
          );

        // Mint to treasury because debt token (USDC) has reserveFactor > 0
        const currentVariableDebt =
          usdcReserveDataBeforeLiquidation.totalVariableDebt;
        const previousVariableDebt =
          usdcReserveDataBeforeLiquidation.scaledVariableDebt;
        const currentStableDebt =
          usdcReserveDataBeforeLiquidation.totalStableDebt;
        const previousStableDebt =
          usdcReserveDataBeforeLiquidation.principalStableDebt;

        const totalDebtAccrued =
          currentVariableDebt +
          currentStableDebt -
          previousVariableDebt -
          previousStableDebt;

        const { reserveFactor } =
          await meldProtocolDataProvider.getReserveConfigurationData(
            await usdc.getAddress()
          );
        const amountToMint = totalDebtAccrued.percentMul(BigInt(reserveFactor));

        await expect(liquidationTx)
          .to.emit(mUSDC, "Transfer")
          .withArgs(ZeroAddress, treasury.address, isAlmostEqual(amountToMint));

        await expect(liquidationTx)
          .to.emit(mUSDC, "Mint")
          .withArgs(
            treasury.address,
            isAlmostEqual(amountToMint),
            usdcReserveDataAfterLiquidation.liquidityIndex
          );

        const { liquidationMultiplier, actualLiquidationProtocolFee } =
          await calcLiquidationMultiplierParams(
            dai,
            lendingPool,
            meldProtocolDataProvider
          );

        const maxLiquidatableCollateral = await calcMaxLiquidatableCollateral(
          dai,
          usdc,
          meldPriceOracle,
          liquidationMultiplier,
          maxLiquidatableDebt
        );

        const liquidationProtocolFeeAmount =
          actualLiquidationProtocolFee.percentMul(maxLiquidatableCollateral);

        const liquidatorAmount =
          maxLiquidatableCollateral - liquidationProtocolFeeAmount;

        // Events emitted when liquidator receives collateral mToken
        const liquidityIndex = calcExpectedReserveNormalizedIncome(
          meldReserveDataAfterLiquidation,
          blockTimestamps.txTimestamp
        );

        await expect(liquidationTx)
          .to.emit(mDAI, "BalanceTransfer")
          .withArgs(
            goldenBanker.address,
            treasury.address,
            liquidationProtocolFeeAmount,
            liquidityIndex
          );

        await expect(liquidationTx)
          .to.emit(mDAI, "BalanceTransfer")
          .withArgs(
            goldenBanker.address,
            liquidator.address,
            liquidatorAmount,
            liquidityIndex
          );

        await expect(liquidationTx)
          .to.emit(mDAI, "Transfer")
          .withArgs(
            goldenBanker.address,
            treasury.address,
            liquidationProtocolFeeAmount
          );

        await expect(liquidationTx)
          .to.emit(mDAI, "Transfer")
          .withArgs(goldenBanker.address, liquidator.address, liquidatorAmount);

        // liquidator chose mTokens instead of underlying collateral asset
        expect(await mDAI.balanceOf(liquidator.address)).to.be.greaterThan(
          liquidatorMTokenBalanceBeforeLiquidation
        );

        // Event emitted when debt token is transferred from liquidator to pay off debt
        await expect(liquidationTx)
          .to.emit(usdc, "Transfer")
          .withArgs(
            liquidator.address,
            await mUSDC.getAddress(),
            maxLiquidatableDebt
          );

        // ReserveUsedAsCollateralDisabled and  ReserveUsedAsCollateralEnabled Events are defined in library LiquidationLogic.sol,
        //so we need to get the contract instance with the LiquidationLogic ABI
        const contractInstanceWithLogicLibraryABI = await ethers.getContractAt(
          "LiquidationLogic",
          await lendingPool.getAddress(),
          owner
        );

        await expect(liquidationTx).to.not.emit(
          contractInstanceWithLogicLibraryABI,
          "ReserveUsedAsCollateralDisabled"
        ); // borrower's balance of collateral mTokens did not go to 0
        await expect(liquidationTx).to.not.emit(
          contractInstanceWithLogicLibraryABI,
          "ReserveUsedAsCollateralEnabled"
        ); // liquidator did not have balance of collateral mTokens

        await expect(liquidationTx)
          .to.emit(contractInstanceWithLogicLibraryABI, "LiquidationCall")
          .withArgs(
            await dai.getAddress(),
            await usdc.getAddress(),
            goldenBanker.address,
            maxLiquidatableDebt,
            maxLiquidatableCollateral,
            liquidator.address,
            true
          );

        // MELD Banker
        const expectedOldMeldBankerStakedAmount =
          borrowAmountGoldenBankerUSDC.percentMul(yieldBoostMultiplier);

        await expect(liquidationTx)
          .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
          .withArgs(
            goldenBanker.address,
            expectedOldMeldBankerStakedAmount,
            0n
          );

        await expect(liquidationTx)
          .to.emit(yieldBoostStakingUSDC, "StakePositionRemoved")
          .withArgs(goldenBanker.address, expectedOldMeldBankerStakedAmount);

        await expect(liquidationTx)
          .to.emit(yieldBoostStakingUSDC, "RewardsClaimed")
          .withArgs(
            goldenBanker.address,
            goldenBanker.address,
            anyUint,
            anyUint
          );

        await expect(liquidationTx)
          .to.emit(lendingPool, "RefreshYieldBoostAmount")
          .withArgs(await usdc.getAddress(), goldenBanker.address, 0n);

        await expect(liquidationTx)
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

        // Liquidator gets mDAI transferred, which is a yield boost token
        // Liquidator is a MELD banker
        const liquidaterMeldBankerData = await lendingPool.userMeldBankerData(
          liquidator.address
        );

        // Liquidator is a MELD Banker and gets mTokens, which is the same as doing a deposit
        const yieldBoostMultiplierLiquidator =
          await lendingPool.yieldBoostMultipliers(
            liquidaterMeldBankerData.meldBankerType,
            liquidaterMeldBankerData.action
          );

        const expectedLiquidatorOldStakedAmount =
          depositAmountDAILiquidator.percentMul(yieldBoostMultiplierLiquidator);
        const expectedLiquidatorNewStakedAmount = (
          liquidatorMTokenBalanceBeforeLiquidation +
          maxLiquidatableCollateral -
          liquidationProtocolFeeAmount
        ).percentMul(yieldBoostMultiplierLiquidator);

        await expect(liquidationTx)
          .to.emit(yieldBoostStakingDAI, "StakePositionUpdated")
          .withArgs(
            liquidator.address,
            expectedLiquidatorOldStakedAmount,
            expectedLiquidatorNewStakedAmount
          );

        await expect(liquidationTx)
          .to.emit(lendingPool, "RefreshYieldBoostAmount")
          .withArgs(
            await dai.getAddress(),
            liquidator.address,
            expectedLiquidatorNewStakedAmount
          );

        expect(liquidaterMeldBankerData.tokenId).to.equal(liquidatorTokenId);
        expect(liquidaterMeldBankerData.asset).to.equal(await dai.getAddress());
        expect(liquidaterMeldBankerData.meldBankerType).to.equal(
          MeldBankerType.GOLDEN
        );
        expect(liquidaterMeldBankerData.action).to.equal(Action.DEPOSIT);

        expect(
          await yieldBoostStorageDAI.getStakerStakedAmount(liquidator.address)
        ).to.equal(expectedLiquidatorNewStakedAmount);

        expect(
          await yieldBoostStorageUSDC.getStakerStakedAmount(liquidator.address)
        ).to.equal(0n);

        // Treasury
        // Treasury gets mDAI transferred, which is a yield boost token
        const yieldBoostMultiplierRegularUserDeposit =
          await lendingPool.yieldBoostMultipliers(
            MeldBankerType.NONE,
            Action.DEPOSIT
          );

        const expectedTreasuryStakedAmount =
          liquidationProtocolFeeAmount.percentMul(
            yieldBoostMultiplierRegularUserDeposit
          );

        await expect(liquidationTx)
          .to.emit(yieldBoostStakingDAI, "StakePositionCreated")
          .withArgs(treasury.address, expectedTreasuryStakedAmount);

        await expect(liquidationTx)
          .to.emit(yieldBoostStakingDAI, "StakePositionUpdated")
          .withArgs(treasury.address, 0n, expectedTreasuryStakedAmount);

        await expect(liquidationTx)
          .to.emit(lendingPool, "RefreshYieldBoostAmount")
          .withArgs(
            await dai.getAddress(),
            treasury.address,
            expectedTreasuryStakedAmount
          );

        const treasuryMeldBankerData = await lendingPool.userMeldBankerData(
          treasury.address
        );

        expect(treasuryMeldBankerData.tokenId).to.equal(0n);
        expect(treasuryMeldBankerData.asset).to.equal(ZeroAddress);
        expect(treasuryMeldBankerData.meldBankerType).to.equal(
          MeldBankerType.NONE
        );
        expect(treasuryMeldBankerData.action).to.equal(Action.NONE);

        expect(
          await yieldBoostStorageDAI.getStakerStakedAmount(treasury.address)
        ).to.equal(expectedTreasuryStakedAmount);

        expect(
          await yieldBoostStorageUSDC.getStakerStakedAmount(treasury.address)
        ).to.equal(0n);
      });
    }); // End Golden Banker Context
  }); // End Happy Flow Test Cases Context

  context("Error Test Cases", async function () {
    context("Meld Banker NFT and Yield Boost", async function () {
      it("Should not unlock NFT if liquidation reverts", async function () {
        const {
          lendingPool,
          usdc,
          meld,
          liquidator,
          meldBanker,
          meldBankerTokenId,
        } = await loadFixture(setUpMeldBankersBorrowFixture);

        await expect(
          lendingPool.connect(liquidator).liquidationCall(
            await usdc.getAddress(), // collateral asset
            await meld.getAddress(), // debt asset
            meldBanker.address,
            0n,
            true // receive mToken
          )
        ).to.revertedWith(ProtocolErrors.VL_INVALID_AMOUNT);

        expect(await lendingPool.isUsingMeldBanker(meldBanker.address)).to.be
          .true;

        expect(await lendingPool.isMeldBankerBlocked(meldBankerTokenId)).to.be
          .true;
      });
    }); // End Meld Banker NFT and Yield Boost Context

    it("Should revert if debt asset is the zero address", async function () {
      const { lendingPool, usdc, borrower, liquidator } = await loadFixture(
        setUpSingleStableBorrowMELDFixture
      );

      await expect(
        lendingPool.connect(liquidator).liquidationCall(
          await usdc.getAddress(), // collateral asset
          ZeroAddress, // debt asset
          borrower.address,
          MaxUint256, // flag for all liquidatable debt
          true // receive mToken
        )
      ).to.revertedWith(ProtocolErrors.INVALID_ADDRESS);
    });

    it("Should revert if collateral asset is an unsupported token", async function () {
      const { lendingPool, meld, unsupportedToken, borrower, liquidator } =
        await loadFixture(setUpSingleStableBorrowMELDFixture);

      await expect(
        lendingPool.connect(liquidator).liquidationCall(
          await unsupportedToken.getAddress(), // collateral asset
          await meld.getAddress(), // debt asset
          borrower.address,
          MaxUint256, // flag for all liquidatable debt
          true // receive mToken
        )
      ).to.revertedWith(ProtocolErrors.VL_NO_ACTIVE_RESERVE);
    });

    it("Should revert if debt asset is an unsupported token", async function () {
      const { lendingPool, usdc, unsupportedToken, borrower, liquidator } =
        await loadFixture(setUpSingleStableBorrowMELDFixture);

      await expect(
        lendingPool.connect(liquidator).liquidationCall(
          await usdc.getAddress(), // collateral asset
          await unsupportedToken.getAddress(), // debt asset
          borrower.address,
          MaxUint256, // flag for all liquidatable debt
          true // receive mToken
        )
      ).to.revertedWith(ProtocolErrors.VL_NO_ACTIVE_RESERVE);
    });

    it("Should revert if user address is the zero address", async function () {
      const { lendingPool, usdc, meld, liquidator } = await loadFixture(
        setUpSingleStableBorrowMELDFixture
      );

      await expect(
        lendingPool.connect(liquidator).liquidationCall(
          await usdc.getAddress(), // collateral asset
          await meld.getAddress(), // debt asset
          ZeroAddress,
          MaxUint256, // flag for all liquidatable debt
          true // receive mToken
        )
      ).to.revertedWith(ProtocolErrors.INVALID_ADDRESS);
    });

    it("Should revert if debtToCover is 0", async function () {
      const { lendingPool, usdc, meld, borrower, liquidator } =
        await loadFixture(setUpSingleStableBorrowMELDFixture);

      await expect(
        lendingPool.connect(liquidator).liquidationCall(
          await usdc.getAddress(), // collateral asset
          await meld.getAddress(), // debt asset
          borrower.address,
          0n, // flag for all liquidatable debt
          true // receive mToken
        )
      ).to.revertedWith(ProtocolErrors.VL_INVALID_AMOUNT);
    });

    it("Should revert if collateral reserve is not active", async function () {
      const {
        lendingPool,
        lendingPoolConfigurator,
        meld,
        usdc,
        borrower,
        liquidator,
        poolAdmin,
      } = await loadFixture(setUpTestFixture);

      await expect(
        await lendingPoolConfigurator
          .connect(poolAdmin)
          .deactivateReserve(await usdc.getAddress())
      )
        .to.emit(lendingPoolConfigurator, "ReserveDeactivated")
        .withArgs(await usdc.getAddress());

      await expect(
        lendingPool.connect(liquidator).liquidationCall(
          await usdc.getAddress(), // collateral asset
          await meld.getAddress(), // debt asset
          borrower.address,
          MaxUint256, // flag for all liquidatable debt
          true // receive mToken
        )
      ).to.revertedWith(ProtocolErrors.VL_NO_ACTIVE_RESERVE);
    });

    it("Should revert if debt reserve is not active", async function () {
      const {
        lendingPool,
        lendingPoolConfigurator,
        meld,
        usdc,
        borrower,
        liquidator,
        poolAdmin,
      } = await loadFixture(setUpTestFixture);

      await expect(
        await lendingPoolConfigurator
          .connect(poolAdmin)
          .deactivateReserve(await meld.getAddress())
      )
        .to.emit(lendingPoolConfigurator, "ReserveDeactivated")
        .withArgs(await meld.getAddress());

      await expect(
        lendingPool.connect(liquidator).liquidationCall(
          await usdc.getAddress(), // collateral asset
          await meld.getAddress(), // debt asset
          borrower.address,
          MaxUint256, // flag for all liquidatable debt
          true // receive mToken
        )
      ).to.revertedWith(ProtocolErrors.VL_NO_ACTIVE_RESERVE);
    });

    it("Should revert if tries to liquidate a different asset than the loan principal", async function () {
      const {
        lendingPool,
        meldPriceOracle,
        usdc,
        borrower,
        liquidator,
        oracleAdmin,
      } = await loadFixture(setUpSingleStableBorrowMELDFixture);

      // Simulate price of collateral (USDC) going down drastically so that position is liquidatable
      // In reality, USDC is not likely to so drastically go down in value, but this is the easist way to
      // get the health factor < 1
      await simulateAssetPriceCrash(usdc, meldPriceOracle, 5n, oracleAdmin);

      await expect(
        lendingPool.connect(liquidator).liquidationCall(
          await usdc.getAddress(), // collateral asset
          await usdc.getAddress(), // collateral asset,  not debt asset
          borrower.address,
          MaxUint256, // flag for all liquidatable debt
          true // receive mToken
        )
      ).to.revertedWith(
        ProtocolErrors.LL_SPECIFIED_CURRENCY_NOT_BORROWED_BY_USER
      );
    });

    it("Should revert if collateral asset reserve is not enabled as collateral", async function () {
      const {
        lendingPool,
        meldPriceOracle,
        usdc,
        meld,
        tether,
        borrower,
        liquidator,
        oracleAdmin,
      } = await loadFixture(setUpSingleStableBorrowMELDFixture);

      // Simulate price of collateral (USDC) going down drastically so that position is liquidatable
      // In reality, USDC is not likely to so drastically go down in value, but this is the easist way to
      // get the health factor < 1
      await simulateAssetPriceCrash(usdc, meldPriceOracle, 5n, oracleAdmin);

      await expect(
        lendingPool.connect(liquidator).liquidationCall(
          await tether.getAddress(), // this token is not enabled as collateral for the protocol because it has liquidationThreshold of 0
          await meld.getAddress(), // debt asset
          borrower.address,
          MaxUint256, // flag for all liquidatable debt
          true // receive mToken
        )
      ).to.revertedWith(ProtocolErrors.LL_COLLATERAL_CANNOT_BE_LIQUIDATED);
    });

    it("Should revert if user has not enabled collateral reserve as collateral", async function () {
      const {
        lendingPool,
        meldPriceOracle,
        usdc,
        meld,
        dai,
        borrower,
        liquidator,
        oracleAdmin,
      } = await loadFixture(setUpSingleStableBorrowMELDFixture);

      // Simulate price of collateral (USDC) going down drastically so that position is liquidatable
      // In reality, USDC is not likely to so drastically go down in value, but this is the easist way to
      // get the health factor < 1
      await simulateAssetPriceCrash(usdc, meldPriceOracle, 5n, oracleAdmin);

      await expect(
        lendingPool.connect(liquidator).liquidationCall(
          await dai.getAddress(), // this token is enabled as collateral for protocol, but not enabled as collateral by user
          await meld.getAddress(), // debt asset
          borrower.address,
          MaxUint256, // flag for all liquidatable debt
          true // receive mToken
        )
      ).to.revertedWith(ProtocolErrors.LL_COLLATERAL_CANNOT_BE_LIQUIDATED);
    });

    it("Should revert if user health factor is not < threshold", async function () {
      const { lendingPool, meld, usdc, borrower, liquidator } =
        await loadFixture(setUpSingleStableBorrowMELDFixture);

      await expect(
        lendingPool.connect(liquidator).liquidationCall(
          await usdc.getAddress(), // collateral asset
          await meld.getAddress(), // debt asset
          borrower.address,
          MaxUint256, // flag for all liquidatable debt
          true // receive mToken
        )
      ).to.revertedWith(ProtocolErrors.LL_HEALTH_FACTOR_NOT_BELOW_THRESHOLD);
    });

    it("Should revert if user has no debt", async function () {
      const {
        lendingPool,
        meldPriceOracle,
        meld,
        usdc,
        depositor2,
        liquidator,
        oracleAdmin,
      } = await loadFixture(setUpSingleStableBorrowMELDFixture);

      // Simulate price of collateral (USDC) going down drastically so that position is liquidatable
      // In reality, USDC is not likely to so drastically go down in value, but this is the easist way to
      // get the health factor < 1
      await simulateAssetPriceCrash(usdc, meldPriceOracle, 5n, oracleAdmin);

      // depositor2 has no debt
      await expect(
        lendingPool.connect(liquidator).liquidationCall(
          await usdc.getAddress(), // collateral asset
          await meld.getAddress(), // debt asset
          depositor2.address,
          MaxUint256, // flag for all liquidatable debt
          true // receive mToken
        )
      ).to.revertedWith(ProtocolErrors.LL_HEALTH_FACTOR_NOT_BELOW_THRESHOLD);
    });
  }); // End of Error Test Cases Context
}); // End of Borrow Describe
