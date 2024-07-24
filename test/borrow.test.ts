import { ethers } from "hardhat";
import {
  allocateAndApproveTokens,
  getBlockTimestamps,
  isAlmostEqual,
  loadPoolConfigForEnv,
  setUpTestFixture,
} from "./helpers/utils/utils";
import {
  IMeldConfiguration,
  PoolConfiguration,
  Action,
  MeldBankerType,
} from "./helpers/types";
import {
  ReserveData,
  UserReserveData,
  BlockTimestamps,
} from "./helpers/interfaces";
import {
  loadFixture,
  time,
  mine,
} from "@nomicfoundation/hardhat-network-helpers";
import { convertToCurrencyDecimals } from "./helpers/utils/contracts-helpers";
import {
  calcExpectedReserveDataAfterBorrow,
  calcExpectedUserDataAfterBorrow,
  calcCompoundedInterest,
} from "./helpers/utils/calculations";
import {
  getReserveData,
  getUserData,
  expectEqual,
} from "./helpers/utils/helpers";
import { MToken, ReserveLogic } from "../typechain-types";
import { RateMode } from "./helpers/types";
import { ONE_YEAR, MAX_STABLE_LOAN_PERCENT } from "./helpers/constants";
import { ZeroAddress, Contract, MaxUint256 } from "ethers";
import { expect } from "chai";
import { ProtocolErrors } from "./helpers/types";

