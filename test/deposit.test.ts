import { ethers } from "hardhat";
import {
  allocateAndApproveTokens,
  getBlockTimestamps,
  loadPoolConfigForEnv,
  setUpTestFixture,
  deployContracts,
  deployMockTokens,
  initializeReserves,
  configureReservesForBorrowing,
} from "./helpers/utils/utils";
import {
  IMeldConfiguration,
  PoolConfiguration,
  ProtocolErrors,
  RateMode,
  Action,
  MeldBankerType,
} from "./helpers/types";
import { ONE_HOUR, ONE_YEAR, _1e18 } from "./helpers/constants";
import {
  ReserveData,
  UserReserveData,
  BlockTimestamps,
} from "./helpers/interfaces";
import { MaxUint256, ZeroAddress } from "ethers";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { convertToCurrencyDecimals } from "./helpers/utils/contracts-helpers";
import {
  calcExpectedReserveDataAfterDeposit,
  calcExpectedUserDataAfterDeposit,
  calcExpectedMTokenBalance,
} from "./helpers/utils/calculations";
import {
  getReserveData,
  getUserData,
  expectEqual,
} from "./helpers/utils/helpers";
import {
  ReserveInitParams,
  ReserveConfigParams,
} from "../test/helpers/interfaces";

import { LendingPoolConfigurator } from "../typechain-types";

