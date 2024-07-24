import { ethers } from "hardhat";
import { ZeroAddress, MaxUint256 } from "ethers";
import {
  allocateAndApproveTokens,
  getBlockTimestamps,
  isAlmostEqual,
  loadPoolConfigForEnv,
  setUpTestFixture,
} from "./helpers/utils/utils";
import { IMeldConfiguration, PoolConfiguration } from "./helpers/types";
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
  calcExpectedReserveDataAfterRepay,
  calcExpectedUserDataAfterRepay,
} from "./helpers/utils/calculations";
import {
  getReserveData,
  getUserData,
  expectEqual,
} from "./helpers/utils/helpers";
import { RateMode } from "./helpers/types";
import { ONE_YEAR } from "./helpers/constants";
import { expect } from "chai";
import { ProtocolErrors } from "./helpers/types";

describe("Credit Delegation", function () {
  async function setUpTestFixtureStable() {
    const {
      usdc,
      meld,
      owner,
      poolAdmin,
      treasury,
      depositor,
      depositor2,
      depositor3,
      borrower,
      borrower2,
      ...contracts
    } = await setUpTestFixture();

    // Deposit liquidity

    // USDC
    // depositor deposits collateral
    const depositAmountUSDC = await allocateAndApproveTokens(
      usdc,
      owner,
      depositor,
      contracts.lendingPool,
      20000n,
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

    // MELD
    // Approve double the amount to be deposited to test the max amount.
    const depositAmountMELD = await allocateAndApproveTokens(
      meld,
      owner,
      depositor3,
      contracts.lendingPool,
      10000n,
      2n
    );

    // depositor3 deposits MELD liquidity
    await contracts.lendingPool
      .connect(depositor3)
      .deposit(
        await meld.getAddress(),
        depositAmountMELD,
        depositor3.address,
        true,
        0
      );

    // Depositor delegates credit to borrower for stable borrowing

    // Amount to delegate to borrower
    const delegatedAmountMELDStable = await convertToCurrencyDecimals(
      await meld.getAddress(),
      "5000"
    );

    // Instantiate reserve token contracts
    const reserveTokenAddressesMELD =
      await contracts.meldProtocolDataProvider.getReserveTokensAddresses(
        await meld.getAddress()
      );

    const stableDebtTokenMELD = await ethers.getContractAt(
      "StableDebtToken",
      reserveTokenAddressesMELD.stableDebtTokenAddress
    );

    await stableDebtTokenMELD
      .connect(depositor)
      .approveDelegation(borrower.address, delegatedAmountMELDStable);
    expect(
      await stableDebtTokenMELD.borrowAllowance(
        depositor.address,
        borrower.address
      )
    ).to.be.equal(delegatedAmountMELDStable);

    return {
      ...contracts,
      usdc,
      meld,
      depositAmountMELD,
      delegatedAmountMELDStable,
      owner,
      poolAdmin,
      treasury,
      depositor,
      depositor2,
      depositor3,
      borrower,
      borrower2,
    };
  }

  async function setUpTestFixtureVariable() {
    const {
      usdc,
      meld,
      tether,
      owner,
      poolAdmin,
      oracleAdmin,
      treasury,
      depositor,
      depositor2,
      depositor3,
      borrower,
      borrower2,
      rando,
      ...contracts
    } = await setUpTestFixture();

    // Deposit liquidity

    // USDC
    // depositor deposits collateral
    const depositAmountUSDC = await allocateAndApproveTokens(
      usdc,
      owner,
      depositor,
      contracts.lendingPool,
      20000n,
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

    // MELD
    // Approve double the amount to be deposited to test the max amount.
    const depositAmountMELD = await allocateAndApproveTokens(
      meld,
      owner,
      depositor3,
      contracts.lendingPool,
      10000n,
      2n
    );

    // depositor3 deposits MELD liquidity
    await contracts.lendingPool
      .connect(depositor3)
      .deposit(
        await meld.getAddress(),
        depositAmountMELD,
        depositor3.address,
        true,
        0
      );

    // USDT
    // depositor2 deposits liquidity
    const depositAmountTether = await allocateAndApproveTokens(
      tether,
      owner,
      depositor2,
      contracts.lendingPool,
      50000n,
      0n
    );

    const depositTetherTx = await contracts.lendingPool
      .connect(depositor2)
      .deposit(
        await tether.getAddress(),
        depositAmountTether,
        depositor2.address,
        true,
        0
      );

    await expect(depositTetherTx)
      .to.emit(contracts.lendingPool, "ReserveUsedAsCollateralEnabled")
      .withArgs(await tether.getAddress(), depositor2.address);

    // Depositor delegates credit to borrower for variable borrowing

    // Amount to delegate to borrower
    const delegatedAmountMELDVariable = await convertToCurrencyDecimals(
      await meld.getAddress(),
      "10000"
    );

    // Instantiate reserve token contracts
    const reserveTokenAddressesMELD =
      await contracts.meldProtocolDataProvider.getReserveTokensAddresses(
        await meld.getAddress()
      );

    const variableDebtTokenMELD = await ethers.getContractAt(
      "VariableDebtToken",
      reserveTokenAddressesMELD.variableDebtTokenAddress
    );

    await variableDebtTokenMELD
      .connect(depositor)
      .approveDelegation(borrower.address, delegatedAmountMELDVariable);
    expect(
      await variableDebtTokenMELD.borrowAllowance(
        depositor.address,
        borrower.address
      )
    ).to.be.equal(delegatedAmountMELDVariable);

    return {
      ...contracts,
      usdc,
      meld,
      tether,
      depositAmountUSDC,
      depositAmountTether,
      depositAmountMELD,
      delegatedAmountMELDVariable,
      owner,
      poolAdmin,
      oracleAdmin,
      treasury,
      depositor,
      depositor2,
      depositor3,
      borrower,
      borrower2,
      rando,
    };
  }

  async function setUpTestFixtureCombo() {
    const {
      usdc,
      meld,
      tether,
      dai,
      owner,
      treasury,
      depositor,
      depositor2,
      depositor3,
      borrower,
      borrower2,
      ...contracts
    } = await setUpTestFixture();

    // Deposit liquidity

    // USDC
    // depositor deposits USDC collateral
    const depositAmountUSDC = await allocateAndApproveTokens(
      usdc,
      owner,
      depositor,
      contracts.lendingPool,
      20000n,
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

    // DAI
    // depositor2 deposits DAI collateral
    const depositAmountDAI = await allocateAndApproveTokens(
      dai,
      owner,
      depositor2,
      contracts.lendingPool,
      2000n,
      0n
    );

    await contracts.lendingPool
      .connect(depositor2)
      .deposit(
        await dai.getAddress(),
        depositAmountDAI,
        depositor2.address,
        true,
        0
      );

    // USDT
    // depositor3 deposits USDT liquidity
    const depositAmountTether = await allocateAndApproveTokens(
      tether,
      owner,
      depositor3,
      contracts.lendingPool,
      50000n,
      0n
    );

    const depositTetherTx = await contracts.lendingPool
      .connect(depositor3)
      .deposit(
        await tether.getAddress(),
        depositAmountTether,
        depositor3.address,
        true,
        0
      );

    await expect(depositTetherTx)
      .to.emit(contracts.lendingPool, "ReserveUsedAsCollateralEnabled")
      .withArgs(await tether.getAddress(), depositor3.address);

    // MELD
    // depositor3 deposits MELD liquidity
    const depositAmountMELD = await allocateAndApproveTokens(
      meld,
      owner,
      depositor3,
      contracts.lendingPool,
      10000n,
      2n
    );

    await contracts.lendingPool
      .connect(depositor3)
      .deposit(
        await meld.getAddress(),
        depositAmountMELD,
        depositor3.address,
        true,
        0
      );

    // Delegate credit to borrower for stable borrowing

    // Amount to delegate to borrower
    const delegatedAmountMELDStable = await convertToCurrencyDecimals(
      await meld.getAddress(),
      "5000"
    );

    const delegatedAmountTetherVariable = await convertToCurrencyDecimals(
      await tether.getAddress(),
      "4000"
    );

    // Instantiate reserve token contracts
    const reserveTokenAddressesMELD =
      await contracts.meldProtocolDataProvider.getReserveTokensAddresses(
        await meld.getAddress()
      );

    const stableDebtTokenMELD = await ethers.getContractAt(
      "StableDebtToken",
      reserveTokenAddressesMELD.stableDebtTokenAddress
    );

    const reserveTokenAddressesTether =
      await contracts.meldProtocolDataProvider.getReserveTokensAddresses(
        await tether.getAddress()
      );

    const variableDebtTokenTether = await ethers.getContractAt(
      "StableDebtToken",
      reserveTokenAddressesTether.variableDebtTokenAddress
    );

    // depositor approves delegation of credit to borrower for MELD stable borrowing
    await stableDebtTokenMELD
      .connect(depositor)
      .approveDelegation(borrower.address, delegatedAmountMELDStable);
    expect(
      await stableDebtTokenMELD.borrowAllowance(
        depositor.address,
        borrower.address
      )
    ).to.be.equal(delegatedAmountMELDStable);

    // depositor approves delegation of credit to borrower for USDT variable borrowing
    await variableDebtTokenTether
      .connect(depositor)
      .approveDelegation(borrower.address, delegatedAmountTetherVariable);
    expect(
      await variableDebtTokenTether.borrowAllowance(
        depositor.address,
        borrower.address
      )
    ).to.be.equal(delegatedAmountTetherVariable);

    return {
      ...contracts,
      usdc,
      meld,
      tether,
      dai,
      depositAmountUSDC,
      depositAmountTether,
      depositAmountMELD,
      delegatedAmountMELDStable,
      delegatedAmountTetherVariable,
      owner,
      treasury,
      depositor,
      depositor2,
      depositor3,
      borrower,
      borrower2,
    };
  }

  async function setUpVariableBorrowFixture() {
    const {
      lendingPool,
      lendingPoolConfigurator,
      meldProtocolDataProvider,
      reserveLogic,
      lendingRateOracleAggregator,
      meldLendingRateOracle,
      meldPriceOracle,
      usdc,
      meld,
      tether,
      depositAmountUSDC,
      depositAmountTether,
      depositAmountMELD,
      delegatedAmountMELDVariable,
      owner,
      depositor,
      borrower,
      rando,
    } = await loadFixture(setUpTestFixtureVariable);

    // Borrow MELD from the lending pool
    const amountToBorrow = await convertToCurrencyDecimals(
      await meld.getAddress(),
      "2000"
    );

    await lendingPool.connect(borrower).borrow(
      await meld.getAddress(),
      amountToBorrow,
      RateMode.Variable,
      depositor.address, // onBehalfOf
      0
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
      lendingPoolConfigurator,
      meldProtocolDataProvider,
      reserveLogic,
      lendingRateOracleAggregator,
      meldLendingRateOracle,
      meldPriceOracle,
      usdc,
      meld,
      tether,
      depositAmountUSDC,
      depositAmountTether,
      depositAmountMELD,
      delegatedAmountMELDVariable,
      owner,
      depositor,
      borrower,
      rando,
    };
  }

  context("Delegate Credit", async function () {
    context("Stable Debt", async function () {
      it("Should allow delegator to approve delegation of credit before funds are deposited", async function () {
        const { meldProtocolDataProvider, meld, depositor, borrower } =
          await loadFixture(setUpTestFixture);

        // Amount to delegate to borrower
        const amountToDelegate = await convertToCurrencyDecimals(
          await meld.getAddress(),
          "2000"
        );

        // Instantiate reserve token contracts
        const reserveTokenAddresses =
          await meldProtocolDataProvider.getReserveTokensAddresses(
            await meld.getAddress()
          );

        const stableDebtToken = await ethers.getContractAt(
          "StableDebtToken",
          reserveTokenAddresses.stableDebtTokenAddress
        );

        await expect(
          stableDebtToken
            .connect(depositor)
            .approveDelegation(borrower.address, amountToDelegate)
        )
          .to.emit(stableDebtToken, "BorrowAllowanceDelegated")
          .withArgs(
            depositor.address,
            borrower.address,
            await meld.getAddress(),
            amountToDelegate
          );
      });

      it("Should allow delegator to approve delegation of higher amount than has been deposited", async function () {
        const { meldProtocolDataProvider, meld, depositor, borrower } =
          await loadFixture(setUpTestFixtureStable);

        // Amount to delegate to borrower. Higher than either deposited MELD or deposited collateral
        const amountToDelegate = await convertToCurrencyDecimals(
          await meld.getAddress(),
          "30000"
        );

        // Instantiate reserve token contracts
        const reserveTokenAddresses =
          await meldProtocolDataProvider.getReserveTokensAddresses(
            await meld.getAddress()
          );

        const stableDebtToken = await ethers.getContractAt(
          "StableDebtToken",
          reserveTokenAddresses.stableDebtTokenAddress
        );

        await expect(
          stableDebtToken
            .connect(depositor)
            .approveDelegation(borrower.address, amountToDelegate)
        )
          .to.emit(stableDebtToken, "BorrowAllowanceDelegated")
          .withArgs(
            depositor.address,
            borrower.address,
            await meld.getAddress(),
            amountToDelegate
          );
      });

      it("Should return correct borrow allowance", async function () {
        const { meldProtocolDataProvider, meld, depositor, borrower } =
          await loadFixture(setUpTestFixture);

        // Amount to delegate to borrower
        const amountToDelegate = await convertToCurrencyDecimals(
          await meld.getAddress(),
          "2000"
        );

        // Instantiate reserve token contracts
        const reserveTokenAddresses =
          await meldProtocolDataProvider.getReserveTokensAddresses(
            await meld.getAddress()
          );

        const stableDebtToken = await ethers.getContractAt(
          "StableDebtToken",
          reserveTokenAddresses.stableDebtTokenAddress
        );

        await stableDebtToken
          .connect(depositor)
          .approveDelegation(borrower.address, amountToDelegate);
        expect(
          await stableDebtToken.borrowAllowance(
            depositor.address,
            borrower.address
          )
        ).to.be.equal(amountToDelegate);
      });

      it("Should allow delegator to delegate to multiple delegatees", async function () {
        const {
          meldProtocolDataProvider,
          meld,
          depositor,
          borrower,
          borrower2,
        } = await loadFixture(setUpTestFixtureStable);

        // Amount to delegate to borrower
        const amountToDelegate1 = await convertToCurrencyDecimals(
          await meld.getAddress(),
          "2000"
        );

        // Amount to delegate to borrower2
        const amountToDelegate2 = await convertToCurrencyDecimals(
          await meld.getAddress(),
          "35000"
        );

        // Instantiate reserve token contracts
        const reserveTokenAddresses =
          await meldProtocolDataProvider.getReserveTokensAddresses(
            await meld.getAddress()
          );

        const stableDebtToken = await ethers.getContractAt(
          "StableDebtToken",
          reserveTokenAddresses.stableDebtTokenAddress
        );

        await stableDebtToken
          .connect(depositor)
          .approveDelegation(borrower.address, amountToDelegate1);
        await stableDebtToken
          .connect(depositor)
          .approveDelegation(borrower2.address, amountToDelegate2);
        expect(
          await stableDebtToken.borrowAllowance(
            depositor.address,
            borrower.address
          )
        ).to.be.equal(amountToDelegate1);
        expect(
          await stableDebtToken.borrowAllowance(
            depositor.address,
            borrower2.address
          )
        ).to.be.equal(amountToDelegate2);
      });

      it("Should allow delegator to increase delegated credit if delegatee has outstanding borrows", async function () {
        const {
          lendingPool,
          meldProtocolDataProvider,
          meld,
          borrower,
          depositor,
        } = await loadFixture(setUpTestFixtureStable);

        // Borrow MELD from the lending pool
        const amountToBorrow = await convertToCurrencyDecimals(
          await meld.getAddress(),
          "2000"
        );

        // Instantiate reserve token contracts
        const reserveTokenAddresses =
          await meldProtocolDataProvider.getReserveTokensAddresses(
            await meld.getAddress()
          );

        const stableDebtToken = await ethers.getContractAt(
          "StableDebtToken",
          reserveTokenAddresses.stableDebtTokenAddress
        );

        await lendingPool
          .connect(borrower)
          .borrow(
            await meld.getAddress(),
            amountToBorrow,
            RateMode.Stable,
            depositor.address,
            0
          );

        const balanceAfterBorrow = await stableDebtToken.borrowAllowance(
          depositor.address,
          borrower.address
        );

        // Amount by which to increase delegated credit
        const increaseDelegatedAmountMELD = await convertToCurrencyDecimals(
          await meld.getAddress(),
          "1000"
        );

        // Calling approveDelegation does not actually increase delegated credit amount. It sets new amount.
        // To increase, amount must be calculated based on current balance plus amount to increase
        await stableDebtToken
          .connect(depositor)
          .approveDelegation(
            borrower.address,
            balanceAfterBorrow + increaseDelegatedAmountMELD
          );

        expect(
          await stableDebtToken.borrowAllowance(
            depositor.address,
            borrower.address
          )
        ).to.be.equal(balanceAfterBorrow + increaseDelegatedAmountMELD);
      });

      it("Should allow delegator to decrease delegated credit if delegatee has outstanding borrows", async function () {
        const {
          lendingPool,
          meldProtocolDataProvider,
          meld,
          borrower,
          depositor,
        } = await loadFixture(setUpTestFixtureStable);

        // Borrow MELD from the lending pool
        const amountToBorrow = await convertToCurrencyDecimals(
          await meld.getAddress(),
          "2000"
        );

        // Instantiate reserve token contracts
        const reserveTokenAddresses =
          await meldProtocolDataProvider.getReserveTokensAddresses(
            await meld.getAddress()
          );

        const stableDebtToken = await ethers.getContractAt(
          "StableDebtToken",
          reserveTokenAddresses.stableDebtTokenAddress
        );

        await lendingPool
          .connect(borrower)
          .borrow(
            await meld.getAddress(),
            amountToBorrow,
            RateMode.Stable,
            depositor.address,
            0
          );

        const balanceAfterBorrow = await stableDebtToken.borrowAllowance(
          depositor.address,
          borrower.address
        );

        // Amount by which to decrease delegated credit
        const decreaseDelegatedAmountMELD = await convertToCurrencyDecimals(
          await meld.getAddress(),
          "1000"
        );

        // Calling approveDelegation does not actually decrease delegated credit amount. It sets new amount.
        // To decrease, amount must be calculated based on current balance minus amount to decrease
        await stableDebtToken
          .connect(depositor)
          .approveDelegation(
            borrower.address,
            balanceAfterBorrow - decreaseDelegatedAmountMELD
          );

        expect(
          await stableDebtToken.borrowAllowance(
            depositor.address,
            borrower.address
          )
        ).to.be.equal(balanceAfterBorrow - decreaseDelegatedAmountMELD);
      });
    }); // End Stable Debt Context

    context("Variable Debt", async function () {
      it("Should allow delegator to approve delegation of credit before funds are deposited", async function () {
        const { meldProtocolDataProvider, meld, depositor, borrower } =
          await loadFixture(setUpTestFixture);

        // Amount to delegate to borrower
        const amountToDelegate = await convertToCurrencyDecimals(
          await meld.getAddress(),
          "2000"
        );

        // Instantiate reserve token contracts
        const reserveTokenAddresses =
          await meldProtocolDataProvider.getReserveTokensAddresses(
            await meld.getAddress()
          );

        const variableDebtToken = await ethers.getContractAt(
          "VariableDebtToken",
          reserveTokenAddresses.variableDebtTokenAddress
        );

        await expect(
          variableDebtToken
            .connect(depositor)
            .approveDelegation(borrower.address, amountToDelegate)
        )
          .to.emit(variableDebtToken, "BorrowAllowanceDelegated")
          .withArgs(
            depositor.address,
            borrower.address,
            await meld.getAddress(),
            amountToDelegate
          );
      });

      it("Should allow delegator to approve delegation of higher amount than has been deposited", async function () {
        const { meldProtocolDataProvider, meld, depositor, borrower } =
          await loadFixture(setUpTestFixtureVariable);

        // Amount to delegate to borrower. Higher than either deposited MELD or deposited collateral
        const amountToDelegate = await convertToCurrencyDecimals(
          await meld.getAddress(),
          "30000"
        );

        // Instantiate reserve token contracts
        const reserveTokenAddresses =
          await meldProtocolDataProvider.getReserveTokensAddresses(
            await meld.getAddress()
          );

        const variableDebtToken = await ethers.getContractAt(
          "VariableDebtToken",
          reserveTokenAddresses.variableDebtTokenAddress
        );

        await expect(
          variableDebtToken
            .connect(depositor)
            .approveDelegation(borrower.address, amountToDelegate)
        )
          .to.emit(variableDebtToken, "BorrowAllowanceDelegated")
          .withArgs(
            depositor.address,
            borrower.address,
            await meld.getAddress(),
            amountToDelegate
          );
      });

      it("Should return correct borrow allowance", async function () {
        const { meldProtocolDataProvider, meld, depositor, borrower } =
          await loadFixture(setUpTestFixture);

        // Amount to delegate to borrower
        const amountToDelegate = await convertToCurrencyDecimals(
          await meld.getAddress(),
          "2000"
        );

        // Instantiate reserve token contracts
        const reserveTokenAddresses =
          await meldProtocolDataProvider.getReserveTokensAddresses(
            await meld.getAddress()
          );

        const variableDebtToken = await ethers.getContractAt(
          "VariableDebtToken",
          reserveTokenAddresses.stableDebtTokenAddress
        );

        await variableDebtToken
          .connect(depositor)
          .approveDelegation(borrower.address, amountToDelegate);
        expect(
          await variableDebtToken.borrowAllowance(
            depositor.address,
            borrower.address
          )
        ).to.be.equal(amountToDelegate);
      });

      it("Should allow delegator to delegate to multiple delegatees", async function () {
        const {
          meldProtocolDataProvider,
          meld,
          depositor,
          borrower,
          borrower2,
        } = await loadFixture(setUpTestFixtureVariable);

        // Amount to delegate to borrower
        const amountToDelegate1 = await convertToCurrencyDecimals(
          await meld.getAddress(),
          "2000"
        );

        // Amount to delegate to borrower2
        const amountToDelegate2 = await convertToCurrencyDecimals(
          await meld.getAddress(),
          "35000"
        );

        // Instantiate reserve token contracts
        const reserveTokenAddresses =
          await meldProtocolDataProvider.getReserveTokensAddresses(
            await meld.getAddress()
          );

        const variableDebtToken = await ethers.getContractAt(
          "VariableDebtToken",
          reserveTokenAddresses.variableDebtTokenAddress
        );

        await variableDebtToken
          .connect(depositor)
          .approveDelegation(borrower.address, amountToDelegate1);
        await variableDebtToken
          .connect(depositor)
          .approveDelegation(borrower2.address, amountToDelegate2);
        expect(
          await variableDebtToken.borrowAllowance(
            depositor.address,
            borrower.address
          )
        ).to.be.equal(amountToDelegate1);
        expect(
          await variableDebtToken.borrowAllowance(
            depositor.address,
            borrower2.address
          )
        ).to.be.equal(amountToDelegate2);
      });
      it("Should allow delegator to increase delegated credit if delegatee has outstanding borrows", async function () {
        const {
          lendingPool,
          meldProtocolDataProvider,
          meld,
          borrower,
          depositor,
        } = await loadFixture(setUpTestFixtureVariable);

        // Borrow MELD from the lending pool
        const amountToBorrow = await convertToCurrencyDecimals(
          await meld.getAddress(),
          "2000"
        );

        // Instantiate reserve token contracts
        const reserveTokenAddresses =
          await meldProtocolDataProvider.getReserveTokensAddresses(
            await meld.getAddress()
          );

        const variableDebtToken = await ethers.getContractAt(
          "VariableDebtToken",
          reserveTokenAddresses.variableDebtTokenAddress
        );

        await lendingPool
          .connect(borrower)
          .borrow(
            await meld.getAddress(),
            amountToBorrow,
            RateMode.Variable,
            depositor.address,
            0
          );

        const balanceAfterBorrow = await variableDebtToken.borrowAllowance(
          depositor.address,
          borrower.address
        );

        // Amount by which to increase delegated credit
        const increaseDelegatedAmountMELD = await convertToCurrencyDecimals(
          await meld.getAddress(),
          "1000"
        );

        // Calling approveDelegation does not actually increase delegated credit amount. It sets new amount.
        // To increase, amount must be calculated based on current balance plus amount to increase
        await variableDebtToken
          .connect(depositor)
          .approveDelegation(
            borrower.address,
            balanceAfterBorrow + increaseDelegatedAmountMELD
          );

        expect(
          await variableDebtToken.borrowAllowance(
            depositor.address,
            borrower.address
          )
        ).to.be.equal(balanceAfterBorrow + increaseDelegatedAmountMELD);
      });

      it("Should allow delegator to decrease delegated credit if delegatee has outstanding borrows", async function () {
        const {
          lendingPool,
          meldProtocolDataProvider,
          meld,
          borrower,
          depositor,
        } = await loadFixture(setUpTestFixtureVariable);

        // Borrow MELD from the lending pool
        const amountToBorrow = await convertToCurrencyDecimals(
          await meld.getAddress(),
          "2000"
        );

        // Instantiate reserve token contracts
        const reserveTokenAddresses =
          await meldProtocolDataProvider.getReserveTokensAddresses(
            await meld.getAddress()
          );

        const variableDebtToken = await ethers.getContractAt(
          "VariableDebtToken",
          reserveTokenAddresses.variableDebtTokenAddress
        );

        await lendingPool
          .connect(borrower)
          .borrow(
            await meld.getAddress(),
            amountToBorrow,
            RateMode.Variable,
            depositor.address,
            0
          );

        const balanceAfterBorrow = await variableDebtToken.borrowAllowance(
          depositor.address,
          borrower.address
        );

        // Amount by which to decrease delegated credit
        const decreaseDelegatedAmountMELD = await convertToCurrencyDecimals(
          await meld.getAddress(),
          "1000"
        );

        // Calling approveDelegation does not actually decrease delegated credit amount. It sets new amount.
        // To decrease, amount must be calculated based on current balance minus amount to decrease
        await variableDebtToken
          .connect(depositor)
          .approveDelegation(
            borrower.address,
            balanceAfterBorrow - decreaseDelegatedAmountMELD
          );

        expect(
          await variableDebtToken.borrowAllowance(
            depositor.address,
            borrower.address
          )
        ).to.be.equal(balanceAfterBorrow - decreaseDelegatedAmountMELD);
      });
    }); // End Variable Debt Context
  }); // End Delegate Credit Context
  context(
    "Borrow with Credit Delegation (Uncollateralized Loans)",
    async function () {
      context("Happy Flow Test Cases", async function () {
        context(
          "Single Stable Borrow with Credit Delegation",
          async function () {
            it("Should emit correct events", async function () {
              const {
                lendingPool,
                meldProtocolDataProvider,
                lendingRateOracleAggregator,
                meld,
                owner,
                depositor,
                borrower,
                delegatedAmountMELDStable,
              } = await loadFixture(setUpTestFixtureStable);

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

              // Get depositor's user reserve data before borrowing
              const userDataBeforeBorrow: UserReserveData = await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await meld.getAddress(),
                depositor.address
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
                amountToBorrow,
                RateMode.Stable,
                depositor.address, // onBehalfOf
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
                .to.emit(stableDebtToken, "BorrowAllowanceDelegated")
                .withArgs(
                  depositor.address,
                  borrower.address,
                  await meld.getAddress(),
                  delegatedAmountMELDStable - amountToBorrow
                );

              await expect(borrowTx)
                .to.emit(stableDebtToken, "Transfer")
                .withArgs(ZeroAddress, depositor.address, amountToBorrow);

              await expect(borrowTx).to.emit(stableDebtToken, "Mint").withArgs(
                borrower.address,
                depositor.address,
                amountToBorrow,
                0n, // First borrow, so no current balance
                0n, // First borrow, so no balance increase
                expectedUserDataAfterBorrow.stableBorrowRate,
                expectedReserveDataAfterBorrow.averageStableBorrowRate,
                expectedReserveDataAfterBorrow.principalStableDebt
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
                  depositor.address,
                  amountToBorrow,
                  RateMode.Stable,
                  reserveDataBeforeBorrow.stableBorrowRate // The stable borrow rate emitted is the rate before updateInterestRates() is called
                );

              await expect(borrowTx).to.not.emit(mMELD, "Transfer");
              await expect(borrowTx).to.not.emit(mMELD, "Mint");
            });

            it("Should update state correctly", async function () {
              const {
                lendingPool,
                meldProtocolDataProvider,
                lendingRateOracleAggregator,
                meld,
                borrower,
                depositor,
              } = await loadFixture(setUpTestFixtureStable);

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

              // Get delegator user reserve data before borrowing
              const depositorUserDataBeforeBorrow: UserReserveData =
                await getUserData(
                  lendingPool,
                  meldProtocolDataProvider,
                  await meld.getAddress(),
                  depositor.address
                );

              const borrowTx = await lendingPool
                .connect(borrower)
                .borrow(
                  await meld.getAddress(),
                  amountToBorrow,
                  RateMode.Stable,
                  depositor.address,
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

              // Get delegator user reserve data after borrowing
              const depositorUserDataAfterBorrow: UserReserveData =
                await getUserData(
                  lendingPool,
                  meldProtocolDataProvider,
                  await meld.getAddress(),
                  depositor.address
                );

              // Get delegatee user reserve data after borrowing
              const borrowerUserDataAfterBorrow: UserReserveData =
                await getUserData(
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

              // Calculate expected delegator user data after borrowing
              const expectedDepositorUserDataAfterBorrow: UserReserveData =
                calcExpectedUserDataAfterBorrow(
                  amountToBorrow,
                  RateMode.Stable,
                  reserveDataBeforeBorrow,
                  expectedReserveDataAfterBorrow,
                  depositorUserDataBeforeBorrow,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp,
                  true // delegator
                );

              // Expected delegatee user data after borrowing.
              // Delegatee should have no debt, but should have received the tokens borrowed.
              const expectedBorrowerUserDataAfterBorrow: UserReserveData = {
                scaledMTokenBalance: 0n,
                currentMTokenBalance: 0n,
                currentStableDebt: 0n,
                currentVariableDebt: 0n,
                principalStableDebt: 0n,
                scaledVariableDebt: 0n,
                stableBorrowRate: 0n,
                liquidityRate: expectedReserveDataAfterBorrow.liquidityRate,
                usageAsCollateralEnabled: false,
                stableRateLastUpdated: 0n,
                walletBalanceUnderlyingAsset: amountToBorrow,
              };

              expectEqual(
                reserveDataAfterBorrow,
                expectedReserveDataAfterBorrow
              );
              expectEqual(
                depositorUserDataAfterBorrow,
                expectedDepositorUserDataAfterBorrow
              );
              expectEqual(
                borrowerUserDataAfterBorrow,
                expectedBorrowerUserDataAfterBorrow
              );
            });

            it("Should update token balances correctly", async function () {
              const {
                lendingPool,
                meldProtocolDataProvider,
                lendingRateOracleAggregator,
                meld,
                usdc,
                borrower,
                depositor, // USDC collateral depositor
                depositor3, // MELD liquidity depositor
              } = await loadFixture(setUpTestFixtureStable);

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

              // Get token balances for collateral and borrowed tokens before borrowing
              const mUSDCBalanceBefore = await mUSDC.balanceOf(
                depositor.address
              );
              const mMELDBalanceBefore = await mMELD.balanceOf(
                depositor3.address
              );

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
                  depositor.address,
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

              // The debt is assigned to the delegator (depositor)
              expect(
                await stableDebtToken.balanceOf(depositor.address)
              ).to.equal(amountToBorrow);
              expect(
                await variableDebtToken.balanceOf(depositor.address)
              ).to.equal(0n);

              // Check stable debt principal and total supply
              expect(principalSupply).to.equal(
                expectedReserveDataAfterBorrow.principalStableDebt
              );

              expect(totalSupply).to.equal(
                expectedReserveDataAfterBorrow.totalStableDebt
              );

              // Depositor3 deposited MELD liquidity. No change in mMELD balance.
              // Depositor deposited USDC as collateral, but mUSDC balance should not change.
              // No collateral is transferred during borrow.
              expect(await mMELD.balanceOf(depositor3.address)).to.equal(
                mMELDBalanceBefore
              );
              expect(await mUSDC.balanceOf(depositor.address)).to.equal(
                mUSDCBalanceBefore
              );

              // Borrower should have tokens borrowed
              expect(await meld.balanceOf(borrower.address)).to.equal(
                amountToBorrow
              );
            });

            it("Should decrease delegatee borrow allowance after borrowing", async function () {
              const {
                lendingPool,
                meldProtocolDataProvider,
                meld,
                borrower,
                depositor,
                delegatedAmountMELDStable,
              } = await loadFixture(setUpTestFixtureStable);

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

              const stableDebtToken = await ethers.getContractAt(
                "StableDebtToken",
                reserveTokenAddressesMELD.stableDebtTokenAddress
              );

              await lendingPool
                .connect(borrower)
                .borrow(
                  await meld.getAddress(),
                  amountToBorrow,
                  RateMode.Stable,
                  depositor.address,
                  0
                );

              expect(
                await stableDebtToken.borrowAllowance(
                  depositor.address,
                  borrower.address
                )
              ).to.be.equal(delegatedAmountMELDStable - amountToBorrow);
            });
          }
        ); // End Single Stable Borrow with Credit Delegation Context

        context(
          "Single Variable Borrow with Credit Delegation",
          async function () {
            it("Should emit correct events", async function () {
              const {
                lendingPool,
                meldProtocolDataProvider,
                lendingRateOracleAggregator,
                meld,
                owner,
                depositor,
                borrower,
                delegatedAmountMELDVariable,
              } = await loadFixture(setUpTestFixtureVariable);

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

              const borrowTx = await lendingPool.connect(borrower).borrow(
                await meld.getAddress(),
                amountToBorrow,
                RateMode.Variable,
                depositor.address, // onBehalfOf
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
                .to.emit(variableDebtToken, "BorrowAllowanceDelegated")
                .withArgs(
                  depositor.address,
                  borrower.address,
                  await meld.getAddress(),
                  delegatedAmountMELDVariable - amountToBorrow
                );

              await expect(borrowTx)
                .to.emit(variableDebtToken, "Transfer")
                .withArgs(ZeroAddress, depositor.address, amountToBorrow);

              await expect(borrowTx)
                .to.emit(variableDebtToken, "Mint")
                .withArgs(
                  borrower.address,
                  depositor.address,
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
                  depositor.address,
                  amountToBorrow,
                  RateMode.Variable,
                  expectedReserveDataAfterBorrow.variableBorrowRate
                );

              await expect(borrowTx).to.not.emit(mMELD, "Transfer");
              await expect(borrowTx).to.not.emit(mMELD, "Mint");
            });

            it("Should update state correctly", async function () {
              const {
                lendingPool,
                meldProtocolDataProvider,
                lendingRateOracleAggregator,
                meld,
                borrower,
                depositor,
              } = await loadFixture(setUpTestFixtureVariable);

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

              // Get delegator user reserve data before borrowing
              const depositorUserDataBeforeBorrow: UserReserveData =
                await getUserData(
                  lendingPool,
                  meldProtocolDataProvider,
                  await meld.getAddress(),
                  depositor.address
                );

              const borrowTx = await lendingPool
                .connect(borrower)
                .borrow(
                  await meld.getAddress(),
                  amountToBorrow,
                  RateMode.Variable,
                  depositor.address,
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

              // Get delegator user reserve data after borrowing
              const depositorUserDataAfterBorrow: UserReserveData =
                await getUserData(
                  lendingPool,
                  meldProtocolDataProvider,
                  await meld.getAddress(),
                  depositor.address
                );

              // Get delegatee user reserve data after borrowing
              const borrowerUserDataAfterBorrow: UserReserveData =
                await getUserData(
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

              // Calculate expected delegator user data after borrowing
              const expectedDepositorUserDataAfterBorrow: UserReserveData =
                calcExpectedUserDataAfterBorrow(
                  amountToBorrow,
                  RateMode.Variable,
                  reserveDataBeforeBorrow,
                  expectedReserveDataAfterBorrow,
                  depositorUserDataBeforeBorrow,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp,
                  true // delegator
                );

              // Expected delegatee user data after borrowing.
              // Delegatee should have no debt, but should have received the tokens borrowed.
              const expectedBorrowerUserDataAfterBorrow: UserReserveData = {
                scaledMTokenBalance: 0n,
                currentMTokenBalance: 0n,
                currentStableDebt: 0n,
                currentVariableDebt: 0n,
                principalStableDebt: 0n,
                scaledVariableDebt: 0n,
                stableBorrowRate: 0n,
                liquidityRate: expectedReserveDataAfterBorrow.liquidityRate,
                usageAsCollateralEnabled: false,
                stableRateLastUpdated: 0n,
                walletBalanceUnderlyingAsset: amountToBorrow,
              };

              expectEqual(
                reserveDataAfterBorrow,
                expectedReserveDataAfterBorrow
              );
              expectEqual(
                depositorUserDataAfterBorrow,
                expectedDepositorUserDataAfterBorrow
              );
              expectEqual(
                borrowerUserDataAfterBorrow,
                expectedBorrowerUserDataAfterBorrow
              );
            });

            it("Should update token balances correctly", async function () {
              const {
                lendingPool,
                meldProtocolDataProvider,
                lendingRateOracleAggregator,
                meld,
                usdc,
                borrower,
                depositor, // USDC collateral depositor
                depositor3, // MELD liquidity depositor
              } = await loadFixture(setUpTestFixtureVariable);

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

              // Get token balances for collateral and borrowed tokens before borrowing
              const mUSDCBalanceBefore = await mUSDC.balanceOf(
                depositor.address
              );
              const mMELDBalanceBefore = await mMELD.balanceOf(
                depositor3.address
              );

              // Get delegator's user reserve data before borrowing
              const userDataBeforeBorrow: UserReserveData = await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await meld.getAddress(),
                depositor.address
              );

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
                  RateMode.Variable,
                  depositor.address,
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

              // Calculate expected delegator user data after borrowing
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
              expect(
                await stableDebtToken.balanceOf(depositor.address)
              ).to.equal(0n);

              expect(
                await stableDebtToken.principalBalanceOf(depositor.address)
              ).to.equal(0n);

              expect(
                await variableDebtToken.balanceOf(depositor.address)
              ).to.equal(expectedUserDataAfterBorrow.currentVariableDebt);

              expect(
                await variableDebtToken.scaledBalanceOf(depositor.address)
              ).to.equal(expectedUserDataAfterBorrow.scaledVariableDebt);

              // Check variable debt total and scaled supply
              expect(await variableDebtToken.totalSupply()).to.equal(
                expectedReserveDataAfterBorrow.totalVariableDebt
              );

              expect(await variableDebtToken.scaledTotalSupply()).to.equal(
                expectedReserveDataAfterBorrow.scaledVariableDebt
              );

              // Depositor3 deposited MELD liquidity. No change in mMELD balance.
              // Depositor deposited USDC as collateral, but mUSDC balance should not change.
              // No collateral is transferred during borrow.
              expect(await mMELD.balanceOf(depositor3.address)).to.equal(
                mMELDBalanceBefore
              );
              expect(await mUSDC.balanceOf(depositor.address)).to.equal(
                mUSDCBalanceBefore
              );

              // Borrower should have tokens borrowed
              expect(await meld.balanceOf(borrower.address)).to.equal(
                amountToBorrow
              );
            });

            it("Should decrease delegatee borrow allowance after borrowing", async function () {
              const {
                lendingPool,
                meldProtocolDataProvider,
                meld,
                borrower,
                depositor,
                delegatedAmountMELDVariable,
              } = await loadFixture(setUpTestFixtureVariable);

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

              const variableDebtToken = await ethers.getContractAt(
                "VariableDebtToken",
                reserveTokenAddressesMELD.variableDebtTokenAddress
              );

              await lendingPool
                .connect(borrower)
                .borrow(
                  await meld.getAddress(),
                  amountToBorrow,
                  RateMode.Variable,
                  depositor.address,
                  0
                );

              expect(
                await variableDebtToken.borrowAllowance(
                  depositor.address,
                  borrower.address
                )
              ).to.be.equal(delegatedAmountMELDVariable - amountToBorrow);
            });
          }
        ); // End Single Variable Borrow with Credit Delegation Context

        context(
          "Multiple borrows on behalf of one delegator (depositor) by same delegatee (borrower)",
          async function () {
            it("Should emit correct events", async function () {
              const {
                lendingPool,
                meldProtocolDataProvider,
                lendingRateOracleAggregator,
                meld,
                tether,
                owner,
                borrower,
                depositor,
                delegatedAmountMELDStable,
                delegatedAmountTetherVariable,
              } = await loadFixture(setUpTestFixtureCombo);

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

              // Get delegator user reserve data before borrow 1
              const userDataBeforeBorrow: UserReserveData = await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await meld.getAddress(),
                depositor.address
              );

              const borrowTx = await lendingPool
                .connect(borrower)
                .borrow(
                  await meld.getAddress(),
                  amountToBorrow,
                  RateMode.Stable,
                  depositor.address,
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

              // Calculate expected delegator user data after borrow 1
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
                expectedCurrentBalance -
                userDataBeforeBorrow.principalStableDebt;

              // Check that the correct events were emitted
              await expect(borrowTx)
                .to.emit(stableDebtToken, "BorrowAllowanceDelegated")
                .withArgs(
                  depositor.address,
                  borrower.address,
                  await meld.getAddress(),
                  delegatedAmountMELDStable - amountToBorrow
                );

              await expect(borrowTx)
                .to.emit(stableDebtToken, "Transfer")
                .withArgs(ZeroAddress, depositor.address, amountToBorrow);

              await expect(borrowTx)
                .to.emit(stableDebtToken, "Mint")
                .withArgs(
                  borrower.address,
                  depositor.address,
                  amountToBorrow,
                  expectedCurrentBalance,
                  expectedIncrease,
                  expectedUserDataAfterBorrow.stableBorrowRate,
                  expectedReserveDataAfterBorrow.averageStableBorrowRate,
                  expectedReserveDataAfterBorrow.principalStableDebt
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
                  depositor.address,
                  amountToBorrow,
                  RateMode.Stable,
                  reserveDataBeforeBorrow.stableBorrowRate // The stable borrow rate emitted is the rate before updateInterestRates() is called
                );

              await expect(borrowTx).to.not.emit(mMELD, "Transfer");
              await expect(borrowTx).to.not.emit(mMELD, "Mint");

              await mine(10);

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
                  depositor.address,
                  0
                );

              const blockTimestamps2: BlockTimestamps =
                await getBlockTimestamps(borrowTx2);

              // Calculate expected delegatee reserve data after borrow 2
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
                .to.emit(variableDebtToken, "BorrowAllowanceDelegated")
                .withArgs(
                  depositor.address,
                  borrower.address,
                  await tether.getAddress(),
                  delegatedAmountTetherVariable - amountToBorrow2
                );

              await expect(borrowTx2)
                .to.emit(variableDebtToken, "Transfer")
                .withArgs(ZeroAddress, depositor.address, amountToBorrow2);

              await expect(borrowTx2)
                .to.emit(variableDebtToken, "Mint")
                .withArgs(
                  borrower.address,
                  depositor.address,
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
                  depositor.address,
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
                depositor,
              } = await loadFixture(setUpTestFixtureCombo);

              // First - Borrow MELD from the lending pool
              const amountToBorrow = await convertToCurrencyDecimals(
                await meld.getAddress(),
                "2000"
              );

              const borrowTx = await lendingPool
                .connect(borrower)
                .borrow(
                  await meld.getAddress(),
                  amountToBorrow,
                  RateMode.Stable,
                  depositor.address,
                  0
                );

              const blockTimestamps: BlockTimestamps =
                await getBlockTimestamps(borrowTx);

              await mine(100);

              // Get MELD reserve data before borrow 2
              const meldReserveDataBeforeBorrow2: ReserveData =
                await getReserveData(
                  meldProtocolDataProvider,
                  await meld.getAddress(),
                  await lendingRateOracleAggregator.getAddress()
                );

              // Get USDT reserve data before borrow 2
              const usdtReserveDataBeforeBorrow2: ReserveData =
                await getReserveData(
                  meldProtocolDataProvider,
                  await tether.getAddress(),
                  await lendingRateOracleAggregator.getAddress()
                );

              // Get delegator user reserve data before borrow 2
              const depositorMeldDataBeforeBorrow2: UserReserveData =
                await getUserData(
                  lendingPool,
                  meldProtocolDataProvider,
                  await meld.getAddress(),
                  depositor.address
                );

              const depositorTetherDataBeforeBorrow2: UserReserveData =
                await getUserData(
                  lendingPool,
                  meldProtocolDataProvider,
                  await tether.getAddress(),
                  depositor.address
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
                  depositor.address,
                  0
                );

              const blockTimestamps2: BlockTimestamps =
                await getBlockTimestamps(borrowTx2);

              // Calculate expected MELD reserve data after borrow 2
              const expectedMeldReserveDataAfterBorrow2: ReserveData =
                calcExpectedReserveDataAfterBorrow(
                  0n, // MELD borrowing already happened. Passing in amountToBorrow here would add it to the debt total again.
                  RateMode.Stable,
                  meldReserveDataBeforeBorrow2,
                  blockTimestamps.txTimestamp, // borrow 1 timestamp
                  blockTimestamps2.latestBlockTimestamp
                );

              // Calculate expected reserve data after borrow 2
              const expectedUsdtReserveDataAfterBorrow2: ReserveData =
                calcExpectedReserveDataAfterBorrow(
                  amountToBorrow2,
                  RateMode.Variable,
                  usdtReserveDataBeforeBorrow2,
                  blockTimestamps2.txTimestamp,
                  blockTimestamps2.latestBlockTimestamp
                );

              // Get delegator meld reserve data and expected reserve data after borrow 2
              const depositorMeldDataAfterBorrow2: UserReserveData =
                await getUserData(
                  lendingPool,
                  meldProtocolDataProvider,
                  await meld.getAddress(),
                  depositor.address
                );

              // Calculate expected delegator meld data after borrow 2
              const expectedDepositorMeldDataAfterBorrow2: UserReserveData =
                calcExpectedUserDataAfterBorrow(
                  0n, // MELD borrowing already happened. Passing in amountToBorrow here would add it to the debt total again.
                  RateMode.Stable,
                  meldReserveDataBeforeBorrow2,
                  expectedMeldReserveDataAfterBorrow2,
                  depositorMeldDataBeforeBorrow2,
                  blockTimestamps.txTimestamp, // borrow 1 timestamp
                  blockTimestamps2.latestBlockTimestamp,
                  true // delegator
                );

              // Get delegator tether reserve data and expected reserve data after borrow 2
              const depositorTetherDataAfterBorrow2: UserReserveData =
                await getUserData(
                  lendingPool,
                  meldProtocolDataProvider,
                  await tether.getAddress(),
                  depositor.address
                );

              // Calculate expected delegator tether data after borrow 2
              const expectedDepositorTetherDataAfterBorrow2: UserReserveData =
                calcExpectedUserDataAfterBorrow(
                  amountToBorrow2,
                  RateMode.Variable,
                  usdtReserveDataBeforeBorrow2,
                  expectedUsdtReserveDataAfterBorrow2,
                  depositorTetherDataBeforeBorrow2,
                  blockTimestamps2.txTimestamp,
                  blockTimestamps2.latestBlockTimestamp,
                  true // delegator
                );

              // Get delegatee user  data after borrow 2
              const borrowerMeldDataAfterBorrow2: UserReserveData =
                await getUserData(
                  lendingPool,
                  meldProtocolDataProvider,
                  await meld.getAddress(),
                  borrower.address
                );

              const borrowerTetherDataAfterBorrow2: UserReserveData =
                await getUserData(
                  lendingPool,
                  meldProtocolDataProvider,
                  await tether.getAddress(),
                  borrower.address
                );

              // Expected delegatee meld data after borrowing.
              // Delegatee should have no debt, but should have received the tokens borrowed.
              const expectedBorrowerMeldDataAfterBorrow2: UserReserveData = {
                scaledMTokenBalance: 0n,
                currentMTokenBalance: 0n,
                currentStableDebt: 0n,
                currentVariableDebt: 0n,
                principalStableDebt: 0n,
                scaledVariableDebt: 0n,
                stableBorrowRate: 0n,
                liquidityRate:
                  expectedMeldReserveDataAfterBorrow2.liquidityRate,
                usageAsCollateralEnabled: false,
                stableRateLastUpdated: 0n,
                walletBalanceUnderlyingAsset: amountToBorrow,
              };

              // Expected delegatee tether data after borrowing.
              // Delegatee should have no debt, but should have received the tokens borrowed.
              const expectedBorrowerTetherDataAfterBorrow2: UserReserveData = {
                scaledMTokenBalance: 0n,
                currentMTokenBalance: 0n,
                currentStableDebt: 0n,
                currentVariableDebt: 0n,
                principalStableDebt: 0n,
                scaledVariableDebt: 0n,
                stableBorrowRate: 0n,
                liquidityRate:
                  expectedUsdtReserveDataAfterBorrow2.liquidityRate,
                usageAsCollateralEnabled: false,
                stableRateLastUpdated: 0n,
                walletBalanceUnderlyingAsset: amountToBorrow2,
              };

              // Check that the delegator and delegatee state is correct after both borrows
              // Reserve state is checked in single borrow test cases
              expectEqual(
                depositorMeldDataAfterBorrow2,
                expectedDepositorMeldDataAfterBorrow2
              );
              expectEqual(
                depositorTetherDataAfterBorrow2,
                expectedDepositorTetherDataAfterBorrow2
              );
              expectEqual(
                borrowerMeldDataAfterBorrow2,
                expectedBorrowerMeldDataAfterBorrow2
              );
              expectEqual(
                borrowerTetherDataAfterBorrow2,
                expectedBorrowerTetherDataAfterBorrow2
              );
            });

            it("Should update token balances correctly", async function () {
              const {
                lendingPool,
                meldProtocolDataProvider,
                lendingRateOracleAggregator,
                meld,
                tether,
                usdc,
                dai,
                borrower,
                depositor, // USDC collateral depositor
                depositor2, // DAI collateral depositor
                depositor3, // MELD and USDT liquidity depositor
              } = await loadFixture(setUpTestFixtureCombo);

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

              // Get delegator MELD reserve data before borrow 1
              const userDataBeforeBorrow1: UserReserveData = await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await meld.getAddress(),
                depositor.address
              );

              // Get token balances for collateral and borrowed tokens before first borrow
              const mUSDCBalanceBefore = await mUSDC.balanceOf(
                depositor.address
              );
              const mMELDBalanceBefore = await mMELD.balanceOf(
                depositor3.address
              );

              const borrowTx = await lendingPool
                .connect(borrower)
                .borrow(
                  await meld.getAddress(),
                  amountToBorrow,
                  RateMode.Stable,
                  depositor.address,
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

              // Get delegator tether reserve data before borrow 2
              const userDataBeforeBorrow2: UserReserveData = await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await tether.getAddress(),
                depositor.address
              );

              // Second - Borrow USDT from the lending pool
              const amountToBorrow2 = await convertToCurrencyDecimals(
                await tether.getAddress(),
                "1000"
              );

              // Get token balances for collateral and borrowed tokens before second borrow
              const mDAIBalanceBefore = await mDAI.balanceOf(
                depositor2.address
              );
              const mUSDTBalanceBefore = await mUSDT.balanceOf(
                depositor3.address
              );

              const borrowTx2 = await lendingPool
                .connect(borrower)
                .borrow(
                  await tether.getAddress(),
                  amountToBorrow2,
                  RateMode.Variable,
                  depositor.address,
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
                  blockTimestamps2.latestBlockTimestamp,
                  true // delegator
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
                  blockTimestamps.latestBlockTimestamp,
                  true // delegator
                );

              // Check token balances
              expect(
                await stableDebtToken.balanceOf(depositor.address)
              ).to.equal(expecteMeldUserDataAfterBorrow1.currentStableDebt);

              expect(
                await stableDebtToken.principalBalanceOf(depositor.address)
              ).to.equal(expecteMeldUserDataAfterBorrow1.principalStableDebt);

              expect(
                await variableDebtToken.balanceOf(depositor.address)
              ).to.equal(expectedUsdtUserDataAfterBorrow2.currentVariableDebt);

              expect(
                await variableDebtToken.scaledBalanceOf(depositor.address)
              ).to.equal(expectedUsdtUserDataAfterBorrow2.scaledVariableDebt);

              // Depositor3 deposited MELD and USDT liquidity. MELD Balance should have increased due to accrued interest
              // Depositor2 deposited DAI as collateral. No change in mDAI balance.
              // Depositor deposited USDC as collateral. No change in mUSDC balance.
              // No collateral is transferred during borrow.
              expect(
                await mMELD.balanceOf(depositor3.address)
              ).to.be.greaterThan(mMELDBalanceBefore);
              expect(await mUSDT.balanceOf(depositor3.address)).to.equal(
                mUSDTBalanceBefore
              );
              expect(await mUSDC.balanceOf(depositor.address)).to.equal(
                mUSDCBalanceBefore
              );
              expect(await mDAI.balanceOf(depositor2.address)).to.equal(
                mDAIBalanceBefore
              );

              // Borrower should have tokens borrowed
              expect(await meld.balanceOf(borrower.address)).to.equal(
                amountToBorrow
              );
              expect(await tether.balanceOf(borrower.address)).to.equal(
                amountToBorrow2
              );
            });

            it("Should correctly decrease delegatee borrow allowances", async function () {
              const {
                lendingPool,
                meldProtocolDataProvider,
                meld,
                tether,
                borrower,
                depositor,
                delegatedAmountMELDStable,
                delegatedAmountTetherVariable,
              } = await loadFixture(setUpTestFixtureCombo);

              // First - Borrow MELD from the lending pool
              const amountToBorrow = await convertToCurrencyDecimals(
                await meld.getAddress(),
                "2000"
              );

              // Instantiate MELD reserve token contracts
              const reserveTokenAddressesMELD =
                await meldProtocolDataProvider.getReserveTokensAddresses(
                  await meld.getAddress()
                );

              const stableDebtToken = await ethers.getContractAt(
                "StableDebtToken",
                reserveTokenAddressesMELD.stableDebtTokenAddress
              );

              await lendingPool
                .connect(borrower)
                .borrow(
                  await meld.getAddress(),
                  amountToBorrow,
                  RateMode.Stable,
                  depositor.address,
                  0
                );

              // Second - Borrow USDT from the lending pool
              const amountToBorrow2 = await convertToCurrencyDecimals(
                await tether.getAddress(),
                "1000"
              );

              const reserveTokenAddressesUSDT =
                await meldProtocolDataProvider.getReserveTokensAddresses(
                  await tether.getAddress()
                );

              const variableDebtToken = await ethers.getContractAt(
                "VariableDebtToken",
                reserveTokenAddressesUSDT.variableDebtTokenAddress
              );

              await lendingPool
                .connect(borrower)
                .borrow(
                  await tether.getAddress(),
                  amountToBorrow2,
                  RateMode.Variable,
                  depositor.address,
                  0
                );

              expect(
                await stableDebtToken.borrowAllowance(
                  depositor.address,
                  borrower.address
                )
              ).to.be.equal(delegatedAmountMELDStable - amountToBorrow);

              expect(
                await variableDebtToken.borrowAllowance(
                  depositor.address,
                  borrower.address
                )
              ).to.be.equal(delegatedAmountTetherVariable - amountToBorrow2);
            });
          }
        ); // End Multiple Borrows on behalf of one delegator (depositor) by same delegatee (borrower) Context

        context(
          "Multiple borrows on behalf of one delegator (depositor) by different delegatees (borrowers)",
          async function () {
            it("Should emit correct events", async function () {
              const {
                lendingPool,
                meldProtocolDataProvider,
                lendingRateOracleAggregator,
                meld,
                tether,
                owner,
                borrower,
                borrower2,
                depositor,
                delegatedAmountMELDStable,
                delegatedAmountTetherVariable,
              } = await loadFixture(setUpTestFixtureCombo);

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

              // Depositor delegates to borrower2
              await variableDebtToken
                .connect(depositor)
                .approveDelegation(
                  borrower2.address,
                  delegatedAmountTetherVariable * 2n
                );
              expect(
                await variableDebtToken.borrowAllowance(
                  depositor.address,
                  borrower2.address
                )
              ).to.be.equal(delegatedAmountTetherVariable * 2n);

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
                depositor.address
              );

              const borrowTx = await lendingPool
                .connect(borrower)
                .borrow(
                  await meld.getAddress(),
                  amountToBorrow,
                  RateMode.Stable,
                  depositor.address,
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
                expectedCurrentBalance -
                userDataBeforeBorrow.principalStableDebt;

              // Check that the correct events were emitted
              await expect(borrowTx)
                .to.emit(stableDebtToken, "BorrowAllowanceDelegated")
                .withArgs(
                  depositor.address,
                  borrower.address,
                  await meld.getAddress(),
                  delegatedAmountMELDStable - amountToBorrow
                );

              await expect(borrowTx)
                .to.emit(stableDebtToken, "Transfer")
                .withArgs(ZeroAddress, depositor.address, amountToBorrow);

              await expect(borrowTx)
                .to.emit(stableDebtToken, "Mint")
                .withArgs(
                  borrower.address,
                  depositor.address,
                  amountToBorrow,
                  expectedCurrentBalance,
                  expectedIncrease,
                  expectedUserDataAfterBorrow.stableBorrowRate,
                  expectedReserveDataAfterBorrow.averageStableBorrowRate,
                  expectedReserveDataAfterBorrow.principalStableDebt
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
                  depositor.address,
                  amountToBorrow,
                  RateMode.Stable,
                  reserveDataBeforeBorrow.stableBorrowRate // The stable borrow rate emitted is the rate before updateInterestRates() is called
                );

              await expect(borrowTx).to.not.emit(mMELD, "Transfer");
              await expect(borrowTx).to.not.emit(mMELD, "Mint");

              await mine(10);

              // Second - Borrow USDT from the lending pool
              const amountToBorrow2 = await convertToCurrencyDecimals(
                await tether.getAddress(),
                "1000"
              );

              // Get reserve data before borrow 2
              const tetherReserveDataBeforeBorrow2: ReserveData =
                await getReserveData(
                  meldProtocolDataProvider,
                  await tether.getAddress(),
                  await lendingRateOracleAggregator.getAddress()
                );

              const borrowTx2 = await lendingPool
                .connect(borrower2)
                .borrow(
                  await tether.getAddress(),
                  amountToBorrow2,
                  RateMode.Variable,
                  depositor.address,
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
                .to.emit(variableDebtToken, "BorrowAllowanceDelegated")
                .withArgs(
                  depositor.address,
                  borrower2.address,
                  await tether.getAddress(),
                  delegatedAmountTetherVariable * 2n - amountToBorrow2
                );

              await expect(borrowTx2)
                .to.emit(variableDebtToken, "Transfer")
                .withArgs(ZeroAddress, depositor.address, amountToBorrow2);

              await expect(borrowTx2)
                .to.emit(variableDebtToken, "Mint")
                .withArgs(
                  borrower2.address,
                  depositor.address,
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
                  borrower2.address,
                  amountToBorrow2
                );

              await expect(borrowTx2)
                .to.emit(contractInstanceWithBorrowLibraryABI, "Borrow")
                .withArgs(
                  await tether.getAddress(),
                  borrower2.address,
                  depositor.address,
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
                borrower2,
                depositor,
                delegatedAmountTetherVariable,
              } = await loadFixture(setUpTestFixtureCombo);

              // Instantiate reserve token contracts
              const reserveTokenAddressesUSDT =
                await meldProtocolDataProvider.getReserveTokensAddresses(
                  await tether.getAddress()
                );

              const variableDebtToken = await ethers.getContractAt(
                "VariableDebtToken",
                reserveTokenAddressesUSDT.variableDebtTokenAddress
              );

              // Depositor delegates to borrower2
              await variableDebtToken
                .connect(depositor)
                .approveDelegation(
                  borrower2.address,
                  delegatedAmountTetherVariable * 2n
                );
              expect(
                await variableDebtToken.borrowAllowance(
                  depositor.address,
                  borrower2.address
                )
              ).to.be.equal(delegatedAmountTetherVariable * 2n);

              // First - Borrow MELD from the lending pool
              const amountToBorrow = await convertToCurrencyDecimals(
                await meld.getAddress(),
                "2000"
              );

              const borrowTx = await lendingPool
                .connect(borrower)
                .borrow(
                  await meld.getAddress(),
                  amountToBorrow,
                  RateMode.Stable,
                  depositor.address,
                  0
                );

              const blockTimestamps: BlockTimestamps =
                await getBlockTimestamps(borrowTx);

              await mine(100);

              // Get MELD reserve data before borrow 2
              const meldReserveDataBeforeBorrow2: ReserveData =
                await getReserveData(
                  meldProtocolDataProvider,
                  await meld.getAddress(),
                  await lendingRateOracleAggregator.getAddress()
                );

              // Get USDT reserve data before borrow 2
              const usdtReserveDataBeforeBorrow2: ReserveData =
                await getReserveData(
                  meldProtocolDataProvider,
                  await tether.getAddress(),
                  await lendingRateOracleAggregator.getAddress()
                );

              // Get delegator MELD user reserve data before borrow 2
              const depositorMeldDataBeforeBorrow2: UserReserveData =
                await getUserData(
                  lendingPool,
                  meldProtocolDataProvider,
                  await meld.getAddress(),
                  depositor.address
                );

              const depositorTetherDataBeforeBorrow2: UserReserveData =
                await getUserData(
                  lendingPool,
                  meldProtocolDataProvider,
                  await tether.getAddress(),
                  depositor.address
                );

              // Second - Borrow USDT from the lending pool
              const amountToBorrow2 = await convertToCurrencyDecimals(
                await tether.getAddress(),
                "500"
              );

              const borrowTx2 = await lendingPool
                .connect(borrower2)
                .borrow(
                  await tether.getAddress(),
                  amountToBorrow2,
                  RateMode.Variable,
                  depositor.address,
                  0
                );

              const blockTimestamps2: BlockTimestamps =
                await getBlockTimestamps(borrowTx2);

              // Calculate expected MELD reserve data after borrow 2
              const expectedMeldReserveDataAfterBorrow2: ReserveData =
                calcExpectedReserveDataAfterBorrow(
                  0n, // MELD borrowing already happened. Passing in amountToBorrow here would add it to the debt total again.
                  RateMode.Stable,
                  meldReserveDataBeforeBorrow2,
                  blockTimestamps.txTimestamp, // borrow 1 timestamp
                  blockTimestamps2.latestBlockTimestamp
                );

              // Calculate expected tether reserve data after borrow 2
              const expectedUsdtReserveDataAfterBorrow2: ReserveData =
                calcExpectedReserveDataAfterBorrow(
                  amountToBorrow2,
                  RateMode.Variable,
                  usdtReserveDataBeforeBorrow2,
                  blockTimestamps2.txTimestamp,
                  blockTimestamps2.latestBlockTimestamp
                );

              // Get delegator meld reserve data and expected reserve data after borrow 2
              const depositorMeldDataAfterBorrow2: UserReserveData =
                await getUserData(
                  lendingPool,
                  meldProtocolDataProvider,
                  await meld.getAddress(),
                  depositor.address
                );

              // Calculate expected delegator meld data after borrow 2
              const expectedDepositorMeldDataAfterBorrow2: UserReserveData =
                calcExpectedUserDataAfterBorrow(
                  0n, // MELD borrowing already happened. Passing in amountToBorrow here would add it to the debt total again.
                  RateMode.Stable,
                  meldReserveDataBeforeBorrow2,
                  expectedMeldReserveDataAfterBorrow2,
                  depositorMeldDataBeforeBorrow2,
                  blockTimestamps.txTimestamp, // borrow 1 timestamp
                  blockTimestamps2.latestBlockTimestamp,
                  true // delegator
                );

              // Get delegator tether reserve data and expected reserve data after borrow 2
              const depositorTetherDataAfterBorrow2: UserReserveData =
                await getUserData(
                  lendingPool,
                  meldProtocolDataProvider,
                  await tether.getAddress(),
                  depositor.address
                );

              // Calculate expected delegator tether data after borrow 2
              const expectedDepositorTetherDataAfterBorrow2: UserReserveData =
                calcExpectedUserDataAfterBorrow(
                  amountToBorrow2,
                  RateMode.Variable,
                  usdtReserveDataBeforeBorrow2,
                  expectedUsdtReserveDataAfterBorrow2,
                  depositorTetherDataBeforeBorrow2,
                  blockTimestamps2.txTimestamp,
                  blockTimestamps2.latestBlockTimestamp,
                  true // delegator
                );

              // Get delegatee user reserve data after borrow 2
              const borrowerMeldDataAfterBorrow2: UserReserveData =
                await getUserData(
                  lendingPool,
                  meldProtocolDataProvider,
                  await meld.getAddress(),
                  borrower.address
                );

              const borrower2TetherDataAfterBorrow2: UserReserveData =
                await getUserData(
                  lendingPool,
                  meldProtocolDataProvider,
                  await tether.getAddress(),
                  borrower2.address
                );

              // Expected delegatee meld data after borrowing.
              // Delegatee should have no debt, but should have received the tokens borrowed.
              const expectedBorrowerMeldDataAfterBorrow2: UserReserveData = {
                scaledMTokenBalance: 0n,
                currentMTokenBalance: 0n,
                currentStableDebt: 0n,
                currentVariableDebt: 0n,
                principalStableDebt: 0n,
                scaledVariableDebt: 0n,
                stableBorrowRate: 0n,
                liquidityRate:
                  expectedMeldReserveDataAfterBorrow2.liquidityRate,
                usageAsCollateralEnabled: false,
                stableRateLastUpdated: 0n,
                walletBalanceUnderlyingAsset: amountToBorrow,
              };

              // Expected delegatee tether data after borrowing.
              // Delegatee should have no debt, but should have received the tokens borrowed.
              const expectedBorrower2TetherDataAfterBorrow2: UserReserveData = {
                scaledMTokenBalance: 0n,
                currentMTokenBalance: 0n,
                currentStableDebt: 0n,
                currentVariableDebt: 0n,
                principalStableDebt: 0n,
                scaledVariableDebt: 0n,
                stableBorrowRate: 0n,
                liquidityRate:
                  expectedUsdtReserveDataAfterBorrow2.liquidityRate,
                usageAsCollateralEnabled: false,
                stableRateLastUpdated: 0n,
                walletBalanceUnderlyingAsset: amountToBorrow2,
              };

              // Check that the delegator and delegatee state is correct after both borrows
              // Reserve state is checked in single borrow test cases
              expectEqual(
                depositorMeldDataAfterBorrow2,
                expectedDepositorMeldDataAfterBorrow2
              );
              expectEqual(
                depositorTetherDataAfterBorrow2,
                expectedDepositorTetherDataAfterBorrow2
              );
              expectEqual(
                borrowerMeldDataAfterBorrow2,
                expectedBorrowerMeldDataAfterBorrow2
              );
              expectEqual(
                borrower2TetherDataAfterBorrow2,
                expectedBorrower2TetherDataAfterBorrow2
              );
            });

            it("Should update token balances correctly", async function () {
              const {
                lendingPool,
                meldProtocolDataProvider,
                lendingRateOracleAggregator,
                meld,
                tether,
                usdc,
                dai,
                borrower,
                borrower2,
                depositor, // USDC collateral depositor
                depositor2, // DAI collateral depositor
                depositor3, // MELD and USDT liquidity depositor
                delegatedAmountTetherVariable,
              } = await loadFixture(setUpTestFixtureCombo);

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

              // Depositor delegates to borrower2
              await variableDebtToken
                .connect(depositor)
                .approveDelegation(
                  borrower2.address,
                  delegatedAmountTetherVariable * 2n
                );
              expect(
                await variableDebtToken.borrowAllowance(
                  depositor.address,
                  borrower2.address
                )
              ).to.be.equal(delegatedAmountTetherVariable * 2n);

              // First - Borrow MELD from the lending pool
              const amountToBorrow = await convertToCurrencyDecimals(
                await meld.getAddress(),
                "2500"
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
                depositor.address
              );

              // Get token balances for collateral and borrowed tokens before first borrow
              const mUSDCBalanceBefore = await mUSDC.balanceOf(
                depositor.address
              );
              const mMELDBalanceBefore = await mMELD.balanceOf(
                depositor3.address
              );

              const borrowTx = await lendingPool
                .connect(borrower)
                .borrow(
                  await meld.getAddress(),
                  amountToBorrow,
                  RateMode.Stable,
                  depositor.address,
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
                depositor.address
              );

              // Second - Borrow USDT from the lending pool
              const amountToBorrow2 = await convertToCurrencyDecimals(
                await tether.getAddress(),
                "1000"
              );

              // Get token balances for collateral and borrowed tokens before second borrow
              const mDAIBalanceBefore = await mDAI.balanceOf(
                depositor2.address
              );
              const mUSDTBalanceBefore = await mUSDT.balanceOf(
                depositor3.address
              );

              const borrowTx2 = await lendingPool
                .connect(borrower2)
                .borrow(
                  await tether.getAddress(),
                  amountToBorrow2,
                  RateMode.Variable,
                  depositor.address,
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
                  blockTimestamps2.latestBlockTimestamp,
                  true // delegator
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
                  blockTimestamps.latestBlockTimestamp,
                  true // delegator
                );

              // Check token balances
              expect(
                await stableDebtToken.balanceOf(depositor.address)
              ).to.equal(expecteMeldUserDataAfterBorrow1.currentStableDebt);

              expect(
                await stableDebtToken.principalBalanceOf(depositor.address)
              ).to.equal(expecteMeldUserDataAfterBorrow1.principalStableDebt);

              expect(
                await variableDebtToken.balanceOf(depositor.address)
              ).to.equal(expectedUsdtUserDataAfterBorrow2.currentVariableDebt);

              expect(
                await variableDebtToken.scaledBalanceOf(depositor.address)
              ).to.equal(expectedUsdtUserDataAfterBorrow2.scaledVariableDebt);

              // Depositor3 deposited MELD and USDT liquidity. Balances should have increased due to accrued interest
              // Depositor2 deposited DAI as collateral. No change in mDAI balance.
              // Depositor deposited USDC as collateral. No change in mUSDC balance.
              // No collateral is transferred during borrow.
              expect(
                await mMELD.balanceOf(depositor3.address)
              ).to.be.greaterThan(mMELDBalanceBefore);
              expect(await mUSDT.balanceOf(depositor3.address)).to.equal(
                mUSDTBalanceBefore
              );
              expect(await mUSDC.balanceOf(depositor.address)).to.equal(
                mUSDCBalanceBefore
              );
              expect(await mDAI.balanceOf(depositor2.address)).to.equal(
                mDAIBalanceBefore
              );

              // Borrower should have tokens borrowed
              expect(await meld.balanceOf(borrower.address)).to.equal(
                amountToBorrow
              );
              expect(await tether.balanceOf(borrower2.address)).to.equal(
                amountToBorrow2
              );
            });

            it("Should correctly decrease delegatee borrow allowances", async function () {
              const {
                lendingPool,
                meldProtocolDataProvider,
                meld,
                tether,
                borrower,
                borrower2,
                depositor,
                delegatedAmountMELDStable,
                delegatedAmountTetherVariable,
              } = await loadFixture(setUpTestFixtureCombo);

              const reserveTokenAddressesUSDT =
                await meldProtocolDataProvider.getReserveTokensAddresses(
                  await tether.getAddress()
                );

              const variableDebtToken = await ethers.getContractAt(
                "VariableDebtToken",
                reserveTokenAddressesUSDT.variableDebtTokenAddress
              );

              // Depositor delegates to borrower2
              await variableDebtToken
                .connect(depositor)
                .approveDelegation(
                  borrower2.address,
                  delegatedAmountTetherVariable * 2n
                );
              expect(
                await variableDebtToken.borrowAllowance(
                  depositor.address,
                  borrower2.address
                )
              ).to.be.equal(delegatedAmountTetherVariable * 2n);

              // First - Borrow MELD from the lending pool
              const amountToBorrow = await convertToCurrencyDecimals(
                await meld.getAddress(),
                "2000"
              );

              // Instantiate MELD reserve token contracts
              const reserveTokenAddressesMELD =
                await meldProtocolDataProvider.getReserveTokensAddresses(
                  await meld.getAddress()
                );

              const stableDebtToken = await ethers.getContractAt(
                "StableDebtToken",
                reserveTokenAddressesMELD.stableDebtTokenAddress
              );

              await lendingPool
                .connect(borrower)
                .borrow(
                  await meld.getAddress(),
                  amountToBorrow,
                  RateMode.Stable,
                  depositor.address,
                  0
                );

              // Second - Borrow USDT from the lending pool
              const amountToBorrow2 = await convertToCurrencyDecimals(
                await tether.getAddress(),
                "1000"
              );

              await lendingPool
                .connect(borrower2)
                .borrow(
                  await tether.getAddress(),
                  amountToBorrow2,
                  RateMode.Variable,
                  depositor.address,
                  0
                );

              expect(
                await stableDebtToken.borrowAllowance(
                  depositor.address,
                  borrower.address
                )
              ).to.be.equal(delegatedAmountMELDStable - amountToBorrow);

              expect(
                await variableDebtToken.borrowAllowance(
                  depositor.address,
                  borrower2.address
                )
              ).to.be.equal(
                delegatedAmountTetherVariable * 2n - amountToBorrow2
              );
            });
          }
        ); // End Multiple Borrows on behalf of one delegator (depositor) by different delegatees (borrowers) Context

        context(
          "Multiple borrows by one delegatee (borrower) receiving credit from multiple delegators (depositors)",
          async function () {
            it("Should emit correct events", async function () {
              const {
                lendingPool,
                meldProtocolDataProvider,
                lendingRateOracleAggregator,
                meld,
                tether,
                owner,
                borrower,
                depositor,
                depositor2,
                delegatedAmountMELDStable,
                delegatedAmountTetherVariable,
              } = await loadFixture(setUpTestFixtureCombo);

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

              // Depositor2 delegates to borrower
              await variableDebtToken
                .connect(depositor2)
                .approveDelegation(
                  borrower.address,
                  delegatedAmountTetherVariable / 2n
                );
              expect(
                await variableDebtToken.borrowAllowance(
                  depositor2.address,
                  borrower.address
                )
              ).to.be.equal(delegatedAmountTetherVariable / 2n);

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
                depositor.address
              );

              const borrowTx = await lendingPool
                .connect(borrower)
                .borrow(
                  await meld.getAddress(),
                  amountToBorrow,
                  RateMode.Stable,
                  depositor.address,
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
                expectedCurrentBalance -
                userDataBeforeBorrow.principalStableDebt;

              // Check that the correct events were emitted
              await expect(borrowTx)
                .to.emit(stableDebtToken, "BorrowAllowanceDelegated")
                .withArgs(
                  depositor.address,
                  borrower.address,
                  await meld.getAddress(),
                  delegatedAmountMELDStable - amountToBorrow
                );

              await expect(borrowTx)
                .to.emit(stableDebtToken, "Transfer")
                .withArgs(ZeroAddress, depositor.address, amountToBorrow);

              await expect(borrowTx)
                .to.emit(stableDebtToken, "Mint")
                .withArgs(
                  borrower.address,
                  depositor.address,
                  amountToBorrow,
                  expectedCurrentBalance,
                  expectedIncrease,
                  expectedUserDataAfterBorrow.stableBorrowRate,
                  expectedReserveDataAfterBorrow.averageStableBorrowRate,
                  expectedReserveDataAfterBorrow.principalStableDebt
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
                  depositor.address,
                  amountToBorrow,
                  RateMode.Stable,
                  reserveDataBeforeBorrow.stableBorrowRate // The stable borrow rate emitted is the rate before updateInterestRates() is called
                );

              await expect(borrowTx).to.not.emit(mMELD, "Transfer");
              await expect(borrowTx).to.not.emit(mMELD, "Mint");

              await mine(10);

              // Second - Borrow USDT from the lending pool
              const amountToBorrow2 = await convertToCurrencyDecimals(
                await tether.getAddress(),
                "1000"
              );

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
                  depositor2.address,
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
                .to.emit(variableDebtToken, "BorrowAllowanceDelegated")
                .withArgs(
                  depositor2.address,
                  borrower.address,
                  await tether.getAddress(),
                  delegatedAmountTetherVariable / 2n - amountToBorrow2
                );

              await expect(borrowTx2)
                .to.emit(variableDebtToken, "Transfer")
                .withArgs(ZeroAddress, depositor2.address, amountToBorrow2);

              await expect(borrowTx2)
                .to.emit(variableDebtToken, "Mint")
                .withArgs(
                  borrower.address,
                  depositor2.address,
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
                  depositor2.address,
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
                depositor,
                depositor2,
                delegatedAmountTetherVariable,
              } = await loadFixture(setUpTestFixtureCombo);

              // Instantiate reserve token contracts
              const reserveTokenAddressesUSDT =
                await meldProtocolDataProvider.getReserveTokensAddresses(
                  await tether.getAddress()
                );

              const variableDebtToken = await ethers.getContractAt(
                "VariableDebtToken",
                reserveTokenAddressesUSDT.variableDebtTokenAddress
              );

              // Depositor2 delegates to borrower
              await variableDebtToken
                .connect(depositor2)
                .approveDelegation(
                  borrower.address,
                  delegatedAmountTetherVariable / 2n
                );
              expect(
                await variableDebtToken.borrowAllowance(
                  depositor2.address,
                  borrower.address
                )
              ).to.be.equal(delegatedAmountTetherVariable / 2n);

              // First - Borrow MELD from the lending pool
              const amountToBorrow = await convertToCurrencyDecimals(
                await meld.getAddress(),
                "2000"
              );

              const borrowTx = await lendingPool
                .connect(borrower)
                .borrow(
                  await meld.getAddress(),
                  amountToBorrow,
                  RateMode.Stable,
                  depositor.address,
                  0
                );

              const blockTimestamps: BlockTimestamps =
                await getBlockTimestamps(borrowTx);

              await mine(100);

              // Get MELD reserve data before borrow 2
              const meldReserveDataBeforeBorrow2: ReserveData =
                await getReserveData(
                  meldProtocolDataProvider,
                  await meld.getAddress(),
                  await lendingRateOracleAggregator.getAddress()
                );

              // Get USDT reserve data before borrow 2
              const usdtReserveDataBeforeBorrow2: ReserveData =
                await getReserveData(
                  meldProtocolDataProvider,
                  await tether.getAddress(),
                  await lendingRateOracleAggregator.getAddress()
                );

              // Get delegator user reserve data before borrow 2
              const depositorMeldDataBeforeBorrow2: UserReserveData =
                await getUserData(
                  lendingPool,
                  meldProtocolDataProvider,
                  await meld.getAddress(),
                  depositor.address
                );

              const depositor2TetherDataBeforeBorrow2: UserReserveData =
                await getUserData(
                  lendingPool,
                  meldProtocolDataProvider,
                  await tether.getAddress(),
                  depositor2.address
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
                  depositor2.address,
                  0
                );

              const blockTimestamps2: BlockTimestamps =
                await getBlockTimestamps(borrowTx2);

              // Calculate expected MELD reserve data after borrow 2
              const expectedMeldReserveDataAfterBorrow2: ReserveData =
                calcExpectedReserveDataAfterBorrow(
                  0n, // MELD borrowing already happened. Passing in amountToBorrow here would add it to the debt total again.
                  RateMode.Stable,
                  meldReserveDataBeforeBorrow2,
                  blockTimestamps.txTimestamp, // borrow 1 timestamp
                  blockTimestamps2.latestBlockTimestamp
                );

              // Calculate expected reserve data after borrow 2
              const expectedUsdtReserveDataAfterBorrow2: ReserveData =
                calcExpectedReserveDataAfterBorrow(
                  amountToBorrow2,
                  RateMode.Variable,
                  usdtReserveDataBeforeBorrow2,
                  blockTimestamps2.txTimestamp,
                  blockTimestamps2.latestBlockTimestamp
                );

              // Get delegator 1 meld reserve data and expected reserve data after borrow 2
              const depositorMeldDataAfterBorrow2: UserReserveData =
                await getUserData(
                  lendingPool,
                  meldProtocolDataProvider,
                  await meld.getAddress(),
                  depositor.address
                );

              // Calculate expected delegator 1 meld data after borrow 2
              const expectedDepositorMeldDataAfterBorrow2: UserReserveData =
                calcExpectedUserDataAfterBorrow(
                  0n, // MELD borrowing already happened. Passing in amountToBorrow here would add it to the debt total again.
                  RateMode.Stable,
                  meldReserveDataBeforeBorrow2,
                  expectedMeldReserveDataAfterBorrow2,
                  depositorMeldDataBeforeBorrow2,
                  blockTimestamps.txTimestamp, // borrow 1 timestamp
                  blockTimestamps2.latestBlockTimestamp,
                  true // delegator
                );

              // Get delegator 2 tether reserve data and expected reserve data after borrow 2
              const depositor2TetherDataAfterBorrow2: UserReserveData =
                await getUserData(
                  lendingPool,
                  meldProtocolDataProvider,
                  await tether.getAddress(),
                  depositor2.address
                );

              // Calculate expected delegator 2 tether data after borrow 2
              const expectedDepositor2TetherDataAfterBorrow2: UserReserveData =
                calcExpectedUserDataAfterBorrow(
                  amountToBorrow2,
                  RateMode.Variable,
                  usdtReserveDataBeforeBorrow2,
                  expectedUsdtReserveDataAfterBorrow2,
                  depositor2TetherDataBeforeBorrow2,
                  blockTimestamps2.txTimestamp,
                  blockTimestamps2.latestBlockTimestamp,
                  true // delegator
                );

              // Get delegatee user  data after borrow 2
              const borrowerMeldDataAfterBorrow2: UserReserveData =
                await getUserData(
                  lendingPool,
                  meldProtocolDataProvider,
                  await meld.getAddress(),
                  borrower.address
                );

              const borrowerTetherDataAfterBorrow2: UserReserveData =
                await getUserData(
                  lendingPool,
                  meldProtocolDataProvider,
                  await tether.getAddress(),
                  borrower.address
                );

              // Expected delegatee meld data after borrowing.
              // Delegatee should have no debt, but should have received the tokens borrowed.
              const expectedBorrowerMeldDataAfterBorrow2: UserReserveData = {
                scaledMTokenBalance: 0n,
                currentMTokenBalance: 0n,
                currentStableDebt: 0n,
                currentVariableDebt: 0n,
                principalStableDebt: 0n,
                scaledVariableDebt: 0n,
                stableBorrowRate: 0n,
                liquidityRate:
                  expectedMeldReserveDataAfterBorrow2.liquidityRate,
                usageAsCollateralEnabled: false,
                stableRateLastUpdated: 0n,
                walletBalanceUnderlyingAsset: amountToBorrow,
              };

              // Expected delegatee tether data after borrowing.
              // Delegatee should have no debt, but should have received the tokens borrowed.
              const expectedBorrowerTetherDataAfterBorrow2: UserReserveData = {
                scaledMTokenBalance: 0n,
                currentMTokenBalance: 0n,
                currentStableDebt: 0n,
                currentVariableDebt: 0n,
                principalStableDebt: 0n,
                scaledVariableDebt: 0n,
                stableBorrowRate: 0n,
                liquidityRate:
                  expectedUsdtReserveDataAfterBorrow2.liquidityRate,
                usageAsCollateralEnabled: false,
                stableRateLastUpdated: 0n,
                walletBalanceUnderlyingAsset: amountToBorrow2,
              };

              // Check that the delegator and delegatee state is correct after both borrows
              // Reserve state is checked in single borrow test cases
              expectEqual(
                depositorMeldDataAfterBorrow2,
                expectedDepositorMeldDataAfterBorrow2
              );
              expectEqual(
                depositor2TetherDataAfterBorrow2,
                expectedDepositor2TetherDataAfterBorrow2
              );
              expectEqual(
                borrowerMeldDataAfterBorrow2,
                expectedBorrowerMeldDataAfterBorrow2
              );
              expectEqual(
                borrowerTetherDataAfterBorrow2,
                expectedBorrowerTetherDataAfterBorrow2
              );
            });

            it("Should update token balances correctly", async function () {
              const {
                lendingPool,
                meldProtocolDataProvider,
                lendingRateOracleAggregator,
                meld,
                tether,
                usdc,
                dai,
                borrower,
                depositor, // USDC collateral depositor
                depositor2, // DAI collateral depositor
                depositor3, // MELD and USDT liquidity depositor
                delegatedAmountTetherVariable,
              } = await loadFixture(setUpTestFixtureCombo);

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

              // Depositor2 delegates to borrower
              await variableDebtToken
                .connect(depositor2)
                .approveDelegation(
                  borrower.address,
                  delegatedAmountTetherVariable / 2n
                );
              expect(
                await variableDebtToken.borrowAllowance(
                  depositor2.address,
                  borrower.address
                )
              ).to.be.equal(delegatedAmountTetherVariable / 2n);

              // First - Borrow MELD from the lending pool
              const amountToBorrow = await convertToCurrencyDecimals(
                await meld.getAddress(),
                "2500"
              );

              // Get reserve data before borrow 1
              const meldReserveDataBeforeBorrow1: ReserveData =
                await getReserveData(
                  meldProtocolDataProvider,
                  await meld.getAddress(),
                  await lendingRateOracleAggregator.getAddress()
                );

              // Get depositor user reserve data before borrow 1
              const depositorUserDataBeforeBorrow1: UserReserveData =
                await getUserData(
                  lendingPool,
                  meldProtocolDataProvider,
                  await meld.getAddress(),
                  depositor.address
                );

              // Get token balances for collateral and borrowed tokens before first borrow
              const mUSDCBalanceBefore = await mUSDC.balanceOf(
                depositor.address
              );
              const mMELDBalanceBefore = await mMELD.balanceOf(
                depositor3.address
              );

              const borrowTx = await lendingPool
                .connect(borrower)
                .borrow(
                  await meld.getAddress(),
                  amountToBorrow,
                  RateMode.Stable,
                  depositor.address,
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

              // Get depositor2 user reserve data before borrow 2
              const depositor2UserDataBeforeBorrow2: UserReserveData =
                await getUserData(
                  lendingPool,
                  meldProtocolDataProvider,
                  await tether.getAddress(),
                  depositor2.address
                );

              // Second - Borrow USDT from the lending pool
              const amountToBorrow2 = await convertToCurrencyDecimals(
                await tether.getAddress(),
                "1000"
              );

              // Get token balances for collateral and borrowed tokens before second borrow
              const mDAIBalanceBefore = await mDAI.balanceOf(
                depositor2.address
              );
              const mUSDTBalanceBefore = await mUSDT.balanceOf(
                depositor3.address
              );

              const borrowTx2 = await lendingPool
                .connect(borrower)
                .borrow(
                  await tether.getAddress(),
                  amountToBorrow2,
                  RateMode.Variable,
                  depositor2.address,
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
                  depositor2UserDataBeforeBorrow2,
                  blockTimestamps2.txTimestamp,
                  blockTimestamps2.latestBlockTimestamp,
                  true // delegator
                );

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
                  depositorUserDataBeforeBorrow1,
                  blockTimestamps.txTimestamp,
                  blockTimestamps.latestBlockTimestamp,
                  true // delegator
                );

              // Check token balances
              expect(
                await stableDebtToken.balanceOf(depositor.address)
              ).to.equal(expecteMeldUserDataAfterBorrow1.currentStableDebt);

              expect(
                await stableDebtToken.principalBalanceOf(depositor.address)
              ).to.equal(expecteMeldUserDataAfterBorrow1.principalStableDebt);

              expect(
                await variableDebtToken.balanceOf(depositor2.address)
              ).to.equal(expectedUsdtUserDataAfterBorrow2.currentVariableDebt);

              expect(
                await variableDebtToken.scaledBalanceOf(depositor2.address)
              ).to.equal(expectedUsdtUserDataAfterBorrow2.scaledVariableDebt);

              // Depositor3 deposited MELD and USDT liquidity. Balances should have increased due to accrued interest
              // Depositor2 deposited DAI as collateral. No change in mDAI balance.
              // Depositor deposited USDC as collateral. No change in mUSDC balance.
              // No collateral is transferred during borrow.
              expect(
                await mMELD.balanceOf(depositor3.address)
              ).to.be.greaterThan(mMELDBalanceBefore);
              expect(await mUSDT.balanceOf(depositor3.address)).to.equal(
                mUSDTBalanceBefore
              );
              expect(await mUSDC.balanceOf(depositor.address)).to.equal(
                mUSDCBalanceBefore
              );
              expect(await mDAI.balanceOf(depositor2.address)).to.equal(
                mDAIBalanceBefore
              );

              // Borrower should have tokens borrowed
              expect(await meld.balanceOf(borrower.address)).to.equal(
                amountToBorrow
              );
              expect(await tether.balanceOf(borrower.address)).to.equal(
                amountToBorrow2
              );
            });

            it("Should correctly decrease delegatee borrow allowances", async function () {
              const {
                lendingPool,
                meldProtocolDataProvider,
                meld,
                tether,
                borrower,
                depositor,
                depositor2,
                delegatedAmountMELDStable,
                delegatedAmountTetherVariable,
              } = await loadFixture(setUpTestFixtureCombo);

              const reserveTokenAddressesUSDT =
                await meldProtocolDataProvider.getReserveTokensAddresses(
                  await tether.getAddress()
                );

              const variableDebtToken = await ethers.getContractAt(
                "VariableDebtToken",
                reserveTokenAddressesUSDT.variableDebtTokenAddress
              );

              // Depositor2 delegates to borrower
              await variableDebtToken
                .connect(depositor2)
                .approveDelegation(
                  borrower.address,
                  delegatedAmountTetherVariable / 2n
                );
              expect(
                await variableDebtToken.borrowAllowance(
                  depositor2.address,
                  borrower.address
                )
              ).to.be.equal(delegatedAmountTetherVariable / 2n);

              // First - Borrow MELD from the lending pool
              const amountToBorrow = await convertToCurrencyDecimals(
                await meld.getAddress(),
                "2000"
              );

              // Instantiate MELD reserve token contracts
              const reserveTokenAddressesMELD =
                await meldProtocolDataProvider.getReserveTokensAddresses(
                  await meld.getAddress()
                );

              const stableDebtToken = await ethers.getContractAt(
                "StableDebtToken",
                reserveTokenAddressesMELD.stableDebtTokenAddress
              );

              await lendingPool
                .connect(borrower)
                .borrow(
                  await meld.getAddress(),
                  amountToBorrow,
                  RateMode.Stable,
                  depositor.address,
                  0
                );

              // Second - Borrow USDT from the lending pool
              const amountToBorrow2 = await convertToCurrencyDecimals(
                await tether.getAddress(),
                "1000"
              );

              await lendingPool
                .connect(borrower)
                .borrow(
                  await tether.getAddress(),
                  amountToBorrow2,
                  RateMode.Variable,
                  depositor2.address,
                  0
                );

              expect(
                await stableDebtToken.borrowAllowance(
                  depositor.address,
                  borrower.address
                )
              ).to.be.equal(delegatedAmountMELDStable - amountToBorrow);

              expect(
                await variableDebtToken.borrowAllowance(
                  depositor2.address,
                  borrower.address
                )
              ).to.be.equal(
                delegatedAmountTetherVariable / 2n - amountToBorrow2
              );
            });
          }
        ); // End Multiple borrows by one delegatee (borrower) receiving credit from multiple delegators (depositors) Context
      }); // End Happy Flow Test Cases Context

      context("Error Test Cases", async function () {
        context("Stable Borrow", async function () {
          it("Should revert if borrower (delegatee) doesn’t have enough credit from depositor (delegator)", async function () {
            const {
              lendingPool,
              meldProtocolDataProvider,
              meld,
              depositor,
              borrower,
            } = await loadFixture(setUpTestFixtureStable);

            // Instantiate reserve token contracts
            const reserveTokenAddresses =
              await meldProtocolDataProvider.getReserveTokensAddresses(
                await meld.getAddress()
              );

            const stableDebtToken = await ethers.getContractAt(
              "StableDebtToken",
              reserveTokenAddresses.stableDebtTokenAddress
            );

            // Change delegated allowance
            const newDelegatedAmount = await convertToCurrencyDecimals(
              await meld.getAddress(),
              "2000"
            );

            // lower the delegated allowance so can test
            await stableDebtToken
              .connect(depositor)
              .approveDelegation(borrower.address, newDelegatedAmount);

            // Borrow MELD from the lending pool
            const amountToBorrow = await convertToCurrencyDecimals(
              await meld.getAddress(),
              "2001"
            );

            await expect(
              lendingPool.connect(borrower).borrow(
                await meld.getAddress(),
                amountToBorrow,
                RateMode.Stable,
                depositor.address, // onBehalfOf
                0
              )
            ).to.revertedWith(ProtocolErrors.BORROW_ALLOWANCE_NOT_ENOUGH);
          });

          it("Should revert if collateral deposited by delegator is same as asset being borrowed by delegatee", async function () {
            const {
              lendingPool,
              lendingPoolConfigurator,
              usdc,
              depositor,
              borrower,
              poolAdmin,
            } = await loadFixture(setUpTestFixtureStable);

            // Enable borrowing on the USDC reserve because the default is false
            lendingPoolConfigurator.connect(poolAdmin).enableBorrowingOnReserve(
              await usdc.getAddress(),
              true // stableBorrowRateEnabled
            );

            // Borrow USDC from the lending pool
            const amountToBorrow = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "2000"
            );

            await expect(
              lendingPool.connect(borrower).borrow(
                await usdc.getAddress(),
                amountToBorrow,
                RateMode.Stable,
                depositor.address, // onBehalfOf
                0
              )
            ).to.revertedWith(
              ProtocolErrors.VL_COLLATERAL_SAME_AS_BORROWING_CURRENCY
            );
          });

          it("Should revert if delegatee tries to borrow for a different borrow mode", async function () {
            const { lendingPool, meld, depositor, borrower } =
              await loadFixture(setUpTestFixtureStable);

            // Borrow MELD from the lending pool
            const amountToBorrow = await convertToCurrencyDecimals(
              await meld.getAddress(),
              "2000"
            );

            // Borrower has been delegated to borrow MELD in Stable mode
            await expect(
              lendingPool.connect(borrower).borrow(
                await meld.getAddress(),
                amountToBorrow,
                RateMode.Variable,
                depositor.address, // onBehalfOf
                0
              )
            ).to.revertedWith(ProtocolErrors.BORROW_ALLOWANCE_NOT_ENOUGH);
          });
        }); // End Stable Borrow Context

        context("Variable Borrow", async function () {
          it("Should revert if borrower (delegatee) does not have enough credit from depositor (delegator)", async function () {
            const {
              lendingPool,
              meldProtocolDataProvider,
              meld,
              depositor,
              borrower,
            } = await loadFixture(setUpTestFixtureStable);

            // Instantiate reserve token contracts
            const reserveTokenAddresses =
              await meldProtocolDataProvider.getReserveTokensAddresses(
                await meld.getAddress()
              );

            const variableDebtToken = await ethers.getContractAt(
              "VariableDebtToken",
              reserveTokenAddresses.variableDebtTokenAddress
            );

            // Change delegated allowance
            const newDelegatedAmount = await convertToCurrencyDecimals(
              await meld.getAddress(),
              "2000"
            );

            // lower the delegated allowance so can test
            await variableDebtToken
              .connect(depositor)
              .approveDelegation(borrower.address, newDelegatedAmount);

            // Borrow MELD from the lending pool
            const amountToBorrow = await convertToCurrencyDecimals(
              await meld.getAddress(),
              "2001"
            );

            await expect(
              lendingPool.connect(borrower).borrow(
                await meld.getAddress(),
                amountToBorrow,
                RateMode.Variable,
                depositor.address, // onBehalfOf
                0
              )
            ).to.revertedWith(ProtocolErrors.BORROW_ALLOWANCE_NOT_ENOUGH);
          });

          it("Should revert if delegatee tries to borrow for a different borrow mode than delegated", async function () {
            const {
              lendingPool,
              lendingPoolConfigurator,
              meld,
              depositor,
              borrower,
              poolAdmin,
            } = await loadFixture(setUpTestFixtureVariable);

            // Enable borrowing on the MELD reserve because the default is false
            await expect(
              lendingPoolConfigurator
                .connect(poolAdmin)
                .enableBorrowingOnReserve(
                  await meld.getAddress(),
                  true // stableBorrowRateEnabled
                )
            )
              .to.emit(lendingPoolConfigurator, "BorrowingEnabledOnReserve")
              .withArgs(await meld.getAddress(), true);

            // Borrow MELD from the lending pool
            const amountToBorrow = await convertToCurrencyDecimals(
              await meld.getAddress(),
              "2000"
            );

            // Borrower has been delegated to borrow MELD in Variable mode
            await expect(
              lendingPool.connect(borrower).borrow(
                await meld.getAddress(),
                amountToBorrow,
                RateMode.Stable,
                depositor.address, // onBehalfOf
                0
              )
            ).to.revertedWith(ProtocolErrors.BORROW_ALLOWANCE_NOT_ENOUGH);
          });

          it("Should revert if delegatee tries to borrow for same borrow mode as delegator approved but for a different asset", async function () {
            const { lendingPool, tether, depositor, borrower } =
              await loadFixture(setUpTestFixtureVariable);

            // Borrow USDT from the lending pool
            const amountToBorrow = await convertToCurrencyDecimals(
              await tether.getAddress(),
              "2000"
            );

            // Borrower has been delegated to borrow MELD in Stable mode
            await expect(
              lendingPool.connect(borrower).borrow(
                await tether.getAddress(),
                amountToBorrow,
                RateMode.Variable,
                depositor.address, // onBehalfOf
                0
              )
            ).to.revertedWith(ProtocolErrors.BORROW_ALLOWANCE_NOT_ENOUGH);
          });
        }); // End Variable Borrow Context

        it("Should revert if borrowed amount exceeds delegator (depositor) deposited collateral", async function () {
          const { lendingPool, meld, depositor, borrower } = await loadFixture(
            setUpTestFixtureStable
          );

          // Borrow MELD from the lending pool
          const amountToBorrow = await convertToCurrencyDecimals(
            await meld.getAddress(),
            "20001"
          );

          await expect(
            lendingPool.connect(borrower).borrow(
              await meld.getAddress(),
              amountToBorrow,
              RateMode.Stable,
              depositor.address, // onBehalfOf
              0
            )
          ).to.revertedWith(
            ProtocolErrors.VL_COLLATERAL_CANNOT_COVER_NEW_BORROW
          );
        });
        it("Should revert if delegator collateral balance is not > 0", async function () {
          const {
            lendingPool,
            lendingPoolConfigurator,
            meld,
            borrower,
            depositor,
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
            lendingPool.connect(borrower).borrow(
              await meld.getAddress(),
              amountToBorrow,
              RateMode.Stable,
              depositor.address, // onBehalfOf
              0
            )
          ).to.revertedWith(ProtocolErrors.VL_COLLATERAL_BALANCE_IS_0);
        });

        it("Should revert if health factor is < threshold, even if delegation allowance is not reached", async function () {
          //Threshold is 1 e18

          const {
            lendingPool,
            meldPriceOracle,
            priceOracleAggregator,
            meld,
            usdc,
            borrower,
            depositor,
            oracleAdmin,
          } = await loadFixture(setUpTestFixtureVariable);

          const amountToBorrow = await convertToCurrencyDecimals(
            await meld.getAddress(),
            "2500"
          );

          await lendingPool.connect(borrower).borrow(
            await meld.getAddress(),
            amountToBorrow,
            RateMode.Variable,
            depositor.address, // onBehalfOf
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
            lendingPool.connect(borrower).borrow(
              await meld.getAddress(),
              amountToBorrow,
              RateMode.Variable,
              depositor.address, // onBehalfOf
              0
            )
          ).to.revertedWith(
            ProtocolErrors.VL_HEALTH_FACTOR_LOWER_THAN_LIQUIDATION_THRESHOLD
          );
        });
      }); // End of Error Test Cases Context
    }
  ); // End of Borrow Context

  context("Repay Credit Delegated Loan", async function () {
    context("Happy Flow Test Cases", async function () {
      // Repay is tested thoroughly in a separate test file. Here we only have a few test cases to make sure repay works for credit delegated loans
      it("Should emit correct events", async function () {
        const {
          lendingPool,
          meldProtocolDataProvider,
          lendingRateOracleAggregator,
          meld,
          owner,
          depositor,
          borrower,
        } = await loadFixture(setUpVariableBorrowFixture);

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
          depositor.address
        );

        // Repay partial debt
        const repayTx = await lendingPool.connect(borrower).repay(
          await meld.getAddress(),
          repaymentAmount,
          RateMode.Variable,
          depositor.address // credit delegator
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
          .withArgs(depositor.address, ZeroAddress, repaymentAmount);

        await expect(repayTx)
          .to.emit(variableDebtToken, "Burn")
          .withArgs(
            depositor.address,
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
            expectedReserveDataAfterRepay.stableBorrowRate,
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
        const contractInstanceWithRepayLibraryABI = await ethers.getContractAt(
          "RepayLogic",
          await lendingPool.getAddress(),
          owner
        );

        await expect(repayTx)
          .to.emit(contractInstanceWithRepayLibraryABI, "Repay")
          .withArgs(
            await meld.getAddress(),
            depositor.address,
            borrower.address,
            repaymentAmount
          );

        await expect(repayTx).to.not.emit(mMELD, "Transfer");
        await expect(repayTx).to.not.emit(mMELD, "Mint");
      });

      it("Should update state correctly if borrower only repays principal debt", async function () {
        const {
          lendingPool,
          meldProtocolDataProvider,
          lendingRateOracleAggregator,
          meld,
          depositor,
          borrower,
        } = await loadFixture(setUpVariableBorrowFixture);

        // Simulate time passing so owed interest will accrue
        await time.increase(ONE_YEAR / 2);

        const repaymentAmount = await convertToCurrencyDecimals(
          await meld.getAddress(),
          "2000" // borrowed principal
        );

        // Get reserve data before repaying
        const reserveDataBeforeRepay: ReserveData = await getReserveData(
          meldProtocolDataProvider,
          await meld.getAddress(),
          await lendingRateOracleAggregator.getAddress()
        );

        // Get delegator user reserve data before repaying
        const depositorUserDataBeforeRepay: UserReserveData = await getUserData(
          lendingPool,
          meldProtocolDataProvider,
          await meld.getAddress(),
          depositor.address
        );

        // Get delegatee user reserve data before repaying
        const borrowerUserDataBeforeRepay: UserReserveData = await getUserData(
          lendingPool,
          meldProtocolDataProvider,
          await meld.getAddress(),
          borrower.address
        );

        const variableDebtToken = await ethers.getContractAt(
          "VariableDebtToken",
          reserveDataBeforeRepay.stableDebtTokenAddress
        );

        const borrowAllowanceBeforeRepay =
          await variableDebtToken.borrowAllowance(
            depositor.address,
            borrower.address
          );

        // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
        time.setNextBlockTimestamp(await time.latest());

        // Repay principal debt
        const repayTx = await lendingPool.connect(borrower).repay(
          await meld.getAddress(),
          repaymentAmount,
          RateMode.Variable,
          depositor.address // credit delegator
        );

        const blockTimestamps: BlockTimestamps =
          await getBlockTimestamps(repayTx);

        // Get reserve data after repaying
        const reserveDataAfterRepay: ReserveData = await getReserveData(
          meldProtocolDataProvider,
          await meld.getAddress(),
          await lendingRateOracleAggregator.getAddress()
        );

        // Get delegator user reserve data after repaying
        const depositorUserDataAfterRepay: UserReserveData = await getUserData(
          lendingPool,
          meldProtocolDataProvider,
          await meld.getAddress(),
          depositor.address
        );

        // Get delegatee user reserve data after repaying
        const borrowerUserDataAfterRepay: UserReserveData = await getUserData(
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
            depositorUserDataBeforeRepay,
            blockTimestamps.txTimestamp
          );

        // Calculate expected delegator user data after repaying
        const expectedDepositorUserDataAfterRepay: UserReserveData =
          calcExpectedUserDataAfterRepay(
            repaymentAmount,
            RateMode.Variable,
            reserveDataBeforeRepay,
            expectedReserveDataAfterRepay,
            depositorUserDataBeforeRepay,
            borrower.address,
            depositor.address,
            blockTimestamps.txTimestamp,
            blockTimestamps.latestBlockTimestamp
          );

        // Expected delegatee user data after borrowing.
        // Delegatee should have no debt, but should have received the tokens borrowed.
        const expectedBorrowerUserDataAfterRepay: UserReserveData = {
          scaledMTokenBalance: 0n,
          currentMTokenBalance: 0n,
          currentStableDebt: 0n,
          currentVariableDebt: 0n,
          principalStableDebt: 0n,
          scaledVariableDebt: 0n,
          stableBorrowRate: 0n,
          liquidityRate: expectedReserveDataAfterRepay.liquidityRate,
          usageAsCollateralEnabled: false,
          stableRateLastUpdated: 0n,
          walletBalanceUnderlyingAsset:
            borrowerUserDataBeforeRepay.walletBalanceUnderlyingAsset -
            repaymentAmount,
        };

        const borrowAllowanceAftereRepay =
          await variableDebtToken.borrowAllowance(
            depositor.address,
            borrower.address
          );

        expectEqual(reserveDataAfterRepay, expectedReserveDataAfterRepay);
        expectEqual(
          depositorUserDataAfterRepay,
          expectedDepositorUserDataAfterRepay
        );
        expectEqual(
          borrowerUserDataAfterRepay,
          expectedBorrowerUserDataAfterRepay
        );

        // Repaying should not change the borrow allowance
        expect(borrowAllowanceBeforeRepay).to.be.equal(
          borrowAllowanceAftereRepay
        );
      });

      it("Should update token balances correctly for full debt repayment", async function () {
        const {
          lendingPool,
          meldProtocolDataProvider,
          lendingRateOracleAggregator,
          meld,
          depositor,
          borrower,
        } = await loadFixture(setUpVariableBorrowFixture);

        // Simulate time passing so owed interest will accrue
        await time.increase(ONE_YEAR * 2);

        // Get reserve data before repaying
        const reserveDataBeforeRepay: ReserveData = await getReserveData(
          meldProtocolDataProvider,
          await meld.getAddress(),
          await lendingRateOracleAggregator.getAddress()
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

        const depositorAssetBalanceBefore = await meld.balanceOf(
          depositor.address
        );

        // Get delegator user reserve data before repaying
        const depositorUserDataBeforeRepay: UserReserveData = await getUserData(
          lendingPool,
          meldProtocolDataProvider,
          await meld.getAddress(),
          depositor.address
        );

        // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
        time.setNextBlockTimestamp(await time.latest());

        // Repay full debt
        await lendingPool.connect(borrower).repay(
          await meld.getAddress(),
          depositorUserDataBeforeRepay.currentVariableDebt, // can't use MaxUint256 when repaying on behalf of someone else
          RateMode.Variable,
          depositor.address
        );

        // Check token balances
        expect(await variableDebtToken.balanceOf(depositor.address)).to.equal(
          0n
        );

        expect(
          await variableDebtToken.scaledBalanceOf(depositor.address)
        ).to.equal(0n);

        // Check variable debt total and scaled supply
        expect(await variableDebtToken.totalSupply()).to.equal(0n);

        expect(await variableDebtToken.scaledTotalSupply()).to.equal(0n);

        // Check borrower tokens after repayment
        expect(await meld.balanceOf(borrower.address)).to.equal(
          borrowerAssetBalanceBefore -
            depositorUserDataBeforeRepay.currentVariableDebt
        );

        // Check depositor tokens after repayment
        expect(await meld.balanceOf(depositor.address)).to.equal(
          depositorAssetBalanceBefore
        );

        // mToken should have balanceBefore plus whole borrow amount
        expect(
          await meld.balanceOf(reserveDataBeforeRepay.mTokenAddress)
        ).to.equal(
          mTokenAssetBalanceBefore +
            depositorUserDataBeforeRepay.currentVariableDebt
        );
      });

      it("Should update token balances correctly if depositor repays", async function () {
        const {
          lendingPool,
          meldProtocolDataProvider,
          lendingRateOracleAggregator,
          meld,
          owner,
          depositor,
          borrower,
        } = await loadFixture(setUpVariableBorrowFixture);

        // Simulate time passing so owed interest will accrue
        await time.increase(ONE_YEAR * 2);

        // Get reserve data before repaying
        const reserveDataBeforeRepay: ReserveData = await getReserveData(
          meldProtocolDataProvider,
          await meld.getAddress(),
          await lendingRateOracleAggregator.getAddress()
        );

        const variableDebtToken = await ethers.getContractAt(
          "VariableDebtToken",
          reserveDataBeforeRepay.variableDebtTokenAddress
        );

        // Make sure depositor has funds to pay back loan
        await allocateAndApproveTokens(
          meld,
          owner,
          depositor,
          lendingPool,
          2000n * 2n, // 2x the amount borrowed
          0n
        );

        const borrowerAssetBalanceBefore = await meld.balanceOf(
          borrower.address
        );
        const mTokenAssetBalanceBefore = await meld.balanceOf(
          reserveDataBeforeRepay.mTokenAddress
        );

        const depositorAssetBalanceBefore = await meld.balanceOf(
          depositor.address
        );

        // Get delegator user reserve data before repaying
        const depositorUserDataBeforeRepay: UserReserveData = await getUserData(
          lendingPool,
          meldProtocolDataProvider,
          await meld.getAddress(),
          depositor.address
        );

        // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
        time.setNextBlockTimestamp(await time.latest());

        // Repay full debt
        await lendingPool.connect(depositor).repay(
          await meld.getAddress(),
          MaxUint256, // flag for full debt repayment
          RateMode.Variable,
          depositor.address
        );

        // Check token balances
        expect(await variableDebtToken.balanceOf(depositor.address)).to.equal(
          0n
        );

        expect(
          await variableDebtToken.scaledBalanceOf(depositor.address)
        ).to.equal(0n);

        // Check variable debt total and scaled supply
        expect(await variableDebtToken.totalSupply()).to.equal(0n);

        expect(await variableDebtToken.scaledTotalSupply()).to.equal(0n);

        // Check borrower tokens after repayment
        expect(await meld.balanceOf(borrower.address)).to.equal(
          borrowerAssetBalanceBefore
        );

        // Check depositor tokens after repayment
        expect(await meld.balanceOf(depositor.address)).to.equal(
          depositorAssetBalanceBefore -
            depositorUserDataBeforeRepay.currentVariableDebt
        );

        // mToken should have balanceBefore plus whole borrow amount
        expect(
          await meld.balanceOf(reserveDataBeforeRepay.mTokenAddress)
        ).to.equal(
          mTokenAssetBalanceBefore +
            depositorUserDataBeforeRepay.currentVariableDebt
        );
      });

      it("Should update token balances correctly if random person repays", async function () {
        const {
          lendingPool,
          meldProtocolDataProvider,
          lendingRateOracleAggregator,
          meld,
          owner,
          depositor,
          borrower,
          rando,
        } = await loadFixture(setUpVariableBorrowFixture);

        // Simulate time passing so owed interest will accrue
        await time.increase(ONE_YEAR * 2);

        // Get reserve data before repaying
        const reserveDataBeforeRepay: ReserveData = await getReserveData(
          meldProtocolDataProvider,
          await meld.getAddress(),
          await lendingRateOracleAggregator.getAddress()
        );

        const variableDebtToken = await ethers.getContractAt(
          "VariableDebtToken",
          reserveDataBeforeRepay.variableDebtTokenAddress
        );

        // Make sure depositor has funds to pay back loan
        await allocateAndApproveTokens(
          meld,
          owner,
          rando,
          lendingPool,
          2000n * 2n, // 2x the amount borrowed
          0n
        );

        const borrowerAssetBalanceBefore = await meld.balanceOf(
          borrower.address
        );
        const mTokenAssetBalanceBefore = await meld.balanceOf(
          reserveDataBeforeRepay.mTokenAddress
        );

        const depositorAssetBalanceBefore = await meld.balanceOf(
          depositor.address
        );

        const randoAssetBalanceBefore = await meld.balanceOf(rando.address);

        // Get delegator user reserve data before repaying
        const depositorUserDataBeforeRepay: UserReserveData = await getUserData(
          lendingPool,
          meldProtocolDataProvider,
          await meld.getAddress(),
          depositor.address
        );

        // Ensure that time-dependent data retrieved from the protocol is same as data when the tx is executed
        time.setNextBlockTimestamp(await time.latest());

        // Repay full debt
        await lendingPool.connect(rando).repay(
          await meld.getAddress(),
          depositorUserDataBeforeRepay.currentVariableDebt, // can't use MaxUint256 when repaying on behalf of someone else
          RateMode.Variable,
          depositor.address
        );

        // Check token balances
        expect(await variableDebtToken.balanceOf(depositor.address)).to.equal(
          0n
        );

        expect(
          await variableDebtToken.scaledBalanceOf(depositor.address)
        ).to.equal(0n);

        // Check variable debt total and scaled supply
        expect(await variableDebtToken.totalSupply()).to.equal(0n);

        expect(await variableDebtToken.scaledTotalSupply()).to.equal(0n);

        // Check borrower tokens after repayment
        expect(await meld.balanceOf(borrower.address)).to.equal(
          borrowerAssetBalanceBefore
        );

        // Check depositor tokens after repayment
        expect(await meld.balanceOf(depositor.address)).to.equal(
          depositorAssetBalanceBefore
        );

        // Check rando tokens after repayment
        expect(await meld.balanceOf(rando.address)).to.equal(
          randoAssetBalanceBefore -
            depositorUserDataBeforeRepay.currentVariableDebt
        );

        // mToken should have balanceBefore plus whole borrow amount
        expect(
          await meld.balanceOf(reserveDataBeforeRepay.mTokenAddress)
        ).to.equal(
          mTokenAssetBalanceBefore +
            depositorUserDataBeforeRepay.currentVariableDebt
        );
      });
    }); // End of Happy Flow Test Cases Context

    context("Error Test Cases", async function () {
      // Repay is tested thoroughly in a separate test file. Here we only have a on test case that should be tested for credit delegated loans
      it("Should revert if borrower tries to repay full debt using Maxuint256", async function () {
        const { lendingPool, meld, depositor, borrower } = await loadFixture(
          setUpVariableBorrowFixture
        );

        await expect(
          lendingPool
            .connect(borrower)
            .repay(meld, MaxUint256, RateMode.Variable, depositor.address)
        ).to.revertedWith(
          ProtocolErrors.VL_NO_EXPLICIT_AMOUNT_TO_REPAY_ON_BEHALF
        );
      });
    });
  }); // End of Repay Credit Delegated Loan Context
}); // End of Credit Delegation Describe