describe("Borrow", function () {
  async function depositForMultipleDepositorsFixture() {
    const {
      owner,
      poolAdmin,
      oracleAdmin,
      treasury,
      depositor,
      borrower,
      borrower2,
      borrower3,
      delegatee,
      rando,
      usdc,
      meld,
      dai,
      tether,
      unsupportedToken,
      ...contracts
    } = await setUpTestFixture();

    // Deposit collateral/liquidity

    // USDC
    const depositAmountUSDC = await allocateAndApproveTokens(
      usdc,
      owner,
      borrower,
      contracts.lendingPool,
      20_000n,
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
      ...contracts,
      usdc,
      unsupportedToken,
      meld,
      tether,
      dai,
      depositAmountUSDC,
      depositAmountMELD,
      owner,
      poolAdmin,
      oracleAdmin,
      treasury,
      depositor,
      borrower,
      borrower2,
      borrower3,
      delegatee,
      rando,
    };
  }

  async function depositCollateralInMultipleAssetsFixture() {
    const {
      owner,
      poolAdmin,
      oracleAdmin,
      treasury,
      depositor,
      borrower,
      borrower2,
      borrower3,
      delegatee,
      rando,
      usdc,
      meld,
      dai,
      tether,
      unsupportedToken,
      ...contracts
    } = await setUpTestFixture();

    // Deposit collateral/liquidity

    // Borrower deposits MELD collateral
    const depositAmounMELD = await allocateAndApproveTokens(
      meld,
      owner,
      borrower,
      contracts.lendingPool,
      5_000n,
      0n
    );

    await contracts.lendingPool
      .connect(borrower)
      .deposit(
        await meld.getAddress(),
        depositAmounMELD,
        borrower.address,
        true,
        0
      );

    // Borrower deposits DAI collateral
    const depositAmountDAI = await allocateAndApproveTokens(
      dai,
      owner,
      borrower,
      contracts.lendingPool,
      1_000n,
      0n
    );

    await contracts.lendingPool
      .connect(borrower)
      .deposit(
        await dai.getAddress(),
        depositAmountDAI,
        borrower.address,
        true,
        0
      );

    // Depositor deposits USDC liquidity
    const depositAmountUSDC = await allocateAndApproveTokens(
      usdc,
      owner,
      depositor,
      contracts.lendingPool,
      5_000n,
      0n
    );

    await contracts.lendingPool
      .connect(depositor)
      .deposit(
        await usdc.getAddress(),
        depositAmountUSDC,
        depositor.address,
        true,
        0
      );

    return {
      ...contracts,
      usdc,
      unsupportedToken,
      meld,
      tether,
      dai,
      owner,
      poolAdmin,
      oracleAdmin,
      treasury,
      depositor,
      borrower,
      borrower2,
      borrower3,
      delegatee,
      rando,
    };
  }

  async function depositForMultipleMeldBankersFixture() {
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

    return {
      ...contracts,
      usdc,
      unsupportedToken,
      meld,
      tether,
      dai,
      depositAmountMELD,
      depositAmountMELD2,
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
      context("Single Stable Borrow", async function () {
        it("Should emit correct events when reserve factor == 0", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meld,
            owner,
            borrower,
          } = await loadFixture(depositForMultipleDepositorsFixture);

          // Borrow MELD from the lending pool
          const amountToBorrow = await convertToCurrencyDecimals(
            await meld.getAddress(),
            "2000"
          );

          // Get reserve data before borrowing
          const reserveDataBeforeBorrow: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before borrowing
          const userDataBeforeBorrow: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await meld.getAddress(),
            borrower.address
          );

          // Instantiate reserve token contracts
          const reserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await meld.getAddress()
            );

          const mMELD = await ethers.getContractAt(
            "MToken",
            reserveTokenAddresses.mTokenAddress
          );

          const stableDebtToken = await ethers.getContractAt(
            "StableDebtToken",
            reserveTokenAddresses.stableDebtTokenAddress
          );

          const borrowTx = await lendingPool
            .connect(borrower)
            .borrow(
              await meld.getAddress(),
              amountToBorrow,
              RateMode.Stable,
              borrower.address,
              0
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(borrowTx);

          // Calculate expected reserve data after borrowing
          const expectedReserveDataAfterBorrow: ReserveData =
            calcExpectedReserveDataAfterBorrow(
              amountToBorrow,
              RateMode.Stable,
              reserveDataBeforeBorrow,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          // Calculate expected user data after borrowing
          const expectedUserDataAfterBorrow: UserReserveData =
            calcExpectedUserDataAfterBorrow(
              amountToBorrow,
              RateMode.Stable,
              reserveDataBeforeBorrow,
              expectedReserveDataAfterBorrow,
              userDataBeforeBorrow,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          // Check that the correct events were emitted
          await expect(borrowTx)
            .to.emit(stableDebtToken, "Transfer")
            .withArgs(ZeroAddress, borrower.address, amountToBorrow);

          await expect(borrowTx).to.emit(stableDebtToken, "Mint").withArgs(
            borrower.address,
            borrower.address,
            amountToBorrow,
            0n, // First borrow, so no current balance
            0n, // First borrow, so no balance increase
            expectedUserDataAfterBorrow.stableBorrowRate,
            expectedReserveDataAfterBorrow.averageStableBorrowRate,
            expectedReserveDataAfterBorrow.totalStableDebt
          );

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          await expect(borrowTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await meld.getAddress(),
              expectedReserveDataAfterBorrow.liquidityRate,
              expectedReserveDataAfterBorrow.stableBorrowRate,
              expectedReserveDataAfterBorrow.variableBorrowRate,
              expectedReserveDataAfterBorrow.liquidityIndex,
              expectedReserveDataAfterBorrow.variableBorrowIndex
            );

          await expect(borrowTx)
            .to.emit(meld, "Transfer")
            .withArgs(
              await mMELD.getAddress(),
              borrower.address,
              amountToBorrow
            );

          // The Borrow event is emitted by the BorrowLogic.sol library, so we need to get the contract instance with the BorrowLogic ABI
          const contractInstanceWithBorrowLibraryABI =
            await ethers.getContractAt(
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
              amountToBorrow,
              RateMode.Stable,
              reserveDataBeforeBorrow.stableBorrowRate // The stable borrow rate emitted is the rate before updatInterestRates() is called
            );

          await expect(borrowTx).to.not.emit(mMELD, "Transfer");
          await expect(borrowTx).to.not.emit(mMELD, "Mint");
        });

        it("Should emit correct events when reserve factor > 0 and amountToMint == 0", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            tether,
            owner,
            borrower,
          } = await loadFixture(depositForMultipleDepositorsFixture);

          // Borrow USDT from the lending pool
          const amountToBorrow = await convertToCurrencyDecimals(
            await tether.getAddress(),
            "1250"
          );

          // Get reserve data before borrowing
          const reserveDataBeforeBorrow: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await tether.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before borrowing
          const userDataBeforeBorrow: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await tether.getAddress(),
            borrower.address
          );

          // Instantiate reserve token contracts
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

          const borrowTx = await lendingPool
            .connect(borrower)
            .borrow(
              await tether.getAddress(),
              amountToBorrow,
              RateMode.Stable,
              borrower.address,
              0
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(borrowTx);

          blockTimestamps.txTimestamp, blockTimestamps.latestBlockTimestamp;

          // Calculate expected reserve data after borrowing
          const expectedReserveDataAfterBorrow: ReserveData =
            calcExpectedReserveDataAfterBorrow(
              amountToBorrow,
              RateMode.Stable,
              reserveDataBeforeBorrow,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          // Calculate expected user data after borrowing
          const expectedUserDataAfterBorrow: UserReserveData =
            calcExpectedUserDataAfterBorrow(
              amountToBorrow,
              RateMode.Stable,
              reserveDataBeforeBorrow,
              expectedReserveDataAfterBorrow,
              userDataBeforeBorrow,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          // Check that the correct events were emitted
          await expect(borrowTx)
            .to.emit(stableDebtToken, "Transfer")
            .withArgs(ZeroAddress, borrower.address, amountToBorrow);

          await expect(borrowTx).to.emit(stableDebtToken, "Mint").withArgs(
            borrower.address,
            borrower.address,
            amountToBorrow,
            0n, // First borrow, so no current balance
            0n, // First borrow, so no balance increase
            expectedUserDataAfterBorrow.stableBorrowRate,
            expectedReserveDataAfterBorrow.averageStableBorrowRate,
            expectedReserveDataAfterBorrow.totalStableDebt
          );

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          await expect(borrowTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await tether.getAddress(),
              expectedReserveDataAfterBorrow.liquidityRate,
              expectedReserveDataAfterBorrow.stableBorrowRate,
              expectedReserveDataAfterBorrow.variableBorrowRate,
              expectedReserveDataAfterBorrow.liquidityIndex,
              expectedReserveDataAfterBorrow.variableBorrowIndex
            );

          await expect(borrowTx)
            .to.emit(tether, "Transfer")
            .withArgs(
              await mUSDT.getAddress(),
              borrower.address,
              amountToBorrow
            );

          // The Borrow event is emitted by the BorrowLogic.sol library, so we need to get the contract instance with the BorrowLogic ABI
          const contractInstanceWithBorrowLibraryABI =
            await ethers.getContractAt(
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
              amountToBorrow,
              RateMode.Stable,
              reserveDataBeforeBorrow.stableBorrowRate // The stable borrow rate emitted is the rate before updatInterestRates() is called
            );

          await expect(borrowTx).to.not.emit(mUSDT, "Transfer");
          await expect(borrowTx).to.not.emit(mUSDT, "Mint");
        });

        it("Should update state correctly", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meld,
            borrower,
          } = await loadFixture(depositForMultipleDepositorsFixture);

          // Borrow MELD from the lending pool
          const amountToBorrow = await convertToCurrencyDecimals(
            await meld.getAddress(),
            "2000"
          );

          // Get reserve data before borrowing
          const reserveDataBeforeBorrow: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before borrowing
          const userDataBeforeBorrow: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await meld.getAddress(),
            borrower.address
          );

          const borrowTx = await lendingPool
            .connect(borrower)
            .borrow(
              await meld.getAddress(),
              amountToBorrow,
              RateMode.Stable,
              borrower.address,
              0
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(borrowTx);

          // Get reserve data after borrowing
          const reserveDataAfterBorrow: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data after borrowing
          const userDataAfterBorrow: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await meld.getAddress(),
            borrower.address
          );

          // Calculate expected reserve data after borrowing
          const expectedReserveDataAfterBorrow: ReserveData =
            calcExpectedReserveDataAfterBorrow(
              amountToBorrow,
              RateMode.Stable,
              reserveDataBeforeBorrow,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          // Calculate expected user data after borrowing
          const expectedUserDataAfterBorrow: UserReserveData =
            calcExpectedUserDataAfterBorrow(
              amountToBorrow,
              RateMode.Stable,
              reserveDataBeforeBorrow,
              expectedReserveDataAfterBorrow,
              userDataBeforeBorrow,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          expectEqual(reserveDataAfterBorrow, expectedReserveDataAfterBorrow);
          expectEqual(userDataAfterBorrow, expectedUserDataAfterBorrow);
        });

        it("Should update token balances correctly when 'onBehalfOf' address is same as borrower", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meld,
            usdc,
            borrower,
          } = await loadFixture(depositForMultipleDepositorsFixture);

          // Borrow MELD from the lending pool
          const amountToBorrow = await convertToCurrencyDecimals(
            await meld.getAddress(),
            "2000"
          );

          // Instantiate reserve token contracts
          const reserveTokenAddressesMELD =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await meld.getAddress()
            );

          const mMELD = await ethers.getContractAt(
            "MToken",
            reserveTokenAddressesMELD.mTokenAddress
          );

          const stableDebtToken = await ethers.getContractAt(
            "StableDebtToken",
            reserveTokenAddressesMELD.stableDebtTokenAddress
          );

          const variableDebtToken = await ethers.getContractAt(
            "VariableDebtToken",
            reserveTokenAddressesMELD.variableDebtTokenAddress
          );

          const reserveTokenAddressesUSDC =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await usdc.getAddress()
            );
          const mUSDC = await ethers.getContractAt(
            "MToken",
            reserveTokenAddressesUSDC.mTokenAddress
          );

          const mUSDCBalanceBefore = await mUSDC.balanceOf(borrower);

          // Get reserve data before borrowing
          const reserveDataBeforeBorrow: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          const borrowTx = await lendingPool
            .connect(borrower)
            .borrow(
              await meld.getAddress(),
              amountToBorrow,
              RateMode.Stable,
              borrower.address,
              0
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(borrowTx);

          // Calculate expected reserve data after borrowing
          const expectedReserveDataAfterBorrow: ReserveData =
            calcExpectedReserveDataAfterBorrow(
              amountToBorrow,
              RateMode.Stable,
              reserveDataBeforeBorrow,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          const { 0: principalSupply, 1: totalSupply } =
            await stableDebtToken.getSupplyData();

          // Check token balances
          expect(await stableDebtToken.balanceOf(borrower.address)).to.equal(
            amountToBorrow
          );
          expect(await variableDebtToken.balanceOf(borrower.address)).to.equal(
            0n
          );

          // Check stable debt principal and total supply
          expect(principalSupply).to.equal(
            expectedReserveDataAfterBorrow.principalStableDebt
          );

          expect(totalSupply).to.equal(
            expectedReserveDataAfterBorrow.totalStableDebt
          );

          // Borrower didn't deposit MELD as collateral, so no change in mMELD balance.
          // Borrower deposited USDC as collateral, but mUSDC balance should not change. No collateral is transferred during borrow.
          expect(await mMELD.balanceOf(borrower.address)).to.equal(0);
          expect(await mUSDC.balanceOf(borrower.address)).to.equal(
            mUSDCBalanceBefore
          );

          // Borrower should have tokens borrowed
          expect(await meld.balanceOf(borrower.address)).to.equal(
            amountToBorrow
          );
        });

        it("Should update state correctly when lending rate oracle returns 0", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            meldLendingRateOracle,
            lendingRateOracleAggregator,
            meld,
            borrower,
            oracleAdmin,
          } = await loadFixture(depositForMultipleDepositorsFixture);

          // Set test market lending rates
          await meldLendingRateOracle
            .connect(oracleAdmin)
            .setMarketBorrowRate(meld, 0n);

          const [meldBorrowRate, success] =
            await lendingRateOracleAggregator.getMarketBorrowRate(meld);
          expect(meldBorrowRate).to.equal(0n);
          expect(success).to.equal(true);

          // Borrow MELD from the lending pool
          const amountToBorrow = await convertToCurrencyDecimals(
            await meld.getAddress(),
            "2000"
          );

          // Get reserve data before borrowing
          const reserveDataBeforeBorrow: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before borrowing
          const userDataBeforeBorrow: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await meld.getAddress(),
            borrower.address
          );

          const borrowTx = await lendingPool
            .connect(borrower)
            .borrow(
              await meld.getAddress(),
              amountToBorrow,
              RateMode.Stable,
              borrower.address,
              0
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(borrowTx);

          // Get reserve data after borrowing
          const reserveDataAfterBorrow: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data after borrowing
          const userDataAfterBorrow: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await meld.getAddress(),
            borrower.address
          );

          // Calculate expected reserve data after borrowing
          const expectedReserveDataAfterBorrow: ReserveData =
            calcExpectedReserveDataAfterBorrow(
              amountToBorrow,
              RateMode.Stable,
              reserveDataBeforeBorrow,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          // Calculate expected user data after borrowing
          const expectedUserDataAfterBorrow: UserReserveData =
            calcExpectedUserDataAfterBorrow(
              amountToBorrow,
              RateMode.Stable,
              reserveDataBeforeBorrow,
              expectedReserveDataAfterBorrow,
              userDataBeforeBorrow,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          expectEqual(reserveDataAfterBorrow, expectedReserveDataAfterBorrow);
          expectEqual(userDataAfterBorrow, expectedUserDataAfterBorrow);
        });

        it("Should emit the correct events when a regular user borrows a yield boost token", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            usdc,
            owner,
            depositor,
            yieldBoostStakingUSDC,
          } = await loadFixture(depositForMultipleDepositorsFixture);

          // Depositor of MELD decides to borrow USDC
          const borrower = depositor;

          // Borrow USDC from the lending pool
          const amountToBorrow = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "3000"
          );

          // Get reserve data before borrowing
          const reserveDataBeforeBorrow: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Instantiate reserve token contracts
          const reserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await usdc.getAddress()
            );

          const mUSDC = await ethers.getContractAt(
            "MToken",
            reserveTokenAddresses.mTokenAddress
          );

          const stableDebtToken = await ethers.getContractAt(
            "VariableDebtToken",
            reserveTokenAddresses.stableDebtTokenAddress
          );

          const borrowTx = await lendingPool
            .connect(borrower)
            .borrow(
              await usdc.getAddress(),
              amountToBorrow,
              RateMode.Stable,
              borrower.address,
              0n
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(borrowTx);

          // Calculate expected reserve data after borrowing
          const expectedReserveDataAfterBorrow: ReserveData =
            calcExpectedReserveDataAfterBorrow(
              amountToBorrow,
              RateMode.Stable,
              reserveDataBeforeBorrow,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          // Check that the correct events were emitted
          await expect(borrowTx)
            .to.emit(stableDebtToken, "Transfer")
            .withArgs(ZeroAddress, borrower.address, amountToBorrow);

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          await expect(borrowTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await usdc.getAddress(),
              expectedReserveDataAfterBorrow.liquidityRate,
              expectedReserveDataAfterBorrow.stableBorrowRate,
              expectedReserveDataAfterBorrow.variableBorrowRate,
              expectedReserveDataAfterBorrow.liquidityIndex,
              expectedReserveDataAfterBorrow.variableBorrowIndex
            );

          await expect(borrowTx)
            .to.emit(usdc, "Transfer")
            .withArgs(
              await mUSDC.getAddress(),
              borrower.address,
              amountToBorrow
            );

          // The Borrow event is emitted by the BorrowLogic.sol library, so we need to get the contract instance with the BorrowLogic ABI
          const contractInstanceWithBorrowLibraryABI =
            await ethers.getContractAt(
              "BorrowLogic",
              await lendingPool.getAddress(),
              owner
            );

          await expect(borrowTx)
            .to.emit(contractInstanceWithBorrowLibraryABI, "Borrow")
            .withArgs(
              await usdc.getAddress(),
              borrower.address,
              borrower.address,
              amountToBorrow,
              RateMode.Stable,
              reserveDataBeforeBorrow.stableBorrowRate // The stable borrow rate emitted is the rate before updatInterestRates() is called
            );

          await expect(borrowTx).to.not.emit(mUSDC, "Transfer");
          await expect(borrowTx).to.not.emit(mUSDC, "Mint");

          // Regular user, so  yield boost multiplier is 0%
          await expect(borrowTx).to.not.emit(
            yieldBoostStakingUSDC,
            "StakePositionCreated"
          );

          await expect(borrowTx).to.not.emit(
            yieldBoostStakingUSDC,
            "StakePositionUpdated"
          );

          await expect(borrowTx).to.not.emit(lendingPool, "LockMeldBankerNFT");

          await expect(borrowTx)
            .to.emit(lendingPool, "RefreshYieldBoostAmount")
            .withArgs(await usdc.getAddress(), borrower.address, 0n);
        });

        it("Should update state correctly when a regular user borrows a yield boost token", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            usdc,
            depositor,
            yieldBoostStorageUSDC,
          } = await loadFixture(depositForMultipleDepositorsFixture);

          // Depositor of MELD decides to borrow USDC
          const borrower = depositor;

          // Borrow USDC from the lending pool
          const amountToBorrow = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "2000"
          );

          // Get reserve data before borrowing
          const reserveDataBeforeBorrow: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before borrowing
          const userDataBeforeBorrow: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await usdc.getAddress(),
            borrower.address
          );

          const borrowTx = await lendingPool
            .connect(borrower)
            .borrow(
              await usdc.getAddress(),
              amountToBorrow,
              RateMode.Stable,
              borrower.address,
              0n
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(borrowTx);

          // Get reserve data after borrowing
          const reserveDataAfterBorrow: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data after borrowing
          const userDataAfterBorrow: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await usdc.getAddress(),
            borrower.address
          );

          // Calculate expected reserve data after borrowing
          const expectedReserveDataAfterBorrow: ReserveData =
            calcExpectedReserveDataAfterBorrow(
              amountToBorrow,
              RateMode.Stable,
              reserveDataBeforeBorrow,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          // Calculate expected user data after borrowing
          const expectedUserDataAfterBorrow: UserReserveData =
            calcExpectedUserDataAfterBorrow(
              amountToBorrow,
              RateMode.Stable,
              reserveDataBeforeBorrow,
              expectedReserveDataAfterBorrow,
              userDataBeforeBorrow,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          expectEqual(reserveDataAfterBorrow, expectedReserveDataAfterBorrow);
          expectEqual(userDataAfterBorrow, expectedUserDataAfterBorrow);

          expect(await lendingPool.isUsingMeldBanker(depositor.address)).to.be
            .false;
          expect(await lendingPool.isMeldBankerBlocked(0n)).to.be.false;

          const meldBankerData = await lendingPool.userMeldBankerData(
            borrower.address
          );
          expect(meldBankerData.tokenId).to.equal(0);
          expect(meldBankerData.asset).to.equal(ZeroAddress);
          expect(meldBankerData.meldBankerType).to.equal(MeldBankerType.NONE);
          expect(meldBankerData.action).to.equal(Action.NONE);
          expect(
            await yieldBoostStorageUSDC.getStakerStakedAmount(depositor.address)
          ).to.equal(0n);
        });

        it("Should update token balances correctly when regular user borrows a yield boost token", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            usdc,
            meld,
            depositor,
          } = await loadFixture(depositForMultipleDepositorsFixture);

          // Depositor of MELD decides to borrow USDC
          const borrower = depositor;

          // Borrow USDC from the lending pool
          const amountToBorrow = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "2000"
          );

          // Instantiate reserve token contracts for borrowed and collateral token
          const reserveTokenAddressesMELD =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await meld.getAddress()
            );

          const mMELD = await ethers.getContractAt(
            "MToken",
            reserveTokenAddressesMELD.mTokenAddress
          );

          const reserveTokenAddressesUSDC =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await usdc.getAddress()
            );

          const mUSDC = await ethers.getContractAt(
            "MToken",
            reserveTokenAddressesUSDC.mTokenAddress
          );

          const stableDebtToken = await ethers.getContractAt(
            "StableDebtToken",
            reserveTokenAddressesUSDC.stableDebtTokenAddress
          );

          const variableDebtToken = await ethers.getContractAt(
            "VariableDebtToken",
            reserveTokenAddressesUSDC.variableDebtTokenAddress
          );

          const mMELDBalanceBefore = await mMELD.balanceOf(borrower);
          const mUSDCBalanceBefore = await mUSDC.balanceOf(borrower);

          // Get reserve data before borrowing
          const reserveDataBeforeBorrow: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          const borrowTx = await lendingPool
            .connect(borrower)
            .borrow(
              await usdc.getAddress(),
              amountToBorrow,
              RateMode.Stable,
              borrower.address,
              0n
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(borrowTx);

          // Calculate expected reserve data after borrowing
          const expectedReserveDataAfterBorrow: ReserveData =
            calcExpectedReserveDataAfterBorrow(
              amountToBorrow,
              RateMode.Stable,
              reserveDataBeforeBorrow,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          const { 0: principalSupply, 1: totalSupply } =
            await stableDebtToken.getSupplyData();

          // Check token balances
          expect(await stableDebtToken.balanceOf(borrower.address)).to.equal(
            amountToBorrow
          );
          expect(await variableDebtToken.balanceOf(borrower.address)).to.equal(
            0n
          );

          // Check stable debt principal and total supply
          expect(principalSupply).to.equal(
            expectedReserveDataAfterBorrow.principalStableDebt
          );

          expect(totalSupply).to.equal(
            expectedReserveDataAfterBorrow.totalStableDebt
          );

          // Borrower deposited MELD as collateral. No change in mMELD balance. No collateral is transferred during borrow.
          // Borrower borrowed USDC, but mUSDC balance should not change.
          expect(await mMELD.balanceOf(borrower.address)).to.equal(
            mMELDBalanceBefore
          );
          expect(await mUSDC.balanceOf(borrower.address)).to.equal(
            mUSDCBalanceBefore
          );

          // Borrower should have tokens borrowed
          expect(await usdc.balanceOf(borrower.address)).to.equal(
            amountToBorrow
          );
        });
        it("Should calculate correct stake amount if regular user deposits a yield boost token and then borrows a different yield boost token", async function () {
          const {
            lendingPool,
            usdc,
            dai,
            owner,
            depositor,
            yieldBoostStorageUSDC,
            yieldBoostStorageDAI,
          } = await loadFixture(depositForMultipleDepositorsFixture);

          // Depositor of MELD decides to deposit DAI and borrow USDC
          const borrower = depositor;

          // USDC liquidity deposited in fixture

          // Borrower deposits DAI (a yield boost token)
          const depositAmountDAI = await allocateAndApproveTokens(
            dai,
            owner,
            borrower,
            lendingPool,
            5_000n,
            0n
          );

          await lendingPool
            .connect(borrower)
            .deposit(
              await dai.getAddress(),
              depositAmountDAI,
              borrower.address,
              true,
              0n
            );

          // Borrow USDC from the lending pool
          const amountToBorrow = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "1000"
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

          // DAI and USDC have different staking protocols, so the amounts are different.
          // DAI: deposit amount * regular user deposit multiplier  (100%)
          // USDC: Borrow amount * regular user borrow multiplier (0%)
          const yieldBoostMultiplierDAI =
            await lendingPool.yieldBoostMultipliers(
              MeldBankerType.NONE,
              Action.DEPOSIT
            );

          const expectedStakedAmountDAI = depositAmountDAI.percentMul(
            yieldBoostMultiplierDAI
          );

          expect(
            await yieldBoostStorageDAI.getStakerStakedAmount(borrower.address)
          ).to.equal(expectedStakedAmountDAI);

          const yieldBoostMultiplierUSDC =
            await lendingPool.yieldBoostMultipliers(
              MeldBankerType.NONE,
              Action.BORROW
            );

          const expectedStakedAmountUSDC = amountToBorrow.percentMul(
            yieldBoostMultiplierUSDC
          );

          expect(
            await yieldBoostStorageUSDC.getStakerStakedAmount(borrower.address)
          ).to.equal(expectedStakedAmountUSDC);
        });
        it("Should calculate correct stake amount if regular user borrow percentage is > 0", async function () {
          const {
            lendingPool,
            usdc,
            depositor,
            poolAdmin,
            yieldBoostStorageUSDC,
          } = await loadFixture(depositForMultipleDepositorsFixture);
          // USDC liquidity deposited in fixture

          const borrower = depositor;

          // Set regular user yield boost multiplier to 1% (from 0)
          const newYieldBoostMultiplier = 1_00;

          await lendingPool
            .connect(poolAdmin)
            .setYieldBoostMultiplier(
              usdc,
              MeldBankerType.NONE,
              Action.BORROW,
              newYieldBoostMultiplier
            );
          expect(
            await lendingPool.yieldBoostMultipliers(
              MeldBankerType.NONE,
              Action.BORROW
            )
          ).to.equal(newYieldBoostMultiplier);

          // Borrow USDC from the lending pool
          const amountToBorrow = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "1000"
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

          const yieldBoostMultiplierUSDC =
            await lendingPool.yieldBoostMultipliers(
              MeldBankerType.NONE,
              Action.BORROW
            );

          const expectedStakedAmountUSDC = amountToBorrow.percentMul(
            yieldBoostMultiplierUSDC
          );

          expect(
            await yieldBoostStorageUSDC.getStakerStakedAmount(borrower.address)
          ).to.equal(expectedStakedAmountUSDC);
        });

        it("Should emit correct events when borrower borrows max possible amount (MaxUint256)", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meld,
            owner,
            borrower,
          } = await loadFixture(depositForMultipleDepositorsFixture);

          // Get reserve data before borrowing
          const reserveDataBeforeBorrow: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before borrowing
          const userDataBeforeBorrow: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await meld.getAddress(),
            borrower.address
          );

          // Instantiate reserve token contracts
          const reserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await meld.getAddress()
            );

          const mMELD = await ethers.getContractAt(
            "MToken",
            reserveTokenAddresses.mTokenAddress
          );

          const stableDebtToken = await ethers.getContractAt(
            "StableDebtToken",
            reserveTokenAddresses.stableDebtTokenAddress
          );

          const borrowTx = await lendingPool.connect(borrower).borrow(
            await meld.getAddress(),
            MaxUint256, // flag for max amount
            RateMode.Stable,
            borrower.address,
            0
          );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(borrowTx);

          const maxLoanSizeStable =
            reserveDataBeforeBorrow.availableLiquidity.percentMul(
              MAX_STABLE_LOAN_PERCENT
            );

          // Calculate expected reserve data after borrowing
          const expectedReserveDataAfterBorrow: ReserveData =
            calcExpectedReserveDataAfterBorrow(
              maxLoanSizeStable,
              RateMode.Stable,
              reserveDataBeforeBorrow,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          // Calculate expected user data after borrowing
          const expectedUserDataAfterBorrow: UserReserveData =
            calcExpectedUserDataAfterBorrow(
              maxLoanSizeStable,
              RateMode.Stable,
              reserveDataBeforeBorrow,
              expectedReserveDataAfterBorrow,
              userDataBeforeBorrow,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          // Check that the correct events were emitted
          await expect(borrowTx)
            .to.emit(stableDebtToken, "Transfer")
            .withArgs(ZeroAddress, borrower.address, maxLoanSizeStable);

          await expect(borrowTx).to.emit(stableDebtToken, "Mint").withArgs(
            borrower.address,
            borrower.address,
            maxLoanSizeStable,
            0n, // First borrow, so no current balance
            0n, // First borrow, so no balance increase
            expectedUserDataAfterBorrow.stableBorrowRate,
            expectedReserveDataAfterBorrow.averageStableBorrowRate,
            expectedReserveDataAfterBorrow.totalStableDebt
          );

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          await expect(borrowTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await meld.getAddress(),
              expectedReserveDataAfterBorrow.liquidityRate,
              expectedReserveDataAfterBorrow.stableBorrowRate,
              expectedReserveDataAfterBorrow.variableBorrowRate,
              expectedReserveDataAfterBorrow.liquidityIndex,
              expectedReserveDataAfterBorrow.variableBorrowIndex
            );

          await expect(borrowTx)
            .to.emit(meld, "Transfer")
            .withArgs(
              await mMELD.getAddress(),
              borrower.address,
              maxLoanSizeStable
            );

          // The Borrow event is emitted by the BorrowLogic.sol library, so we need to get the contract instance with the BorrowLogic ABI
          const contractInstanceWithBorrowLibraryABI =
            await ethers.getContractAt(
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
              maxLoanSizeStable,
              RateMode.Stable,
              reserveDataBeforeBorrow.stableBorrowRate // The stable borrow rate emitted is the rate before updatInterestRates() is called
            );

          await expect(borrowTx).to.not.emit(mMELD, "Transfer");
          await expect(borrowTx).to.not.emit(mMELD, "Mint");
        });

        it("Should emit correct events when borrower borrows max possible amount (MaxUint256) and has multiple collateral assets", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            usdc,
            owner,
            borrower,
          } = await loadFixture(depositCollateralInMultipleAssetsFixture);
          // Borrower has 5,000 MELD and 1,000 DAI as collateral
          // Available liquidity is 5,000 USDC deposited by depositor

          // Get reserve data before borrowing
          const reserveDataBeforeBorrow: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before borrowing
          const userDataBeforeBorrow: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await usdc.getAddress(),
            borrower.address
          );

          // Instantiate reserve token contracts
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

          // Borrower borrows borrows max amount of USDC
          const borrowTx = await lendingPool
            .connect(borrower)
            .borrow(
              await usdc.getAddress(),
              MaxUint256,
              RateMode.Stable,
              borrower.address,
              0
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(borrowTx);

          const maxLoanSizeStable =
            reserveDataBeforeBorrow.availableLiquidity.percentMul(
              MAX_STABLE_LOAN_PERCENT
            );

          // Calculate expected reserve data after borrowing
          const expectedReserveDataAfterBorrow: ReserveData =
            calcExpectedReserveDataAfterBorrow(
              maxLoanSizeStable,
              RateMode.Stable,
              reserveDataBeforeBorrow,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          // Calculate expected user data after borrowing
          const expectedUserDataAfterBorrow: UserReserveData =
            calcExpectedUserDataAfterBorrow(
              maxLoanSizeStable,
              RateMode.Stable,
              reserveDataBeforeBorrow,
              expectedReserveDataAfterBorrow,
              userDataBeforeBorrow,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          // Check that the correct events were emitted
          await expect(borrowTx)
            .to.emit(stableDebtToken, "Transfer")
            .withArgs(ZeroAddress, borrower.address, maxLoanSizeStable);

          await expect(borrowTx).to.emit(stableDebtToken, "Mint").withArgs(
            borrower.address,
            borrower.address,
            maxLoanSizeStable,
            0n, // First borrow, so no current balance
            0n, // First borrow, so no balance increase
            expectedUserDataAfterBorrow.stableBorrowRate,
            expectedReserveDataAfterBorrow.averageStableBorrowRate,
            expectedReserveDataAfterBorrow.totalStableDebt
          );

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          await expect(borrowTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await usdc.getAddress(),
              expectedReserveDataAfterBorrow.liquidityRate,
              expectedReserveDataAfterBorrow.stableBorrowRate,
              expectedReserveDataAfterBorrow.variableBorrowRate,
              expectedReserveDataAfterBorrow.liquidityIndex,
              expectedReserveDataAfterBorrow.variableBorrowIndex
            );

          await expect(borrowTx)
            .to.emit(usdc, "Transfer")
            .withArgs(
              await mUSDC.getAddress(),
              borrower.address,
              maxLoanSizeStable
            );

          // The Borrow event is emitted by the BorrowLogic.sol library, so we need to get the contract instance with the BorrowLogic ABI
          const contractInstanceWithBorrowLibraryABI =
            await ethers.getContractAt(
              "BorrowLogic",
              await lendingPool.getAddress(),
              owner
            );

          await expect(borrowTx)
            .to.emit(contractInstanceWithBorrowLibraryABI, "Borrow")
            .withArgs(
              await usdc.getAddress(),
              borrower.address,
              borrower.address,
              maxLoanSizeStable,
              RateMode.Stable,
              reserveDataBeforeBorrow.stableBorrowRate // The stable borrow rate emitted is the rate before updatInterestRates() is called
            );

          await expect(borrowTx).to.not.emit(mUSDC, "Transfer");
          await expect(borrowTx).to.not.emit(mUSDC, "Mint");
        });

        it("Should update state correctly when borrower borrows max possible amount (MaxUint256)", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meld,
            borrower,
          } = await loadFixture(depositForMultipleDepositorsFixture);

          // Get reserve data before borrowing
          const reserveDataBeforeBorrow: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before borrowing
          const userDataBeforeBorrow: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await meld.getAddress(),
            borrower.address
          );

          const borrowTx = await lendingPool.connect(borrower).borrow(
            await meld.getAddress(),
            MaxUint256, // flag for max amount
            RateMode.Stable,
            borrower.address,
            0
          );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(borrowTx);

          // Get reserve data after borrowing
          const reserveDataAfterBorrow: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data after borrowing
          const userDataAfterBorrow: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await meld.getAddress(),
            borrower.address
          );

          const maxLoanSizeStable =
            reserveDataBeforeBorrow.availableLiquidity.percentMul(
              MAX_STABLE_LOAN_PERCENT
            );

          // Calculate expected reserve data after borrowing
          const expectedReserveDataAfterBorrow: ReserveData =
            calcExpectedReserveDataAfterBorrow(
              maxLoanSizeStable,
              RateMode.Stable,
              reserveDataBeforeBorrow,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          // Calculate expected user data after borrowing
          const expectedUserDataAfterBorrow: UserReserveData =
            calcExpectedUserDataAfterBorrow(
              maxLoanSizeStable,
              RateMode.Stable,
              reserveDataBeforeBorrow,
              expectedReserveDataAfterBorrow,
              userDataBeforeBorrow,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          expectEqual(reserveDataAfterBorrow, expectedReserveDataAfterBorrow);
          expectEqual(userDataAfterBorrow, expectedUserDataAfterBorrow);
        });

        it("Should return the correct value when making a static call", async function () {
          const { lendingPool, meld, borrower } = await loadFixture(
            depositForMultipleDepositorsFixture
          );

          // Borrow MELD from the lending pool
          const amountToBorrow = await convertToCurrencyDecimals(
            await meld.getAddress(),
            "2000"
          );

          const returnedBorrowedAmount = await lendingPool
            .connect(borrower)
            .borrow.staticCall(
              await meld.getAddress(),
              amountToBorrow,
              RateMode.Stable,
              borrower.address,
              0
            );

          expect(returnedBorrowedAmount).to.equal(amountToBorrow);

          // Check that gas can be estimated
          const estimatedGas = await lendingPool
            .connect(borrower)
            .borrow.estimateGas(
              await meld.getAddress(),
              amountToBorrow,
              RateMode.Stable,
              borrower.address,
              0
            );
          expect(estimatedGas).to.be.gt(0);
        });
      }); // End Single Stable Borrow Context

      context("Single Variable Borrow", async function () {
        it("Should emit correct events when reserve factor == 0", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meld,
            owner,
            borrower,
          } = await loadFixture(depositForMultipleDepositorsFixture);

          // Borrow MELD from the lending pool
          const amountToBorrow = await convertToCurrencyDecimals(
            await meld.getAddress(),
            "2000"
          );

          // Get reserve data before borrowing
          const reserveDataBeforeBorrow: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Instantiate reserve token contracts
          const reserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await meld.getAddress()
            );

          const mMELD = await ethers.getContractAt(
            "MToken",
            reserveTokenAddresses.mTokenAddress
          );

          const variableDebtToken = await ethers.getContractAt(
            "VariableDebtToken",
            reserveTokenAddresses.variableDebtTokenAddress
          );

          const borrowTx = await lendingPool
            .connect(borrower)
            .borrow(
              await meld.getAddress(),
              amountToBorrow,
              RateMode.Variable,
              borrower.address,
              0
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(borrowTx);

          // Calculate expected reserve data after borrowing
          const expectedReserveDataAfterBorrow: ReserveData =
            calcExpectedReserveDataAfterBorrow(
              amountToBorrow,
              RateMode.Variable,
              reserveDataBeforeBorrow,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          // Check that the correct events were emitted
          await expect(borrowTx)
            .to.emit(variableDebtToken, "Transfer")
            .withArgs(ZeroAddress, borrower.address, amountToBorrow);

          await expect(borrowTx)
            .to.emit(variableDebtToken, "Mint")
            .withArgs(
              borrower.address,
              borrower.address,
              amountToBorrow,
              expectedReserveDataAfterBorrow.variableBorrowIndex
            );

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          await expect(borrowTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await meld.getAddress(),
              expectedReserveDataAfterBorrow.liquidityRate,
              expectedReserveDataAfterBorrow.stableBorrowRate,
              expectedReserveDataAfterBorrow.variableBorrowRate,
              expectedReserveDataAfterBorrow.liquidityIndex,
              expectedReserveDataAfterBorrow.variableBorrowIndex
            );

          await expect(borrowTx)
            .to.emit(meld, "Transfer")
            .withArgs(
              await mMELD.getAddress(),
              borrower.address,
              amountToBorrow
            );

          // The Borrow event is emitted by the BorrowLogic.sol library, so we need to get the contract instance with the BorrowLogic ABI
          const contractInstanceWithBorrowLibraryABI =
            await ethers.getContractAt(
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
              amountToBorrow,
              RateMode.Variable,
              expectedReserveDataAfterBorrow.variableBorrowRate
            );

          await expect(borrowTx).to.not.emit(mMELD, "Transfer");

          await expect(borrowTx).to.not.emit(mMELD, "Mint");
        });

        it("Should emit correct events when reserve factor > 0 and amountToMint == 0", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            tether,
            owner,
            borrower,
          } = await loadFixture(depositForMultipleDepositorsFixture);

          // Borrow USDT from the lending pool
          const amountToBorrow = await convertToCurrencyDecimals(
            await tether.getAddress(),
            "1250"
          );

          // Get reserve data before borrowing
          const reserveDataBeforeBorrow: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await tether.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Instantiate reserve token contracts
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

          const borrowTx = await lendingPool
            .connect(borrower)
            .borrow(
              await tether.getAddress(),
              amountToBorrow,
              RateMode.Variable,
              borrower.address,
              0
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(borrowTx);

          // Calculate expected reserve data after borrowing
          const expectedReserveDataAfterBorrow: ReserveData =
            calcExpectedReserveDataAfterBorrow(
              amountToBorrow,
              RateMode.Variable,
              reserveDataBeforeBorrow,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          // Check that the correct events were emitted
          await expect(borrowTx)
            .to.emit(variableDebtToken, "Transfer")
            .withArgs(ZeroAddress, borrower.address, amountToBorrow);

          await expect(borrowTx)
            .to.emit(variableDebtToken, "Mint")
            .withArgs(
              borrower.address,
              borrower.address,
              amountToBorrow,
              expectedReserveDataAfterBorrow.variableBorrowIndex
            );

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          await expect(borrowTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await tether.getAddress(),
              expectedReserveDataAfterBorrow.liquidityRate,
              expectedReserveDataAfterBorrow.stableBorrowRate,
              expectedReserveDataAfterBorrow.variableBorrowRate,
              expectedReserveDataAfterBorrow.liquidityIndex,
              expectedReserveDataAfterBorrow.variableBorrowIndex
            );

          await expect(borrowTx)
            .to.emit(tether, "Transfer")
            .withArgs(
              await mUSDT.getAddress(),
              borrower.address,
              amountToBorrow
            );

          // The Borrow event is emitted by the BorrowLogic.sol library, so we need to get the contract instance with the BorrowLogic ABI
          const contractInstanceWithBorrowLibraryABI =
            await ethers.getContractAt(
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
              amountToBorrow,
              RateMode.Variable,
              expectedReserveDataAfterBorrow.variableBorrowRate
            );

          await expect(borrowTx).to.not.emit(mUSDT, "Transfer");
          await expect(borrowTx).to.not.emit(mUSDT, "Mint");
        });

        it("Should update state correctly", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meld,
            borrower,
          } = await loadFixture(depositForMultipleDepositorsFixture);

          // Borrow MELD from the lending pool
          const amountToBorrow = await convertToCurrencyDecimals(
            await meld.getAddress(),
            "2000"
          );

          // Get reserve data before borrowing
          const reserveDataBeforeBorrow: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before borrowing
          const userDataBeforeBorrow: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await meld.getAddress(),
            borrower.address
          );

          const borrowTx = await lendingPool
            .connect(borrower)
            .borrow(
              await meld.getAddress(),
              amountToBorrow,
              RateMode.Variable,
              borrower.address,
              0
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(borrowTx);

          // Get reserve data after borrowing
          const reserveDataAfterBorrow: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data after borrowing
          const userDataAfterBorrow: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await meld.getAddress(),
            borrower.address
          );

          // Calculate expected reserve data after borrowing
          const expectedReserveDataAfterBorrow: ReserveData =
            calcExpectedReserveDataAfterBorrow(
              amountToBorrow,
              RateMode.Variable,
              reserveDataBeforeBorrow,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          // Calculate expected user data after borrowing
          const expectedUserDataAfterBorrow: UserReserveData =
            calcExpectedUserDataAfterBorrow(
              amountToBorrow,
              RateMode.Variable,
              reserveDataBeforeBorrow,
              expectedReserveDataAfterBorrow,
              userDataBeforeBorrow,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          expectEqual(reserveDataAfterBorrow, expectedReserveDataAfterBorrow);
          expectEqual(userDataAfterBorrow, expectedUserDataAfterBorrow);
        });

        it("Should update token balances correctly when 'onBehalfOf' address is same as borrower", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meld,
            usdc,
            borrower,
          } = await loadFixture(depositForMultipleDepositorsFixture);

          // Borrow MELD from the lending pool
          const amountToBorrow = await convertToCurrencyDecimals(
            await meld.getAddress(),
            "2000"
          );

          // Instantiate reserve token contracts
          const reserveTokenAddressesMELD =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await meld.getAddress()
            );

          const mMELD = await ethers.getContractAt(
            "MToken",
            reserveTokenAddressesMELD.mTokenAddress
          );

          const stableDebtToken = await ethers.getContractAt(
            "StableDebtToken",
            reserveTokenAddressesMELD.stableDebtTokenAddress
          );

          const variableDebtToken = await ethers.getContractAt(
            "VariableDebtToken",
            reserveTokenAddressesMELD.variableDebtTokenAddress
          );

          const reserveTokenAddressesUSDC =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await usdc.getAddress()
            );

          const mUSDC = await ethers.getContractAt(
            "MToken",
            reserveTokenAddressesUSDC.mTokenAddress
          );

          const mUSDCBalanceBefore = await mUSDC.balanceOf(borrower);

          // Get reserve data before borrowing
          const reserveDataBeforeBorrow: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before borrowing
          const userDataBeforeBorrow: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await meld.getAddress(),
            borrower.address
          );

          const borrowTx = await lendingPool
            .connect(borrower)
            .borrow(
              await meld.getAddress(),
              amountToBorrow,
              RateMode.Variable,
              borrower.address,
              0
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(borrowTx);

          // Calculate expected reserve data after borrowing
          const expectedReserveDataAfterBorrow: ReserveData =
            calcExpectedReserveDataAfterBorrow(
              amountToBorrow,
              RateMode.Variable,
              reserveDataBeforeBorrow,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          // Calculate expected user data after borrowing
          const expectedUserDataAfterBorrow: UserReserveData =
            calcExpectedUserDataAfterBorrow(
              amountToBorrow,
              RateMode.Variable,
              reserveDataBeforeBorrow,
              expectedReserveDataAfterBorrow,
              userDataBeforeBorrow,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          // Check token balances
          expect(await stableDebtToken.balanceOf(borrower.address)).to.equal(
            0n
          );

          expect(
            await stableDebtToken.principalBalanceOf(borrower.address)
          ).to.equal(0n);

          expect(await variableDebtToken.balanceOf(borrower.address)).to.equal(
            expectedUserDataAfterBorrow.currentVariableDebt
          );

          expect(
            await variableDebtToken.scaledBalanceOf(borrower.address)
          ).to.equal(expectedUserDataAfterBorrow.scaledVariableDebt);

          // Check variable debt total and scaled supply
          expect(await variableDebtToken.totalSupply()).to.equal(
            expectedReserveDataAfterBorrow.totalVariableDebt
          );

          expect(await variableDebtToken.scaledTotalSupply()).to.equal(
            expectedReserveDataAfterBorrow.scaledVariableDebt
          );

          // Borrower didn't deposit MELD as collateral, so no change in mMELD balance.
          // Borrower deposited USDC as collateral, but mUSDC balance should not change. No collateral is transferred during borrow.
          expect(await mMELD.balanceOf(borrower.address)).to.equal(0);
          expect(await mUSDC.balanceOf(borrower.address)).to.equal(
            mUSDCBalanceBefore
          );

          // Borrower should have tokens borrowed
          expect(await meld.balanceOf(borrower.address)).to.equal(
            amountToBorrow
          );
        });

        it("Should emit correct events when borrower borrows max possible amount (MaxUint256)", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            priceOracleAggregator,
            dai,
            owner,
            borrower,
            borrower3,
          } = await loadFixture(depositForMultipleDepositorsFixture);
          // Borrower has 20,000 USDC as collateral

          // Add more DAI liquidity. 2000 DAI deposited already
          const depositAmountDAI = await allocateAndApproveTokens(
            dai,
            owner,
            borrower3,
            lendingPool,
            10_000n,
            0n
          );

          await lendingPool
            .connect(borrower3)
            .deposit(
              await dai.getAddress(),
              depositAmountDAI,
              borrower3.address,
              true,
              0
            );

          // Get reserve data before borrowing
          const reserveDataBeforeBorrow: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await dai.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          const borrowerAccountDataBefore =
            await lendingPool.getUserAccountData(borrower.address);

          // Instantiate reserve token contracts
          const reserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await dai.getAddress()
            );

          const mDAI = await ethers.getContractAt(
            "MToken",
            reserveTokenAddresses.mTokenAddress
          );

          const variableDebtToken = await ethers.getContractAt(
            "VariableDebtToken",
            reserveTokenAddresses.variableDebtTokenAddress
          );

          // Borrower borrows borrows max amount of DAI
          const borrowTx = await lendingPool.connect(borrower).borrow(
            await dai.getAddress(),
            MaxUint256, // flag for max amount
            RateMode.Variable,
            borrower.address,
            0
          );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(borrowTx);

          // User is borrowing the maximum possible amount. User can't borrow more than the LTV amount minus the amount already borrowed
          const expectedBorrowAmountUSD =
            borrowerAccountDataBefore.totalCollateralUSD.percentMul(
              borrowerAccountDataBefore.ltv
            ) - borrowerAccountDataBefore.totalDebtUSD;

          const [currentPrice, oracleSuccess] =
            await priceOracleAggregator.getAssetPrice(await dai.getAddress());
          expect(oracleSuccess).to.be.true;

          const daiDecimals = await dai.decimals();
          const daiTokenUnit = 10n ** daiDecimals;

          const expectedBorrowAmount =
            (daiTokenUnit * expectedBorrowAmountUSD) / currentPrice;

          // Calculate expected reserve data after borrowing
          const expectedReserveDataAfterBorrow: ReserveData =
            calcExpectedReserveDataAfterBorrow(
              expectedBorrowAmount,
              RateMode.Variable,
              reserveDataBeforeBorrow,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          // Check that the correct events were emitted
          await expect(borrowTx)
            .to.emit(variableDebtToken, "Transfer")
            .withArgs(ZeroAddress, borrower.address, expectedBorrowAmount);

          await expect(borrowTx)
            .to.emit(variableDebtToken, "Mint")
            .withArgs(
              borrower.address,
              borrower.address,
              expectedBorrowAmount,
              expectedReserveDataAfterBorrow.variableBorrowIndex
            );

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          await expect(borrowTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await dai.getAddress(),
              expectedReserveDataAfterBorrow.liquidityRate,
              expectedReserveDataAfterBorrow.stableBorrowRate,
              expectedReserveDataAfterBorrow.variableBorrowRate,
              expectedReserveDataAfterBorrow.liquidityIndex,
              expectedReserveDataAfterBorrow.variableBorrowIndex
            );

          await expect(borrowTx)
            .to.emit(dai, "Transfer")
            .withArgs(
              await mDAI.getAddress(),
              borrower.address,
              expectedBorrowAmount
            );

          // The Borrow event is emitted by the BorrowLogic.sol library, so we need to get the contract instance with the BorrowLogic ABI
          const contractInstanceWithBorrowLibraryABI =
            await ethers.getContractAt(
              "BorrowLogic",
              await lendingPool.getAddress(),
              owner
            );

          await expect(borrowTx)
            .to.emit(contractInstanceWithBorrowLibraryABI, "Borrow")
            .withArgs(
              await dai.getAddress(),
              borrower.address,
              borrower.address,
              expectedBorrowAmount,
              RateMode.Variable,
              expectedReserveDataAfterBorrow.variableBorrowRate
            );

          await expect(borrowTx).to.not.emit(mDAI, "Transfer");

          await expect(borrowTx).to.not.emit(mDAI, "Mint");
        });

        it("Should emit correct events when borrower borrows max possible amount (MaxUint256) and has multiple collateral assets", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            priceOracleAggregator,
            usdc,
            owner,
            borrower,
          } = await loadFixture(depositCollateralInMultipleAssetsFixture);
          // Borrower has 5,000 MELD and 1,000 DAI as collateral
          // Available liquidity is 5,000 USDC deposited by depositor

          // Get reserve data before borrowing
          const reserveDataBeforeBorrow: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          const borrowerAccountDataBefore =
            await lendingPool.getUserAccountData(borrower.address);

          // Instantiate reserve token contracts
          const reserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await usdc.getAddress()
            );

          const mUSDC = await ethers.getContractAt(
            "MToken",
            reserveTokenAddresses.mTokenAddress
          );

          const variableDebtToken = await ethers.getContractAt(
            "VariableDebtToken",
            reserveTokenAddresses.variableDebtTokenAddress
          );

          // Borrower borrows borrows max amount of USDC
          const borrowTx = await lendingPool
            .connect(borrower)
            .borrow(
              await usdc.getAddress(),
              MaxUint256,
              RateMode.Variable,
              borrower.address,
              0
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(borrowTx);

          // User is borrowing the maximum possible amount. User can't borrow more than the LTV amount minus the amount already borrowed
          const expectedBorrowAmountUSD =
            borrowerAccountDataBefore.totalCollateralUSD.percentMul(
              borrowerAccountDataBefore.ltv
            ) - borrowerAccountDataBefore.totalDebtUSD;

          const [currentPrice, oracleSuccess] =
            await priceOracleAggregator.getAssetPrice(await usdc.getAddress());
          expect(oracleSuccess).to.be.true;

          const usdcDecimals = await usdc.decimals();
          const usdcTokenUnit = 10n ** usdcDecimals;

          const expectedBorrowAmount =
            (usdcTokenUnit * expectedBorrowAmountUSD) / currentPrice;

          // Calculate expected reserve data after borrowing
          const expectedReserveDataAfterBorrow: ReserveData =
            calcExpectedReserveDataAfterBorrow(
              expectedBorrowAmount,
              RateMode.Variable,
              reserveDataBeforeBorrow,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          // Check that the correct events were emitted
          await expect(borrowTx)
            .to.emit(variableDebtToken, "Transfer")
            .withArgs(ZeroAddress, borrower.address, expectedBorrowAmount);

          await expect(borrowTx)
            .to.emit(variableDebtToken, "Mint")
            .withArgs(
              borrower.address,
              borrower.address,
              expectedBorrowAmount,
              expectedReserveDataAfterBorrow.variableBorrowIndex
            );

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          await expect(borrowTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await usdc.getAddress(),
              expectedReserveDataAfterBorrow.liquidityRate,
              expectedReserveDataAfterBorrow.stableBorrowRate,
              expectedReserveDataAfterBorrow.variableBorrowRate,
              expectedReserveDataAfterBorrow.liquidityIndex,
              expectedReserveDataAfterBorrow.variableBorrowIndex
            );

          await expect(borrowTx)
            .to.emit(usdc, "Transfer")
            .withArgs(
              await mUSDC.getAddress(),
              borrower.address,
              expectedBorrowAmount
            );

          // The Borrow event is emitted by the BorrowLogic.sol library, so we need to get the contract instance with the BorrowLogic ABI
          const contractInstanceWithBorrowLibraryABI =
            await ethers.getContractAt(
              "BorrowLogic",
              await lendingPool.getAddress(),
              owner
            );

          await expect(borrowTx)
            .to.emit(contractInstanceWithBorrowLibraryABI, "Borrow")
            .withArgs(
              await usdc.getAddress(),
              borrower.address,
              borrower.address,
              expectedBorrowAmount,
              RateMode.Variable,
              expectedReserveDataAfterBorrow.variableBorrowRate
            );

          await expect(borrowTx).to.not.emit(mUSDC, "Transfer");
          await expect(borrowTx).to.not.emit(mUSDC, "Mint");
        });

        it("Should update state correctly when borrower borrows max possible amount (MaxUint256)", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            priceOracleAggregator,
            meld,
            borrower,
            owner,
            depositor,
          } = await loadFixture(depositForMultipleDepositorsFixture);

          // depositor must add some more liquidity to cover this borrow scenario
          const depositAmountMELD = await allocateAndApproveTokens(
            meld,
            owner,
            depositor,
            lendingPool,
            10000n,
            2n
          );

          await lendingPool
            .connect(depositor)
            .deposit(
              await meld.getAddress(),
              depositAmountMELD,
              depositor.address,
              true,
              0
            );

          // Get reserve data before borrowing
          const reserveDataBeforeBorrow: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before borrowing
          const userDataBeforeBorrow: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await meld.getAddress(),
            borrower.address
          );

          const borrowerAccountDataBefore =
            await lendingPool.getUserAccountData(borrower.address);

          const borrowTx = await lendingPool.connect(borrower).borrow(
            await meld.getAddress(),
            MaxUint256, // flag for max amount
            RateMode.Variable,
            borrower.address,
            0
          );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(borrowTx);

          // Get reserve data after borrowing
          const reserveDataAfterBorrow: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data after borrowing
          const userDataAfterBorrow: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await meld.getAddress(),
            borrower.address
          );

          // User is borrowing the maximum possible amount. User can't borrow more than the LTV amount minus the amount already borrowed
          const expectedBorrowAmountUSD =
            borrowerAccountDataBefore.totalCollateralUSD.percentMul(
              borrowerAccountDataBefore.ltv
            ) - borrowerAccountDataBefore.totalDebtUSD;

          const [currentPrice, oracleSuccess] =
            await priceOracleAggregator.getAssetPrice(await meld.getAddress());
          expect(oracleSuccess).to.be.true;

          const meldDecimals = await meld.decimals();
          const meldTokenUnit = 10n ** meldDecimals;

          const expectedBorrowAmount =
            (meldTokenUnit * expectedBorrowAmountUSD) / currentPrice;

          // Calculate expected reserve data after borrowing
          const expectedReserveDataAfterBorrow: ReserveData =
            calcExpectedReserveDataAfterBorrow(
              expectedBorrowAmount,
              RateMode.Variable,
              reserveDataBeforeBorrow,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          // Calculate expected user data after borrowing
          const expectedUserDataAfterBorrow: UserReserveData =
            calcExpectedUserDataAfterBorrow(
              expectedBorrowAmount,
              RateMode.Variable,
              reserveDataBeforeBorrow,
              expectedReserveDataAfterBorrow,
              userDataBeforeBorrow,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          expectEqual(reserveDataAfterBorrow, expectedReserveDataAfterBorrow);
          expectEqual(userDataAfterBorrow, expectedUserDataAfterBorrow);
        });

        it("Should emit correct events when max possible amount based on borrower collateral (MaxUint256) is higher than avaialable liquidity", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            dai,
            owner,
            borrower,
          } = await loadFixture(depositForMultipleDepositorsFixture);
          // Borrower has 20,000 USDC as collateral

          // Get reserve data before borrowing
          const reserveDataBeforeBorrow: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await dai.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Instantiate reserve token contracts
          const reserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await dai.getAddress()
            );

          const mDAI = await ethers.getContractAt(
            "MToken",
            reserveTokenAddresses.mTokenAddress
          );

          const variableDebtToken = await ethers.getContractAt(
            "VariableDebtToken",
            reserveTokenAddresses.variableDebtTokenAddress
          );

          // Borrower borrows borrows max amount of DAI
          const borrowTx = await lendingPool.connect(borrower).borrow(
            await dai.getAddress(),
            MaxUint256, // flag for max amount
            RateMode.Variable,
            borrower.address,
            0
          );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(borrowTx);

          const expectedBorrowAmount =
            reserveDataBeforeBorrow.availableLiquidity;

          // Calculate expected reserve data after borrowing
          const expectedReserveDataAfterBorrow: ReserveData =
            calcExpectedReserveDataAfterBorrow(
              expectedBorrowAmount,
              RateMode.Variable,
              reserveDataBeforeBorrow,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          // Check that the correct events were emitted
          await expect(borrowTx)
            .to.emit(variableDebtToken, "Transfer")
            .withArgs(ZeroAddress, borrower.address, expectedBorrowAmount);

          await expect(borrowTx)
            .to.emit(variableDebtToken, "Mint")
            .withArgs(
              borrower.address,
              borrower.address,
              expectedBorrowAmount,
              expectedReserveDataAfterBorrow.variableBorrowIndex
            );

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          await expect(borrowTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await dai.getAddress(),
              expectedReserveDataAfterBorrow.liquidityRate,
              expectedReserveDataAfterBorrow.stableBorrowRate,
              expectedReserveDataAfterBorrow.variableBorrowRate,
              expectedReserveDataAfterBorrow.liquidityIndex,
              expectedReserveDataAfterBorrow.variableBorrowIndex
            );

          await expect(borrowTx)
            .to.emit(dai, "Transfer")
            .withArgs(
              await mDAI.getAddress(),
              borrower.address,
              expectedBorrowAmount
            );

          // The Borrow event is emitted by the BorrowLogic.sol library, so we need to get the contract instance with the BorrowLogic ABI
          const contractInstanceWithBorrowLibraryABI =
            await ethers.getContractAt(
              "BorrowLogic",
              await lendingPool.getAddress(),
              owner
            );

          await expect(borrowTx)
            .to.emit(contractInstanceWithBorrowLibraryABI, "Borrow")
            .withArgs(
              await dai.getAddress(),
              borrower.address,
              borrower.address,
              expectedBorrowAmount,
              RateMode.Variable,
              expectedReserveDataAfterBorrow.variableBorrowRate
            );

          await expect(borrowTx).to.not.emit(mDAI, "Transfer");

          await expect(borrowTx).to.not.emit(mDAI, "Mint");
        });

        it("Should return the correct value when making a static call", async function () {
          const { lendingPool, meld, borrower } = await loadFixture(
            depositForMultipleDepositorsFixture
          );

          // Borrow MELD from the lending pool
          const amountToBorrow = await convertToCurrencyDecimals(
            await meld.getAddress(),
            "2000"
          );

          const returnedBorrowedAmount = await lendingPool
            .connect(borrower)
            .borrow.staticCall(
              await meld.getAddress(),
              amountToBorrow,
              RateMode.Variable,
              borrower.address,
              0
            );

          expect(returnedBorrowedAmount).to.equal(amountToBorrow);

          // Check that gas can be estimated
          const estimatedGas = await lendingPool
            .connect(borrower)
            .borrow.estimateGas(
              await meld.getAddress(),
              amountToBorrow,
              RateMode.Variable,
              borrower.address,
              0
            );

          expect(estimatedGas).to.be.gt(0);
        });

        it("Should emit correct events when the borrowed token is the same as the collateral token", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            usdc,
            owner,
            borrower,
          } = await loadFixture(depositForMultipleDepositorsFixture);

          // Borrow USDC from the lending pool
          const amountToBorrow = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "10000"
          );

          // Get reserve data before borrowing
          const reserveDataBeforeBorrow: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Instantiate reserve token contracts
          const reserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await usdc.getAddress()
            );

          const mUSDC = await ethers.getContractAt(
            "MToken",
            reserveTokenAddresses.mTokenAddress
          );

          const variableDebtToken = await ethers.getContractAt(
            "VariableDebtToken",
            reserveTokenAddresses.variableDebtTokenAddress
          );

          const borrowTx = await lendingPool
            .connect(borrower)
            .borrow(
              await usdc.getAddress(),
              amountToBorrow,
              RateMode.Variable,
              borrower.address,
              0
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(borrowTx);

          // Calculate expected reserve data after borrowing
          const expectedReserveDataAfterBorrow: ReserveData =
            calcExpectedReserveDataAfterBorrow(
              amountToBorrow,
              RateMode.Variable,
              reserveDataBeforeBorrow,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          // Check that the correct events were emitted
          await expect(borrowTx)
            .to.emit(variableDebtToken, "Transfer")
            .withArgs(ZeroAddress, borrower.address, amountToBorrow);

          await expect(borrowTx)
            .to.emit(variableDebtToken, "Mint")
            .withArgs(
              borrower.address,
              borrower.address,
              amountToBorrow,
              expectedReserveDataAfterBorrow.variableBorrowIndex
            );

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          await expect(borrowTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await usdc.getAddress(),
              expectedReserveDataAfterBorrow.liquidityRate,
              expectedReserveDataAfterBorrow.stableBorrowRate,
              expectedReserveDataAfterBorrow.variableBorrowRate,
              expectedReserveDataAfterBorrow.liquidityIndex,
              expectedReserveDataAfterBorrow.variableBorrowIndex
            );

          await expect(borrowTx)
            .to.emit(usdc, "Transfer")
            .withArgs(
              await mUSDC.getAddress(),
              borrower.address,
              amountToBorrow
            );

          // The Borrow event is emitted by the BorrowLogic.sol library, so we need to get the contract instance with the BorrowLogic ABI
          const contractInstanceWithBorrowLibraryABI =
            await ethers.getContractAt(
              "BorrowLogic",
              await lendingPool.getAddress(),
              owner
            );

          await expect(borrowTx)
            .to.emit(contractInstanceWithBorrowLibraryABI, "Borrow")
            .withArgs(
              await usdc.getAddress(),
              borrower.address,
              borrower.address,
              amountToBorrow,
              RateMode.Variable,
              expectedReserveDataAfterBorrow.variableBorrowRate
            );

          await expect(borrowTx).to.not.emit(mUSDC, "Transfer");

          await expect(borrowTx).to.not.emit(mUSDC, "Mint");
        });

        it("Should update state correctly when the borrowed token is the same as the collateral token", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            usdc,
            borrower,
          } = await loadFixture(depositForMultipleDepositorsFixture);

          // Borrow MELD from the lending pool
          const amountToBorrow = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "10000"
          );

          // Get reserve data before borrowing
          const reserveDataBeforeBorrow: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before borrowing
          const userDataBeforeBorrow: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await usdc.getAddress(),
            borrower.address
          );

          const borrowTx = await lendingPool
            .connect(borrower)
            .borrow(
              await usdc.getAddress(),
              amountToBorrow,
              RateMode.Variable,
              borrower.address,
              0
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(borrowTx);

          // Get reserve data after borrowing
          const reserveDataAfterBorrow: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data after borrowing
          const userDataAfterBorrow: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await usdc.getAddress(),
            borrower.address
          );

          // Calculate expected reserve data after borrowing
          const expectedReserveDataAfterBorrow: ReserveData =
            calcExpectedReserveDataAfterBorrow(
              amountToBorrow,
              RateMode.Variable,
              reserveDataBeforeBorrow,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          // Calculate expected user data after borrowing
          const expectedUserDataAfterBorrow: UserReserveData =
            calcExpectedUserDataAfterBorrow(
              amountToBorrow,
              RateMode.Variable,
              reserveDataBeforeBorrow,
              expectedReserveDataAfterBorrow,
              userDataBeforeBorrow,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          expectEqual(reserveDataAfterBorrow, expectedReserveDataAfterBorrow);
          expectEqual(userDataAfterBorrow, expectedUserDataAfterBorrow);
        });
      }); // End Single Variable Borrow

      context(
        "Multiple borrows of same asset by same borrower",
        async function () {
          context("Multiple Stable Borrows", async function () {
            it("Should emit correct events when reserve factor == 0", async function () {
              const {
                lendingPool,
                meldProtocolDataProvider,
                lendingRateOracleAggregator,
                meld,
                owner,
                borrower,
              } = await loadFixture(depositForMultipleDepositorsFixture);

              // First - Borrow MELD from the lending pool
              const amountToBorrow = await convertToCurrencyDecimals(
                await meld.getAddress(),
                "2000"
              );

              await lendingPool
                .connect(borrower)
                .borrow(
                  await meld.getAddress(),
                  amountToBorrow,
                  RateMode.Stable,
                  borrower.address,
                  0
                );

              // Get reserve data before borrow 2
              const reserveDataBeforeBorrow: ReserveData = await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

              // Get user reserve data before borrow 2
              const userDataBeforeBorrow: UserReserveData = await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await meld.getAddress(),
                borrower.address
              );

              // Instantiate reserve token contracts
              const reserveTokenAddresses =
                await meldProtocolDataProvider.getReserveTokensAddresses(
                  await meld.getAddress()
                );

              const mMELD = await ethers.getContractAt(
                "MToken",
                reserveTokenAddresses.mTokenAddress
              );

              const stableDebtToken = await ethers.getContractAt(
                "StableDebtToken",
                reserveTokenAddresses.stableDebtTokenAddress
              );

              // Add time between borrows
              await time.increase(ONE_YEAR / 12);

              // Second - Borrow MELD from the lending pool again
              const amountToBorrow2 = await convertToCurrencyDecimals(
                await meld.getAddress(),
                "1000"
              );

              const borrowTx = await lendingPool
                .connect(borrower)
                .borrow(
                  await meld.getAddress(),
                  amountToBorrow2,
                  RateMode.Stable,
                  borrower.address,
                  0
                );

              const blockTimestamps: BlockTimestamps =
                await getBlockTimestamps(borrowTx);

              // Calculate expected reserve data after borrow 2
              const expectedReserveDataAfterBorrow: ReserveData =
                calcExpectedReserveDataAfterBorrow(
                  amountToBorrow2,
                  RateMode.Stable,
                  reserveDataBeforeBorrow,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              // Calculate expected user data after borrow 2
              const expectedUserDataAfterBorrow: UserReserveData =
                calcExpectedUserDataAfterBorrow(
                  amountToBorrow2,
                  RateMode.Stable,
                  reserveDataBeforeBorrow,
                  expectedReserveDataAfterBorrow,
                  userDataBeforeBorrow,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              const expectedAccumulatedInterest = calcCompoundedInterest(
                userDataBeforeBorrow.stableBorrowRate,
                blockTimestamps.latestBlockTimestamp,
                userDataBeforeBorrow.stableRateLastUpdated
              );

              const expectedCurrentBalance =
                userDataBeforeBorrow.principalStableDebt.rayMul(
                  expectedAccumulatedInterest
                );
              const expectedIncrease =
                expectedCurrentBalance -
                userDataBeforeBorrow.principalStableDebt;

              // Check that the correct events were emitted
              await expect(borrowTx)
                .to.emit(stableDebtToken, "Transfer")
                .withArgs(ZeroAddress, borrower.address, amountToBorrow2);

              await expect(borrowTx)
                .to.emit(stableDebtToken, "Mint")
                .withArgs(
                  borrower.address,
                  borrower.address,
                  amountToBorrow2,
                  expectedCurrentBalance,
                  expectedIncrease,
                  expectedUserDataAfterBorrow.stableBorrowRate,
                  expectedReserveDataAfterBorrow.averageStableBorrowRate,
                  expectedReserveDataAfterBorrow.totalStableDebt
                );

              // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
              const contractInstanceWithLibraryABI = await ethers.getContractAt(
                "ReserveLogic",
                await lendingPool.getAddress(),
                owner
              );

              await expect(borrowTx)
                .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
                .withArgs(
                  await meld.getAddress(),
                  expectedReserveDataAfterBorrow.liquidityRate,
                  expectedReserveDataAfterBorrow.stableBorrowRate,
                  isAlmostEqual(
                    expectedReserveDataAfterBorrow.variableBorrowRate
                  ),
                  expectedReserveDataAfterBorrow.liquidityIndex,
                  expectedReserveDataAfterBorrow.variableBorrowIndex
                );

              await expect(borrowTx)
                .to.emit(meld, "Transfer")
                .withArgs(
                  await mMELD.getAddress(),
                  borrower.address,
                  amountToBorrow2
                );

              // The Borrow event is emitted by the BorrowLogic.sol library, so we need to get the contract instance with the BorrowLogic ABI
              const contractInstanceWithBorrowLibraryABI =
                await ethers.getContractAt(
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
                  amountToBorrow2,
                  RateMode.Stable,
                  reserveDataBeforeBorrow.stableBorrowRate // The stable borrow rate emitted is the rate before updatInterestRates() is called
                );

              await expect(borrowTx).to.not.emit(mMELD, "Transfer");
              await expect(borrowTx).to.not.emit(mMELD, "Mint");
            });

            it("Should emit correct events when reserve factor > 0 and amountToMint == 0", async function () {
              const {
                lendingPool,
                meldProtocolDataProvider,
                lendingRateOracleAggregator,
                tether,
                owner,
                borrower,
              } = await loadFixture(depositForMultipleDepositorsFixture);

              // First - Borrow USDT from the lending pool
              const amountToBorrow = await convertToCurrencyDecimals(
                await tether.getAddress(),
                "1250"
              );

              // Instantiate reserve token contracts
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

              await lendingPool
                .connect(borrower)
                .borrow(
                  await tether.getAddress(),
                  amountToBorrow,
                  RateMode.Stable,
                  borrower.address,
                  0
                );

              // Second - Borrow USDT from the lending pool
              const amountToBorrow2 = await convertToCurrencyDecimals(
                await tether.getAddress(),
                "500"
              );

              // Get reserve data before borrow 2
              const reserveDataBeforeBorrow: ReserveData = await getReserveData(
                meldProtocolDataProvider,
                await tether.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

              // Get user reserve data before borrow 2
              const userDataBeforeBorrow: UserReserveData = await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await tether.getAddress(),
                borrower.address
              );

              const borrowTx = await lendingPool
                .connect(borrower)
                .borrow(
                  await tether.getAddress(),
                  amountToBorrow2,
                  RateMode.Stable,
                  borrower.address,
                  0
                );

              const blockTimestamps: BlockTimestamps =
                await getBlockTimestamps(borrowTx);

              // Calculate expected reserve data after borrow 2
              const expectedReserveDataAfterBorrow: ReserveData =
                calcExpectedReserveDataAfterBorrow(
                  amountToBorrow2,
                  RateMode.Stable,
                  reserveDataBeforeBorrow,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              // Calculate expected user data after borrow 2
              const expectedUserDataAfterBorrow: UserReserveData =
                calcExpectedUserDataAfterBorrow(
                  amountToBorrow2,
                  RateMode.Stable,
                  reserveDataBeforeBorrow,
                  expectedReserveDataAfterBorrow,
                  userDataBeforeBorrow,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              const expectedAccumulatedInterest = calcCompoundedInterest(
                userDataBeforeBorrow.stableBorrowRate,
                blockTimestamps.latestBlockTimestamp,
                userDataBeforeBorrow.stableRateLastUpdated
              );

              const expectedCurrentBalance =
                userDataBeforeBorrow.principalStableDebt.rayMul(
                  expectedAccumulatedInterest
                );
              const expectedIncrease =
                expectedCurrentBalance -
                userDataBeforeBorrow.principalStableDebt;

              // Check that the correct events were emitted
              await expect(borrowTx)
                .to.emit(stableDebtToken, "Transfer")
                .withArgs(ZeroAddress, borrower.address, amountToBorrow2);

              await expect(borrowTx)
                .to.emit(stableDebtToken, "Mint")
                .withArgs(
                  borrower.address,
                  borrower.address,
                  amountToBorrow2,
                  expectedCurrentBalance,
                  expectedIncrease,
                  expectedUserDataAfterBorrow.stableBorrowRate,
                  expectedReserveDataAfterBorrow.averageStableBorrowRate,
                  expectedReserveDataAfterBorrow.totalStableDebt
                );

              // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
              const contractInstanceWithLibraryABI = await ethers.getContractAt(
                "ReserveLogic",
                await lendingPool.getAddress(),
                owner
              );

              await expect(borrowTx)
                .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
                .withArgs(
                  await tether.getAddress(),
                  expectedReserveDataAfterBorrow.liquidityRate,
                  expectedReserveDataAfterBorrow.stableBorrowRate,
                  expectedReserveDataAfterBorrow.variableBorrowRate,
                  expectedReserveDataAfterBorrow.liquidityIndex,
                  expectedReserveDataAfterBorrow.variableBorrowIndex
                );

              await expect(borrowTx)
                .to.emit(tether, "Transfer")
                .withArgs(
                  await mUSDT.getAddress(),
                  borrower.address,
                  amountToBorrow2
                );

              // The Borrow event is emitted by the BorrowLogic.sol library, so we need to get the contract instance with the BorrowLogic ABI
              const contractInstanceWithBorrowLibraryABI =
                await ethers.getContractAt(
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
                  amountToBorrow2,
                  RateMode.Stable,
                  reserveDataBeforeBorrow.stableBorrowRate // The stable borrow rate emitted is the rate before updatInterestRates() is called
                );

              await expect(borrowTx).to.not.emit(mUSDT, "Transfer");
              await expect(borrowTx).to.not.emit(mUSDT, "Mint");
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
              } = await loadFixture(depositForMultipleDepositorsFixture);

              // First - Borrow USDT from the lending pool
              const amountToBorrow = await convertToCurrencyDecimals(
                await tether.getAddress(),
                "1250"
              );

              // Instantiate reserve token contracts
              const reserveTokenAddresses =
                await meldProtocolDataProvider.getReserveTokensAddresses(
                  await tether.getAddress()
                );

              const mUSDT = (await ethers.getContractAt(
                "MToken",
                reserveTokenAddresses.mTokenAddress
              )) as MToken & Contract;

              const stableDebtToken = await ethers.getContractAt(
                "StableDebtToken",
                reserveTokenAddresses.stableDebtTokenAddress
              );

              await lendingPool
                .connect(borrower)
                .borrow(
                  await tether.getAddress(),
                  amountToBorrow,
                  RateMode.Stable,
                  borrower.address,
                  0
                );

              // Second - Borrow USDT from the lending pool
              const amountToBorrow2 = await convertToCurrencyDecimals(
                await tether.getAddress(),
                "500"
              );

              // Simulate time passing so that ReserveLogic._mintToTreasury amountToMint > 0
              await time.increase(ONE_YEAR);

              // Get reserve data before borrow 2
              const reserveDataBeforeBorrow: ReserveData = await getReserveData(
                meldProtocolDataProvider,
                await tether.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

              // Get user reserve data before borrow 2
              const userDataBeforeBorrow: UserReserveData = await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await tether.getAddress(),
                borrower.address
              );

              const borrowTx = await lendingPool
                .connect(borrower)
                .borrow(
                  await tether.getAddress(),
                  amountToBorrow2,
                  RateMode.Stable,
                  borrower.address,
                  0
                );

              const blockTimestamps: BlockTimestamps =
                await getBlockTimestamps(borrowTx);

              // Calculate expected reserve data after borrow 2
              const expectedReserveDataAfterBorrow: ReserveData =
                calcExpectedReserveDataAfterBorrow(
                  amountToBorrow2,
                  RateMode.Stable,
                  reserveDataBeforeBorrow,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              // Calculate expected user data after borrow 2
              const expectedUserDataAfterBorrow: UserReserveData =
                calcExpectedUserDataAfterBorrow(
                  amountToBorrow2,
                  RateMode.Stable,
                  reserveDataBeforeBorrow,
                  expectedReserveDataAfterBorrow,
                  userDataBeforeBorrow,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              const expectedAccumulatedInterest = calcCompoundedInterest(
                userDataBeforeBorrow.stableBorrowRate,
                blockTimestamps.latestBlockTimestamp,
                userDataBeforeBorrow.stableRateLastUpdated
              );

              const expectedCurrentBalance =
                userDataBeforeBorrow.principalStableDebt.rayMul(
                  expectedAccumulatedInterest
                );
              const expectedIncrease =
                expectedCurrentBalance -
                userDataBeforeBorrow.principalStableDebt;

              // Check that the correct events were emitted
              await expect(borrowTx)
                .to.emit(stableDebtToken, "Transfer")
                .withArgs(ZeroAddress, borrower.address, amountToBorrow2);

              await expect(borrowTx)
                .to.emit(stableDebtToken, "Mint")
                .withArgs(
                  borrower.address,
                  borrower.address,
                  amountToBorrow2,
                  expectedCurrentBalance,
                  expectedIncrease,
                  expectedUserDataAfterBorrow.stableBorrowRate,
                  expectedReserveDataAfterBorrow.averageStableBorrowRate,
                  expectedReserveDataAfterBorrow.totalStableDebt
                );

              // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
              const contractInstanceWithLibraryABI =
                (await ethers.getContractAt(
                  "ReserveLogic",
                  await lendingPool.getAddress(),
                  owner
                )) as ReserveLogic & Contract;

              await expect(borrowTx)
                .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
                .withArgs(
                  await tether.getAddress(),
                  expectedReserveDataAfterBorrow.liquidityRate,
                  expectedReserveDataAfterBorrow.stableBorrowRate,
                  isAlmostEqual(
                    expectedReserveDataAfterBorrow.variableBorrowRate
                  ),
                  expectedReserveDataAfterBorrow.liquidityIndex,
                  expectedReserveDataAfterBorrow.variableBorrowIndex
                );

              await expect(borrowTx)
                .to.emit(tether, "Transfer")
                .withArgs(
                  await mUSDT.getAddress(),
                  borrower.address,
                  amountToBorrow2
                );

              // The Borrow event is emitted by the BorrowLogic.sol library, so we need to get the contract instance with the BorrowLogic ABI
              const contractInstanceWithBorrowLibraryABI =
                await ethers.getContractAt(
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
                  amountToBorrow2,
                  RateMode.Stable,
                  reserveDataBeforeBorrow.stableBorrowRate // The stable borrow rate emitted is the rate before updatInterestRates() is called
                );

              const currentVariableDebt = BigInt(0);
              const previousVariableDebt = BigInt(0);
              const currentStableDebt = BigInt(
                reserveDataBeforeBorrow.totalStableDebt
              ); // The mint to treasury happens before debt token minting
              const previousStableDebt = BigInt(amountToBorrow); // This is the amount borrowed in the first borrow transaction

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

              await expect(borrowTx)
                .to.emit(mUSDT, "Transfer")
                .withArgs(
                  ZeroAddress,
                  treasury.address,
                  isAlmostEqual(amountToMint)
                );

              await expect(borrowTx)
                .to.emit(mUSDT, "Mint")
                .withArgs(
                  treasury.address,
                  isAlmostEqual(amountToMint),
                  expectedReserveDataAfterBorrow.liquidityIndex
                );
            });

            it("Should update state correctly", async function () {
              const {
                lendingPool,
                meldProtocolDataProvider,
                lendingRateOracleAggregator,
                meld,
                borrower,
              } = await loadFixture(depositForMultipleDepositorsFixture);

              // First - Borrow MELD from the lending pool
              const amountToBorrow = await convertToCurrencyDecimals(
                await meld.getAddress(),
                "2000"
              );

              await lendingPool
                .connect(borrower)
                .borrow(
                  await meld.getAddress(),
                  amountToBorrow,
                  RateMode.Stable,
                  borrower.address,
                  0
                );

              // Get reserve data before borrow 2
              const reserveDataBeforeBorrow: ReserveData = await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

              // Get user reserve data before borrow 2
              const userDataBeforeBorrow: UserReserveData = await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await meld.getAddress(),
                borrower.address
              );

              await mine(100);

              // Second - Borrow MELD from the lending pool
              const amountToBorrow2 = await convertToCurrencyDecimals(
                await meld.getAddress(),
                "1000"
              );

              const borrowTx = await lendingPool
                .connect(borrower)
                .borrow(
                  await meld.getAddress(),
                  amountToBorrow2,
                  RateMode.Stable,
                  borrower.address,
                  0
                );

              const blockTimestamps: BlockTimestamps =
                await getBlockTimestamps(borrowTx);

              // Get reserve data after borrow 2
              const reserveDataAfterBorrow: ReserveData = await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

              // Get user reserve data after borrow 2
              const userDataAfterBorrow: UserReserveData = await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await meld.getAddress(),
                borrower.address
              );

              // Calculate expected reserve data after borrow 2
              const expectedReserveDataAfterBorrow: ReserveData =
                calcExpectedReserveDataAfterBorrow(
                  amountToBorrow2,
                  RateMode.Stable,
                  reserveDataBeforeBorrow,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              // Calculate expected user data after borrow 2
              const expectedUserDataAfterBorrow: UserReserveData =
                calcExpectedUserDataAfterBorrow(
                  amountToBorrow2,
                  RateMode.Stable,
                  reserveDataBeforeBorrow,
                  expectedReserveDataAfterBorrow,
                  userDataBeforeBorrow,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              expectEqual(
                reserveDataAfterBorrow,
                expectedReserveDataAfterBorrow
              );
              expectEqual(userDataAfterBorrow, expectedUserDataAfterBorrow);
            });

            it("Should update token balances correctly when 'onBehalfOf' address is same as borrower", async function () {
              const {
                lendingPool,
                meldProtocolDataProvider,
                lendingRateOracleAggregator,
                meld,
                usdc,
                borrower,
              } = await loadFixture(depositForMultipleDepositorsFixture);

              // First - Borrow MELD from the lending pool
              const amountToBorrow = await convertToCurrencyDecimals(
                await meld.getAddress(),
                "2500"
              );

              // Instantiate reserve token contracts
              const reserveTokenAddressesMELD =
                await meldProtocolDataProvider.getReserveTokensAddresses(
                  await meld.getAddress()
                );

              const mMELD = await ethers.getContractAt(
                "MToken",
                reserveTokenAddressesMELD.mTokenAddress
              );

              const stableDebtToken = await ethers.getContractAt(
                "StableDebtToken",
                reserveTokenAddressesMELD.stableDebtTokenAddress
              );

              const variableDebtToken = await ethers.getContractAt(
                "VariableDebtToken",
                reserveTokenAddressesMELD.variableDebtTokenAddress
              );

              const reserveTokenAddressesUSDC =
                await meldProtocolDataProvider.getReserveTokensAddresses(
                  await usdc.getAddress()
                );
              const mUSDC = await ethers.getContractAt(
                "MToken",
                reserveTokenAddressesUSDC.mTokenAddress
              );

              await lendingPool
                .connect(borrower)
                .borrow(
                  await meld.getAddress(),
                  amountToBorrow,
                  RateMode.Stable,
                  borrower.address,
                  0
                );

              await mine(200);

              const mUSDCBalanceBefore = await mUSDC.balanceOf(borrower);

              // Get reserve data before borrow 2
              const reserveDataBeforeBorrow: ReserveData = await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

              // Get user reserve data before borrow 2
              const userDataBeforeBorrow: UserReserveData = await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await meld.getAddress(),
                borrower.address
              );

              // Second - Borrow MELD from the lending pool
              const amountToBorrow2 = await convertToCurrencyDecimals(
                await meld.getAddress(),
                "1875"
              );

              const borrowTx = await lendingPool
                .connect(borrower)
                .borrow(
                  await meld.getAddress(),
                  amountToBorrow2,
                  RateMode.Stable,
                  borrower.address,
                  0
                );

              const blockTimestamps: BlockTimestamps =
                await getBlockTimestamps(borrowTx);

              // Calculate expected reserve data after borrow 2
              const expectedReserveDataAfterBorrow: ReserveData =
                calcExpectedReserveDataAfterBorrow(
                  amountToBorrow2,
                  RateMode.Stable,
                  reserveDataBeforeBorrow,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              // Calculate expected user data after borrow 2
              const expectedUserDataAfterBorrow: UserReserveData =
                calcExpectedUserDataAfterBorrow(
                  amountToBorrow2,
                  RateMode.Stable,
                  reserveDataBeforeBorrow,
                  expectedReserveDataAfterBorrow,
                  userDataBeforeBorrow,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              const { 0: principalSupply, 1: totalSupply } =
                await stableDebtToken.getSupplyData();

              // Check token balances
              expect(
                await stableDebtToken.balanceOf(borrower.address)
              ).to.equal(expectedUserDataAfterBorrow.currentStableDebt);

              expect(
                await stableDebtToken.principalBalanceOf(borrower.address)
              ).to.equal(expectedUserDataAfterBorrow.currentStableDebt);

              expect(
                await variableDebtToken.balanceOf(borrower.address)
              ).to.equal(0n);

              // Check stable debt principal and total supply
              expect(principalSupply).to.equal(
                expectedReserveDataAfterBorrow.principalStableDebt
              );

              expect(totalSupply).to.equal(
                expectedReserveDataAfterBorrow.totalStableDebt
              );

              // Borrower didn't deposit MELD as collateral, so no change in mMELD balance.
              // Borrower deposited USDC as collateral, but mUSDC balance should not change. No collateral is transferred during borrow.
              expect(await mMELD.balanceOf(borrower.address)).to.equal(0);
              expect(await mUSDC.balanceOf(borrower.address)).to.equal(
                mUSDCBalanceBefore
              );

              // Borrower should have tokens borrowed
              expect(await meld.balanceOf(borrower.address)).to.equal(
                amountToBorrow + amountToBorrow2
              );
            });

            it("Should not allow regular user to get yield boost if yield boost is disabled for a yield boost token after first borrow", async function () {
              const {
                lendingPool,
                meldProtocolDataProvider,
                lendingRateOracleAggregator,
                lendingPoolConfigurator,
                usdc,
                depositor,
                poolAdmin,
                yieldBoostStorageUSDC,
              } = await loadFixture(depositForMultipleDepositorsFixture);

              // Depositor of MELD decides to borrow USDC
              const borrower = depositor;

              // Set regular user yield boost multiplier to 1% (from 0)
              const newYieldBoostMultiplier = 1_00;

              await lendingPool
                .connect(poolAdmin)
                .setYieldBoostMultiplier(
                  usdc,
                  MeldBankerType.NONE,
                  Action.BORROW,
                  newYieldBoostMultiplier
                );
              expect(
                await lendingPool.yieldBoostMultipliers(
                  MeldBankerType.NONE,
                  Action.BORROW
                )
              ).to.equal(newYieldBoostMultiplier);

              // Borrow USDC from the lending pool
              const amountToBorrow = await convertToCurrencyDecimals(
                await usdc.getAddress(),
                "2000"
              );

              // Get reserve data before borrowing
              const reserveDataBeforeBorrow: ReserveData = await getReserveData(
                meldProtocolDataProvider,
                await usdc.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

              // Get user reserve data before borrowing
              const userDataBeforeBorrow: UserReserveData = await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await usdc.getAddress(),
                borrower.address
              );

              const borrowTx = await lendingPool
                .connect(borrower)
                .borrow(
                  await usdc.getAddress(),
                  amountToBorrow,
                  RateMode.Stable,
                  borrower.address,
                  0n
                );

              const blockTimestamps: BlockTimestamps =
                await getBlockTimestamps(borrowTx);

              // Get reserve data after borrowing
              const reserveDataAfterBorrow: ReserveData = await getReserveData(
                meldProtocolDataProvider,
                await usdc.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

              // Get user reserve data after borrowing
              const userDataAfterBorrow: UserReserveData = await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await usdc.getAddress(),
                borrower.address
              );

              // Calculate expected reserve data after borrowing
              const expectedReserveDataAfterBorrow: ReserveData =
                calcExpectedReserveDataAfterBorrow(
                  amountToBorrow,
                  RateMode.Stable,
                  reserveDataBeforeBorrow,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              // Calculate expected user data after borrowing
              const expectedUserDataAfterBorrow: UserReserveData =
                calcExpectedUserDataAfterBorrow(
                  amountToBorrow,
                  RateMode.Stable,
                  reserveDataBeforeBorrow,
                  expectedReserveDataAfterBorrow,
                  userDataBeforeBorrow,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              expectEqual(
                reserveDataAfterBorrow,
                expectedReserveDataAfterBorrow
              );
              expectEqual(userDataAfterBorrow, expectedUserDataAfterBorrow);

              expect(await lendingPool.isUsingMeldBanker(depositor.address)).to
                .be.false;
              expect(await lendingPool.isMeldBankerBlocked(0n)).to.be.false;

              const meldBankerData = await lendingPool.userMeldBankerData(
                borrower.address
              );
              expect(meldBankerData.tokenId).to.equal(0);
              expect(meldBankerData.asset).to.equal(ZeroAddress);
              expect(meldBankerData.meldBankerType).to.equal(
                MeldBankerType.NONE
              );
              expect(meldBankerData.action).to.equal(Action.NONE);

              const yieldBoostMultiplierUSDC =
                await lendingPool.yieldBoostMultipliers(
                  MeldBankerType.NONE,
                  Action.BORROW
                );

              const expectedStakedAmountUSDC = amountToBorrow.percentMul(
                yieldBoostMultiplierUSDC
              );

              expect(
                await yieldBoostStorageUSDC.getStakerStakedAmount(
                  borrower.address
                )
              ).to.equal(expectedStakedAmountUSDC);

              // Disable yield boost for USDC
              await lendingPoolConfigurator
                .connect(poolAdmin)
                .setYieldBoostStakingAddress(
                  await usdc.getAddress(),
                  ZeroAddress
                );

              // Borrower borrows more USDC but gets no yield boost
              const amountToBorrow2 = await convertToCurrencyDecimals(
                await usdc.getAddress(),
                "1000"
              );

              await lendingPool
                .connect(borrower)
                .borrow(
                  await usdc.getAddress(),
                  amountToBorrow2,
                  RateMode.Stable,
                  borrower.address,
                  0n
                );

              // Stake should be the same as after the first borrow because no new amount was staked for second borrow
              expect(
                await yieldBoostStorageUSDC.getStakerStakedAmount(
                  borrower.address
                )
              ).to.equal(expectedStakedAmountUSDC);
            });
          }); // End Multiple Stable Borrows

          context("Multiple Variable Borrows", async function () {
            it("Should emit correct events when reserve factor == 0", async function () {
              const {
                lendingPool,
                meldProtocolDataProvider,
                lendingRateOracleAggregator,
                meld,
                owner,
                borrower,
              } = await loadFixture(depositForMultipleDepositorsFixture);

              // First - Borrow MELD from the lending pool
              const amountToBorrow = await convertToCurrencyDecimals(
                await meld.getAddress(),
                "2000"
              );

              await lendingPool
                .connect(borrower)
                .borrow(
                  await meld.getAddress(),
                  amountToBorrow,
                  RateMode.Variable,
                  borrower.address,
                  0
                );

              // Instantiate reserve token contracts
              const reserveTokenAddresses =
                await meldProtocolDataProvider.getReserveTokensAddresses(
                  await meld.getAddress()
                );

              const mMELD = await ethers.getContractAt(
                "MToken",
                reserveTokenAddresses.mTokenAddress
              );

              const variableDebtToken = await ethers.getContractAt(
                "VariableDebtToken",
                reserveTokenAddresses.variableDebtTokenAddress
              );

              // Add time between borrows
              await time.increase(ONE_YEAR / 2);

              // Get reserve data before borrow 2
              const reserveDataBeforeBorrow: ReserveData = await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

              // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
              time.setNextBlockTimestamp(await time.latest());

              // Second - Borrow MELD from the lending pool
              const amountToBorrow2 = await convertToCurrencyDecimals(
                await meld.getAddress(),
                "1000"
              );

              const borrowTx = await lendingPool
                .connect(borrower)
                .borrow(
                  await meld.getAddress(),
                  amountToBorrow2,
                  RateMode.Variable,
                  borrower.address,
                  0
                );

              const blockTimestamps: BlockTimestamps =
                await getBlockTimestamps(borrowTx);

              // Calculate expected reserve data after borrowing
              const expectedReserveDataAfterBorrow: ReserveData =
                calcExpectedReserveDataAfterBorrow(
                  amountToBorrow2,
                  RateMode.Variable,
                  reserveDataBeforeBorrow,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              // Check that the correct events were emitted
              await expect(borrowTx)
                .to.emit(variableDebtToken, "Transfer")
                .withArgs(ZeroAddress, borrower.address, amountToBorrow2);

              await expect(borrowTx)
                .to.emit(variableDebtToken, "Mint")
                .withArgs(
                  borrower.address,
                  borrower.address,
                  amountToBorrow2,
                  expectedReserveDataAfterBorrow.variableBorrowIndex
                );

              // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
              const contractInstanceWithLibraryABI = await ethers.getContractAt(
                "ReserveLogic",
                await lendingPool.getAddress(),
                owner
              );

              await expect(borrowTx)
                .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
                .withArgs(
                  await meld.getAddress(),
                  expectedReserveDataAfterBorrow.liquidityRate,
                  isAlmostEqual(
                    expectedReserveDataAfterBorrow.stableBorrowRate
                  ),
                  isAlmostEqual(
                    expectedReserveDataAfterBorrow.variableBorrowRate
                  ),
                  expectedReserveDataAfterBorrow.liquidityIndex,
                  expectedReserveDataAfterBorrow.variableBorrowIndex
                );

              await expect(borrowTx)
                .to.emit(meld, "Transfer")
                .withArgs(
                  await mMELD.getAddress(),
                  borrower.address,
                  amountToBorrow2
                );

              // The Borrow event is emitted by the BorrowLogic.sol library, so we need to get the contract instance with the BorrowLogic ABI
              const contractInstanceWithBorrowLibraryABI =
                await ethers.getContractAt(
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
                  amountToBorrow2,
                  RateMode.Variable,
                  isAlmostEqual(
                    expectedReserveDataAfterBorrow.variableBorrowRate
                  )
                );

              await expect(borrowTx).to.not.emit(mMELD, "Transfer");
              await expect(borrowTx).to.not.emit(mMELD, "Mint");
            });

            it("Should emit correct events when reserve factor > 0 and amountToMint == 0", async function () {
              const {
                lendingPool,
                meldProtocolDataProvider,
                lendingRateOracleAggregator,
                tether,
                owner,
                borrower,
              } = await loadFixture(depositForMultipleDepositorsFixture);

              // First - Borrow USDT from the lending pool
              const amountToBorrow = await convertToCurrencyDecimals(
                await tether.getAddress(),
                "1250"
              );

              // Instantiate reserve token contracts
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

              await lendingPool
                .connect(borrower)
                .borrow(
                  await tether.getAddress(),
                  amountToBorrow,
                  RateMode.Variable,
                  borrower.address,
                  0
                );

              // Second - Borrow USDT from the lending pool
              const amountToBorrow2 = await convertToCurrencyDecimals(
                await tether.getAddress(),
                "500"
              );

              // Get reserve data before borrow2
              const reserveDataBeforeBorrow: ReserveData = await getReserveData(
                meldProtocolDataProvider,
                await tether.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

              await mine();

              const borrowTx = await lendingPool
                .connect(borrower)
                .borrow(
                  await tether.getAddress(),
                  amountToBorrow2,
                  RateMode.Variable,
                  borrower.address,
                  0
                );

              const blockTimestamps: BlockTimestamps =
                await getBlockTimestamps(borrowTx);

              // Calculate expected reserve data after borrow 2
              const expectedReserveDataAfterBorrow: ReserveData =
                calcExpectedReserveDataAfterBorrow(
                  amountToBorrow2,
                  RateMode.Variable,
                  reserveDataBeforeBorrow,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              // Check that the correct events were emitted
              await expect(borrowTx)
                .to.emit(variableDebtToken, "Transfer")
                .withArgs(ZeroAddress, borrower.address, amountToBorrow2);

              await expect(borrowTx)
                .to.emit(variableDebtToken, "Mint")
                .withArgs(
                  borrower.address,
                  borrower.address,
                  amountToBorrow2,
                  expectedReserveDataAfterBorrow.variableBorrowIndex
                );

              // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
              const contractInstanceWithLibraryABI = await ethers.getContractAt(
                "ReserveLogic",
                await lendingPool.getAddress(),
                owner
              );

              await expect(borrowTx)
                .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
                .withArgs(
                  await tether.getAddress(),
                  expectedReserveDataAfterBorrow.liquidityRate,
                  expectedReserveDataAfterBorrow.stableBorrowRate,
                  expectedReserveDataAfterBorrow.variableBorrowRate,
                  expectedReserveDataAfterBorrow.liquidityIndex,
                  expectedReserveDataAfterBorrow.variableBorrowIndex
                );

              await expect(borrowTx)
                .to.emit(tether, "Transfer")
                .withArgs(
                  await mUSDT.getAddress(),
                  borrower.address,
                  amountToBorrow2
                );

              // The Borrow event is emitted by the BorrowLogic.sol library, so we need to get the contract instance with the BorrowLogic ABI
              const contractInstanceWithBorrowLibraryABI =
                await ethers.getContractAt(
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
                  amountToBorrow2,
                  RateMode.Variable,
                  expectedReserveDataAfterBorrow.variableBorrowRate
                );

              await expect(borrowTx).to.not.emit(mUSDT, "Transfer");
              await expect(borrowTx).to.not.emit(mUSDT, "Mint");
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
              } = await loadFixture(depositForMultipleDepositorsFixture);

              // First - Borrow USDT from the lending pool
              const amountToBorrow = await convertToCurrencyDecimals(
                await tether.getAddress(),
                "1250"
              );

              // Instantiate reserve token contracts
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

              await lendingPool
                .connect(borrower)
                .borrow(
                  await tether.getAddress(),
                  amountToBorrow,
                  RateMode.Variable,
                  borrower.address,
                  0
                );

              // Second - Borrow USDT from the lending pool
              const amountToBorrow2 = await convertToCurrencyDecimals(
                await tether.getAddress(),
                "500"
              );

              // Simulate time passing so that ReserveLogic._mintToTreasury amountToMint > 0
              await time.increase(ONE_YEAR);

              // Get reserve data before borrow 2
              const reserveDataBeforeBorrow: ReserveData = await getReserveData(
                meldProtocolDataProvider,
                await tether.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

              const borrowTx = await lendingPool
                .connect(borrower)
                .borrow(
                  await tether.getAddress(),
                  amountToBorrow2,
                  RateMode.Variable,
                  borrower.address,
                  0
                );

              const blockTimestamps: BlockTimestamps =
                await getBlockTimestamps(borrowTx);

              // Calculate expected reserve data after borrow 2
              const expectedReserveDataAfterBorrow: ReserveData =
                calcExpectedReserveDataAfterBorrow(
                  amountToBorrow2,
                  RateMode.Variable,
                  reserveDataBeforeBorrow,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              // Check that the correct events were emitted
              await expect(borrowTx)
                .to.emit(variableDebtToken, "Transfer")
                .withArgs(ZeroAddress, borrower.address, amountToBorrow2);

              await expect(borrowTx)
                .to.emit(variableDebtToken, "Mint")
                .withArgs(
                  borrower.address,
                  borrower.address,
                  amountToBorrow2,
                  expectedReserveDataAfterBorrow.variableBorrowIndex
                );

              // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
              const contractInstanceWithLibraryABI = await ethers.getContractAt(
                "ReserveLogic",
                await lendingPool.getAddress(),
                owner
              );

              await expect(borrowTx)
                .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
                .withArgs(
                  await tether.getAddress(),
                  expectedReserveDataAfterBorrow.liquidityRate,
                  expectedReserveDataAfterBorrow.stableBorrowRate,
                  expectedReserveDataAfterBorrow.variableBorrowRate,
                  expectedReserveDataAfterBorrow.liquidityIndex,
                  expectedReserveDataAfterBorrow.variableBorrowIndex
                );

              await expect(borrowTx)
                .to.emit(tether, "Transfer")
                .withArgs(
                  await mUSDT.getAddress(),
                  borrower.address,
                  amountToBorrow2
                );

              // The Borrow event is emitted by the BorrowLogic.sol library, so we need to get the contract instance with the BorrowLogic ABI
              const contractInstanceWithBorrowLibraryABI =
                await ethers.getContractAt(
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
                  amountToBorrow2,
                  RateMode.Variable,
                  expectedReserveDataAfterBorrow.variableBorrowRate
                );

              const currentVariableDebt = BigInt(
                reserveDataBeforeBorrow.totalVariableDebt
              ); // The mint to treasury happens before debt token minting
              const previousVariableDebt = BigInt(amountToBorrow); // This is the amount borrowed in the first borrow transaction
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

              await expect(borrowTx)
                .to.emit(mUSDT, "Transfer")
                .withArgs(ZeroAddress, treasury.address, amountToMint);

              await expect(borrowTx)
                .to.emit(mUSDT, "Mint")
                .withArgs(
                  treasury.address,
                  isAlmostEqual(amountToMint),
                  expectedReserveDataAfterBorrow.liquidityIndex
                );
            });
            it("Should update state correctly", async function () {
              const {
                lendingPool,
                meldProtocolDataProvider,
                lendingRateOracleAggregator,
                meld,
                borrower,
              } = await loadFixture(depositForMultipleDepositorsFixture);

              // First - Borrow MELD from the lending pool
              const amountToBorrow = await convertToCurrencyDecimals(
                await meld.getAddress(),
                "2000"
              );

              await lendingPool
                .connect(borrower)
                .borrow(
                  await meld.getAddress(),
                  amountToBorrow,
                  RateMode.Variable,
                  borrower.address,
                  0
                );

              await mine(100);

              // Get reserve data before borrow 2
              const reserveDataBeforeBorrow: ReserveData = await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

              // Get user reserve data before borrow 2
              const userDataBeforeBorrow: UserReserveData = await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await meld.getAddress(),
                borrower.address
              );

              // Second - Borrow MELD from the lending pool
              const amountToBorrow2 = await convertToCurrencyDecimals(
                await meld.getAddress(),
                "1000"
              );

              const borrowTx = await lendingPool
                .connect(borrower)
                .borrow(
                  await meld.getAddress(),
                  amountToBorrow2,
                  RateMode.Variable,
                  borrower.address,
                  0
                );

              const blockTimestamps: BlockTimestamps =
                await getBlockTimestamps(borrowTx);

              // Get reserve data after borrow 2
              const reserveDataAfterBorrow: ReserveData = await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

              // Get user reserve data after borrow 2
              const userDataAfterBorrow: UserReserveData = await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await meld.getAddress(),
                borrower.address
              );

              // Calculate expected reserve data after borrow 2
              const expectedReserveDataAfterBorrow: ReserveData =
                calcExpectedReserveDataAfterBorrow(
                  amountToBorrow2,
                  RateMode.Variable,
                  reserveDataBeforeBorrow,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              // Calculate expected user data after borrow 2
              const expectedUserDataAfterBorrow: UserReserveData =
                calcExpectedUserDataAfterBorrow(
                  amountToBorrow2,
                  RateMode.Variable,
                  reserveDataBeforeBorrow,
                  expectedReserveDataAfterBorrow,
                  userDataBeforeBorrow,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              expectEqual(
                reserveDataAfterBorrow,
                expectedReserveDataAfterBorrow
              );
              expectEqual(userDataAfterBorrow, expectedUserDataAfterBorrow);
            });
            it("Should update token balances correctly when 'onBehalfOf' address is same as borrower", async function () {
              const {
                lendingPool,
                meldProtocolDataProvider,
                lendingRateOracleAggregator,
                meld,
                usdc,
                borrower,
              } = await loadFixture(depositForMultipleDepositorsFixture);

              // First - Borrow MELD from the lending pool
              const amountToBorrow = await convertToCurrencyDecimals(
                await meld.getAddress(),
                "2500"
              );

              // Instantiate reserve token contracts
              const reserveTokenAddressesMELD =
                await meldProtocolDataProvider.getReserveTokensAddresses(
                  await meld.getAddress()
                );

              const mMELD = await ethers.getContractAt(
                "MToken",
                reserveTokenAddressesMELD.mTokenAddress
              );

              const stableDebtToken = await ethers.getContractAt(
                "StableDebtToken",
                reserveTokenAddressesMELD.stableDebtTokenAddress
              );

              const variableDebtToken = await ethers.getContractAt(
                "VariableDebtToken",
                reserveTokenAddressesMELD.variableDebtTokenAddress
              );

              const reserveTokenAddressesUSDC =
                await meldProtocolDataProvider.getReserveTokensAddresses(
                  await usdc.getAddress()
                );
              const mUSDC = await ethers.getContractAt(
                "MToken",
                reserveTokenAddressesUSDC.mTokenAddress
              );

              await lendingPool
                .connect(borrower)
                .borrow(
                  await meld.getAddress(),
                  amountToBorrow,
                  RateMode.Variable,
                  borrower.address,
                  0
                );

              await mine(200);

              const mUSDCBalanceBefore = await mUSDC.balanceOf(borrower);

              // Get reserve data before borrow 2
              const reserveDataBeforeBorrow: ReserveData = await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

              // Get user reserve data before borrow 2
              const userDataBeforeBorrow: UserReserveData = await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await meld.getAddress(),
                borrower.address
              );

              // Second - Borrow MELD from the lending pool
              const amountToBorrow2 = await convertToCurrencyDecimals(
                await meld.getAddress(),
                "1875"
              );

              const borrowTx = await lendingPool
                .connect(borrower)
                .borrow(
                  await meld.getAddress(),
                  amountToBorrow2,
                  RateMode.Variable,
                  borrower.address,
                  0
                );

              const blockTimestamps: BlockTimestamps =
                await getBlockTimestamps(borrowTx);

              // Calculate expected reserve data after borrow 2
              const expectedReserveDataAfterBorrow: ReserveData =
                calcExpectedReserveDataAfterBorrow(
                  amountToBorrow2,
                  RateMode.Variable,
                  reserveDataBeforeBorrow,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              // Calculate expected user data after borrow 2
              const expectedUserDataAfterBorrow: UserReserveData =
                calcExpectedUserDataAfterBorrow(
                  amountToBorrow2,
                  RateMode.Variable,
                  reserveDataBeforeBorrow,
                  expectedReserveDataAfterBorrow,
                  userDataBeforeBorrow,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              // Check token balances
              expect(
                await stableDebtToken.balanceOf(borrower.address)
              ).to.equal(0n);

              expect(
                await stableDebtToken.principalBalanceOf(borrower.address)
              ).to.equal(0n);

              expect(
                await variableDebtToken.balanceOf(borrower.address)
              ).to.equal(expectedUserDataAfterBorrow.currentVariableDebt);

              expect(
                await variableDebtToken.scaledBalanceOf(borrower.address)
              ).to.equal(expectedUserDataAfterBorrow.scaledVariableDebt);

              // Check variable debt total and scaled supply
              expect(await variableDebtToken.totalSupply()).to.equal(
                expectedReserveDataAfterBorrow.totalVariableDebt
              );

              expect(await variableDebtToken.scaledTotalSupply()).to.equal(
                expectedReserveDataAfterBorrow.scaledVariableDebt
              );

              // Borrower didn't deposit MELD as collateral, so no change in mMELD balance.
              // Borrower deposited USDC as collateral, but mUSDC balance should not change. No collateral is transferred during borrow.
              expect(await mMELD.balanceOf(borrower.address)).to.equal(0);
              expect(await mUSDC.balanceOf(borrower.address)).to.equal(
                mUSDCBalanceBefore
              );

              // Borrower should have tokens borrowed
              expect(await meld.balanceOf(borrower.address)).to.equal(
                amountToBorrow + amountToBorrow2
              );
            });

            it("Should emit correct events when borrower borrows max possible amount (MaxUint256) on second borrow", async function () {
              const {
                lendingPool,
                meldProtocolDataProvider,
                lendingRateOracleAggregator,
                priceOracleAggregator,
                meld,
                owner,
                borrower,
                depositor,
              } = await loadFixture(depositForMultipleDepositorsFixture);

              // depositor must add some more liquidity to cover this borrow scenario
              const depositAmountMELD = await allocateAndApproveTokens(
                meld,
                owner,
                depositor,
                lendingPool,
                10000n,
                2n
              );

              await lendingPool
                .connect(depositor)
                .deposit(
                  await meld.getAddress(),
                  depositAmountMELD,
                  depositor.address,
                  true,
                  0
                );

              // First - Borrow MELD from the lending pool
              const amountToBorrow = await convertToCurrencyDecimals(
                await meld.getAddress(),
                "2000"
              );

              await lendingPool
                .connect(borrower)
                .borrow(
                  await meld.getAddress(),
                  amountToBorrow,
                  RateMode.Variable,
                  borrower.address,
                  0
                );

              // Instantiate reserve token contracts
              const reserveTokenAddresses =
                await meldProtocolDataProvider.getReserveTokensAddresses(
                  await meld.getAddress()
                );

              const mMELD = await ethers.getContractAt(
                "MToken",
                reserveTokenAddresses.mTokenAddress
              );

              const variableDebtToken = await ethers.getContractAt(
                "VariableDebtToken",
                reserveTokenAddresses.variableDebtTokenAddress
              );

              // Add time between borrows
              await time.increase(ONE_YEAR / 2);

              // Get reserve data before borrow 2
              const reserveDataBeforeBorrow: ReserveData = await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

              const borrowerAccountDataBefore =
                await lendingPool.getUserAccountData(borrower.address);

              const borrowTx = await lendingPool
                .connect(borrower)
                .borrow(
                  await meld.getAddress(),
                  MaxUint256,
                  RateMode.Variable,
                  borrower.address,
                  0
                );

              const blockTimestamps: BlockTimestamps =
                await getBlockTimestamps(borrowTx);

              // User is borrowing the maximum possible amount. User can't borrow more than the LTV amount minus the amount already borrowed
              const expectedBorrowAmountUSD =
                borrowerAccountDataBefore.totalCollateralUSD.percentMul(
                  borrowerAccountDataBefore.ltv
                ) - borrowerAccountDataBefore.totalDebtUSD;

              const [currentPrice, oracleSuccess] =
                await priceOracleAggregator.getAssetPrice(
                  await meld.getAddress()
                );
              expect(oracleSuccess).to.be.true;

              const meldDecimals = await meld.decimals();
              const meldTokenUnit = 10n ** meldDecimals;

              const expectedBorrowAmount =
                (meldTokenUnit * expectedBorrowAmountUSD) / currentPrice;

              // Calculate expected reserve data after borrowing
              const expectedReserveDataAfterBorrow: ReserveData =
                calcExpectedReserveDataAfterBorrow(
                  expectedBorrowAmount,
                  RateMode.Variable,
                  reserveDataBeforeBorrow,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              // Check that the correct events were emitted
              await expect(borrowTx)
                .to.emit(variableDebtToken, "Transfer")
                .withArgs(ZeroAddress, borrower.address, expectedBorrowAmount);

              await expect(borrowTx)
                .to.emit(variableDebtToken, "Mint")
                .withArgs(
                  borrower.address,
                  borrower.address,
                  expectedBorrowAmount,
                  expectedReserveDataAfterBorrow.variableBorrowIndex
                );

              // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
              const contractInstanceWithLibraryABI = await ethers.getContractAt(
                "ReserveLogic",
                await lendingPool.getAddress(),
                owner
              );

              await expect(borrowTx)
                .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
                .withArgs(
                  await meld.getAddress(),
                  expectedReserveDataAfterBorrow.liquidityRate,
                  expectedReserveDataAfterBorrow.stableBorrowRate,
                  isAlmostEqual(
                    expectedReserveDataAfterBorrow.variableBorrowRate
                  ),
                  expectedReserveDataAfterBorrow.liquidityIndex,
                  expectedReserveDataAfterBorrow.variableBorrowIndex
                );

              await expect(borrowTx)
                .to.emit(meld, "Transfer")
                .withArgs(
                  await mMELD.getAddress(),
                  borrower.address,
                  expectedBorrowAmount
                );

              // The Borrow event is emitted by the BorrowLogic.sol library, so we need to get the contract instance with the BorrowLogic ABI
              const contractInstanceWithBorrowLibraryABI =
                await ethers.getContractAt(
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
                  expectedBorrowAmount,
                  RateMode.Variable,
                  isAlmostEqual(
                    expectedReserveDataAfterBorrow.variableBorrowRate
                  )
                );

              await expect(borrowTx).to.not.emit(mMELD, "Transfer");
              await expect(borrowTx).to.not.emit(mMELD, "Mint");
            });
          });
        }
      ); // End Multiple borrows of same asset by same borrower Context

      context(
        "Multiple borrows of same asset by different borrowers",
        async function () {
          context("Multiple Stable Borrows", async function () {
            it("Should emit correct events when reserve factor == 0", async function () {
              const {
                lendingPool,
                meldProtocolDataProvider,
                lendingRateOracleAggregator,
                meld,
                owner,
                borrower,
                borrower2,
              } = await loadFixture(depositForMultipleDepositorsFixture);

              // First - Borrow MELD from the lending pool
              const amountToBorrow = await convertToCurrencyDecimals(
                await meld.getAddress(),
                "2000"
              );

              await lendingPool
                .connect(borrower)
                .borrow(
                  await meld.getAddress(),
                  amountToBorrow,
                  RateMode.Stable,
                  borrower.address,
                  0
                );

              // Add time between borrows
              await time.increase(ONE_YEAR / 12);

              // Get reserve data before borrow 2
              const reserveDataBeforeBorrow: ReserveData = await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

              // Get user reserve data before borrow 2
              const userDataBeforeBorrow: UserReserveData = await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await meld.getAddress(),
                borrower2.address
              );

              // Instantiate reserve token contracts
              const reserveTokenAddresses =
                await meldProtocolDataProvider.getReserveTokensAddresses(
                  await meld.getAddress()
                );

              const mMELD = await ethers.getContractAt(
                "MToken",
                reserveTokenAddresses.mTokenAddress
              );

              const stableDebtToken = await ethers.getContractAt(
                "StableDebtToken",
                reserveTokenAddresses.stableDebtTokenAddress
              );

              // Second - Borrow MELD from the lending pool
              const amountToBorrow2 = await convertToCurrencyDecimals(
                await meld.getAddress(),
                "100"
              );

              const borrowTx = await lendingPool
                .connect(borrower2)
                .borrow(
                  await meld.getAddress(),
                  amountToBorrow2,
                  RateMode.Stable,
                  borrower2.address,
                  0
                );

              const blockTimestamps: BlockTimestamps =
                await getBlockTimestamps(borrowTx);

              // Calculate expected reserve data after borrow 2
              const expectedReserveDataAfterBorrow: ReserveData =
                calcExpectedReserveDataAfterBorrow(
                  amountToBorrow2,
                  RateMode.Stable,
                  reserveDataBeforeBorrow,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              // Calculate expected user data after borrow 2
              const expectedUserDataAfterBorrow: UserReserveData =
                calcExpectedUserDataAfterBorrow(
                  amountToBorrow2,
                  RateMode.Stable,
                  reserveDataBeforeBorrow,
                  expectedReserveDataAfterBorrow,
                  userDataBeforeBorrow,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              const expectedAccumulatedInterest = calcCompoundedInterest(
                userDataBeforeBorrow.stableBorrowRate,
                blockTimestamps.latestBlockTimestamp,
                userDataBeforeBorrow.stableRateLastUpdated
              );

              const expectedCurrentBalance =
                userDataBeforeBorrow.principalStableDebt.rayMul(
                  expectedAccumulatedInterest
                );
              const expectedIncrease =
                expectedCurrentBalance -
                userDataBeforeBorrow.principalStableDebt;

              // Check that the correct events were emitted
              await expect(borrowTx)
                .to.emit(stableDebtToken, "Transfer")
                .withArgs(ZeroAddress, borrower2.address, amountToBorrow2);

              await expect(borrowTx)
                .to.emit(stableDebtToken, "Mint")
                .withArgs(
                  borrower2.address,
                  borrower2.address,
                  amountToBorrow2,
                  expectedCurrentBalance,
                  expectedIncrease,
                  expectedUserDataAfterBorrow.stableBorrowRate,
                  expectedReserveDataAfterBorrow.averageStableBorrowRate,
                  expectedReserveDataAfterBorrow.totalStableDebt
                );

              // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
              const contractInstanceWithLibraryABI = await ethers.getContractAt(
                "ReserveLogic",
                await lendingPool.getAddress(),
                owner
              );

              await expect(borrowTx)
                .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
                .withArgs(
                  await meld.getAddress(),
                  expectedReserveDataAfterBorrow.liquidityRate,
                  expectedReserveDataAfterBorrow.stableBorrowRate,
                  isAlmostEqual(
                    expectedReserveDataAfterBorrow.variableBorrowRate
                  ),
                  expectedReserveDataAfterBorrow.liquidityIndex,
                  expectedReserveDataAfterBorrow.variableBorrowIndex
                );

              await expect(borrowTx)
                .to.emit(meld, "Transfer")
                .withArgs(
                  await mMELD.getAddress(),
                  borrower2.address,
                  amountToBorrow2
                );

              // The Borrow event is emitted by the BorrowLogic.sol library, so we need to get the contract instance with the BorrowLogic ABI
              const contractInstanceWithBorrowLibraryABI =
                await ethers.getContractAt(
                  "BorrowLogic",
                  await lendingPool.getAddress(),
                  owner
                );

              await expect(borrowTx)
                .to.emit(contractInstanceWithBorrowLibraryABI, "Borrow")
                .withArgs(
                  await meld.getAddress(),
                  borrower2.address,
                  borrower2.address,
                  amountToBorrow2,
                  RateMode.Stable,
                  reserveDataBeforeBorrow.stableBorrowRate // The stable borrow rate emitted is the rate before updatInterestRates() is called
                );

              await expect(borrowTx).to.not.emit(mMELD, "Transfer");
              await expect(borrowTx).to.not.emit(mMELD, "Mint");
            });
            it("Should emit correct events when reserve factor > 0 and amountToMint == 0", async function () {
              const {
                lendingPool,
                meldProtocolDataProvider,
                lendingRateOracleAggregator,
                tether,
                owner,
                borrower,
                borrower2,
              } = await loadFixture(depositForMultipleDepositorsFixture);

              // First - Borrow USDT from the lending pool
              const amountToBorrow = await convertToCurrencyDecimals(
                await tether.getAddress(),
                "1250"
              );

              // Instantiate reserve token contracts
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

              await lendingPool
                .connect(borrower)
                .borrow(
                  await tether.getAddress(),
                  amountToBorrow,
                  RateMode.Stable,
                  borrower.address,
                  0
                );

              // Second - Borrow USDT from the lending pool
              const amountToBorrow2 = await convertToCurrencyDecimals(
                await tether.getAddress(),
                "100"
              );

              // Get reserve data before borrow 2
              const reserveDataBeforeBorrow: ReserveData = await getReserveData(
                meldProtocolDataProvider,
                await tether.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

              // Get user reserve data before  borrow 2
              const userDataBeforeBorrow: UserReserveData = await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await tether.getAddress(),
                borrower2.address
              );

              await mine();

              const borrowTx = await lendingPool
                .connect(borrower2)
                .borrow(
                  await tether.getAddress(),
                  amountToBorrow2,
                  RateMode.Stable,
                  borrower2.address,
                  0
                );

              const blockTimestamps: BlockTimestamps =
                await getBlockTimestamps(borrowTx);

              // Calculate expected reserve data after  borrow 2
              const expectedReserveDataAfterBorrow: ReserveData =
                calcExpectedReserveDataAfterBorrow(
                  amountToBorrow2,
                  RateMode.Stable,
                  reserveDataBeforeBorrow,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              // Calculate expected user data after  borrow 2
              const expectedUserDataAfterBorrow: UserReserveData =
                calcExpectedUserDataAfterBorrow(
                  amountToBorrow2,
                  RateMode.Stable,
                  reserveDataBeforeBorrow,
                  expectedReserveDataAfterBorrow,
                  userDataBeforeBorrow,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              const expectedAccumulatedInterest = calcCompoundedInterest(
                userDataBeforeBorrow.stableBorrowRate,
                blockTimestamps.latestBlockTimestamp,
                userDataBeforeBorrow.stableRateLastUpdated
              );

              const expectedCurrentBalance =
                userDataBeforeBorrow.principalStableDebt.rayMul(
                  expectedAccumulatedInterest
                );
              const expectedIncrease =
                expectedCurrentBalance -
                userDataBeforeBorrow.principalStableDebt;

              // Check that the correct events were emitted
              await expect(borrowTx)
                .to.emit(stableDebtToken, "Transfer")
                .withArgs(ZeroAddress, borrower2.address, amountToBorrow2);

              await expect(borrowTx)
                .to.emit(stableDebtToken, "Mint")
                .withArgs(
                  borrower2.address,
                  borrower2.address,
                  amountToBorrow2,
                  expectedCurrentBalance,
                  expectedIncrease,
                  expectedUserDataAfterBorrow.stableBorrowRate,
                  expectedReserveDataAfterBorrow.averageStableBorrowRate,
                  expectedReserveDataAfterBorrow.totalStableDebt
                );

              // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
              const contractInstanceWithLibraryABI = await ethers.getContractAt(
                "ReserveLogic",
                await lendingPool.getAddress(),
                owner
              );

              await expect(borrowTx)
                .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
                .withArgs(
                  await tether.getAddress(),
                  expectedReserveDataAfterBorrow.liquidityRate,
                  expectedReserveDataAfterBorrow.stableBorrowRate,
                  expectedReserveDataAfterBorrow.variableBorrowRate,
                  expectedReserveDataAfterBorrow.liquidityIndex,
                  expectedReserveDataAfterBorrow.variableBorrowIndex
                );

              await expect(borrowTx)
                .to.emit(tether, "Transfer")
                .withArgs(
                  await mUSDT.getAddress(),
                  borrower2.address,
                  amountToBorrow2
                );

              // The Borrow event is emitted by the BorrowLogic.sol library, so we need to get the contract instance with the BorrowLogic ABI
              const contractInstanceWithBorrowLibraryABI =
                await ethers.getContractAt(
                  "BorrowLogic",
                  await lendingPool.getAddress(),
                  owner
                );

              await expect(borrowTx)
                .to.emit(contractInstanceWithBorrowLibraryABI, "Borrow")
                .withArgs(
                  await tether.getAddress(),
                  borrower2.address,
                  borrower2.address,
                  amountToBorrow2,
                  RateMode.Stable,
                  reserveDataBeforeBorrow.stableBorrowRate // The stable borrow rate emitted is the rate before updatInterestRates() is called
                );

              await expect(borrowTx).to.not.emit(mUSDT, "Transfer");
              await expect(borrowTx).to.not.emit(mUSDT, "Mint");
            });

            it("Should emit correct events when reserve factor > 0 and amountToMint > 0", async function () {
              const {
                lendingPool,
                meldProtocolDataProvider,
                lendingRateOracleAggregator,
                tether,
                owner,
                borrower,
                borrower2,
                treasury,
              } = await loadFixture(depositForMultipleDepositorsFixture);

              // First - Borrow USDT from the lending pool
              const amountToBorrow = await convertToCurrencyDecimals(
                await tether.getAddress(),
                "1250"
              );

              // Instantiate reserve token contracts
              const reserveTokenAddresses =
                await meldProtocolDataProvider.getReserveTokensAddresses(
                  await tether.getAddress()
                );

              const mUSDT = (await ethers.getContractAt(
                "MToken",
                reserveTokenAddresses.mTokenAddress
              )) as MToken & Contract;

              const stableDebtToken = await ethers.getContractAt(
                "StableDebtToken",
                reserveTokenAddresses.stableDebtTokenAddress
              );

              await lendingPool
                .connect(borrower)
                .borrow(
                  await tether.getAddress(),
                  amountToBorrow,
                  RateMode.Stable,
                  borrower.address,
                  0
                );

              // Second - Borrow USDT from the lending pool
              const amountToBorrow2 = await convertToCurrencyDecimals(
                await tether.getAddress(),
                "50"
              );

              // Simulate time passing so that ReserveLogic._mintToTreasury amountToMint > 0
              await time.increase(ONE_YEAR * 2);

              // Get reserve data before borrow 2
              const reserveDataBeforeBorrow: ReserveData = await getReserveData(
                meldProtocolDataProvider,
                await tether.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

              // Get user reserve data before borrow 2
              const userDataBeforeBorrow: UserReserveData = await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await tether.getAddress(),
                borrower2.address
              );

              const borrowTx = await lendingPool
                .connect(borrower2)
                .borrow(
                  await tether.getAddress(),
                  amountToBorrow2,
                  RateMode.Stable,
                  borrower2.address,
                  0
                );

              const blockTimestamps: BlockTimestamps =
                await getBlockTimestamps(borrowTx);

              // Calculate expected reserve data after borrow 2
              const expectedReserveDataAfterBorrow: ReserveData =
                calcExpectedReserveDataAfterBorrow(
                  amountToBorrow2,
                  RateMode.Stable,
                  reserveDataBeforeBorrow,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              // Calculate expected user data after borrow 2
              const expectedUserDataAfterBorrow: UserReserveData =
                calcExpectedUserDataAfterBorrow(
                  amountToBorrow2,
                  RateMode.Stable,
                  reserveDataBeforeBorrow,
                  expectedReserveDataAfterBorrow,
                  userDataBeforeBorrow,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              const expectedAccumulatedInterest = calcCompoundedInterest(
                userDataBeforeBorrow.stableBorrowRate,
                blockTimestamps.latestBlockTimestamp,
                userDataBeforeBorrow.stableRateLastUpdated
              );

              const expectedCurrentBalance =
                userDataBeforeBorrow.principalStableDebt.rayMul(
                  expectedAccumulatedInterest
                );
              const expectedIncrease =
                expectedCurrentBalance -
                userDataBeforeBorrow.principalStableDebt;

              // Check that the correct events were emitted
              await expect(borrowTx)
                .to.emit(stableDebtToken, "Transfer")
                .withArgs(ZeroAddress, borrower2.address, amountToBorrow2);

              await expect(borrowTx)
                .to.emit(stableDebtToken, "Mint")
                .withArgs(
                  borrower2.address,
                  borrower2.address,
                  amountToBorrow2,
                  expectedCurrentBalance,
                  expectedIncrease,
                  expectedUserDataAfterBorrow.stableBorrowRate,
                  expectedReserveDataAfterBorrow.averageStableBorrowRate,
                  expectedReserveDataAfterBorrow.totalStableDebt
                );

              // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
              const contractInstanceWithLibraryABI =
                (await ethers.getContractAt(
                  "ReserveLogic",
                  await lendingPool.getAddress(),
                  owner
                )) as ReserveLogic & Contract;

              await expect(borrowTx)
                .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
                .withArgs(
                  await tether.getAddress(),
                  expectedReserveDataAfterBorrow.liquidityRate,
                  expectedReserveDataAfterBorrow.stableBorrowRate,
                  isAlmostEqual(
                    expectedReserveDataAfterBorrow.variableBorrowRate
                  ),
                  expectedReserveDataAfterBorrow.liquidityIndex,
                  expectedReserveDataAfterBorrow.variableBorrowIndex
                );

              await expect(borrowTx)
                .to.emit(tether, "Transfer")
                .withArgs(
                  await mUSDT.getAddress(),
                  borrower2.address,
                  amountToBorrow2
                );

              // The Borrow event is emitted by the BorrowLogic.sol library, so we need to get the contract instance with the BorrowLogic ABI
              const contractInstanceWithBorrowLibraryABI =
                await ethers.getContractAt(
                  "BorrowLogic",
                  await lendingPool.getAddress(),
                  owner
                );

              await expect(borrowTx)
                .to.emit(contractInstanceWithBorrowLibraryABI, "Borrow")
                .withArgs(
                  await tether.getAddress(),
                  borrower2.address,
                  borrower2.address,
                  amountToBorrow2,
                  RateMode.Stable,
                  reserveDataBeforeBorrow.stableBorrowRate // The stable borrow rate emitted is the rate before updatInterestRates() is called
                );

              const currentVariableDebt = BigInt(0);
              const previousVariableDebt = BigInt(0);
              const currentStableDebt = BigInt(
                reserveDataBeforeBorrow.totalStableDebt
              ); // The mint to treasury happens before debt token minting
              const previousStableDebt = BigInt(amountToBorrow); // This is the amount borrowed in the first borrow transaction

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

              await expect(borrowTx)
                .to.emit(mUSDT, "Transfer")
                .withArgs(
                  ZeroAddress,
                  treasury.address,
                  isAlmostEqual(amountToMint)
                );

              await expect(borrowTx)
                .to.emit(mUSDT, "Mint")
                .withArgs(
                  treasury.address,
                  isAlmostEqual(amountToMint),
                  expectedReserveDataAfterBorrow.liquidityIndex
                );
            });

            it("Should update state correctly", async function () {
              const {
                lendingPool,
                meldProtocolDataProvider,
                lendingRateOracleAggregator,
                meld,
                borrower,
                borrower2,
              } = await loadFixture(depositForMultipleDepositorsFixture);

              // First - Borrow MELD from the lending pool
              const amountToBorrow = await convertToCurrencyDecimals(
                await meld.getAddress(),
                "2000"
              );

              await lendingPool
                .connect(borrower)
                .borrow(
                  await meld.getAddress(),
                  amountToBorrow,
                  RateMode.Stable,
                  borrower.address,
                  0
                );

              // Get reserve data before borrow 2
              const reserveDataBeforeBorrow: ReserveData = await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

              // Get user reserve data before borrow 2
              const userDataBeforeBorrow: UserReserveData = await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await meld.getAddress(),
                borrower2.address
              );

              await mine(100);

              // Second - Borrow MELD from the lending pool
              const amountToBorrow2 = await convertToCurrencyDecimals(
                await meld.getAddress(),
                "200"
              );

              const borrowTx = await lendingPool
                .connect(borrower2)
                .borrow(
                  await meld.getAddress(),
                  amountToBorrow2,
                  RateMode.Stable,
                  borrower2.address,
                  0
                );

              const blockTimestamps: BlockTimestamps =
                await getBlockTimestamps(borrowTx);

              // Get reserve data after borrow 2
              const reserveDataAfterBorrow: ReserveData = await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

              // Get user reserve data after borrow 2
              const userDataAfterBorrow: UserReserveData = await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await meld.getAddress(),
                borrower2.address
              );

              // Calculate expected reserve data after borrow 2
              const expectedReserveDataAfterBorrow: ReserveData =
                calcExpectedReserveDataAfterBorrow(
                  amountToBorrow2,
                  RateMode.Stable,
                  reserveDataBeforeBorrow,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              // Calculate expected user data after borrow 2
              const expectedUserDataAfterBorrow: UserReserveData =
                calcExpectedUserDataAfterBorrow(
                  amountToBorrow2,
                  RateMode.Stable,
                  reserveDataBeforeBorrow,
                  expectedReserveDataAfterBorrow,
                  userDataBeforeBorrow,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              expectEqual(
                reserveDataAfterBorrow,
                expectedReserveDataAfterBorrow
              );
              expectEqual(userDataAfterBorrow, expectedUserDataAfterBorrow);
            });

            it("Should update token balances correctly when 'onBehalfOf' address is same as borrower", async function () {
              const {
                lendingPool,
                meldProtocolDataProvider,
                lendingRateOracleAggregator,
                meld,
                usdc,
                borrower,
                borrower2,
              } = await loadFixture(depositForMultipleDepositorsFixture);

              // First - Borrow MELD from the lending pool
              const amountToBorrow = await convertToCurrencyDecimals(
                await meld.getAddress(),
                "2500"
              );

              // Instantiate reserve token contracts
              const reserveTokenAddressesMELD =
                await meldProtocolDataProvider.getReserveTokensAddresses(
                  await meld.getAddress()
                );

              const mMELD = await ethers.getContractAt(
                "MToken",
                reserveTokenAddressesMELD.mTokenAddress
              );

              const stableDebtToken = await ethers.getContractAt(
                "StableDebtToken",
                reserveTokenAddressesMELD.stableDebtTokenAddress
              );

              const variableDebtToken = await ethers.getContractAt(
                "VariableDebtToken",
                reserveTokenAddressesMELD.variableDebtTokenAddress
              );

              const reserveTokenAddressesUSDC =
                await meldProtocolDataProvider.getReserveTokensAddresses(
                  await usdc.getAddress()
                );
              const mUSDC = await ethers.getContractAt(
                "MToken",
                reserveTokenAddressesUSDC.mTokenAddress
              );

              await lendingPool
                .connect(borrower)
                .borrow(
                  await meld.getAddress(),
                  amountToBorrow,
                  RateMode.Stable,
                  borrower.address,
                  0
                );

              await mine(200);

              const mUSDCBalanceBefore = await mUSDC.balanceOf(borrower2);

              // Get reserve data before borrow 2
              const reserveDataBeforeBorrow: ReserveData = await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

              // Get user reserve data before borrow 2
              const userDataBeforeBorrow: UserReserveData = await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await meld.getAddress(),
                borrower2.address
              );

              // Second - Borrow MELD from the lending pool
              const amountToBorrow2 = await convertToCurrencyDecimals(
                await meld.getAddress(),
                "1000"
              );

              const borrowTx = await lendingPool
                .connect(borrower2)
                .borrow(
                  await meld.getAddress(),
                  amountToBorrow2,
                  RateMode.Stable,
                  borrower2.address,
                  0
                );

              const blockTimestamps: BlockTimestamps =
                await getBlockTimestamps(borrowTx);

              // Calculate expected reserve data after borrow 2
              const expectedReserveDataAfterBorrow: ReserveData =
                calcExpectedReserveDataAfterBorrow(
                  amountToBorrow2,
                  RateMode.Stable,
                  reserveDataBeforeBorrow,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              // Calculate expected user data after borrow 2
              const expectedUserDataAfterBorrow: UserReserveData =
                calcExpectedUserDataAfterBorrow(
                  amountToBorrow2,
                  RateMode.Stable,
                  reserveDataBeforeBorrow,
                  expectedReserveDataAfterBorrow,
                  userDataBeforeBorrow,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              const { 0: principalSupply, 1: totalSupply } =
                await stableDebtToken.getSupplyData();

              // Check token balances
              expect(
                await stableDebtToken.balanceOf(borrower2.address)
              ).to.equal(expectedUserDataAfterBorrow.currentStableDebt);

              expect(
                await stableDebtToken.principalBalanceOf(borrower2.address)
              ).to.equal(expectedUserDataAfterBorrow.currentStableDebt);

              expect(
                await variableDebtToken.balanceOf(borrower2.address)
              ).to.equal(0n);

              // Check stable debt principal and total supply
              expect(principalSupply).to.equal(
                expectedReserveDataAfterBorrow.principalStableDebt
              );

              expect(totalSupply).to.equal(
                expectedReserveDataAfterBorrow.totalStableDebt
              );

              // Borrower didn't deposit MELD as collateral, so no change in mMELD balance.
              // Borrower deposited USDC as collateral, but mUSDC balance should not change. No collateral is transferred during borrow.
              expect(await mMELD.balanceOf(borrower2.address)).to.equal(0);
              expect(await mUSDC.balanceOf(borrower2.address)).to.equal(
                mUSDCBalanceBefore
              );

              // Borrower should have tokens borrowed
              expect(await meld.balanceOf(borrower2.address)).to.equal(
                amountToBorrow2
              );
            });
          }); // End Multiple Stable Borrows Context

          context("Multiple Variable Borrows", async function () {
            it("Should emit correct events when reserve factor == 0", async function () {
              const {
                lendingPool,
                meldProtocolDataProvider,
                lendingRateOracleAggregator,
                meld,
                owner,
                borrower,
                borrower2,
              } = await loadFixture(depositForMultipleDepositorsFixture);

              // First - Borrow MELD from the lending pool
              const amountToBorrow = await convertToCurrencyDecimals(
                await meld.getAddress(),
                "2000"
              );

              await lendingPool
                .connect(borrower)
                .borrow(
                  await meld.getAddress(),
                  amountToBorrow,
                  RateMode.Variable,
                  borrower.address,
                  0
                );

              // Add time between borrows
              await time.increase(ONE_YEAR / 2);

              // Instantiate reserve token contracts
              const reserveTokenAddresses =
                await meldProtocolDataProvider.getReserveTokensAddresses(
                  await meld.getAddress()
                );

              const mMELD = await ethers.getContractAt(
                "MToken",
                reserveTokenAddresses.mTokenAddress
              );

              const variableDebtToken = await ethers.getContractAt(
                "VariableDebtToken",
                reserveTokenAddresses.variableDebtTokenAddress
              );

              // Second - Borrow MELD from the lending pool
              const amountToBorrow2 = await convertToCurrencyDecimals(
                await meld.getAddress(),
                "1000"
              );

              // Get reserve data before borrow 2
              const reserveDataBeforeBorrow: ReserveData = await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

              // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
              time.setNextBlockTimestamp(await time.latest());

              const borrowTx = await lendingPool
                .connect(borrower2)
                .borrow(
                  await meld.getAddress(),
                  amountToBorrow2,
                  RateMode.Variable,
                  borrower2.address,
                  0
                );

              const blockTimestamps: BlockTimestamps =
                await getBlockTimestamps(borrowTx);

              // Calculate expected reserve data after borrow 2
              const expectedReserveDataAfterBorrow: ReserveData =
                calcExpectedReserveDataAfterBorrow(
                  amountToBorrow2,
                  RateMode.Variable,
                  reserveDataBeforeBorrow,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              // Check that the correct events were emitted
              await expect(borrowTx)
                .to.emit(variableDebtToken, "Transfer")
                .withArgs(ZeroAddress, borrower2.address, amountToBorrow2);

              await expect(borrowTx)
                .to.emit(variableDebtToken, "Mint")
                .withArgs(
                  borrower2.address,
                  borrower2.address,
                  amountToBorrow2,
                  expectedReserveDataAfterBorrow.variableBorrowIndex
                );

              // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
              const contractInstanceWithLibraryABI = await ethers.getContractAt(
                "ReserveLogic",
                await lendingPool.getAddress(),
                owner
              );

              await expect(borrowTx)
                .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
                .withArgs(
                  await meld.getAddress(),
                  expectedReserveDataAfterBorrow.liquidityRate,
                  expectedReserveDataAfterBorrow.stableBorrowRate,
                  isAlmostEqual(
                    expectedReserveDataAfterBorrow.variableBorrowRate
                  ),
                  expectedReserveDataAfterBorrow.liquidityIndex,
                  expectedReserveDataAfterBorrow.variableBorrowIndex
                );

              await expect(borrowTx)
                .to.emit(meld, "Transfer")
                .withArgs(
                  await mMELD.getAddress(),
                  borrower2.address,
                  amountToBorrow2
                );

              // The Borrow event is emitted by the BorrowLogic.sol library, so we need to get the contract instance with the BorrowLogic ABI
              const contractInstanceWithBorrowLibraryABI =
                await ethers.getContractAt(
                  "BorrowLogic",
                  await lendingPool.getAddress(),
                  owner
                );

              await expect(borrowTx)
                .to.emit(contractInstanceWithBorrowLibraryABI, "Borrow")
                .withArgs(
                  await meld.getAddress(),
                  borrower2.address,
                  borrower2.address,
                  amountToBorrow2,
                  RateMode.Variable,
                  isAlmostEqual(
                    expectedReserveDataAfterBorrow.variableBorrowRate
                  )
                );

              await expect(borrowTx).to.not.emit(mMELD, "Transfer");
              await expect(borrowTx).to.not.emit(mMELD, "Mint");
            });

            it("Should emit correct events when reserve factor > 0 and amountToMint == 0", async function () {
              const {
                lendingPool,
                meldProtocolDataProvider,
                lendingRateOracleAggregator,
                tether,
                owner,
                borrower,
                borrower2,
              } = await loadFixture(depositForMultipleDepositorsFixture);

              // First - Borrow USDT from the lending pool
              const amountToBorrow = await convertToCurrencyDecimals(
                await tether.getAddress(),
                "1250"
              );

              // Instantiate reserve token contracts
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

              await lendingPool
                .connect(borrower)
                .borrow(
                  await tether.getAddress(),
                  amountToBorrow,
                  RateMode.Variable,
                  borrower.address,
                  0
                );

              // Second - Borrow USDT from the lending pool
              const amountToBorrow2 = await convertToCurrencyDecimals(
                await tether.getAddress(),
                "500"
              );

              // Get reserve data before borrow 2
              const reserveDataBeforeBorrow: ReserveData = await getReserveData(
                meldProtocolDataProvider,
                await tether.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

              const borrowTx = await lendingPool
                .connect(borrower2)
                .borrow(
                  await tether.getAddress(),
                  amountToBorrow2,
                  RateMode.Variable,
                  borrower2.address,
                  0
                );

              const blockTimestamps: BlockTimestamps =
                await getBlockTimestamps(borrowTx);

              // Calculate expected reserve data after borrow 2
              const expectedReserveDataAfterBorrow: ReserveData =
                calcExpectedReserveDataAfterBorrow(
                  amountToBorrow2,
                  RateMode.Variable,
                  reserveDataBeforeBorrow,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              // Check that the correct events were emitted
              await expect(borrowTx)
                .to.emit(variableDebtToken, "Transfer")
                .withArgs(ZeroAddress, borrower2.address, amountToBorrow2);

              await expect(borrowTx)
                .to.emit(variableDebtToken, "Mint")
                .withArgs(
                  borrower2.address,
                  borrower2.address,
                  amountToBorrow2,
                  expectedReserveDataAfterBorrow.variableBorrowIndex
                );

              // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
              const contractInstanceWithLibraryABI = await ethers.getContractAt(
                "ReserveLogic",
                await lendingPool.getAddress(),
                owner
              );

              await expect(borrowTx)
                .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
                .withArgs(
                  await tether.getAddress(),
                  expectedReserveDataAfterBorrow.liquidityRate,
                  expectedReserveDataAfterBorrow.stableBorrowRate,
                  expectedReserveDataAfterBorrow.variableBorrowRate,
                  expectedReserveDataAfterBorrow.liquidityIndex,
                  expectedReserveDataAfterBorrow.variableBorrowIndex
                );

              await expect(borrowTx)
                .to.emit(tether, "Transfer")
                .withArgs(
                  await mUSDT.getAddress(),
                  borrower2.address,
                  amountToBorrow2
                );

              // The Borrow event is emitted by the BorrowLogic.sol library, so we need to get the contract instance with the BorrowLogic ABI
              const contractInstanceWithBorrowLibraryABI =
                await ethers.getContractAt(
                  "BorrowLogic",
                  await lendingPool.getAddress(),
                  owner
                );

              await expect(borrowTx)
                .to.emit(contractInstanceWithBorrowLibraryABI, "Borrow")
                .withArgs(
                  await tether.getAddress(),
                  borrower2.address,
                  borrower2.address,
                  amountToBorrow2,
                  RateMode.Variable,
                  expectedReserveDataAfterBorrow.variableBorrowRate
                );

              await expect(borrowTx).to.not.emit(mUSDT, "Transfer");
              await expect(borrowTx).to.not.emit(mUSDT, "Mint");
            });

            it("Should emit correct events when reserve factor > 0 and amountToMint > 0", async function () {
              const {
                lendingPool,
                meldProtocolDataProvider,
                lendingRateOracleAggregator,
                tether,
                owner,
                borrower,
                borrower2,
                treasury,
              } = await loadFixture(depositForMultipleDepositorsFixture);

              // First - Borrow USDT from the lending pool
              const amountToBorrow = await convertToCurrencyDecimals(
                await tether.getAddress(),
                "1250"
              );

              // Instantiate reserve token contracts
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

              await lendingPool
                .connect(borrower)
                .borrow(
                  await tether.getAddress(),
                  amountToBorrow,
                  RateMode.Variable,
                  borrower.address,
                  0
                );

              // Second - Borrow USDT from the lending pool
              const amountToBorrow2 = await convertToCurrencyDecimals(
                await tether.getAddress(),
                "500"
              );

              // Simulate time passing so that ReserveLogic._mintToTreasury amountToMint > 0
              await time.increase(ONE_YEAR * 1.5);

              // Get reserve data before borrow 2
              const reserveDataBeforeBorrow: ReserveData = await getReserveData(
                meldProtocolDataProvider,
                await tether.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

              const borrowTx = await lendingPool
                .connect(borrower2)
                .borrow(
                  await tether.getAddress(),
                  amountToBorrow2,
                  RateMode.Variable,
                  borrower2.address,
                  0
                );

              const blockTimestamps: BlockTimestamps =
                await getBlockTimestamps(borrowTx);

              // Calculate expected reserve data after  borrow 2
              const expectedReserveDataAfterBorrow: ReserveData =
                calcExpectedReserveDataAfterBorrow(
                  amountToBorrow2,
                  RateMode.Variable,
                  reserveDataBeforeBorrow,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              // Check that the correct events were emitted
              await expect(borrowTx)
                .to.emit(variableDebtToken, "Transfer")
                .withArgs(ZeroAddress, borrower2.address, amountToBorrow2);

              await expect(borrowTx)
                .to.emit(variableDebtToken, "Mint")
                .withArgs(
                  borrower2.address,
                  borrower2.address,
                  amountToBorrow2,
                  expectedReserveDataAfterBorrow.variableBorrowIndex
                );

              // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
              const contractInstanceWithLibraryABI = await ethers.getContractAt(
                "ReserveLogic",
                await lendingPool.getAddress(),
                owner
              );

              await expect(borrowTx)
                .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
                .withArgs(
                  await tether.getAddress(),
                  expectedReserveDataAfterBorrow.liquidityRate,
                  expectedReserveDataAfterBorrow.stableBorrowRate,
                  expectedReserveDataAfterBorrow.variableBorrowRate,
                  expectedReserveDataAfterBorrow.liquidityIndex,
                  expectedReserveDataAfterBorrow.variableBorrowIndex
                );

              await expect(borrowTx)
                .to.emit(tether, "Transfer")
                .withArgs(
                  await mUSDT.getAddress(),
                  borrower2.address,
                  amountToBorrow2
                );

              // The Borrow event is emitted by the BorrowLogic.sol library, so we need to get the contract instance with the BorrowLogic ABI
              const contractInstanceWithBorrowLibraryABI =
                await ethers.getContractAt(
                  "BorrowLogic",
                  await lendingPool.getAddress(),
                  owner
                );

              await expect(borrowTx)
                .to.emit(contractInstanceWithBorrowLibraryABI, "Borrow")
                .withArgs(
                  await tether.getAddress(),
                  borrower2.address,
                  borrower2.address,
                  amountToBorrow2,
                  RateMode.Variable,
                  expectedReserveDataAfterBorrow.variableBorrowRate
                );

              const currentVariableDebt = BigInt(
                reserveDataBeforeBorrow.totalVariableDebt
              ); // The mint to treasury happens before debt token minting
              const previousVariableDebt = BigInt(amountToBorrow); // This is the amount borrowed in the first borrow transaction
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

              await expect(borrowTx)
                .to.emit(mUSDT, "Transfer")
                .withArgs(ZeroAddress, treasury.address, amountToMint);

              await expect(borrowTx)
                .to.emit(mUSDT, "Mint")
                .withArgs(
                  treasury.address,
                  isAlmostEqual(amountToMint),
                  expectedReserveDataAfterBorrow.liquidityIndex
                );
            });

            it("Should update state correctly", async function () {
              const {
                lendingPool,
                meldProtocolDataProvider,
                lendingRateOracleAggregator,
                meld,
                borrower,
                borrower2,
              } = await loadFixture(depositForMultipleDepositorsFixture);

              // First - Borrow MELD from the lending pool
              const amountToBorrow = await convertToCurrencyDecimals(
                await meld.getAddress(),
                "2000"
              );

              await lendingPool
                .connect(borrower)
                .borrow(
                  await meld.getAddress(),
                  amountToBorrow,
                  RateMode.Variable,
                  borrower.address,
                  0
                );

              // Get reserve data before borrow 2
              const reserveDataBeforeBorrow: ReserveData = await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

              // Get user reserve data before borrow 2
              const userDataBeforeBorrow: UserReserveData = await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await meld.getAddress(),
                borrower2.address
              );

              await mine(100);

              // Second - Borrow MELD from the lending pool
              const amountToBorrow2 = await convertToCurrencyDecimals(
                await meld.getAddress(),
                "1000"
              );

              const borrowTx = await lendingPool
                .connect(borrower2)
                .borrow(
                  await meld.getAddress(),
                  amountToBorrow2,
                  RateMode.Variable,
                  borrower2.address,
                  0
                );

              const blockTimestamps: BlockTimestamps =
                await getBlockTimestamps(borrowTx);

              // Get reserve data after borrow 2
              const reserveDataAfterBorrow: ReserveData = await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

              // Get user reserve data after borrow 2
              const userDataAfterBorrow: UserReserveData = await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await meld.getAddress(),
                borrower2.address
              );

              // Calculate expected reserve data after borrow 2
              const expectedReserveDataAfterBorrow: ReserveData =
                calcExpectedReserveDataAfterBorrow(
                  amountToBorrow2,
                  RateMode.Variable,
                  reserveDataBeforeBorrow,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              // Calculate expected user data after borrow 2
              const expectedUserDataAfterBorrow: UserReserveData =
                calcExpectedUserDataAfterBorrow(
                  amountToBorrow2,
                  RateMode.Variable,
                  reserveDataBeforeBorrow,
                  expectedReserveDataAfterBorrow,
                  userDataBeforeBorrow,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              expectEqual(
                reserveDataAfterBorrow,
                expectedReserveDataAfterBorrow
              );
              expectEqual(userDataAfterBorrow, expectedUserDataAfterBorrow);
            });

            it("Should update token balances correctly when 'onBehalfOf' address is same as borrower", async function () {
              const {
                lendingPool,
                meldProtocolDataProvider,
                lendingRateOracleAggregator,
                meld,
                usdc,
                borrower,
                borrower2,
              } = await loadFixture(depositForMultipleDepositorsFixture);

              // First - Borrow MELD from the lending pool
              const amountToBorrow = await convertToCurrencyDecimals(
                await meld.getAddress(),
                "2500"
              );

              // Instantiate reserve token contracts
              const reserveTokenAddressesMELD =
                await meldProtocolDataProvider.getReserveTokensAddresses(
                  await meld.getAddress()
                );

              const mMELD = await ethers.getContractAt(
                "MToken",
                reserveTokenAddressesMELD.mTokenAddress
              );

              const stableDebtToken = await ethers.getContractAt(
                "StableDebtToken",
                reserveTokenAddressesMELD.stableDebtTokenAddress
              );

              const variableDebtToken = await ethers.getContractAt(
                "VariableDebtToken",
                reserveTokenAddressesMELD.variableDebtTokenAddress
              );

              const reserveTokenAddressesUSDC =
                await meldProtocolDataProvider.getReserveTokensAddresses(
                  await usdc.getAddress()
                );
              const mUSDC = await ethers.getContractAt(
                "MToken",
                reserveTokenAddressesUSDC.mTokenAddress
              );

              await lendingPool
                .connect(borrower)
                .borrow(
                  await meld.getAddress(),
                  amountToBorrow,
                  RateMode.Variable,
                  borrower.address,
                  0
                );

              await mine(200);

              const mUSDCBalanceBefore = await mUSDC.balanceOf(borrower2);

              // Get reserve data before borrow 2
              const reserveDataBeforeBorrow: ReserveData = await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

              // Get user reserve data before borrow 2
              const userDataBeforeBorrow: UserReserveData = await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await meld.getAddress(),
                borrower2.address
              );

              // Second - Borrow MELD from the lending pool
              const amountToBorrow2 = await convertToCurrencyDecimals(
                await meld.getAddress(),
                "1000"
              );

              const borrowTx = await lendingPool
                .connect(borrower2)
                .borrow(
                  await meld.getAddress(),
                  amountToBorrow2,
                  RateMode.Variable,
                  borrower2.address,
                  0
                );

              const blockTimestamps: BlockTimestamps =
                await getBlockTimestamps(borrowTx);

              // Calculate expected reserve data after borrow 2
              const expectedReserveDataAfterBorrow: ReserveData =
                calcExpectedReserveDataAfterBorrow(
                  amountToBorrow2,
                  RateMode.Variable,
                  reserveDataBeforeBorrow,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              // Calculate expected user data after borrow 2
              const expectedUserDataAfterBorrow: UserReserveData =
                calcExpectedUserDataAfterBorrow(
                  amountToBorrow2,
                  RateMode.Variable,
                  reserveDataBeforeBorrow,
                  expectedReserveDataAfterBorrow,
                  userDataBeforeBorrow,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp
                );

              // Check token balances
              expect(
                await stableDebtToken.balanceOf(borrower2.address)
              ).to.equal(0n);

              expect(
                await stableDebtToken.principalBalanceOf(borrower2.address)
              ).to.equal(0n);

              expect(
                await variableDebtToken.balanceOf(borrower2.address)
              ).to.equal(expectedUserDataAfterBorrow.currentVariableDebt);

              expect(
                await variableDebtToken.scaledBalanceOf(borrower2.address)
              ).to.equal(expectedUserDataAfterBorrow.scaledVariableDebt);

              // Check variable debt total and scaled supply
              expect(await variableDebtToken.totalSupply()).to.equal(
                expectedReserveDataAfterBorrow.totalVariableDebt
              );

              expect(await variableDebtToken.scaledTotalSupply()).to.equal(
                expectedReserveDataAfterBorrow.scaledVariableDebt
              );

              // Borrower didn't deposit MELD as collateral, so no change in mMELD balance.
              // Borrower deposited USDC as collateral, but mUSDC balance should not change. No collateral is transferred during borrow.
              expect(await mMELD.balanceOf(borrower2.address)).to.equal(0);
              expect(await mUSDC.balanceOf(borrower2.address)).to.equal(
                mUSDCBalanceBefore
              );

              // Borrower should have tokens borrowed
              expect(await meld.balanceOf(borrower2.address)).to.equal(
                amountToBorrow2
              );
            });
          }); // End Multiple Variable Borrows Context
        }
      ); // Multiple borrows of same asset by different borrowers

      context(
        "Multiple borrows of different assets by same borrower",
        async function () {
          // Only one event test case for this context to check that the basic functionality work in this scenario.
          // Testing all event scenarios doesn't add much value here  over and above the the Single Stable Borrow
          // and Single Variable Borrow test cases
          it("Should emit correct events", async function () {
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              meld,
              tether,
              owner,
              borrower,
            } = await loadFixture(depositForMultipleDepositorsFixture);

            // First - Borrow MELD from the lending pool
            const amountToBorrow = await convertToCurrencyDecimals(
              await meld.getAddress(),
              "2000"
            );

            // Get reserve data before borrow 1
            const reserveDataBeforeBorrow: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await meld.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Get user reserve data before borrow 1
            const userDataBeforeBorrow: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              borrower.address
            );

            const borrowTx = await lendingPool
              .connect(borrower)
              .borrow(
                await meld.getAddress(),
                amountToBorrow,
                RateMode.Stable,
                borrower.address,
                0
              );

            const blockTimestamps: BlockTimestamps =
              await getBlockTimestamps(borrowTx);

            // Instantiate reserve token contracts
            const reserveTokenAddresses =
              await meldProtocolDataProvider.getReserveTokensAddresses(
                await meld.getAddress()
              );

            const mMELD = await ethers.getContractAt(
              "MToken",
              reserveTokenAddresses.mTokenAddress
            );

            const stableDebtToken = await ethers.getContractAt(
              "StableDebtToken",
              reserveTokenAddresses.stableDebtTokenAddress
            );

            // Calculate expected reserve data after borrow 1
            const expectedReserveDataAfterBorrow: ReserveData =
              calcExpectedReserveDataAfterBorrow(
                amountToBorrow,
                RateMode.Stable,
                reserveDataBeforeBorrow,
                blockTimestamps.txTimestamp,
                blockTimestamps.latestBlockTimestamp
              );

            // Calculate expected user data after borrow 1
            const expectedUserDataAfterBorrow: UserReserveData =
              calcExpectedUserDataAfterBorrow(
                amountToBorrow,
                RateMode.Stable,
                reserveDataBeforeBorrow,
                expectedReserveDataAfterBorrow,
                userDataBeforeBorrow,
                blockTimestamps.txTimestamp,
                blockTimestamps.latestBlockTimestamp
              );

            const expectedAccumulatedInterest = calcCompoundedInterest(
              userDataBeforeBorrow.stableBorrowRate,
              blockTimestamps.latestBlockTimestamp,
              userDataBeforeBorrow.stableRateLastUpdated
            );

            const expectedCurrentBalance =
              userDataBeforeBorrow.principalStableDebt.rayMul(
                expectedAccumulatedInterest
              );
            const expectedIncrease =
              expectedCurrentBalance - userDataBeforeBorrow.principalStableDebt;

            // Check that the correct events were emitted
            await expect(borrowTx)
              .to.emit(stableDebtToken, "Transfer")
              .withArgs(ZeroAddress, borrower.address, amountToBorrow);

            await expect(borrowTx)
              .to.emit(stableDebtToken, "Mint")
              .withArgs(
                borrower.address,
                borrower.address,
                amountToBorrow,
                expectedCurrentBalance,
                expectedIncrease,
                expectedUserDataAfterBorrow.stableBorrowRate,
                expectedReserveDataAfterBorrow.averageStableBorrowRate,
                expectedReserveDataAfterBorrow.totalStableDebt
              );

            // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
            const contractInstanceWithLibraryABI = await ethers.getContractAt(
              "ReserveLogic",
              await lendingPool.getAddress(),
              owner
            );

            await expect(borrowTx)
              .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
              .withArgs(
                await meld.getAddress(),
                expectedReserveDataAfterBorrow.liquidityRate,
                expectedReserveDataAfterBorrow.stableBorrowRate,
                expectedReserveDataAfterBorrow.variableBorrowRate,
                expectedReserveDataAfterBorrow.liquidityIndex,
                expectedReserveDataAfterBorrow.variableBorrowIndex
              );

            await expect(borrowTx)
              .to.emit(meld, "Transfer")
              .withArgs(
                await mMELD.getAddress(),
                borrower.address,
                amountToBorrow
              );

            // The Borrow event is emitted by the BorrowLogic.sol library, so we need to get the contract instance with the BorrowLogic ABI
            const contractInstanceWithBorrowLibraryABI =
              await ethers.getContractAt(
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
                amountToBorrow,
                RateMode.Stable,
                reserveDataBeforeBorrow.stableBorrowRate // The stable borrow rate emitted is the rate before updatInterestRates() is called
              );

            await expect(borrowTx).to.not.emit(mMELD, "Transfer");
            await expect(borrowTx).to.not.emit(mMELD, "Mint");

            // Second - Borrow USDT from the lending pool
            const amountToBorrow2 = await convertToCurrencyDecimals(
              await tether.getAddress(),
              "1000"
            );

            // Instantiate reserve token contracts
            const reserveTokenAddressesUSDT =
              await meldProtocolDataProvider.getReserveTokensAddresses(
                await tether.getAddress()
              );

            const mUSDT = await ethers.getContractAt(
              "MToken",
              reserveTokenAddressesUSDT.mTokenAddress
            );

            const variableDebtToken = await ethers.getContractAt(
              "VariableDebtToken",
              reserveTokenAddressesUSDT.variableDebtTokenAddress
            );

            // Simulate time passing so that ReserveLogic._mintToTreasury amountToMint > 0
            await time.increase(ONE_YEAR);

            // Get reserve data before borrow 2
            const tetherReserveDataBeforeBorrow2: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await tether.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            const borrowTx2 = await lendingPool
              .connect(borrower)
              .borrow(
                await tether.getAddress(),
                amountToBorrow2,
                RateMode.Variable,
                borrower.address,
                0
              );

            const blockTimestamps2: BlockTimestamps =
              await getBlockTimestamps(borrowTx2);

            // Calculate expected reserve data after borrow 2
            const expectedTetherReserveDataAfterBorrow2: ReserveData =
              calcExpectedReserveDataAfterBorrow(
                amountToBorrow2,
                RateMode.Variable,
                tetherReserveDataBeforeBorrow2,
                blockTimestamps2.txTimestamp,
                blockTimestamps2.latestBlockTimestamp
              );

            // Check that the correct events were emitted
            await expect(borrowTx2)
              .to.emit(variableDebtToken, "Transfer")
              .withArgs(ZeroAddress, borrower.address, amountToBorrow2);

            await expect(borrowTx2)
              .to.emit(variableDebtToken, "Mint")
              .withArgs(
                borrower.address,
                borrower.address,
                amountToBorrow2,
                expectedTetherReserveDataAfterBorrow2.variableBorrowIndex
              );

            await expect(borrowTx2)
              .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
              .withArgs(
                await tether.getAddress(),
                expectedTetherReserveDataAfterBorrow2.liquidityRate,
                expectedTetherReserveDataAfterBorrow2.stableBorrowRate,
                expectedTetherReserveDataAfterBorrow2.variableBorrowRate,
                expectedTetherReserveDataAfterBorrow2.liquidityIndex,
                expectedTetherReserveDataAfterBorrow2.variableBorrowIndex
              );

            await expect(borrowTx2)
              .to.emit(tether, "Transfer")
              .withArgs(
                await mUSDT.getAddress(),
                borrower.address,
                amountToBorrow2
              );

            await expect(borrowTx2)
              .to.emit(contractInstanceWithBorrowLibraryABI, "Borrow")
              .withArgs(
                await tether.getAddress(),
                borrower.address,
                borrower.address,
                amountToBorrow2,
                RateMode.Variable,
                expectedTetherReserveDataAfterBorrow2.variableBorrowRate
              );

            await expect(borrowTx2).to.not.emit(mUSDT, "Transfer");
            await expect(borrowTx2).to.not.emit(mUSDT, "Mint");
          });

          it("Should update state correctly", async function () {
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              meld,
              tether,
              borrower,
            } = await loadFixture(depositForMultipleDepositorsFixture);

            // First - Borrow MELD from the lending pool
            const amountToBorrow = await convertToCurrencyDecimals(
              await meld.getAddress(),
              "2000"
            );

            // Get MELD reserve data before borrow 1
            const meldReserveDataBeforeBorrow1: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get user reserve data before borrow 1
            const userDataBeforeBorrow1: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              borrower.address
            );

            const borrowTx = await lendingPool
              .connect(borrower)
              .borrow(
                await meld.getAddress(),
                amountToBorrow,
                RateMode.Stable,
                borrower.address,
                0
              );

            // Get MELD reserve data after borrow 1
            const meldReserveDataAfterBorrow1: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get user reserve data after borrow 1
            const userDataAfterBorrow1: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              borrower.address
            );

            const blockTimestamps: BlockTimestamps =
              await getBlockTimestamps(borrowTx);

            // Calculate expected reserve data after borrow 1
            const expectedMeldReserveDataAfterBorrow1: ReserveData =
              calcExpectedReserveDataAfterBorrow(
                amountToBorrow,
                RateMode.Stable,
                meldReserveDataBeforeBorrow1,
                blockTimestamps.txTimestamp,
                blockTimestamps.latestBlockTimestamp
              );

            // Calculate expected user data after borrow 1
            const expectedUserDataAfterBorrow1: UserReserveData =
              calcExpectedUserDataAfterBorrow(
                amountToBorrow,
                RateMode.Stable,
                meldReserveDataBeforeBorrow1,
                expectedMeldReserveDataAfterBorrow1,
                userDataBeforeBorrow1,
                blockTimestamps.txTimestamp,
                blockTimestamps.latestBlockTimestamp
              );

            await mine(100);

            // Get USDT reserve data before borrow 2
            const usdtReserveDataBeforeBorrow2: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await tether.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get user reserve data before borrow 2
            const userDataBeforeBorrow2: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await tether.getAddress(),
              borrower.address
            );

            // Second - Borrow USDT from the lending pool
            const amountToBorrow2 = await convertToCurrencyDecimals(
              await tether.getAddress(),
              "500"
            );

            const borrowTx2 = await lendingPool
              .connect(borrower)
              .borrow(
                await tether.getAddress(),
                amountToBorrow2,
                RateMode.Variable,
                borrower.address,
                0
              );

            // Get reserve data after borrow 2
            const usdtReserveDataAfterBorrow2: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await tether.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get user reserve data after borrow 2
            const userDataAfterBorrow2: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await tether.getAddress(),
              borrower.address
            );

            const blockTimestamps2: BlockTimestamps =
              await getBlockTimestamps(borrowTx2);

            // Calculate expected reserve data after borrow 2
            const expectedUsdtReserveDataAfterBorrow2: ReserveData =
              calcExpectedReserveDataAfterBorrow(
                amountToBorrow2,
                RateMode.Variable,
                usdtReserveDataBeforeBorrow2,
                blockTimestamps2.txTimestamp,
                blockTimestamps2.latestBlockTimestamp
              );

            // Calculate expected user data after borrow 2
            const expectedUserDataAfterBorrow2: UserReserveData =
              calcExpectedUserDataAfterBorrow(
                amountToBorrow2,
                RateMode.Variable,
                usdtReserveDataBeforeBorrow2,
                expectedUsdtReserveDataAfterBorrow2,
                userDataBeforeBorrow2,
                blockTimestamps2.txTimestamp,
                blockTimestamps2.latestBlockTimestamp
              );

            expectEqual(
              meldReserveDataAfterBorrow1,
              expectedMeldReserveDataAfterBorrow1
            );
            expectEqual(userDataAfterBorrow1, expectedUserDataAfterBorrow1);
            expectEqual(
              usdtReserveDataAfterBorrow2,
              expectedUsdtReserveDataAfterBorrow2
            );
            expectEqual(userDataAfterBorrow2, expectedUserDataAfterBorrow2);
          });

          it("Should update token balances correctly when 'onBehalfOf' address is same as borrower", async function () {
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              meld,
              tether,
              usdc,
              borrower,
            } = await loadFixture(depositForMultipleDepositorsFixture);

            // First - Borrow MELD from the lending pool
            const amountToBorrow = await convertToCurrencyDecimals(
              await meld.getAddress(),
              "2500"
            );

            // Instantiate reserve token contracts
            const reserveTokenAddressesMELD =
              await meldProtocolDataProvider.getReserveTokensAddresses(
                await meld.getAddress()
              );

            const mMELD = await ethers.getContractAt(
              "MToken",
              reserveTokenAddressesMELD.mTokenAddress
            );

            const stableDebtToken = await ethers.getContractAt(
              "StableDebtToken",
              reserveTokenAddressesMELD.stableDebtTokenAddress
            );

            const reserveTokenAddressesUSDC =
              await meldProtocolDataProvider.getReserveTokensAddresses(
                await usdc.getAddress()
              );
            const mUSDC = await ethers.getContractAt(
              "MToken",
              reserveTokenAddressesUSDC.mTokenAddress
            );

            const reserveTokenAddressesUSDT =
              await meldProtocolDataProvider.getReserveTokensAddresses(
                await tether.getAddress()
              );

            const mUSDT = await ethers.getContractAt(
              "MToken",
              reserveTokenAddressesUSDT.mTokenAddress
            );

            const variableDebtToken = await ethers.getContractAt(
              "VariableDebtToken",
              reserveTokenAddressesUSDT.variableDebtTokenAddress
            );

            // Get reserve data before borrow 1
            const meldReserveDataBeforeBorrow1: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get user reserve data before borrow 1
            const userDataBeforeBorrow1: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              borrower.address
            );

            // Get collateral balance
            const mUSDCBalanceBefore = await mUSDC.balanceOf(borrower);

            const borrowTx = await lendingPool
              .connect(borrower)
              .borrow(
                await meld.getAddress(),
                amountToBorrow,
                RateMode.Stable,
                borrower.address,
                0
              );

            await mine(200);

            // Get reserve data before borrow 2
            const usdtReserveDataBeforeBorrow2: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await tether.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get user reserve data before borrow 2
            const userDataBeforeBorrow2: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await tether.getAddress(),
              borrower.address
            );

            // First - Borrow USDT from the lending pool
            const amountToBorrow2 = await convertToCurrencyDecimals(
              await tether.getAddress(),
              "1000"
            );

            const borrowTx2 = await lendingPool
              .connect(borrower)
              .borrow(
                await tether.getAddress(),
                amountToBorrow2,
                RateMode.Variable,
                borrower.address,
                0
              );

            const blockTimestamps2: BlockTimestamps =
              await getBlockTimestamps(borrowTx2);

            // Calculate expected reserve data after borrow 2
            const expectedUsdtReserveDataAfterBorrow2: ReserveData =
              calcExpectedReserveDataAfterBorrow(
                amountToBorrow2,
                RateMode.Variable,
                usdtReserveDataBeforeBorrow2,
                blockTimestamps2.txTimestamp,
                blockTimestamps2.latestBlockTimestamp
              );

            // Calculate expected user data after borrow 2
            const expectedUsdtUserDataAfterBorrow2: UserReserveData =
              calcExpectedUserDataAfterBorrow(
                amountToBorrow2,
                RateMode.Variable,
                usdtReserveDataBeforeBorrow2,
                expectedUsdtReserveDataAfterBorrow2,
                userDataBeforeBorrow2,
                blockTimestamps2.txTimestamp,
                blockTimestamps2.latestBlockTimestamp
              );

            // Calculate the current MELD reserve and user data
            const blockTimestamps: BlockTimestamps =
              await getBlockTimestamps(borrowTx);

            // Calculate expected user data after borrow 1 - need to do this at the end so the current timestamp is correct
            const expectedMeldReserveDataAfterBorrow1: ReserveData =
              calcExpectedReserveDataAfterBorrow(
                amountToBorrow,
                RateMode.Stable,
                meldReserveDataBeforeBorrow1,
                blockTimestamps.txTimestamp,
                blockTimestamps.latestBlockTimestamp
              );

            // Calculate expected user data after borrow 1 - need to do this at the end so the current timestamp is correct
            const expecteMeldUserDataAfterBorrow1: UserReserveData =
              calcExpectedUserDataAfterBorrow(
                amountToBorrow,
                RateMode.Stable,
                meldReserveDataBeforeBorrow1,
                expectedMeldReserveDataAfterBorrow1,
                userDataBeforeBorrow1,
                blockTimestamps.txTimestamp,
                blockTimestamps.latestBlockTimestamp
              );

            // Check token balances
            expect(await stableDebtToken.balanceOf(borrower.address)).to.equal(
              expecteMeldUserDataAfterBorrow1.currentStableDebt
            );

            expect(
              await stableDebtToken.principalBalanceOf(borrower.address)
            ).to.equal(expecteMeldUserDataAfterBorrow1.principalStableDebt);

            expect(
              await variableDebtToken.balanceOf(borrower.address)
            ).to.equal(expectedUsdtUserDataAfterBorrow2.currentVariableDebt);

            expect(
              await variableDebtToken.scaledBalanceOf(borrower.address)
            ).to.equal(expectedUsdtUserDataAfterBorrow2.scaledVariableDebt);

            // Check variable debt total and scaled supply
            expect(await variableDebtToken.totalSupply()).to.equal(
              expectedUsdtReserveDataAfterBorrow2.totalVariableDebt
            );

            expect(await variableDebtToken.scaledTotalSupply()).to.equal(
              expectedUsdtReserveDataAfterBorrow2.scaledVariableDebt
            );

            // Borrower didn't deposit MELD as collateral, so no change in mMELD balance.
            // Borrower deposited USDC as collateral, but mUSDC balance should not change. No collateral is transferred during borrow.
            expect(await mMELD.balanceOf(borrower.address)).to.equal(0);
            expect(await mUSDT.balanceOf(borrower.address)).to.equal(0);
            expect(await mUSDC.balanceOf(borrower.address)).to.equal(
              mUSDCBalanceBefore
            );

            // Borrower should have tokens borrowed
            expect(await meld.balanceOf(borrower.address)).to.equal(
              amountToBorrow
            );
            expect(await tether.balanceOf(borrower.address)).to.equal(
              amountToBorrow2
            );
          });
        }
      ); // End Multiple borrows of different assets by same borrower

      context(
        "Multiple borrows of different assets by different borrowers",
        async function () {
          // Only one event test case for this context to check that the basic functionality work in this scenario.
          // Testing all event scenarios doesn't add much value here  over and above the the Single Stable Borrow
          // and Single Variable Borrow test cases
          it("Should emit correct events", async function () {
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              meld,
              tether,
              owner,
              borrower,
              borrower3,
            } = await loadFixture(depositForMultipleDepositorsFixture);

            // First - Borrow MELD from the lending pool
            const amountToBorrow = await convertToCurrencyDecimals(
              await meld.getAddress(),
              "2000"
            );

            // Get reserve data before borrow 1
            const reserveDataBeforeBorrow: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await meld.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Get user reserve data before borrow 1
            const userDataBeforeBorrow: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              borrower.address
            );

            const borrowTx = await lendingPool
              .connect(borrower)
              .borrow(
                await meld.getAddress(),
                amountToBorrow,
                RateMode.Stable,
                borrower.address,
                0
              );

            const blockTimestamps: BlockTimestamps =
              await getBlockTimestamps(borrowTx);

            // Instantiate reserve token contracts
            const reserveTokenAddresses =
              await meldProtocolDataProvider.getReserveTokensAddresses(
                await meld.getAddress()
              );

            const mMELD = await ethers.getContractAt(
              "MToken",
              reserveTokenAddresses.mTokenAddress
            );

            const stableDebtToken = await ethers.getContractAt(
              "StableDebtToken",
              reserveTokenAddresses.stableDebtTokenAddress
            );

            // Calculate expected reserve data after borrow 1
            const expectedReserveDataAfterBorrow: ReserveData =
              calcExpectedReserveDataAfterBorrow(
                amountToBorrow,
                RateMode.Stable,
                reserveDataBeforeBorrow,
                blockTimestamps.txTimestamp,
                blockTimestamps.latestBlockTimestamp
              );

            // Calculate expected user data after borrow 1
            const expectedUserDataAfterBorrow: UserReserveData =
              calcExpectedUserDataAfterBorrow(
                amountToBorrow,
                RateMode.Stable,
                reserveDataBeforeBorrow,
                expectedReserveDataAfterBorrow,
                userDataBeforeBorrow,
                blockTimestamps.txTimestamp,
                blockTimestamps.latestBlockTimestamp
              );

            const expectedAccumulatedInterest = calcCompoundedInterest(
              userDataBeforeBorrow.stableBorrowRate,
              blockTimestamps.latestBlockTimestamp,
              userDataBeforeBorrow.stableRateLastUpdated
            );

            const expectedCurrentBalance =
              userDataBeforeBorrow.principalStableDebt.rayMul(
                expectedAccumulatedInterest
              );
            const expectedIncrease =
              expectedCurrentBalance - userDataBeforeBorrow.principalStableDebt;

            // Check that the correct events were emitted
            await expect(borrowTx)
              .to.emit(stableDebtToken, "Transfer")
              .withArgs(ZeroAddress, borrower.address, amountToBorrow);

            await expect(borrowTx)
              .to.emit(stableDebtToken, "Mint")
              .withArgs(
                borrower.address,
                borrower.address,
                amountToBorrow,
                expectedCurrentBalance,
                expectedIncrease,
                expectedUserDataAfterBorrow.stableBorrowRate,
                expectedReserveDataAfterBorrow.averageStableBorrowRate,
                expectedReserveDataAfterBorrow.totalStableDebt
              );

            // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
            const contractInstanceWithLibraryABI = await ethers.getContractAt(
              "ReserveLogic",
              await lendingPool.getAddress(),
              owner
            );

            await expect(borrowTx)
              .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
              .withArgs(
                await meld.getAddress(),
                expectedReserveDataAfterBorrow.liquidityRate,
                expectedReserveDataAfterBorrow.stableBorrowRate,
                expectedReserveDataAfterBorrow.variableBorrowRate,
                expectedReserveDataAfterBorrow.liquidityIndex,
                expectedReserveDataAfterBorrow.variableBorrowIndex
              );

            await expect(borrowTx)
              .to.emit(meld, "Transfer")
              .withArgs(
                await mMELD.getAddress(),
                borrower.address,
                amountToBorrow
              );

            // The Borrow event is emitted by the BorrowLogic.sol library, so we need to get the contract instance with the BorrowLogic ABI
            const contractInstanceWithBorrowLibraryABI =
              await ethers.getContractAt(
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
                amountToBorrow,
                RateMode.Stable,
                reserveDataBeforeBorrow.stableBorrowRate // The stable borrow rate emitted is the rate before updatInterestRates() is called
              );

            await expect(borrowTx).to.not.emit(mMELD, "Transfer");
            await expect(borrowTx).to.not.emit(mMELD, "Mint");

            // Borrow USDT from the lending pool
            const amountToBorrow2 = await convertToCurrencyDecimals(
              await tether.getAddress(),
              "1000"
            );

            // Instantiate reserve token contracts
            const reserveTokenAddressesUSDT =
              await meldProtocolDataProvider.getReserveTokensAddresses(
                await tether.getAddress()
              );

            const mUSDT = await ethers.getContractAt(
              "MToken",
              reserveTokenAddressesUSDT.mTokenAddress
            );

            const variableDebtToken = await ethers.getContractAt(
              "VariableDebtToken",
              reserveTokenAddressesUSDT.variableDebtTokenAddress
            );

            // Get reserve data before borrow 2
            const tetherReserveDataBeforeBorrow2: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await tether.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            const borrowTx2 = await lendingPool
              .connect(borrower3)
              .borrow(
                await tether.getAddress(),
                amountToBorrow2,
                RateMode.Variable,
                borrower3.address,
                0
              );

            const blockTimestamps2: BlockTimestamps =
              await getBlockTimestamps(borrowTx2);

            // Calculate expected reserve data after borrow 2
            const expectedTetherReserveDataAfterBorrow2: ReserveData =
              calcExpectedReserveDataAfterBorrow(
                amountToBorrow2,
                RateMode.Variable,
                tetherReserveDataBeforeBorrow2,
                blockTimestamps2.txTimestamp,
                blockTimestamps2.latestBlockTimestamp
              );

            // Check that the correct events were emitted
            await expect(borrowTx2)
              .to.emit(variableDebtToken, "Transfer")
              .withArgs(ZeroAddress, borrower3.address, amountToBorrow2);

            await expect(borrowTx2)
              .to.emit(variableDebtToken, "Mint")
              .withArgs(
                borrower3.address,
                borrower3.address,
                amountToBorrow2,
                expectedTetherReserveDataAfterBorrow2.variableBorrowIndex
              );

            await expect(borrowTx2)
              .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
              .withArgs(
                await tether.getAddress(),
                expectedTetherReserveDataAfterBorrow2.liquidityRate,
                expectedTetherReserveDataAfterBorrow2.stableBorrowRate,
                expectedTetherReserveDataAfterBorrow2.variableBorrowRate,
                expectedTetherReserveDataAfterBorrow2.liquidityIndex,
                expectedTetherReserveDataAfterBorrow2.variableBorrowIndex
              );

            await expect(borrowTx2)
              .to.emit(tether, "Transfer")
              .withArgs(
                await mUSDT.getAddress(),
                borrower3.address,
                amountToBorrow2
              );

            await expect(borrowTx2)
              .to.emit(contractInstanceWithBorrowLibraryABI, "Borrow")
              .withArgs(
                await tether.getAddress(),
                borrower3.address,
                borrower3.address,
                amountToBorrow2,
                RateMode.Variable,
                expectedTetherReserveDataAfterBorrow2.variableBorrowRate
              );

            await expect(borrowTx2).to.not.emit(mUSDT, "Transfer");
            await expect(borrowTx2).to.not.emit(mUSDT, "Mint");
          });

          it("Should update state correctly", async function () {
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              meld,
              tether,
              borrower,
              borrower3,
            } = await loadFixture(depositForMultipleDepositorsFixture);

            // First - Borrow MELD from the lending pool
            const amountToBorrow = await convertToCurrencyDecimals(
              await meld.getAddress(),
              "2000"
            );

            // Get MELD reserve data before borrow 1
            const meldReserveDataBeforeBorrow1: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get user reserve data before borrow 1
            const userDataBeforeBorrow1: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              borrower.address
            );

            const borrowTx = await lendingPool
              .connect(borrower)
              .borrow(
                await meld.getAddress(),
                amountToBorrow,
                RateMode.Stable,
                borrower.address,
                0
              );

            // Get MELD reserve data after borrow 1
            const meldReserveDataAfterBorrow1: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get user reserve data after borrow 1
            const userDataAfterBorrow1: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              borrower.address
            );

            const blockTimestamps: BlockTimestamps =
              await getBlockTimestamps(borrowTx);

            // Calculate expected reserve data after borrow 1
            const expectedMeldReserveDataAfterBorrow1: ReserveData =
              calcExpectedReserveDataAfterBorrow(
                amountToBorrow,
                RateMode.Stable,
                meldReserveDataBeforeBorrow1,
                blockTimestamps.txTimestamp,
                blockTimestamps.latestBlockTimestamp
              );

            // Calculate expected user data after borrow 1
            const expectedUserDataAfterBorrow1: UserReserveData =
              calcExpectedUserDataAfterBorrow(
                amountToBorrow,
                RateMode.Stable,
                meldReserveDataBeforeBorrow1,
                expectedMeldReserveDataAfterBorrow1,
                userDataBeforeBorrow1,
                blockTimestamps.txTimestamp,
                blockTimestamps.latestBlockTimestamp
              );

            await mine(100);

            // Get USDT reserve data before borrow 2
            const usdtReserveDataBeforeBorrow2: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await tether.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get user reserve data before borrow 2
            const userDataBeforeBorrow2: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await tether.getAddress(),
              borrower.address
            );

            // Second - Borrow USDT from the lending pool
            const amountToBorrow2 = await convertToCurrencyDecimals(
              await tether.getAddress(),
              "500"
            );

            const borrowTx2 = await lendingPool
              .connect(borrower3)
              .borrow(
                await tether.getAddress(),
                amountToBorrow2,
                RateMode.Variable,
                borrower3.address,
                0
              );

            // Get reserve data after borrow 2
            const usdtReserveDataAfterBorrow2: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await tether.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get user reserve data after borrow 2
            const userDataAfterBorrow2: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await tether.getAddress(),
              borrower3.address
            );

            const blockTimestamps2: BlockTimestamps =
              await getBlockTimestamps(borrowTx2);

            // Calculate expected reserve data after borrow 2
            const expectedUsdtReserveDataAfterBorrow2: ReserveData =
              calcExpectedReserveDataAfterBorrow(
                amountToBorrow2,
                RateMode.Variable,
                usdtReserveDataBeforeBorrow2,
                blockTimestamps2.txTimestamp,
                blockTimestamps2.latestBlockTimestamp
              );

            // Calculate expected user data after borrow 2
            const expectedUserDataAfterBorrow2: UserReserveData =
              calcExpectedUserDataAfterBorrow(
                amountToBorrow2,
                RateMode.Variable,
                usdtReserveDataBeforeBorrow2,
                expectedUsdtReserveDataAfterBorrow2,
                userDataBeforeBorrow2,
                blockTimestamps2.txTimestamp,
                blockTimestamps2.latestBlockTimestamp
              );

            expectEqual(
              meldReserveDataAfterBorrow1,
              expectedMeldReserveDataAfterBorrow1
            );
            expectEqual(userDataAfterBorrow1, expectedUserDataAfterBorrow1);
            expectEqual(
              usdtReserveDataAfterBorrow2,
              expectedUsdtReserveDataAfterBorrow2
            );
            expectEqual(userDataAfterBorrow2, expectedUserDataAfterBorrow2);
          });

          it("Should update token balances correctly when 'onBehalfOf' address is same as borrower", async function () {
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              meld,
              tether,
              usdc,
              dai,
              borrower,
              borrower3,
            } = await loadFixture(depositForMultipleDepositorsFixture);

            // First - Borrow MELD from the lending pool
            const amountToBorrow = await convertToCurrencyDecimals(
              await meld.getAddress(),
              "2500"
            );

            // Instantiate reserve token contracts
            const reserveTokenAddressesMELD =
              await meldProtocolDataProvider.getReserveTokensAddresses(
                await meld.getAddress()
              );

            const mMELD = await ethers.getContractAt(
              "MToken",
              reserveTokenAddressesMELD.mTokenAddress
            );

            const stableDebtToken = await ethers.getContractAt(
              "StableDebtToken",
              reserveTokenAddressesMELD.stableDebtTokenAddress
            );

            const reserveTokenAddressesUSDC =
              await meldProtocolDataProvider.getReserveTokensAddresses(
                await usdc.getAddress()
              );
            const mUSDC = await ethers.getContractAt(
              "MToken",
              reserveTokenAddressesUSDC.mTokenAddress
            );

            const reserveTokenAddressesUSDT =
              await meldProtocolDataProvider.getReserveTokensAddresses(
                await tether.getAddress()
              );

            const mUSDT = await ethers.getContractAt(
              "MToken",
              reserveTokenAddressesUSDT.mTokenAddress
            );

            const variableDebtToken = await ethers.getContractAt(
              "VariableDebtToken",
              reserveTokenAddressesUSDT.variableDebtTokenAddress
            );

            const reserveTokenAddressesDAI =
              await meldProtocolDataProvider.getReserveTokensAddresses(
                await dai.getAddress()
              );

            const mDAI = await ethers.getContractAt(
              "MToken",
              reserveTokenAddressesDAI.mTokenAddress
            );

            // Get reserve data before borrow 1
            const meldReserveDataBeforeBorrow1: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get user reserve data before borrow 1
            const userDataBeforeBorrow1: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              borrower.address
            );

            // Get collateral balance
            const mUSDCBalanceBeforeBorrower = await mUSDC.balanceOf(borrower);

            const borrowTx = await lendingPool
              .connect(borrower)
              .borrow(
                await meld.getAddress(),
                amountToBorrow,
                RateMode.Stable,
                borrower.address,
                0
              );

            await mine(200);

            // Get reserve data before borrow 2
            const usdtReserveDataBeforeBorrow2: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await tether.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get user reserve data before borrow 2
            const userDataBeforeBorrow2: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await tether.getAddress(),
              borrower3.address
            );

            // Second - Borrow USDT from the lending pool
            const amountToBorrow2 = await convertToCurrencyDecimals(
              await tether.getAddress(),
              "1000"
            );

            const mDAIBalanceBeforeBorrower3 = await mDAI.balanceOf(borrower3);

            const borrowTx2 = await lendingPool
              .connect(borrower3)
              .borrow(
                await tether.getAddress(),
                amountToBorrow2,
                RateMode.Variable,
                borrower3.address,
                0
              );

            const blockTimestamps2: BlockTimestamps =
              await getBlockTimestamps(borrowTx2);

            // Calculate expected reserve data after borrow 2
            const expectedUsdtReserveDataAfterBorrow2: ReserveData =
              calcExpectedReserveDataAfterBorrow(
                amountToBorrow2,
                RateMode.Variable,
                usdtReserveDataBeforeBorrow2,
                blockTimestamps2.txTimestamp,
                blockTimestamps2.latestBlockTimestamp
              );

            // Calculate expected user data after borrow 2
            const expectedUsdtUserDataAfterBorrow2: UserReserveData =
              calcExpectedUserDataAfterBorrow(
                amountToBorrow2,
                RateMode.Variable,
                usdtReserveDataBeforeBorrow2,
                expectedUsdtReserveDataAfterBorrow2,
                userDataBeforeBorrow2,
                blockTimestamps2.txTimestamp,
                blockTimestamps2.latestBlockTimestamp
              );

            // Calculate the current MELD reserve and user data after borrow 2
            const blockTimestamps: BlockTimestamps =
              await getBlockTimestamps(borrowTx);

            const expectedMeldReserveDataAfterBorrow1: ReserveData =
              calcExpectedReserveDataAfterBorrow(
                amountToBorrow,
                RateMode.Stable,
                meldReserveDataBeforeBorrow1,
                blockTimestamps.txTimestamp,
                blockTimestamps.latestBlockTimestamp
              );

            const expecteMeldUserDataAfterBorrow1: UserReserveData =
              calcExpectedUserDataAfterBorrow(
                amountToBorrow,
                RateMode.Stable,
                meldReserveDataBeforeBorrow1,
                expectedMeldReserveDataAfterBorrow1,
                userDataBeforeBorrow1,
                blockTimestamps.txTimestamp,
                blockTimestamps.latestBlockTimestamp
              );

            // Check token balances
            expect(await stableDebtToken.balanceOf(borrower.address)).to.equal(
              expecteMeldUserDataAfterBorrow1.currentStableDebt
            );

            expect(
              await stableDebtToken.principalBalanceOf(borrower.address)
            ).to.equal(expecteMeldUserDataAfterBorrow1.principalStableDebt);

            expect(
              await variableDebtToken.balanceOf(borrower3.address)
            ).to.equal(expectedUsdtUserDataAfterBorrow2.currentVariableDebt);

            expect(
              await variableDebtToken.scaledBalanceOf(borrower3.address)
            ).to.equal(expectedUsdtUserDataAfterBorrow2.scaledVariableDebt);

            // Check variable debt total and scaled supply
            expect(await variableDebtToken.totalSupply()).to.equal(
              expectedUsdtReserveDataAfterBorrow2.totalVariableDebt
            );

            expect(await variableDebtToken.scaledTotalSupply()).to.equal(
              expectedUsdtReserveDataAfterBorrow2.scaledVariableDebt
            );

            // Borrower didn't deposit MELD as collateral, so no change in mMELD balance.
            // Borrower deposited USDC as collateral, but mUSDC balance should not change.
            // Borrower3 deposited DAI as collateral, but mDAI balance should not change.
            // The same goes for Borrower3 and DAI. No collateral is transferred during borrow.
            expect(await mMELD.balanceOf(borrower.address)).to.equal(0);
            expect(await mUSDT.balanceOf(borrower3.address)).to.equal(0);
            expect(await mUSDC.balanceOf(borrower.address)).to.equal(
              mUSDCBalanceBeforeBorrower
            );
            expect(await mDAI.balanceOf(borrower3.address)).to.equal(
              mDAIBalanceBeforeBorrower3
            );

            // Borrower should have tokens borrowed
            expect(await meld.balanceOf(borrower.address)).to.equal(
              amountToBorrow
            );
            expect(await tether.balanceOf(borrower3.address)).to.equal(
              amountToBorrow2
            );
          });
        }
      ); // End "Multiple borrows of different assets by different borrowers

      context("Borrow from genius loan", async function () {
        it("Should allow someone with the GENIUS_LOAN_ROLE role to withdraw on behalf of a user that has opted in", async function () {
          const {
            addressesProvider,
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meld,
            owner,
            borrower,
            rando,
          } = await loadFixture(depositForMultipleDepositorsFixture);

          // Give rando the GENIUS_LOAN_ROLE role
          await addressesProvider
            .connect(owner)
            .grantRole(await addressesProvider.GENIUS_LOAN_ROLE(), rando);

          // Depositor opts in to the genius loan
          await lendingPool.connect(borrower).setUserAcceptGeniusLoan(true);

          // Borrow MELD from the lending pool
          const amountToBorrow = await convertToCurrencyDecimals(
            await meld.getAddress(),
            "2000"
          );

          // Get reserve data before borrowing
          const reserveDataBeforeBorrow: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before borrowing
          const userDataBeforeBorrow: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await meld.getAddress(),
            borrower.address
          );

          // Instantiate reserve token contracts
          const reserveTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await meld.getAddress()
            );

          const mMELD = await ethers.getContractAt(
            "MToken",
            reserveTokenAddresses.mTokenAddress
          );

          const stableDebtToken = await ethers.getContractAt(
            "StableDebtToken",
            reserveTokenAddresses.stableDebtTokenAddress
          );

          const borrowTx = await lendingPool
            .connect(rando)
            .borrow(
              await meld.getAddress(),
              amountToBorrow,
              RateMode.Stable,
              borrower,
              0
            );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(borrowTx);

          // Calculate expected reserve data after borrowing
          const expectedReserveDataAfterBorrow: ReserveData =
            calcExpectedReserveDataAfterBorrow(
              amountToBorrow,
              RateMode.Stable,
              reserveDataBeforeBorrow,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          // Calculate expected user data after borrowing
          const expectedUserDataAfterBorrow: UserReserveData =
            calcExpectedUserDataAfterBorrow(
              amountToBorrow,
              RateMode.Stable,
              reserveDataBeforeBorrow,
              expectedReserveDataAfterBorrow,
              userDataBeforeBorrow,
              blockTimestamps.txTimestamp,
              blockTimestamps.latestBlockTimestamp
            );

          // Check that the correct events were emitted
          await expect(borrowTx)
            .to.emit(stableDebtToken, "Transfer")
            .withArgs(ZeroAddress, borrower.address, amountToBorrow);

          await expect(borrowTx).to.emit(stableDebtToken, "Mint").withArgs(
            borrower.address,
            borrower.address,
            amountToBorrow,
            0n, // First borrow, so no current balance
            0n, // First borrow, so no balance increase
            expectedUserDataAfterBorrow.stableBorrowRate,
            expectedReserveDataAfterBorrow.averageStableBorrowRate,
            expectedReserveDataAfterBorrow.totalStableDebt
          );

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          await expect(borrowTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await meld.getAddress(),
              expectedReserveDataAfterBorrow.liquidityRate,
              expectedReserveDataAfterBorrow.stableBorrowRate,
              expectedReserveDataAfterBorrow.variableBorrowRate,
              expectedReserveDataAfterBorrow.liquidityIndex,
              expectedReserveDataAfterBorrow.variableBorrowIndex
            );

          await expect(borrowTx)
            .to.emit(meld, "Transfer")
            .withArgs(await mMELD.getAddress(), rando.address, amountToBorrow);

          // The Borrow event is emitted by the BorrowLogic.sol library, so we need to get the contract instance with the BorrowLogic ABI
          const contractInstanceWithBorrowLibraryABI =
            await ethers.getContractAt(
              "BorrowLogic",
              await lendingPool.getAddress(),
              owner
            );

          await expect(borrowTx)
            .to.emit(contractInstanceWithBorrowLibraryABI, "Borrow")
            .withArgs(
              await meld.getAddress(),
              rando.address,
              borrower.address,
              amountToBorrow,
              RateMode.Stable,
              reserveDataBeforeBorrow.stableBorrowRate // The stable borrow rate emitted is the rate before updatInterestRates() is called
            );

          await expect(borrowTx).to.not.emit(mMELD, "Transfer");
          await expect(borrowTx).to.not.emit(mMELD, "Mint");
          await expect(borrowTx).to.not.emit(
            stableDebtToken,
            "BorrowAllowanceDelegated"
          ); // no credit delegation

          expect(await meld.balanceOf(rando)).to.equal(amountToBorrow); // genius loan user gets the asset tokens
          expect(await stableDebtToken.balanceOf(borrower)).to.equal(
            amountToBorrow
          ); // user gets the debt tokens
        });
      }); // End Borrow from genius loan
    }); // End Reguler User Context

    context("MELD Banker", async function () {
      it("Should emit the correct events when a MELD Banker holder borrows a yield boost token", async function () {
        const {
          lendingPool,
          meldProtocolDataProvider,
          lendingRateOracleAggregator,
          usdc,
          owner,
          meldBanker,
          meldBankerTokenId,
          yieldBoostStakingUSDC,
        } = await loadFixture(depositForMultipleMeldBankersFixture);

        // Borrow USDC from the lending pool
        const amountToBorrow = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "1000"
        );

        // Get reserve data before borrowing
        const reserveDataBeforeBorrow: ReserveData = await getReserveData(
          meldProtocolDataProvider,
          await usdc.getAddress(),
          await lendingRateOracleAggregator.getAddress()
        );

        // Instantiate reserve token contracts
        const reserveTokenAddresses =
          await meldProtocolDataProvider.getReserveTokensAddresses(
            await usdc.getAddress()
          );

        const mUSDC = await ethers.getContractAt(
          "MToken",
          reserveTokenAddresses.mTokenAddress
        );

        const variableDebtToken = await ethers.getContractAt(
          "VariableDebtToken",
          reserveTokenAddresses.variableDebtTokenAddress
        );

        const borrowTx = await lendingPool
          .connect(meldBanker)
          .borrow(
            await usdc.getAddress(),
            amountToBorrow,
            RateMode.Variable,
            meldBanker.address,
            meldBankerTokenId
          );

        const blockTimestamps: BlockTimestamps =
          await getBlockTimestamps(borrowTx);

        // Calculate expected reserve data after borrowing
        const expectedReserveDataAfterBorrow: ReserveData =
          calcExpectedReserveDataAfterBorrow(
            amountToBorrow,
            RateMode.Variable,
            reserveDataBeforeBorrow,
            blockTimestamps.txTimestamp,
            blockTimestamps.latestBlockTimestamp
          );

        // Check that the correct events were emitted
        await expect(borrowTx)
          .to.emit(variableDebtToken, "Transfer")
          .withArgs(ZeroAddress, meldBanker.address, amountToBorrow);

        await expect(borrowTx)
          .to.emit(variableDebtToken, "Mint")
          .withArgs(
            meldBanker.address,
            meldBanker.address,
            amountToBorrow,
            expectedReserveDataAfterBorrow.variableBorrowIndex
          );

        // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
        const contractInstanceWithLibraryABI = await ethers.getContractAt(
          "ReserveLogic",
          await lendingPool.getAddress(),
          owner
        );

        await expect(borrowTx)
          .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
          .withArgs(
            await usdc.getAddress(),
            expectedReserveDataAfterBorrow.liquidityRate,
            expectedReserveDataAfterBorrow.stableBorrowRate,
            expectedReserveDataAfterBorrow.variableBorrowRate,
            expectedReserveDataAfterBorrow.liquidityIndex,
            expectedReserveDataAfterBorrow.variableBorrowIndex
          );

        await expect(borrowTx)
          .to.emit(usdc, "Transfer")
          .withArgs(
            await mUSDC.getAddress(),
            meldBanker.address,
            amountToBorrow
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
            meldBanker.address,
            meldBanker.address,
            amountToBorrow,
            RateMode.Variable,
            expectedReserveDataAfterBorrow.variableBorrowRate
          );

        await expect(borrowTx).to.not.emit(mUSDC, "Transfer");
        await expect(borrowTx).to.not.emit(mUSDC, "Mint");

        // MELD Banker, so should emit StakePositionCreated, StakePositionUpdated, RefreshYieldBoostAmount and LockMeldBankerNFT events
        const meldBankerData = await lendingPool.userMeldBankerData(
          meldBanker.address
        );
        const yieldBoostMultiplier = await lendingPool.yieldBoostMultipliers(
          meldBankerData.meldBankerType,
          meldBankerData.action
        );

        const expectedStakedAmount =
          amountToBorrow.percentMul(yieldBoostMultiplier);

        await expect(borrowTx)
          .to.emit(yieldBoostStakingUSDC, "StakePositionCreated")
          .withArgs(meldBanker.address, expectedStakedAmount);

        await expect(borrowTx)
          .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
          .withArgs(meldBanker.address, 0, expectedStakedAmount);

        await expect(borrowTx)
          .to.emit(lendingPool, "LockMeldBankerNFT")
          .withArgs(
            await usdc.getAddress(),
            meldBanker.address,
            meldBankerTokenId,
            MeldBankerType.BANKER,
            Action.BORROW
          );

        await expect(borrowTx)
          .to.emit(lendingPool, "RefreshYieldBoostAmount")
          .withArgs(
            await usdc.getAddress(),
            meldBanker.address,
            expectedStakedAmount
          );
      });

      it("Should update state correctly when a MELD Banker holder borrows a yield boost token", async function () {
        const {
          lendingPool,
          meldProtocolDataProvider,
          lendingRateOracleAggregator,
          usdc,
          meldBanker,
          meldBankerTokenId,
          yieldBoostStorageUSDC,
        } = await loadFixture(depositForMultipleMeldBankersFixture);

        // Borrow USDC from the lending pool
        const amountToBorrow = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "2000"
        );

        // Get reserve data before borrowing
        const reserveDataBeforeBorrow: ReserveData = await getReserveData(
          meldProtocolDataProvider,
          await usdc.getAddress(),
          await lendingRateOracleAggregator.getAddress()
        );

        // Get user reserve data before borrowing
        const userDataBeforeBorrow: UserReserveData = await getUserData(
          lendingPool,
          meldProtocolDataProvider,
          await usdc.getAddress(),
          meldBanker.address
        );

        const borrowTx = await lendingPool
          .connect(meldBanker)
          .borrow(
            await usdc.getAddress(),
            amountToBorrow,
            RateMode.Variable,
            meldBanker.address,
            meldBankerTokenId
          );

        const blockTimestamps: BlockTimestamps =
          await getBlockTimestamps(borrowTx);

        // Get reserve data after borrowing
        const reserveDataAfterBorrow: ReserveData = await getReserveData(
          meldProtocolDataProvider,
          await usdc.getAddress(),
          await lendingRateOracleAggregator.getAddress()
        );

        // Get user reserve data after borrowing
        const userDataAfterBorrow: UserReserveData = await getUserData(
          lendingPool,
          meldProtocolDataProvider,
          await usdc.getAddress(),
          meldBanker.address
        );

        // Calculate expected reserve data after borrowing
        const expectedReserveDataAfterBorrow: ReserveData =
          calcExpectedReserveDataAfterBorrow(
            amountToBorrow,
            RateMode.Variable,
            reserveDataBeforeBorrow,
            blockTimestamps.txTimestamp,
            blockTimestamps.latestBlockTimestamp
          );

        // Calculate expected user data after borrowing
        const expectedUserDataAfterBorrow: UserReserveData =
          calcExpectedUserDataAfterBorrow(
            amountToBorrow,
            RateMode.Variable,
            reserveDataBeforeBorrow,
            expectedReserveDataAfterBorrow,
            userDataBeforeBorrow,
            blockTimestamps.txTimestamp,
            blockTimestamps.latestBlockTimestamp
          );

        expectEqual(reserveDataAfterBorrow, expectedReserveDataAfterBorrow);
        expectEqual(userDataAfterBorrow, expectedUserDataAfterBorrow);

        expect(await lendingPool.isUsingMeldBanker(meldBanker.address)).to.be
          .true;

        expect(await lendingPool.isMeldBankerBlocked(meldBankerTokenId)).to.be
          .true;

        const meldBankerData = await lendingPool.userMeldBankerData(
          meldBanker.address
        );
        expect(meldBankerData.tokenId).to.equal(meldBankerTokenId);
        expect(meldBankerData.asset).to.equal(await usdc.getAddress());
        expect(meldBankerData.meldBankerType).to.equal(MeldBankerType.BANKER);
        expect(meldBankerData.action).to.equal(Action.BORROW);

        const yieldBoostMultiplier = await lendingPool.yieldBoostMultipliers(
          meldBankerData.meldBankerType,
          meldBankerData.action
        );
        const expectedStakedAmount =
          amountToBorrow.percentMul(yieldBoostMultiplier);

        expect(
          await yieldBoostStorageUSDC.getStakerStakedAmount(meldBanker.address)
        ).to.equal(expectedStakedAmount);
      });

      it("Should calculate correct stake amount if MELD Banker gets yield boost for borrow but has a regular deposit of a different yield boost token", async function () {
        const {
          lendingPool,
          usdc,
          dai,
          owner,
          meldBanker,
          meldBankerTokenId,
          yieldBoostStorageUSDC,
          yieldBoostStorageDAI,
        } = await loadFixture(depositForMultipleDepositorsFixture);

        // USDC liquidity deposited in fixture

        // MELD banker deposits DAI (a yield boost token) without NFT
        const depositAmountDAI = await allocateAndApproveTokens(
          dai,
          owner,
          meldBanker,
          lendingPool,
          5_000n,
          0n
        );

        await lendingPool
          .connect(meldBanker)
          .deposit(
            await dai.getAddress(),
            depositAmountDAI,
            meldBanker.address,
            true,
            0n
          );

        // Borrow USDC from the lending pool
        const amountToBorrow = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "1000"
        );

        await lendingPool
          .connect(meldBanker)
          .borrow(
            await usdc.getAddress(),
            amountToBorrow,
            RateMode.Variable,
            meldBanker.address,
            meldBankerTokenId
          );

        expect(await lendingPool.isUsingMeldBanker(meldBanker.address)).to.be
          .true;

        expect(await lendingPool.isMeldBankerBlocked(meldBankerTokenId)).to.be
          .true;

        // DAI and USDC have different staking protocols, so the amounts are different.
        // DAI: deposit amount * regular user deposit multiplier because user didn't use tokenId
        // USDC: Borrow amount * meld banker borrow multiplier (because it is a "borrow" action with NFT)
        const yieldBoostMultiplierDAI = await lendingPool.yieldBoostMultipliers(
          MeldBankerType.NONE,
          Action.DEPOSIT
        );

        const expectedStakedAmountDAI = depositAmountDAI.percentMul(
          yieldBoostMultiplierDAI
        );

        expect(
          await yieldBoostStorageDAI.getStakerStakedAmount(meldBanker.address)
        ).to.equal(expectedStakedAmountDAI);

        const meldBankerData = await lendingPool.userMeldBankerData(
          meldBanker.address
        );
        expect(meldBankerData.tokenId).to.equal(meldBankerTokenId);
        expect(meldBankerData.asset).to.equal(await usdc.getAddress());
        expect(meldBankerData.meldBankerType).to.equal(MeldBankerType.BANKER);
        expect(meldBankerData.action).to.equal(Action.BORROW);

        const yieldBoostMultiplierUSDC =
          await lendingPool.yieldBoostMultipliers(
            meldBankerData.meldBankerType,
            meldBankerData.action
          );

        const expectedStakedAmountUSDC = amountToBorrow.percentMul(
          yieldBoostMultiplierUSDC
        );

        expect(
          await yieldBoostStorageUSDC.getStakerStakedAmount(meldBanker.address)
        ).to.equal(expectedStakedAmountUSDC);
      });

      it("Should update token balances correctly when a MELD Banker holder borrows a yield boost token", async function () {
        const {
          lendingPool,
          meldProtocolDataProvider,
          lendingRateOracleAggregator,
          usdc,
          meld,
          meldBanker,
          meldBankerTokenId,
        } = await loadFixture(depositForMultipleMeldBankersFixture);

        // Borrow USDC from the lending pool
        const amountToBorrow = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "2000"
        );

        // Instantiate reserve token contracts for borrowed and collateral token
        const reserveTokenAddressesMELD =
          await meldProtocolDataProvider.getReserveTokensAddresses(
            await meld.getAddress()
          );

        const mMELD = await ethers.getContractAt(
          "MToken",
          reserveTokenAddressesMELD.mTokenAddress
        );

        const reserveTokenAddressesUSDC =
          await meldProtocolDataProvider.getReserveTokensAddresses(
            await usdc.getAddress()
          );

        const mUSDC = await ethers.getContractAt(
          "MToken",
          reserveTokenAddressesUSDC.mTokenAddress
        );

        const stableDebtToken = await ethers.getContractAt(
          "StableDebtToken",
          reserveTokenAddressesUSDC.stableDebtTokenAddress
        );

        const variableDebtToken = await ethers.getContractAt(
          "VariableDebtToken",
          reserveTokenAddressesUSDC.variableDebtTokenAddress
        );

        const mMELDBalanceBefore = await mMELD.balanceOf(meldBanker);
        const mUSDCBalanceBefore = await mUSDC.balanceOf(meldBanker);

        // Get reserve data before borrowing
        const reserveDataBeforeBorrow: ReserveData = await getReserveData(
          meldProtocolDataProvider,
          await usdc.getAddress(),
          await lendingRateOracleAggregator.getAddress()
        );

        // Get user reserve data before borrowing
        const userDataBeforeBorrow: UserReserveData = await getUserData(
          lendingPool,
          meldProtocolDataProvider,
          await usdc.getAddress(),
          meldBanker.address
        );

        const borrowTx = await lendingPool
          .connect(meldBanker)
          .borrow(
            await usdc.getAddress(),
            amountToBorrow,
            RateMode.Variable,
            meldBanker.address,
            meldBankerTokenId
          );

        const blockTimestamps: BlockTimestamps =
          await getBlockTimestamps(borrowTx);

        // Calculate expected reserve data after borrowing
        const expectedReserveDataAfterBorrow: ReserveData =
          calcExpectedReserveDataAfterBorrow(
            amountToBorrow,
            RateMode.Variable,
            reserveDataBeforeBorrow,
            blockTimestamps.txTimestamp,
            blockTimestamps.latestBlockTimestamp
          );

        // Calculate expected user data after borrowing
        const expectedUserDataAfterBorrow: UserReserveData =
          calcExpectedUserDataAfterBorrow(
            amountToBorrow,
            RateMode.Variable,
            reserveDataBeforeBorrow,
            expectedReserveDataAfterBorrow,
            userDataBeforeBorrow,
            blockTimestamps.txTimestamp,
            blockTimestamps.latestBlockTimestamp
          );

        // Check token balances
        expect(await stableDebtToken.balanceOf(meldBanker.address)).to.equal(
          0n
        );

        expect(
          await stableDebtToken.principalBalanceOf(meldBanker.address)
        ).to.equal(0n);

        expect(await variableDebtToken.balanceOf(meldBanker.address)).to.equal(
          expectedUserDataAfterBorrow.currentVariableDebt
        );

        expect(
          await variableDebtToken.scaledBalanceOf(meldBanker.address)
        ).to.equal(expectedUserDataAfterBorrow.scaledVariableDebt);

        // Check variable debt total and scaled supply
        expect(await variableDebtToken.totalSupply()).to.equal(
          expectedReserveDataAfterBorrow.totalVariableDebt
        );

        expect(await variableDebtToken.scaledTotalSupply()).to.equal(
          expectedReserveDataAfterBorrow.scaledVariableDebt
        );

        // Borrower deposited MELD as collateral. No change in mMELD balance. No collateral is transferred during borrow.
        // Borrower borrowed USDC, but mUSDC balance should not change.
        expect(await mMELD.balanceOf(meldBanker.address)).to.equal(
          mMELDBalanceBefore
        );
        expect(await mUSDC.balanceOf(meldBanker.address)).to.equal(
          mUSDCBalanceBefore
        );

        // Borrower should have tokens borrowed
        expect(await usdc.balanceOf(meldBanker.address)).to.equal(
          amountToBorrow
        );
      });

      context(
        "Multiple Borrows of Same Yield Boost Asset by Same Borrower",
        async function () {
          it("Should emit the correct events when a MELD Banker holder borrows a yield boost token for the second time", async function () {
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              usdc,
              owner,
              meldBanker,
              meldBankerTokenId,
              yieldBoostStakingUSDC,
            } = await loadFixture(depositForMultipleMeldBankersFixture);

            // Borrow USDC from the lending pool
            const amountToBorrow1 = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "1000"
            );

            // First borrow - stable
            await lendingPool
              .connect(meldBanker)
              .borrow(
                await usdc.getAddress(),
                amountToBorrow1,
                RateMode.Stable,
                meldBanker.address,
                meldBankerTokenId
              );

            // Get reserve data before borrowing
            const reserveDataBeforeBorrow: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Instantiate reserve token contracts
            const reserveTokenAddresses =
              await meldProtocolDataProvider.getReserveTokensAddresses(
                await usdc.getAddress()
              );

            const mUSDC = await ethers.getContractAt(
              "MToken",
              reserveTokenAddresses.mTokenAddress
            );

            const variableDebtToken = await ethers.getContractAt(
              "VariableDebtToken",
              reserveTokenAddresses.variableDebtTokenAddress
            );

            // Borrow more USDC from the lending pool
            const amountToBorrow2 = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "1000"
            );

            // Second borrow - variable
            const borrowTx = await lendingPool
              .connect(meldBanker)
              .borrow(
                await usdc.getAddress(),
                amountToBorrow2,
                RateMode.Variable,
                meldBanker.address,
                meldBankerTokenId
              );

            const blockTimestamps: BlockTimestamps =
              await getBlockTimestamps(borrowTx);

            // Calculate expected reserve data after borrowing
            const expectedReserveDataAfterBorrow: ReserveData =
              calcExpectedReserveDataAfterBorrow(
                amountToBorrow2,
                RateMode.Variable,
                reserveDataBeforeBorrow,
                blockTimestamps.txTimestamp,
                blockTimestamps.latestBlockTimestamp
              );

            // Check that the correct events were emitted
            await expect(borrowTx)
              .to.emit(variableDebtToken, "Transfer")
              .withArgs(ZeroAddress, meldBanker.address, amountToBorrow2);

            await expect(borrowTx)
              .to.emit(variableDebtToken, "Mint")
              .withArgs(
                meldBanker.address,
                meldBanker.address,
                amountToBorrow2,
                expectedReserveDataAfterBorrow.variableBorrowIndex
              );

            // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
            const contractInstanceWithLibraryABI = await ethers.getContractAt(
              "ReserveLogic",
              await lendingPool.getAddress(),
              owner
            );

            await expect(borrowTx)
              .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
              .withArgs(
                await usdc.getAddress(),
                expectedReserveDataAfterBorrow.liquidityRate,
                expectedReserveDataAfterBorrow.stableBorrowRate,
                expectedReserveDataAfterBorrow.variableBorrowRate,
                expectedReserveDataAfterBorrow.liquidityIndex,
                expectedReserveDataAfterBorrow.variableBorrowIndex
              );

            await expect(borrowTx)
              .to.emit(usdc, "Transfer")
              .withArgs(
                await mUSDC.getAddress(),
                meldBanker.address,
                amountToBorrow2
              );

            // The Borrow event is emitted by the BorrowLogic.sol library, so we need to get the contract instance with the BorrowLogic ABI
            const contractInstanceWithBorrowLibraryABI =
              await ethers.getContractAt(
                "BorrowLogic",
                await lendingPool.getAddress(),
                owner
              );

            await expect(borrowTx)
              .to.emit(contractInstanceWithBorrowLibraryABI, "Borrow")
              .withArgs(
                await usdc.getAddress(),
                meldBanker.address,
                meldBanker.address,
                amountToBorrow2,
                RateMode.Variable,
                expectedReserveDataAfterBorrow.variableBorrowRate
              );

            await expect(borrowTx).to.not.emit(mUSDC, "Transfer");
            await expect(borrowTx).to.not.emit(mUSDC, "Mint");

            const meldBankerData = await lendingPool.userMeldBankerData(
              meldBanker.address
            );
            const yieldBoostMultiplier =
              await lendingPool.yieldBoostMultipliers(
                meldBankerData.meldBankerType,
                meldBankerData.action
              );

            const expectedStakedAmount =
              amountToBorrow1.percentMul(yieldBoostMultiplier);

            const expectedStakedAmount2 = (
              amountToBorrow1 + amountToBorrow2
            ).percentMul(yieldBoostMultiplier);

            await expect(borrowTx).to.not.emit(
              yieldBoostStakingUSDC,
              "StakePositionCreated"
            );

            await expect(borrowTx)
              .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
              .withArgs(
                meldBanker.address,
                expectedStakedAmount,
                expectedStakedAmount2
              );

            await expect(borrowTx).to.not.emit(
              lendingPool,
              "LockMeldBankerNFT"
            );

            await expect(borrowTx)
              .to.emit(lendingPool, "RefreshYieldBoostAmount")
              .withArgs(
                await usdc.getAddress(),
                meldBanker.address,
                expectedStakedAmount2
              );
          });

          it("Should update state correctly when a when a MELD Banker holder borrows a yield boost token for the second time", async function () {
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              usdc,
              meldBanker,
              meldBankerTokenId,
              yieldBoostStorageUSDC,
            } = await loadFixture(depositForMultipleMeldBankersFixture);

            // Borrow USDC from the lending pool
            const amountToBorrow1 = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "1000"
            );

            // First borrow - variable
            await lendingPool
              .connect(meldBanker)
              .borrow(
                await usdc.getAddress(),
                amountToBorrow1,
                RateMode.Variable,
                meldBanker.address,
                meldBankerTokenId
              );

            // Get reserve data before borrowing
            const reserveDataBeforeBorrow: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Get user reserve data before borrowing
            const userDataBeforeBorrow: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              meldBanker.address
            );

            // Borrow more USDC from the lending pool
            const amountToBorrow2 = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "500"
            );

            // Second borrow - stable
            const borrowTx = await lendingPool.connect(meldBanker).borrow(
              await usdc.getAddress(),
              amountToBorrow2,
              RateMode.Stable,
              meldBanker.address,
              0n // Should work even if tokenId is not passed in
            );

            const blockTimestamps: BlockTimestamps =
              await getBlockTimestamps(borrowTx);

            // Get reserve data after borrowing
            const reserveDataAfterBorrow: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Get user reserve data after borrowing
            const userDataAfterBorrow: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              meldBanker.address
            );

            // Calculate expected reserve data after borrowing
            const expectedReserveDataAfterBorrow: ReserveData =
              calcExpectedReserveDataAfterBorrow(
                amountToBorrow2,
                RateMode.Stable,
                reserveDataBeforeBorrow,
                blockTimestamps.txTimestamp,
                blockTimestamps.latestBlockTimestamp
              );

            // Calculate expected user data after borrowing
            const expectedUserDataAfterBorrow: UserReserveData =
              calcExpectedUserDataAfterBorrow(
                amountToBorrow2,
                RateMode.Stable,
                reserveDataBeforeBorrow,
                expectedReserveDataAfterBorrow,
                userDataBeforeBorrow,
                blockTimestamps.txTimestamp,
                blockTimestamps.latestBlockTimestamp
              );

            expectEqual(reserveDataAfterBorrow, expectedReserveDataAfterBorrow);
            expectEqual(userDataAfterBorrow, expectedUserDataAfterBorrow);

            expect(await lendingPool.isUsingMeldBanker(meldBanker.address)).to
              .be.true;

            expect(await lendingPool.isMeldBankerBlocked(meldBankerTokenId)).to
              .be.true;

            const meldBankerData = await lendingPool.userMeldBankerData(
              meldBanker.address
            );
            expect(meldBankerData.tokenId).to.equal(meldBankerTokenId);
            expect(meldBankerData.asset).to.equal(await usdc.getAddress());
            expect(meldBankerData.meldBankerType).to.equal(
              MeldBankerType.BANKER
            );
            expect(meldBankerData.action).to.equal(Action.BORROW);

            const yieldBoostMultiplier =
              await lendingPool.yieldBoostMultipliers(
                meldBankerData.meldBankerType,
                meldBankerData.action
              );

            const expectedStakedAmount2 = (
              amountToBorrow1 + amountToBorrow2
            ).percentMul(yieldBoostMultiplier);

            expect(
              await yieldBoostStorageUSDC.getStakerStakedAmount(
                meldBanker.address
              )
            ).to.equal(expectedStakedAmount2);
          });
        }
      ); // End Multiple Borrows of Same Yield Boost Asset by Same Borrower Context

      context(
        "Multiple Borrows of Different Yield Boost Asset by Same Borrower",
        async function () {
          it("Should emit the correct events when a MELD Banker holder borrows a second yield boost token but doesn't use NFT tokenId", async function () {
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              usdc,
              dai,
              owner,
              meldBanker,
              meldBankerTokenId,
              yieldBoostStakingDAI,
            } = await loadFixture(depositForMultipleMeldBankersFixture);

            // Borrow USDC from the lending pool
            const amountToBorrowUSDC = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "1000"
            );

            // First borrow - stable
            await lendingPool
              .connect(meldBanker)
              .borrow(
                await usdc.getAddress(),
                amountToBorrowUSDC,
                RateMode.Stable,
                meldBanker.address,
                meldBankerTokenId
              );

            // Get reserve data before borrowing
            const reserveDataBeforeBorrow: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await dai.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Instantiate reserve token contracts
            const reserveTokenAddressesDAI =
              await meldProtocolDataProvider.getReserveTokensAddresses(
                await dai.getAddress()
              );

            const mDAI = await ethers.getContractAt(
              "MToken",
              reserveTokenAddressesDAI.mTokenAddress
            );

            const variableDebtToken = await ethers.getContractAt(
              "VariableDebtToken",
              reserveTokenAddressesDAI.variableDebtTokenAddress
            );

            // Borrow DAI from the lending pool
            const amountToBorrowDAI = await convertToCurrencyDecimals(
              await dai.getAddress(),
              "1000"
            );

            // Second borrow - variable - no tokenId
            const borrowTx = await lendingPool
              .connect(meldBanker)
              .borrow(
                await dai.getAddress(),
                amountToBorrowDAI,
                RateMode.Variable,
                meldBanker.address,
                0n
              );

            const blockTimestamps: BlockTimestamps =
              await getBlockTimestamps(borrowTx);

            // Calculate expected reserve data after borrowing
            const expectedReserveDataAfterBorrow: ReserveData =
              calcExpectedReserveDataAfterBorrow(
                amountToBorrowDAI,
                RateMode.Variable,
                reserveDataBeforeBorrow,
                blockTimestamps.txTimestamp,
                blockTimestamps.latestBlockTimestamp
              );

            // Check that the correct events were emitted
            await expect(borrowTx)
              .to.emit(variableDebtToken, "Transfer")
              .withArgs(ZeroAddress, meldBanker.address, amountToBorrowDAI);

            await expect(borrowTx)
              .to.emit(variableDebtToken, "Mint")
              .withArgs(
                meldBanker.address,
                meldBanker.address,
                amountToBorrowDAI,
                expectedReserveDataAfterBorrow.variableBorrowIndex
              );

            // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
            const contractInstanceWithLibraryABI = await ethers.getContractAt(
              "ReserveLogic",
              await lendingPool.getAddress(),
              owner
            );

            await expect(borrowTx)
              .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
              .withArgs(
                await dai.getAddress(),
                expectedReserveDataAfterBorrow.liquidityRate,
                expectedReserveDataAfterBorrow.stableBorrowRate,
                expectedReserveDataAfterBorrow.variableBorrowRate,
                expectedReserveDataAfterBorrow.liquidityIndex,
                expectedReserveDataAfterBorrow.variableBorrowIndex
              );

            await expect(borrowTx)
              .to.emit(dai, "Transfer")
              .withArgs(
                await mDAI.getAddress(),
                meldBanker.address,
                amountToBorrowDAI
              );

            // The Borrow event is emitted by the BorrowLogic.sol library, so we need to get the contract instance with the BorrowLogic ABI
            const contractInstanceWithBorrowLibraryABI =
              await ethers.getContractAt(
                "BorrowLogic",
                await lendingPool.getAddress(),
                owner
              );

            await expect(borrowTx)
              .to.emit(contractInstanceWithBorrowLibraryABI, "Borrow")
              .withArgs(
                await dai.getAddress(),
                meldBanker.address,
                meldBanker.address,
                amountToBorrowDAI,
                RateMode.Variable,
                expectedReserveDataAfterBorrow.variableBorrowRate
              );

            await expect(borrowTx).to.not.emit(mDAI, "Transfer");
            await expect(borrowTx).to.not.emit(mDAI, "Mint");

            // MELD Banker second deposit but didn't use NFT tokenId, so gets treated as a regular user
            // The  DAI staking protocol is different from the USDC staking protocol, but no new stake position is created because the multiplier for a regular user 0%
            await expect(borrowTx).to.not.emit(
              yieldBoostStakingDAI,
              "StakePositionCreated"
            );

            await expect(borrowTx).to.not.emit(
              yieldBoostStakingDAI,
              "StakePositionUpdated"
            );

            await expect(borrowTx).to.not.emit(
              lendingPool,
              "LockMeldBankerNFT"
            );

            await expect(borrowTx)
              .to.emit(lendingPool, "RefreshYieldBoostAmount")
              .withArgs(await dai.getAddress(), meldBanker.address, 0n);
          });

          it("Should update state correctly when a when a MELD Banker holder borrows a yield boost token for the second time", async function () {
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              usdc,
              dai,
              meldBanker,
              meldBankerTokenId,
              yieldBoostStorageUSDC,
              yieldBoostStorageDAI,
            } = await loadFixture(depositForMultipleMeldBankersFixture);

            // Borrow USDC from the lending pool
            const amountToBorrowUSDC = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "1000"
            );

            // First borrow - variable
            await lendingPool
              .connect(meldBanker)
              .borrow(
                await usdc.getAddress(),
                amountToBorrowUSDC,
                RateMode.Variable,
                meldBanker.address,
                meldBankerTokenId
              );

            // Get reserve data before borrowing
            const reserveDataBeforeBorrow: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await dai.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Get user reserve data before borrowing
            const userDataBeforeBorrow: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await dai.getAddress(),
              meldBanker.address
            );

            // Borrow DAI from the lending pool
            const amountToBorrowDAI = await convertToCurrencyDecimals(
              await dai.getAddress(),
              "500"
            );

            // Second borrow - stable
            const borrowTx = await lendingPool
              .connect(meldBanker)
              .borrow(
                await dai.getAddress(),
                amountToBorrowDAI,
                RateMode.Stable,
                meldBanker.address,
                0n
              );

            const blockTimestamps: BlockTimestamps =
              await getBlockTimestamps(borrowTx);

            // Get reserve data after borrowing
            const reserveDataAfterBorrow: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await dai.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Get user reserve data after borrowing
            const userDataAfterBorrow: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await dai.getAddress(),
              meldBanker.address
            );

            // Calculate expected reserve data after borrowing
            const expectedReserveDataAfterBorrow: ReserveData =
              calcExpectedReserveDataAfterBorrow(
                amountToBorrowDAI,
                RateMode.Stable,
                reserveDataBeforeBorrow,
                blockTimestamps.txTimestamp,
                blockTimestamps.latestBlockTimestamp
              );

            // Calculate expected user data after borrowing
            const expectedUserDataAfterBorrow: UserReserveData =
              calcExpectedUserDataAfterBorrow(
                amountToBorrowDAI,
                RateMode.Stable,
                reserveDataBeforeBorrow,
                expectedReserveDataAfterBorrow,
                userDataBeforeBorrow,
                blockTimestamps.txTimestamp,
                blockTimestamps.latestBlockTimestamp
              );

            expectEqual(reserveDataAfterBorrow, expectedReserveDataAfterBorrow);
            expectEqual(userDataAfterBorrow, expectedUserDataAfterBorrow);

            expect(await lendingPool.isUsingMeldBanker(meldBanker.address)).to
              .be.true;

            expect(await lendingPool.isMeldBankerBlocked(meldBankerTokenId)).to
              .be.true;

            const meldBankerData = await lendingPool.userMeldBankerData(
              meldBanker.address
            );
            expect(meldBankerData.tokenId).to.equal(meldBankerTokenId);
            expect(meldBankerData.asset).to.equal(await usdc.getAddress());
            expect(meldBankerData.meldBankerType).to.equal(
              MeldBankerType.BANKER
            );
            expect(meldBankerData.action).to.equal(Action.BORROW);

            const yieldBoostMultiplier =
              await lendingPool.yieldBoostMultipliers(
                meldBankerData.meldBankerType,
                meldBankerData.action
              );

            const expectedStakedAmountUSDC =
              amountToBorrowUSDC.percentMul(yieldBoostMultiplier);

            expect(
              await yieldBoostStorageUSDC.getStakerStakedAmount(
                meldBanker.address
              )
            ).to.equal(expectedStakedAmountUSDC);

            expect(
              await yieldBoostStorageDAI.getStakerStakedAmount(
                meldBanker.address
              )
            ).to.equal(0n);
          });
        }
      ); // End Multiple Borrows of Different Yield Boost Asset by Same Borrower Context
    }); // End MELD Banker Context

    context("Golden Banker", async function () {
      it("Should emit the correct events when a MELD Banker holder borrows a yield boost token", async function () {
        const {
          lendingPool,
          meldProtocolDataProvider,
          lendingRateOracleAggregator,
          usdc,
          owner,
          goldenBanker,
          goldenBankerTokenId,
          yieldBoostStakingUSDC,
        } = await loadFixture(depositForMultipleMeldBankersFixture);

        // Borrow USDC from the lending pool
        const amountToBorrow = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "1000"
        );

        // Get reserve data before borrowing
        const reserveDataBeforeBorrow: ReserveData = await getReserveData(
          meldProtocolDataProvider,
          await usdc.getAddress(),
          await lendingRateOracleAggregator.getAddress()
        );

        // Instantiate reserve token contracts
        const reserveTokenAddresses =
          await meldProtocolDataProvider.getReserveTokensAddresses(
            await usdc.getAddress()
          );

        const mUSDC = await ethers.getContractAt(
          "MToken",
          reserveTokenAddresses.mTokenAddress
        );

        const variableDebtToken = await ethers.getContractAt(
          "VariableDebtToken",
          reserveTokenAddresses.variableDebtTokenAddress
        );

        const borrowTx = await lendingPool
          .connect(goldenBanker)
          .borrow(
            await usdc.getAddress(),
            amountToBorrow,
            RateMode.Variable,
            goldenBanker.address,
            goldenBankerTokenId
          );

        const blockTimestamps: BlockTimestamps =
          await getBlockTimestamps(borrowTx);

        // Calculate expected reserve data after borrowing
        const expectedReserveDataAfterBorrow: ReserveData =
          calcExpectedReserveDataAfterBorrow(
            amountToBorrow,
            RateMode.Variable,
            reserveDataBeforeBorrow,
            blockTimestamps.txTimestamp,
            blockTimestamps.latestBlockTimestamp
          );

        // Check that the correct events were emitted
        await expect(borrowTx)
          .to.emit(variableDebtToken, "Transfer")
          .withArgs(ZeroAddress, goldenBanker.address, amountToBorrow);

        await expect(borrowTx)
          .to.emit(variableDebtToken, "Mint")
          .withArgs(
            goldenBanker.address,
            goldenBanker.address,
            amountToBorrow,
            expectedReserveDataAfterBorrow.variableBorrowIndex
          );

        // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
        const contractInstanceWithLibraryABI = await ethers.getContractAt(
          "ReserveLogic",
          await lendingPool.getAddress(),
          owner
        );

        await expect(borrowTx)
          .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
          .withArgs(
            await usdc.getAddress(),
            expectedReserveDataAfterBorrow.liquidityRate,
            expectedReserveDataAfterBorrow.stableBorrowRate,
            expectedReserveDataAfterBorrow.variableBorrowRate,
            expectedReserveDataAfterBorrow.liquidityIndex,
            expectedReserveDataAfterBorrow.variableBorrowIndex
          );

        await expect(borrowTx)
          .to.emit(usdc, "Transfer")
          .withArgs(
            await mUSDC.getAddress(),
            goldenBanker.address,
            amountToBorrow
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
            goldenBanker.address,
            goldenBanker.address,
            amountToBorrow,
            RateMode.Variable,
            expectedReserveDataAfterBorrow.variableBorrowRate
          );

        await expect(borrowTx).to.not.emit(mUSDC, "Transfer");
        await expect(borrowTx).to.not.emit(mUSDC, "Mint");

        // MELD Banker, so should emit StakePositionCreated, StakePositionUpdated, RefreshYieldBoostAmount and LockMeldBankerNFT events
        const meldBankerData = await lendingPool.userMeldBankerData(
          goldenBanker.address
        );
        const yieldBoostMultiplier = await lendingPool.yieldBoostMultipliers(
          meldBankerData.meldBankerType,
          meldBankerData.action
        );

        const expectedStakedAmount =
          amountToBorrow.percentMul(yieldBoostMultiplier);

        await expect(borrowTx)
          .to.emit(yieldBoostStakingUSDC, "StakePositionCreated")
          .withArgs(goldenBanker.address, expectedStakedAmount);

        await expect(borrowTx)
          .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
          .withArgs(goldenBanker.address, 0, expectedStakedAmount);

        await expect(borrowTx)
          .to.emit(lendingPool, "LockMeldBankerNFT")
          .withArgs(
            await usdc.getAddress(),
            goldenBanker.address,
            goldenBankerTokenId,
            MeldBankerType.GOLDEN,
            Action.BORROW
          );

        await expect(borrowTx)
          .to.emit(lendingPool, "RefreshYieldBoostAmount")
          .withArgs(
            await usdc.getAddress(),
            goldenBanker.address,
            expectedStakedAmount
          );
      });

      it("Should update state correctly when a MELD Banker holder borrows a yield boost token", async function () {
        const {
          lendingPool,
          meldProtocolDataProvider,
          lendingRateOracleAggregator,
          usdc,
          goldenBanker,
          goldenBankerTokenId,
          yieldBoostStorageUSDC,
        } = await loadFixture(depositForMultipleMeldBankersFixture);

        // Borrow USDC from the lending pool
        const amountToBorrow = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "2000"
        );

        // Get reserve data before borrowing
        const reserveDataBeforeBorrow: ReserveData = await getReserveData(
          meldProtocolDataProvider,
          await usdc.getAddress(),
          await lendingRateOracleAggregator.getAddress()
        );

        // Get user reserve data before borrowing
        const userDataBeforeBorrow: UserReserveData = await getUserData(
          lendingPool,
          meldProtocolDataProvider,
          await usdc.getAddress(),
          goldenBanker.address
        );

        const borrowTx = await lendingPool
          .connect(goldenBanker)
          .borrow(
            await usdc.getAddress(),
            amountToBorrow,
            RateMode.Variable,
            goldenBanker.address,
            goldenBankerTokenId
          );

        const blockTimestamps: BlockTimestamps =
          await getBlockTimestamps(borrowTx);

        // Get reserve data after borrowing
        const reserveDataAfterBorrow: ReserveData = await getReserveData(
          meldProtocolDataProvider,
          await usdc.getAddress(),
          await lendingRateOracleAggregator.getAddress()
        );

        // Get user reserve data after borrowing
        const userDataAfterBorrow: UserReserveData = await getUserData(
          lendingPool,
          meldProtocolDataProvider,
          await usdc.getAddress(),
          goldenBanker.address
        );

        // Calculate expected reserve data after borrowing
        const expectedReserveDataAfterBorrow: ReserveData =
          calcExpectedReserveDataAfterBorrow(
            amountToBorrow,
            RateMode.Variable,
            reserveDataBeforeBorrow,
            blockTimestamps.txTimestamp,
            blockTimestamps.latestBlockTimestamp
          );

        // Calculate expected user data after borrowing
        const expectedUserDataAfterBorrow: UserReserveData =
          calcExpectedUserDataAfterBorrow(
            amountToBorrow,
            RateMode.Variable,
            reserveDataBeforeBorrow,
            expectedReserveDataAfterBorrow,
            userDataBeforeBorrow,
            blockTimestamps.txTimestamp,
            blockTimestamps.latestBlockTimestamp
          );

        expectEqual(reserveDataAfterBorrow, expectedReserveDataAfterBorrow);
        expectEqual(userDataAfterBorrow, expectedUserDataAfterBorrow);

        expect(await lendingPool.isUsingMeldBanker(goldenBanker.address)).to.be
          .true;

        expect(await lendingPool.isMeldBankerBlocked(goldenBankerTokenId)).to.be
          .true;

        const meldBankerData = await lendingPool.userMeldBankerData(
          goldenBanker.address
        );
        expect(meldBankerData.tokenId).to.equal(goldenBankerTokenId);
        expect(meldBankerData.asset).to.equal(await usdc.getAddress());
        expect(meldBankerData.meldBankerType).to.equal(MeldBankerType.GOLDEN);
        expect(meldBankerData.action).to.equal(Action.BORROW);

        const yieldBoostMultiplier = await lendingPool.yieldBoostMultipliers(
          meldBankerData.meldBankerType,
          meldBankerData.action
        );
        const expectedStakedAmount =
          amountToBorrow.percentMul(yieldBoostMultiplier);

        expect(
          await yieldBoostStorageUSDC.getStakerStakedAmount(
            goldenBanker.address
          )
        ).to.equal(expectedStakedAmount);
      });

      it("Should calculate correct stake amount if Golden Banker gets yield boost for borrow but has a regular deposit of a different yield boost token", async function () {
        const {
          lendingPool,
          usdc,
          dai,
          owner,
          goldenBanker,
          goldenBankerTokenId,
          yieldBoostStorageUSDC,
          yieldBoostStorageDAI,
        } = await loadFixture(depositForMultipleDepositorsFixture);

        // USDC liquidity deposited in fixture

        // MELD banker deposits DAI (a yield boost token) without NFT
        const depositAmountDAI = await allocateAndApproveTokens(
          dai,
          owner,
          goldenBanker,
          lendingPool,
          5_000n,
          0n
        );

        await lendingPool
          .connect(goldenBanker)
          .deposit(
            await dai.getAddress(),
            depositAmountDAI,
            goldenBanker.address,
            true,
            0n
          );

        // Borrow USDC from the lending pool
        const amountToBorrow = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "1000"
        );

        await lendingPool
          .connect(goldenBanker)
          .borrow(
            await usdc.getAddress(),
            amountToBorrow,
            RateMode.Variable,
            goldenBanker.address,
            goldenBankerTokenId
          );

        expect(await lendingPool.isUsingMeldBanker(goldenBanker.address)).to.be
          .true;

        expect(await lendingPool.isMeldBankerBlocked(goldenBankerTokenId)).to.be
          .true;

        // DAI and USDC have different staking protocols, so the amounts are different.
        // DAI: deposit amount * regular user deposit multiplier because user didn't use tokenId
        // USDC: Borrow amount * meld banker borrow multiplier (because it is a "borrow" action with NFT)
        const yieldBoostMultiplierDAI = await lendingPool.yieldBoostMultipliers(
          MeldBankerType.NONE,
          Action.DEPOSIT
        );

        const expectedStakedAmountDAI = depositAmountDAI.percentMul(
          yieldBoostMultiplierDAI
        );

        expect(
          await yieldBoostStorageDAI.getStakerStakedAmount(goldenBanker.address)
        ).to.equal(expectedStakedAmountDAI);

        const meldBankerData = await lendingPool.userMeldBankerData(
          goldenBanker.address
        );
        expect(meldBankerData.tokenId).to.equal(goldenBankerTokenId);
        expect(meldBankerData.asset).to.equal(await usdc.getAddress());
        expect(meldBankerData.meldBankerType).to.equal(MeldBankerType.GOLDEN);
        expect(meldBankerData.action).to.equal(Action.BORROW);

        const yieldBoostMultiplierUSDC =
          await lendingPool.yieldBoostMultipliers(
            meldBankerData.meldBankerType,
            meldBankerData.action
          );

        const expectedStakedAmountUSDC = amountToBorrow.percentMul(
          yieldBoostMultiplierUSDC
        );

        expect(
          await yieldBoostStorageUSDC.getStakerStakedAmount(
            goldenBanker.address
          )
        ).to.equal(expectedStakedAmountUSDC);
      });

      it("Should update token balances correctly when a MELD Banker holder borrows a yield boost token", async function () {
        const {
          lendingPool,
          meldProtocolDataProvider,
          lendingRateOracleAggregator,
          usdc,
          meld,
          goldenBanker,
          goldenBankerTokenId,
        } = await loadFixture(depositForMultipleMeldBankersFixture);

        // Borrow USDC from the lending pool
        const amountToBorrow = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "2000"
        );

        // Instantiate reserve token contracts for borrowed and collateral token
        const reserveTokenAddressesMELD =
          await meldProtocolDataProvider.getReserveTokensAddresses(
            await meld.getAddress()
          );

        const mMELD = await ethers.getContractAt(
          "MToken",
          reserveTokenAddressesMELD.mTokenAddress
        );

        const reserveTokenAddressesUSDC =
          await meldProtocolDataProvider.getReserveTokensAddresses(
            await usdc.getAddress()
          );

        const mUSDC = await ethers.getContractAt(
          "MToken",
          reserveTokenAddressesUSDC.mTokenAddress
        );

        const stableDebtToken = await ethers.getContractAt(
          "StableDebtToken",
          reserveTokenAddressesUSDC.stableDebtTokenAddress
        );

        const variableDebtToken = await ethers.getContractAt(
          "VariableDebtToken",
          reserveTokenAddressesUSDC.variableDebtTokenAddress
        );

        const mMELDBalanceBefore = await mMELD.balanceOf(goldenBanker);
        const mUSDCBalanceBefore = await mUSDC.balanceOf(goldenBanker);

        // Get reserve data before borrowing
        const reserveDataBeforeBorrow: ReserveData = await getReserveData(
          meldProtocolDataProvider,
          await usdc.getAddress(),
          await lendingRateOracleAggregator.getAddress()
        );

        // Get user reserve data before borrowing
        const userDataBeforeBorrow: UserReserveData = await getUserData(
          lendingPool,
          meldProtocolDataProvider,
          await usdc.getAddress(),
          goldenBanker.address
        );

        const borrowTx = await lendingPool
          .connect(goldenBanker)
          .borrow(
            await usdc.getAddress(),
            amountToBorrow,
            RateMode.Variable,
            goldenBanker.address,
            goldenBankerTokenId
          );

        const blockTimestamps: BlockTimestamps =
          await getBlockTimestamps(borrowTx);

        // Calculate expected reserve data after borrowing
        const expectedReserveDataAfterBorrow: ReserveData =
          calcExpectedReserveDataAfterBorrow(
            amountToBorrow,
            RateMode.Variable,
            reserveDataBeforeBorrow,
            blockTimestamps.txTimestamp,
            blockTimestamps.latestBlockTimestamp
          );

        // Calculate expected user data after borrowing
        const expectedUserDataAfterBorrow: UserReserveData =
          calcExpectedUserDataAfterBorrow(
            amountToBorrow,
            RateMode.Variable,
            reserveDataBeforeBorrow,
            expectedReserveDataAfterBorrow,
            userDataBeforeBorrow,
            blockTimestamps.txTimestamp,
            blockTimestamps.latestBlockTimestamp
          );

        // Check token balances
        expect(await stableDebtToken.balanceOf(goldenBanker.address)).to.equal(
          0n
        );

        expect(
          await stableDebtToken.principalBalanceOf(goldenBanker.address)
        ).to.equal(0n);

        expect(
          await variableDebtToken.balanceOf(goldenBanker.address)
        ).to.equal(expectedUserDataAfterBorrow.currentVariableDebt);

        expect(
          await variableDebtToken.scaledBalanceOf(goldenBanker.address)
        ).to.equal(expectedUserDataAfterBorrow.scaledVariableDebt);

        // Check variable debt total and scaled supply
        expect(await variableDebtToken.totalSupply()).to.equal(
          expectedReserveDataAfterBorrow.totalVariableDebt
        );

        expect(await variableDebtToken.scaledTotalSupply()).to.equal(
          expectedReserveDataAfterBorrow.scaledVariableDebt
        );

        // Borrower deposited MELD as collateral. No change in mMELD balance. No collateral is transferred during borrow.
        // Borrower borrowed USDC, but mUSDC balance should not change.
        expect(await mMELD.balanceOf(goldenBanker.address)).to.equal(
          mMELDBalanceBefore
        );
        expect(await mUSDC.balanceOf(goldenBanker.address)).to.equal(
          mUSDCBalanceBefore
        );

        // Borrower should have tokens borrowed
        expect(await usdc.balanceOf(goldenBanker.address)).to.equal(
          amountToBorrow
        );
      });

      context(
        "Multiple Borrows of Same Yield Boost Asset by Same Borrower",
        async function () {
          it("Should emit the correct events when a Golden Banker holder borrows a yield boost token for the second time", async function () {
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              usdc,
              owner,
              goldenBanker,
              goldenBankerTokenId,
              yieldBoostStakingUSDC,
            } = await loadFixture(depositForMultipleMeldBankersFixture);

            // Borrow USDC from the lending pool
            const amountToBorrow1 = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "1000"
            );

            // First borrow - stable
            await lendingPool
              .connect(goldenBanker)
              .borrow(
                await usdc.getAddress(),
                amountToBorrow1,
                RateMode.Stable,
                goldenBanker.address,
                goldenBankerTokenId
              );

            // Get reserve data before borrowing
            const reserveDataBeforeBorrow: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Instantiate reserve token contracts
            const reserveTokenAddresses =
              await meldProtocolDataProvider.getReserveTokensAddresses(
                await usdc.getAddress()
              );

            const mUSDC = await ethers.getContractAt(
              "MToken",
              reserveTokenAddresses.mTokenAddress
            );

            const variableDebtToken = await ethers.getContractAt(
              "VariableDebtToken",
              reserveTokenAddresses.variableDebtTokenAddress
            );

            // Borrow more USDC from the lending pool
            const amountToBorrow2 = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "1000"
            );

            // Second borrow - variable
            const borrowTx = await lendingPool.connect(goldenBanker).borrow(
              await usdc.getAddress(),
              amountToBorrow2,
              RateMode.Variable,
              goldenBanker.address,
              0n // Should work even if tokenId is not passed in
            );

            const blockTimestamps: BlockTimestamps =
              await getBlockTimestamps(borrowTx);

            // Calculate expected reserve data after borrowing
            const expectedReserveDataAfterBorrow: ReserveData =
              calcExpectedReserveDataAfterBorrow(
                amountToBorrow2,
                RateMode.Variable,
                reserveDataBeforeBorrow,
                blockTimestamps.txTimestamp,
                blockTimestamps.latestBlockTimestamp
              );

            // Check that the correct events were emitted
            await expect(borrowTx)
              .to.emit(variableDebtToken, "Transfer")
              .withArgs(ZeroAddress, goldenBanker.address, amountToBorrow2);

            await expect(borrowTx)
              .to.emit(variableDebtToken, "Mint")
              .withArgs(
                goldenBanker.address,
                goldenBanker.address,
                amountToBorrow2,
                expectedReserveDataAfterBorrow.variableBorrowIndex
              );

            // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
            const contractInstanceWithLibraryABI = await ethers.getContractAt(
              "ReserveLogic",
              await lendingPool.getAddress(),
              owner
            );

            await expect(borrowTx)
              .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
              .withArgs(
                await usdc.getAddress(),
                expectedReserveDataAfterBorrow.liquidityRate,
                expectedReserveDataAfterBorrow.stableBorrowRate,
                expectedReserveDataAfterBorrow.variableBorrowRate,
                expectedReserveDataAfterBorrow.liquidityIndex,
                expectedReserveDataAfterBorrow.variableBorrowIndex
              );

            await expect(borrowTx)
              .to.emit(usdc, "Transfer")
              .withArgs(
                await mUSDC.getAddress(),
                goldenBanker.address,
                amountToBorrow2
              );

            // The Borrow event is emitted by the BorrowLogic.sol library, so we need to get the contract instance with the BorrowLogic ABI
            const contractInstanceWithBorrowLibraryABI =
              await ethers.getContractAt(
                "BorrowLogic",
                await lendingPool.getAddress(),
                owner
              );

            await expect(borrowTx)
              .to.emit(contractInstanceWithBorrowLibraryABI, "Borrow")
              .withArgs(
                await usdc.getAddress(),
                goldenBanker.address,
                goldenBanker.address,
                amountToBorrow2,
                RateMode.Variable,
                expectedReserveDataAfterBorrow.variableBorrowRate
              );

            await expect(borrowTx).to.not.emit(mUSDC, "Transfer");
            await expect(borrowTx).to.not.emit(mUSDC, "Mint");

            const meldBankerData = await lendingPool.userMeldBankerData(
              goldenBanker.address
            );
            const yieldBoostMultiplier =
              await lendingPool.yieldBoostMultipliers(
                meldBankerData.meldBankerType,
                meldBankerData.action
              );

            const expectedStakedAmount =
              amountToBorrow1.percentMul(yieldBoostMultiplier);

            const expectedStakedAmount2 = (
              amountToBorrow1 + amountToBorrow2
            ).percentMul(yieldBoostMultiplier);

            await expect(borrowTx).to.not.emit(
              yieldBoostStakingUSDC,
              "StakePositionCreated"
            );

            await expect(borrowTx)
              .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
              .withArgs(
                goldenBanker.address,
                expectedStakedAmount,
                expectedStakedAmount2
              );

            await expect(borrowTx).to.not.emit(
              lendingPool,
              "LockMeldBankerNFT"
            );

            await expect(borrowTx)
              .to.emit(lendingPool, "RefreshYieldBoostAmount")
              .withArgs(
                await usdc.getAddress(),
                goldenBanker.address,
                expectedStakedAmount2
              );
          });

          it("Should update state correctly when a when a Golden Banker holder borrows a yield boost token for the second time", async function () {
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              usdc,
              goldenBanker,
              goldenBankerTokenId,
              yieldBoostStorageUSDC,
            } = await loadFixture(depositForMultipleMeldBankersFixture);

            // Borrow USDC from the lending pool
            const amountToBorrow1 = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "1000"
            );

            // First borrow - variable
            await lendingPool
              .connect(goldenBanker)
              .borrow(
                await usdc.getAddress(),
                amountToBorrow1,
                RateMode.Variable,
                goldenBanker.address,
                goldenBankerTokenId
              );

            // Get reserve data before borrowing
            const reserveDataBeforeBorrow: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Get user reserve data before borrowing
            const userDataBeforeBorrow: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              goldenBanker.address
            );

            // Borrow more USDC from the lending pool
            const amountToBorrow2 = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "500"
            );

            // Second borrow - stable
            const borrowTx = await lendingPool
              .connect(goldenBanker)
              .borrow(
                await usdc.getAddress(),
                amountToBorrow2,
                RateMode.Stable,
                goldenBanker.address,
                goldenBankerTokenId
              );

            const blockTimestamps: BlockTimestamps =
              await getBlockTimestamps(borrowTx);

            // Get reserve data after borrowing
            const reserveDataAfterBorrow: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Get user reserve data after borrowing
            const userDataAfterBorrow: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              goldenBanker.address
            );

            // Calculate expected reserve data after borrowing
            const expectedReserveDataAfterBorrow: ReserveData =
              calcExpectedReserveDataAfterBorrow(
                amountToBorrow2,
                RateMode.Stable,
                reserveDataBeforeBorrow,
                blockTimestamps.txTimestamp,
                blockTimestamps.latestBlockTimestamp
              );

            // Calculate expected user data after borrowing
            const expectedUserDataAfterBorrow: UserReserveData =
              calcExpectedUserDataAfterBorrow(
                amountToBorrow2,
                RateMode.Stable,
                reserveDataBeforeBorrow,
                expectedReserveDataAfterBorrow,
                userDataBeforeBorrow,
                blockTimestamps.txTimestamp,
                blockTimestamps.latestBlockTimestamp
              );

            expectEqual(reserveDataAfterBorrow, expectedReserveDataAfterBorrow);
            expectEqual(userDataAfterBorrow, expectedUserDataAfterBorrow);

            expect(await lendingPool.isUsingMeldBanker(goldenBanker.address)).to
              .be.true;

            expect(await lendingPool.isMeldBankerBlocked(goldenBankerTokenId))
              .to.be.true;

            const meldBankerData = await lendingPool.userMeldBankerData(
              goldenBanker.address
            );
            expect(meldBankerData.tokenId).to.equal(goldenBankerTokenId);
            expect(meldBankerData.asset).to.equal(await usdc.getAddress());
            expect(meldBankerData.meldBankerType).to.equal(
              MeldBankerType.GOLDEN
            );
            expect(meldBankerData.action).to.equal(Action.BORROW);

            const yieldBoostMultiplier =
              await lendingPool.yieldBoostMultipliers(
                meldBankerData.meldBankerType,
                meldBankerData.action
              );

            const expectedStakedAmount2 = (
              amountToBorrow1 + amountToBorrow2
            ).percentMul(yieldBoostMultiplier);

            expect(
              await yieldBoostStorageUSDC.getStakerStakedAmount(
                goldenBanker.address
              )
            ).to.equal(expectedStakedAmount2);
          });
        }
      ); // End Multiple Borrows of Same Yield Boost Asset by Same Borrower Context

      context(
        "Multiple Borrows of Different Yield Boost Asset by Same Borrower",
        async function () {
          it("Should emit the correct events when a Golden Banker holder borrows a second yield boost token but doesn't use NFT tokenId", async function () {
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              usdc,
              dai,
              owner,
              goldenBanker,
              goldenBankerTokenId,
              yieldBoostStakingDAI,
            } = await loadFixture(depositForMultipleMeldBankersFixture);

            // Borrow USDC from the lending pool
            const amountToBorrowUSDC = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "1000"
            );

            // First borrow - stable
            await lendingPool
              .connect(goldenBanker)
              .borrow(
                await usdc.getAddress(),
                amountToBorrowUSDC,
                RateMode.Stable,
                goldenBanker.address,
                goldenBankerTokenId
              );

            // Get reserve data before borrowing
            const reserveDataBeforeBorrow: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await dai.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Instantiate reserve token contracts
            const reserveTokenAddressesDAI =
              await meldProtocolDataProvider.getReserveTokensAddresses(
                await dai.getAddress()
              );

            const mDAI = await ethers.getContractAt(
              "MToken",
              reserveTokenAddressesDAI.mTokenAddress
            );

            const variableDebtToken = await ethers.getContractAt(
              "VariableDebtToken",
              reserveTokenAddressesDAI.variableDebtTokenAddress
            );

            // Borrow DAI from the lending pool
            const amountToBorrowDAI = await convertToCurrencyDecimals(
              await dai.getAddress(),
              "1000"
            );

            // Second borrow - variable - no tokenId
            const borrowTx = await lendingPool
              .connect(goldenBanker)
              .borrow(
                await dai.getAddress(),
                amountToBorrowDAI,
                RateMode.Variable,
                goldenBanker.address,
                0n
              );

            const blockTimestamps: BlockTimestamps =
              await getBlockTimestamps(borrowTx);

            // Calculate expected reserve data after borrowing
            const expectedReserveDataAfterBorrow: ReserveData =
              calcExpectedReserveDataAfterBorrow(
                amountToBorrowDAI,
                RateMode.Variable,
                reserveDataBeforeBorrow,
                blockTimestamps.txTimestamp,
                blockTimestamps.latestBlockTimestamp
              );

            // Check that the correct events were emitted
            await expect(borrowTx)
              .to.emit(variableDebtToken, "Transfer")
              .withArgs(ZeroAddress, goldenBanker.address, amountToBorrowDAI);

            await expect(borrowTx)
              .to.emit(variableDebtToken, "Mint")
              .withArgs(
                goldenBanker.address,
                goldenBanker.address,
                amountToBorrowDAI,
                expectedReserveDataAfterBorrow.variableBorrowIndex
              );

            // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
            const contractInstanceWithLibraryABI = await ethers.getContractAt(
              "ReserveLogic",
              await lendingPool.getAddress(),
              owner
            );

            await expect(borrowTx)
              .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
              .withArgs(
                await dai.getAddress(),
                expectedReserveDataAfterBorrow.liquidityRate,
                expectedReserveDataAfterBorrow.stableBorrowRate,
                expectedReserveDataAfterBorrow.variableBorrowRate,
                expectedReserveDataAfterBorrow.liquidityIndex,
                expectedReserveDataAfterBorrow.variableBorrowIndex
              );

            await expect(borrowTx)
              .to.emit(dai, "Transfer")
              .withArgs(
                await mDAI.getAddress(),
                goldenBanker.address,
                amountToBorrowDAI
              );

            // The Borrow event is emitted by the BorrowLogic.sol library, so we need to get the contract instance with the BorrowLogic ABI
            const contractInstanceWithBorrowLibraryABI =
              await ethers.getContractAt(
                "BorrowLogic",
                await lendingPool.getAddress(),
                owner
              );

            await expect(borrowTx)
              .to.emit(contractInstanceWithBorrowLibraryABI, "Borrow")
              .withArgs(
                await dai.getAddress(),
                goldenBanker.address,
                goldenBanker.address,
                amountToBorrowDAI,
                RateMode.Variable,
                expectedReserveDataAfterBorrow.variableBorrowRate
              );

            await expect(borrowTx).to.not.emit(mDAI, "Transfer");
            await expect(borrowTx).to.not.emit(mDAI, "Mint");

            // Golden Banker second deposit but didn't use NFT tokenId, so gets treated as a regular user
            // The  DAI staking protocol is different from the USDC staking protocol, but no new stake position is created because the multiplier for a regular user is 0%
            await expect(borrowTx).to.not.emit(
              yieldBoostStakingDAI,
              "StakePositionCreated"
            );

            await expect(borrowTx).to.not.emit(
              yieldBoostStakingDAI,
              "StakePositionUpdated"
            );

            await expect(borrowTx).to.not.emit(
              lendingPool,
              "LockMeldBankerNFT"
            );

            await expect(borrowTx)
              .to.emit(lendingPool, "RefreshYieldBoostAmount")
              .withArgs(await dai.getAddress(), goldenBanker.address, 0n);
          });

          it("Should update state correctly when a when a MELD Banker holder borrows a yield boost token for the second time", async function () {
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              usdc,
              dai,
              goldenBanker,
              goldenBankerTokenId,
              yieldBoostStorageUSDC,
              yieldBoostStorageDAI,
            } = await loadFixture(depositForMultipleMeldBankersFixture);

            // Borrow USDC from the lending pool
            const amountToBorrowUSDC = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "1000"
            );

            // First borrow - variable
            await lendingPool
              .connect(goldenBanker)
              .borrow(
                await usdc.getAddress(),
                amountToBorrowUSDC,
                RateMode.Variable,
                goldenBanker.address,
                goldenBankerTokenId
              );

            // Get reserve data before borrowing
            const reserveDataBeforeBorrow: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await dai.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Get user reserve data before borrowing
            const userDataBeforeBorrow: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await dai.getAddress(),
              goldenBanker.address
            );

            // Borrow DAI from the lending pool
            const amountToBorrowDAI = await convertToCurrencyDecimals(
              await dai.getAddress(),
              "500"
            );

            // Second borrow - stable
            const borrowTx = await lendingPool
              .connect(goldenBanker)
              .borrow(
                await dai.getAddress(),
                amountToBorrowDAI,
                RateMode.Stable,
                goldenBanker.address,
                0n
              );

            const blockTimestamps: BlockTimestamps =
              await getBlockTimestamps(borrowTx);

            // Get reserve data after borrowing
            const reserveDataAfterBorrow: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await dai.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Get user reserve data after borrowing
            const userDataAfterBorrow: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await dai.getAddress(),
              goldenBanker.address
            );

            // Calculate expected reserve data after borrowing
            const expectedReserveDataAfterBorrow: ReserveData =
              calcExpectedReserveDataAfterBorrow(
                amountToBorrowDAI,
                RateMode.Stable,
                reserveDataBeforeBorrow,
                blockTimestamps.txTimestamp,
                blockTimestamps.latestBlockTimestamp
              );

            // Calculate expected user data after borrowing
            const expectedUserDataAfterBorrow: UserReserveData =
              calcExpectedUserDataAfterBorrow(
                amountToBorrowDAI,
                RateMode.Stable,
                reserveDataBeforeBorrow,
                expectedReserveDataAfterBorrow,
                userDataBeforeBorrow,
                blockTimestamps.txTimestamp,
                blockTimestamps.latestBlockTimestamp
              );

            expectEqual(reserveDataAfterBorrow, expectedReserveDataAfterBorrow);
            expectEqual(userDataAfterBorrow, expectedUserDataAfterBorrow);

            expect(await lendingPool.isUsingMeldBanker(goldenBanker.address)).to
              .be.true;

            expect(await lendingPool.isMeldBankerBlocked(goldenBankerTokenId))
              .to.be.true;

            const meldBankerData = await lendingPool.userMeldBankerData(
              goldenBanker.address
            );
            expect(meldBankerData.tokenId).to.equal(goldenBankerTokenId);
            expect(meldBankerData.asset).to.equal(await usdc.getAddress());
            expect(meldBankerData.meldBankerType).to.equal(
              MeldBankerType.GOLDEN
            );
            expect(meldBankerData.action).to.equal(Action.BORROW);

            const yieldBoostMultiplier =
              await lendingPool.yieldBoostMultipliers(
                meldBankerData.meldBankerType,
                meldBankerData.action
              );

            const expectedStakedAmountUSDC =
              amountToBorrowUSDC.percentMul(yieldBoostMultiplier);

            expect(
              await yieldBoostStorageUSDC.getStakerStakedAmount(
                goldenBanker.address
              )
            ).to.equal(expectedStakedAmountUSDC);

            expect(
              await yieldBoostStorageDAI.getStakerStakedAmount(
                goldenBanker.address
              )
            ).to.equal(0n);
          });
        }
      ); // End Multiple Borrows of Different Yield Boost Asset by Same Borrower Context
    }); // End Golden Banker Context
  }); // End Happy Flow Test Cases Context

  context("Error Test Cases", async function () {
    it("Should revert if the asset address is the zero address", async function () {
      const { lendingPool, meld, borrower } = await loadFixture(
        depositForMultipleDepositorsFixture
      );

      const amountToBorrow = await convertToCurrencyDecimals(
        await meld.getAddress(),
        "2500"
      );

      await expect(
        lendingPool
          .connect(borrower)
          .borrow(
            ZeroAddress,
            amountToBorrow,
            RateMode.Stable,
            borrower.address,
            0
          )
      ).to.revertedWith(ProtocolErrors.INVALID_ADDRESS);
    });

    it("Should revert if the asset address is an unsupported token", async function () {
      const { lendingPool, unsupportedToken, borrower } = await loadFixture(
        depositForMultipleDepositorsFixture
      );

      const amountToBorrow = await convertToCurrencyDecimals(
        await unsupportedToken.getAddress(),
        "2500"
      );

      await expect(
        lendingPool
          .connect(borrower)
          .borrow(
            await unsupportedToken.getAddress(),
            amountToBorrow,
            RateMode.Stable,
            borrower.address,
            0
          )
      ).to.revertedWith(ProtocolErrors.VL_NO_ACTIVE_RESERVE);
    });

    it("Should revert if onBehalfOf is the zero address", async function () {
      const { lendingPool, meld, borrower } = await loadFixture(
        depositForMultipleDepositorsFixture
      );

      const amountToBorrow = await convertToCurrencyDecimals(
        await meld.getAddress(),
        "2500"
      );

      await expect(
        lendingPool
          .connect(borrower)
          .borrow(
            await meld.getAddress(),
            amountToBorrow,
            RateMode.Stable,
            ZeroAddress,
            0
          )
      ).to.revertedWith(ProtocolErrors.INVALID_ADDRESS);
    });

    it("Should revert if reserve is not active", async function () {
      const {
        lendingPool,
        lendingPoolConfigurator,
        meld,
        borrower,
        poolAdmin,
      } = await loadFixture(setUpTestFixture);

      const amountToBorrow = await convertToCurrencyDecimals(
        await meld.getAddress(),
        "2500"
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
          .borrow(
            await meld.getAddress(),
            amountToBorrow,
            RateMode.Stable,
            borrower.address,
            0
          )
      ).to.revertedWith(ProtocolErrors.VL_NO_ACTIVE_RESERVE);
    });

    it("Should revert if reserve is frozen", async function () {
      const {
        lendingPool,
        lendingPoolConfigurator,
        meld,
        borrower,
        poolAdmin,
      } = await loadFixture(setUpTestFixture);

      await expect(
        await lendingPoolConfigurator
          .connect(poolAdmin)
          .freezeReserve(await meld.getAddress())
      )
        .to.emit(lendingPoolConfigurator, "ReserveFrozen")
        .withArgs(await meld.getAddress());

      const amountToBorrow = await convertToCurrencyDecimals(
        await meld.getAddress(),
        "2500"
      );

      await expect(
        lendingPool
          .connect(borrower)
          .borrow(
            await meld.getAddress(),
            amountToBorrow,
            RateMode.Stable,
            borrower.address,
            0
          )
      ).to.revertedWith(ProtocolErrors.VL_RESERVE_FROZEN);
    });

    it("Should revert if the amount is 0", async function () {
      const { lendingPool, meld, borrower } = await loadFixture(
        depositForMultipleDepositorsFixture
      );

      await expect(
        lendingPool
          .connect(borrower)
          .borrow(
            await meld.getAddress(),
            0n,
            RateMode.Stable,
            borrower.address,
            0
          )
      ).to.revertedWith(ProtocolErrors.VL_INVALID_AMOUNT);
    });

    it("Should revert if borrowing is not enabled", async function () {
      const {
        lendingPool,
        lendingPoolConfigurator,
        meld,
        borrower,
        poolAdmin,
      } = await loadFixture(setUpTestFixture);

      const amountToBorrow = await convertToCurrencyDecimals(
        await meld.getAddress(),
        "2500"
      );

      await expect(
        lendingPoolConfigurator
          .connect(poolAdmin)
          .disableBorrowingOnReserve(await meld.getAddress())
      )
        .to.emit(lendingPoolConfigurator, "BorrowingDisabledOnReserve")
        .withArgs(await meld.getAddress());

      await expect(
        lendingPool
          .connect(borrower)
          .borrow(
            await meld.getAddress(),
            amountToBorrow,
            RateMode.Stable,
            borrower.address,
            0
          )
      ).to.revertedWith(ProtocolErrors.VL_BORROWING_NOT_ENABLED);
    });

    it("Should revert if interest rate mode is invalid", async function () {
      const { lendingPool, meld, borrower } = await loadFixture(
        depositForMultipleDepositorsFixture
      );

      const amountToBorrow = await convertToCurrencyDecimals(
        await meld.getAddress(),
        "2500"
      );

      await expect(
        lendingPool
          .connect(borrower)
          .borrow(
            await meld.getAddress(),
            amountToBorrow,
            "3",
            borrower.address,
            0
          )
      ).to.revertedWith(ProtocolErrors.VL_INVALID_INTEREST_RATE_MODE_SELECTED);

      await expect(
        lendingPool
          .connect(borrower)
          .borrow(
            await meld.getAddress(),
            amountToBorrow,
            RateMode.None,
            borrower.address,
            0
          )
      ).to.revertedWith(ProtocolErrors.VL_INVALID_INTEREST_RATE_MODE_SELECTED);
    });

    it("Should revert if user collateral balance is not > 0", async function () {
      const {
        lendingPool,
        lendingPoolConfigurator,
        meld,
        borrower,
        poolAdmin,
      } = await loadFixture(setUpTestFixture);

      await expect(
        await lendingPoolConfigurator
          .connect(poolAdmin)
          .enableBorrowingOnReserve(await meld.getAddress(), true)
      )
        .to.emit(lendingPoolConfigurator, "BorrowingEnabledOnReserve")
        .withArgs(await meld.getAddress(), true);

      //Configure Reserve values. LTV must be > 0 and userConfig.isUsingAsCollateral must be true in order for the code to check if the user has collateral
      const poolConfig: PoolConfiguration = loadPoolConfigForEnv();

      const { ReservesConfig } = poolConfig as IMeldConfiguration;

      await expect(
        lendingPoolConfigurator
          .connect(poolAdmin)
          .configureReserveAsCollateral(
            await meld.getAddress(),
            ReservesConfig.MELD.baseLTVAsCollateral,
            ReservesConfig.MELD.liquidationThreshold,
            ReservesConfig.MELD.liquidationBonus
          )
      )
        .to.emit(lendingPoolConfigurator, "CollateralConfigurationChanged")
        .withArgs(
          await meld.getAddress(),
          ReservesConfig.MELD.baseLTVAsCollateral,
          ReservesConfig.MELD.liquidationThreshold,
          ReservesConfig.MELD.liquidationBonus
        );

      const amountToBorrow = await convertToCurrencyDecimals(
        await meld.getAddress(),
        "2500"
      );

      await expect(
        lendingPool
          .connect(borrower)
          .borrow(
            await meld.getAddress(),
            amountToBorrow,
            RateMode.Stable,
            borrower.address,
            0
          )
      ).to.revertedWith(ProtocolErrors.VL_COLLATERAL_BALANCE_IS_0);
    });

    it("Should revert if health factor is < threshold", async function () {
      //Threshold is 1e18

      const {
        lendingPool,
        meldPriceOracle,
        priceOracleAggregator,
        meld,
        usdc,
        borrower,
        oracleAdmin,
      } = await loadFixture(depositForMultipleDepositorsFixture);

      const amountToBorrow = await convertToCurrencyDecimals(
        await meld.getAddress(),
        "2500"
      );

      await lendingPool
        .connect(borrower)
        .borrow(
          await meld.getAddress(),
          amountToBorrow,
          RateMode.Variable,
          borrower.address,
          0
        );

      // Simulate time passing
      await time.increase(ONE_YEAR / 2);

      // Simulate price of collateral (USDC) going down drastically
      const [currentPrice, oracleSuccess] =
        await priceOracleAggregator.getAssetPrice(await usdc.getAddress());
      expect(oracleSuccess).to.be.true;
      await meldPriceOracle
        .connect(oracleAdmin)
        .setAssetPrice(await usdc.getAddress(), currentPrice / 10n);

      await expect(
        lendingPool
          .connect(borrower)
          .borrow(
            await meld.getAddress(),
            amountToBorrow * 2n,
            RateMode.Variable,
            borrower.address,
            0
          )
      ).to.revertedWith(
        ProtocolErrors.VL_HEALTH_FACTOR_LOWER_THAN_LIQUIDATION_THRESHOLD
      );
    });

    it("Should revert if collateral cannot cover new borrow", async function () {
      const { lendingPool, meld, borrower3 } = await loadFixture(
        depositForMultipleDepositorsFixture
      );

      const amountToBorrow = await convertToCurrencyDecimals(
        await meld.getAddress(),
        "2001"
      );

      //borrower3 only has 2000 DAI as collateral
      await expect(
        lendingPool
          .connect(borrower3)
          .borrow(
            await meld.getAddress(),
            amountToBorrow,
            RateMode.Variable,
            borrower3.address,
            0
          )
      ).to.revertedWith(ProtocolErrors.VL_COLLATERAL_CANNOT_COVER_NEW_BORROW);
    });

    context("Stable Borrow", async () => {
      it("Should revert if stable borrowing is disabled", async function () {
        const {
          lendingPool,
          lendingPoolConfigurator,
          meld,
          borrower,
          poolAdmin,
        } = await loadFixture(depositForMultipleDepositorsFixture);

        await expect(
          await lendingPoolConfigurator
            .connect(poolAdmin)
            .enableBorrowingOnReserve(await meld.getAddress(), false)
        )
          .to.emit(lendingPoolConfigurator, "BorrowingEnabledOnReserve")
          .withArgs(await meld.getAddress(), false);

        const amountToBorrow = await convertToCurrencyDecimals(
          await meld.getAddress(),
          "2500"
        );

        await expect(
          lendingPool
            .connect(borrower)
            .borrow(
              await meld.getAddress(),
              amountToBorrow,
              RateMode.Stable,
              borrower.address,
              0
            )
        ).to.revertedWith(ProtocolErrors.VL_STABLE_BORROWING_NOT_ENABLED);
      });

      it("Should revert if user is using currency to be borrowed as collateral", async function () {
        const { lendingPool, usdc, borrower } = await loadFixture(
          depositForMultipleDepositorsFixture
        );

        const amountToBorrow = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "2500"
        );

        await expect(
          lendingPool
            .connect(borrower)
            .borrow(
              await usdc.getAddress(),
              amountToBorrow,
              RateMode.Stable,
              borrower.address,
              0
            )
        ).to.revertedWith(
          ProtocolErrors.VL_COLLATERAL_SAME_AS_BORROWING_CURRENCY
        );
      });
      it("Should revert if reserve LTV != 0", async function () {
        // This test case was meant to test the second condition for the VL_COLLATERAL_SAME_AS_BORROWING_CURRENCY
        // in ValidateLogic.validateBorrow. if the reserve LTV is not 0, the borrow function will revert at an earlier point in the code,
        // so it is unlikely that the second condition(reserve.configuration.getLtv() == 0 ) will ever be true. Since the second
        // condition will only be evaluated if the first condition (!userConfig.isUsingAsCollateral(reserve.id) is false, it is hard
        // to test the first and second conditions seperately. So this test is a lot like the previous test case.

        const { lendingPool, usdc, borrower } = await loadFixture(
          depositForMultipleDepositorsFixture
        );

        const amountToBorrow = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "500"
        );

        await expect(
          lendingPool
            .connect(borrower)
            .borrow(
              await usdc.getAddress(),
              amountToBorrow,
              RateMode.Stable,
              borrower.address,
              0
            )
        ).to.revertedWith(
          ProtocolErrors.VL_COLLATERAL_SAME_AS_BORROWING_CURRENCY
        );
      });

      it("Should revert if the amount to be borrowed > max stable loan percent", async function () {
        // max stable loan size is 25%
        // meld liquidity is 10,000

        const { lendingPool, meld, borrower } = await loadFixture(
          depositForMultipleDepositorsFixture
        );

        const amountToBorrow = await convertToCurrencyDecimals(
          await meld.getAddress(),
          "2501"
        );

        await expect(
          lendingPool
            .connect(borrower)
            .borrow(
              await meld.getAddress(),
              amountToBorrow,
              RateMode.Stable,
              borrower.address,
              0
            )
        ).to.revertedWith(
          ProtocolErrors.VL_AMOUNT_BIGGER_THAN_MAX_LOAN_SIZE_STABLE
        );
      });

      it("Should revert if borrow amount by a user reaches the borrow cap", async function () {
        const {
          lendingPool,
          lendingPoolConfigurator,
          meldProtocolDataProvider,
          poolAdmin,
          tether,
          borrower,
        } = await loadFixture(depositForMultipleDepositorsFixture);

        const newBorrowCapUSD = 1000n;

        // Set the USDC supply cap to 1000 USD
        await lendingPoolConfigurator
          .connect(poolAdmin)
          .setBorrowCapUSD(tether, newBorrowCapUSD);

        const [borrowCap, currentBorrowed, ,] =
          await meldProtocolDataProvider.getBorrowCapData(tether);

        const amountToBorrow = borrowCap - currentBorrowed + 1n;

        await expect(
          lendingPool
            .connect(borrower)
            .borrow(
              tether,
              amountToBorrow,
              RateMode.Stable,
              borrower.address,
              0
            )
        ).to.revertedWith(ProtocolErrors.VL_RESERVE_BORROW_CAP_REACHED);
      });

      it("Should revert if borrow amount by a user reaches the borrow cap after another borrow", async function () {
        const {
          lendingPool,
          lendingPoolConfigurator,
          meldProtocolDataProvider,
          poolAdmin,
          tether,
          borrower,
        } = await loadFixture(depositForMultipleDepositorsFixture);

        const newBorrowCapUSD = 1000n;

        // Set the USDC supply cap to 1000 USD
        await lendingPoolConfigurator
          .connect(poolAdmin)
          .setBorrowCapUSD(tether, newBorrowCapUSD);

        const firstBorrowAmount = await convertToCurrencyDecimals(
          await tether.getAddress(),
          newBorrowCapUSD.toString()
        );

        await expect(
          lendingPool
            .connect(borrower)
            .borrow(
              tether,
              firstBorrowAmount,
              RateMode.Stable,
              borrower.address,
              0
            )
        ).not.to.be.reverted;

        const [borrowCap, currentBorrowed, ,] =
          await meldProtocolDataProvider.getBorrowCapData(tether);

        expect(borrowCap).to.equal(firstBorrowAmount);
        expect(currentBorrowed).to.equal(firstBorrowAmount);

        const amountToBorrow = 1n;

        await expect(
          lendingPool
            .connect(borrower)
            .borrow(
              tether,
              amountToBorrow,
              RateMode.Stable,
              borrower.address,
              0
            )
        ).to.revertedWith(ProtocolErrors.VL_RESERVE_BORROW_CAP_REACHED);
      });

      it("Should revert if lending rate oracle returns false", async function () {
        const {
          lendingPool,
          meldLendingRateOracle,
          meld,
          borrower,
          oracleAdmin,
        } = await loadFixture(depositForMultipleDepositorsFixture);

        // Set market borrow rate to invalid value
        await meldLendingRateOracle
          .connect(oracleAdmin)
          .setMarketBorrowRate(meld, MaxUint256);

        const amountToBorrow = await convertToCurrencyDecimals(
          await meld.getAddress(),
          "2500"
        );

        await expect(
          lendingPool
            .connect(borrower)
            .borrow(
              await meld.getAddress(),
              amountToBorrow,
              RateMode.Stable,
              borrower.address,
              0
            )
        ).to.revertedWith(ProtocolErrors.INVALID_MARKET_BORROW_RATE);
      });
    }); // End of Stable Borrow Context

    context("Variable Borrow", async () => {
      it("Should revert if borrowed amount exceeds available liquidity", async function () {
        const { lendingPool, meld, usdc, borrower, owner } = await loadFixture(
          depositForMultipleDepositorsFixture
        );

        // Borrower deposits more collateral
        const amountToDeposit = await allocateAndApproveTokens(
          usdc,
          owner,
          borrower,
          lendingPool,
          1000n,
          0n
        );

        await lendingPool
          .connect(borrower)
          .deposit(
            await usdc.getAddress(),
            amountToDeposit,
            borrower.address,
            true,
            0
          );

        const amountToBorrow = await convertToCurrencyDecimals(
          await meld.getAddress(),
          "2500"
        );

        await lendingPool
          .connect(borrower)
          .borrow(
            await meld.getAddress(),
            amountToBorrow,
            RateMode.Variable,
            borrower.address,
            0
          );

        await expect(
          lendingPool
            .connect(borrower)
            .borrow(
              await meld.getAddress(),
              amountToBorrow * 4n,
              RateMode.Variable,
              borrower.address,
              0
            )
        ).to.revertedWith(
          ProtocolErrors.VL_CURRENT_AVAILABLE_LIQUIDITY_NOT_ENOUGH_FOR_BORROW
        );
      });
    }); // End of Variable Borrow Context

    context("Meld Banker NFT and Yield Boost", async function () {
      it("Should revert if  NFT tokenId is provided but yield boost is not enabled", async function () {
        // First deploy protocol, create and initialize the reserve
        const { lendingPool, tether, meldBanker, meldBankerTokenId } =
          await loadFixture(depositForMultipleMeldBankersFixture);

        const amountToBorrow = await convertToCurrencyDecimals(
          await tether.getAddress(),
          "2500"
        );

        // Attempt to borrow
        await expect(
          lendingPool
            .connect(meldBanker)
            .borrow(
              await tether.getAddress(),
              amountToBorrow,
              RateMode.Variable,
              meldBanker.address,
              meldBankerTokenId
            )
        ).to.revertedWith(ProtocolErrors.LP_YIELD_BOOST_STAKING_NOT_ENABLED);
      });

      it("Should revert if MELD Banker holder is already using NFT", async function () {
        // First deploy protocol, create and initialize the reserve
        const { lendingPool, usdc, owner, meldBanker, meldBankerTokenId } =
          await loadFixture(setUpTestFixture);

        // MELD Banker deposits using the NFT
        const depositAmount = await allocateAndApproveTokens(
          usdc,
          owner,
          meldBanker,
          lendingPool,
          5_000n,
          0n
        );

        await lendingPool
          .connect(meldBanker)
          .deposit(
            await usdc.getAddress(),
            depositAmount,
            meldBanker.address,
            true,
            meldBankerTokenId
          );

        const amountToBorrow = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "2500"
        );

        // Attempt to borrow
        await expect(
          lendingPool
            .connect(meldBanker)
            .borrow(
              await usdc.getAddress(),
              amountToBorrow,
              RateMode.Variable,
              meldBanker.address,
              meldBankerTokenId
            )
        ).to.revertedWith(ProtocolErrors.LP_MELD_BANKER_NFT_LOCKED);
      });

      it("Should revert if Golden Banker holder is already using NFT", async function () {
        // First deploy protocol, create and initialize the reserve
        const { lendingPool, usdc, owner, goldenBanker, goldenBankerTokenId } =
          await loadFixture(setUpTestFixture);

        // Golden Banker deposits using the NFT
        const depositAmount = await allocateAndApproveTokens(
          usdc,
          owner,
          goldenBanker,
          lendingPool,
          5_000n,
          0n
        );

        await lendingPool
          .connect(goldenBanker)
          .deposit(
            await usdc.getAddress(),
            depositAmount,
            goldenBanker.address,
            true,
            goldenBankerTokenId
          );

        const amountToBorrow = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "2500"
        );

        // Attempt to borrow
        await expect(
          lendingPool
            .connect(goldenBanker)
            .borrow(
              await usdc.getAddress(),
              amountToBorrow,
              RateMode.Variable,
              goldenBanker.address,
              goldenBankerTokenId
            )
        ).to.revertedWith(ProtocolErrors.LP_MELD_BANKER_NFT_LOCKED);
      });

      it("Should revert if MELD Banker holder is already using the NFT to borrow a different asset", async function () {
        // First deploy protocol, create and initialize the reserve
        const { lendingPool, usdc, dai, meldBanker, meldBankerTokenId } =
          await loadFixture(depositForMultipleMeldBankersFixture);
        // Borrows DAI with tokenId
        const amountToBorrowDAI = await convertToCurrencyDecimals(
          await dai.getAddress(),
          "1000"
        );

        await lendingPool
          .connect(meldBanker)
          .borrow(
            await dai.getAddress(),
            amountToBorrowDAI,
            RateMode.Variable,
            meldBanker.address,
            meldBankerTokenId
          );

        // Attempt to borrow USDC with tokenId
        const amountToBorrowUSDC = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "500"
        );

        await expect(
          lendingPool
            .connect(meldBanker)
            .borrow(
              await usdc.getAddress(),
              amountToBorrowUSDC,
              RateMode.Variable,
              meldBanker.address,
              meldBankerTokenId
            )
        ).to.revertedWith(ProtocolErrors.LP_MELD_BANKER_NFT_LOCKED);
      });

      it("Should revert if Golden Banker holder is already using the NFT to borrow a different asset", async function () {
        // First deploy protocol, create and initialize the reserve
        const { lendingPool, usdc, dai, goldenBanker, goldenBankerTokenId } =
          await loadFixture(depositForMultipleMeldBankersFixture);
        // Borrows DAI with tokenId
        const amountToBorrowDAI = await convertToCurrencyDecimals(
          await dai.getAddress(),
          "1000"
        );

        await lendingPool
          .connect(goldenBanker)
          .borrow(
            await dai.getAddress(),
            amountToBorrowDAI,
            RateMode.Variable,
            goldenBanker.address,
            goldenBankerTokenId
          );

        // Attempt to borrow USDC with tokenId
        const amountToBorrowUSDC = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "500"
        );

        await expect(
          lendingPool
            .connect(goldenBanker)
            .borrow(
              await usdc.getAddress(),
              amountToBorrowUSDC,
              RateMode.Variable,
              goldenBanker.address,
              goldenBankerTokenId
            )
        ).to.revertedWith(ProtocolErrors.LP_MELD_BANKER_NFT_LOCKED);
      });

      it("Should revert if MELD Banker holder is not owner of the provided tokenId", async function () {
        // First deploy protocol, create and initialize the reserve
        const { lendingPool, usdc, meldBanker, goldenBankerTokenId } =
          await loadFixture(depositForMultipleMeldBankersFixture);

        const amountToBorrow = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "2500"
        );

        // Attempt to borrow
        await expect(
          lendingPool
            .connect(meldBanker)
            .borrow(
              await usdc.getAddress(),
              amountToBorrow,
              RateMode.Variable,
              meldBanker.address,
              goldenBankerTokenId
            )
        ).to.revertedWith(ProtocolErrors.LP_NOT_OWNER_OF_MELD_BANKER_NFT);
      });

      it("Should revert if after borrow locking NFT, a different NFT is passed in the next borrow", async function () {
        // First deploy protocol, create and initialize the reserve
        const {
          lendingPool,
          dai,
          goldenBanker,
          goldenBankerTokenId,
          bankerAdmin,
          ...contracts
        } = await loadFixture(depositForMultipleMeldBankersFixture);
        // Borrows DAI with tokenId
        const amountToBorrowDAI = await convertToCurrencyDecimals(
          await dai.getAddress(),
          "1000"
        );

        await lendingPool
          .connect(goldenBanker)
          .borrow(
            await dai.getAddress(),
            amountToBorrowDAI,
            RateMode.Variable,
            goldenBanker.address,
            goldenBankerTokenId
          );

        // Get a second NFT
        const goldenBankerTokenId2 = goldenBankerTokenId + 100n;
        await contracts.meldBankerNft
          .connect(bankerAdmin)
          .mint(goldenBanker, goldenBankerTokenId2, true);

        // Attempt to borrow DAI again with different tokenId
        await expect(
          lendingPool
            .connect(goldenBanker)
            .borrow(
              await dai.getAddress(),
              amountToBorrowDAI,
              RateMode.Variable,
              goldenBanker.address,
              goldenBankerTokenId2
            )
        ).to.revertedWith(ProtocolErrors.LP_MELD_BANKER_NFT_LOCKED);
      });

      it("Should not lock NFT if borrow reverts", async function () {
        const { lendingPool, usdc, meldBanker, meldBankerTokenId } =
          await loadFixture(depositForMultipleDepositorsFixture);

        await expect(
          lendingPool
            .connect(meldBanker)
            .borrow(
              await usdc.getAddress(),
              0n,
              RateMode.Stable,
              meldBanker.address,
              meldBankerTokenId
            )
        ).to.revertedWith(ProtocolErrors.VL_INVALID_AMOUNT);

        expect(await lendingPool.isUsingMeldBanker(meldBanker.address)).to.be
          .false;

        expect(await lendingPool.isMeldBankerBlocked(meldBankerTokenId)).to.be
          .false;
      });
    });
    context("Genius loan", async function () {
      it("Should revert if the caller does not have genius loan role", async function () {
        const { lendingPool, meld, borrower, rando } = await loadFixture(
          depositForMultipleDepositorsFixture
        );

        // Borrow MELD from the lending pool
        const amountToBorrow = await convertToCurrencyDecimals(
          await meld.getAddress(),
          "2000"
        );

        // Since rando does not have the genius loan role, it is interpreted as a credit delegation, but no borrow allowance has been given
        await expect(
          lendingPool
            .connect(rando)
            .borrow(
              await meld.getAddress(),
              amountToBorrow,
              RateMode.Stable,
              borrower,
              0
            )
        ).to.be.revertedWith(ProtocolErrors.BORROW_ALLOWANCE_NOT_ENOUGH);
      });

      it("Should revert if the user has not approved the genius loan", async function () {
        const { addressesProvider, lendingPool, meld, owner, borrower, rando } =
          await loadFixture(depositForMultipleDepositorsFixture);

        // Give rando the GENIUS_LOAN_ROLE role
        await addressesProvider
          .connect(owner)
          .grantRole(await addressesProvider.GENIUS_LOAN_ROLE(), rando);

        // Borrow MELD from the lending pool
        const amountToBorrow = await convertToCurrencyDecimals(
          await meld.getAddress(),
          "2000"
        );

        await expect(
          lendingPool
            .connect(rando)
            .borrow(
              await meld.getAddress(),
              amountToBorrow,
              RateMode.Stable,
              borrower,
              0
            )
        ).to.be.revertedWith(ProtocolErrors.LP_USER_NOT_ACCEPT_GENIUS_LOAN);
      });

      it("Should revert if the user has disabled the genius loan", async function () {
        const { addressesProvider, lendingPool, meld, owner, borrower, rando } =
          await loadFixture(depositForMultipleDepositorsFixture);

        // Give rando the GENIUS_LOAN_ROLE role
        await addressesProvider
          .connect(owner)
          .grantRole(await addressesProvider.GENIUS_LOAN_ROLE(), rando);

        await lendingPool.connect(borrower).setUserAcceptGeniusLoan(true);
        await lendingPool.connect(borrower).setUserAcceptGeniusLoan(false);

        // Borrow MELD from the lending pool
        const amountToBorrow = await convertToCurrencyDecimals(
          await meld.getAddress(),
          "2000"
        );

        await expect(
          lendingPool
            .connect(rando)
            .borrow(
              await meld.getAddress(),
              amountToBorrow,
              RateMode.Stable,
              borrower,
              0
            )
        ).to.be.revertedWith(ProtocolErrors.LP_USER_NOT_ACCEPT_GENIUS_LOAN);
      });
    }); // End of Genius loan Context
  }); // End of Error Test Cases Context
}); // End of Borrow Describe