describe("Deposit", function () {
  async function noMeldBankerNFTSetFixture() {
    const [
      owner,
      poolAdmin,
      oracleAdmin,
      bankerAdmin,
      pauser,
      unpauser,
      roleDestroyer,
      treasury,
      depositor,
      meldBanker,
      goldenBanker,
    ] = await ethers.getSigners();

    // Get pool configuration values
    const poolConfig: PoolConfiguration = loadPoolConfigForEnv();

    const { ReservesConfig } = poolConfig as IMeldConfiguration;

    const contracts = await deployContracts(
      true, // addressesProviderSetters == true
      ReservesConfig,
      owner,
      poolAdmin,
      oracleAdmin,
      bankerAdmin,
      pauser,
      unpauser,
      roleDestroyer,
      true // skipSetMeldBankerNFT
    );

    // Deploy mock asset tokens
    const { meld, usdc } = await deployMockTokens();

    await contracts.addressesProvider.setMeldToken(meld);

    //Initialize reserves
    const reserveInitParams: ReserveInitParams[] = [
      {
        underlyingAsset: usdc,
        interestRateStrategy: contracts.usdcInterestRateStrategy,
      },
    ];

    await initializeReserves(
      reserveInitParams,
      treasury.address,
      contracts.lendingPoolConfigurator as LendingPoolConfigurator,
      poolAdmin
    );

    // Configure reserves
    const reserveConfigParams: ReserveConfigParams[] = [
      {
        underlyingAsset: usdc,
        enableBorrowing: true,
        enableStableBorrowing: false,
      },
    ];

    await configureReservesForBorrowing(
      reserveConfigParams,
      contracts.meldPriceOracle,
      contracts.meldLendingRateOracle,
      contracts.lendingPoolConfigurator,
      poolAdmin,
      oracleAdmin
    );

    // Mint MELD Banker NFTs

    // Regular MELD Banker NFT
    const meldBankerTokenId = 1n;
    let golden = false;
    await contracts.meldBankerNft
      .connect(bankerAdmin)
      .mint(meldBanker, meldBankerTokenId, golden);

    // Golden MELD Banker NFT
    const goldenBankerTokenId = 2n;
    golden = true;
    await contracts.meldBankerNft
      .connect(bankerAdmin)
      .mint(goldenBanker, goldenBankerTokenId, golden);

    return {
      ...contracts,
      owner,
      usdc,
      treasury,
      depositor,
      meldBanker,
      goldenBanker,
      meldBankerTokenId,
      goldenBankerTokenId,
    };
  }

  async function setUpForBorrowTestFixture() {
    // Deploy protocol
    const {
      usdc,
      meld,
      owner,
      treasury,
      depositor,
      borrower,
      poolAdmin,
      oracleAdmin,
      ...contracts
    } = await setUpTestFixture();

    // Get pool configuration values
    const poolConfig: PoolConfiguration = loadPoolConfigForEnv();

    const {
      Mocks: { AllAssetsInitialPrices },
      LendingRateOracleRatesCommon,
      ReservesConfig,
    } = poolConfig as IMeldConfiguration;

    // Set test price values
    await contracts.meldPriceOracle
      .connect(oracleAdmin)
      .setAssetPrice(await usdc.getAddress(), AllAssetsInitialPrices.USDC);

    await contracts.meldPriceOracle
      .connect(oracleAdmin)
      .setAssetPrice(await meld.getAddress(), AllAssetsInitialPrices.MELD);

    // Set test market lending rates
    contracts.meldLendingRateOracle.setMarketBorrowRate(
      await usdc.getAddress(),
      LendingRateOracleRatesCommon.USDC!.borrowRate
    );

    contracts.meldLendingRateOracle.setMarketBorrowRate(
      await meld.getAddress(),
      LendingRateOracleRatesCommon.MELD.borrowRate
    );

    // Enable borrowing on reserve
    await expect(
      contracts.lendingPoolConfigurator
        .connect(poolAdmin)
        .enableBorrowingOnReserve(
          await usdc.getAddress(),
          true // stableBorrowRateEnabled
        )
    )
      .to.emit(contracts.lendingPoolConfigurator, "BorrowingEnabledOnReserve")
      .withArgs(await usdc.getAddress(), true);

    await expect(
      contracts.lendingPoolConfigurator
        .connect(poolAdmin)
        .setReserveFactor(
          await usdc.getAddress(),
          ReservesConfig.USDC!.reserveFactor
        )
    )
      .to.emit(contracts.lendingPoolConfigurator, "ReserveFactorChanged")
      .withArgs(await usdc.getAddress(), ReservesConfig.USDC!.reserveFactor);

    await expect(
      contracts.lendingPoolConfigurator
        .connect(poolAdmin)
        .configureReserveAsCollateral(
          await meld.getAddress(),
          ReservesConfig.MELD.baseLTVAsCollateral,
          ReservesConfig.MELD.liquidationThreshold,
          ReservesConfig.MELD.liquidationBonus
        )
    )
      .to.emit(
        contracts.lendingPoolConfigurator,
        "CollateralConfigurationChanged"
      )
      .withArgs(
        await meld.getAddress(),
        ReservesConfig.MELD.baseLTVAsCollateral,
        ReservesConfig.MELD.liquidationThreshold,
        ReservesConfig.MELD.liquidationBonus
      );

    // Deposit liquidity

    // Depositor deposits USDC liquidity
    const depositAmountUSDC = await allocateAndApproveTokens(
      usdc,
      owner,
      depositor,
      contracts.lendingPool,
      1000n,
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

    // Borrower deposits MELD as collateral
    const depositAmountMELD = await allocateAndApproveTokens(
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
        depositAmountMELD,
        borrower.address,
        true,
        0
      );

    return {
      ...contracts,
      usdc,
      meld,
      owner,
      treasury,
      depositor,
      borrower,
    };
  }

  context("Happy Flow Test Cases", async function () {
    context("Regular User", async function () {
      context(
        "Single deposits and multiple deposits of same asset by same depositor",
        async function () {
          it("Should emit correct events for collateral deposit", async function () {
            //First time an address deposits a reserve, it's marked as collateral

            // First deploy protocol, create and initialize the reserve
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              yieldBoostStakingUSDC,
              usdc,
              owner,
              depositor,
            } = await loadFixture(setUpTestFixture);

            // Set up Deposit. factor = 0 because deposit and approval amount are same
            const depositAmount = await allocateAndApproveTokens(
              usdc,
              owner,
              depositor,
              lendingPool,
              1000n,
              0n
            );

            // Get reserve data before deposit
            const reserveDataBeforeDeposit: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Instantiate mUSDC contract
            const mUSDC = await ethers.getContractAt(
              "MToken",
              reserveDataBeforeDeposit.mTokenAddress
            );

            // Deposit
            const depositTx = await lendingPool
              .connect(depositor)
              .deposit(
                await usdc.getAddress(),
                depositAmount,
                depositor.address,
                true,
                0
              );

            // Hardhat time module. Gets timestamp of latest block.
            const blockTimestamp = await time.latest();

            // Calculate expected reserve data after deposit
            const expectedReserveDataAfterDeposit =
              calcExpectedReserveDataAfterDeposit(
                depositAmount,
                reserveDataBeforeDeposit,
                BigInt(blockTimestamp)
              );

            // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
            const contractInstanceWithLibraryABI = await ethers.getContractAt(
              "ReserveLogic",
              await lendingPool.getAddress(),
              owner
            );

            await expect(depositTx)
              .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
              .withArgs(
                await usdc.getAddress(),
                expectedReserveDataAfterDeposit.liquidityRate,
                expectedReserveDataAfterDeposit.stableBorrowRate,
                expectedReserveDataAfterDeposit.variableBorrowRate,
                expectedReserveDataAfterDeposit.liquidityIndex,
                expectedReserveDataAfterDeposit.variableBorrowIndex
              );

            // The amount is subtracted from the currentAllowance, so in this case the amount should be set to 0 just before the transfer
            await expect(depositTx)
              .to.emit(usdc, "Approval")
              .withArgs(depositor.address, await lendingPool.getAddress(), 0);

            await expect(depositTx)
              .to.emit(usdc, "Transfer")
              .withArgs(
                depositor.address,
                reserveDataBeforeDeposit.mTokenAddress,
                depositAmount
              );

            await expect(depositTx)
              .to.emit(mUSDC, "Transfer")
              .withArgs(ZeroAddress, depositor.address, depositAmount);

            await expect(depositTx)
              .to.emit(mUSDC, "Mint")
              .withArgs(
                depositor.address,
                depositAmount,
                expectedReserveDataAfterDeposit.liquidityIndex
              );

            await expect(depositTx)
              .to.emit(lendingPool, "ReserveUsedAsCollateralEnabled")
              .withArgs(await usdc.getAddress(), depositor.address);

            // Regular user, so should emit StakePositionCreated, StakePositionUpdated, RefreshYieldBoostAmount events but not LockMeldBankerNFT
            await expect(depositTx)
              .to.emit(yieldBoostStakingUSDC, "StakePositionCreated")
              .withArgs(depositor.address, depositAmount);

            await expect(depositTx)
              .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
              .withArgs(depositor.address, 0, depositAmount);

            await expect(depositTx).to.not.emit(
              lendingPool,
              "LockMeldBankerNFT"
            );

            await expect(depositTx)
              .to.emit(lendingPool, "RefreshYieldBoostAmount")
              .withArgs(
                await usdc.getAddress(),
                depositor.address,
                depositAmount
              );

            // The Deposit event is emitted by the DepositLogic.sol library, so we need to get the contract instance with the DepositLogic ABI
            const contractInstanceWithDepositLibraryABI =
              await ethers.getContractAt(
                "DepositLogic",
                await lendingPool.getAddress(),
                owner
              );

            await expect(depositTx)
              .to.emit(contractInstanceWithDepositLibraryABI, "Deposit")
              .withArgs(
                await usdc.getAddress(),
                depositor.address,
                depositor.address,
                depositAmount
              );
          });

          it("Should emit correct events for collateral deposit, when passed control boolean true", async function () {
            //First time an address deposits a reserve, it's marked as collateral by default. This test checks the utility of the `useAsCollateral` optional bool set as true

            // First deploy protocol, create and initialize the reserve
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              yieldBoostStakingUSDC,
              usdc,
              owner,
              depositor,
            } = await loadFixture(setUpTestFixture);

            // Set up Deposit. factor = 0 because deposit and approval amount are same
            const depositAmount = await allocateAndApproveTokens(
              usdc,
              owner,
              depositor,
              lendingPool,
              1000n,
              0n
            );

            // Get reserve data before deposit
            const reserveDataBeforeDeposit: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Instantiate mUSDC contract
            const mUSDC = await ethers.getContractAt(
              "MToken",
              reserveDataBeforeDeposit.mTokenAddress
            );

            // Deposit
            const depositTx = await lendingPool
              .connect(depositor)
              .deposit(
                await usdc.getAddress(),
                depositAmount,
                depositor.address,
                true,
                0
              );

            // Hardhat time module. Gets timestamp of latest block.
            const blockTimestamp = await time.latest();

            // Calculate expected reserve data after deposit
            const expectedReserveDataAfterDeposit =
              calcExpectedReserveDataAfterDeposit(
                depositAmount,
                reserveDataBeforeDeposit,
                BigInt(blockTimestamp)
              );

            // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
            const contractInstanceWithLibraryABI = await ethers.getContractAt(
              "ReserveLogic",
              await lendingPool.getAddress(),
              owner
            );

            await expect(depositTx)
              .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
              .withArgs(
                await usdc.getAddress(),
                expectedReserveDataAfterDeposit.liquidityRate,
                expectedReserveDataAfterDeposit.stableBorrowRate,
                expectedReserveDataAfterDeposit.variableBorrowRate,
                expectedReserveDataAfterDeposit.liquidityIndex,
                expectedReserveDataAfterDeposit.variableBorrowIndex
              );

            // The amount is subtracted from the currentAllowance, so in this case the amount should be set to 0 just before the transfer
            await expect(depositTx)
              .to.emit(usdc, "Approval")
              .withArgs(depositor.address, await lendingPool.getAddress(), 0);

            await expect(depositTx)
              .to.emit(usdc, "Transfer")
              .withArgs(
                depositor.address,
                reserveDataBeforeDeposit.mTokenAddress,
                depositAmount
              );

            await expect(depositTx)
              .to.emit(mUSDC, "Transfer")
              .withArgs(ZeroAddress, depositor.address, depositAmount);

            await expect(depositTx)
              .to.emit(mUSDC, "Mint")
              .withArgs(
                depositor.address,
                depositAmount,
                expectedReserveDataAfterDeposit.liquidityIndex
              );

            await expect(depositTx)
              .to.emit(lendingPool, "ReserveUsedAsCollateralEnabled")
              .withArgs(await usdc.getAddress(), depositor.address);

            // Regular user, so should emit StakePositionCreated, StakePositionUpdated, RefreshYieldBoostAmount events but not LockMeldBankerNFT
            await expect(depositTx)
              .to.emit(yieldBoostStakingUSDC, "StakePositionCreated")
              .withArgs(depositor.address, depositAmount);

            await expect(depositTx)
              .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
              .withArgs(depositor.address, 0, depositAmount);

            await expect(depositTx).to.not.emit(
              lendingPool,
              "LockMeldBankerNFT"
            );

            await expect(depositTx)
              .to.emit(lendingPool, "RefreshYieldBoostAmount")
              .withArgs(
                await usdc.getAddress(),
                depositor.address,
                depositAmount
              );

            // The Deposit event is emitted by the DepositLogic.sol library, so we need to get the contract instance with the DepositLogic ABI
            const contractInstanceWithDepositLibraryABI =
              await ethers.getContractAt(
                "DepositLogic",
                await lendingPool.getAddress(),
                owner
              );

            await expect(depositTx)
              .to.emit(contractInstanceWithDepositLibraryABI, "Deposit")
              .withArgs(
                await usdc.getAddress(),
                depositor.address,
                depositor.address,
                depositAmount
              );
          });
          it("Should emit correct events for collateral deposit, when passed control boolean false", async function () {
            //First time an address deposits a reserve, it's marked as collateral by default. This test checks the utility of the `useAsCollateral` optional bool set as false

            // First deploy protocol, create and initialize the reserve
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              yieldBoostStakingUSDC,
              usdc,
              owner,
              depositor,
            } = await loadFixture(setUpTestFixture);

            // Set up Deposit. factor = 0 because deposit and approval amount are same
            const depositAmount = await allocateAndApproveTokens(
              usdc,
              owner,
              depositor,
              lendingPool,
              1000n,
              0n
            );

            // Get reserve data before deposit
            const reserveDataBeforeDeposit: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Instantiate mUSDC contract
            const mUSDC = await ethers.getContractAt(
              "MToken",
              reserveDataBeforeDeposit.mTokenAddress
            );

            // Deposit
            const depositTx = await lendingPool
              .connect(depositor)
              .deposit(
                await usdc.getAddress(),
                depositAmount,
                depositor.address,
                false,
                0
              );

            // Hardhat time module. Gets timestamp of latest block.
            const blockTimestamp = await time.latest();

            // Calculate expected reserve data after deposit
            const expectedReserveDataAfterDeposit =
              calcExpectedReserveDataAfterDeposit(
                depositAmount,
                reserveDataBeforeDeposit,
                BigInt(blockTimestamp)
              );

            // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
            const contractInstanceWithLibraryABI = await ethers.getContractAt(
              "ReserveLogic",
              await lendingPool.getAddress(),
              owner
            );

            await expect(depositTx)
              .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
              .withArgs(
                await usdc.getAddress(),
                expectedReserveDataAfterDeposit.liquidityRate,
                expectedReserveDataAfterDeposit.stableBorrowRate,
                expectedReserveDataAfterDeposit.variableBorrowRate,
                expectedReserveDataAfterDeposit.liquidityIndex,
                expectedReserveDataAfterDeposit.variableBorrowIndex
              );

            // The amount is subtracted from the currentAllowance, so in this case the amount should be set to 0 just before the transfer
            await expect(depositTx)
              .to.emit(usdc, "Approval")
              .withArgs(depositor.address, await lendingPool.getAddress(), 0);

            await expect(depositTx)
              .to.emit(usdc, "Transfer")
              .withArgs(
                depositor.address,
                reserveDataBeforeDeposit.mTokenAddress,
                depositAmount
              );

            await expect(depositTx)
              .to.emit(mUSDC, "Transfer")
              .withArgs(ZeroAddress, depositor.address, depositAmount);

            await expect(depositTx)
              .to.emit(mUSDC, "Mint")
              .withArgs(
                depositor.address,
                depositAmount,
                expectedReserveDataAfterDeposit.liquidityIndex
              );

            await expect(depositTx).to.not.emit(
              lendingPool,
              "ReserveUsedAsCollateralEnabled"
            );

            // Regular user, so should emit StakePositionCreated, StakePositionUpdated, RefreshYieldBoostAmount events but not LockMeldBankerNFT
            await expect(depositTx)
              .to.emit(yieldBoostStakingUSDC, "StakePositionCreated")
              .withArgs(depositor.address, depositAmount);

            await expect(depositTx)
              .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
              .withArgs(depositor.address, 0, depositAmount);

            await expect(depositTx).to.not.emit(
              lendingPool,
              "LockMeldBankerNFT"
            );

            await expect(depositTx)
              .to.emit(lendingPool, "RefreshYieldBoostAmount")
              .withArgs(
                await usdc.getAddress(),
                depositor.address,
                depositAmount
              );

            // The Deposit event is emitted by the DepositLogic.sol library, so we need to get the contract instance with the DepositLogic ABI
            const contractInstanceWithDepositLibraryABI =
              await ethers.getContractAt(
                "DepositLogic",
                await lendingPool.getAddress(),
                owner
              );

            await expect(depositTx)
              .to.emit(contractInstanceWithDepositLibraryABI, "Deposit")
              .withArgs(
                await usdc.getAddress(),
                depositor.address,
                depositor.address,
                depositAmount
              );
          });

          it("Should emit correct events for liquidity deposit", async function () {
            //First time an address deposits a reserve, it's marked as collateral. After that, it's just a liquidity deposit

            // First deploy protocol, create and initialize the reserve
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              yieldBoostStakingUSDC,
              usdc,
              owner,
              depositor,
            } = await loadFixture(setUpTestFixture);

            // Set up Deposit. factor = 2 because deposit and approval amount is higher than depsit amount due to multiple deposits
            const depositAmount = await allocateAndApproveTokens(
              usdc,
              owner,
              depositor,
              lendingPool,
              1000n,
              2n
            );

            // Get reserve data before deposit
            const reserveDataBeforeDeposit: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Instantiate mUSDC contract
            const mUSDC = await ethers.getContractAt(
              "MToken",
              reserveDataBeforeDeposit.mTokenAddress
            );

            // First Deposit - collateral enabled
            await lendingPool
              .connect(depositor)
              .deposit(
                await usdc.getAddress(),
                depositAmount,
                depositor.address,
                true,
                0
              );

            // Second Deposit - liquidity deposit
            const depositTx = await lendingPool
              .connect(depositor)
              .deposit(
                await usdc.getAddress(),
                depositAmount,
                depositor.address,
                true,
                0
              );

            // Hardhat time module. Gets timestamp of latest block.
            const blockTimestamp = await time.latest();

            // Calculate expected reserve data after deposit
            const expectedReserveDataAfterDeposit =
              calcExpectedReserveDataAfterDeposit(
                depositAmount,
                reserveDataBeforeDeposit,
                BigInt(blockTimestamp)
              );

            // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
            const contractInstanceWithLibraryABI = await ethers.getContractAt(
              "ReserveLogic",
              await lendingPool.getAddress(),
              owner
            );

            await expect(depositTx)
              .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
              .withArgs(
                await usdc.getAddress(),
                expectedReserveDataAfterDeposit.liquidityRate,
                expectedReserveDataAfterDeposit.stableBorrowRate,
                expectedReserveDataAfterDeposit.variableBorrowRate,
                expectedReserveDataAfterDeposit.liquidityIndex,
                expectedReserveDataAfterDeposit.variableBorrowIndex
              );

            // The amount is subtracted from the currentAllowance, so in this case the amount should be set to 0 just before the transfer
            await expect(depositTx)
              .to.emit(usdc, "Approval")
              .withArgs(depositor.address, await lendingPool.getAddress(), 0);

            await expect(depositTx)
              .to.emit(usdc, "Transfer")
              .withArgs(
                depositor.address,
                reserveDataBeforeDeposit.mTokenAddress,
                depositAmount
              );

            await expect(depositTx)
              .to.emit(mUSDC, "Transfer")
              .withArgs(ZeroAddress, depositor.address, depositAmount);

            await expect(depositTx)
              .to.emit(mUSDC, "Mint")
              .withArgs(
                depositor.address,
                depositAmount,
                expectedReserveDataAfterDeposit.liquidityIndex
              );

            // This event should NOT be emitted for second deposit of asset by the same address
            await expect(depositTx).to.not.emit(
              lendingPool,
              "ReserveUsedAsCollateralEnabled"
            );

            // Regular user, so should emit StakePositionUpdated, RefreshYieldBoostAmount events but not LockMeldBankerNFT or StakePositionCreated
            await expect(depositTx).to.not.emit(
              yieldBoostStakingUSDC,
              "StakePositionCreated"
            );
            await expect(depositTx)
              .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
              .withArgs(depositor.address, depositAmount, depositAmount * 2n);

            await expect(depositTx).to.not.emit(
              lendingPool,
              "LockMeldBankerNFT"
            );

            await expect(depositTx)
              .to.emit(lendingPool, "RefreshYieldBoostAmount")
              .withArgs(
                await usdc.getAddress(),
                depositor.address,
                depositAmount * 2n
              );

            // The Deposit event is emitted by the DepositLogic.sol library, so we need to get the contract instance with the DepositLogic ABI
            const contractInstanceWithDepositLibraryABI =
              await ethers.getContractAt(
                "DepositLogic",
                await lendingPool.getAddress(),
                owner
              );

            await expect(depositTx)
              .to.emit(contractInstanceWithDepositLibraryABI, "Deposit")
              .withArgs(
                await usdc.getAddress(),
                depositor.address,
                depositor.address,
                depositAmount
              );
          });

          it("Should emit the correct events when a regular user deposits a token that does not support yield boost", async function () {
            //First time an address deposits a reserve, it's marked as collateral

            // First deploy protocol, create and initialize the reserve
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              meld,
              owner,
              depositor,
            } = await loadFixture(setUpTestFixture);

            // Set up Deposit. factor = 0 because deposit and approval amount are same
            const depositAmount = await allocateAndApproveTokens(
              meld,
              owner,
              depositor,
              lendingPool,
              1000n,
              0n
            );

            // Get reserve data before deposit
            const reserveDataBeforeDeposit: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await meld.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Instantiate mMELD contract
            const mMELD = await ethers.getContractAt(
              "MToken",
              reserveDataBeforeDeposit.mTokenAddress
            );

            // Deposit
            const depositTx = await lendingPool
              .connect(depositor)
              .deposit(
                await meld.getAddress(),
                depositAmount,
                depositor.address,
                true,
                0
              );

            // Hardhat time module. Gets timestamp of latest block.
            const blockTimestamp = await time.latest();

            // Calculate expected reserve data after deposit
            const expectedReserveDataAfterDeposit =
              calcExpectedReserveDataAfterDeposit(
                depositAmount,
                reserveDataBeforeDeposit,
                BigInt(blockTimestamp)
              );

            // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
            const contractInstanceWithLibraryABI = await ethers.getContractAt(
              "ReserveLogic",
              await lendingPool.getAddress(),
              owner
            );

            await expect(depositTx)
              .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
              .withArgs(
                await meld.getAddress(),
                expectedReserveDataAfterDeposit.liquidityRate,
                expectedReserveDataAfterDeposit.stableBorrowRate,
                expectedReserveDataAfterDeposit.variableBorrowRate,
                expectedReserveDataAfterDeposit.liquidityIndex,
                expectedReserveDataAfterDeposit.variableBorrowIndex
              );

            // The amount is subtracted from the currentAllowance, so in this case the amount should be set to 0 just before the transfer
            await expect(depositTx)
              .to.emit(meld, "Approval")
              .withArgs(depositor.address, await lendingPool.getAddress(), 0);

            await expect(depositTx)
              .to.emit(meld, "Transfer")
              .withArgs(
                depositor.address,
                reserveDataBeforeDeposit.mTokenAddress,
                depositAmount
              );

            await expect(depositTx)
              .to.emit(mMELD, "Transfer")
              .withArgs(ZeroAddress, depositor.address, depositAmount);

            await expect(depositTx)
              .to.emit(mMELD, "Mint")
              .withArgs(
                depositor.address,
                depositAmount,
                expectedReserveDataAfterDeposit.liquidityIndex
              );

            await expect(depositTx)
              .to.emit(lendingPool, "ReserveUsedAsCollateralEnabled")
              .withArgs(await meld.getAddress(), depositor.address);

            // Reserve does not have yield boost enabled, so should not emit StakePositionCreated, StakePositionUpdated, RefreshYieldBoostAmount, or LockMeldBankerNFT events,
            // but we can't test for absence of StakePositionCreated or StakePositionCreated because there is no staking contract for MELD to check against
            await expect(depositTx).to.not.emit(
              lendingPool,
              "LockMeldBankerNFT"
            );

            await expect(depositTx).to.not.emit(
              lendingPool,
              "RefreshYieldBoostAmount"
            );

            // The Deposit event is emitted by the DepositLogic.sol library, so we need to get the contract instance with the DepositLogic ABI
            const contractInstanceWithDepositLibraryABI =
              await ethers.getContractAt(
                "DepositLogic",
                await lendingPool.getAddress(),
                owner
              );

            await expect(depositTx)
              .to.emit(contractInstanceWithDepositLibraryABI, "Deposit")
              .withArgs(
                await meld.getAddress(),
                depositor.address,
                depositor.address,
                depositAmount
              );
          });

          it("Should mint correct amount of mTokens to onBehalfOf address when same as depositor address", async function () {
            // First deploy protocol, create and initialize the reserve
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              usdc,
              owner,
              depositor,
            } = await loadFixture(setUpTestFixture);

            // Set up Deposit. factor = 0 because deposit and approval amount are same
            const depositAmount = await allocateAndApproveTokens(
              usdc,
              owner,
              depositor,
              lendingPool,
              1000n,
              0n
            );

            // Get reserve data before deposit
            const reserveDataBeforeDeposit: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Instantiate mUSDC contract
            const mUSDC = await ethers.getContractAt(
              "MToken",
              reserveDataBeforeDeposit.mTokenAddress
            );

            // Deposit
            await lendingPool
              .connect(depositor)
              .deposit(
                await usdc.getAddress(),
                depositAmount,
                depositor.address,
                true,
                0
              );

            expect(await mUSDC.balanceOf(depositor.address)).to.equal(
              depositAmount
            );
          });

          it("Should mint correct amount of mTokens to onBehalfOf address when different from depositor address", async function () {
            // First deploy protocol, create and initialize the reserve
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              usdc,
              owner,
              depositor,
              thirdParty,
            } = await loadFixture(setUpTestFixture);

            // Set up Deposit. factor = 0 because deposit and approval amount are same
            const depositAmount = await allocateAndApproveTokens(
              usdc,
              owner,
              depositor,
              lendingPool,
              1000n,
              0n
            );

            // Get reserve data before deposit
            const reserveDataBeforeDeposit: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Instantiate mUSDC contract
            const mUSDC = await ethers.getContractAt(
              "MToken",
              reserveDataBeforeDeposit.mTokenAddress
            );

            // Deposit
            await lendingPool
              .connect(depositor)
              .deposit(
                await usdc.getAddress(),
                depositAmount,
                thirdParty.address,
                true,
                0
              );

            expect(await mUSDC.balanceOf(thirdParty.address)).to.equal(
              depositAmount
            );
          });

          it("Should mint correct amount of mTokens when liquidity index > 1", async function () {
            // First deploy protocol, create and initialize the reserve
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              usdc,
              owner,
              depositor,
              borrower,
            } = await loadFixture(setUpForBorrowTestFixture);

            // In order for liquidity index to be > 1, there must be funds borrowed (and paying interest).
            // Deposit of USDC by depositor for liquidity and MELD by borrower for collateral
            // has already been done in setUpForBorrowTestFixture

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
            await time.increase(ONE_YEAR / 2);

            // Set up second deposit. factor = 0 because deposit and approval amount are same
            const depositAmount2 = await allocateAndApproveTokens(
              usdc,
              owner,
              depositor,
              lendingPool,
              500n,
              0n
            );

            // Second Deposit
            const depositTx = await lendingPool
              .connect(depositor)
              .deposit(
                await usdc.getAddress(),
                depositAmount2,
                depositor.address,
                true,
                0
              );

            // Get USDC reserve data after deposit 2
            const reserveDataAfterDeposit2: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Get user USDC data after deposit 2
            const userDataAfterDeposit2: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              depositor.address
            );

            // Instantiate mUSDC contract
            const mUSDC = await ethers.getContractAt(
              "MToken",
              reserveDataAfterDeposit2.mTokenAddress
            );

            const blockTimestamps: BlockTimestamps =
              await getBlockTimestamps(depositTx);

            const expectedMTokenBalance = calcExpectedMTokenBalance(
              reserveDataAfterDeposit2,
              userDataAfterDeposit2,
              blockTimestamps.latestBlockTimestamp
            );

            expect(await mUSDC.balanceOf(depositor.address)).to.equal(
              expectedMTokenBalance
            );
          });

          it("Should transfer correct amount of asset tokens to mToken address", async function () {
            // First deploy protocol, create and initialize the reserve
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              usdc,
              owner,
              depositor,
              thirdParty,
            } = await loadFixture(setUpTestFixture);

            // Set up Deposit. factor = 0 because deposit and approval amount are same
            const depositAmount = await allocateAndApproveTokens(
              usdc,
              owner,
              depositor,
              lendingPool,
              1000n,
              0n
            );

            // Get reserve data before deposit
            const reserveDataBeforeDeposit: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Instantiate mUSDC contract
            const mUSDC = await ethers.getContractAt(
              "MToken",
              reserveDataBeforeDeposit.mTokenAddress
            );

            // Deposit
            await lendingPool
              .connect(depositor)
              .deposit(
                await usdc.getAddress(),
                depositAmount,
                thirdParty.address,
                true,
                0
              );

            expect(await usdc.balanceOf(await mUSDC.getAddress())).to.equal(
              depositAmount
            );
          });

          it("Should update state correctly for collateral deposit", async function () {
            //First time an address deposits a reserve, it's marked as collateral. After that, it's just a liquidity deposit.

            // First deploy protocol, create and initialize the reserve
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              yieldBoostStorageUSDC,
              usdc,
              owner,
              depositor,
            } = await loadFixture(setUpTestFixture);

            const tokenId = 0n;

            // Set up Deposit. factor = 2 because deposit and approval amount are different
            const depositAmount = await allocateAndApproveTokens(
              usdc,
              owner,
              depositor,
              lendingPool,
              1000n,
              2n
            );

            // Get reserve data before deposit
            const reserveDataBeforeDeposit: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Get user data before deposit
            const userDataBeforeDeposit: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              depositor.address
            );

            // First Deposit
            await lendingPool
              .connect(depositor)
              .deposit(
                await usdc.getAddress(),
                depositAmount,
                depositor.address,
                true,
                tokenId
              );

            // Hardhat time module. Gets timestamp of latest block.
            const blockTimestamp = await time.latest();

            // Calculate expected reserve data after deposit
            const expectedReserveDataAfterDeposit: ReserveData =
              calcExpectedReserveDataAfterDeposit(
                depositAmount,
                reserveDataBeforeDeposit,
                BigInt(blockTimestamp)
              );

            // Get reserve data after deposit
            const reserveDataAfterDeposit: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Calculate expected user data after deposit
            const expectedUserDataAfterDeposit: UserReserveData =
              calcExpectedUserDataAfterDeposit(
                depositAmount,
                reserveDataBeforeDeposit,
                reserveDataAfterDeposit,
                userDataBeforeDeposit,
                BigInt(blockTimestamp)
              );

            // Get user data after deposit
            const userDataAfterDeposit: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              depositor.address
            );

            expectEqual(
              reserveDataAfterDeposit,
              expectedReserveDataAfterDeposit
            );
            expectEqual(userDataAfterDeposit, expectedUserDataAfterDeposit);
            expect(await lendingPool.isUsingMeldBanker(depositor.address)).to.be
              .false;
            expect(await lendingPool.isMeldBankerBlocked(tokenId)).to.be.false;

            const meldBankerData = await lendingPool.userMeldBankerData(
              depositor.address
            );
            expect(meldBankerData.tokenId).to.equal(0);
            expect(meldBankerData.asset).to.equal(ZeroAddress);
            expect(meldBankerData.meldBankerType).to.equal(MeldBankerType.NONE);
            expect(meldBankerData.action).to.equal(Action.NONE);
            expect(
              await yieldBoostStorageUSDC.getStakerStakedAmount(
                depositor.address
              )
            ).to.equal(depositAmount);
          });

          it("Should update state correctly for liquidity deposit", async function () {
            //First time an address deposits a reserve, it's marked as collateral. After that, it's just a liquidity deposit.

            // First deploy protocol, create and initialize the reserve
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              yieldBoostStorageUSDC,
              usdc,
              owner,
              depositor,
            } = await loadFixture(setUpTestFixture);

            const tokenId = 0n;

            // Set up Deposit. factor = 2 because deposit and approval amount are different
            const depositAmount = await allocateAndApproveTokens(
              usdc,
              owner,
              depositor,
              lendingPool,
              1000n,
              2n
            );

            // First Deposit - collateral enabled
            await lendingPool
              .connect(depositor)
              .deposit(
                await usdc.getAddress(),
                depositAmount,
                depositor.address,
                true,
                tokenId
              );

            // Add time between deposits
            await time.increase(ONE_YEAR);

            // Get reserve data before second deposit
            const reserveDataBeforeDeposit: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Get user data before second deposit
            const userDataBeforeDeposit: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              depositor.address
            );

            // Second Deposit - liquidity deposit
            await lendingPool
              .connect(depositor)
              .deposit(
                await usdc.getAddress(),
                depositAmount,
                depositor.address,
                true,
                0
              );

            // Hardhat time module. Gets timestamp of latest block.
            const blockTimestamp = await time.latest();

            // Calculate expected reserve data after second deposit
            const expectedReserveDataAfterDeposit: ReserveData =
              calcExpectedReserveDataAfterDeposit(
                depositAmount,
                reserveDataBeforeDeposit,
                BigInt(blockTimestamp)
              );

            // Get reserve data after second deposit
            const reserveDataAfterDeposit: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Calculate expected user data after deposit
            const expectedUserDataAfterDeposit: UserReserveData =
              calcExpectedUserDataAfterDeposit(
                depositAmount,
                reserveDataBeforeDeposit,
                reserveDataAfterDeposit,
                userDataBeforeDeposit,
                BigInt(blockTimestamp)
              );

            // Get user data after deposit
            const userDataAfterDeposit: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              depositor.address
            );

            expectEqual(
              reserveDataAfterDeposit,
              expectedReserveDataAfterDeposit
            );
            expectEqual(userDataAfterDeposit, expectedUserDataAfterDeposit);
            expect(await lendingPool.isUsingMeldBanker(depositor.address)).to.be
              .false;
            expect(await lendingPool.isMeldBankerBlocked(tokenId)).to.be.false;

            const meldBankerData = await lendingPool.userMeldBankerData(
              depositor.address
            );
            expect(meldBankerData.tokenId).to.equal(0);
            expect(meldBankerData.asset).to.equal(ZeroAddress);
            expect(meldBankerData.meldBankerType).to.equal(MeldBankerType.NONE);
            expect(meldBankerData.action).to.equal(Action.NONE);
            expect(
              await yieldBoostStorageUSDC.getStakerStakedAmount(
                depositor.address
              )
            ).to.equal(depositAmount * 2n);
          });

          it("Should not allow regular user to get yield boost if yield boost has been disabled for a yield boost token", async function () {
            //First time an address deposits a reserve, it's marked as collateral. After that, it's just a liquidity deposit.

            // First deploy protocol, create and initialize the reserve
            const {
              lendingPool,
              lendingPoolConfigurator,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              yieldBoostStorageUSDC,
              usdc,
              owner,
              depositor,
              poolAdmin,
            } = await loadFixture(setUpTestFixture);

            // Disable yield boost for USDC
            await lendingPoolConfigurator
              .connect(poolAdmin)
              .setYieldBoostStakingAddress(
                await usdc.getAddress(),
                ZeroAddress
              );

            const tokenId = 0n;

            // Set up Deposit. factor = 2 because deposit and approval amount are different
            const depositAmount = await allocateAndApproveTokens(
              usdc,
              owner,
              depositor,
              lendingPool,
              1000n,
              2n
            );

            // Get reserve data before deposit
            const reserveDataBeforeDeposit: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Get user data before deposit
            const userDataBeforeDeposit: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              depositor.address
            );

            // Deposit
            const depositTx = await lendingPool
              .connect(depositor)
              .deposit(
                await usdc.getAddress(),
                depositAmount,
                depositor.address,
                true,
                tokenId
              );

            // Hardhat time module. Gets timestamp of latest block.
            const blockTimestamp = await time.latest();

            // Calculate expected reserve data after deposit
            const expectedReserveDataAfterDeposit: ReserveData =
              calcExpectedReserveDataAfterDeposit(
                depositAmount,
                reserveDataBeforeDeposit,
                BigInt(blockTimestamp)
              );

            // Get reserve data after deposit
            const reserveDataAfterDeposit: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Calculate expected user data after deposit
            const expectedUserDataAfterDeposit: UserReserveData =
              calcExpectedUserDataAfterDeposit(
                depositAmount,
                reserveDataBeforeDeposit,
                reserveDataAfterDeposit,
                userDataBeforeDeposit,
                BigInt(blockTimestamp)
              );

            // Get user data after deposit
            const userDataAfterDeposit: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              depositor.address
            );

            expectEqual(
              reserveDataAfterDeposit,
              expectedReserveDataAfterDeposit
            );
            expectEqual(userDataAfterDeposit, expectedUserDataAfterDeposit);
            expect(await lendingPool.isUsingMeldBanker(depositor.address)).to.be
              .false;
            expect(await lendingPool.isMeldBankerBlocked(tokenId)).to.be.false;

            const meldBankerData = await lendingPool.userMeldBankerData(
              depositor.address
            );
            expect(meldBankerData.tokenId).to.equal(0);
            expect(meldBankerData.asset).to.equal(ZeroAddress);
            expect(meldBankerData.meldBankerType).to.equal(MeldBankerType.NONE);
            expect(meldBankerData.action).to.equal(Action.NONE);
            expect(
              await yieldBoostStorageUSDC.getStakerStakedAmount(
                depositor.address
              )
            ).to.equal(0n);

            // RefreshYieldBoostAmount event should not have been emitted
            await expect(depositTx).to.not.emit(
              lendingPool,
              "RefreshYieldBoostAmount"
            );
          });

          it("Should emit correct events when depositor deposits whole asset balance (MaxUint256) for self", async function () {
            //First time an address deposits a reserve, it's marked as collateral

            // First deploy protocol, create and initialize the reserve
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              yieldBoostStakingUSDC,
              usdc,
              owner,
              depositor,
            } = await loadFixture(setUpTestFixture);

            // Allocate USDC to depositor and approve LendingPool
            await allocateAndApproveTokens(
              usdc,
              owner,
              depositor,
              lendingPool,
              5000n,
              2n
            );

            const depositorUSDCBalance = await usdc.balanceOf(
              depositor.address
            );

            // Get reserve data before deposit
            const reserveDataBeforeDeposit: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Instantiate mUSDC contract
            const mUSDC = await ethers.getContractAt(
              "MToken",
              reserveDataBeforeDeposit.mTokenAddress
            );

            // Deposit
            const depositTx = await lendingPool
              .connect(depositor)
              .deposit(
                await usdc.getAddress(),
                MaxUint256,
                depositor.address,
                true,
                0
              );

            // Hardhat time module. Gets timestamp of latest block.
            const blockTimestamp = await time.latest();

            // Calculate expected reserve data after deposit
            const expectedReserveDataAfterDeposit =
              calcExpectedReserveDataAfterDeposit(
                depositorUSDCBalance,
                reserveDataBeforeDeposit,
                BigInt(blockTimestamp)
              );

            // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
            const contractInstanceWithLibraryABI = await ethers.getContractAt(
              "ReserveLogic",
              await lendingPool.getAddress(),
              owner
            );

            await expect(depositTx)
              .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
              .withArgs(
                await usdc.getAddress(),
                expectedReserveDataAfterDeposit.liquidityRate,
                expectedReserveDataAfterDeposit.stableBorrowRate,
                expectedReserveDataAfterDeposit.variableBorrowRate,
                expectedReserveDataAfterDeposit.liquidityIndex,
                expectedReserveDataAfterDeposit.variableBorrowIndex
              );

            // The amount is subtracted from the currentAllowance, so in this case the amount should be set to 0 just before the transfer
            await expect(depositTx)
              .to.emit(usdc, "Approval")
              .withArgs(depositor.address, await lendingPool.getAddress(), 0);

            await expect(depositTx)
              .to.emit(usdc, "Transfer")
              .withArgs(
                depositor.address,
                reserveDataBeforeDeposit.mTokenAddress,
                depositorUSDCBalance
              );

            await expect(depositTx)
              .to.emit(mUSDC, "Transfer")
              .withArgs(ZeroAddress, depositor.address, depositorUSDCBalance);

            await expect(depositTx)
              .to.emit(mUSDC, "Mint")
              .withArgs(
                depositor.address,
                depositorUSDCBalance,
                expectedReserveDataAfterDeposit.liquidityIndex
              );

            await expect(depositTx)
              .to.emit(lendingPool, "ReserveUsedAsCollateralEnabled")
              .withArgs(await usdc.getAddress(), depositor.address);

            // Regular user, so should emit StakePositionCreated, StakePositionUpdated, RefreshYieldBoostAmount events but not LockMeldBankerNFT
            await expect(depositTx)
              .to.emit(yieldBoostStakingUSDC, "StakePositionCreated")
              .withArgs(depositor.address, depositorUSDCBalance);

            await expect(depositTx)
              .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
              .withArgs(depositor.address, 0, depositorUSDCBalance);

            await expect(depositTx).to.not.emit(
              lendingPool,
              "LockMeldBankerNFT"
            );

            await expect(depositTx)
              .to.emit(lendingPool, "RefreshYieldBoostAmount")
              .withArgs(
                await usdc.getAddress(),
                depositor.address,
                depositorUSDCBalance
              );

            // The Deposit event is emitted by the DepositLogic.sol library, so we need to get the contract instance with the DepositLogic ABI
            const contractInstanceWithDepositLibraryABI =
              await ethers.getContractAt(
                "DepositLogic",
                await lendingPool.getAddress(),
                owner
              );

            await expect(depositTx)
              .to.emit(contractInstanceWithDepositLibraryABI, "Deposit")
              .withArgs(
                await usdc.getAddress(),
                depositor.address,
                depositor.address,
                depositorUSDCBalance
              );
          });

          it("Should emit correct events when depositor deposits whole asset balance (MaxUint256) on behalf of another address", async function () {
            //First time an address deposits a reserve, it's marked as collateral

            // First deploy protocol, create and initialize the reserve
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              yieldBoostStakingUSDC,
              usdc,
              owner,
              depositor,
              thirdParty,
            } = await loadFixture(setUpTestFixture);

            // Allocate USDC to depositor and approve LendingPool
            await allocateAndApproveTokens(
              usdc,
              owner,
              depositor,
              lendingPool,
              5000n,
              2n
            );

            const depositorUSDCBalance = await usdc.balanceOf(
              depositor.address
            );

            // Get reserve data before deposit
            const reserveDataBeforeDeposit: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Instantiate mUSDC contract
            const mUSDC = await ethers.getContractAt(
              "MToken",
              reserveDataBeforeDeposit.mTokenAddress
            );

            // Deposit
            const depositTx = await lendingPool
              .connect(depositor)
              .deposit(
                await usdc.getAddress(),
                MaxUint256,
                thirdParty.address,
                true,
                0
              );

            // Hardhat time module. Gets timestamp of latest block.
            const blockTimestamp = await time.latest();

            // Calculate expected reserve data after deposit
            const expectedReserveDataAfterDeposit =
              calcExpectedReserveDataAfterDeposit(
                depositorUSDCBalance,
                reserveDataBeforeDeposit,
                BigInt(blockTimestamp)
              );

            // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
            const contractInstanceWithLibraryABI = await ethers.getContractAt(
              "ReserveLogic",
              await lendingPool.getAddress(),
              owner
            );

            await expect(depositTx)
              .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
              .withArgs(
                await usdc.getAddress(),
                expectedReserveDataAfterDeposit.liquidityRate,
                expectedReserveDataAfterDeposit.stableBorrowRate,
                expectedReserveDataAfterDeposit.variableBorrowRate,
                expectedReserveDataAfterDeposit.liquidityIndex,
                expectedReserveDataAfterDeposit.variableBorrowIndex
              );

            // The amount is subtracted from the currentAllowance, so in this case the amount should be set to 0 just before the transfer
            await expect(depositTx)
              .to.emit(usdc, "Approval")
              .withArgs(depositor.address, await lendingPool.getAddress(), 0);

            await expect(depositTx)
              .to.emit(usdc, "Transfer")
              .withArgs(
                depositor.address,
                reserveDataBeforeDeposit.mTokenAddress,
                depositorUSDCBalance
              );

            await expect(depositTx)
              .to.emit(mUSDC, "Transfer")
              .withArgs(ZeroAddress, thirdParty.address, depositorUSDCBalance);

            await expect(depositTx)
              .to.emit(mUSDC, "Mint")
              .withArgs(
                thirdParty.address,
                depositorUSDCBalance,
                expectedReserveDataAfterDeposit.liquidityIndex
              );

            await expect(depositTx)
              .to.emit(lendingPool, "ReserveUsedAsCollateralEnabled")
              .withArgs(await usdc.getAddress(), thirdParty.address);

            // Regular user, so should emit StakePositionCreated, StakePositionUpdated, RefreshYieldBoostAmount events but not LockMeldBankerNFT
            await expect(depositTx)
              .to.emit(yieldBoostStakingUSDC, "StakePositionCreated")
              .withArgs(thirdParty.address, depositorUSDCBalance);

            await expect(depositTx)
              .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
              .withArgs(thirdParty.address, 0, depositorUSDCBalance);

            await expect(depositTx).to.not.emit(
              lendingPool,
              "LockMeldBankerNFT"
            );

            await expect(depositTx)
              .to.emit(lendingPool, "RefreshYieldBoostAmount")
              .withArgs(
                await usdc.getAddress(),
                thirdParty.address,
                depositorUSDCBalance
              );

            // The Deposit event is emitted by the DepositLogic.sol library, so we need to get the contract instance with the DepositLogic ABI
            const contractInstanceWithDepositLibraryABI =
              await ethers.getContractAt(
                "DepositLogic",
                await lendingPool.getAddress(),
                owner
              );

            await expect(depositTx)
              .to.emit(contractInstanceWithDepositLibraryABI, "Deposit")
              .withArgs(
                await usdc.getAddress(),
                depositor.address,
                thirdParty.address,
                depositorUSDCBalance
              );
          });

          it("Should mint correct amount of mTokens when depositor deposits whole asset balance (MaxUint256)", async function () {
            // First deploy protocol, create and initialize the reserve
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              usdc,
              owner,
              depositor,
            } = await loadFixture(setUpTestFixture);

            // Set up Deposit. factor = 0 because deposit and approval amount are same
            await allocateAndApproveTokens(
              usdc,
              owner,
              depositor,
              lendingPool,
              1000n,
              0n
            );

            const depositorUSDCBalance = await usdc.balanceOf(
              depositor.address
            );

            // Get reserve data before deposit
            const reserveDataBeforeDeposit: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Instantiate mUSDC contract
            const mUSDC = await ethers.getContractAt(
              "MToken",
              reserveDataBeforeDeposit.mTokenAddress
            );

            // Deposit
            await lendingPool
              .connect(depositor)
              .deposit(
                await usdc.getAddress(),
                MaxUint256,
                depositor.address,
                true,
                0
              );

            expect(await mUSDC.balanceOf(depositor.address)).to.equal(
              depositorUSDCBalance
            );
          });

          it("Should update state correctly when depositor deposits whole asset balance (MaxUint256)", async function () {
            // First deploy protocol, create and initialize the reserve
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              yieldBoostStorageUSDC,
              usdc,
              owner,
              depositor,
            } = await loadFixture(setUpTestFixture);

            const tokenId = 0n;

            // Set up Deposit.
            await allocateAndApproveTokens(
              usdc,
              owner,
              depositor,
              lendingPool,
              1000n,
              2n
            );

            const depositorUSDCBalance = await usdc.balanceOf(
              depositor.address
            );

            // Get reserve data before deposit
            const reserveDataBeforeDeposit: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Get user data before deposit
            const userDataBeforeDeposit: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              depositor.address
            );

            // First Deposit
            await lendingPool
              .connect(depositor)
              .deposit(
                await usdc.getAddress(),
                MaxUint256,
                depositor.address,
                true,
                tokenId
              );

            // Hardhat time module. Gets timestamp of latest block.
            const blockTimestamp = await time.latest();

            // Calculate expected reserve data after deposit
            const expectedReserveDataAfterDeposit: ReserveData =
              calcExpectedReserveDataAfterDeposit(
                depositorUSDCBalance,
                reserveDataBeforeDeposit,
                BigInt(blockTimestamp)
              );

            // Get reserve data after deposit
            const reserveDataAfterDeposit: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Calculate expected user data after deposit
            const expectedUserDataAfterDeposit: UserReserveData =
              calcExpectedUserDataAfterDeposit(
                depositorUSDCBalance,
                reserveDataBeforeDeposit,
                reserveDataAfterDeposit,
                userDataBeforeDeposit,
                BigInt(blockTimestamp)
              );

            // Get user data after deposit
            const userDataAfterDeposit: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              depositor.address
            );

            expectEqual(
              reserveDataAfterDeposit,
              expectedReserveDataAfterDeposit
            );
            expectEqual(userDataAfterDeposit, expectedUserDataAfterDeposit);
            expect(await lendingPool.isUsingMeldBanker(depositor.address)).to.be
              .false;
            expect(await lendingPool.isMeldBankerBlocked(tokenId)).to.be.false;

            const meldBankerData = await lendingPool.userMeldBankerData(
              depositor.address
            );
            expect(meldBankerData.tokenId).to.equal(0);
            expect(meldBankerData.asset).to.equal(ZeroAddress);
            expect(meldBankerData.meldBankerType).to.equal(MeldBankerType.NONE);
            expect(meldBankerData.action).to.equal(Action.NONE);
            expect(
              await yieldBoostStorageUSDC.getStakerStakedAmount(
                depositor.address
              )
            ).to.equal(depositorUSDCBalance);
          });

          it("Should return correct value when making a static call", async function () {
            //First time an address deposits a reserve, it's marked as collateral. After that, it's just a liquidity deposit.

            // First deploy protocol, create and initialize the reserve
            const { lendingPool, usdc, owner, depositor } =
              await loadFixture(setUpTestFixture);

            const tokenId = 0n;

            // Set up Deposit. factor = 2 because deposit and approval amount are different
            const depositAmount = await allocateAndApproveTokens(
              usdc,
              owner,
              depositor,
              lendingPool,
              1000n,
              2n
            );

            const returnedDepositedAmount = await lendingPool
              .connect(depositor)
              .deposit.staticCall(
                await usdc.getAddress(),
                depositAmount,
                depositor.address,
                true,
                tokenId
              );

            expect(returnedDepositedAmount).to.equal(depositAmount);

            const estimatedGas = await lendingPool
              .connect(depositor)
              .deposit.staticCall(
                await usdc.getAddress(),
                depositAmount,
                depositor.address,
                true,
                tokenId
              );

            expect(estimatedGas).to.be.gt(0);
          });
        }
      ); // End Single deposits and multiple deposits of same asset by same depositor Context

      context(
        "Multiple deposits of different assets by same depositor",
        async function () {
          it("Should emit correct events for each deposit", async function () {
            // First deploy protocol, create and initialize the reserve
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              yieldBoostStakingUSDC,
              usdc,
              meld,
              owner,
              depositor,
            } = await loadFixture(setUpTestFixture);

            // Set up USDC Deposit. factor = 2 because deposit and approval amount are different
            const depositAmount = await allocateAndApproveTokens(
              usdc,
              owner,
              depositor,
              lendingPool,
              1000n,
              2n
            );

            // Get USDC reserve data before first deposit
            const reserveUSDCDataBeforeDeposit: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await usdc.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Instantiate mUSDC contract
            const mUSDC = await ethers.getContractAt(
              "MToken",
              reserveUSDCDataBeforeDeposit.mTokenAddress
            );

            // First Deposit - USDC
            const depositTxUSDC = await lendingPool
              .connect(depositor)
              .deposit(
                await usdc.getAddress(),
                depositAmount,
                depositor.address,
                true,
                0
              );

            // Hardhat time module. Gets timestamp of latest block.
            const blockTimestampUSDC = await time.latest();

            // Calculate expected USDC reserve data after first deposit
            const expectedReserveUSDCDataAfterDeposit: ReserveData =
              calcExpectedReserveDataAfterDeposit(
                depositAmount,
                reserveUSDCDataBeforeDeposit,
                BigInt(blockTimestampUSDC)
              );

            // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
            const contractInstanceWithLibraryABI = await ethers.getContractAt(
              "ReserveLogic",
              await lendingPool.getAddress(),
              owner
            );

            await expect(depositTxUSDC)
              .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
              .withArgs(
                await usdc.getAddress(),
                expectedReserveUSDCDataAfterDeposit.liquidityRate,
                expectedReserveUSDCDataAfterDeposit.stableBorrowRate,
                expectedReserveUSDCDataAfterDeposit.variableBorrowRate,
                expectedReserveUSDCDataAfterDeposit.liquidityIndex,
                expectedReserveUSDCDataAfterDeposit.variableBorrowIndex
              );

            // Originally approved depositAmount x 2, so depositAmount should be new allowance
            await expect(depositTxUSDC)
              .to.emit(usdc, "Approval")
              .withArgs(
                depositor.address,
                await lendingPool.getAddress(),
                depositAmount
              );

            await expect(depositTxUSDC)
              .to.emit(usdc, "Transfer")
              .withArgs(
                depositor.address,
                reserveUSDCDataBeforeDeposit.mTokenAddress,
                depositAmount
              );

            await expect(depositTxUSDC)
              .to.emit(mUSDC, "Transfer")
              .withArgs(ZeroAddress, depositor.address, depositAmount);

            await expect(depositTxUSDC)
              .to.emit(mUSDC, "Mint")
              .withArgs(
                depositor.address,
                depositAmount,
                expectedReserveUSDCDataAfterDeposit.liquidityIndex
              );

            await expect(depositTxUSDC)
              .to.emit(lendingPool, "ReserveUsedAsCollateralEnabled")
              .withArgs(await usdc.getAddress(), depositor.address);

            // Regular user, so should emit StakePositionCreated, StakePositionUpdated, RefreshYieldBoostAmount events but not LockMeldBankerNFT
            await expect(depositTxUSDC)
              .to.emit(yieldBoostStakingUSDC, "StakePositionCreated")
              .withArgs(depositor.address, depositAmount);

            await expect(depositTxUSDC)
              .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
              .withArgs(depositor.address, 0, depositAmount);

            await expect(depositTxUSDC).to.not.emit(
              lendingPool,
              "LockMeldBankerNFT"
            );

            await expect(depositTxUSDC)
              .to.emit(lendingPool, "RefreshYieldBoostAmount")
              .withArgs(
                await usdc.getAddress(),
                depositor.address,
                depositAmount
              );

            // The Deposit event is emitted by the DepositLogic.sol library, so we need to get the contract instance with the DepositLogic ABI
            const contractInstanceWithDepositLibraryABI =
              await ethers.getContractAt(
                "DepositLogic",
                await lendingPool.getAddress(),
                owner
              );

            await expect(depositTxUSDC)
              .to.emit(contractInstanceWithDepositLibraryABI, "Deposit")
              .withArgs(
                await usdc.getAddress(),
                depositor.address,
                depositor.address,
                depositAmount
              );

            // Set up MELD Deposit. factor = 2 because deposit and approval amount are different
            const depositAmountMELD = await allocateAndApproveTokens(
              meld,
              owner,
              depositor,
              lendingPool,
              500n,
              2n
            );

            // Get MELD reserve data before second deposit
            const reserveMELDDataBeforeDeposit: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Instantiate mMELD contract
            const mMELD = await ethers.getContractAt(
              "MToken",
              reserveMELDDataBeforeDeposit.mTokenAddress
            );

            // Second Deposit - MELD
            const depositTXMELD = await lendingPool
              .connect(depositor)
              .deposit(
                await meld.getAddress(),
                depositAmountMELD,
                depositor.address,
                true,
                0
              );

            // Hardhat time module. Gets timestamp of latest block.
            const blockTimestampMELD = await time.latest();

            // Calculate expected MELD reserve data after second deposit
            const expectedReserveMELDDataAfterDeposit: ReserveData =
              calcExpectedReserveDataAfterDeposit(
                depositAmountMELD,
                reserveMELDDataBeforeDeposit,
                BigInt(blockTimestampMELD)
              );

            await expect(depositTXMELD)
              .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
              .withArgs(
                await meld.getAddress(),
                expectedReserveMELDDataAfterDeposit.liquidityRate,
                expectedReserveMELDDataAfterDeposit.stableBorrowRate,
                expectedReserveMELDDataAfterDeposit.variableBorrowRate,
                expectedReserveMELDDataAfterDeposit.liquidityIndex,
                expectedReserveMELDDataAfterDeposit.variableBorrowIndex
              );

            // Originally approved depositAmount x 2, so depositAmount should be new allowance
            await expect(depositTXMELD)
              .to.emit(meld, "Approval")
              .withArgs(
                depositor.address,
                await lendingPool.getAddress(),
                depositAmountMELD
              );

            await expect(depositTXMELD)
              .to.emit(meld, "Transfer")
              .withArgs(
                depositor.address,
                reserveMELDDataBeforeDeposit.mTokenAddress,
                depositAmountMELD
              );

            await expect(depositTXMELD)
              .to.emit(mMELD, "Transfer")
              .withArgs(ZeroAddress, depositor.address, depositAmountMELD);

            await expect(depositTXMELD)
              .to.emit(mMELD, "Mint")
              .withArgs(
                depositor.address,
                depositAmountMELD,
                expectedReserveMELDDataAfterDeposit.liquidityIndex
              );

            await expect(depositTXMELD)
              .to.emit(lendingPool, "ReserveUsedAsCollateralEnabled")
              .withArgs(await meld.getAddress(), depositor.address);

            // Reserve does not have yield boost enabled, so should not emit StakePositionCreated, StakePositionUpdated, RefreshYieldBoostAmount, or LockMeldBankerNFT events
            // Can't check that StakePositionCreated or StakePositionUpdated are not emitted because there is no staking contract for MELD to check against. Checking that those
            // events weren't emitted for the USDC reserve is sufficient.
            await expect(depositTXMELD).to.not.emit(
              yieldBoostStakingUSDC,
              "StakePositionCreated"
            );

            await expect(depositTXMELD).to.not.emit(
              yieldBoostStakingUSDC,
              "StakePositionUpdated"
            );

            await expect(depositTXMELD).to.not.emit(
              lendingPool,
              "LockMeldBankerNFT"
            );

            await expect(depositTXMELD).to.not.emit(
              lendingPool,
              "RefreshYieldBoostAmount"
            );

            await expect(depositTXMELD)
              .to.emit(contractInstanceWithDepositLibraryABI, "Deposit")
              .withArgs(
                await meld.getAddress(),
                depositor.address,
                depositor.address,
                depositAmountMELD
              );
          });

          it("Should update state correctly", async function () {
            // First deploy protocol, create and initialize the reserve
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              usdc,
              meld,
              owner,
              depositor,
            } = await loadFixture(setUpTestFixture);

            // Set up USDC Deposit. factor = 2 because deposit and approval amount are different
            const depositAmount = await allocateAndApproveTokens(
              usdc,
              owner,
              depositor,
              lendingPool,
              1000n,
              2n
            );

            // Get USDC reserve data before first deposit
            const reserveUSDCDataBeforeDeposit: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await usdc.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get user USDC data before first deposit
            const userUSDCDataBeforeDeposit: UserReserveData =
              await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await usdc.getAddress(),
                depositor.address
              );

            // First Deposit - USDC
            await lendingPool
              .connect(depositor)
              .deposit(
                await usdc.getAddress(),
                depositAmount,
                depositor.address,
                true,
                0
              );

            // Hardhat time module. Gets timestamp of latest block.
            const blockTimestampUSDC = await time.latest();

            // Calculate expected USDC reserve data after first deposit
            const expectedReserveUSDCDataAfterDeposit: ReserveData =
              calcExpectedReserveDataAfterDeposit(
                depositAmount,
                reserveUSDCDataBeforeDeposit,
                BigInt(blockTimestampUSDC)
              );

            // Get USDC reserve data after first deposit
            const reserveUSDCDataAfterDeposit: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await usdc.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Calculate expected user USDC data after first deposit
            const expectedUserUSDCDataAfterDeposit: UserReserveData =
              calcExpectedUserDataAfterDeposit(
                depositAmount,
                reserveUSDCDataBeforeDeposit,
                reserveUSDCDataAfterDeposit,
                userUSDCDataBeforeDeposit,
                BigInt(blockTimestampUSDC)
              );

            // Get user data after deposit
            const userUSDCDataAfterDeposit: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              depositor.address
            );

            // Set up MELD Deposit. factor = 2 because deposit and approval amount are different
            const depositAmountMELD = await allocateAndApproveTokens(
              meld,
              owner,
              depositor,
              lendingPool,
              500n,
              2n
            );

            // Add time between deposits
            await time.increase(ONE_YEAR / 12);

            // Get MELD reserve data before second deposit
            const reserveMELDDataBeforeDeposit: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get user MELDdata before seccond deposit
            const userMELDDataBeforeDeposit: UserReserveData =
              await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await meld.getAddress(),
                depositor.address
              );

            // Second Deposit - MELD
            await lendingPool
              .connect(depositor)
              .deposit(
                await meld.getAddress(),
                depositAmountMELD,
                depositor.address,
                true,
                0
              );

            // Hardhat time module. Gets timestamp of latest block.
            const blockTimestampMELD = await time.latest();

            // Calculate expected MELD reserve data after second deposit
            const expectedReserveMELDDataAfterDeposit: ReserveData =
              calcExpectedReserveDataAfterDeposit(
                depositAmountMELD,
                reserveMELDDataBeforeDeposit,
                BigInt(blockTimestampMELD)
              );

            // Get reserve data after second deposit
            const reserveMELDDataAfterDeposit: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Calculate expected user data after second deposit
            const expectedUserMELDDataAfterDeposit: UserReserveData =
              calcExpectedUserDataAfterDeposit(
                depositAmountMELD,
                reserveMELDDataBeforeDeposit,
                reserveMELDDataAfterDeposit,
                userMELDDataBeforeDeposit,
                BigInt(blockTimestampMELD)
              );

            // Get user data after deposit
            const userMELDDataAfterDeposit: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              depositor.address
            );

            expectEqual(
              reserveUSDCDataAfterDeposit,
              expectedReserveUSDCDataAfterDeposit
            );
            expectEqual(
              userUSDCDataAfterDeposit,
              expectedUserUSDCDataAfterDeposit
            );
            expectEqual(
              reserveMELDDataAfterDeposit,
              expectedReserveMELDDataAfterDeposit
            );
            expectEqual(
              userMELDDataAfterDeposit,
              expectedUserMELDDataAfterDeposit
            );

            expect(await lendingPool.isUsingMeldBanker(depositor.address)).to.be
              .false;
            expect(await lendingPool.isMeldBankerBlocked(depositor.address)).to
              .be.false;

            const meldBankerData = await lendingPool.userMeldBankerData(
              depositor.address
            );
            expect(meldBankerData.tokenId).to.equal(0);
            expect(meldBankerData.asset).to.equal(ZeroAddress);
            expect(meldBankerData.meldBankerType).to.equal(MeldBankerType.NONE);
            expect(meldBankerData.action).to.equal(Action.NONE);
          });

          it("Should mint correct amount of different asset mTokens to onBehalfOf address", async function () {
            // First deploy protocol, create and initialize the reserve
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              usdc,
              meld,
              owner,
              depositor,
            } = await loadFixture(setUpTestFixture);

            // Set up USDC Deposit.
            const depositAmount = await allocateAndApproveTokens(
              usdc,
              owner,
              depositor,
              lendingPool,
              1000n,
              2n
            );

            // Get USDC reserve data before first deposit
            const reserveUSDCDataBeforeDeposit: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await usdc.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Instantiate mUSDC contract
            const mUSDC = await ethers.getContractAt(
              "MToken",
              reserveUSDCDataBeforeDeposit.mTokenAddress
            );

            // First Deposit - USDC
            await lendingPool
              .connect(depositor)
              .deposit(
                await usdc.getAddress(),
                depositAmount,
                depositor.address,
                true,
                0
              );

            // Set up MELD Deposit. factor = 2 because deposit and approval amount are different
            const depositAmountMELD = await allocateAndApproveTokens(
              meld,
              owner,
              depositor,
              lendingPool,
              500n,
              2n
            );

            // Get MELD reserve data before second deposit
            const reserveMELDDataBeforeDeposit: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Instantiate mUSDC contract
            const mMELD = await ethers.getContractAt(
              "MToken",
              reserveMELDDataBeforeDeposit.mTokenAddress
            );

            // Second Deposit - MELD
            await lendingPool
              .connect(depositor)
              .deposit(
                await meld.getAddress(),
                depositAmountMELD,
                depositor.address,
                true,
                0
              );

            expect(await mUSDC.balanceOf(depositor.address)).to.equal(
              depositAmount
            );
            expect(await mMELD.balanceOf(depositor.address)).to.equal(
              depositAmountMELD
            );
          });

          it("Should transfer correct amount of different asset tokens to different mToken addresses", async function () {
            // First deploy protocol, create and initialize the reserve
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              usdc,
              meld,
              owner,
              depositor,
            } = await loadFixture(setUpTestFixture);

            // Set up USDC Deposit. factor = 2 because deposit and approval amount are different
            const depositAmount = await allocateAndApproveTokens(
              usdc,
              owner,
              depositor,
              lendingPool,
              1000n,
              2n
            );

            // Get USDC reserve data before first deposit
            const reserveUSDCDataBeforeDeposit: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await usdc.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Instantiate mUSDC contract
            const mUSDC = await ethers.getContractAt(
              "MToken",
              reserveUSDCDataBeforeDeposit.mTokenAddress
            );

            // First Deposit - USDC
            await lendingPool
              .connect(depositor)
              .deposit(
                await usdc.getAddress(),
                depositAmount,
                depositor.address,
                true,
                0
              );

            // Set up MELD Deposit. factor = 2 because deposit and approval amount are different
            const depositAmountMELD = await allocateAndApproveTokens(
              meld,
              owner,
              depositor,
              lendingPool,
              500n,
              2n
            );

            // Get MELD reserve data before second deposit
            const reserveMELDDataBeforeDeposit: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Instantiate mMELD contract
            const mMELD = await ethers.getContractAt(
              "MToken",
              reserveMELDDataBeforeDeposit.mTokenAddress
            );

            // Second Deposit - MELD
            await lendingPool
              .connect(depositor)
              .deposit(
                await meld.getAddress(),
                depositAmountMELD,
                depositor.address,
                true,
                0
              );

            expect(await usdc.balanceOf(await mUSDC.getAddress())).to.equal(
              depositAmount
            );
            expect(await meld.balanceOf(await mMELD.getAddress())).to.equal(
              depositAmountMELD
            );
          });
        }
      ); // End Multiple deposits of different asset by same depositor Context

      context(
        "Multiple deposits of different assets by different depositors",
        async function () {
          it("Should emit correct events for each deposit", async function () {
            // First deploy protocol, create and initialize the reserve
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              yieldBoostStakingUSDC,
              usdc,
              meld,
              owner,
              depositor,
              rando,
            } = await loadFixture(setUpTestFixture);

            // Set up USDC Deposit. factor = 2 because deposit and approval amount are different
            const depositAmount = await allocateAndApproveTokens(
              usdc,
              owner,
              depositor,
              lendingPool,
              1000n,
              2n
            );

            // Get USDC reserve data before first deposit
            const reserveUSDCDataBeforeDeposit: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await usdc.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Instantiate mUSDC contract
            const mUSDC = await ethers.getContractAt(
              "MToken",
              reserveUSDCDataBeforeDeposit.mTokenAddress
            );

            // First Deposit - USDC
            const depositTxUSDC = await lendingPool
              .connect(depositor)
              .deposit(
                await usdc.getAddress(),
                depositAmount,
                depositor.address,
                true,
                0
              );

            // Hardhat time module. Gets timestamp of latest block.
            const blockTimestampUSDC = await time.latest();

            // Calculate expected USDC reserve data after first deposit
            const expectedReserveUSDCDataAfterDeposit: ReserveData =
              calcExpectedReserveDataAfterDeposit(
                depositAmount,
                reserveUSDCDataBeforeDeposit,
                BigInt(blockTimestampUSDC)
              );

            // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
            const contractInstanceWithLibraryABI = await ethers.getContractAt(
              "ReserveLogic",
              await lendingPool.getAddress(),
              owner
            );

            await expect(depositTxUSDC)
              .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
              .withArgs(
                await usdc.getAddress(),
                expectedReserveUSDCDataAfterDeposit.liquidityRate,
                expectedReserveUSDCDataAfterDeposit.stableBorrowRate,
                expectedReserveUSDCDataAfterDeposit.variableBorrowRate,
                expectedReserveUSDCDataAfterDeposit.liquidityIndex,
                expectedReserveUSDCDataAfterDeposit.variableBorrowIndex
              );

            // Originally approved depositAmount x 2, so depositAmount should be new allowance
            await expect(depositTxUSDC)
              .to.emit(usdc, "Approval")
              .withArgs(
                depositor.address,
                await lendingPool.getAddress(),
                depositAmount
              );

            await expect(depositTxUSDC)
              .to.emit(usdc, "Transfer")
              .withArgs(
                depositor.address,
                reserveUSDCDataBeforeDeposit.mTokenAddress,
                depositAmount
              );

            await expect(depositTxUSDC)
              .to.emit(mUSDC, "Transfer")
              .withArgs(ZeroAddress, depositor.address, depositAmount);

            await expect(depositTxUSDC)
              .to.emit(mUSDC, "Mint")
              .withArgs(
                depositor.address,
                depositAmount,
                expectedReserveUSDCDataAfterDeposit.liquidityIndex
              );

            await expect(depositTxUSDC)
              .to.emit(lendingPool, "ReserveUsedAsCollateralEnabled")
              .withArgs(await usdc.getAddress(), depositor.address);

            // Regular user, so should emit StakePositionCreated, StakePositionUpdated, RefreshYieldBoostAmount events but not LockMeldBankerNFT
            await expect(depositTxUSDC)
              .to.emit(yieldBoostStakingUSDC, "StakePositionCreated")
              .withArgs(depositor.address, depositAmount);

            await expect(depositTxUSDC)
              .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
              .withArgs(depositor.address, 0, depositAmount);

            await expect(depositTxUSDC).to.not.emit(
              lendingPool,
              "LockMeldBankerNFT"
            );

            await expect(depositTxUSDC)
              .to.emit(lendingPool, "RefreshYieldBoostAmount")
              .withArgs(
                await usdc.getAddress(),
                depositor.address,
                depositAmount
              );

            // The Deposit event is emitted by the DepositLogic.sol library, so we need to get the contract instance with the DepositLogic ABI
            const contractInstanceWithDepositLibraryABI =
              await ethers.getContractAt(
                "DepositLogic",
                await lendingPool.getAddress(),
                owner
              );

            await expect(depositTxUSDC)
              .to.emit(contractInstanceWithDepositLibraryABI, "Deposit")
              .withArgs(
                await usdc.getAddress(),
                depositor.address,
                depositor.address,
                depositAmount
              );

            // Set up MELD Deposit. factor = 2 because deposit and approval amount are different
            const depositAmountMELD = await allocateAndApproveTokens(
              meld,
              owner,
              rando,
              lendingPool,
              500n,
              2n
            );

            // Get MELD reserve data before second deposit
            const reserveMELDDataBeforeDeposit: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Instantiate mMELD contract
            const mMELD = await ethers.getContractAt(
              "MToken",
              reserveMELDDataBeforeDeposit.mTokenAddress
            );

            // Second Deposit - MELD
            const depositTXMELD = await lendingPool
              .connect(rando)
              .deposit(
                await meld.getAddress(),
                depositAmountMELD,
                rando.address,
                true,
                0
              );

            // Hardhat time module. Gets timestamp of latest block.
            const blockTimestampMELD = await time.latest();

            // Calculate expected MELD reserve data after second deposit
            const expectedReserveMELDDataAfterDeposit: ReserveData =
              calcExpectedReserveDataAfterDeposit(
                depositAmountMELD,
                reserveMELDDataBeforeDeposit,
                BigInt(blockTimestampMELD)
              );

            await expect(depositTXMELD)
              .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
              .withArgs(
                await meld.getAddress(),
                expectedReserveMELDDataAfterDeposit.liquidityRate,
                expectedReserveMELDDataAfterDeposit.stableBorrowRate,
                expectedReserveMELDDataAfterDeposit.variableBorrowRate,
                expectedReserveMELDDataAfterDeposit.liquidityIndex,
                expectedReserveMELDDataAfterDeposit.variableBorrowIndex
              );

            // Originally approved depositAmount x 2, so depositAmount should be new allowance
            await expect(depositTXMELD)
              .to.emit(meld, "Approval")
              .withArgs(
                rando.address,
                await lendingPool.getAddress(),
                depositAmountMELD
              );

            await expect(depositTXMELD)
              .to.emit(meld, "Transfer")
              .withArgs(
                rando.address,
                reserveMELDDataBeforeDeposit.mTokenAddress,
                depositAmountMELD
              );

            await expect(depositTXMELD)
              .to.emit(mMELD, "Transfer")
              .withArgs(ZeroAddress, rando.address, depositAmountMELD);

            await expect(depositTXMELD)
              .to.emit(mMELD, "Mint")
              .withArgs(
                rando.address,
                depositAmountMELD,
                expectedReserveMELDDataAfterDeposit.liquidityIndex
              );

            await expect(depositTXMELD)
              .to.emit(lendingPool, "ReserveUsedAsCollateralEnabled")
              .withArgs(await meld.getAddress(), rando.address);

            // Reserve does not have yield boost enabled, so should not emit StakePositionCreated, StakePositionUpdated, RefreshYieldBoostAmount, or LockMeldBankerNFT events,
            // but we can't test for absence of StakePositionCreated or StakePositionCreated because there is no staking contract for MELD to check against
            await expect(depositTXMELD).to.not.emit(
              lendingPool,
              "LockMeldBankerNFT"
            );

            await expect(depositTXMELD).to.not.emit(
              lendingPool,
              "RefreshYieldBoostAmount"
            );

            await expect(depositTXMELD)
              .to.emit(contractInstanceWithDepositLibraryABI, "Deposit")
              .withArgs(
                await meld.getAddress(),
                rando.address,
                rando.address,
                depositAmountMELD
              );
          });

          it("Should update state correctly", async function () {
            // First deploy protocol, create and initialize the reserve
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              usdc,
              meld,
              owner,
              depositor,
              rando,
            } = await loadFixture(setUpTestFixture);

            // Set up USDC Deposit. factor = 2 because deposit and approval amount are different
            const depositAmount = await allocateAndApproveTokens(
              usdc,
              owner,
              depositor,
              lendingPool,
              1000n,
              2n
            );

            // Get USDC reserve data before first deposit
            const reserveUSDCDataBeforeDeposit: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await usdc.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get user USDC data before first deposit
            const userUSDCDataBeforeDeposit: UserReserveData =
              await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await usdc.getAddress(),
                depositor.address
              );

            // First Deposit - USDC
            await lendingPool
              .connect(depositor)
              .deposit(
                await usdc.getAddress(),
                depositAmount,
                depositor.address,
                true,
                0
              );

            // Hardhat time module. Gets timestamp of latest block.
            const blockTimestampUSDC = await time.latest();

            // Calculate expected USDC reserve data after first deposit
            const expectedReserveUSDCDataAfterDeposit: ReserveData =
              calcExpectedReserveDataAfterDeposit(
                depositAmount,
                reserveUSDCDataBeforeDeposit,
                BigInt(blockTimestampUSDC)
              );

            // Get USDC reserve data after first deposit
            const reserveUSDCDataAfterDeposit: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await usdc.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Calculate expected user USDC data after first deposit
            const expectedUserUSDCDataAfterDeposit: UserReserveData =
              calcExpectedUserDataAfterDeposit(
                depositAmount,
                reserveUSDCDataBeforeDeposit,
                reserveUSDCDataAfterDeposit,
                userUSDCDataBeforeDeposit,
                BigInt(blockTimestampUSDC)
              );

            // Get user data after deposit
            const userUSDCDataAfterDeposit: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              depositor.address
            );

            // Set up MELD Deposit. factor = 2 because deposit and approval amount are different
            const depositAmountMELD = await allocateAndApproveTokens(
              meld,
              owner,
              rando,
              lendingPool,
              500n,
              2n
            );

            // Add time between deposits
            await time.increase(ONE_HOUR);

            // Get MELD reserve data before second deposit
            const reserveMELDDataBeforeDeposit: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get user MELDdata before seccond deposit
            const userMELDDataBeforeDeposit: UserReserveData =
              await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await meld.getAddress(),
                rando.address
              );

            // Second Deposit - MELD
            await lendingPool
              .connect(rando)
              .deposit(
                await meld.getAddress(),
                depositAmountMELD,
                rando.address,
                true,
                0
              );

            // Hardhat time module. Gets timestamp of latest block.
            const blockTimestampMELD = await time.latest();

            // Calculate expected MELD reserve data after second deposit
            const expectedReserveMELDDataAfterDeposit: ReserveData =
              calcExpectedReserveDataAfterDeposit(
                depositAmountMELD,
                reserveMELDDataBeforeDeposit,
                BigInt(blockTimestampMELD)
              );

            // Get reserve data after second deposit
            const reserveMELDDataAfterDeposit: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Calculate expected user data after second deposit
            const expectedUserMELDDataAfterDeposit: UserReserveData =
              calcExpectedUserDataAfterDeposit(
                depositAmountMELD,
                reserveMELDDataBeforeDeposit,
                reserveMELDDataAfterDeposit,
                userMELDDataBeforeDeposit,
                BigInt(blockTimestampMELD)
              );

            // Get user data after deposit
            const userMELDDataAfterDeposit: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              rando.address
            );

            expectEqual(
              reserveUSDCDataAfterDeposit,
              expectedReserveUSDCDataAfterDeposit
            );
            expectEqual(
              userUSDCDataAfterDeposit,
              expectedUserUSDCDataAfterDeposit
            );
            expectEqual(
              reserveMELDDataAfterDeposit,
              expectedReserveMELDDataAfterDeposit
            );
            expectEqual(
              userMELDDataAfterDeposit,
              expectedUserMELDDataAfterDeposit
            );

            expect(await lendingPool.isUsingMeldBanker(depositor.address)).to.be
              .false;
            expect(await lendingPool.isMeldBankerBlocked(depositor.address)).to
              .be.false;

            const meldBankerData = await lendingPool.userMeldBankerData(
              depositor.address
            );
            expect(meldBankerData.tokenId).to.equal(0);
            expect(meldBankerData.asset).to.equal(ZeroAddress);
            expect(meldBankerData.meldBankerType).to.equal(MeldBankerType.NONE);
            expect(meldBankerData.action).to.equal(Action.NONE);

            expect(await lendingPool.isUsingMeldBanker(rando.address)).to.be
              .false;
            expect(await lendingPool.isMeldBankerBlocked(rando.address)).to.be
              .false;

            const meldBankerData2 = await lendingPool.userMeldBankerData(
              rando.address
            );
            expect(meldBankerData2.tokenId).to.equal(0);
            expect(meldBankerData2.asset).to.equal(ZeroAddress);
            expect(meldBankerData2.meldBankerType).to.equal(
              MeldBankerType.NONE
            );
            expect(meldBankerData2.action).to.equal(Action.NONE);
          });

          it("Should mint correct amount of different asset mTokens to onBehalfOf addresses", async function () {
            // First deploy protocol, create and initialize the reserve
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              usdc,
              meld,
              owner,
              depositor,
              rando,
            } = await loadFixture(setUpTestFixture);

            // Set up USDC Deposit. factor = 2 because deposit and approval amount are different
            const depositAmount = await allocateAndApproveTokens(
              usdc,
              owner,
              depositor,
              lendingPool,
              1000n,
              2n
            );

            // Get USDC reserve data before first deposit
            const reserveUSDCDataBeforeDeposit: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await usdc.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Instantiate mUSDC contract
            const mUSDC = await ethers.getContractAt(
              "MToken",
              reserveUSDCDataBeforeDeposit.mTokenAddress
            );

            // First Deposit - USDC
            await lendingPool
              .connect(depositor)
              .deposit(
                await usdc.getAddress(),
                depositAmount,
                depositor.address,
                true,
                0
              );

            // Set up MELD Deposit. factor = 2 because deposit and approval amount are different
            const depositAmountMELD = await allocateAndApproveTokens(
              meld,
              owner,
              rando,
              lendingPool,
              500n,
              2n
            );

            // Get MELD reserve data before second deposit
            const reserveMELDDataBeforeDeposit: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await meld.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Instantiate mUSDC contract
            const mMELD = await ethers.getContractAt(
              "MToken",
              reserveMELDDataBeforeDeposit.mTokenAddress
            );

            // Second Deposit - MELD
            await lendingPool
              .connect(rando)
              .deposit(
                await meld.getAddress(),
                depositAmountMELD,
                rando.address,
                true,
                0
              );

            expect(await mUSDC.balanceOf(depositor.address)).to.equal(
              depositAmount
            );
            expect(await mMELD.balanceOf(rando.address)).to.equal(
              depositAmountMELD
            );
          });
        }
      ); // End Multiple deposits of different assets by different depositors Context

      context(
        "Multiple deposits of same asset by different depositors",
        async function () {
          it("Should emit correct events for each deposit", async function () {
            // First deploy protocol, create and initialize the reserve
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              yieldBoostStakingUSDC,
              usdc,
              owner,
              depositor,
              rando,
            } = await loadFixture(setUpTestFixture);

            // Set up first USDC deposit. factor = 2 because deposit and approval amount are different
            const depositAmount = await allocateAndApproveTokens(
              usdc,
              owner,
              depositor,
              lendingPool,
              1000n,
              2n
            );

            // Get USDC reserve data before first deposit
            const reserveUSDCDataBeforeDeposit: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await usdc.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Instantiate mUSDC contract
            const mUSDC = await ethers.getContractAt(
              "MToken",
              reserveUSDCDataBeforeDeposit.mTokenAddress
            );

            // First Deposit - USDC
            const depositTx = await lendingPool
              .connect(depositor)
              .deposit(
                await usdc.getAddress(),
                depositAmount,
                depositor.address,
                true,
                0
              );

            // Hardhat time module. Gets timestamp of latest block.
            const blockTimestamp = await time.latest();

            // Calculate expected USDC reserve data after first deposit
            const expectedReserveUSDCDataAfterDeposit: ReserveData =
              calcExpectedReserveDataAfterDeposit(
                depositAmount,
                reserveUSDCDataBeforeDeposit,
                BigInt(blockTimestamp)
              );

            // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
            const contractInstanceWithLibraryABI = await ethers.getContractAt(
              "ReserveLogic",
              await lendingPool.getAddress(),
              owner
            );

            await expect(depositTx)
              .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
              .withArgs(
                await usdc.getAddress(),
                expectedReserveUSDCDataAfterDeposit.liquidityRate,
                expectedReserveUSDCDataAfterDeposit.stableBorrowRate,
                expectedReserveUSDCDataAfterDeposit.variableBorrowRate,
                expectedReserveUSDCDataAfterDeposit.liquidityIndex,
                expectedReserveUSDCDataAfterDeposit.variableBorrowIndex
              );

            // Originally approved depositAmount x 2, so depositAmount should be new allowance
            await expect(depositTx)
              .to.emit(usdc, "Approval")
              .withArgs(
                depositor.address,
                await lendingPool.getAddress(),
                depositAmount
              );

            await expect(depositTx)
              .to.emit(usdc, "Transfer")
              .withArgs(
                depositor.address,
                reserveUSDCDataBeforeDeposit.mTokenAddress,
                depositAmount
              );

            await expect(depositTx)
              .to.emit(mUSDC, "Transfer")
              .withArgs(ZeroAddress, depositor.address, depositAmount);

            await expect(depositTx)
              .to.emit(mUSDC, "Mint")
              .withArgs(
                depositor.address,
                depositAmount,
                expectedReserveUSDCDataAfterDeposit.liquidityIndex
              );

            await expect(depositTx)
              .to.emit(lendingPool, "ReserveUsedAsCollateralEnabled")
              .withArgs(await usdc.getAddress(), depositor.address);

            // Regular user, so should emit StakePositionCreated, StakePositionUpdated, RefreshYieldBoostAmount events but not LockMeldBankerNFT
            await expect(depositTx)
              .to.emit(yieldBoostStakingUSDC, "StakePositionCreated")
              .withArgs(depositor.address, depositAmount);

            await expect(depositTx)
              .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
              .withArgs(depositor.address, 0, depositAmount);

            await expect(depositTx).to.not.emit(
              lendingPool,
              "LockMeldBankerNFT"
            );

            await expect(depositTx)
              .to.emit(lendingPool, "RefreshYieldBoostAmount")
              .withArgs(
                await usdc.getAddress(),
                depositor.address,
                depositAmount
              );

            // The Deposit event is emitted by the DepositLogic.sol library, so we need to get the contract instance with the DepositLogic ABI
            const contractInstanceWithDepositLibraryABI =
              await ethers.getContractAt(
                "DepositLogic",
                await lendingPool.getAddress(),
                owner
              );

            await expect(depositTx)
              .to.emit(contractInstanceWithDepositLibraryABI, "Deposit")
              .withArgs(
                await usdc.getAddress(),
                depositor.address,
                depositor.address,
                depositAmount
              );

            // Set up second USDC Deposit by second depositor
            const deposit2Amount = await allocateAndApproveTokens(
              usdc,
              owner,
              rando,
              lendingPool,
              1000n,
              1n
            );

            // Get USDC reserve data before second deposit
            const reserveUSDCDataBeforeDeposit2: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await usdc.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Second Deposit - USDC
            const depositTx2 = await lendingPool
              .connect(rando)
              .deposit(
                await usdc.getAddress(),
                deposit2Amount,
                rando.address,
                true,
                0
              );

            // Hardhat time module. Gets timestamp of latest block.
            const blockTimestamp2 = await time.latest();

            // Calculate expected USDC reserve data after second deposit
            const expectedReserveUSDCDataAfterDeposit2: ReserveData =
              calcExpectedReserveDataAfterDeposit(
                deposit2Amount,
                reserveUSDCDataBeforeDeposit2,
                BigInt(blockTimestamp2)
              );

            await expect(depositTx2)
              .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
              .withArgs(
                await usdc.getAddress(),
                reserveUSDCDataBeforeDeposit2.liquidityRate,
                reserveUSDCDataBeforeDeposit2.stableBorrowRate,
                reserveUSDCDataBeforeDeposit2.variableBorrowRate,
                reserveUSDCDataBeforeDeposit2.liquidityIndex,
                reserveUSDCDataBeforeDeposit2.variableBorrowIndex
              );

            // The amount is subtracted from the currentAllowance, so in this case the amount should be set to 0 just before the transfer
            await expect(depositTx2)
              .to.emit(usdc, "Approval")
              .withArgs(rando.address, await lendingPool.getAddress(), 0);

            await expect(depositTx2)
              .to.emit(usdc, "Transfer")
              .withArgs(
                rando.address,
                reserveUSDCDataBeforeDeposit2.mTokenAddress,
                deposit2Amount
              );

            await expect(depositTx2)
              .to.emit(mUSDC, "Transfer")
              .withArgs(ZeroAddress, rando.address, deposit2Amount);

            await expect(depositTx2)
              .to.emit(mUSDC, "Mint")
              .withArgs(
                rando.address,
                deposit2Amount,
                expectedReserveUSDCDataAfterDeposit2.liquidityIndex
              );

            await expect(depositTx2)
              .to.emit(lendingPool, "ReserveUsedAsCollateralEnabled")
              .withArgs(await usdc.getAddress(), rando.address);

            // Regular user, so should emit StakePositionCreated, StakePositionUpdated, RefreshYieldBoostAmount events but not LockMeldBankerNFT
            await expect(depositTx2)
              .to.emit(yieldBoostStakingUSDC, "StakePositionCreated")
              .withArgs(rando.address, deposit2Amount);

            await expect(depositTx2)
              .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
              .withArgs(rando.address, 0, deposit2Amount);

            await expect(depositTx2).to.not.emit(
              lendingPool,
              "LockMeldBankerNFT"
            );

            await expect(depositTx2)
              .to.emit(lendingPool, "RefreshYieldBoostAmount")
              .withArgs(await usdc.getAddress(), rando.address, deposit2Amount);

            await expect(depositTx2)
              .to.emit(contractInstanceWithDepositLibraryABI, "Deposit")
              .withArgs(
                await usdc.getAddress(),
                rando.address,
                rando.address,
                deposit2Amount
              );
          });

          it("Should update state correctly", async function () {
            // First deploy protocol, create and initialize the reserve
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              usdc,
              owner,
              depositor,
              rando,
            } = await loadFixture(setUpTestFixture);

            // Set up USDC Deposit. factor = 2 because deposit and approval amount are different
            const depositAmount = await allocateAndApproveTokens(
              usdc,
              owner,
              depositor,
              lendingPool,
              1000n,
              2n
            );

            // Get USDC reserve data before first deposit
            const reserveUSDCDataBeforeDeposit: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await usdc.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get user USDC data before first deposit
            const userUSDCDataBeforeDeposit: UserReserveData =
              await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await usdc.getAddress(),
                depositor.address
              );

            // First Deposit - USDC
            await lendingPool
              .connect(depositor)
              .deposit(
                await usdc.getAddress(),
                depositAmount,
                depositor.address,
                true,
                0
              );

            // Hardhat time module. Gets timestamp of latest block.
            const blockTimestamp = await time.latest();

            // Calculate expected USDC reserve data after first deposit
            const expectedReserveUSDCDataAfterDeposit: ReserveData =
              calcExpectedReserveDataAfterDeposit(
                depositAmount,
                reserveUSDCDataBeforeDeposit,
                BigInt(blockTimestamp)
              );

            // Get USDC reserve data after first deposit
            const reserveUSDCDataAfterDeposit: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await usdc.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Calculate expected user USDC data after first deposit
            const expectedUserUSDCDataAfterDeposit: UserReserveData =
              calcExpectedUserDataAfterDeposit(
                depositAmount,
                reserveUSDCDataBeforeDeposit,
                reserveUSDCDataAfterDeposit,
                userUSDCDataBeforeDeposit,
                BigInt(blockTimestamp)
              );

            // Get user data after deposit
            const userUSDCDataAfterDeposit: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              depositor.address
            );

            // Set up second USDC Deposit by second depositor
            const deposit2Amount = await allocateAndApproveTokens(
              usdc,
              owner,
              rando,
              lendingPool,
              1000n,
              1n
            );

            // Get USDC reserve data before second deposit
            const reserveUSDCDataBeforeDeposit2: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await usdc.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get user USDC data before second deposit
            const userUSDCDataBeforeDeposit2: UserReserveData =
              await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await usdc.getAddress(),
                rando.address
              );

            // Second Deposit - USDC
            await lendingPool
              .connect(rando)
              .deposit(
                await usdc.getAddress(),
                deposit2Amount,
                rando.address,
                true,
                0
              );

            // Hardhat time module. Gets timestamp of latest block.
            const blockTimestamp2 = await time.latest();

            // Calculate expected USDC reserve data after second deposit
            const expectedReserveUSDCDataAfterDeposit2: ReserveData =
              calcExpectedReserveDataAfterDeposit(
                deposit2Amount,
                reserveUSDCDataBeforeDeposit2,
                BigInt(blockTimestamp2)
              );

            // Get reserve data after second deposit
            const reserveUSDCDataAfterDeposit2: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await usdc.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Get user data after deposit
            const userUSDCDataAfterDeposit2: UserReserveData =
              await getUserData(
                lendingPool,
                meldProtocolDataProvider,
                await usdc.getAddress(),
                rando.address
              );

            // Calculate expected user data after second deposit
            const expectedUserUSDCDataAfterDeposit2: UserReserveData =
              calcExpectedUserDataAfterDeposit(
                deposit2Amount,
                reserveUSDCDataBeforeDeposit2,
                reserveUSDCDataAfterDeposit2,
                userUSDCDataBeforeDeposit2,
                BigInt(blockTimestamp2)
              );

            expectEqual(
              reserveUSDCDataAfterDeposit,
              expectedReserveUSDCDataAfterDeposit
            );
            expectEqual(
              userUSDCDataAfterDeposit,
              expectedUserUSDCDataAfterDeposit
            );
            expectEqual(
              reserveUSDCDataAfterDeposit2,
              expectedReserveUSDCDataAfterDeposit2
            );
            expectEqual(
              userUSDCDataAfterDeposit2,
              expectedUserUSDCDataAfterDeposit2
            );

            expect(await lendingPool.isUsingMeldBanker(depositor.address)).to.be
              .false;
            expect(await lendingPool.isMeldBankerBlocked(depositor.address)).to
              .be.false;

            const meldBankerData = await lendingPool.userMeldBankerData(
              depositor.address
            );
            expect(meldBankerData.tokenId).to.equal(0);
            expect(meldBankerData.asset).to.equal(ZeroAddress);
            expect(meldBankerData.meldBankerType).to.equal(MeldBankerType.NONE);
            expect(meldBankerData.action).to.equal(Action.NONE);

            expect(await lendingPool.isUsingMeldBanker(rando.address)).to.be
              .false;
            expect(await lendingPool.isMeldBankerBlocked(rando.address)).to.be
              .false;

            const meldBankerData2 = await lendingPool.userMeldBankerData(
              rando.address
            );
            expect(meldBankerData2.tokenId).to.equal(0);
            expect(meldBankerData2.asset).to.equal(ZeroAddress);
            expect(meldBankerData2.meldBankerType).to.equal(
              MeldBankerType.NONE
            );
            expect(meldBankerData2.action).to.equal(Action.NONE);
          });

          it("Should mint correct amount of different asset mTokens to onBehalfOf address", async function () {
            // First deploy protocol, create and initialize the reserve
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              usdc,
              owner,
              depositor,
              rando,
            } = await loadFixture(setUpTestFixture);

            // Set up USDC Deposit. factor = 2 because deposit and approval amount are different
            const depositAmount = await allocateAndApproveTokens(
              usdc,
              owner,
              depositor,
              lendingPool,
              1000n,
              2n
            );

            // Get USDC reserve data before first deposit
            const reserveUSDCDataBeforeDeposit: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await usdc.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Instantiate mUSDC contract
            const mUSDC = await ethers.getContractAt(
              "MToken",
              reserveUSDCDataBeforeDeposit.mTokenAddress
            );

            // First Deposit - USDC
            await lendingPool
              .connect(depositor)
              .deposit(
                await usdc.getAddress(),
                depositAmount,
                depositor.address,
                true,
                0
              );

            // Set up second Deposit. factor = 2 because deposit and approval amount are different
            const depositAmount2 = await allocateAndApproveTokens(
              usdc,
              owner,
              rando,
              lendingPool,
              500n,
              2n
            );

            // Second Deposit - USDC
            await lendingPool
              .connect(rando)
              .deposit(
                await usdc.getAddress(),
                depositAmount2,
                rando.address,
                true,
                0
              );

            expect(await mUSDC.balanceOf(depositor.address)).to.equal(
              depositAmount
            );
            expect(await mUSDC.balanceOf(rando.address)).to.equal(
              depositAmount2
            );
          });

          it("Should transfer correct amount of asset tokens to mToken address", async function () {
            // First deploy protocol, create and initialize the reserve
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              usdc,
              owner,
              depositor,
              rando,
            } = await loadFixture(setUpTestFixture);

            // Set up Deposit. factor = 0 because deposit and approval amount are same
            const depositAmount = await allocateAndApproveTokens(
              usdc,
              owner,
              depositor,
              lendingPool,
              1000n,
              0n
            );

            // Get reserve data before deposit
            const reserveDataBeforeDeposit: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Instantiate mUSDC contract
            const mUSDC = await ethers.getContractAt(
              "MToken",
              reserveDataBeforeDeposit.mTokenAddress
            );

            // First deposit - USDC
            await lendingPool
              .connect(depositor)
              .deposit(
                await usdc.getAddress(),
                depositAmount,
                depositor.address,
                true,
                0
              );

            // Set up second Deposit. factor = 0 because deposit and approval amount are same
            const depositAmount2 = await allocateAndApproveTokens(
              usdc,
              owner,
              rando,
              lendingPool,
              500n,
              0n
            );

            // Second Deposit - USDC
            await lendingPool
              .connect(rando)
              .deposit(
                await usdc.getAddress(),
                depositAmount2,
                rando.address,
                true,
                0
              );

            expect(await usdc.balanceOf(await mUSDC.getAddress())).to.equal(
              depositAmount + depositAmount2
            );
          });
        }
      ); // End Multiple deposits of same  asset by different depositors Context
    }); // End Regular User Context

    context("MELD Banker", async function () {
      context("Single deposit", async function () {
        it("Should emit the correct events when a MELD Banker holder deposits a yield boost token", async function () {
          // First deploy protocol, create and initialize the reserve
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            yieldBoostStakingUSDC,
            usdc,
            owner,
            meldBanker,
            meldBankerTokenId,
          } = await loadFixture(setUpTestFixture);

          // Set up Deposit. factor = 0 because deposit and approval amount are same
          const depositAmount = await allocateAndApproveTokens(
            usdc,
            owner,
            meldBanker,
            lendingPool,
            1000n,
            0n
          );

          // Get reserve data before deposit
          const reserveDataBeforeDeposit: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Instantiate mUSDC contract
          const mUSDC = await ethers.getContractAt(
            "MToken",
            reserveDataBeforeDeposit.mTokenAddress
          );

          // Deposit
          const depositTx = await lendingPool
            .connect(meldBanker)
            .deposit(
              await usdc.getAddress(),
              depositAmount,
              meldBanker.address,
              true,
              meldBankerTokenId
            );

          // Hardhat time module. Gets timestamp of latest block.
          const blockTimestamp = await time.latest();

          // Calculate expected reserve data after deposit
          const expectedReserveDataAfterDeposit =
            calcExpectedReserveDataAfterDeposit(
              depositAmount,
              reserveDataBeforeDeposit,
              BigInt(blockTimestamp)
            );

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          await expect(depositTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await usdc.getAddress(),
              expectedReserveDataAfterDeposit.liquidityRate,
              expectedReserveDataAfterDeposit.stableBorrowRate,
              expectedReserveDataAfterDeposit.variableBorrowRate,
              expectedReserveDataAfterDeposit.liquidityIndex,
              expectedReserveDataAfterDeposit.variableBorrowIndex
            );

          // The amount is subtracted from the currentAllowance, so in this case the amount should be set to 0 just before the transfer
          await expect(depositTx)
            .to.emit(usdc, "Approval")
            .withArgs(meldBanker.address, await lendingPool.getAddress(), 0);

          await expect(depositTx)
            .to.emit(usdc, "Transfer")
            .withArgs(
              meldBanker.address,
              reserveDataBeforeDeposit.mTokenAddress,
              depositAmount
            );

          await expect(depositTx)
            .to.emit(mUSDC, "Transfer")
            .withArgs(ZeroAddress, meldBanker.address, depositAmount);

          await expect(depositTx)
            .to.emit(mUSDC, "Mint")
            .withArgs(
              meldBanker.address,
              depositAmount,
              expectedReserveDataAfterDeposit.liquidityIndex
            );

          await expect(depositTx)
            .to.emit(lendingPool, "ReserveUsedAsCollateralEnabled")
            .withArgs(await usdc.getAddress(), meldBanker.address);

          // MELD Banker, so should emit StakePositionCreated, StakePositionUpdated, RefreshYieldBoostAmount and LockMeldBankerNFT events
          const meldBankerData = await lendingPool.userMeldBankerData(
            meldBanker.address
          );
          const yieldBoostMultiplier = await lendingPool.yieldBoostMultipliers(
            meldBankerData.meldBankerType,
            meldBankerData.action
          );
          const expectedStakedAmount =
            depositAmount.percentMul(yieldBoostMultiplier);

          await expect(depositTx)
            .to.emit(yieldBoostStakingUSDC, "StakePositionCreated")
            .withArgs(meldBanker.address, expectedStakedAmount);

          await expect(depositTx)
            .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
            .withArgs(meldBanker.address, 0, expectedStakedAmount);

          await expect(depositTx)
            .to.emit(lendingPool, "LockMeldBankerNFT")
            .withArgs(
              await usdc.getAddress(),
              meldBanker.address,
              meldBankerTokenId,
              MeldBankerType.BANKER,
              Action.DEPOSIT
            );

          await expect(depositTx)
            .to.emit(lendingPool, "RefreshYieldBoostAmount")
            .withArgs(
              await usdc.getAddress(),
              meldBanker.address,
              expectedStakedAmount
            );

          // The Deposit event is emitted by the DepositLogic.sol library, so we need to get the contract instance with the DepositLogic ABI
          const contractInstanceWithDepositLibraryABI =
            await ethers.getContractAt(
              "DepositLogic",
              await lendingPool.getAddress(),
              owner
            );

          await expect(depositTx)
            .to.emit(contractInstanceWithDepositLibraryABI, "Deposit")
            .withArgs(
              await usdc.getAddress(),
              meldBanker.address,
              meldBanker.address,
              depositAmount
            );
        });

        it("Should emit an MeldBankerNFTSet if doing a deposit to a Yield Boost reserve without having the MeldBankerNFT set yet", async function () {
          const {
            owner,
            meldBanker,
            lendingPool,
            usdc,
            meldBankerTokenId,
            meldBankerNft,
          } = await loadFixture(noMeldBankerNFTSetFixture);

          // Set up Deposit. factor = 0 because deposit and approval amount are same
          const depositAmount = await allocateAndApproveTokens(
            usdc,
            owner,
            meldBanker,
            lendingPool,
            1000n,
            0n
          );

          // Deposit
          await expect(
            lendingPool
              .connect(meldBanker)
              .deposit(
                await usdc.getAddress(),
                depositAmount,
                meldBanker.address,
                true,
                meldBankerTokenId
              )
          )
            .to.emit(lendingPool, "MeldBankerNFTSet")
            .withArgs(meldBanker.address, await meldBankerNft.getAddress());
        });

        it("Should update state correctly when a MELD Banker holder deposits a yield boost token", async function () {
          //First time an address deposits a reserve, it's marked as collateral. After that, it's just a liquidity deposit.

          // First deploy protocol, create and initialize the reserve
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            yieldBoostStorageUSDC,
            usdc,
            owner,
            meldBanker,
            meldBankerTokenId,
          } = await loadFixture(setUpTestFixture);

          // Set up Deposit. factor = 2 because deposit and approval amount are different
          const depositAmount = await allocateAndApproveTokens(
            usdc,
            owner,
            meldBanker,
            lendingPool,
            1000n,
            2n
          );

          // Get reserve data before deposit
          const reserveDataBeforeDeposit: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user data before deposit
          const userDataBeforeDeposit: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await usdc.getAddress(),
            meldBanker.address
          );

          // Deposit
          await lendingPool
            .connect(meldBanker)
            .deposit(
              await usdc.getAddress(),
              depositAmount,
              meldBanker.address,
              true,
              meldBankerTokenId
            );

          // Hardhat time module. Gets timestamp of latest block.
          const blockTimestamp = await time.latest();

          // Calculate expected reserve data after deposit
          const expectedReserveDataAfterDeposit: ReserveData =
            calcExpectedReserveDataAfterDeposit(
              depositAmount,
              reserveDataBeforeDeposit,
              BigInt(blockTimestamp)
            );

          // Get reserve data after deposit
          const reserveDataAfterDeposit: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Calculate expected user data after deposit
          const expectedUserDataAfterDeposit: UserReserveData =
            calcExpectedUserDataAfterDeposit(
              depositAmount,
              reserveDataBeforeDeposit,
              reserveDataAfterDeposit,
              userDataBeforeDeposit,
              BigInt(blockTimestamp)
            );

          // Get user data after deposit
          const userDataAfterDeposit: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await usdc.getAddress(),
            meldBanker.address
          );

          expectEqual(reserveDataAfterDeposit, expectedReserveDataAfterDeposit);
          expectEqual(userDataAfterDeposit, expectedUserDataAfterDeposit);

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
          expect(meldBankerData.action).to.equal(Action.DEPOSIT);

          const yieldBoostMultiplier = await lendingPool.yieldBoostMultipliers(
            meldBankerData.meldBankerType,
            meldBankerData.action
          );
          const expectedStakedAmount =
            depositAmount.percentMul(yieldBoostMultiplier);
          expect(
            await yieldBoostStorageUSDC.getStakerStakedAmount(
              meldBanker.address
            )
          ).to.equal(expectedStakedAmount);
        });

        it("Should update token balances correctly when a MELD Banker holder deposits a yield boost token", async function () {
          // First deploy protocol, create and initialize the reserve
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            usdc,
            owner,
            meldBanker,
            meldBankerTokenId,
          } = await loadFixture(setUpTestFixture);

          // Set up Deposit. factor = 0 because deposit and approval amount are same
          const depositAmount = await allocateAndApproveTokens(
            usdc,
            owner,
            meldBanker,
            lendingPool,
            1000n,
            0n
          );

          // Get reserve data before deposit
          const reserveDataBeforeDeposit: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Instantiate mUSDC contract
          const mUSDC = await ethers.getContractAt(
            "MToken",
            reserveDataBeforeDeposit.mTokenAddress
          );

          // Deposit
          await lendingPool
            .connect(meldBanker)
            .deposit(
              await usdc.getAddress(),
              depositAmount,
              meldBanker.address,
              true,
              meldBankerTokenId
            );

          expect(await mUSDC.balanceOf(meldBanker.address)).to.equal(
            depositAmount
          );

          expect(await usdc.balanceOf(await mUSDC.getAddress())).to.equal(
            depositAmount
          );
        });
      }); // End Single deposit Context

      context(
        "Multiple Deposits of Same Yield Boost Asset by Same Depositor",
        async function () {
          it("Should emit the correct events when a MELD Banker holder deposits a yield boost token for the second time", async function () {
            //First time an address deposits a reserve, it's marked as collateral. After that, it's just a liquidity deposit

            // First deploy protocol, create and initialize the reserve
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              yieldBoostStakingUSDC,
              usdc,
              owner,
              meldBanker,
              meldBankerTokenId,
            } = await loadFixture(setUpTestFixture);

            // Set up Deposit. factor = 2 because deposit and approval amount is higher than depsit amount due to multiple deposits
            const depositAmount = await allocateAndApproveTokens(
              usdc,
              owner,
              meldBanker,
              lendingPool,
              1000n,
              2n
            );

            // Get reserve data before deposit
            const reserveDataBeforeDeposit: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Instantiate mUSDC contract
            const mUSDC = await ethers.getContractAt(
              "MToken",
              reserveDataBeforeDeposit.mTokenAddress
            );

            // First Deposit
            const depositTx1 = await lendingPool
              .connect(meldBanker)
              .deposit(
                await usdc.getAddress(),
                depositAmount,
                meldBanker.address,
                true,
                meldBankerTokenId
              );

            // MELD Banker first deposit, so should emit StakePositionCreated, StakePositionUpdated, RefreshYieldBoostAmount and LockMeldBankerNFT events
            const meldBankerData1 = await lendingPool.userMeldBankerData(
              meldBanker.address
            );
            const yieldBoostMultiplier1 =
              await lendingPool.yieldBoostMultipliers(
                meldBankerData1.meldBankerType,
                meldBankerData1.action
              );
            const expectedStakedAmount = depositAmount.percentMul(
              yieldBoostMultiplier1
            );

            await expect(depositTx1)
              .to.emit(yieldBoostStakingUSDC, "StakePositionCreated")
              .withArgs(meldBanker.address, expectedStakedAmount);

            await expect(depositTx1)
              .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
              .withArgs(meldBanker.address, 0, expectedStakedAmount);

            await expect(depositTx1)
              .to.emit(lendingPool, "LockMeldBankerNFT")
              .withArgs(
                await usdc.getAddress(),
                meldBanker.address,
                meldBankerTokenId,
                MeldBankerType.BANKER,
                Action.DEPOSIT
              );

            await expect(depositTx1)
              .to.emit(lendingPool, "RefreshYieldBoostAmount")
              .withArgs(
                await usdc.getAddress(),
                meldBanker.address,
                expectedStakedAmount
              );

            // Second Deposit
            const depositTx2 = await lendingPool
              .connect(meldBanker)
              .deposit(
                await usdc.getAddress(),
                depositAmount,
                meldBanker.address,
                true,
                meldBankerTokenId
              );

            // Hardhat time module. Gets timestamp of latest block.
            const blockTimestamp = await time.latest();

            // Calculate expected reserve data after deposit
            const expectedReserveDataAfterDeposit =
              calcExpectedReserveDataAfterDeposit(
                depositAmount,
                reserveDataBeforeDeposit,
                BigInt(blockTimestamp)
              );

            // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
            const contractInstanceWithLibraryABI = await ethers.getContractAt(
              "ReserveLogic",
              await lendingPool.getAddress(),
              owner
            );

            await expect(depositTx2)
              .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
              .withArgs(
                await usdc.getAddress(),
                expectedReserveDataAfterDeposit.liquidityRate,
                expectedReserveDataAfterDeposit.stableBorrowRate,
                expectedReserveDataAfterDeposit.variableBorrowRate,
                expectedReserveDataAfterDeposit.liquidityIndex,
                expectedReserveDataAfterDeposit.variableBorrowIndex
              );

            // The amount is subtracted from the currentAllowance, so in this case the amount should be set to 0 just before the transfer
            await expect(depositTx2)
              .to.emit(usdc, "Approval")
              .withArgs(meldBanker.address, await lendingPool.getAddress(), 0);

            await expect(depositTx2)
              .to.emit(usdc, "Transfer")
              .withArgs(
                meldBanker.address,
                reserveDataBeforeDeposit.mTokenAddress,
                depositAmount
              );

            await expect(depositTx2)
              .to.emit(mUSDC, "Transfer")
              .withArgs(ZeroAddress, meldBanker.address, depositAmount);

            await expect(depositTx2)
              .to.emit(mUSDC, "Mint")
              .withArgs(
                meldBanker.address,
                depositAmount,
                expectedReserveDataAfterDeposit.liquidityIndex
              );

            // This event should NOT be emitted for second deposit of asset by the same address
            await expect(depositTx2).to.not.emit(
              lendingPool,
              "ReserveUsedAsCollateralEnabled"
            );

            // MELD Banker second deposit, so should only emit StakePositionUpdated and RefreshYieldBoostAmount events
            const meldBankerData2 = await lendingPool.userMeldBankerData(
              meldBanker.address
            );
            const yieldBoostMultiplier =
              await lendingPool.yieldBoostMultipliers(
                meldBankerData2.meldBankerType,
                meldBankerData2.action
              );

            const expectedOldStakedAmount =
              depositAmount.percentMul(yieldBoostMultiplier);

            const meldBankerMTokenBalance = await mUSDC.balanceOf(
              meldBanker.address
            );
            const expectedNewStakedAmount =
              meldBankerMTokenBalance.percentMul(yieldBoostMultiplier);

            await expect(depositTx2).to.not.emit(
              yieldBoostStakingUSDC,
              "StakePositionCreated"
            );
            await expect(depositTx2)
              .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
              .withArgs(
                meldBanker.address,
                expectedOldStakedAmount,
                expectedNewStakedAmount
              );

            await expect(depositTx2).to.not.emit(
              lendingPool,
              "LockMeldBankerNFT"
            );

            await expect(depositTx2)
              .to.emit(lendingPool, "RefreshYieldBoostAmount")
              .withArgs(
                await usdc.getAddress(),
                meldBanker.address,
                expectedNewStakedAmount
              );

            // The Deposit event is emitted by the DepositLogic.sol library, so we need to get the contract instance with the DepositLogic ABI
            const contractInstanceWithDepositLibraryABI =
              await ethers.getContractAt(
                "DepositLogic",
                await lendingPool.getAddress(),
                owner
              );

            await expect(depositTx2)
              .to.emit(contractInstanceWithDepositLibraryABI, "Deposit")
              .withArgs(
                await usdc.getAddress(),
                meldBanker.address,
                meldBanker.address,
                depositAmount
              );
          });

          it("Should update state correctly when a when a MELD Banker holder deposits a yield boost token for the second time", async function () {
            //First time an address deposits a reserve, it's marked as collateral. After that, it's just a liquidity deposit.

            // First deploy protocol, create and initialize the reserve
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              yieldBoostStorageUSDC,
              usdc,
              owner,
              meldBanker,
              meldBankerTokenId,
            } = await loadFixture(setUpTestFixture);

            // Set up Deposit. factor = 3 because deposit and approval amount are different
            const depositAmount = await allocateAndApproveTokens(
              usdc,
              owner,
              meldBanker,
              lendingPool,
              1000n,
              3n
            );

            // First Deposit
            await lendingPool
              .connect(meldBanker)
              .deposit(
                await usdc.getAddress(),
                depositAmount,
                meldBanker.address,
                true,
                meldBankerTokenId
              );

            // Get reserve data before deposit
            const reserveDataBeforeDeposit: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Get user data before deposit
            const userDataBeforeDeposit: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              meldBanker.address
            );

            const depositAmount2 = depositAmount * 2n;

            // Second Deposit
            await lendingPool
              .connect(meldBanker)
              .deposit(
                await usdc.getAddress(),
                depositAmount2,
                meldBanker.address,
                true,
                meldBankerTokenId
              );

            // Hardhat time module. Gets timestamp of latest block.
            const blockTimestamp = await time.latest();

            // Calculate expected reserve data after deposit
            const expectedReserveDataAfterDeposit: ReserveData =
              calcExpectedReserveDataAfterDeposit(
                depositAmount2,
                reserveDataBeforeDeposit,
                BigInt(blockTimestamp)
              );

            // Get reserve data after deposit
            const reserveDataAfterDeposit: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Calculate expected user data after deposit
            const expectedUserDataAfterDeposit: UserReserveData =
              calcExpectedUserDataAfterDeposit(
                depositAmount2,
                reserveDataBeforeDeposit,
                reserveDataAfterDeposit,
                userDataBeforeDeposit,
                BigInt(blockTimestamp)
              );

            // Get user data after deposit
            const userDataAfterDeposit: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              meldBanker.address
            );

            expectEqual(
              reserveDataAfterDeposit,
              expectedReserveDataAfterDeposit
            );
            expectEqual(userDataAfterDeposit, expectedUserDataAfterDeposit);
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
            expect(meldBankerData.action).to.equal(Action.DEPOSIT);

            const yieldBoostMultiplier =
              await lendingPool.yieldBoostMultipliers(
                meldBankerData.meldBankerType,
                meldBankerData.action
              );
            const expectedStakedAmount =
              depositAmount.percentMul(yieldBoostMultiplier) +
              depositAmount2.percentMul(yieldBoostMultiplier);

            expect(
              await yieldBoostStorageUSDC.getStakerStakedAmount(
                meldBanker.address
              )
            ).to.equal(expectedStakedAmount);
          });

          it("Should update token balances correctly when a when a MELD Banker holder deposits a yield boost token for the second time", async function () {
            // First deploy protocol, create and initialize the reserve
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              usdc,
              owner,
              meldBanker,
              meldBankerTokenId,
            } = await loadFixture(setUpTestFixture);

            // Set up Deposit. factor = 3 because deposit and approval amount are different
            const depositAmount = await allocateAndApproveTokens(
              usdc,
              owner,
              meldBanker,
              lendingPool,
              1000n,
              3n
            );

            // Get reserve data before deposit
            const reserveDataBeforeDeposit: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Instantiate mUSDC contract
            const mUSDC = await ethers.getContractAt(
              "MToken",
              reserveDataBeforeDeposit.mTokenAddress
            );

            // First Deposit
            await lendingPool
              .connect(meldBanker)
              .deposit(
                await usdc.getAddress(),
                depositAmount,
                meldBanker.address,
                true,
                meldBankerTokenId
              );

            const depositAmount2 = depositAmount * 2n;

            // Second Deposit
            await lendingPool
              .connect(meldBanker)
              .deposit(
                await usdc.getAddress(),
                depositAmount2,
                meldBanker.address,
                true,
                meldBankerTokenId
              );

            expect(await mUSDC.balanceOf(meldBanker.address)).to.equal(
              depositAmount + depositAmount2
            );

            expect(await usdc.balanceOf(await mUSDC.getAddress())).to.equal(
              depositAmount + depositAmount2
            );
          });
        }
      ); // End Multiple Deposits of Same Yield Boost Asset by Same Depositor Context

      context(
        "Multiple Deposits of Different Yield Boost Assets by Same Depositor",
        async function () {
          it("Should emit the correct events when a MELD Banker holder deposits a yield boost token for the second time but doesn't use NFT tokenId", async function () {
            //First time an address deposits a reserve, it's marked as collateral. After that, it's just a liquidity deposit

            // First deploy protocol, create and initialize the reserve
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              yieldBoostStakingUSDC,
              yieldBoostStakingDAI,
              usdc,
              dai,
              owner,
              meldBanker,
              meldBankerTokenId,
            } = await loadFixture(setUpTestFixture);

            // Set up Deposit. factor = 0 because deposit and approval amount are same
            const depositAmountUSDC = await allocateAndApproveTokens(
              usdc,
              owner,
              meldBanker,
              lendingPool,
              1000n,
              0n
            );

            // First Deposit
            const depositTx1 = await lendingPool
              .connect(meldBanker)
              .deposit(
                await usdc.getAddress(),
                depositAmountUSDC,
                meldBanker.address,
                true,
                meldBankerTokenId
              );

            // MELD Banker first deposit, so should emit StakePositionCreated, StakePositionUpdated , RefreshYieldBoostAmount and LockMeldBankerNFT events
            const meldBankerData1 = await lendingPool.userMeldBankerData(
              meldBanker.address
            );
            const yieldBoostMultiplier1 =
              await lendingPool.yieldBoostMultipliers(
                meldBankerData1.meldBankerType,
                meldBankerData1.action
              );
            const expectedStakedAmount = depositAmountUSDC.percentMul(
              yieldBoostMultiplier1
            );

            await expect(depositTx1)
              .to.emit(yieldBoostStakingUSDC, "StakePositionCreated")
              .withArgs(meldBanker.address, expectedStakedAmount);

            await expect(depositTx1)
              .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
              .withArgs(meldBanker.address, 0, expectedStakedAmount);

            await expect(depositTx1)
              .to.emit(lendingPool, "LockMeldBankerNFT")
              .withArgs(
                await usdc.getAddress(),
                meldBanker.address,
                meldBankerTokenId,
                MeldBankerType.BANKER,
                Action.DEPOSIT
              );

            await expect(depositTx1)
              .to.emit(lendingPool, "RefreshYieldBoostAmount")
              .withArgs(
                await usdc.getAddress(),
                meldBanker.address,
                expectedStakedAmount
              );

            // Set up Deposit. factor = 0 because deposit and approval amount are same
            const depositAmountDAI = await allocateAndApproveTokens(
              dai,
              owner,
              meldBanker,
              lendingPool,
              1000n,
              0n
            );

            // Get reserve data before deposit
            const reserveDataBeforeDeposit: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await dai.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Instantiate mDAI contract
            const mDAI = await ethers.getContractAt(
              "MToken",
              reserveDataBeforeDeposit.mTokenAddress
            );

            // Second Deposit
            const depositTx2 = await lendingPool
              .connect(meldBanker)
              .deposit(
                await dai.getAddress(),
                depositAmountDAI,
                meldBanker.address,
                false,
                0n
              );

            // Hardhat time module. Gets timestamp of latest block.
            const blockTimestamp = await time.latest();

            // Calculate expected reserve data after deposit
            const expectedReserveDataAfterDeposit =
              calcExpectedReserveDataAfterDeposit(
                depositAmountDAI,
                reserveDataBeforeDeposit,
                BigInt(blockTimestamp)
              );

            // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
            const contractInstanceWithLibraryABI = await ethers.getContractAt(
              "ReserveLogic",
              await lendingPool.getAddress(),
              owner
            );

            await expect(depositTx2)
              .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
              .withArgs(
                await dai.getAddress(),
                expectedReserveDataAfterDeposit.liquidityRate,
                expectedReserveDataAfterDeposit.stableBorrowRate,
                expectedReserveDataAfterDeposit.variableBorrowRate,
                expectedReserveDataAfterDeposit.liquidityIndex,
                expectedReserveDataAfterDeposit.variableBorrowIndex
              );

            // The amount is subtracted from the currentAllowance, so in this case the amount should be set to 0 just before the transfer
            await expect(depositTx2)
              .to.emit(dai, "Approval")
              .withArgs(meldBanker.address, await lendingPool.getAddress(), 0);

            await expect(depositTx2)
              .to.emit(dai, "Transfer")
              .withArgs(
                meldBanker.address,
                reserveDataBeforeDeposit.mTokenAddress,
                depositAmountDAI
              );

            await expect(depositTx2)
              .to.emit(mDAI, "Transfer")
              .withArgs(ZeroAddress, meldBanker.address, depositAmountDAI);

            await expect(depositTx2)
              .to.emit(mDAI, "Mint")
              .withArgs(
                meldBanker.address,
                depositAmountDAI,
                expectedReserveDataAfterDeposit.liquidityIndex
              );

            // This event should NOT be emitted for second deposit of asset by the same address
            await expect(depositTx2).to.not.emit(
              lendingPool,
              "ReserveUsedAsCollateralEnabled"
            );

            // MELD Banker second deposit but didn't use NFT tokenId, so gets treated as a regular user
            await expect(depositTx2)
              .to.emit(yieldBoostStakingDAI, "StakePositionCreated")
              .withArgs(meldBanker.address, depositAmountDAI);

            await expect(depositTx2)
              .to.emit(yieldBoostStakingDAI, "StakePositionUpdated")
              .withArgs(meldBanker.address, 0, depositAmountDAI);

            await expect(depositTx2).to.not.emit(
              lendingPool,
              "LockMeldBankerNFT"
            );

            await expect(depositTx2)
              .to.emit(lendingPool, "RefreshYieldBoostAmount")
              .withArgs(
                await dai.getAddress(),
                meldBanker.address,
                depositAmountDAI
              );

            // The Deposit event is emitted by the DepositLogic.sol library, so we need to get the contract instance with the DepositLogic ABI
            const contractInstanceWithDepositLibraryABI =
              await ethers.getContractAt(
                "DepositLogic",
                await lendingPool.getAddress(),
                owner
              );

            await expect(depositTx2)
              .to.emit(contractInstanceWithDepositLibraryABI, "Deposit")
              .withArgs(
                await dai.getAddress(),
                meldBanker.address,
                meldBanker.address,
                depositAmountDAI
              );
          });

          it("Should update state correctly when a MELD Banker holder deposits a yield boost token for the second time but doesn't use NFT tokenId", async function () {
            //First time an address deposits a reserve, it's marked as collateral. After that, it's just a liquidity deposit.

            // First deploy protocol, create and initialize the reserve
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              yieldBoostStorageUSDC,
              yieldBoostStorageDAI,
              usdc,
              dai,
              owner,
              meldBanker,
              meldBankerTokenId,
            } = await loadFixture(setUpTestFixture);

            // Set up Deposit. factor = 2 because deposit and approval amount are different
            const depositAmount = await allocateAndApproveTokens(
              usdc,
              owner,
              meldBanker,
              lendingPool,
              1000n,
              3n
            );

            // First Deposit
            await lendingPool
              .connect(meldBanker)
              .deposit(
                await usdc.getAddress(),
                depositAmount,
                meldBanker.address,
                true,
                meldBankerTokenId
              );

            // Set up Deposit. factor = 0 because deposit and approval amount are same
            const depositAmountDAI = await allocateAndApproveTokens(
              dai,
              owner,
              meldBanker,
              lendingPool,
              1000n,
              0n
            );

            // Get reserve data before deposit
            const reserveDataBeforeDeposit: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await dai.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Get user data before deposit
            const userDataBeforeDeposit: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await dai.getAddress(),
              meldBanker.address
            );

            // Second Deposit
            await lendingPool
              .connect(meldBanker)
              .deposit(
                await dai.getAddress(),
                depositAmountDAI,
                meldBanker.address,
                false,
                0n
              );

            // Hardhat time module. Gets timestamp of latest block.
            const blockTimestamp = await time.latest();

            // Calculate expected reserve data after deposit
            const expectedReserveDataAfterDeposit: ReserveData =
              calcExpectedReserveDataAfterDeposit(
                depositAmountDAI,
                reserveDataBeforeDeposit,
                BigInt(blockTimestamp)
              );

            // Get reserve data after deposit
            const reserveDataAfterDeposit: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await dai.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Calculate expected user data after deposit
            const expectedUserDataAfterDeposit: UserReserveData =
              calcExpectedUserDataAfterDeposit(
                depositAmountDAI,
                reserveDataBeforeDeposit,
                reserveDataAfterDeposit,
                userDataBeforeDeposit,
                BigInt(blockTimestamp),
                false
              );

            // Get user data after deposit
            const userDataAfterDeposit: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await dai.getAddress(),
              meldBanker.address
            );

            expectEqual(
              reserveDataAfterDeposit,
              expectedReserveDataAfterDeposit
            );
            expectEqual(userDataAfterDeposit, expectedUserDataAfterDeposit);

            expect(await lendingPool.isUsingMeldBanker(meldBanker.address)).to
              .be.true;

            expect(await lendingPool.isMeldBankerBlocked(meldBankerTokenId)).to
              .be.true;

            const meldBankerData = await lendingPool.userMeldBankerData(
              meldBanker.address
            );
            expect(meldBankerData.tokenId).to.equal(meldBankerTokenId);
            expect(meldBankerData.asset).to.equal(await usdc.getAddress());
            expect(meldBankerData.asset).to.not.equal(await dai.getAddress());
            expect(meldBankerData.meldBankerType).to.equal(
              MeldBankerType.BANKER
            );
            expect(meldBankerData.action).to.equal(Action.DEPOSIT);

            const yieldBoostMultiplier =
              await lendingPool.yieldBoostMultipliers(
                meldBankerData.meldBankerType,
                meldBankerData.action
              );
            const expectedStakedAmountUSDC =
              depositAmount.percentMul(yieldBoostMultiplier);

            expect(
              await yieldBoostStorageUSDC.getStakerStakedAmount(
                meldBanker.address
              )
            ).to.equal(expectedStakedAmountUSDC);

            expect(
              await yieldBoostStorageDAI.getStakerStakedAmount(
                meldBanker.address
              )
            ).to.equal(depositAmountDAI);
          });

          it("Should update token balances correctly when a MELD Banker holder deposits a yield boost token for the second time but doesn't use NFT tokenId", async function () {
            // First deploy protocol, create and initialize the reserve
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              usdc,
              dai,
              owner,
              meldBanker,
              meldBankerTokenId,
            } = await loadFixture(setUpTestFixture);

            // Set up Deposit. factor = 0 because deposit and approval amount are same
            const depositAmountUSDC = await allocateAndApproveTokens(
              usdc,
              owner,
              meldBanker,
              lendingPool,
              1000n,
              3n
            );

            // Get USDC reserve data before deposit
            const reserveUSDCDataBeforeDeposit: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await usdc.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Instantiate mUSDC contract
            const mUSDC = await ethers.getContractAt(
              "MToken",
              reserveUSDCDataBeforeDeposit.mTokenAddress
            );

            // First Deposit
            await lendingPool
              .connect(meldBanker)
              .deposit(
                await usdc.getAddress(),
                depositAmountUSDC,
                meldBanker.address,
                true,
                meldBankerTokenId
              );

            // Get DAI reserve data before deposit
            const reserveDAIDataBeforeDeposit: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await dai.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Instantiate mDAI contract
            const mDAI = await ethers.getContractAt(
              "MToken",
              reserveDAIDataBeforeDeposit.mTokenAddress
            );

            // Set up Deposit. factor = 0 because deposit and approval amount are same
            const depositAmountDAI = await allocateAndApproveTokens(
              dai,
              owner,
              meldBanker,
              lendingPool,
              1000n,
              0n
            );

            // Second Deposit
            await lendingPool
              .connect(meldBanker)
              .deposit(
                await dai.getAddress(),
                depositAmountDAI,
                meldBanker.address,
                true,
                0n
              );

            expect(await mUSDC.balanceOf(meldBanker.address)).to.equal(
              depositAmountUSDC
            );

            expect(await usdc.balanceOf(await mUSDC.getAddress())).to.equal(
              depositAmountUSDC
            );

            expect(await mDAI.balanceOf(meldBanker.address)).to.equal(
              depositAmountDAI
            );

            expect(await dai.balanceOf(await mDAI.getAddress())).to.equal(
              depositAmountDAI
            );
          });
        }
      ); // End Multiple Deposits of Different Yield Boost Assets by Same Depositor Context
    }); // End MELD Banker Context

    context("Golden MELD Banker", async function () {
      context("Single deposit", async function () {
        it("Should emit the correct events when a Golden Banker holder deposits a yield boost token", async function () {
          // First deploy protocol, create and initialize the reserve
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            yieldBoostStakingUSDC,
            usdc,
            owner,
            goldenBanker,
            goldenBankerTokenId,
          } = await loadFixture(setUpTestFixture);

          // Set up Deposit. factor = 0 because deposit and approval amount are same
          const depositAmount = await allocateAndApproveTokens(
            usdc,
            owner,
            goldenBanker,
            lendingPool,
            1000n,
            0n
          );

          // Get reserve data before deposit
          const reserveDataBeforeDeposit: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Instantiate mUSDC contract
          const mUSDC = await ethers.getContractAt(
            "MToken",
            reserveDataBeforeDeposit.mTokenAddress
          );

          // Deposit
          const depositTx = await lendingPool
            .connect(goldenBanker)
            .deposit(
              await usdc.getAddress(),
              depositAmount,
              goldenBanker.address,
              true,
              goldenBankerTokenId
            );

          // Hardhat time module. Gets timestamp of latest block.
          const blockTimestamp = await time.latest();

          // Calculate expected reserve data after deposit
          const expectedReserveDataAfterDeposit =
            calcExpectedReserveDataAfterDeposit(
              depositAmount,
              reserveDataBeforeDeposit,
              BigInt(blockTimestamp)
            );

          // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
          const contractInstanceWithLibraryABI = await ethers.getContractAt(
            "ReserveLogic",
            await lendingPool.getAddress(),
            owner
          );

          await expect(depositTx)
            .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
            .withArgs(
              await usdc.getAddress(),
              expectedReserveDataAfterDeposit.liquidityRate,
              expectedReserveDataAfterDeposit.stableBorrowRate,
              expectedReserveDataAfterDeposit.variableBorrowRate,
              expectedReserveDataAfterDeposit.liquidityIndex,
              expectedReserveDataAfterDeposit.variableBorrowIndex
            );

          // The amount is subtracted from the currentAllowance, so in this case the amount should be set to 0 just before the transfer
          await expect(depositTx)
            .to.emit(usdc, "Approval")
            .withArgs(goldenBanker.address, await lendingPool.getAddress(), 0);

          await expect(depositTx)
            .to.emit(usdc, "Transfer")
            .withArgs(
              goldenBanker.address,
              reserveDataBeforeDeposit.mTokenAddress,
              depositAmount
            );

          await expect(depositTx)
            .to.emit(mUSDC, "Transfer")
            .withArgs(ZeroAddress, goldenBanker.address, depositAmount);

          await expect(depositTx)
            .to.emit(mUSDC, "Mint")
            .withArgs(
              goldenBanker.address,
              depositAmount,
              expectedReserveDataAfterDeposit.liquidityIndex
            );

          await expect(depositTx)
            .to.emit(lendingPool, "ReserveUsedAsCollateralEnabled")
            .withArgs(await usdc.getAddress(), goldenBanker.address);

          // Golden Banker, so should emit StakePositionCreated, StakePositionUpdated, RefreshYieldBoostAmount and LockMeldBankerNFT events
          const meldBankerData = await lendingPool.userMeldBankerData(
            goldenBanker.address
          );
          const yieldBoostMultiplier = await lendingPool.yieldBoostMultipliers(
            meldBankerData.meldBankerType,
            meldBankerData.action
          );
          const expectedStakedAmount =
            depositAmount.percentMul(yieldBoostMultiplier);

          await expect(depositTx)
            .to.emit(yieldBoostStakingUSDC, "StakePositionCreated")
            .withArgs(goldenBanker.address, expectedStakedAmount);

          await expect(depositTx)
            .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
            .withArgs(goldenBanker.address, 0, expectedStakedAmount);

          await expect(depositTx)
            .to.emit(lendingPool, "LockMeldBankerNFT")
            .withArgs(
              await usdc.getAddress(),
              goldenBanker.address,
              goldenBankerTokenId,
              MeldBankerType.GOLDEN,
              Action.DEPOSIT
            );

          await expect(depositTx)
            .to.emit(lendingPool, "RefreshYieldBoostAmount")
            .withArgs(
              await usdc.getAddress(),
              goldenBanker.address,
              expectedStakedAmount
            );

          // The Deposit event is emitted by the DepositLogic.sol library, so we need to get the contract instance with the DepositLogic ABI
          const contractInstanceWithDepositLibraryABI =
            await ethers.getContractAt(
              "DepositLogic",
              await lendingPool.getAddress(),
              owner
            );

          await expect(depositTx)
            .to.emit(contractInstanceWithDepositLibraryABI, "Deposit")
            .withArgs(
              await usdc.getAddress(),
              goldenBanker.address,
              goldenBanker.address,
              depositAmount
            );
        });

        it("Should update state correctly when a Golden Banker holder deposits a yield boost token", async function () {
          //First time an address deposits a reserve, it's marked as collateral. After that, it's just a liquidity deposit.

          // First deploy protocol, create and initialize the reserve
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            yieldBoostStorageUSDC,
            usdc,
            owner,
            goldenBanker,
            goldenBankerTokenId,
          } = await loadFixture(setUpTestFixture);

          // Set up Deposit. factor = 2 because deposit and approval amount are different
          const depositAmount = await allocateAndApproveTokens(
            usdc,
            owner,
            goldenBanker,
            lendingPool,
            1000n,
            2n
          );

          // Get reserve data before deposit
          const reserveDataBeforeDeposit: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get user data before deposit
          const userDataBeforeDeposit: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await usdc.getAddress(),
            goldenBanker.address
          );

          // First Deposit
          await lendingPool
            .connect(goldenBanker)
            .deposit(
              await usdc.getAddress(),
              depositAmount,
              goldenBanker.address,
              true,
              goldenBankerTokenId
            );

          // Hardhat time module. Gets timestamp of latest block.
          const blockTimestamp = await time.latest();

          // Calculate expected reserve data after deposit
          const expectedReserveDataAfterDeposit: ReserveData =
            calcExpectedReserveDataAfterDeposit(
              depositAmount,
              reserveDataBeforeDeposit,
              BigInt(blockTimestamp)
            );

          // Get reserve data after deposit
          const reserveDataAfterDeposit: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Calculate expected user data after deposit
          const expectedUserDataAfterDeposit: UserReserveData =
            calcExpectedUserDataAfterDeposit(
              depositAmount,
              reserveDataBeforeDeposit,
              reserveDataAfterDeposit,
              userDataBeforeDeposit,
              BigInt(blockTimestamp)
            );

          // Get user data after deposit
          const userDataAfterDeposit: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await usdc.getAddress(),
            goldenBanker.address
          );

          expectEqual(reserveDataAfterDeposit, expectedReserveDataAfterDeposit);
          expectEqual(userDataAfterDeposit, expectedUserDataAfterDeposit);
          expect(await lendingPool.isUsingMeldBanker(goldenBanker.address)).to
            .be.true;

          expect(await lendingPool.isMeldBankerBlocked(goldenBankerTokenId)).to
            .be.true;

          const meldBankerData = await lendingPool.userMeldBankerData(
            goldenBanker.address
          );
          expect(meldBankerData.tokenId).to.equal(goldenBankerTokenId);
          expect(meldBankerData.asset).to.equal(await usdc.getAddress());
          expect(meldBankerData.meldBankerType).to.equal(MeldBankerType.GOLDEN);
          expect(meldBankerData.action).to.equal(Action.DEPOSIT);

          const yieldBoostMultiplier = await lendingPool.yieldBoostMultipliers(
            meldBankerData.meldBankerType,
            meldBankerData.action
          );
          const expectedStakedAmount =
            depositAmount.percentMul(yieldBoostMultiplier);
          expect(
            await yieldBoostStorageUSDC.getStakerStakedAmount(
              goldenBanker.address
            )
          ).to.equal(expectedStakedAmount);
        });

        it("Should update token balances correctly when a Golden Banker holder deposits a yield boost token", async function () {
          // First deploy protocol, create and initialize the reserve
          const {
            lendingPool,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            usdc,
            owner,
            goldenBanker,
            goldenBankerTokenId,
          } = await loadFixture(setUpTestFixture);

          // Set up Deposit. factor = 0 because deposit and approval amount are same
          const depositAmount = await allocateAndApproveTokens(
            usdc,
            owner,
            goldenBanker,
            lendingPool,
            1000n,
            0n
          );

          // Get reserve data before deposit
          const reserveDataBeforeDeposit: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Instantiate mUSDC contract
          const mUSDC = await ethers.getContractAt(
            "MToken",
            reserveDataBeforeDeposit.mTokenAddress
          );

          // Deposit
          await lendingPool
            .connect(goldenBanker)
            .deposit(
              await usdc.getAddress(),
              depositAmount,
              goldenBanker.address,
              true,
              goldenBankerTokenId
            );

          expect(await mUSDC.balanceOf(goldenBanker.address)).to.equal(
            depositAmount
          );

          expect(await usdc.balanceOf(await mUSDC.getAddress())).to.equal(
            depositAmount
          );
        });
      }); // End Single deposit Context

      context(
        "Multiple Deposits of Same Yield Boost Asset by Same Depositor",
        async function () {
          it("Should emit the correct events when a Golden  Banker holder deposits a yield boost token for the second time", async function () {
            //First time an address deposits a reserve, it's marked as collateral. After that, it's just a liquidity deposit

            // First deploy protocol, create and initialize the reserve
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              yieldBoostStakingUSDC,
              usdc,
              owner,
              goldenBanker,
              goldenBankerTokenId,
            } = await loadFixture(setUpTestFixture);

            // Set up Deposit. factor = 2 because deposit and approval amount is higher than depsit amount due to multiple deposits
            const depositAmount = await allocateAndApproveTokens(
              usdc,
              owner,
              goldenBanker,
              lendingPool,
              1000n,
              2n
            );

            // Get reserve data before deposit
            const reserveDataBeforeDeposit: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Instantiate mUSDC contract
            const mUSDC = await ethers.getContractAt(
              "MToken",
              reserveDataBeforeDeposit.mTokenAddress
            );

            // First Deposit
            const depositTx1 = await lendingPool
              .connect(goldenBanker)
              .deposit(
                await usdc.getAddress(),
                depositAmount,
                goldenBanker.address,
                true,
                goldenBankerTokenId
              );

            // MELD Banker first deposit, so should emit StakePositionCreated, StakePositionUpdated, RefreshYieldBoostAmount and LockMeldBankerNFT events
            const meldBankerData1 = await lendingPool.userMeldBankerData(
              goldenBanker.address
            );
            const yieldBoostMultiplier1 =
              await lendingPool.yieldBoostMultipliers(
                meldBankerData1.meldBankerType,
                meldBankerData1.action
              );
            const expectedStakedAmount = depositAmount.percentMul(
              yieldBoostMultiplier1
            );

            await expect(depositTx1)
              .to.emit(yieldBoostStakingUSDC, "StakePositionCreated")
              .withArgs(goldenBanker.address, expectedStakedAmount);

            await expect(depositTx1)
              .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
              .withArgs(goldenBanker.address, 0, expectedStakedAmount);

            await expect(depositTx1)
              .to.emit(lendingPool, "LockMeldBankerNFT")
              .withArgs(
                await usdc.getAddress(),
                goldenBanker.address,
                goldenBankerTokenId,
                MeldBankerType.GOLDEN,
                Action.DEPOSIT
              );

            await expect(depositTx1)
              .to.emit(lendingPool, "RefreshYieldBoostAmount")
              .withArgs(
                await usdc.getAddress(),
                goldenBanker.address,
                expectedStakedAmount
              );

            // Second Deposit
            const depositTx2 = await lendingPool
              .connect(goldenBanker)
              .deposit(
                await usdc.getAddress(),
                depositAmount,
                goldenBanker.address,
                true,
                goldenBankerTokenId
              );

            // Hardhat time module. Gets timestamp of latest block.
            const blockTimestamp = await time.latest();

            // Calculate expected reserve data after deposit
            const expectedReserveDataAfterDeposit =
              calcExpectedReserveDataAfterDeposit(
                depositAmount,
                reserveDataBeforeDeposit,
                BigInt(blockTimestamp)
              );

            // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
            const contractInstanceWithLibraryABI = await ethers.getContractAt(
              "ReserveLogic",
              await lendingPool.getAddress(),
              owner
            );

            await expect(depositTx2)
              .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
              .withArgs(
                await usdc.getAddress(),
                expectedReserveDataAfterDeposit.liquidityRate,
                expectedReserveDataAfterDeposit.stableBorrowRate,
                expectedReserveDataAfterDeposit.variableBorrowRate,
                expectedReserveDataAfterDeposit.liquidityIndex,
                expectedReserveDataAfterDeposit.variableBorrowIndex
              );

            // The amount is subtracted from the currentAllowance, so in this case the amount should be set to 0 just before the transfer
            await expect(depositTx2)
              .to.emit(usdc, "Approval")
              .withArgs(
                goldenBanker.address,
                await lendingPool.getAddress(),
                0
              );

            await expect(depositTx2)
              .to.emit(usdc, "Transfer")
              .withArgs(
                goldenBanker.address,
                reserveDataBeforeDeposit.mTokenAddress,
                depositAmount
              );

            await expect(depositTx2)
              .to.emit(mUSDC, "Transfer")
              .withArgs(ZeroAddress, goldenBanker.address, depositAmount);

            await expect(depositTx2)
              .to.emit(mUSDC, "Mint")
              .withArgs(
                goldenBanker.address,
                depositAmount,
                expectedReserveDataAfterDeposit.liquidityIndex
              );

            // This event should NOT be emitted for second deposit of asset by the same address
            await expect(depositTx2).to.not.emit(
              lendingPool,
              "ReserveUsedAsCollateralEnabled"
            );

            // MELD Banker second deposit, so should only emit StakePositionUpdated and RefreshYieldBoostAmount events
            const meldBankerData2 = await lendingPool.userMeldBankerData(
              goldenBanker.address
            );
            const yieldBoostMultiplier =
              await lendingPool.yieldBoostMultipliers(
                meldBankerData2.meldBankerType,
                meldBankerData2.action
              );

            const expectedOldStakedAmount =
              depositAmount.percentMul(yieldBoostMultiplier);

            const meldBankerMTokenBalance = await mUSDC.balanceOf(
              goldenBanker.address
            );
            const expectedNewStakedAmount =
              meldBankerMTokenBalance.percentMul(yieldBoostMultiplier);

            await expect(depositTx2).to.not.emit(
              yieldBoostStakingUSDC,
              "StakePositionCreated"
            );
            await expect(depositTx2)
              .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
              .withArgs(
                goldenBanker.address,
                expectedOldStakedAmount,
                expectedNewStakedAmount
              );

            await expect(depositTx2).to.not.emit(
              lendingPool,
              "LockMeldBankerNFT"
            );

            await expect(depositTx2)
              .to.emit(lendingPool, "RefreshYieldBoostAmount")
              .withArgs(
                await usdc.getAddress(),
                goldenBanker.address,
                expectedNewStakedAmount
              );

            // The Deposit event is emitted by the DepositLogic.sol library, so we need to get the contract instance with the DepositLogic ABI
            const contractInstanceWithDepositLibraryABI =
              await ethers.getContractAt(
                "DepositLogic",
                await lendingPool.getAddress(),
                owner
              );

            await expect(depositTx2)
              .to.emit(contractInstanceWithDepositLibraryABI, "Deposit")
              .withArgs(
                await usdc.getAddress(),
                goldenBanker.address,
                goldenBanker.address,
                depositAmount
              );
          });

          it("Should update state correctly when a when a Golden Banker holder deposits a yield boost token for the second time", async function () {
            //First time an address deposits a reserve, it's marked as collateral. After that, it's just a liquidity deposit.

            // First deploy protocol, create and initialize the reserve
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              yieldBoostStorageUSDC,
              usdc,
              owner,
              goldenBanker,
              goldenBankerTokenId,
            } = await loadFixture(setUpTestFixture);

            // Set up Deposit. factor = 3 because deposit and approval amount are different
            const depositAmount = await allocateAndApproveTokens(
              usdc,
              owner,
              goldenBanker,
              lendingPool,
              1000n,
              3n
            );

            // First Deposit
            await lendingPool
              .connect(goldenBanker)
              .deposit(
                await usdc.getAddress(),
                depositAmount,
                goldenBanker.address,
                true,
                goldenBankerTokenId
              );

            // Get reserve data before deposit
            const reserveDataBeforeDeposit: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Get user data before deposit
            const userDataBeforeDeposit: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              goldenBanker.address
            );

            const depositAmount2 = depositAmount * 2n;

            // Second Deposit
            await lendingPool
              .connect(goldenBanker)
              .deposit(
                await usdc.getAddress(),
                depositAmount2,
                goldenBanker.address,
                true,
                goldenBankerTokenId
              );

            // Hardhat time module. Gets timestamp of latest block.
            const blockTimestamp = await time.latest();

            // Calculate expected reserve data after deposit
            const expectedReserveDataAfterDeposit: ReserveData =
              calcExpectedReserveDataAfterDeposit(
                depositAmount2,
                reserveDataBeforeDeposit,
                BigInt(blockTimestamp)
              );

            // Get reserve data after deposit
            const reserveDataAfterDeposit: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Calculate expected user data after deposit
            const expectedUserDataAfterDeposit: UserReserveData =
              calcExpectedUserDataAfterDeposit(
                depositAmount2,
                reserveDataBeforeDeposit,
                reserveDataAfterDeposit,
                userDataBeforeDeposit,
                BigInt(blockTimestamp)
              );

            // Get user data after deposit
            const userDataAfterDeposit: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              goldenBanker.address
            );

            expectEqual(
              reserveDataAfterDeposit,
              expectedReserveDataAfterDeposit
            );
            expectEqual(userDataAfterDeposit, expectedUserDataAfterDeposit);
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
            expect(meldBankerData.action).to.equal(Action.DEPOSIT);

            const yieldBoostMultiplier =
              await lendingPool.yieldBoostMultipliers(
                meldBankerData.meldBankerType,
                meldBankerData.action
              );
            const expectedStakedAmount =
              depositAmount.percentMul(yieldBoostMultiplier) +
              depositAmount2.percentMul(yieldBoostMultiplier);

            expect(
              await yieldBoostStorageUSDC.getStakerStakedAmount(
                goldenBanker.address
              )
            ).to.equal(expectedStakedAmount);
          });

          it("Should update token balances correctly when a when a Golden Banker holder deposits a yield boost token for the second time", async function () {
            // First deploy protocol, create and initialize the reserve
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              usdc,
              owner,
              goldenBanker,
              goldenBankerTokenId,
            } = await loadFixture(setUpTestFixture);

            // Set up Deposit. factor = 3 because deposit and approval amount are different
            const depositAmount = await allocateAndApproveTokens(
              usdc,
              owner,
              goldenBanker,
              lendingPool,
              1000n,
              3n
            );

            // Get reserve data before deposit
            const reserveDataBeforeDeposit: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Instantiate mUSDC contract
            const mUSDC = await ethers.getContractAt(
              "MToken",
              reserveDataBeforeDeposit.mTokenAddress
            );

            // First Deposit
            await lendingPool
              .connect(goldenBanker)
              .deposit(
                await usdc.getAddress(),
                depositAmount,
                goldenBanker.address,
                true,
                goldenBankerTokenId
              );

            const depositAmount2 = depositAmount * 2n;

            // Second Deposit
            await lendingPool
              .connect(goldenBanker)
              .deposit(
                await usdc.getAddress(),
                depositAmount2,
                goldenBanker.address,
                true,
                goldenBankerTokenId
              );

            expect(await mUSDC.balanceOf(goldenBanker.address)).to.equal(
              depositAmount + depositAmount2
            );

            expect(await usdc.balanceOf(await mUSDC.getAddress())).to.equal(
              depositAmount + depositAmount2
            );
          });
        }
      ); // End Multiple Deposits of Same Yield Boost Asset by Same Depositor Context

      context(
        "Multiple Deposits of Different Yield Boost Assets by Same Depositor",
        async function () {
          it("Should emit the correct events when a Golden Banker holder deposits a yield boost token for the second time but doesn't use NFT tokenId", async function () {
            //First time an address deposits a reserve, it's marked as collateral. After that, it's just a liquidity deposit

            // First deploy protocol, create and initialize the reserve
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              yieldBoostStakingUSDC,
              yieldBoostStakingDAI,
              usdc,
              dai,
              owner,
              goldenBanker,
              goldenBankerTokenId,
            } = await loadFixture(setUpTestFixture);

            // Set up Deposit. factor = 0 because deposit and approval amount are same
            const depositAmountUSDC = await allocateAndApproveTokens(
              usdc,
              owner,
              goldenBanker,
              lendingPool,
              1000n,
              0n
            );

            // First Deposit
            const depositTx1 = await lendingPool
              .connect(goldenBanker)
              .deposit(
                await usdc.getAddress(),
                depositAmountUSDC,
                goldenBanker.address,
                true,
                goldenBankerTokenId
              );

            // MELD Banker first deposit, so should emit StakePositionCreated, StakePositionUpdated , RefreshYieldBoostAmount and LockMeldBankerNFT events
            const meldBankerData1 = await lendingPool.userMeldBankerData(
              goldenBanker.address
            );
            const yieldBoostMultiplier1 =
              await lendingPool.yieldBoostMultipliers(
                meldBankerData1.meldBankerType,
                meldBankerData1.action
              );
            const expectedStakedAmount = depositAmountUSDC.percentMul(
              yieldBoostMultiplier1
            );

            await expect(depositTx1)
              .to.emit(yieldBoostStakingUSDC, "StakePositionCreated")
              .withArgs(goldenBanker.address, expectedStakedAmount);

            await expect(depositTx1)
              .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
              .withArgs(goldenBanker.address, 0, expectedStakedAmount);

            await expect(depositTx1)
              .to.emit(lendingPool, "LockMeldBankerNFT")
              .withArgs(
                await usdc.getAddress(),
                goldenBanker.address,
                goldenBankerTokenId,
                MeldBankerType.GOLDEN,
                Action.DEPOSIT
              );

            await expect(depositTx1)
              .to.emit(lendingPool, "RefreshYieldBoostAmount")
              .withArgs(
                await usdc.getAddress(),
                goldenBanker.address,
                expectedStakedAmount
              );

            // Set up Deposit. factor = 0 because deposit and approval amount are same
            const depositAmountDAI = await allocateAndApproveTokens(
              dai,
              owner,
              goldenBanker,
              lendingPool,
              1000n,
              0n
            );

            // Get reserve data before deposit
            const reserveDataBeforeDeposit: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await dai.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Instantiate mDAI contract
            const mDAI = await ethers.getContractAt(
              "MToken",
              reserveDataBeforeDeposit.mTokenAddress
            );

            // Second Deposit
            const depositTx2 = await lendingPool
              .connect(goldenBanker)
              .deposit(
                await dai.getAddress(),
                depositAmountDAI,
                goldenBanker.address,
                false,
                0n
              );

            // Hardhat time module. Gets timestamp of latest block.
            const blockTimestamp = await time.latest();

            // Calculate expected reserve data after deposit
            const expectedReserveDataAfterDeposit =
              calcExpectedReserveDataAfterDeposit(
                depositAmountDAI,
                reserveDataBeforeDeposit,
                BigInt(blockTimestamp)
              );

            // ReserveDataUpdated Event is defined in library ReserveLogic.sol, so we need to get the contract instance with the ReserveLogic ABI
            const contractInstanceWithLibraryABI = await ethers.getContractAt(
              "ReserveLogic",
              await lendingPool.getAddress(),
              owner
            );

            await expect(depositTx2)
              .to.emit(contractInstanceWithLibraryABI, "ReserveDataUpdated")
              .withArgs(
                await dai.getAddress(),
                expectedReserveDataAfterDeposit.liquidityRate,
                expectedReserveDataAfterDeposit.stableBorrowRate,
                expectedReserveDataAfterDeposit.variableBorrowRate,
                expectedReserveDataAfterDeposit.liquidityIndex,
                expectedReserveDataAfterDeposit.variableBorrowIndex
              );

            // The amount is subtracted from the currentAllowance, so in this case the amount should be set to 0 just before the transfer
            await expect(depositTx2)
              .to.emit(dai, "Approval")
              .withArgs(
                goldenBanker.address,
                await lendingPool.getAddress(),
                0
              );

            await expect(depositTx2)
              .to.emit(dai, "Transfer")
              .withArgs(
                goldenBanker.address,
                reserveDataBeforeDeposit.mTokenAddress,
                depositAmountDAI
              );

            await expect(depositTx2)
              .to.emit(mDAI, "Transfer")
              .withArgs(ZeroAddress, goldenBanker.address, depositAmountDAI);

            await expect(depositTx2)
              .to.emit(mDAI, "Mint")
              .withArgs(
                goldenBanker.address,
                depositAmountDAI,
                expectedReserveDataAfterDeposit.liquidityIndex
              );

            // This event should NOT be emitted for second deposit of asset by the same address
            await expect(depositTx2).to.not.emit(
              lendingPool,
              "ReserveUsedAsCollateralEnabled"
            );

            // MELD Banker second deposit but didn't use NFT tokenId, so gets treated as a regular user
            await expect(depositTx2)
              .to.emit(yieldBoostStakingDAI, "StakePositionCreated")
              .withArgs(goldenBanker.address, depositAmountDAI);

            await expect(depositTx2)
              .to.emit(yieldBoostStakingDAI, "StakePositionUpdated")
              .withArgs(goldenBanker.address, 0, depositAmountDAI);

            await expect(depositTx2).to.not.emit(
              lendingPool,
              "LockMeldBankerNFT"
            );

            await expect(depositTx2)
              .to.emit(lendingPool, "RefreshYieldBoostAmount")
              .withArgs(
                await dai.getAddress(),
                goldenBanker.address,
                depositAmountDAI
              );

            // The Deposit event is emitted by the DepositLogic.sol library, so we need to get the contract instance with the DepositLogic ABI
            const contractInstanceWithDepositLibraryABI =
              await ethers.getContractAt(
                "DepositLogic",
                await lendingPool.getAddress(),
                owner
              );

            await expect(depositTx2)
              .to.emit(contractInstanceWithDepositLibraryABI, "Deposit")
              .withArgs(
                await dai.getAddress(),
                goldenBanker.address,
                goldenBanker.address,
                depositAmountDAI
              );
          });

          it("Should update state correctly when a when a Golden Banker holder deposits a yield boost token for the second time but doesn't use NFT tokenId", async function () {
            //First time an address deposits a reserve, it's marked as collateral. After that, it's just a liquidity deposit.

            // First deploy protocol, create and initialize the reserve
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              yieldBoostStorageUSDC,
              yieldBoostStorageDAI,
              usdc,
              dai,
              owner,
              goldenBanker,
              goldenBankerTokenId,
            } = await loadFixture(setUpTestFixture);

            // Set up Deposit. factor = 2 because deposit and approval amount are different
            const depositAmount = await allocateAndApproveTokens(
              usdc,
              owner,
              goldenBanker,
              lendingPool,
              1000n,
              3n
            );

            // First Deposit
            await lendingPool
              .connect(goldenBanker)
              .deposit(
                await usdc.getAddress(),
                depositAmount,
                goldenBanker.address,
                true,
                goldenBankerTokenId
              );

            // Set up Deposit. factor = 0 because deposit and approval amount are same
            const depositAmountDAI = await allocateAndApproveTokens(
              dai,
              owner,
              goldenBanker,
              lendingPool,
              1000n,
              0n
            );

            // Get reserve data before deposit
            const reserveDataBeforeDeposit: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await dai.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Get user data before deposit
            const userDataBeforeDeposit: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await dai.getAddress(),
              goldenBanker.address
            );

            // Second Deposit
            await lendingPool
              .connect(goldenBanker)
              .deposit(
                await dai.getAddress(),
                depositAmountDAI,
                goldenBanker.address,
                false,
                0n
              );

            // Hardhat time module. Gets timestamp of latest block.
            const blockTimestamp = await time.latest();

            // Calculate expected reserve data after deposit
            const expectedReserveDataAfterDeposit: ReserveData =
              calcExpectedReserveDataAfterDeposit(
                depositAmountDAI,
                reserveDataBeforeDeposit,
                BigInt(blockTimestamp)
              );

            // Get reserve data after deposit
            const reserveDataAfterDeposit: ReserveData = await getReserveData(
              meldProtocolDataProvider,
              await dai.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

            // Calculate expected user data after deposit
            const expectedUserDataAfterDeposit: UserReserveData =
              calcExpectedUserDataAfterDeposit(
                depositAmountDAI,
                reserveDataBeforeDeposit,
                reserveDataAfterDeposit,
                userDataBeforeDeposit,
                BigInt(blockTimestamp),
                false
              );

            // Get user data after deposit
            const userDataAfterDeposit: UserReserveData = await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await dai.getAddress(),
              goldenBanker.address
            );

            expectEqual(
              reserveDataAfterDeposit,
              expectedReserveDataAfterDeposit
            );
            expectEqual(userDataAfterDeposit, expectedUserDataAfterDeposit);
            expect(await lendingPool.isUsingMeldBanker(goldenBanker.address)).to
              .be.true;

            expect(await lendingPool.isMeldBankerBlocked(goldenBankerTokenId))
              .to.be.true;

            const meldBankerData = await lendingPool.userMeldBankerData(
              goldenBanker.address
            );
            expect(meldBankerData.tokenId).to.equal(goldenBankerTokenId);
            expect(meldBankerData.asset).to.equal(await usdc.getAddress());
            expect(meldBankerData.asset).to.not.equal(await dai.getAddress());
            expect(meldBankerData.meldBankerType).to.equal(
              MeldBankerType.GOLDEN
            );
            expect(meldBankerData.action).to.equal(Action.DEPOSIT);

            const yieldBoostMultiplier =
              await lendingPool.yieldBoostMultipliers(
                meldBankerData.meldBankerType,
                meldBankerData.action
              );
            const expectedStakedAmountUSDC =
              depositAmount.percentMul(yieldBoostMultiplier);

            expect(
              await yieldBoostStorageUSDC.getStakerStakedAmount(
                goldenBanker.address
              )
            ).to.equal(expectedStakedAmountUSDC);

            expect(
              await yieldBoostStorageDAI.getStakerStakedAmount(
                goldenBanker.address
              )
            ).to.equal(depositAmountDAI);
          });

          it("Should update token balances correctly when a when a Golden Banker holder deposits a yield boost token for the second time but doesn't use NFT tokenId", async function () {
            // First deploy protocol, create and initialize the reserve
            const {
              lendingPool,
              meldProtocolDataProvider,
              lendingRateOracleAggregator,
              usdc,
              dai,
              owner,
              goldenBanker,
              goldenBankerTokenId,
            } = await loadFixture(setUpTestFixture);

            // Set up Deposit. factor = 0 because deposit and approval amount are same
            const depositAmountUSDC = await allocateAndApproveTokens(
              usdc,
              owner,
              goldenBanker,
              lendingPool,
              1000n,
              3n
            );

            // Get USDC reserve data before deposit
            const reserveUSDCDataBeforeDeposit: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await usdc.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Instantiate mUSDC contract
            const mUSDC = await ethers.getContractAt(
              "MToken",
              reserveUSDCDataBeforeDeposit.mTokenAddress
            );

            // First Deposit
            await lendingPool
              .connect(goldenBanker)
              .deposit(
                await usdc.getAddress(),
                depositAmountUSDC,
                goldenBanker.address,
                true,
                goldenBankerTokenId
              );

            // Get DAI reserve data before deposit
            const reserveDAIDataBeforeDeposit: ReserveData =
              await getReserveData(
                meldProtocolDataProvider,
                await dai.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

            // Instantiate mDAI contract
            const mDAI = await ethers.getContractAt(
              "MToken",
              reserveDAIDataBeforeDeposit.mTokenAddress
            );

            // Set up Deposit. factor = 0 because deposit and approval amount are same
            const depositAmountDAI = await allocateAndApproveTokens(
              dai,
              owner,
              goldenBanker,
              lendingPool,
              1000n,
              0n
            );

            // Second Deposit
            await lendingPool
              .connect(goldenBanker)
              .deposit(
                await dai.getAddress(),
                depositAmountDAI,
                goldenBanker.address,
                true,
                0n
              );

            expect(await mUSDC.balanceOf(goldenBanker.address)).to.equal(
              depositAmountUSDC
            );

            expect(await usdc.balanceOf(await mUSDC.getAddress())).to.equal(
              depositAmountUSDC
            );

            expect(await mDAI.balanceOf(goldenBanker.address)).to.equal(
              depositAmountDAI
            );

            expect(await dai.balanceOf(await mDAI.getAddress())).to.equal(
              depositAmountDAI
            );
          });
        }
      ); // End Multiple Deposits of Different Yield Boost Assets by Same Depositor Context
    }); // End Golden MELD Banker Context
  }); // End Happy Flow Test Cases Context

  context("Error Test Cases", async function () {
    it("Should revert if the asset address is the zero address", async function () {
      // First deploy protocol, create and initialize the reserve
      const { lendingPool, usdc, owner, depositor } =
        await loadFixture(setUpTestFixture);

      // Set up USDC Deposit. factor = 0 because deposit and approval amount are the same
      const depositAmount = await allocateAndApproveTokens(
        usdc,
        owner,
        depositor,
        lendingPool,
        1000n,
        0n
      );

      // Attempt to deposit
      await expect(
        lendingPool
          .connect(depositor)
          .deposit(
            ethers.ZeroAddress,
            depositAmount,
            depositor.address,
            true,
            0
          )
      ).to.revertedWith(ProtocolErrors.INVALID_ADDRESS);
    });

    it("Should revert if the onBehalfOf address is the zero address", async function () {
      // First deploy protocol, create and initialize the reserve
      const { lendingPool, usdc, owner, depositor } =
        await loadFixture(setUpTestFixture);

      // Set up USDC Deposit. factor = 0 because deposit and approval amount are the same
      const depositAmount = await allocateAndApproveTokens(
        usdc,
        owner,
        depositor,
        lendingPool,
        1000n,
        0n
      );

      // Attempt to deposit
      await expect(
        lendingPool
          .connect(depositor)
          .deposit(
            await usdc.getAddress(),
            depositAmount,
            ethers.ZeroAddress,
            true,
            0
          )
      ).to.revertedWith(ProtocolErrors.INVALID_ADDRESS);
    });

    it("Should revert if amount is zero", async function () {
      // First deploy protocol, create and initialize the reserve
      const { lendingPool, usdc, depositor } =
        await loadFixture(setUpTestFixture);

      // Attempt to deposit
      await expect(
        lendingPool
          .connect(depositor)
          .deposit(await usdc.getAddress(), 0, depositor.address, true, 0)
      ).to.revertedWith(ProtocolErrors.VL_INVALID_AMOUNT);
    });

    it("Should revert if reserve is not active", async function () {
      // First deploy protocol, create and initialize the reserve
      const {
        lendingPool,
        lendingPoolConfigurator,
        usdc,
        owner,
        depositor,
        poolAdmin,
      } = await loadFixture(setUpTestFixture);

      // Deactivate reserve
      await lendingPoolConfigurator
        .connect(poolAdmin)
        .deactivateReserve(await usdc.getAddress());

      // Set up USDC Deposit. factor = 0 because deposit and approval amount are the same
      const depositAmount = await allocateAndApproveTokens(
        usdc,
        owner,
        depositor,
        lendingPool,
        1000n,
        0n
      );

      // Attempt to deposit
      await expect(
        lendingPool
          .connect(depositor)
          .deposit(
            await usdc.getAddress(),
            depositAmount,
            depositor.address,
            true,
            0
          )
      ).to.revertedWith(ProtocolErrors.VL_NO_ACTIVE_RESERVE);
    });

    it("Should revert if reserve is frozen", async function () {
      // First deploy protocol, create and initialize the reserve
      const {
        lendingPool,
        lendingPoolConfigurator,
        usdc,
        owner,
        depositor,
        poolAdmin,
      } = await loadFixture(setUpTestFixture);

      // Deactivate reserve
      await lendingPoolConfigurator
        .connect(poolAdmin)
        .freezeReserve(await usdc.getAddress());

      // Set up USDC Deposit. factor = 0 because deposit and approval amount are the same
      const depositAmount = await allocateAndApproveTokens(
        usdc,
        owner,
        depositor,
        lendingPool,
        1000n,
        0n
      );

      // Attempt to deposit
      await expect(
        lendingPool
          .connect(depositor)
          .deposit(
            await usdc.getAddress(),
            depositAmount,
            depositor.address,
            true,
            0
          )
      ).to.revertedWith(ProtocolErrors.VL_RESERVE_FROZEN);
    });

    it("Should revert if LendingPool contract doesn't have allowance to transfer any asset tokens owned by depositor", async function () {
      // It is the token that reverts, not the protocol. However, this test case checks that the protocol itself does not panic and that
      // the token revert is propagated.

      // First deploy protocol, create and initialize the reserve
      const { lendingPool, usdc, depositor, owner } =
        await loadFixture(setUpTestFixture);

      // Set up deposit
      const depositAmount = await convertToCurrencyDecimals(
        await usdc.getAddress(),
        "1000"
      ); // 1000 USDC

      // Transfer but don't approve tokens
      await usdc.connect(owner).transfer(depositor.address, depositAmount);

      // Attempt to deposit
      await expect(
        lendingPool
          .connect(depositor)
          .deposit(
            await usdc.getAddress(),
            depositAmount,
            depositor.address,
            true,
            0
          )
      ).to.revertedWith("ERC20: insufficient allowance");
    });

    it("Should revert if LendingPool contract is approved by depositor to transfer a lower amount of tokens than the deposit amount", async function () {
      // It is the token that reverts, not the protocol. However, this test case checks that the protocol itself does not panic and that
      // the token revert is propagated.

      // First deploy protocol, create and initialize the reserve
      const { lendingPool, usdc, owner, depositor } =
        await loadFixture(setUpTestFixture);

      // Set up deposit
      const depositAmount = await convertToCurrencyDecimals(
        await usdc.getAddress(),
        "1000"
      ); // 1000 USDC

      // Make sure depositor has enough USDC
      await usdc.connect(owner).transfer(depositor.address, depositAmount);
      expect(await usdc.balanceOf(depositor.address)).to.equal(depositAmount);

      // Approve lower amount than deposit amount
      await usdc
        .connect(depositor)
        .approve(await lendingPool.getAddress(), depositAmount / 2n);
      expect(
        await usdc.allowance(depositor.address, await lendingPool.getAddress())
      ).to.equal(depositAmount / 2n);

      // Attempt to deposit
      await expect(
        lendingPool
          .connect(depositor)
          .deposit(
            await usdc.getAddress(),
            depositAmount,
            depositor.address,
            true,
            0
          )
      ).to.revertedWith("ERC20: insufficient allowance");
    });

    it("Should revert if depositor does not own asset to be deposited", async function () {
      // It is the token that reverts, not the protocol. However, this test case checks that the protocol itself does not panic and that
      // the token revert is propagated.

      // First deploy protocol, create and initialize the reserve
      const { lendingPool, usdc, depositor } =
        await loadFixture(setUpTestFixture);

      // Set up deposit
      const depositAmount = await convertToCurrencyDecimals(
        await usdc.getAddress(),
        "1000"
      ); // 1000 USDC

      expect(await usdc.balanceOf(depositor.address)).to.equal(0);

      // Attempt to deposit
      await expect(
        lendingPool
          .connect(depositor)
          .deposit(
            await usdc.getAddress(),
            depositAmount,
            depositor.address,
            true,
            0
          )
      ).to.revertedWith(ProtocolErrors.VL_NOT_ENOUGH_AVAILABLE_USER_BALANCE);
    });

    it("Should revert if the deposited asset is not supported by the protocol", async function () {
      // It is the token that reverts, not the protocol. However, this test case checks that the protocol itself does not panic and that
      // the token revert is propagated.

      // First deploy protocol, create and initialize the reserve
      const { lendingPool, unsupportedToken, depositor } =
        await loadFixture(setUpTestFixture);

      // Set up deposit
      const depositAmount = await convertToCurrencyDecimals(
        await unsupportedToken.getAddress(),
        "1000"
      ); // 1000 USDC

      expect(await unsupportedToken.balanceOf(depositor.address)).to.equal(0);

      // Attempt to deposit
      await expect(
        lendingPool
          .connect(depositor)
          .deposit(
            await unsupportedToken.getAddress(),
            depositAmount,
            depositor.address,
            true,
            0
          )
      ).to.revertedWith(ProtocolErrors.VL_NO_ACTIVE_RESERVE);
    });

    it("Should revert if deposit amount by a single user reaches the supply cap", async function () {
      // First deploy protocol, create and initialize the reserve
      const {
        lendingPool,
        lendingPoolConfigurator,
        meldPriceOracle,
        usdc,
        owner,
        depositor,
        poolAdmin,
        oracleAdmin,
      } = await loadFixture(setUpTestFixture);

      // Set up USDC Deposit. factor = 2 because two deposits are made
      const depositAmount = await allocateAndApproveTokens(
        usdc,
        owner,
        depositor,
        lendingPool,
        1000n,
        2n
      );

      const newSupplyCapUSD = 1000n;

      // Set the USDC supply cap to 1000 USD
      await lendingPoolConfigurator
        .connect(poolAdmin)
        .setSupplyCapUSD(await usdc.getAddress(), newSupplyCapUSD);

      // Set the price oracle to 1 USDC = 1 USD (18 decimals)
      await meldPriceOracle
        .connect(oracleAdmin)
        .setAssetPrice(await usdc.getAddress(), _1e18);

      // Deposit 1000 USDC
      await lendingPool
        .connect(depositor)
        .deposit(
          await usdc.getAddress(),
          depositAmount,
          depositor.address,
          true,
          0
        );

      // Attempt to deposit 1 more USDC
      await expect(
        lendingPool
          .connect(depositor)
          .deposit(await usdc.getAddress(), 1n, depositor.address, true, 0)
      ).to.revertedWith(ProtocolErrors.VL_RESERVE_SUPPLY_CAP_REACHED);
    });

    it("Should revert if deposit amount by multiple users reaches the supply cap", async function () {
      // First deploy protocol, create and initialize the reserve
      const {
        lendingPool,
        lendingPoolConfigurator,
        meldPriceOracle,
        usdc,
        owner,
        depositor,
        rando,
        poolAdmin,
        oracleAdmin,
      } = await loadFixture(setUpTestFixture);

      // Set up USDC Deposit. factor = 0 because deposit and approval amount are the same
      const depositAmount = await allocateAndApproveTokens(
        usdc,
        owner,
        depositor,
        lendingPool,
        1000n,
        0n
      );

      const newSupplyCapUSD = 1000n;

      // Set the supply cap to 1000 USDC
      await lendingPoolConfigurator
        .connect(poolAdmin)
        .setSupplyCapUSD(await usdc.getAddress(), newSupplyCapUSD);

      // Set the price oracle to 1 USDC = 1 USD (18 decimals)
      await meldPriceOracle
        .connect(oracleAdmin)
        .setAssetPrice(await usdc.getAddress(), _1e18);

      // Deposit 1000 USDC
      await lendingPool
        .connect(depositor)
        .deposit(
          await usdc.getAddress(),
          depositAmount,
          depositor.address,
          true,
          0
        );

      // Attempt to deposit 1 more USDC from another user
      // Set up USDC Deposit. factor = 0 because deposit and approval amount are the same
      const depositAmount2 = await allocateAndApproveTokens(
        usdc,
        owner,
        rando,
        lendingPool,
        1n,
        0n
      );
      await expect(
        lendingPool
          .connect(rando)
          .deposit(
            await usdc.getAddress(),
            depositAmount2,
            rando.address,
            true,
            0
          )
      ).to.revertedWith(ProtocolErrors.VL_RESERVE_SUPPLY_CAP_REACHED);
    });

    it("Should revert if depositer asset whole balance (MaxUint256) reaches the supply cap", async function () {
      // First deploy protocol, create and initialize the reserve
      const {
        lendingPool,
        lendingPoolConfigurator,
        meldPriceOracle,
        usdc,
        owner,
        depositor,
        poolAdmin,
        oracleAdmin,
      } = await loadFixture(setUpTestFixture);

      // Set up USDC Deposit.
      await allocateAndApproveTokens(
        usdc,
        owner,
        depositor,
        lendingPool,
        1000n,
        2n
      );

      const newSupplyCapUSD = 1000n;

      // Set the USDC supply cap to 1000 USD
      await lendingPoolConfigurator
        .connect(poolAdmin)
        .setSupplyCapUSD(await usdc.getAddress(), newSupplyCapUSD);

      // Set the price oracle to 1 USDC = 1 USD (18 decimals)
      await meldPriceOracle
        .connect(oracleAdmin)
        .setAssetPrice(await usdc.getAddress(), _1e18);

      // Attempt to deposit full asset balance
      await expect(
        lendingPool
          .connect(depositor)
          .deposit(
            await usdc.getAddress(),
            MaxUint256,
            depositor.address,
            true,
            0
          )
      ).to.revertedWith(ProtocolErrors.VL_RESERVE_SUPPLY_CAP_REACHED);
    });

    context("Meld Banker NFT and Yield Boost", async function () {
      it("Should revert if  NFT tokenId is provided but yield boost is not enabled", async function () {
        // First deploy protocol, create and initialize the reserve
        const {
          lendingPool,
          meld,
          owner,
          depositor,
          meldBanker,
          meldBankerTokenId,
        } = await loadFixture(setUpTestFixture);

        // Set up USDC Deposit. factor = 0 because deposit and approval amount are the same
        const depositAmount = await allocateAndApproveTokens(
          meld,
          owner,
          depositor,
          lendingPool,
          1000n,
          0n
        );

        // Attempt to deposit
        await expect(
          lendingPool
            .connect(meldBanker)
            .deposit(
              await meld.getAddress(),
              depositAmount,
              meldBanker.address,
              true,
              meldBankerTokenId
            )
        ).to.revertedWith(ProtocolErrors.LP_YIELD_BOOST_STAKING_NOT_ENABLED);

        // Attempt to deposit
        await expect(
          lendingPool
            .connect(meldBanker)
            .deposit(
              ZeroAddress,
              depositAmount,
              meldBanker.address,
              true,
              meldBankerTokenId
            )
        ).to.revertedWith(ProtocolErrors.LP_YIELD_BOOST_STAKING_NOT_ENABLED);
      });

      it("Should revert if MELD Banker holder is already using NFT", async function () {
        const { lendingPool, usdc, dai, owner, meldBanker, meldBankerTokenId } =
          await loadFixture(setUpTestFixture);

        // Set up Deposit.
        const depositAmountUSDC = await allocateAndApproveTokens(
          usdc,
          owner,
          meldBanker,
          lendingPool,
          1000n,
          0n
        );

        // First Deposit
        await lendingPool
          .connect(meldBanker)
          .deposit(
            await usdc.getAddress(),
            depositAmountUSDC,
            meldBanker.address,
            true,
            meldBankerTokenId
          );

        // Set up Deposit.
        const depositAmountDAI = await allocateAndApproveTokens(
          dai,
          owner,
          meldBanker,
          lendingPool,
          1000n,
          0n
        );

        // Second Deposit for another yield boost token
        await expect(
          lendingPool
            .connect(meldBanker)
            .deposit(
              await dai.getAddress(),
              depositAmountDAI,
              meldBanker.address,
              true,
              meldBankerTokenId
            )
        ).to.revertedWith(ProtocolErrors.LP_MELD_BANKER_NFT_LOCKED);
      });

      it("Should revert if Golden Banker holder is already using NFT", async function () {
        const {
          lendingPool,
          usdc,
          dai,
          owner,
          goldenBanker,
          goldenBankerTokenId,
        } = await loadFixture(setUpTestFixture);

        // Set up Deposit.
        const depositAmountUSDC = await allocateAndApproveTokens(
          usdc,
          owner,
          goldenBanker,
          lendingPool,
          1000n,
          0n
        );

        // First Deposit
        await lendingPool
          .connect(goldenBanker)
          .deposit(
            await usdc.getAddress(),
            depositAmountUSDC,
            goldenBanker.address,
            true,
            goldenBankerTokenId
          );

        // Set up Deposit.
        const depositAmountDAI = await allocateAndApproveTokens(
          dai,
          owner,
          goldenBanker,
          lendingPool,
          1000n,
          0n
        );

        // Second Deposit for another yield boost token
        await expect(
          lendingPool
            .connect(goldenBanker)
            .deposit(
              await dai.getAddress(),
              depositAmountDAI,
              goldenBanker.address,
              true,
              goldenBankerTokenId
            )
        ).to.revertedWith(ProtocolErrors.LP_MELD_BANKER_NFT_LOCKED);
      });

      it("Should revert if MELD Banker holder is already using the NFT for deposit of a different asset", async function () {
        //First time an address deposits a reserve, it's marked as collateral. After that, it's just a liquidity deposit

        // First deploy protocol, create and initialize the reserve
        const { lendingPool, usdc, dai, owner, meldBanker, meldBankerTokenId } =
          await loadFixture(setUpTestFixture);

        // Set up Deposit. factor = 0 because deposit and approval amount are same
        const depositAmountUSDC = await allocateAndApproveTokens(
          usdc,
          owner,
          meldBanker,
          lendingPool,
          1000n,
          0n
        );

        // First Deposit
        await lendingPool
          .connect(meldBanker)
          .deposit(
            await usdc.getAddress(),
            depositAmountUSDC,
            meldBanker.address,
            true,
            meldBankerTokenId
          );

        // Set up Deposit. factor = 0 because deposit and approval amount are same
        const depositAmountDAI = await allocateAndApproveTokens(
          dai,
          owner,
          meldBanker,
          lendingPool,
          1000n,
          0n
        );

        // Second Deposit
        await expect(
          lendingPool
            .connect(meldBanker)
            .deposit(
              await dai.getAddress(),
              depositAmountDAI,
              meldBanker.address,
              true,
              meldBankerTokenId
            )
        ).to.revertedWith(ProtocolErrors.LP_MELD_BANKER_NFT_LOCKED);
      });

      it("Should revert if Golden Banker holder is already using the NFT for deposit of a different asset", async function () {
        const {
          lendingPool,
          usdc,
          dai,
          owner,
          goldenBanker,
          goldenBankerTokenId,
        } = await loadFixture(setUpTestFixture);

        // Set up Deposit. factor = 0 because deposit and approval amount are same
        const depositAmountUSDC = await allocateAndApproveTokens(
          usdc,
          owner,
          goldenBanker,
          lendingPool,
          1000n,
          0n
        );

        // First Deposit
        await lendingPool
          .connect(goldenBanker)
          .deposit(
            await usdc.getAddress(),
            depositAmountUSDC,
            goldenBanker.address,
            true,
            goldenBankerTokenId
          );

        // Set up Deposit. factor = 0 because deposit and approval amount are same
        const depositAmountDAI = await allocateAndApproveTokens(
          dai,
          owner,
          goldenBanker,
          lendingPool,
          1000n,
          0n
        );

        // Second Deposit
        await expect(
          lendingPool
            .connect(goldenBanker)
            .deposit(
              await dai.getAddress(),
              depositAmountDAI,
              goldenBanker.address,
              true,
              goldenBankerTokenId
            )
        ).to.revertedWith(ProtocolErrors.LP_MELD_BANKER_NFT_LOCKED);
      });

      it("Should revert if MELD Banker holder is not owner of the provided tokenId", async function () {
        // First deploy protocol, create and initialize the reserve
        const {
          lendingPool,
          usdc,
          owner,
          depositor,
          meldBanker,
          goldenBankerTokenId,
        } = await loadFixture(setUpTestFixture);

        // Set up USDC Deposit. factor = 0 because deposit and approval amount are the same
        const depositAmount = await allocateAndApproveTokens(
          usdc,
          owner,
          depositor,
          lendingPool,
          1000n,
          0n
        );

        // Attempt to deposit
        await expect(
          lendingPool
            .connect(meldBanker)
            .deposit(
              await usdc.getAddress(),
              depositAmount,
              meldBanker.address,
              true,
              goldenBankerTokenId
            )
        ).to.revertedWith(ProtocolErrors.LP_NOT_OWNER_OF_MELD_BANKER_NFT);
      });

      it("Should revert if after deposit locking NFT, a different NFT is passed in the next deposit", async function () {
        // First deploy protocol, create and initialize the reserve
        const {
          lendingPool,
          usdc,
          owner,
          bankerAdmin,
          meldBanker,
          meldBankerTokenId,
          ...contracts
        } = await loadFixture(setUpTestFixture);

        // Set up Deposit. factor = 5 to give more tokens and approvals
        const depositAmountUSDC = await allocateAndApproveTokens(
          usdc,
          owner,
          meldBanker,
          lendingPool,
          1000n,
          5n
        );

        // First Deposit
        await lendingPool
          .connect(meldBanker)
          .deposit(
            await usdc.getAddress(),
            depositAmountUSDC,
            meldBanker.address,
            true,
            meldBankerTokenId
          );

        // Get a second NFT
        const goldenBankerTokenId2 = meldBankerTokenId + 100n;
        await contracts.meldBankerNft
          .connect(bankerAdmin)
          .mint(meldBanker, goldenBankerTokenId2, true);

        // Second Deposit
        await expect(
          lendingPool
            .connect(meldBanker)
            .deposit(
              await usdc.getAddress(),
              depositAmountUSDC,
              meldBanker.address,
              true,
              goldenBankerTokenId2
            )
        ).to.revertedWith(ProtocolErrors.LP_MELD_BANKER_NFT_LOCKED);
      });
      it("Should not lock NFT if deposit reverts", async function () {
        // First deploy protocol, create and initialize the reserve
        const { lendingPool, usdc, meldBanker, meldBankerTokenId } =
          await loadFixture(setUpTestFixture);

        expect(await lendingPool.isUsingMeldBanker(meldBanker.address)).to.be
          .false;

        expect(await lendingPool.isMeldBankerBlocked(meldBankerTokenId)).to.be
          .false;

        // Attempt to deposit
        await expect(
          lendingPool
            .connect(meldBanker)
            .deposit(
              await usdc.getAddress(),
              0n,
              meldBanker,
              true,
              meldBankerTokenId
            )
        ).to.revertedWith(ProtocolErrors.VL_INVALID_AMOUNT);

        expect(await lendingPool.isUsingMeldBanker(meldBanker.address)).to.be
          .false;

        expect(await lendingPool.isMeldBankerBlocked(meldBankerTokenId)).to.be
          .false;
      });
    });
  }); // End of Error Test Cases Context
}); // End of Deposit Describe
