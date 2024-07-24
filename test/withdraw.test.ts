import { ethers } from "hardhat";
import { ZeroAddress, MaxUint256 } from "ethers";
import {
  allocateAndApproveTokens,
  getBlockTimestamps,
  setRewards,
  setUpTestFixture,
} from "./helpers/utils/utils";
import {
  ReserveData,
  UserReserveData,
  BlockTimestamps,
} from "./helpers/interfaces";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { convertToCurrencyDecimals } from "./helpers/utils/contracts-helpers";
import {
  calcExpectedReserveDataAfterWithdraw,
  calcExpectedUserDataAfterWithdraw,
  calcExpectedMTokenBalance,
} from "./helpers/utils/calculations";
import {
  getReserveData,
  getUserData,
  expectEqual,
} from "./helpers/utils/helpers";
import {
  ProtocolErrors,
  RateMode,
  Action,
  MeldBankerType,
} from "./helpers/types";
import { ONE_YEAR } from "./helpers/constants";
import { anyUint } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

describe("Withdraw", function () {
  async function depositForSingleDepositorFixture() {
    const {
      usdc,
      meld,
      tether,
      owner,
      borrower,
      depositor,
      yieldBoostStorageUSDC,
      ...contracts
    } = await setUpTestFixture();

    // Deposit liquidity

    // USDC
    const depositAmountUSDC = await allocateAndApproveTokens(
      usdc,
      owner,
      depositor,
      contracts.lendingPool,
      5000n,
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
    const depositAmountMELD = await allocateAndApproveTokens(
      meld,
      owner,
      depositor,
      contracts.lendingPool,
      20000n,
      0n
    );

    await contracts.lendingPool
      .connect(depositor)
      .deposit(
        await meld.getAddress(),
        depositAmountMELD,
        depositor.address,
        true,
        0
      );

    return {
      meld,
      usdc,
      tether,
      owner,
      depositor,
      borrower,
      depositAmountUSDC,
      depositAmountMELD,
      yieldBoostStorageUSDC,
      ...contracts,
    };
  }

  async function depositForMultipleDepositorsFixture() {
    const {
      meld,
      usdc,
      owner,
      depositor,
      rando,
      depositAmountUSDC,
      depositAmountMELD,
      ...contracts
    } = await depositForSingleDepositorFixture();

    // Depositor 2
    // USDC
    const depositAmountUSDC2 = await allocateAndApproveTokens(
      usdc,
      owner,
      rando,
      contracts.lendingPool,
      1000n,
      0n
    );

    await contracts.lendingPool
      .connect(rando)
      .deposit(
        await usdc.getAddress(),
        depositAmountUSDC2,
        rando.address,
        true,
        0
      );

    // MELD
    const depositAmountMELD2 = await allocateAndApproveTokens(
      meld,
      owner,
      rando,
      contracts.lendingPool,
      10000n,
      0n
    );

    await contracts.lendingPool
      .connect(rando)
      .deposit(
        await meld.getAddress(),
        depositAmountMELD2,
        rando.address,
        true,
        0
      );

    return {
      meld,
      usdc,
      owner,
      depositor,
      rando,
      depositAmountUSDC,
      depositAmountMELD,
      depositAmountUSDC2,
      depositAmountMELD2,
      ...contracts,
    };
  }

  async function borrowFixture() {
    const {
      meld,
      usdc,
      owner,
      depositor,
      borrower,
      depositAmountUSDC,
      depositAmountMELD,
      ...contracts
    } = await depositForSingleDepositorFixture();

    // Borrower deposits MELD as collateral
    const depositAmountMELDCollateral = await allocateAndApproveTokens(
      meld,
      owner,
      borrower,
      contracts.lendingPool,
      20000n,
      0n
    );

    await contracts.lendingPool
      .connect(borrower)
      .deposit(
        await meld.getAddress(),
        depositAmountMELDCollateral,
        borrower.address,
        true,
        0
      );

    return {
      ...contracts,
      depositAmountUSDC,
      depositAmountMELD,
      depositAmountMELDCollateral,
      usdc,
      meld,
      owner,
      depositor,
      borrower,
    };
  }

  async function multipleDepositorsForBorrowFixture() {
    const {
      depositAmountUSDC,
      depositAmountUSDC2,
      expectedReserveTokenAddresses,
      meld,
      usdc,
      owner,
      depositor,
      borrower,
      rando,
      ...contracts
    } = await depositForMultipleDepositorsFixture();

    // Borrower deposits MELD as collateral
    const depositAmountMELDCollateral = await allocateAndApproveTokens(
      meld,
      owner,
      borrower,
      contracts.lendingPool,
      20000n,
      0n
    );

    await contracts.lendingPool
      .connect(borrower)
      .deposit(
        await meld.getAddress(),
        depositAmountMELDCollateral,
        borrower.address,
        true,
        0
      );

    return {
      ...contracts,
      expectedReserveTokenAddresses,
      depositAmountUSDC,
      depositAmountUSDC2,
      depositAmountMELDCollateral,
      usdc,
      meld,
      owner,
      depositor,
      borrower,
      rando,
    };
  }

  async function depositForSingleMeldBankerFixture() {
    const {
      usdc,
      owner,
      borrower,
      meldBanker,
      meldBankerTokenId,
      yieldBoostStorageUSDC,
      ...contracts
    } = await setUpTestFixture();

    // Deposit liquidity

    // USDC
    const depositAmountUSDC = await allocateAndApproveTokens(
      usdc,
      owner,
      meldBanker,
      contracts.lendingPool,
      5000n,
      0n
    );

    await contracts.lendingPool
      .connect(meldBanker)
      .deposit(
        await usdc.getAddress(),
        depositAmountUSDC,
        meldBanker.address,
        true,
        meldBankerTokenId
      );

    return {
      usdc,
      owner,
      borrower,
      meldBanker,
      meldBankerTokenId,
      depositAmountUSDC,
      yieldBoostStorageUSDC,
      ...contracts,
    };
  }

  async function depositForSingleGoldenBankerFixture() {
    const {
      usdc,
      owner,
      borrower,
      rewardsSetter,
      goldenBanker,
      goldenBankerTokenId,
      yieldBoostStorageUSDC,
      ...contracts
    } = await setUpTestFixture();

    // Deposit liquidity

    // USDC
    const depositAmountUSDC = await allocateAndApproveTokens(
      usdc,
      owner,
      goldenBanker,
      contracts.lendingPool,
      5000n,
      0n
    );

    await contracts.lendingPool
      .connect(goldenBanker)
      .deposit(
        await usdc.getAddress(),
        depositAmountUSDC,
        goldenBanker.address,
        true,
        goldenBankerTokenId
      );

    return {
      usdc,
      owner,
      borrower,
      rewardsSetter,
      goldenBanker,
      goldenBankerTokenId,
      depositAmountUSDC,
      yieldBoostStorageUSDC,
      ...contracts,
    };
  }

  context("Happy Flow Test Cases", async function () {
    context("Regular User", async function () {
      context("Single withdrawal", async function () {
        it("Should emit correct events when partial balance is withdrawn", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            expectedReserveTokenAddresses,
            addressesProvider,
            meld,
            usdc,
            owner,
            depositor,
            rewardsSetter,
            depositAmountUSDC,
            yieldBoostStorageUSDC,
            yieldBoostStakingUSDC,
          } = await loadFixture(depositForSingleDepositorFixture);

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

          // Withdraw USDC from the lending pool
          const amountToWithdraw = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "2000"
          );

          // Get reserve data before withdrawal
          const reserveDataBeforeWithdrawal: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before withdrawal
          const userDataBeforeWithdrawal: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await usdc.getAddress(),
            depositor.address
          );

          // Instantiate mUSDC contract
          const mUSDC = await ethers.getContractAt(
            "MToken",
            expectedReserveTokenAddresses.get("USDC").Mtoken
          );

          const withdrawTx = await lendingPool
            .connect(depositor)
            .withdraw(
              await usdc.getAddress(),
              depositor.address,
              amountToWithdraw,
              depositor.address
            );

          // Hardhat time module. Gets timestamp of latest block.
          const blockTimestamp = await time.latest();

          // Calculate expected reserve data after withdrawal
          const expectedReserveDataAfterWithdrawal =
            calcExpectedReserveDataAfterWithdraw(
              amountToWithdraw,
              reserveDataBeforeWithdrawal,
              userDataBeforeWithdrawal,
              BigInt(blockTimestamp)
            );

          // The Withdraw event is emitted by the WithdrawLogic.sol library, so we need to get the contract instance with the WithdrawLogic ABI
          const contractInstanceWithWithdrawLibraryABI =
            await ethers.getContractAt(
              "WithdrawLogic",
              await lendingPool.getAddress(),
              owner
            );

          await expect(withdrawTx)
            .emit(contractInstanceWithWithdrawLibraryABI, "Withdraw")
            .withArgs(
              await usdc.getAddress(),
              depositor.address,
              depositor.address,
              depositor.address,
              amountToWithdraw
            );

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          await expect(withdrawTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await usdc.getAddress(),
              expectedReserveDataAfterWithdrawal.liquidityRate,
              expectedReserveDataAfterWithdrawal.stableBorrowRate,
              expectedReserveDataAfterWithdrawal.variableBorrowRate,
              expectedReserveDataAfterWithdrawal.liquidityIndex,
              expectedReserveDataAfterWithdrawal.variableBorrowIndex
            );

          await expect(withdrawTx)
            .to.emit(mUSDC, "Transfer")
            .withArgs(depositor.address, ethers.ZeroAddress, amountToWithdraw);

          await expect(withdrawTx)
            .to.emit(mUSDC, "Burn")
            .withArgs(
              depositor.address,
              depositor.address,
              amountToWithdraw,
              expectedReserveDataAfterWithdrawal.liquidityIndex
            );

          await expect(withdrawTx).to.not.emit(mUSDC, "Mint");

          const meldBankerData = await lendingPool.userMeldBankerData(
            depositor.address
          );

          // Regular users should get the default yield boost (100%) for deposit
          const yieldBoostMultiplier = await lendingPool.yieldBoostMultipliers(
            meldBankerData.meldBankerType,
            Action.DEPOSIT
          );

          const expectedOldStakedAmount =
            depositAmountUSDC.percentMul(yieldBoostMultiplier);

          const expectedNewStakedAmount = (
            depositAmountUSDC - amountToWithdraw
          ).percentMul(yieldBoostMultiplier);

          await expect(withdrawTx)
            .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
            .withArgs(
              depositor.address,
              expectedOldStakedAmount,
              expectedNewStakedAmount
            );

          await expect(withdrawTx).to.not.emit(
            yieldBoostStakingUSDC,
            "StakePositionRemoved"
          );

          await expect(withdrawTx).to.not.emit(
            yieldBoostStakingUSDC,
            "RewardsClaimed"
          );

          await expect(withdrawTx)
            .to.emit(lendingPool, "RefreshYieldBoostAmount")
            .withArgs(
              await usdc.getAddress(),
              depositor.address,
              expectedNewStakedAmount
            );

          await expect(withdrawTx).to.not.emit(
            lendingPool,
            "UnlockMeldBankerNFT"
          );
        });

        it("Should emit correct events when whole balance is withdrawn", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            expectedReserveTokenAddresses,
            addressesProvider,
            meld,
            usdc,
            depositAmountUSDC,
            owner,
            depositor,
            rewardsSetter,
            yieldBoostStorageUSDC,
            yieldBoostStakingUSDC,
          } = await loadFixture(depositForSingleDepositorFixture);

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

          // Get reserve data before withdrawal
          const reserveDataBeforeWithdrawal: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before withdrawal
          const userDataBeforeWithdrawal: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await usdc.getAddress(),
            depositor.address
          );

          // Instantiate mUSDC contract
          const mUSDC = await ethers.getContractAt(
            "MToken",
            expectedReserveTokenAddresses.get("USDC").Mtoken
          );

          const meldBankerDataBefore = await lendingPool.userMeldBankerData(
            depositor.address
          );

          // Regular users should get the default yield boost (100%) for deposit
          const yieldBoostMultiplier = await lendingPool.yieldBoostMultipliers(
            meldBankerDataBefore.meldBankerType,
            Action.DEPOSIT
          );

          // Passing in MaxUint256 to withdraw the full user balance of the asset
          const withdrawTx = await lendingPool
            .connect(depositor)
            .withdraw(
              await usdc.getAddress(),
              depositor.address,
              MaxUint256,
              depositor.address
            );

          // Hardhat time module. Gets timestamp of latest block.
          const blockTimestamp = await time.latest();

          // Calculate expected reserve data after withdrawal
          const expectedReserveDataAfterWithdrawal =
            calcExpectedReserveDataAfterWithdraw(
              MaxUint256,
              reserveDataBeforeWithdrawal,
              userDataBeforeWithdrawal,
              BigInt(blockTimestamp)
            );

          // The Withdraw event is emitted by the WithdrawLogic.sol library, so we need to get the contract instance with the WithdrawLogic ABI
          const contractInstanceWithWithdrawLibraryABI =
            await ethers.getContractAt(
              "WithdrawLogic",
              await lendingPool.getAddress(),
              owner
            );

          await expect(withdrawTx)
            .emit(contractInstanceWithWithdrawLibraryABI, "Withdraw")
            .withArgs(
              await usdc.getAddress(),
              depositor.address,
              depositor.address,
              depositor.address,
              depositAmountUSDC
            );

          await expect(withdrawTx)
            .emit(lendingPool, "ReserveUsedAsCollateralDisabled")
            .withArgs(await usdc.getAddress(), depositor.address);

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          await expect(withdrawTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await usdc.getAddress(),
              expectedReserveDataAfterWithdrawal.liquidityRate,
              expectedReserveDataAfterWithdrawal.stableBorrowRate,
              expectedReserveDataAfterWithdrawal.variableBorrowRate,
              expectedReserveDataAfterWithdrawal.liquidityIndex,
              expectedReserveDataAfterWithdrawal.variableBorrowIndex
            );

          await expect(withdrawTx)
            .to.emit(mUSDC, "Transfer")
            .withArgs(depositor.address, ethers.ZeroAddress, depositAmountUSDC);

          await expect(withdrawTx)
            .to.emit(mUSDC, "Burn")
            .withArgs(
              depositor.address,
              depositor.address,
              depositAmountUSDC,
              expectedReserveDataAfterWithdrawal.liquidityIndex
            );

          await expect(withdrawTx).to.not.emit(mUSDC, "Mint");

          const expectedOldStakedAmount =
            depositAmountUSDC.percentMul(yieldBoostMultiplier);

          await expect(withdrawTx)
            .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
            .withArgs(depositor.address, expectedOldStakedAmount, 0n);

          await expect(withdrawTx)
            .to.emit(yieldBoostStakingUSDC, "StakePositionRemoved")
            .withArgs(depositor.address, expectedOldStakedAmount);

          await expect(withdrawTx)
            .to.emit(yieldBoostStakingUSDC, "RewardsClaimed")
            .withArgs(depositor.address, depositor.address, anyUint, anyUint);

          await expect(withdrawTx)
            .to.emit(lendingPool, "RefreshYieldBoostAmount")
            .withArgs(await usdc.getAddress(), depositor.address, 0n);

          await expect(withdrawTx).to.not.emit(
            lendingPool,
            "UnlockMeldBankerNFT"
          );
        });

        it("Should emit correct events when reasonable partial collateral balance is withdrawn", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            usdc,
            meld,
            owner,
            borrower,
          } = await loadFixture(borrowFixture);

          // Borrower borrows USDC from the lending pool
          const amountToBorrow = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "500"
          );

          await lendingPool
            .connect(borrower)
            .borrow(
              await usdc.getAddress(),
              amountToBorrow,
              RateMode.Variable,
              borrower.address,
              0
            );

          // Borrower withdraws MELD (collateral token) from the lending pool
          const amountToWithdraw = await convertToCurrencyDecimals(
            await meld.getAddress(),
            "18000" // collateral deposited = 20000
          );

          // Get reserve data before withdrawal
          const reserveDataBeforeWithdrawal: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before withdrawal
          const userDataBeforeWithdrawal: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await meld.getAddress(),
            borrower.address
          );

          // Instantiate mMELD contract
          const mMELD = await ethers.getContractAt(
            "MToken",
            reserveDataBeforeWithdrawal.mTokenAddress
          );

          const withdrawTx = await lendingPool
            .connect(borrower)
            .withdraw(
              await meld.getAddress(),
              borrower.address,
              amountToWithdraw,
              borrower.address
            );

          // Hardhat time module. Gets timestamp of latest block.
          const blockTimestamp = await time.latest();

          // Calculate expected reserve data after withdrawal
          const expectedReserveDataAfterWithdrawal =
            calcExpectedReserveDataAfterWithdraw(
              amountToWithdraw,
              reserveDataBeforeWithdrawal,
              userDataBeforeWithdrawal,
              BigInt(blockTimestamp)
            );

          // The Withdraw event is emitted by the WithdrawLogic.sol library, so we need to get the contract instance with the WithdrawLogic ABI
          const contractInstanceWithWithdrawLibraryABI =
            await ethers.getContractAt(
              "WithdrawLogic",
              await lendingPool.getAddress(),
              owner
            );

          await expect(withdrawTx)
            .emit(contractInstanceWithWithdrawLibraryABI, "Withdraw")
            .withArgs(
              await meld.getAddress(),
              borrower.address,
              borrower.address,
              borrower.address,
              amountToWithdraw
            );

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          await expect(withdrawTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await meld.getAddress(),
              expectedReserveDataAfterWithdrawal.liquidityRate,
              expectedReserveDataAfterWithdrawal.stableBorrowRate,
              expectedReserveDataAfterWithdrawal.variableBorrowRate,
              expectedReserveDataAfterWithdrawal.liquidityIndex,
              expectedReserveDataAfterWithdrawal.variableBorrowIndex
            );

          await expect(withdrawTx)
            .to.emit(mMELD, "Transfer")
            .withArgs(borrower.address, ethers.ZeroAddress, amountToWithdraw);

          await expect(withdrawTx)
            .to.emit(mMELD, "Burn")
            .withArgs(
              borrower.address,
              borrower.address,
              amountToWithdraw,
              expectedReserveDataAfterWithdrawal.liquidityIndex
            );

          await expect(withdrawTx).to.not.emit(mMELD, "Mint");
        });

        it("Should update state correctly", async function () {
          // Load the test fixture
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            usdc,
            depositor,
          } = await loadFixture(depositForSingleDepositorFixture);

          // Get reserve data before withdrawal
          const reserveDataBeforeWithdrawal: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user data before withdrawal
          const userDataBeforeWithdrawal: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await usdc.getAddress(),
            depositor.address
          );

          // Withdraw USDC from the lending pool
          const amountToWithdraw = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "3000"
          );

          await lendingPool
            .connect(depositor)
            .withdraw(
              await usdc.getAddress(),
              depositor.address,
              amountToWithdraw,
              depositor.address
            );

          // Hardhat time module. Gets timestamp of latest block.
          const blockTimestamp = await time.latest();

          // Calculate expected reserve data after withdrawal
          const expectedReserveDataAfterWithdrawal: ReserveData =
            calcExpectedReserveDataAfterWithdraw(
              amountToWithdraw,
              reserveDataBeforeWithdrawal,
              userDataBeforeWithdrawal,
              BigInt(blockTimestamp)
            );

          // Get reserve data after withdrawal
          const reserveDataAfterWithdrawal: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Calculate expected user data after withdrawal
          const expectedUserDataAfterWithdrawal: UserReserveData =
            calcExpectedUserDataAfterWithdraw(
              amountToWithdraw,
              reserveDataBeforeWithdrawal,
              reserveDataAfterWithdrawal,
              userDataBeforeWithdrawal,
              BigInt(blockTimestamp)
            );

          // Get user data after withdrawal
          const userDataAfterWithdrawal: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await usdc.getAddress(),
            depositor.address
          );

          // Check that the reserve data and user data were updated correctly
          expectEqual(
            reserveDataAfterWithdrawal,
            expectedReserveDataAfterWithdrawal
          );
          expectEqual(userDataAfterWithdrawal, expectedUserDataAfterWithdrawal);
        });

        it("Should return the correct amount withdrawn", async function () {
          // Load the test fixture
          const { lendingPool, usdc, depositAmountUSDC, depositor } =
            await loadFixture(depositForSingleDepositorFixture);

          // Call LendingPool.withdraw using staticCall to get the return value.
          // MaxUint256 is used to withdraw the full user balance of the asset
          const amountWithdrawn = await lendingPool
            .connect(depositor)
            .withdraw.staticCall(
              await usdc.getAddress(),
              depositor.address,
              MaxUint256,
              depositor.address
            );

          // Check that the return value is correct
          expect(amountWithdrawn).to.equal(depositAmountUSDC);
        });

        it("Should update token balances correctly when 'to' address is same as caller", async function () {
          // Load the test fixture
          const {
            lendingPool,
            expectedReserveTokenAddresses,
            usdc,
            depositAmountUSDC,
            depositor,
          } = await loadFixture(depositForSingleDepositorFixture);

          // Instantiate mUSDC contract
          const mUSDC = await ethers.getContractAt(
            "MToken",
            expectedReserveTokenAddresses.get("USDC").Mtoken
          );

          await lendingPool
            .connect(depositor)
            .withdraw(
              await usdc.getAddress(),
              depositor.address,
              MaxUint256,
              depositor.address
            );

          // Check token balances
          expect(await usdc.balanceOf(await mUSDC.getAddress())).to.equal(0);
          expect(await usdc.balanceOf(depositor.address)).to.equal(
            depositAmountUSDC
          );
          expect(await mUSDC.balanceOf(depositor.address)).to.equal(0);
        });

        it("Should update token balances correctly when 'to' address is different from caller", async function () {
          // Load the test fixture
          const {
            lendingPool,
            expectedReserveTokenAddresses,
            usdc,
            depositAmountUSDC,
            depositor,
            thirdParty,
          } = await loadFixture(depositForSingleDepositorFixture);

          // Instantiate mUSDC contract
          const mUSDC = await ethers.getContractAt(
            "MToken",
            expectedReserveTokenAddresses.get("USDC").Mtoken
          );

          // Withdraw USDC from the lending pool
          const amountToWithdraw = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "3000"
          );

          await lendingPool
            .connect(depositor)
            .withdraw(
              await usdc.getAddress(),
              depositor.address,
              amountToWithdraw,
              thirdParty.address
            );

          // Check token balances
          expect(await usdc.balanceOf(await mUSDC.getAddress())).to.equal(
            depositAmountUSDC - amountToWithdraw
          );
          expect(await usdc.balanceOf(thirdParty.address)).to.equal(
            amountToWithdraw
          );
          expect(await mUSDC.balanceOf(depositor.address)).to.equal(
            depositAmountUSDC - amountToWithdraw
          );
        });

        it("Should update token balances correctly when interest has accrued", async function () {
          // Load the test fixture
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            usdc,
            depositor,
            borrower,
          } = await loadFixture(borrowFixture);

          // In order for interest to accrue there must be funds borrowed (and paying interest).
          // Deposit of USDC by depositor for liquidity and MELD by borrower for collateral
          // has already been done in borrowFixture

          // Borrower borrows USDC from the lending pool
          const amountToBorrow = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "500"
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

          // Simulate time passing so that interest is accrued on borrowed amount
          await time.increase(ONE_YEAR / 2);

          // Get USDC reserve data after borrow
          const reserveDataAfterBorrow: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user USDC data after borrow
          const userDataAfterBorrow: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await usdc.getAddress(),
            depositor.address
          );

          // Instantiate mUSDC contract
          const mUSDC = await ethers.getContractAt(
            "MToken",
            reserveDataAfterBorrow.mTokenAddress
          );

          const blockTimestamps: BlockTimestamps =
            await getBlockTimestamps(borrowTx);

          const expectedMTokenBalance = calcExpectedMTokenBalance(
            reserveDataAfterBorrow,
            userDataAfterBorrow,
            blockTimestamps.latestBlockTimestamp
          );

          expect(await mUSDC.balanceOf(depositor.address)).to.equal(
            expectedMTokenBalance
          );

          // Because of borrowed funds, can't withdraw more than available liquidity, even though interest has accrued on the mToken balance
          await lendingPool
            .connect(depositor)
            .withdraw(
              await usdc.getAddress(),
              depositor.address,
              reserveDataAfterBorrow.availableLiquidity,
              depositor.address
            );

          // TO DO: Check that user can withdraw rest of available balance (including interest accrued) after repayment of borrowed funds

          // Check token balances
          expect(await usdc.balanceOf(await mUSDC.getAddress())).to.equal(0);

          expect(await usdc.balanceOf(depositor.address)).to.equal(
            reserveDataAfterBorrow.availableLiquidity
          );
          expect(await mUSDC.balanceOf(depositor.address)).to.equal(
            expectedMTokenBalance - reserveDataAfterBorrow.availableLiquidity
          );
        });

        it("Should return correct value when making a static call", async function () {
          // Load the test fixture
          const { lendingPool, usdc, depositor } = await loadFixture(
            depositForSingleDepositorFixture
          );

          // Withdraw USDC from the lending pool
          const amountToWithdraw = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "3000"
          );

          const returnedWithdrawnAmount = await lendingPool
            .connect(depositor)
            .withdraw.staticCall(
              await usdc.getAddress(),
              depositor.address,
              amountToWithdraw,
              depositor.address
            );

          expect(returnedWithdrawnAmount).to.equal(amountToWithdraw);

          const estimatedGas = await lendingPool
            .connect(depositor)
            .withdraw.estimateGas(
              await usdc.getAddress(),
              depositor.address,
              amountToWithdraw,
              depositor.address
            );

          expect(estimatedGas).to.be.gt(0);
        });
      }); // End Single withdrawal Context

      context(
        "Multiple withdrawals of same asset by same withdrawer",
        async function () {
          it("Should emit correct events", async function () {
            // Load the test fixture
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              expectedReserveTokenAddresses,
              usdc,
              owner,
              depositor,
            } = await loadFixture(depositForSingleDepositorFixture);

            // Withdraw USDC from the lending pool twice
            const amountToWithdraw = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "2000"
            );

            const amountToWithdraw2 = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "3000"
            );

            await lendingPool
              .connect(depositor)
              .withdraw(
                await usdc.getAddress(),
                depositor.address,
                amountToWithdraw,
                depositor.address
              );

            // Get reserve data before withdrawal 2
            const reserveDataBeforeWithdrawal2: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await usdc.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get user reserve data before withdrawal 2
            const userDataBeforeWithdrawal2: UserReserveData =
              await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await usdc.getAddress(),
                depositor.address
              );

            const secondWithdrawTx = await lendingPool
              .connect(depositor)
              .withdraw(
                await usdc.getAddress(),
                depositor.address,
                amountToWithdraw2,
                depositor.address
              );

            // Hardhat time module. Gets timestamp of latest block.
            const blockTimestamp = await time.latest();

            // Calculate expected reserve data after withdrawal
            const expectedReserveDataAfterWithdrawal2 =
              calcExpectedReserveDataAfterWithdraw(
                amountToWithdraw2,
                reserveDataBeforeWithdrawal2,
                userDataBeforeWithdrawal2,
                BigInt(blockTimestamp)
              );

            // Instantiate mUSDC contract
            const mUSDC = await ethers.getContractAt(
              "MToken",
              expectedReserveTokenAddresses.get("USDC").Mtoken
            );

            // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
            const contractInstanceWithLibraryABI = await ethers.getContractAt(
              "ReserveLogic",
              await lendingPool.getAddress(),
              owner
            );

            // The Withdraw event is emitted by the WithdrawLogic.sol library, so we need to get the contract instance with the WithdrawLogic ABI
            const contractInstanceWithWithdrawLibraryABI =
              await ethers.getContractAt(
                "WithdrawLogic",
                await lendingPool.getAddress(),
                owner
              );

            // Check that the events were emitted correctly for the second withdrawal
            await expect(secondWithdrawTx)
              .emit(contractInstanceWithWithdrawLibraryABI, "Withdraw")
              .withArgs(
                await usdc.getAddress(),
                depositor.address,
                depositor.address,
                depositor.address,
                amountToWithdraw2
              );

            await expect(secondWithdrawTx)
              .emit(lendingPool, "ReserveUsedAsCollateralDisabled")
              .withArgs(await usdc.getAddress(), depositor.address);

            await expect(secondWithdrawTx)
              .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
              .withArgs(
                await usdc.getAddress(),
                expectedReserveDataAfterWithdrawal2.liquidityRate,
                expectedReserveDataAfterWithdrawal2.stableBorrowRate,
                expectedReserveDataAfterWithdrawal2.variableBorrowRate,
                expectedReserveDataAfterWithdrawal2.liquidityIndex,
                expectedReserveDataAfterWithdrawal2.variableBorrowIndex
              );

            await expect(secondWithdrawTx)
              .to.emit(mUSDC, "Transfer")
              .withArgs(
                depositor.address,
                ethers.ZeroAddress,
                amountToWithdraw2
              );

            await expect(secondWithdrawTx)
              .to.emit(mUSDC, "Burn")
              .withArgs(
                depositor.address,
                depositor.address,
                amountToWithdraw2,
                expectedReserveDataAfterWithdrawal2.liquidityIndex
              );
            await expect(secondWithdrawTx).to.not.emit(mUSDC, "Mint");
          });

          it("Should update state correctly", async function () {
            // Load the test fixture
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              usdc,
              depositor,
            } = await loadFixture(depositForSingleDepositorFixture);

            // Withdraw USDC from the lending pool twice
            const amountToWithdraw = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "2000"
            );

            const amountToWithdraw2 = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "3000"
            );

            await lendingPool
              .connect(depositor)
              .withdraw(
                await usdc.getAddress(),
                depositor.address,
                amountToWithdraw,
                depositor.address
              );

            // Get reserve data before withdrawal 2
            const reserveDataBeforeWithdrawal2: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await usdc.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get user reserve data before withdrawal 2
            const userDataBeforeWithdrawal2: UserReserveData =
              await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await usdc.getAddress(),
                depositor.address
              );

            await lendingPool
              .connect(depositor)
              .withdraw(
                await usdc.getAddress(),
                depositor.address,
                amountToWithdraw2,
                depositor.address
              );

            // Hardhat time module. Gets timestamp of latest block.
            const blockTimestamp = await time.latest();

            // Calculate expected reserve data after withdrawal
            const expectedReserveDataAfterWithdrawal2 =
              calcExpectedReserveDataAfterWithdraw(
                amountToWithdraw2,
                reserveDataBeforeWithdrawal2,
                userDataBeforeWithdrawal2,
                BigInt(blockTimestamp)
              );

            // Get reserve data after withdrawal
            const reserveDataAfterWithdrawal2: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await usdc.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Calculate expected user data after withdrawal
            const expectedUserDataAfterWithdrawal2: UserReserveData =
              calcExpectedUserDataAfterWithdraw(
                amountToWithdraw2,
                reserveDataBeforeWithdrawal2,
                reserveDataAfterWithdrawal2,
                userDataBeforeWithdrawal2,
                BigInt(blockTimestamp)
              );

            // Get user data after withdrawal
            const userDataAfterWithdrawal2: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              depositor.address
            );

            // Check that the reserve data and user data were updated correctly after second withdrawal
            expectEqual(
              reserveDataAfterWithdrawal2,
              expectedReserveDataAfterWithdrawal2
            );

            expectEqual(
              userDataAfterWithdrawal2,
              expectedUserDataAfterWithdrawal2
            );
          });

          it("Should return the correct amount withdrawn", async function () {
            // Load the test fixture
            const { lendingPool, usdc, depositor } = await loadFixture(
              depositForSingleDepositorFixture
            );

            const amountToWithdraw = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "2000"
            );

            // Call LendingPool.withdraw using staticCall to get the return value.
            const amountWithdrawn = await lendingPool
              .connect(depositor)
              .withdraw.staticCall(
                await usdc.getAddress(),
                depositor.address,
                amountToWithdraw,
                depositor.address
              );

            // Check that the return value is correct
            expect(amountWithdrawn).to.equal(amountToWithdraw);
          });

          it("Should update token balances correctly when 'to' address is same as caller", async function () {
            // Load the test fixture
            const {
              lendingPool,
              expectedReserveTokenAddresses,
              usdc,
              depositAmountUSDC,
              depositor,
            } = await loadFixture(depositForSingleDepositorFixture);

            // Instantiate mUSDC contract
            const mUSDC = await ethers.getContractAt(
              "MToken",
              expectedReserveTokenAddresses.get("USDC").Mtoken
            );

            const amountToWithdraw = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "2000"
            );

            await lendingPool
              .connect(depositor)
              .withdraw(
                await usdc.getAddress(),
                depositor.address,
                amountToWithdraw,
                depositor.address
              );

            // Withdraw same amount again
            await lendingPool
              .connect(depositor)
              .withdraw(
                await usdc.getAddress(),
                depositor.address,
                amountToWithdraw,
                depositor.address
              );

            const expectedAmountRemaining = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "1000"
            );

            // Check token balances
            expect(await usdc.balanceOf(await mUSDC.getAddress())).to.equal(
              expectedAmountRemaining
            );
            expect(await usdc.balanceOf(depositor.address)).to.equal(
              depositAmountUSDC - expectedAmountRemaining
            );
            expect(await mUSDC.balanceOf(depositor.address)).to.equal(
              expectedAmountRemaining
            );
          });

          it("Should update token balances correctly when 'to' address is different from caller", async function () {
            // Load the test fixture
            const {
              lendingPool,
              expectedReserveTokenAddresses,
              usdc,
              depositAmountUSDC,
              depositor,
              thirdParty,
            } = await loadFixture(depositForSingleDepositorFixture);

            // Instantiate mUSDC contract
            const mUSDC = await ethers.getContractAt(
              "MToken",
              expectedReserveTokenAddresses.get("USDC").Mtoken
            );

            const amountToWithdraw = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "2000"
            );

            await lendingPool
              .connect(depositor)
              .withdraw(
                await usdc.getAddress(),
                depositor.address,
                amountToWithdraw,
                thirdParty.address
              );

            // Withdraw same amount again
            await lendingPool
              .connect(depositor)
              .withdraw(
                await usdc.getAddress(),
                depositor.address,
                amountToWithdraw,
                thirdParty.address
              );

            const expectedAmountRemaining = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "1000"
            );

            // Check token balances
            expect(await usdc.balanceOf(await mUSDC.getAddress())).to.equal(
              expectedAmountRemaining
            );
            expect(await usdc.balanceOf(thirdParty.address)).to.equal(
              depositAmountUSDC - expectedAmountRemaining
            );
            expect(await mUSDC.balanceOf(thirdParty.address)).to.equal(0);
            expect(await mUSDC.balanceOf(depositor.address)).to.equal(
              expectedAmountRemaining
            );
          });
        }
      );

      context(
        "Multiple withdrawals of same asset by different withdrawers",
        async function () {
          it("Should emit correct events", async function () {
            // Load the test fixture
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              expectedReserveTokenAddresses,
              usdc,
              owner,
              depositor,
              rando,
            } = await loadFixture(depositForMultipleDepositorsFixture);

            // Withdraw USDC from the lending pool twice
            const amountToWithdraw1 = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "2000"
            );
            const firstWithdrawTx = await lendingPool
              .connect(depositor)
              .withdraw(
                await usdc.getAddress(),
                depositor.address,
                amountToWithdraw1,
                depositor.address
              );

            // Get reserve data before second withdrawal
            const reserveDataBeforeWithdrawal2: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await usdc.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get user reserve data before second withdrawal
            const userDataBeforeWithdrawal2: UserReserveData =
              await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await usdc.getAddress(),
                rando.address
              );

            const amountToWithdraw2 = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "1000"
            );

            const secondWithdrawTx = await lendingPool
              .connect(rando)
              .withdraw(
                await usdc.getAddress(),
                rando.address,
                MaxUint256,
                rando.address
              );

            // Hardhat time module. Gets timestamp of latest block.
            const blockTimestamp = await time.latest();

            // Calculate expected reserve data after second withdrawal
            const expectedReserveDataAfterWithdrawal2 =
              calcExpectedReserveDataAfterWithdraw(
                amountToWithdraw2,
                reserveDataBeforeWithdrawal2,
                userDataBeforeWithdrawal2,
                BigInt(blockTimestamp)
              );

            // Instantiate mUSDC contract
            const mUSDC = await ethers.getContractAt(
              "MToken",
              expectedReserveTokenAddresses.get("USDC").Mtoken
            );

            // The Withdraw event is emitted by the WithdrawLogic.sol library, so we need to get the contract instance with the WithdrawLogic ABI
            const contractInstanceWithWithdrawLibraryABI =
              await ethers.getContractAt(
                "WithdrawLogic",
                await lendingPool.getAddress(),
                owner
              );

            // Check that the events were emitted correctly for the first withdrawal
            await expect(firstWithdrawTx)
              .emit(contractInstanceWithWithdrawLibraryABI, "Withdraw")
              .withArgs(
                await usdc.getAddress(),
                depositor.address,
                depositor.address,
                depositor.address,
                amountToWithdraw1
              );

            await expect(firstWithdrawTx).to.not.emit(
              lendingPool,
              "ReserveUsedAsCollateralDisabled"
            );

            // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
            const contractInstanceWithLibraryABI = await ethers.getContractAt(
              "ReserveLogic",
              await lendingPool.getAddress(),
              owner
            );
            await expect(firstWithdrawTx)
              .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
              .withArgs(
                await usdc.getAddress(),
                expectedReserveDataAfterWithdrawal2.liquidityRate,
                expectedReserveDataAfterWithdrawal2.stableBorrowRate,
                expectedReserveDataAfterWithdrawal2.variableBorrowRate,
                expectedReserveDataAfterWithdrawal2.liquidityIndex,
                expectedReserveDataAfterWithdrawal2.variableBorrowIndex
              );

            await expect(firstWithdrawTx)
              .to.emit(mUSDC, "Transfer")
              .withArgs(
                depositor.address,
                ethers.ZeroAddress,
                amountToWithdraw1
              );

            await expect(firstWithdrawTx)
              .to.emit(mUSDC, "Burn")
              .withArgs(
                depositor.address,
                depositor.address,
                amountToWithdraw1,
                expectedReserveDataAfterWithdrawal2.liquidityIndex
              );

            await expect(firstWithdrawTx).to.not.emit(mUSDC, "Mint");

            // Check that the events were emitted correctly for the second withdrawal
            await expect(secondWithdrawTx)
              .emit(contractInstanceWithWithdrawLibraryABI, "Withdraw")
              .withArgs(
                await usdc.getAddress(),
                rando.address,
                rando.address,
                rando.address,
                amountToWithdraw2
              );

            await expect(secondWithdrawTx)
              .emit(lendingPool, "ReserveUsedAsCollateralDisabled")
              .withArgs(await usdc.getAddress(), rando.address);

            await expect(secondWithdrawTx)
              .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
              .withArgs(
                await usdc.getAddress(),
                expectedReserveDataAfterWithdrawal2.liquidityRate,
                expectedReserveDataAfterWithdrawal2.stableBorrowRate,
                expectedReserveDataAfterWithdrawal2.variableBorrowRate,
                expectedReserveDataAfterWithdrawal2.liquidityIndex,
                expectedReserveDataAfterWithdrawal2.variableBorrowIndex
              );

            await expect(secondWithdrawTx)
              .to.emit(mUSDC, "Transfer")
              .withArgs(rando.address, ethers.ZeroAddress, amountToWithdraw2);

            await expect(secondWithdrawTx)
              .to.emit(mUSDC, "Burn")
              .withArgs(
                rando.address,
                rando.address,
                amountToWithdraw2,
                expectedReserveDataAfterWithdrawal2.liquidityIndex
              );

            await expect(secondWithdrawTx).to.not.emit(mUSDC, "Mint");
          });

          it("Should update state correctly", async function () {
            // Load the test fixture
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              usdc,
              depositor,
              rando,
            } = await loadFixture(depositForMultipleDepositorsFixture);

            // Two different parties withdraw USDC from the lending pool
            const amountToWithdraw = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "2000"
            );

            const amountToWithdraw2 = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "900"
            );

            await lendingPool
              .connect(depositor)
              .withdraw(
                await usdc.getAddress(),
                depositor.address,
                amountToWithdraw,
                depositor.address
              );

            // Get reserve data before party 2 withdraws
            const reserveDataBeforeWithdrawal2: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await usdc.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get user reserve data before party 2 withdraws
            const userDataBeforeWithdrawal2: UserReserveData =
              await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await usdc.getAddress(),
                rando.address
              );

            await lendingPool
              .connect(rando)
              .withdraw(
                await usdc.getAddress(),
                rando.address,
                amountToWithdraw2,
                rando.address
              );

            // Hardhat time module. Gets timestamp of latest block.
            const blockTimestamp = await time.latest();

            // Calculate expected reserve data after withdrawal
            const expectedReserveDataAfterWithdrawal2 =
              calcExpectedReserveDataAfterWithdraw(
                amountToWithdraw2,
                reserveDataBeforeWithdrawal2,
                userDataBeforeWithdrawal2,
                BigInt(blockTimestamp)
              );

            // Get reserve data after withdrawal
            const reserveDataAfterWithdrawal2: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await usdc.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Calculate expected user data after withdrawal
            const expectedUserDataAfterWithdrawal2: UserReserveData =
              calcExpectedUserDataAfterWithdraw(
                amountToWithdraw2,
                reserveDataBeforeWithdrawal2,
                reserveDataAfterWithdrawal2,
                userDataBeforeWithdrawal2,
                BigInt(blockTimestamp)
              );

            // Get user data after withdrawal
            const userDataAfterWithdrawal2: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              rando.address
            );

            // Check that the reserve data and user data were updated correctly after second withdrawal
            expectEqual(
              reserveDataAfterWithdrawal2,
              expectedReserveDataAfterWithdrawal2
            );

            expectEqual(
              userDataAfterWithdrawal2,
              expectedUserDataAfterWithdrawal2
            );
          });

          it("Should return the correct amount withdrawn", async function () {
            // Load the test fixture
            const { lendingPool, usdc, depositAmountUSDC2, rando } =
              await loadFixture(depositForMultipleDepositorsFixture);

            const amountToWithdraw = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "900"
            );

            // Check two withdraws after each other
            await lendingPool
              .connect(rando)
              .withdraw(
                await usdc.getAddress(),
                rando.address,
                amountToWithdraw,
                rando.address
              );

            const amountWithdrawn = await lendingPool
              .connect(rando)
              .withdraw.staticCall(
                await usdc.getAddress(),
                rando.address,
                MaxUint256,
                rando.address
              );

            // Check that the return value is correct after rest is withdrawn
            expect(amountWithdrawn).to.equal(
              depositAmountUSDC2 - amountToWithdraw
            );
          });

          it("Should update token balances correctly when 'to' address is same as caller", async function () {
            // Load the test fixture
            const {
              lendingPool,
              expectedReserveTokenAddresses,
              usdc,
              depositAmountUSDC,
              depositAmountUSDC2,
              depositor,
              rando,
            } = await loadFixture(depositForMultipleDepositorsFixture);

            // Instantiate mUSDC contract
            const mUSDC = await ethers.getContractAt(
              "MToken",
              expectedReserveTokenAddresses.get("USDC").Mtoken
            );

            const amountToWithdraw = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "2000"
            );

            const amountToWithdraw2 = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "500"
            );

            await lendingPool
              .connect(depositor)
              .withdraw(
                await usdc.getAddress(),
                depositor.address,
                amountToWithdraw,
                depositor.address
              );

            // Party 2 withdraws
            await lendingPool
              .connect(rando)
              .withdraw(
                await usdc.getAddress(),
                rando.address,
                amountToWithdraw2,
                rando.address
              );

            const expectedAmountRemaining =
              depositAmountUSDC +
              depositAmountUSDC2 -
              amountToWithdraw -
              amountToWithdraw2;

            // Check token balances
            expect(await usdc.balanceOf(await mUSDC.getAddress())).to.equal(
              expectedAmountRemaining
            );
            expect(await usdc.balanceOf(depositor.address)).to.equal(
              amountToWithdraw
            );
            expect(await mUSDC.balanceOf(depositor.address)).to.equal(
              depositAmountUSDC - amountToWithdraw
            );
            expect(await usdc.balanceOf(rando.address)).to.equal(
              amountToWithdraw2
            );
            expect(await mUSDC.balanceOf(rando.address)).to.equal(
              depositAmountUSDC2 - amountToWithdraw2
            );
          });

          it("Should update token balances correctly when 'to' address is different from caller", async function () {
            // Load the test fixture
            const {
              lendingPool,
              expectedReserveTokenAddresses,
              usdc,
              depositAmountUSDC,
              depositAmountUSDC2,
              depositor,
              rando,
              thirdParty,
            } = await loadFixture(depositForMultipleDepositorsFixture);

            // Instantiate mUSDC contract
            const mUSDC = await ethers.getContractAt(
              "MToken",
              expectedReserveTokenAddresses.get("USDC").Mtoken
            );

            const amountToWithdraw = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "2000"
            );

            const amountToWithdraw2 = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "500"
            );

            await lendingPool
              .connect(depositor)
              .withdraw(
                await usdc.getAddress(),
                depositor.address,
                amountToWithdraw,
                thirdParty.address
              );

            // Party 2 withdraws
            await lendingPool
              .connect(rando)
              .withdraw(
                await usdc.getAddress(),
                rando.address,
                amountToWithdraw2,
                thirdParty.address
              );

            const expectedAmountRemaining =
              depositAmountUSDC +
              depositAmountUSDC2 -
              amountToWithdraw -
              amountToWithdraw2;

            // Check token balances
            expect(await usdc.balanceOf(await mUSDC.getAddress())).to.equal(
              expectedAmountRemaining
            );
            expect(await usdc.balanceOf(depositor.address)).to.equal(0);
            expect(await mUSDC.balanceOf(depositor.address)).to.equal(
              depositAmountUSDC - amountToWithdraw
            );
            expect(await usdc.balanceOf(rando.address)).to.equal(0);
            expect(await mUSDC.balanceOf(rando.address)).to.equal(
              depositAmountUSDC2 - amountToWithdraw2
            );
            expect(await usdc.balanceOf(thirdParty.address)).to.equal(
              amountToWithdraw + amountToWithdraw2
            );
            expect(await mUSDC.balanceOf(thirdParty.address)).to.equal(0);
          });

          it("Should update token balances correctly when interest has accrued", async function () {
            // Load the test fixture
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              depositor,
              borrower,
              rando,
              usdc,
            } = await loadFixture(multipleDepositorsForBorrowFixture);

            // In order for interest to accrue there must be funds borrowed (and paying interest).

            // Borrower borrows USDC from the lending pool
            const amountToBorrow = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "500"
            );

            await lendingPool
              .connect(borrower)
              .borrow(
                await usdc.getAddress(),
                amountToBorrow,
                RateMode.Variable,
                borrower.address,
                0
              );

            // Simulate time passing so that interest is accrued on borrowed amount
            await time.increase(ONE_YEAR);

            // Get USDC reserve data after borrow
            const reserveDataAfterBorrow: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Get depositor user USDC data after borrow
            const depositorUserDataAfterBorrow: UserReserveData =
              await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await usdc.getAddress(),
                depositor.address
              );

            // Instantiate mUSDC contract
            const mUSDC = await ethers.getContractAt(
              "MToken",
              reserveDataAfterBorrow.mTokenAddress
            );

            await lendingPool.connect(depositor).withdraw(
              await usdc.getAddress(),
              depositor.address,
              MaxUint256, //depositor's whole balance
              depositor.address
            );

            // Get USDC reserve data after withdrawal 1
            const reserveDataAfterWithdrawal1: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await usdc.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get rando USDC data after  withdrawal 1
            const randoUserDataAfterWithdrawal1: UserReserveData =
              await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await usdc.getAddress(),
                rando.address
              );

            // Depositor 2 withdraws. Depositor 2 can't withdraw entire balance because first depositor already withdrew her entire balance.
            await lendingPool
              .connect(rando)
              .withdraw(
                await usdc.getAddress(),
                rando.address,
                reserveDataAfterWithdrawal1.availableLiquidity,
                rando.address
              );

            // Get USDC reserve data after withdrawal 2
            const reserveDataAfterWithdrawal2: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await usdc.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Check token balances
            expect(await usdc.balanceOf(await mUSDC.getAddress())).to.equal(
              reserveDataAfterWithdrawal2.availableLiquidity // 0 after second withdrawal
            );
            expect(await usdc.balanceOf(depositor.address)).to.equal(
              depositorUserDataAfterBorrow.currentMTokenBalance
            );
            expect(await mUSDC.balanceOf(depositor.address)).to.equal(0);

            //Second depositor could not withdraw whole balance because first depositor already withdrew her entire balance
            expect(await usdc.balanceOf(rando.address)).to.equal(
              reserveDataAfterWithdrawal1.availableLiquidity
            );
            expect(await mUSDC.balanceOf(rando.address)).to.be.closeTo(
              randoUserDataAfterWithdrawal1.currentMTokenBalance -
                reserveDataAfterWithdrawal1.availableLiquidity,
              1
            );
          });
        }
      ); // End Multiple withdrawals of same asset by different withdrawers Context

      context(
        "Multiple withdrawals of different assets by same withdrawer",
        async function () {
          it("Should emit correct events ", async function () {
            // Load the test fixture
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              expectedReserveTokenAddresses,
              depositAmountUSDC,
              usdc,
              meld,
              owner,
              depositor,
            } = await loadFixture(depositForSingleDepositorFixture);

            // Withdraw all USDC from the lending pool
            const firstWithdrawTx = await lendingPool
              .connect(depositor)
              .withdraw(
                await usdc.getAddress(),
                depositor.address,
                MaxUint256,
                depositor.address
              );

            // Get reserve data before withdrawing MELD
            const reserveDataBeforeWithdrawal: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get user reserve data before withdrawing MELD
            const userDataBeforeWithdrawal: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              depositor.address
            );

            // Withdraw MELD from the lending pool
            const amountToWithdrawMELD = await convertToCurrencyDecimals(
              await meld.getAddress(),
              "15000"
            );
            const secondWithdrawTx = await lendingPool
              .connect(depositor)
              .withdraw(
                await meld.getAddress(),
                depositor.address,
                amountToWithdrawMELD,
                depositor.address
              );

            // Hardhat time module. Gets timestamp of latest block.
            const blockTimestamp = await time.latest();

            // Calculate expected reserve data after withdrawing MELD
            const expectedReserveDataAfterWithdrawal =
              calcExpectedReserveDataAfterWithdraw(
                amountToWithdrawMELD,
                reserveDataBeforeWithdrawal,
                userDataBeforeWithdrawal,
                BigInt(blockTimestamp)
              );

            // Instantiate mUSDC contract
            const mUSDC = await ethers.getContractAt(
              "MToken",
              expectedReserveTokenAddresses.get("USDC").Mtoken
            );

            // Instantiate mMELD contract
            const mMELD = await ethers.getContractAt(
              "MToken",
              expectedReserveTokenAddresses.get("MELD").Mtoken
            );

            // The Withdraw event is emitted by the WithdrawLogic.sol library, so we need to get the contract instance with the WithdrawLogic ABI
            const contractInstanceWithWithdrawLibraryABI =
              await ethers.getContractAt(
                "WithdrawLogic",
                await lendingPool.getAddress(),
                owner
              );

            // Check that the events were emitted correctly for the first withdrawal
            await expect(firstWithdrawTx)
              .emit(contractInstanceWithWithdrawLibraryABI, "Withdraw")
              .withArgs(
                await usdc.getAddress(),
                depositor.address,
                depositor.address,
                depositor.address,
                depositAmountUSDC
              );

            await expect(firstWithdrawTx)
              .emit(lendingPool, "ReserveUsedAsCollateralDisabled")
              .withArgs(await usdc.getAddress(), depositor.address);

            await expect(firstWithdrawTx)
              .to.emit(mUSDC, "Transfer")
              .withArgs(
                depositor.address,
                ethers.ZeroAddress,
                depositAmountUSDC
              );

            await expect(firstWithdrawTx)
              .to.emit(mUSDC, "Burn")
              .withArgs(
                depositor.address,
                depositor.address,
                depositAmountUSDC,
                expectedReserveDataAfterWithdrawal.liquidityIndex
              );
            await expect(firstWithdrawTx).to.not.emit(mUSDC, "Mint");

            // Check that the events were emitted correctly for the second withdrawal
            await expect(secondWithdrawTx)
              .emit(contractInstanceWithWithdrawLibraryABI, "Withdraw")
              .withArgs(
                await meld.getAddress(),
                depositor.address,
                depositor.address,
                depositor.address,
                amountToWithdrawMELD
              );

            await expect(secondWithdrawTx).to.not.emit(
              lendingPool,
              "ReserveUsedAsCollateralDisabled"
            );

            // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
            const contractInstanceWithLibraryABI = await ethers.getContractAt(
              "ReserveLogic",
              await lendingPool.getAddress(),
              owner
            );

            await expect(secondWithdrawTx)
              .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
              .withArgs(
                await meld.getAddress(),
                expectedReserveDataAfterWithdrawal.liquidityRate,
                expectedReserveDataAfterWithdrawal.stableBorrowRate,
                expectedReserveDataAfterWithdrawal.variableBorrowRate,
                expectedReserveDataAfterWithdrawal.liquidityIndex,
                expectedReserveDataAfterWithdrawal.variableBorrowIndex
              );

            await expect(secondWithdrawTx)
              .to.emit(mMELD, "Transfer")
              .withArgs(
                depositor.address,
                ethers.ZeroAddress,
                amountToWithdrawMELD
              );

            await expect(secondWithdrawTx)
              .to.emit(mMELD, "Burn")
              .withArgs(
                depositor.address,
                depositor.address,
                amountToWithdrawMELD,
                expectedReserveDataAfterWithdrawal.liquidityIndex
              );
            await expect(secondWithdrawTx).to.not.emit(mMELD, "Mint");
          });
          it("Should update state correctly", async function () {
            // Load the test fixture
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              usdc,
              meld,
              depositor,
            } = await loadFixture(depositForSingleDepositorFixture);

            // Withdraw USDC from the lending pool
            const usdcAmountToWithdraw = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "2000"
            );
            await lendingPool
              .connect(depositor)
              .withdraw(
                await usdc.getAddress(),
                depositor.address,
                usdcAmountToWithdraw,
                depositor.address
              );

            // Get reserve data before withdrawing MELD
            const reserveDataBeforeWithdrawal2: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get user reserve data before withdrawing MELD
            const userDataBeforeWithdrawal2: UserReserveData =
              await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await meld.getAddress(),
                depositor.address
              );

            // Withdraw MELD from the lending pool
            const meldAmountToWithdraw = await convertToCurrencyDecimals(
              await meld.getAddress(),
              "10000"
            );
            await lendingPool
              .connect(depositor)
              .withdraw(
                await meld.getAddress(),
                depositor.address,
                meldAmountToWithdraw,
                depositor.address
              );

            // Hardhat time module. Gets timestamp of latest block.
            const blockTimestamp = await time.latest();

            // Calculate expected reserve data after withdrawing MELD
            const expectedReserveDataAfterWithdrawal2 =
              calcExpectedReserveDataAfterWithdraw(
                meldAmountToWithdraw,
                reserveDataBeforeWithdrawal2,
                userDataBeforeWithdrawal2,
                BigInt(blockTimestamp)
              );

            // Check that the reserve data and user data were updated correctly after both withdrawals
            const reserveDataAfterWithdrawal2: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            const expectedUserDataAfterWithdrawal2: UserReserveData =
              calcExpectedUserDataAfterWithdraw(
                meldAmountToWithdraw,
                reserveDataBeforeWithdrawal2,
                reserveDataAfterWithdrawal2,
                userDataBeforeWithdrawal2,
                BigInt(blockTimestamp)
              );

            const userDataAfterWithdrawal2: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              depositor.address
            );

            expectEqual(
              reserveDataAfterWithdrawal2,
              expectedReserveDataAfterWithdrawal2
            );
            expectEqual(
              userDataAfterWithdrawal2,
              expectedUserDataAfterWithdrawal2
            );
          });
          it("Should update token balances correctly when 'to' address is same as caller", async function () {
            // Load the test fixture
            const {
              lendingPool,
              expectedReserveTokenAddresses,
              usdc,
              meld,
              depositAmountUSDC,
              depositAmountMELD,
              depositor,
            } = await loadFixture(depositForSingleDepositorFixture);

            // Instantiate mUSDC contract
            const mUSDC = await ethers.getContractAt(
              "MToken",
              expectedReserveTokenAddresses.get("USDC").Mtoken
            );

            // Instantiate mMELD contract
            const mMELD = await ethers.getContractAt(
              "MToken",
              expectedReserveTokenAddresses.get("MELD").Mtoken
            );

            // Withdraw USDC from the lending pool
            const amountToWithdrawUSDC = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "2000"
            );

            await lendingPool
              .connect(depositor)
              .withdraw(
                await usdc.getAddress(),
                depositor.address,
                amountToWithdrawUSDC,
                depositor.address
              );

            // Withdraw MELD from the lending pool
            const amountToWithdrawMELD = await convertToCurrencyDecimals(
              await meld.getAddress(),
              "2000"
            );

            await lendingPool
              .connect(depositor)
              .withdraw(
                await meld.getAddress(),
                depositor.address,
                amountToWithdrawMELD,
                depositor.address
              );

            // Check token balances
            expect(await usdc.balanceOf(await mUSDC.getAddress())).to.equal(
              depositAmountUSDC - amountToWithdrawUSDC
            );
            expect(await usdc.balanceOf(depositor.address)).to.equal(
              amountToWithdrawUSDC
            );
            expect(await mUSDC.balanceOf(depositor.address)).to.equal(
              depositAmountUSDC - amountToWithdrawUSDC
            );
            expect(await meld.balanceOf(await mMELD.getAddress())).to.equal(
              depositAmountMELD - amountToWithdrawMELD
            );
            expect(await meld.balanceOf(depositor.address)).to.equal(
              amountToWithdrawMELD
            );
            expect(await mMELD.balanceOf(depositor.address)).to.equal(
              depositAmountMELD - amountToWithdrawMELD
            );
          });
          it("Should update token balances correctly when 'to' address is different caller", async function () {
            // Load the test fixture
            const {
              lendingPool,
              expectedReserveTokenAddresses,
              usdc,
              meld,
              depositAmountUSDC,
              depositAmountMELD,
              depositor,
              thirdParty,
            } = await loadFixture(depositForSingleDepositorFixture);

            // Instantiate mUSDC contract
            const mUSDC = await ethers.getContractAt(
              "MToken",
              expectedReserveTokenAddresses.get("USDC").Mtoken
            );

            // Instantiate mMELD contract
            const mMELD = await ethers.getContractAt(
              "MToken",
              expectedReserveTokenAddresses.get("MELD").Mtoken
            );

            // Withdraw USDC from the lending pool
            const amountToWithdrawUSDC = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "2000"
            );

            await lendingPool
              .connect(depositor)
              .withdraw(
                await usdc.getAddress(),
                depositor.address,
                amountToWithdrawUSDC,
                thirdParty.address
              );

            // Withdraw MELD from the lending pool
            const amountToWithdrawMELD = await convertToCurrencyDecimals(
              await meld.getAddress(),
              "2000"
            );

            await lendingPool
              .connect(depositor)
              .withdraw(
                await meld.getAddress(),
                depositor.address,
                amountToWithdrawMELD,
                thirdParty.address
              );

            // Check token balances
            expect(await usdc.balanceOf(await mUSDC.getAddress())).to.equal(
              depositAmountUSDC - amountToWithdrawUSDC
            );
            expect(await usdc.balanceOf(thirdParty.address)).to.equal(
              amountToWithdrawUSDC
            );
            expect(await usdc.balanceOf(depositor.address)).to.equal(0);
            expect(await mUSDC.balanceOf(thirdParty.address)).to.equal(0);
            expect(await mUSDC.balanceOf(depositor.address)).to.equal(
              depositAmountUSDC - amountToWithdrawUSDC
            );
            expect(await meld.balanceOf(await mMELD.getAddress())).to.equal(
              depositAmountMELD - amountToWithdrawMELD
            );
            expect(await meld.balanceOf(thirdParty.address)).to.equal(
              amountToWithdrawMELD
            );
            expect(await meld.balanceOf(depositor.address)).to.equal(0);
            expect(await mMELD.balanceOf(thirdParty.address)).to.equal(0);
            expect(await mMELD.balanceOf(depositor.address)).to.equal(
              depositAmountMELD - amountToWithdrawMELD
            );
          });
        }
      ); // End Multiple withdrawals of different assets by same withdrawer Context

      context(
        "Multiple withdrawals of different assets by different withdrawers",
        async function () {
          it("Should emit correct events ", async function () {
            // Load the test fixture
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              expectedReserveTokenAddresses,
              depositAmountUSDC,
              usdc,
              meld,
              owner,
              depositor,
              rando,
            } = await loadFixture(depositForMultipleDepositorsFixture);

            // Withdraw all USDC from the lending pool
            const firstWithdrawTx = await lendingPool
              .connect(depositor)
              .withdraw(
                await usdc.getAddress(),
                depositor.address,
                MaxUint256,
                depositor.address
              );

            // Get reserve data before withdrawing MELD
            const reserveDataBeforeWithdrawal: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get user reserve data before withdrawing MELD
            const userDataBeforeWithdrawal: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              rando.address
            );

            // Withdraw MELD from the lending pool
            const amountToWithdrawMELD = await convertToCurrencyDecimals(
              await meld.getAddress(),
              "5000"
            );
            const secondWithdrawTx = await lendingPool
              .connect(rando)
              .withdraw(
                await meld.getAddress(),
                rando.address,
                amountToWithdrawMELD,
                rando.address
              );

            // Hardhat time module. Gets timestamp of latest block.
            const blockTimestamp = await time.latest();

            // Calculate expected reserve data after withdrawing MELD
            const expectedReserveDataAfterWithdrawal =
              calcExpectedReserveDataAfterWithdraw(
                amountToWithdrawMELD,
                reserveDataBeforeWithdrawal,
                userDataBeforeWithdrawal,
                BigInt(blockTimestamp)
              );

            // Instantiate mUSDC contract
            const mUSDC = await ethers.getContractAt(
              "MToken",
              expectedReserveTokenAddresses.get("USDC").Mtoken
            );

            // Instantiate mMELD contract
            const mMELD = await ethers.getContractAt(
              "MToken",
              expectedReserveTokenAddresses.get("MELD").Mtoken
            );

            // The Withdraw event is emitted by the WithdrawLogic.sol library, so we need to get the contract instance with the WithdrawLogic ABI
            const contractInstanceWithWithdrawLibraryABI =
              await ethers.getContractAt(
                "WithdrawLogic",
                await lendingPool.getAddress(),
                owner
              );

            // Check that the events were emitted correctly for the first withdrawal
            await expect(firstWithdrawTx)
              .emit(contractInstanceWithWithdrawLibraryABI, "Withdraw")
              .withArgs(
                await usdc.getAddress(),
                depositor.address,
                depositor.address,
                depositor.address,
                depositAmountUSDC
              );

            await expect(firstWithdrawTx)
              .emit(lendingPool, "ReserveUsedAsCollateralDisabled")
              .withArgs(await usdc.getAddress(), depositor.address);

            await expect(firstWithdrawTx)
              .to.emit(mUSDC, "Transfer")
              .withArgs(
                depositor.address,
                ethers.ZeroAddress,
                depositAmountUSDC
              );

            await expect(firstWithdrawTx)
              .to.emit(mUSDC, "Burn")
              .withArgs(
                depositor.address,
                depositor.address,
                depositAmountUSDC,
                expectedReserveDataAfterWithdrawal.liquidityIndex
              );
            await expect(firstWithdrawTx).to.not.emit(mUSDC, "Mint");

            // Check that the events were emitted correctly for the second withdrawal
            await expect(secondWithdrawTx)
              .emit(contractInstanceWithWithdrawLibraryABI, "Withdraw")
              .withArgs(
                await meld.getAddress(),
                rando.address,
                rando.address,
                rando.address,
                amountToWithdrawMELD
              );

            await expect(secondWithdrawTx).to.not.emit(
              lendingPool,
              "ReserveUsedAsCollateralDisabled"
            );

            // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
            const contractInstanceWithLibraryABI = await ethers.getContractAt(
              "ReserveLogic",
              await lendingPool.getAddress(),
              owner
            );

            await expect(secondWithdrawTx)
              .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
              .withArgs(
                await meld.getAddress(),
                expectedReserveDataAfterWithdrawal.liquidityRate,
                expectedReserveDataAfterWithdrawal.stableBorrowRate,
                expectedReserveDataAfterWithdrawal.variableBorrowRate,
                expectedReserveDataAfterWithdrawal.liquidityIndex,
                expectedReserveDataAfterWithdrawal.variableBorrowIndex
              );

            await expect(secondWithdrawTx)
              .to.emit(mMELD, "Transfer")
              .withArgs(
                rando.address,
                ethers.ZeroAddress,
                amountToWithdrawMELD
              );

            await expect(secondWithdrawTx)
              .to.emit(mMELD, "Burn")
              .withArgs(
                rando.address,
                rando.address,
                amountToWithdrawMELD,
                expectedReserveDataAfterWithdrawal.liquidityIndex
              );
            await expect(secondWithdrawTx).to.not.emit(mMELD, "Mint");
          });

          it("Should update state correctly", async function () {
            // Load the test fixture
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              usdc,
              meld,
              depositor,
              rando,
            } = await loadFixture(depositForMultipleDepositorsFixture);

            const amountToWithdraw = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "2000"
            );

            const amountToWithdraw2 = await convertToCurrencyDecimals(
              await meld.getAddress(),
              "1000"
            );

            await lendingPool
              .connect(depositor)
              .withdraw(
                await usdc.getAddress(),
                depositor.address,
                amountToWithdraw,
                depositor.address
              );

            // Get reserve data before party 2 withdraws MELD
            const reserveDataBeforeWithdrawal2: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get user reserve data before party 2 withdraws
            const userDataBeforeWithdrawal2: UserReserveData =
              await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await meld.getAddress(),
                rando.address
              );

            await lendingPool
              .connect(rando)
              .withdraw(
                await meld.getAddress(),
                rando.address,
                amountToWithdraw2,
                rando.address
              );

            // Hardhat time module. Gets timestamp of latest block.
            const blockTimestamp = await time.latest();

            // Calculate expected reserve data after withdrawal
            const expectedReserveDataAfterWithdrawal2 =
              calcExpectedReserveDataAfterWithdraw(
                amountToWithdraw2,
                reserveDataBeforeWithdrawal2,
                userDataBeforeWithdrawal2,
                BigInt(blockTimestamp)
              );

            // Get reserve data after withdrawal
            const reserveDataAfterWithdrawal2: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Calculate expected user data after withdrawal
            const expectedUserDataAfterWithdrawal2: UserReserveData =
              calcExpectedUserDataAfterWithdraw(
                amountToWithdraw2,
                reserveDataBeforeWithdrawal2,
                reserveDataAfterWithdrawal2,
                userDataBeforeWithdrawal2,
                BigInt(blockTimestamp)
              );

            // Get user data after withdrawal
            const userDataAfterWithdrawal2: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              rando.address
            );

            // Check that the reserve data and user data were updated correctly after second withdrawal
            expectEqual(
              reserveDataAfterWithdrawal2,
              expectedReserveDataAfterWithdrawal2
            );

            expectEqual(
              userDataAfterWithdrawal2,
              expectedUserDataAfterWithdrawal2
            );
          });

          it("Should return the correct amount withdrawn", async function () {
            // Load the test fixture
            const { lendingPool, usdc, meld, depositor, rando } =
              await loadFixture(depositForMultipleDepositorsFixture);

            const amountToWithdraw = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "3000"
            );

            const amountToWithdraw2 = await convertToCurrencyDecimals(
              await meld.getAddress(),
              "4000"
            );

            // Check two withdraws after each other
            await lendingPool
              .connect(depositor)
              .withdraw(
                await usdc.getAddress(),
                depositor.address,
                amountToWithdraw,
                depositor.address
              );

            const amountWithdrawn = await lendingPool
              .connect(rando)
              .withdraw.staticCall(
                await meld.getAddress(),
                rando.address,
                amountToWithdraw2,
                rando.address
              );

            // Check that the return value is correct after rest is withdrawn
            expect(amountWithdrawn).to.equal(amountToWithdraw2);
          });
          it("Should update token balances correctly when 'to' address is same as caller", async function () {
            // Load the test fixture
            const {
              lendingPool,
              expectedReserveTokenAddresses,
              usdc,
              meld,
              depositAmountUSDC,
              depositAmountMELD,
              depositAmountMELD2,
              depositAmountUSDC2,
              depositor,
              rando,
            } = await loadFixture(depositForMultipleDepositorsFixture);

            // Instantiate mUSDC contract
            const mUSDC = await ethers.getContractAt(
              "MToken",
              expectedReserveTokenAddresses.get("USDC").Mtoken
            );

            const mMELD = await ethers.getContractAt(
              "MToken",
              expectedReserveTokenAddresses.get("MELD").Mtoken
            );

            const amountToWithdrawUSDC = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "2000"
            );

            const amountToWithdrawMELD = await convertToCurrencyDecimals(
              await meld.getAddress(),
              "9000"
            );

            await lendingPool
              .connect(depositor)
              .withdraw(
                await usdc.getAddress(),
                depositor.address,
                amountToWithdrawUSDC,
                depositor.address
              );

            // Party 2 withdraws
            await lendingPool
              .connect(rando)
              .withdraw(
                await meld.getAddress(),
                rando.address,
                amountToWithdrawMELD,
                rando.address
              );

            const expectedAmountRemainingUSDC =
              depositAmountUSDC + depositAmountUSDC2 - amountToWithdrawUSDC;
            const expectedAmountRemainingMELD =
              depositAmountMELD + depositAmountMELD2 - amountToWithdrawMELD;

            // Check token balances
            expect(await usdc.balanceOf(await mUSDC.getAddress())).to.equal(
              expectedAmountRemainingUSDC
            );
            expect(await usdc.balanceOf(depositor.address)).to.equal(
              amountToWithdrawUSDC
            );
            expect(await mUSDC.balanceOf(depositor.address)).to.equal(
              depositAmountUSDC - amountToWithdrawUSDC
            );
            expect(await meld.balanceOf(await mMELD.getAddress())).to.equal(
              expectedAmountRemainingMELD
            );
            expect(await meld.balanceOf(rando.address)).to.equal(
              amountToWithdrawMELD
            );
            expect(await mMELD.balanceOf(rando.address)).to.equal(
              depositAmountMELD2 - amountToWithdrawMELD
            );
          });

          it("Should update token balances correctly when 'to' address is different from caller", async function () {
            // Load the test fixture
            const {
              lendingPool,
              expectedReserveTokenAddresses,
              usdc,
              meld,
              depositAmountUSDC,
              depositAmountMELD,
              depositAmountMELD2,
              depositAmountUSDC2,
              depositor,
              rando,
              thirdParty,
            } = await loadFixture(depositForMultipleDepositorsFixture);

            // Instantiate mUSDC contract
            const mUSDC = await ethers.getContractAt(
              "MToken",
              expectedReserveTokenAddresses.get("USDC").Mtoken
            );

            const mMELD = await ethers.getContractAt(
              "MToken",
              expectedReserveTokenAddresses.get("MELD").Mtoken
            );

            const amountToWithdrawUSDC = await convertToCurrencyDecimals(
              await usdc.getAddress(),
              "2000"
            );

            const amountToWithdrawMELD = await convertToCurrencyDecimals(
              await meld.getAddress(),
              "3500"
            );

            await lendingPool
              .connect(depositor)
              .withdraw(
                await usdc.getAddress(),
                depositor.address,
                amountToWithdrawUSDC,
                thirdParty.address
              );

            // Party 2 withdraws
            await lendingPool
              .connect(rando)
              .withdraw(
                await meld.getAddress(),
                rando.address,
                amountToWithdrawMELD,
                thirdParty.address
              );

            const expectedAmountRemainingUSDC =
              depositAmountUSDC + depositAmountUSDC2 - amountToWithdrawUSDC;
            const expectedAmountRemainingMELD =
              depositAmountMELD + depositAmountMELD2 - amountToWithdrawMELD;

            // Check token balances
            expect(await usdc.balanceOf(await mUSDC.getAddress())).to.equal(
              expectedAmountRemainingUSDC
            );
            expect(await usdc.balanceOf(depositor.address)).to.equal(0);
            expect(await mUSDC.balanceOf(depositor.address)).to.equal(
              depositAmountUSDC - amountToWithdrawUSDC
            );
            expect(await mUSDC.balanceOf(thirdParty.address)).to.equal(0);
            expect(await usdc.balanceOf(thirdParty.address)).to.equal(
              amountToWithdrawUSDC
            );

            expect(await meld.balanceOf(await mMELD.getAddress())).to.equal(
              expectedAmountRemainingMELD
            );
            expect(await meld.balanceOf(rando.address)).to.equal(0);
            expect(await mMELD.balanceOf(rando.address)).to.equal(
              depositAmountMELD2 - amountToWithdrawMELD
            );
            expect(await meld.balanceOf(thirdParty.address)).to.equal(
              amountToWithdrawMELD
            );
            expect(await mMELD.balanceOf(thirdParty.address)).to.equal(0);
          });
        }
      ); // End "Multiple withdrawals of different assets by different withdrawers Context

      context("Withdrawal from genius loan", async function () {
        it("Should allow for someone with the GENIUS_LOAN_ROLE role to withdraw on behalf of a user that has opted in", async function () {
          const {
            lendingPool,
            addressesProvider,
            usdc,
            owner,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            expectedReserveTokenAddresses,
            rando,
            depositor,
          } = await loadFixture(depositForSingleDepositorFixture);

          // Give rando the GENIUS_LOAN_ROLE role
          await addressesProvider
            .connect(owner)
            .grantRole(
              await addressesProvider.GENIUS_LOAN_ROLE(),
              rando.address
            );

          // Get reserve data before withdrawal
          const reserveDataBeforeWithdrawal: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before withdrawal
          const userDataBeforeWithdrawal: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await usdc.getAddress(),
            depositor.address
          );

          // Instantiate mUSDC contract
          const mUSDC = await ethers.getContractAt(
            "MToken",
            expectedReserveTokenAddresses.get("USDC").Mtoken
          );

          // Depositor opts in to the genius loan
          await lendingPool.connect(depositor).setUserAcceptGeniusLoan(true);

          // Withdraw USDC from the lending pool
          const amountToWithdraw = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "2000"
          );

          // Genius Loan Role holder calls withdraw on behalf of depositor
          const withdrawTx = await lendingPool
            .connect(rando)
            .withdraw(
              await usdc.getAddress(),
              depositor.address,
              amountToWithdraw,
              rando.address
            );

          // The Withdraw event is emitted by the WithdrawLogic.sol library, so we need to get the contract instance with the WithdrawLogic ABI
          const contractInstanceWithWithdrawLibraryABI =
            await ethers.getContractAt(
              "WithdrawLogic",
              await lendingPool.getAddress(),
              owner
            );

          // Check that the events were emitted correctly for the withdrawal
          await expect(withdrawTx)
            .emit(contractInstanceWithWithdrawLibraryABI, "Withdraw")
            .withArgs(
              await usdc.getAddress(),
              depositor.address,
              rando.address,
              rando.address,
              amountToWithdraw
            );

          // Hardhat time module. Gets timestamp of latest block.
          const blockTimestamp = await time.latest();

          // Calculate expected reserve data after withdrawal
          const expectedReserveDataAfterWithdrawal =
            calcExpectedReserveDataAfterWithdraw(
              amountToWithdraw,
              reserveDataBeforeWithdrawal,
              userDataBeforeWithdrawal,
              BigInt(blockTimestamp)
            );

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          await expect(withdrawTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await usdc.getAddress(),
              expectedReserveDataAfterWithdrawal.liquidityRate,
              expectedReserveDataAfterWithdrawal.stableBorrowRate,
              expectedReserveDataAfterWithdrawal.variableBorrowRate,
              expectedReserveDataAfterWithdrawal.liquidityIndex,
              expectedReserveDataAfterWithdrawal.variableBorrowIndex
            );

          await expect(withdrawTx)
            .to.emit(mUSDC, "Transfer")
            .withArgs(depositor.address, ethers.ZeroAddress, amountToWithdraw);

          await expect(withdrawTx)
            .to.emit(mUSDC, "Burn")
            .withArgs(
              depositor.address,
              rando.address,
              amountToWithdraw,
              expectedReserveDataAfterWithdrawal.liquidityIndex
            );

          await expect(withdrawTx).to.not.emit(mUSDC, "Mint");
        });
      }); // End Withdrawal from genius loan Context
    }); // End Regular User Context

    context("MELD Banker", async function () {
      context("Single Withdrawal", async function () {
        it("Should unlock MELD Banker NFT if MELD Banker withdraws whole balance of yield boost token", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            expectedReserveTokenAddresses,
            addressesProvider,
            meld,
            usdc,
            depositAmountUSDC,
            owner,
            meldBanker,
            meldBankerTokenId,
            rewardsSetter,
            yieldBoostStorageUSDC,
            yieldBoostStakingUSDC,
          } = await loadFixture(depositForSingleMeldBankerFixture);

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

          // Get reserve data before withdrawal
          const reserveDataBeforeWithdrawal: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before withdrawal
          const userDataBeforeWithdrawal: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await usdc.getAddress(),
            meldBanker.address
          );

          // Instantiate mUSDC contract
          const mUSDC = await ethers.getContractAt(
            "MToken",
            expectedReserveTokenAddresses.get("USDC").Mtoken
          );

          const meldBankerDataBefore = await lendingPool.userMeldBankerData(
            meldBanker.address
          );

          const yieldBoostMultiplier = await lendingPool.yieldBoostMultipliers(
            meldBankerDataBefore.meldBankerType,
            meldBankerDataBefore.action
          );

          // Passing in MaxUint256 to withdraw the full user balance of the asset
          const withdrawTx = await lendingPool
            .connect(meldBanker)
            .withdraw(
              await usdc.getAddress(),
              meldBanker.address,
              MaxUint256,
              meldBanker.address
            );

          // Hardhat time module. Gets timestamp of latest block.
          const blockTimestamp = await time.latest();

          // Calculate expected reserve data after withdrawal
          const expectedReserveDataAfterWithdrawal =
            calcExpectedReserveDataAfterWithdraw(
              MaxUint256,
              reserveDataBeforeWithdrawal,
              userDataBeforeWithdrawal,
              BigInt(blockTimestamp)
            );

          // The Withdraw event is emitted by the WithdrawLogic.sol library, so we need to get the contract instance with the WithdrawLogic ABI
          const contractInstanceWithWithdrawLibraryABI =
            await ethers.getContractAt(
              "WithdrawLogic",
              await lendingPool.getAddress(),
              owner
            );

          await expect(withdrawTx)
            .emit(contractInstanceWithWithdrawLibraryABI, "Withdraw")
            .withArgs(
              await usdc.getAddress(),
              meldBanker.address,
              meldBanker.address,
              meldBanker.address,
              depositAmountUSDC
            );

          await expect(withdrawTx)
            .emit(lendingPool, "ReserveUsedAsCollateralDisabled")
            .withArgs(await usdc.getAddress(), meldBanker.address);

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          await expect(withdrawTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await usdc.getAddress(),
              expectedReserveDataAfterWithdrawal.liquidityRate,
              expectedReserveDataAfterWithdrawal.stableBorrowRate,
              expectedReserveDataAfterWithdrawal.variableBorrowRate,
              expectedReserveDataAfterWithdrawal.liquidityIndex,
              expectedReserveDataAfterWithdrawal.variableBorrowIndex
            );

          await expect(withdrawTx)
            .to.emit(mUSDC, "Transfer")
            .withArgs(
              meldBanker.address,
              ethers.ZeroAddress,
              depositAmountUSDC
            );

          await expect(withdrawTx)
            .to.emit(mUSDC, "Burn")
            .withArgs(
              meldBanker.address,
              meldBanker.address,
              depositAmountUSDC,
              expectedReserveDataAfterWithdrawal.liquidityIndex
            );
          await expect(withdrawTx).to.not.emit(mUSDC, "Mint");

          const expectedOldStakedAmount =
            depositAmountUSDC.percentMul(yieldBoostMultiplier);

          await expect(withdrawTx)
            .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
            .withArgs(meldBanker.address, expectedOldStakedAmount, 0n);

          await expect(withdrawTx)
            .to.emit(yieldBoostStakingUSDC, "StakePositionRemoved")
            .withArgs(meldBanker.address, expectedOldStakedAmount);

          await expect(withdrawTx)
            .to.emit(yieldBoostStakingUSDC, "RewardsClaimed")
            .withArgs(meldBanker.address, meldBanker.address, anyUint, anyUint);

          await expect(withdrawTx)
            .to.emit(lendingPool, "RefreshYieldBoostAmount")
            .withArgs(await usdc.getAddress(), meldBanker.address, 0n);

          await expect(withdrawTx)
            .to.emit(lendingPool, "UnlockMeldBankerNFT")
            .withArgs(
              await usdc.getAddress(),
              meldBanker.address,
              meldBankerTokenId,
              MeldBankerType.BANKER,
              Action.DEPOSIT
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
            await yieldBoostStorageUSDC.getStakerStakedAmount(
              meldBanker.address
            )
          ).to.equal(0n);
        });
        it("Should NOT unlock MELD Banker NFT if MELD Banker withdraws whole balance of a different yield boost token", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            expectedReserveTokenAddresses,
            addressesProvider,
            meld,
            usdc,
            dai,
            owner,
            depositAmountUSDC,
            meldBanker,
            meldBankerTokenId,
            rewardsSetter,
            yieldBoostStorageUSDC,
            yieldBoostStakingUSDC,
          } = await loadFixture(depositForSingleMeldBankerFixture);
          // MELD Banker already deposited USDC using tokenId. DAI is also a yield boost token. MELD banker is not using tokenId

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

          // Deposit DAI
          const depositAmountDAI = await allocateAndApproveTokens(
            dai,
            owner,
            meldBanker,
            lendingPool,
            1000n,
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

          // Get reserve data before withdrawal
          const reserveDataBeforeWithdrawal: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await dai.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before withdrawal
          const userDataBeforeWithdrawal: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await dai.getAddress(),
            meldBanker.address
          );

          // Instantiate mDAI contract
          const mDAI = await ethers.getContractAt(
            "MToken",
            expectedReserveTokenAddresses.get("DAI").Mtoken
          );

          // Passing in MaxUint256 to withdraw the full user balance of dai
          const withdrawTx = await lendingPool
            .connect(meldBanker)
            .withdraw(
              await dai.getAddress(),
              meldBanker.address,
              MaxUint256,
              meldBanker.address
            );

          // Hardhat time module. Gets timestamp of latest block.
          const blockTimestamp = await time.latest();

          // Calculate expected reserve data after withdrawal
          const expectedReserveDataAfterWithdrawal =
            calcExpectedReserveDataAfterWithdraw(
              MaxUint256,
              reserveDataBeforeWithdrawal,
              userDataBeforeWithdrawal,
              BigInt(blockTimestamp)
            );

          // The Withdraw event is emitted by the WithdrawLogic.sol library, so we need to get the contract instance with the WithdrawLogic ABI
          const contractInstanceWithWithdrawLibraryABI =
            await ethers.getContractAt(
              "WithdrawLogic",
              await lendingPool.getAddress(),
              owner
            );

          await expect(withdrawTx)
            .emit(contractInstanceWithWithdrawLibraryABI, "Withdraw")
            .withArgs(
              await dai.getAddress(),
              meldBanker.address,
              meldBanker.address,
              meldBanker.address,
              depositAmountDAI
            );

          await expect(withdrawTx)
            .emit(lendingPool, "ReserveUsedAsCollateralDisabled")
            .withArgs(await dai.getAddress(), meldBanker.address);

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          await expect(withdrawTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await dai.getAddress(),
              expectedReserveDataAfterWithdrawal.liquidityRate,
              expectedReserveDataAfterWithdrawal.stableBorrowRate,
              expectedReserveDataAfterWithdrawal.variableBorrowRate,
              expectedReserveDataAfterWithdrawal.liquidityIndex,
              expectedReserveDataAfterWithdrawal.variableBorrowIndex
            );

          await expect(withdrawTx)
            .to.emit(mDAI, "Transfer")
            .withArgs(meldBanker.address, ethers.ZeroAddress, depositAmountDAI);

          await expect(withdrawTx)
            .to.emit(mDAI, "Burn")
            .withArgs(
              meldBanker.address,
              meldBanker.address,
              depositAmountDAI,
              expectedReserveDataAfterWithdrawal.liquidityIndex
            );
          await expect(withdrawTx).to.not.emit(mDAI, "Mint");

          const meldBankerData = await lendingPool.userMeldBankerData(
            meldBanker.address
          );

          await expect(withdrawTx).to.not.emit(
            yieldBoostStakingUSDC,
            "StakePositionUpdated"
          );

          await expect(withdrawTx).to.not.emit(
            yieldBoostStakingUSDC,
            "StakePositionRemoved"
          );

          await expect(withdrawTx).to.not.emit(
            yieldBoostStakingUSDC,
            "RewardsClaimed"
          );

          await expect(withdrawTx)
            .to.emit(lendingPool, "RefreshYieldBoostAmount")
            .withArgs(await dai.getAddress(), meldBanker.address, 0n);

          await expect(withdrawTx).to.not.emit(
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
          expect(meldBankerData.action).to.equal(Action.DEPOSIT);

          const yieldBoostMultiplier = await lendingPool.yieldBoostMultipliers(
            meldBankerData.meldBankerType,
            meldBankerData.action
          );
          const expectedStakedAmount =
            depositAmountUSDC.percentMul(yieldBoostMultiplier);

          expect(
            await yieldBoostStorageUSDC.getStakerStakedAmount(
              meldBanker.address
            )
          ).to.equal(expectedStakedAmount);
        });
        it("Should NOT unlock MELD Banker NFT if MELD Banker withdraws partial balance of yield boost token", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            expectedReserveTokenAddresses,
            addressesProvider,
            meld,
            usdc,
            owner,
            depositAmountUSDC,
            meldBanker,
            meldBankerTokenId,
            rewardsSetter,
            yieldBoostStorageUSDC,
            yieldBoostStakingUSDC,
          } = await loadFixture(depositForSingleMeldBankerFixture);

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

          // Withdraw USDC from the lending pool
          const amountToWithdraw = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "2000" // partial
          );

          // Get reserve data before withdrawal
          const reserveDataBeforeWithdrawal: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before withdrawal
          const userDataBeforeWithdrawal: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await usdc.getAddress(),
            meldBanker.address
          );

          // Instantiate mUSDC contract
          const mUSDC = await ethers.getContractAt(
            "MToken",
            expectedReserveTokenAddresses.get("USDC").Mtoken
          );

          const withdrawTx = await lendingPool
            .connect(meldBanker)
            .withdraw(
              await usdc.getAddress(),
              meldBanker.address,
              amountToWithdraw,
              meldBanker.address
            );

          // Hardhat time module. Gets timestamp of latest block.
          const blockTimestamp = await time.latest();

          // Calculate expected reserve data after withdrawal
          const expectedReserveDataAfterWithdrawal =
            calcExpectedReserveDataAfterWithdraw(
              MaxUint256,
              reserveDataBeforeWithdrawal,
              userDataBeforeWithdrawal,
              BigInt(blockTimestamp)
            );

          // The Withdraw event is emitted by the WithdrawLogic.sol library, so we need to get the contract instance with the WithdrawLogic ABI
          const contractInstanceWithWithdrawLibraryABI =
            await ethers.getContractAt(
              "WithdrawLogic",
              await lendingPool.getAddress(),
              owner
            );

          await expect(withdrawTx)
            .emit(contractInstanceWithWithdrawLibraryABI, "Withdraw")
            .withArgs(
              await usdc.getAddress(),
              meldBanker.address,
              meldBanker.address,
              meldBanker.address,
              amountToWithdraw
            );

          await expect(withdrawTx).to.not.emit(
            lendingPool,
            "ReserveUsedAsCollateralDisabled"
          );

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          await expect(withdrawTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await usdc.getAddress(),
              expectedReserveDataAfterWithdrawal.liquidityRate,
              expectedReserveDataAfterWithdrawal.stableBorrowRate,
              expectedReserveDataAfterWithdrawal.variableBorrowRate,
              expectedReserveDataAfterWithdrawal.liquidityIndex,
              expectedReserveDataAfterWithdrawal.variableBorrowIndex
            );

          await expect(withdrawTx)
            .to.emit(mUSDC, "Transfer")
            .withArgs(meldBanker.address, ethers.ZeroAddress, amountToWithdraw);

          await expect(withdrawTx)
            .to.emit(mUSDC, "Burn")
            .withArgs(
              meldBanker.address,
              meldBanker.address,
              amountToWithdraw,
              expectedReserveDataAfterWithdrawal.liquidityIndex
            );
          await expect(withdrawTx).to.not.emit(mUSDC, "Mint");

          const meldBankerData = await lendingPool.userMeldBankerData(
            meldBanker.address
          );

          const yieldBoostMultiplier = await lendingPool.yieldBoostMultipliers(
            meldBankerData.meldBankerType,
            meldBankerData.action
          );

          const expectedOldStakedAmount =
            depositAmountUSDC.percentMul(yieldBoostMultiplier);

          const expectedNewStakedAmount = (
            depositAmountUSDC - amountToWithdraw
          ).percentMul(yieldBoostMultiplier);

          await expect(withdrawTx)
            .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
            .withArgs(
              meldBanker.address,
              expectedOldStakedAmount,
              expectedNewStakedAmount
            );

          await expect(withdrawTx).to.not.emit(
            yieldBoostStakingUSDC,
            "StakePositionRemoved"
          );

          await expect(withdrawTx).to.not.emit(
            yieldBoostStakingUSDC,
            "RewardsClaimed"
          );

          await expect(withdrawTx)
            .to.emit(lendingPool, "RefreshYieldBoostAmount")
            .withArgs(
              await usdc.getAddress(),
              meldBanker.address,
              expectedNewStakedAmount
            );

          await expect(withdrawTx).to.not.emit(
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
          expect(meldBankerData.action).to.equal(Action.DEPOSIT);

          expect(
            await yieldBoostStorageUSDC.getStakerStakedAmount(
              meldBanker.address
            )
          ).to.equal(expectedNewStakedAmount);
        });
      }); // End Single Withdrawal Context
      context("Withdrawal from genius loan", async function () {
        it("Should allow for someone with the GENIUS_LOAN_ROLE role to withdraw on behalf of a MELD banker that has opted in", async function () {
          const {
            lendingPool,
            addressesProvider,
            meld,
            usdc,
            owner,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            expectedReserveTokenAddresses,
            rando,
            meldBanker,
            rewardsSetter,
            meldBankerTokenId,
            depositAmountUSDC,
            yieldBoostStorageUSDC,
            yieldBoostStakingUSDC,
          } = await loadFixture(depositForSingleMeldBankerFixture);

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

          // Give rando the GENIUS_LOAN_ROLE role
          await addressesProvider
            .connect(owner)
            .grantRole(
              await addressesProvider.GENIUS_LOAN_ROLE(),
              rando.address
            );

          // Get reserve data before withdrawal
          const reserveDataBeforeWithdrawal: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before withdrawal
          const userDataBeforeWithdrawal: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await usdc.getAddress(),
            meldBanker.address
          );

          // Instantiate mUSDC contract
          const mUSDC = await ethers.getContractAt(
            "MToken",
            expectedReserveTokenAddresses.get("USDC").Mtoken
          );

          const meldBankerDataBefore = await lendingPool.userMeldBankerData(
            meldBanker.address
          );

          const yieldBoostMultiplier = await lendingPool.yieldBoostMultipliers(
            meldBankerDataBefore.meldBankerType,
            meldBankerDataBefore.action
          );

          // MELD Banker opts in to the genius loan
          await lendingPool.connect(meldBanker).setUserAcceptGeniusLoan(true);

          // Genius Loan Role holder calls withdraw on behalf of MELD Banker
          const withdrawTx = await lendingPool
            .connect(rando)
            .withdraw(
              await usdc.getAddress(),
              meldBanker.address,
              MaxUint256,
              rando.address
            );

          // The Withdraw event is emitted by the WithdrawLogic.sol library, so we need to get the contract instance with the WithdrawLogic ABI
          const contractInstanceWithWithdrawLibraryABI =
            await ethers.getContractAt(
              "WithdrawLogic",
              await lendingPool.getAddress(),
              owner
            );

          // Check that the events were emitted correctly for the withdrawal
          await expect(withdrawTx)
            .emit(contractInstanceWithWithdrawLibraryABI, "Withdraw")
            .withArgs(
              await usdc.getAddress(),
              meldBanker.address,
              rando.address,
              rando.address,
              depositAmountUSDC
            );

          // Hardhat time module. Gets timestamp of latest block.
          const blockTimestamp = await time.latest();

          // Calculate expected reserve data after withdrawal
          const expectedReserveDataAfterWithdrawal =
            calcExpectedReserveDataAfterWithdraw(
              MaxUint256,
              reserveDataBeforeWithdrawal,
              userDataBeforeWithdrawal,
              BigInt(blockTimestamp)
            );

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          await expect(withdrawTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await usdc.getAddress(),
              expectedReserveDataAfterWithdrawal.liquidityRate,
              expectedReserveDataAfterWithdrawal.stableBorrowRate,
              expectedReserveDataAfterWithdrawal.variableBorrowRate,
              expectedReserveDataAfterWithdrawal.liquidityIndex,
              expectedReserveDataAfterWithdrawal.variableBorrowIndex
            );

          await expect(withdrawTx)
            .to.emit(mUSDC, "Transfer")
            .withArgs(
              meldBanker.address,
              ethers.ZeroAddress,
              depositAmountUSDC
            );

          await expect(withdrawTx)
            .to.emit(mUSDC, "Burn")
            .withArgs(
              meldBanker.address,
              rando.address,
              depositAmountUSDC,
              expectedReserveDataAfterWithdrawal.liquidityIndex
            );

          await expect(withdrawTx).to.not.emit(mUSDC, "Mint");

          const expectedOldStakedAmount =
            depositAmountUSDC.percentMul(yieldBoostMultiplier);

          await expect(withdrawTx)
            .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
            .withArgs(meldBanker.address, expectedOldStakedAmount, 0n);

          await expect(withdrawTx)
            .to.emit(yieldBoostStakingUSDC, "StakePositionRemoved")
            .withArgs(meldBanker.address, expectedOldStakedAmount);

          await expect(withdrawTx)
            .to.emit(yieldBoostStakingUSDC, "RewardsClaimed")
            .withArgs(meldBanker.address, meldBanker.address, anyUint, anyUint);

          await expect(withdrawTx)
            .to.emit(lendingPool, "RefreshYieldBoostAmount")
            .withArgs(await usdc.getAddress(), meldBanker.address, 0n);

          await expect(withdrawTx)
            .to.emit(lendingPool, "UnlockMeldBankerNFT")
            .withArgs(
              await usdc.getAddress(),
              meldBanker.address,
              meldBankerTokenId,
              MeldBankerType.BANKER,
              Action.DEPOSIT
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
            await yieldBoostStorageUSDC.getStakerStakedAmount(
              meldBanker.address
            )
          ).to.equal(0n);
        });
      }); // End Withdrawal from genius loan Context
    }); // End MELD Banker Context

    context("Golden MELD Banker", async function () {
      context("Single Withdrawal", async function () {
        it("Should unlock MELD Banker NFT if Golden Banker withdraws whole balance of yield boost token", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            expectedReserveTokenAddresses,
            addressesProvider,
            meld,
            usdc,
            depositAmountUSDC,
            owner,
            goldenBanker,
            goldenBankerTokenId,
            rewardsSetter,
            yieldBoostStorageUSDC,
            yieldBoostStakingUSDC,
          } = await loadFixture(depositForSingleGoldenBankerFixture);

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

          // Get reserve data before withdrawal
          const reserveDataBeforeWithdrawal: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before withdrawal
          const userDataBeforeWithdrawal: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await usdc.getAddress(),
            goldenBanker.address
          );

          // Instantiate mUSDC contract
          const mUSDC = await ethers.getContractAt(
            "MToken",
            expectedReserveTokenAddresses.get("USDC").Mtoken
          );

          const meldBankerDataBefore = await lendingPool.userMeldBankerData(
            goldenBanker.address
          );

          const yieldBoostMultiplier = await lendingPool.yieldBoostMultipliers(
            meldBankerDataBefore.meldBankerType,
            meldBankerDataBefore.action
          );

          // Passing in MaxUint256 to withdraw the full user balance of the asset
          const withdrawTx = await lendingPool
            .connect(goldenBanker)
            .withdraw(
              await usdc.getAddress(),
              goldenBanker.address,
              MaxUint256,
              goldenBanker.address
            );

          // Hardhat time module. Gets timestamp of latest block.
          const blockTimestamp = await time.latest();

          // Calculate expected reserve data after withdrawal
          const expectedReserveDataAfterWithdrawal =
            calcExpectedReserveDataAfterWithdraw(
              MaxUint256,
              reserveDataBeforeWithdrawal,
              userDataBeforeWithdrawal,
              BigInt(blockTimestamp)
            );

          // The Withdraw event is emitted by the WithdrawLogic.sol library, so we need to get the contract instance with the WithdrawLogic ABI
          const contractInstanceWithWithdrawLibraryABI =
            await ethers.getContractAt(
              "WithdrawLogic",
              await lendingPool.getAddress(),
              owner
            );

          await expect(withdrawTx)
            .emit(contractInstanceWithWithdrawLibraryABI, "Withdraw")
            .withArgs(
              await usdc.getAddress(),
              goldenBanker.address,
              goldenBanker.address,
              goldenBanker.address,
              depositAmountUSDC
            );

          await expect(withdrawTx)
            .emit(lendingPool, "ReserveUsedAsCollateralDisabled")
            .withArgs(await usdc.getAddress(), goldenBanker.address);

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          await expect(withdrawTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await usdc.getAddress(),
              expectedReserveDataAfterWithdrawal.liquidityRate,
              expectedReserveDataAfterWithdrawal.stableBorrowRate,
              expectedReserveDataAfterWithdrawal.variableBorrowRate,
              expectedReserveDataAfterWithdrawal.liquidityIndex,
              expectedReserveDataAfterWithdrawal.variableBorrowIndex
            );

          await expect(withdrawTx)
            .to.emit(mUSDC, "Transfer")
            .withArgs(
              goldenBanker.address,
              ethers.ZeroAddress,
              depositAmountUSDC
            );

          await expect(withdrawTx)
            .to.emit(mUSDC, "Burn")
            .withArgs(
              goldenBanker.address,
              goldenBanker.address,
              depositAmountUSDC,
              expectedReserveDataAfterWithdrawal.liquidityIndex
            );
          await expect(withdrawTx).to.not.emit(mUSDC, "Mint");

          const expectedOldStakedAmount =
            depositAmountUSDC.percentMul(yieldBoostMultiplier);

          await expect(withdrawTx)
            .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
            .withArgs(goldenBanker.address, expectedOldStakedAmount, 0n);

          await expect(withdrawTx)
            .to.emit(yieldBoostStakingUSDC, "StakePositionRemoved")
            .withArgs(goldenBanker.address, expectedOldStakedAmount);

          await expect(withdrawTx)
            .to.emit(yieldBoostStakingUSDC, "RewardsClaimed")
            .withArgs(
              goldenBanker.address,
              goldenBanker.address,
              anyUint,
              anyUint
            );

          const meldBankerData = await lendingPool.userMeldBankerData(
            goldenBanker.address
          );

          await expect(withdrawTx)
            .to.emit(lendingPool, "RefreshYieldBoostAmount")
            .withArgs(await usdc.getAddress(), goldenBanker.address, 0n);

          await expect(withdrawTx)
            .to.emit(lendingPool, "UnlockMeldBankerNFT")
            .withArgs(
              await usdc.getAddress(),
              goldenBanker.address,
              goldenBankerTokenId,
              MeldBankerType.GOLDEN,
              Action.DEPOSIT
            );

          expect(await lendingPool.isUsingMeldBanker(goldenBanker.address)).to
            .be.false;

          expect(await lendingPool.isMeldBankerBlocked(goldenBankerTokenId)).to
            .be.false;

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
        it("Should NOT unlock Golden Banker NFT if MELD Banker withdraws whole balance of a different yield boost token", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            expectedReserveTokenAddresses,
            addressesProvider,
            meld,
            usdc,
            dai,
            owner,
            depositAmountUSDC,
            goldenBanker,
            goldenBankerTokenId,
            rewardsSetter,
            yieldBoostStorageUSDC,
            yieldBoostStakingUSDC,
          } = await loadFixture(depositForSingleGoldenBankerFixture);
          // Golden Banker already deposited USDC using tokenId. DAI is also a yield boost token. Golden banker is not using tokenId

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

          // Deposit DAI
          const depositAmountDAI = await allocateAndApproveTokens(
            dai,
            owner,
            goldenBanker,
            lendingPool,
            1000n,
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

          // Get reserve data before withdrawal
          const reserveDataBeforeWithdrawal: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await dai.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before withdrawal
          const userDataBeforeWithdrawal: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await dai.getAddress(),
            goldenBanker.address
          );

          // Instantiate mDAI contract
          const mDAI = await ethers.getContractAt(
            "MToken",
            expectedReserveTokenAddresses.get("DAI").Mtoken
          );

          // Passing in MaxUint256 to withdraw the full user balance of dai
          const withdrawTx = await lendingPool
            .connect(goldenBanker)
            .withdraw(
              await dai.getAddress(),
              goldenBanker.address,
              MaxUint256,
              goldenBanker.address
            );

          // Hardhat time module. Gets timestamp of latest block.
          const blockTimestamp = await time.latest();

          // Calculate expected reserve data after withdrawal
          const expectedReserveDataAfterWithdrawal =
            calcExpectedReserveDataAfterWithdraw(
              MaxUint256,
              reserveDataBeforeWithdrawal,
              userDataBeforeWithdrawal,
              BigInt(blockTimestamp)
            );

          // The Withdraw event is emitted by the WithdrawLogic.sol library, so we need to get the contract instance with the WithdrawLogic ABI
          const contractInstanceWithWithdrawLibraryABI =
            await ethers.getContractAt(
              "WithdrawLogic",
              await lendingPool.getAddress(),
              owner
            );

          await expect(withdrawTx)
            .emit(contractInstanceWithWithdrawLibraryABI, "Withdraw")
            .withArgs(
              await dai.getAddress(),
              goldenBanker.address,
              goldenBanker.address,
              goldenBanker.address,
              depositAmountDAI
            );

          await expect(withdrawTx)
            .emit(lendingPool, "ReserveUsedAsCollateralDisabled")
            .withArgs(await dai.getAddress(), goldenBanker.address);

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          await expect(withdrawTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await dai.getAddress(),
              expectedReserveDataAfterWithdrawal.liquidityRate,
              expectedReserveDataAfterWithdrawal.stableBorrowRate,
              expectedReserveDataAfterWithdrawal.variableBorrowRate,
              expectedReserveDataAfterWithdrawal.liquidityIndex,
              expectedReserveDataAfterWithdrawal.variableBorrowIndex
            );

          await expect(withdrawTx)
            .to.emit(mDAI, "Transfer")
            .withArgs(
              goldenBanker.address,
              ethers.ZeroAddress,
              depositAmountDAI
            );

          await expect(withdrawTx)
            .to.emit(mDAI, "Burn")
            .withArgs(
              goldenBanker.address,
              goldenBanker.address,
              depositAmountDAI,
              expectedReserveDataAfterWithdrawal.liquidityIndex
            );
          await expect(withdrawTx).to.not.emit(mDAI, "Mint");

          const meldBankerData = await lendingPool.userMeldBankerData(
            goldenBanker.address
          );

          await expect(withdrawTx).to.not.emit(
            yieldBoostStakingUSDC,
            "StakePositionUpdated"
          );

          await expect(withdrawTx).to.not.emit(
            yieldBoostStakingUSDC,
            "StakePositionRemoved"
          );

          await expect(withdrawTx).to.not.emit(
            yieldBoostStakingUSDC,
            "RewardsClaimed"
          );

          await expect(withdrawTx)
            .to.emit(lendingPool, "RefreshYieldBoostAmount")
            .withArgs(await dai.getAddress(), goldenBanker.address, 0n);

          await expect(withdrawTx).to.not.emit(
            lendingPool,
            "UnlockMeldBankerNFT"
          );

          expect(await lendingPool.isUsingMeldBanker(goldenBanker.address)).to
            .be.true;

          expect(await lendingPool.isMeldBankerBlocked(goldenBankerTokenId)).to
            .be.true;

          expect(meldBankerData.tokenId).to.equal(goldenBankerTokenId);
          expect(meldBankerData.asset).to.equal(await usdc.getAddress());
          expect(meldBankerData.meldBankerType).to.equal(MeldBankerType.GOLDEN);
          expect(meldBankerData.action).to.equal(Action.DEPOSIT);

          const yieldBoostMultiplier = await lendingPool.yieldBoostMultipliers(
            meldBankerData.meldBankerType,
            meldBankerData.action
          );
          const expectedStakedAmount =
            depositAmountUSDC.percentMul(yieldBoostMultiplier);

          expect(
            await yieldBoostStorageUSDC.getStakerStakedAmount(
              goldenBanker.address
            )
          ).to.equal(expectedStakedAmount);
        });
        it("Should NOT unlock Golden Banker NFT if MELD Banker withdraws partial balance of yield boost token", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            expectedReserveTokenAddresses,
            addressesProvider,
            meld,
            usdc,
            owner,
            depositAmountUSDC,
            goldenBanker,
            goldenBankerTokenId,
            rewardsSetter,
            yieldBoostStorageUSDC,
            yieldBoostStakingUSDC,
          } = await loadFixture(depositForSingleGoldenBankerFixture);

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

          // Withdraw USDC from the lending pool
          const amountToWithdraw = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "2000" // partial
          );

          // Get reserve data before withdrawal
          const reserveDataBeforeWithdrawal: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before withdrawal
          const userDataBeforeWithdrawal: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await usdc.getAddress(),
            goldenBanker.address
          );

          // Instantiate mUSDC contract
          const mUSDC = await ethers.getContractAt(
            "MToken",
            expectedReserveTokenAddresses.get("USDC").Mtoken
          );

          // Passing in MaxUint256 to withdraw the full user balance of dai
          const withdrawTx = await lendingPool
            .connect(goldenBanker)
            .withdraw(
              await usdc.getAddress(),
              goldenBanker.address,
              amountToWithdraw,
              goldenBanker.address
            );

          // Hardhat time module. Gets timestamp of latest block.
          const blockTimestamp = await time.latest();

          // Calculate expected reserve data after withdrawal
          const expectedReserveDataAfterWithdrawal =
            calcExpectedReserveDataAfterWithdraw(
              MaxUint256,
              reserveDataBeforeWithdrawal,
              userDataBeforeWithdrawal,
              BigInt(blockTimestamp)
            );

          // The Withdraw event is emitted by the WithdrawLogic.sol library, so we need to get the contract instance with the WithdrawLogic ABI
          const contractInstanceWithWithdrawLibraryABI =
            await ethers.getContractAt(
              "WithdrawLogic",
              await lendingPool.getAddress(),
              owner
            );

          await expect(withdrawTx)
            .emit(contractInstanceWithWithdrawLibraryABI, "Withdraw")
            .withArgs(
              await usdc.getAddress(),
              goldenBanker.address,
              goldenBanker.address,
              goldenBanker.address,
              amountToWithdraw
            );

          await expect(withdrawTx).to.not.emit(
            lendingPool,
            "ReserveUsedAsCollateralDisabled"
          );

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          await expect(withdrawTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await usdc.getAddress(),
              expectedReserveDataAfterWithdrawal.liquidityRate,
              expectedReserveDataAfterWithdrawal.stableBorrowRate,
              expectedReserveDataAfterWithdrawal.variableBorrowRate,
              expectedReserveDataAfterWithdrawal.liquidityIndex,
              expectedReserveDataAfterWithdrawal.variableBorrowIndex
            );

          await expect(withdrawTx)
            .to.emit(mUSDC, "Transfer")
            .withArgs(
              goldenBanker.address,
              ethers.ZeroAddress,
              amountToWithdraw
            );

          await expect(withdrawTx)
            .to.emit(mUSDC, "Burn")
            .withArgs(
              goldenBanker.address,
              goldenBanker.address,
              amountToWithdraw,
              expectedReserveDataAfterWithdrawal.liquidityIndex
            );
          await expect(withdrawTx).to.not.emit(mUSDC, "Mint");

          const meldBankerData = await lendingPool.userMeldBankerData(
            goldenBanker.address
          );

          const yieldBoostMultiplier = await lendingPool.yieldBoostMultipliers(
            meldBankerData.meldBankerType,
            meldBankerData.action
          );

          const expectedOldStakedAmount =
            depositAmountUSDC.percentMul(yieldBoostMultiplier);

          const expectedNewStakedAmount = (
            depositAmountUSDC - amountToWithdraw
          ).percentMul(yieldBoostMultiplier);

          await expect(withdrawTx)
            .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
            .withArgs(
              goldenBanker.address,
              expectedOldStakedAmount,
              expectedNewStakedAmount
            );

          await expect(withdrawTx).to.not.emit(
            yieldBoostStakingUSDC,
            "StakePositionRemoved"
          );

          await expect(withdrawTx).to.not.emit(
            yieldBoostStakingUSDC,
            "RewardsClaimed"
          );

          await expect(withdrawTx)
            .to.emit(lendingPool, "RefreshYieldBoostAmount")
            .withArgs(
              await usdc.getAddress(),
              goldenBanker.address,
              expectedNewStakedAmount
            );

          await expect(withdrawTx).to.not.emit(
            lendingPool,
            "UnlockMeldBankerNFT"
          );

          expect(await lendingPool.isUsingMeldBanker(goldenBanker.address)).to
            .be.true;

          expect(await lendingPool.isMeldBankerBlocked(goldenBankerTokenId)).to
            .be.true;

          expect(meldBankerData.tokenId).to.equal(goldenBankerTokenId);
          expect(meldBankerData.asset).to.equal(await usdc.getAddress());
          expect(meldBankerData.meldBankerType).to.equal(MeldBankerType.GOLDEN);
          expect(meldBankerData.action).to.equal(Action.DEPOSIT);

          expect(
            await yieldBoostStorageUSDC.getStakerStakedAmount(
              goldenBanker.address
            )
          ).to.equal(expectedNewStakedAmount);
        });
      }); // End Single Withdrawal Context
      context("Withdrawal from genius loan", async function () {
        it("Should allow for someone with the GENIUS_LOAN_ROLE role to withdraw on behalf of a Golden banker that has opted in", async function () {
          const {
            lendingPool,
            addressesProvider,
            meld,
            usdc,
            owner,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            expectedReserveTokenAddresses,
            rando,
            goldenBanker,
            goldenBankerTokenId,
            depositAmountUSDC,
            rewardsSetter,
            yieldBoostStorageUSDC,
            yieldBoostStakingUSDC,
          } = await loadFixture(depositForSingleGoldenBankerFixture);

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

          // Give rando the GENIUS_LOAN_ROLE role
          await addressesProvider
            .connect(owner)
            .grantRole(
              await addressesProvider.GENIUS_LOAN_ROLE(),
              rando.address
            );

          // Get reserve data before withdrawal
          const reserveDataBeforeWithdrawal: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user reserve data before withdrawal
          const userDataBeforeWithdrawal: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await usdc.getAddress(),
            goldenBanker.address
          );

          // Instantiate mUSDC contract
          const mUSDC = await ethers.getContractAt(
            "MToken",
            expectedReserveTokenAddresses.get("USDC").Mtoken
          );

          const meldBankerDataBefore = await lendingPool.userMeldBankerData(
            goldenBanker.address
          );

          const yieldBoostMultiplier = await lendingPool.yieldBoostMultipliers(
            meldBankerDataBefore.meldBankerType,
            meldBankerDataBefore.action
          );

          // MELD Banker opts in to the genius loan
          await lendingPool.connect(goldenBanker).setUserAcceptGeniusLoan(true);

          // Genius Loan Role holder calls withdraw on behalf of Golden Banker
          const withdrawTx = await lendingPool
            .connect(rando)
            .withdraw(
              await usdc.getAddress(),
              goldenBanker.address,
              MaxUint256,
              rando.address
            );

          // The Withdraw event is emitted by the WithdrawLogic.sol library, so we need to get the contract instance with the WithdrawLogic ABI
          const contractInstanceWithWithdrawLibraryABI =
            await ethers.getContractAt(
              "WithdrawLogic",
              await lendingPool.getAddress(),
              owner
            );

          // Check that the events were emitted correctly for the withdrawal
          await expect(withdrawTx)
            .emit(contractInstanceWithWithdrawLibraryABI, "Withdraw")
            .withArgs(
              await usdc.getAddress(),
              goldenBanker.address,
              rando.address,
              rando.address,
              depositAmountUSDC
            );

          // Hardhat time module. Gets timestamp of latest block.
          const blockTimestamp = await time.latest();

          // Calculate expected reserve data after withdrawal
          const expectedReserveDataAfterWithdrawal =
            calcExpectedReserveDataAfterWithdraw(
              MaxUint256,
              reserveDataBeforeWithdrawal,
              userDataBeforeWithdrawal,
              BigInt(blockTimestamp)
            );

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          await expect(withdrawTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await usdc.getAddress(),
              expectedReserveDataAfterWithdrawal.liquidityRate,
              expectedReserveDataAfterWithdrawal.stableBorrowRate,
              expectedReserveDataAfterWithdrawal.variableBorrowRate,
              expectedReserveDataAfterWithdrawal.liquidityIndex,
              expectedReserveDataAfterWithdrawal.variableBorrowIndex
            );

          await expect(withdrawTx)
            .to.emit(mUSDC, "Transfer")
            .withArgs(
              goldenBanker.address,
              ethers.ZeroAddress,
              depositAmountUSDC
            );

          await expect(withdrawTx)
            .to.emit(mUSDC, "Burn")
            .withArgs(
              goldenBanker.address,
              rando.address,
              depositAmountUSDC,
              expectedReserveDataAfterWithdrawal.liquidityIndex
            );

          await expect(withdrawTx).to.not.emit(mUSDC, "Mint");

          const expectedOldStakedAmount =
            depositAmountUSDC.percentMul(yieldBoostMultiplier);

          await expect(withdrawTx)
            .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
            .withArgs(goldenBanker.address, expectedOldStakedAmount, 0n);

          await expect(withdrawTx)
            .to.emit(yieldBoostStakingUSDC, "StakePositionRemoved")
            .withArgs(goldenBanker.address, expectedOldStakedAmount);

          await expect(withdrawTx)
            .to.emit(yieldBoostStakingUSDC, "RewardsClaimed")
            .withArgs(
              goldenBanker.address,
              goldenBanker.address,
              anyUint,
              anyUint
            );

          await expect(withdrawTx)
            .to.emit(lendingPool, "RefreshYieldBoostAmount")
            .withArgs(await usdc.getAddress(), goldenBanker.address, 0n);

          await expect(withdrawTx)
            .to.emit(lendingPool, "UnlockMeldBankerNFT")
            .withArgs(
              await usdc.getAddress(),
              goldenBanker.address,
              goldenBankerTokenId,
              MeldBankerType.GOLDEN,
              Action.DEPOSIT
            );

          expect(await lendingPool.isUsingMeldBanker(goldenBanker.address)).to
            .be.false;

          expect(await lendingPool.isMeldBankerBlocked(goldenBankerTokenId)).to
            .be.false;
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
      }); // End Withdrawal from genius loan Context
    }); // End MELD Golden Banker Context
  }); // End Happy Flow Test Cases Context

  context("Error Test Cases", async function () {
    context("Meld Banker NFT and Yield Boost", async function () {
      it("Should not unlock NFT if withdraw reverts", async function () {
        const { lendingPool, usdc, meldBanker, meldBankerTokenId } =
          await loadFixture(depositForSingleMeldBankerFixture);

        expect(await lendingPool.isUsingMeldBanker(meldBanker.address)).to.be
          .true;

        expect(await lendingPool.isMeldBankerBlocked(meldBankerTokenId)).to.be
          .true;

        await expect(
          lendingPool
            .connect(meldBanker)
            .withdraw(
              await usdc.getAddress(),
              meldBanker.address,
              0,
              meldBanker.address
            )
        ).to.revertedWith(ProtocolErrors.VL_INVALID_AMOUNT);

        expect(await lendingPool.isUsingMeldBanker(meldBanker.address)).to.be
          .true;

        expect(await lendingPool.isMeldBankerBlocked(meldBankerTokenId)).to.be
          .true;
      });
    }); // End Meld Banker NFT and Yield Boost Context
    it("Should revert if the asset address is the zero address", async function () {
      const { lendingPool, usdc, depositor } = await loadFixture(
        depositForSingleDepositorFixture
      );

      const amountToWithdraw = await convertToCurrencyDecimals(
        await usdc.getAddress(),
        "2000"
      );

      await expect(
        lendingPool
          .connect(depositor)
          .withdraw(
            ZeroAddress,
            depositor.address,
            amountToWithdraw,
            depositor.address
          )
      ).to.revertedWith(ProtocolErrors.INVALID_ADDRESS);
    });

    it("Should revert if the to address is the zero address", async function () {
      const { lendingPool, usdc, depositor } = await loadFixture(
        depositForSingleDepositorFixture
      );

      const amountToWithdraw = await convertToCurrencyDecimals(
        await usdc.getAddress(),
        "2000"
      );

      await expect(
        lendingPool
          .connect(depositor)
          .withdraw(
            await usdc.getAddress(),
            depositor.address,
            amountToWithdraw,
            ZeroAddress
          )
      ).to.revertedWith(ProtocolErrors.INVALID_ADDRESS);
    });

    it("Should revert if the amount is zero", async function () {
      const { lendingPool, usdc, depositor } = await loadFixture(
        depositForSingleDepositorFixture
      );

      await expect(
        lendingPool
          .connect(depositor)
          .withdraw(
            await usdc.getAddress(),
            depositor.address,
            0,
            depositor.address
          )
      ).to.revertedWith(ProtocolErrors.VL_INVALID_AMOUNT);
    });
    it("Should revert if user tries to withdraw more than the own balance", async function () {
      const { lendingPool, usdc, depositor } = await loadFixture(
        depositForSingleDepositorFixture
      );

      const amountToWithdraw = await convertToCurrencyDecimals(
        await usdc.getAddress(),
        "5001"
      );

      await expect(
        lendingPool
          .connect(depositor)
          .withdraw(
            await usdc.getAddress(),
            depositor.address,
            amountToWithdraw,
            depositor.address
          )
      ).to.revertedWith(ProtocolErrors.VL_NOT_ENOUGH_AVAILABLE_USER_BALANCE);
    });
    it("Should revert if genius loan role is not used", async function () {
      const { lendingPool, usdc, depositor, rando, addressesProvider } =
        await loadFixture(depositForSingleDepositorFixture);

      const amountToWithdraw = await convertToCurrencyDecimals(
        await usdc.getAddress(),
        "1000"
      );

      const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.GENIUS_LOAN_ROLE()}`;

      await expect(
        lendingPool
          .connect(rando)
          .withdraw(
            await usdc.getAddress(),
            depositor.address,
            amountToWithdraw,
            rando.address
          )
      ).to.revertedWith(expectedException);
    });
    it("Should revert if genius loan was not accepted", async function () {
      const { lendingPool, usdc, depositor, rando, addressesProvider, owner } =
        await loadFixture(depositForSingleDepositorFixture);

      const amountToWithdraw = await convertToCurrencyDecimals(
        await usdc.getAddress(),
        "1000"
      );

      // Give rando the GENIUS_LOAN_ROLE role
      await addressesProvider
        .connect(owner)
        .grantRole(await addressesProvider.GENIUS_LOAN_ROLE(), rando.address);

      await expect(
        lendingPool
          .connect(rando)
          .withdraw(
            await usdc.getAddress(),
            depositor.address,
            amountToWithdraw,
            rando.address
          )
      ).to.revertedWith(ProtocolErrors.LP_USER_NOT_ACCEPT_GENIUS_LOAN);
    });

    it("Should revert if user tries to withdraw all funds deposited when there are borrows", async function () {
      const { lendingPool, usdc, depositor, borrower } =
        await loadFixture(borrowFixture);

      // Borrower borrows USDC from the lending pool
      const amountToBorrow = await convertToCurrencyDecimals(
        await usdc.getAddress(),
        "500"
      );

      await lendingPool
        .connect(borrower)
        .borrow(
          await usdc.getAddress(),
          amountToBorrow,
          RateMode.Variable,
          borrower.address,
          0
        );

      await expect(
        lendingPool
          .connect(depositor)
          .withdraw(
            await usdc.getAddress(),
            depositor.address,
            MaxUint256,
            depositor.address
          )
      ).to.revertedWith(ProtocolErrors.CURRENT_AVAILABLE_LIQUIDITY_NOT_ENOUGH);
    });

    it("Should revert if an unsupported token is passed in as the asset", async function () {
      const { lendingPool, unsupportedToken, depositor } = await loadFixture(
        depositForSingleDepositorFixture
      );

      const amountToWithdraw = await convertToCurrencyDecimals(
        await unsupportedToken.getAddress(),
        "1"
      );

      await expect(
        lendingPool
          .connect(depositor)
          .withdraw(
            await unsupportedToken.getAddress(),
            depositor.address,
            amountToWithdraw,
            depositor.address
          )
      ).to.revertedWith(ProtocolErrors.VL_NO_ACTIVE_RESERVE);
    });

    it("Should revert if the reserve is not active", async function () {
      const {
        lendingPool,
        lendingPoolConfigurator,
        tether,
        unsupportedToken,
        depositor,
        poolAdmin,
      } = await loadFixture(depositForSingleDepositorFixture);

      // Deactivate the USDC reserve
      await lendingPoolConfigurator
        .connect(poolAdmin)
        .deactivateReserve(await tether.getAddress());

      const amountToWithdraw = await convertToCurrencyDecimals(
        await unsupportedToken.getAddress(),
        "1000"
      );

      await expect(
        lendingPool
          .connect(depositor)
          .withdraw(
            await tether.getAddress(),
            depositor.address,
            amountToWithdraw,
            depositor.address
          )
      ).to.revertedWith(ProtocolErrors.VL_NO_ACTIVE_RESERVE);
    });

    it("Should revert if user tries to withdraw entire collateral balance", async function () {
      const { lendingPool, meld, usdc, borrower } =
        await loadFixture(borrowFixture);

      // Borrower borrows USDC from the lending pool, using MELD as collateral
      const amountToBorrow = await convertToCurrencyDecimals(
        await usdc.getAddress(),
        "200"
      );

      await lendingPool
        .connect(borrower)
        .borrow(
          await usdc.getAddress(),
          amountToBorrow,
          RateMode.Variable,
          borrower.address,
          0
        );

      await expect(
        lendingPool
          .connect(borrower)
          .withdraw(
            await meld.getAddress(),
            borrower.address,
            MaxUint256,
            borrower.address
          )
      ).to.revertedWith(ProtocolErrors.VL_TRANSFER_NOT_ALLOWED);
    });

    it("Should revert if partial collateral withdrawal decreases health factor too much", async function () {
      const { lendingPool, usdc, meld, borrower } =
        await loadFixture(borrowFixture);

      // Borrower borrows USDC from the lending pool
      const amountToBorrow = await convertToCurrencyDecimals(
        await usdc.getAddress(),
        "500"
      );

      await lendingPool
        .connect(borrower)
        .borrow(
          await usdc.getAddress(),
          amountToBorrow,
          RateMode.Variable,
          borrower.address,
          0
        );

      // Borrower withdraws large portion of MELD (collateral token) from the lending pool
      const amountToWithdraw = await convertToCurrencyDecimals(
        await meld.getAddress(),
        "19500"
      );

      await expect(
        lendingPool
          .connect(borrower)
          .withdraw(
            await meld.getAddress(),
            borrower.address,
            amountToWithdraw,
            borrower.address
          )
      ).to.revertedWith(ProtocolErrors.VL_TRANSFER_NOT_ALLOWED);
    });

    it("Should revert when second user tries to withdraw whole balance when there are funds borrowed", async function () {
      // Load the test fixture
      const { lendingPool, depositor, borrower, rando, usdc } =
        await loadFixture(multipleDepositorsForBorrowFixture);

      // In order for interest to accrue there must be funds borrowed (and paying interest).

      // Borrower borrows USDC from the lending pool
      const amountToBorrow = await convertToCurrencyDecimals(
        await usdc.getAddress(),
        "500"
      );

      await lendingPool
        .connect(borrower)
        .borrow(
          await usdc.getAddress(),
          amountToBorrow,
          RateMode.Variable,
          borrower.address,
          0
        );

      // Depositor 1 withdraws whole balance
      await lendingPool.connect(depositor).withdraw(
        await usdc.getAddress(),
        depositor.address,
        MaxUint256, //depositor's whole balance
        depositor.address
      );

      // Depositor 2 withdraws whole balance
      await expect(
        lendingPool.connect(rando).withdraw(
          await usdc.getAddress(),
          rando.address,
          MaxUint256, //rando's whole balance
          rando.address
        )
      ).to.revertedWith(ProtocolErrors.CURRENT_AVAILABLE_LIQUIDITY_NOT_ENOUGH);
    });
  }); // End of Error Test Cases Context
}); // End of Withdraw Describe
