import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { ZeroAddress } from "ethers";
import { expect } from "chai";
import {
  deployMockTokens,
  initializeReserves,
  allocateAndApproveTokens,
  calculateTokenAddresses,
  getBlockTimestamps,
  loadPoolConfigForEnv,
  setUpTestFixture,
  deployProtocolAndGetSignersFixture,
  getReservesConfigByPool,
} from "./helpers/utils/utils";
import { getReserveData, getUserData } from "./helpers/utils/helpers";
import {
  ReserveData,
  UserReserveData,
  BlockTimestamps,
  ReserveInitParams,
} from "./helpers/interfaces";
import {
  IReserveParams,
  iMeldPoolAssets,
  Configuration,
  MeldPools,
  ProtocolErrors,
  IMeldConfiguration,
  PoolConfiguration,
  RateMode,
} from "./helpers/types";
import { ONE_YEAR } from "./helpers/constants";
import { convertToCurrencyDecimals } from "./helpers/utils/contracts-helpers";
import {
  calcExpectedReserveDataAfterDeposit,
  calcExpectedUserDataAfterDeposit,
  calcExpectedReserveDataAfterBorrow,
} from "./helpers/utils/calculations";
import { LendingPool, LendingPoolConfigurator } from "../typechain-types";

describe("MeldProtocolDataProvider", function () {
  async function setUpTestMinimalFixture() {
    // Deploy protocol
    const {
      lendingPool,
      lendingPoolConfigurator,
      meldProtocolDataProvider,
      reserveLogic,
      lendingRateOracleAggregator,
      meldLendingRateOracle,
      usdcInterestRateStrategy,
      meldInterestRateStrategy,
      tetherInterestRateStrategy,
      owner,
      treasury,
      rando,
      meldPriceOracle,
      priceOracleAggregator,
    } = await deployProtocolAndGetSignersFixture();

    // Deploy mock asset tokens
    const { usdc, unsupportedToken, meld, tether } = await deployMockTokens();

    return {
      lendingPool,
      lendingPoolConfigurator,
      meldProtocolDataProvider,
      reserveLogic,
      lendingRateOracleAggregator,
      meldLendingRateOracle,
      usdcInterestRateStrategy,
      meldInterestRateStrategy,
      tetherInterestRateStrategy,
      usdc,
      unsupportedToken,
      meld,
      tether,
      owner,
      treasury,
      rando,
      meldPriceOracle,
      priceOracleAggregator,
    };
  }

  async function setUpTestInitNoConfigReserveFixture() {
    // Deploy protocol
    const {
      addressesProvider,
      lendingPool,
      lendingPoolConfigurator,
      meldProtocolDataProvider,
      reserveLogic,
      lendingRateOracleAggregator,
      meldLendingRateOracle,
      usdcInterestRateStrategy,
      meldInterestRateStrategy,
      tetherInterestRateStrategy,
      owner,
      poolAdmin,
      oracleAdmin,
      depositor,
      borrower,
      treasury,
      rando,
      meldPriceOracle,
      priceOracleAggregator,
    } = await deployProtocolAndGetSignersFixture();

    // Deploy mock asset tokens
    const { usdc, unsupportedToken, meld, tether } = await deployMockTokens();

    await addressesProvider.setMeldToken(meld);

    // Call before initializing the reserve so that nonce is correct
    const expectedTokenAddresses = await calculateTokenAddresses(
      lendingPoolConfigurator,
      ["USDC", "MELD", "USDT"]
    );

    // Initialize reserves
    const reserveInitParams: ReserveInitParams[] = [
      {
        underlyingAsset: usdc,
        interestRateStrategy: usdcInterestRateStrategy,
      },
      {
        underlyingAsset: meld,
        interestRateStrategy: meldInterestRateStrategy,
      },
      {
        underlyingAsset: tether,
        interestRateStrategy: tetherInterestRateStrategy,
      },
    ];

    await initializeReserves(
      reserveInitParams,
      treasury.address,
      lendingPoolConfigurator as LendingPoolConfigurator,
      poolAdmin
    );

    // Get pool configuration values
    const poolConfig: PoolConfiguration = loadPoolConfigForEnv();

    const {
      Mocks: { AllAssetsInitialPrices },
    } = poolConfig as IMeldConfiguration;

    // Set test price values
    await meldPriceOracle
      .connect(oracleAdmin)
      .setAssetPrice(await usdc.getAddress(), AllAssetsInitialPrices.USDC);

    await meldPriceOracle
      .connect(oracleAdmin)
      .setAssetPrice(await meld.getAddress(), AllAssetsInitialPrices.MELD);

    return {
      lendingPool,
      lendingPoolConfigurator,
      meldProtocolDataProvider,
      reserveLogic,
      lendingRateOracleAggregator,
      meldLendingRateOracle,
      usdc,
      unsupportedToken,
      meld,
      tether,
      expectedTokenAddresses,
      owner,
      poolAdmin,
      depositor,
      borrower,
      rando,
      treasury,
      meldPriceOracle,
      priceOracleAggregator,
    };
  }

  async function setUpForBorrowTestFixture() {
    // Deploy protocol
    const {
      lendingPool,
      lendingPoolConfigurator,
      meldProtocolDataProvider,
      reserveLogic,
      lendingRateOracleAggregator,
      meldLendingRateOracle,
      meldPriceOracle,
      priceOracleAggregator,
      usdc,
      meld,
      tether,
      owner,
      poolAdmin,
      treasury,
      depositor,
      borrower,
    } = await setUpTestFixture();

    // Get pool configuration values
    const poolConfig: PoolConfiguration = loadPoolConfigForEnv();

    const { LendingRateOracleRatesCommon, ReservesConfig } =
      poolConfig as IMeldConfiguration;

    // Set test market lending rates
    meldLendingRateOracle.setMarketBorrowRate(
      await usdc.getAddress(),
      LendingRateOracleRatesCommon.USDT!.borrowRate
    );

    meldLendingRateOracle.setMarketBorrowRate(
      await meld.getAddress(),
      LendingRateOracleRatesCommon.MELD.borrowRate
    );

    // Enable borrowing on reserve
    await expect(
      lendingPoolConfigurator.connect(poolAdmin).enableBorrowingOnReserve(
        await usdc.getAddress(),
        true // stableBorrowRateEnabled
      )
    )
      .to.emit(lendingPoolConfigurator, "BorrowingEnabledOnReserve")
      .withArgs(await usdc.getAddress(), true);

    await expect(
      lendingPoolConfigurator
        .connect(poolAdmin)
        .setReserveFactor(
          await usdc.getAddress(),
          ReservesConfig.USDT!.reserveFactor
        )
    )
      .to.emit(lendingPoolConfigurator, "ReserveFactorChanged")
      .withArgs(await usdc.getAddress(), ReservesConfig.USDT!.reserveFactor);

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

    await expect(
      lendingPoolConfigurator
        .connect(poolAdmin)
        .configureReserveAsCollateral(
          await tether.getAddress(),
          ReservesConfig.USDT!.baseLTVAsCollateral,
          ReservesConfig.USDT!.liquidationThreshold,
          ReservesConfig.USDT!.liquidationBonus
        )
    )
      .to.emit(lendingPoolConfigurator, "CollateralConfigurationChanged")
      .withArgs(
        await tether.getAddress(),
        ReservesConfig.USDT!.baseLTVAsCollateral,
        ReservesConfig.USDT!.liquidationThreshold,
        ReservesConfig.USDT!.liquidationBonus
      );

    await expect(
      lendingPoolConfigurator
        .connect(poolAdmin)
        .setReserveFactor(
          await tether.getAddress(),
          ReservesConfig.USDT!.reserveFactor
        )
    )
      .to.emit(lendingPoolConfigurator, "ReserveFactorChanged")
      .withArgs(await tether.getAddress(), ReservesConfig.USDT!.reserveFactor);

    // Deposit liquidity

    // Depositor deposits USDC liquidity
    const depositAmountUSDC = await allocateAndApproveTokens(
      usdc,
      owner,
      depositor,
      lendingPool,
      20000n,
      0n
    );

    await lendingPool
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
      lendingPool,
      1000n,
      0n
    );

    await lendingPool
      .connect(borrower)
      .deposit(
        await meld.getAddress(),
        depositAmountMELD,
        borrower.address,
        true,
        0
      );

    return {
      lendingPool,
      lendingPoolConfigurator,
      meldProtocolDataProvider,
      reserveLogic,
      lendingRateOracleAggregator,
      meldLendingRateOracle,
      meldPriceOracle,
      priceOracleAggregator,
      usdc,
      meld,
      tether,
      owner,
      treasury,
      depositor,
      borrower,
    };
  }
  context("Reserve not yet initialized", async function () {
    context("getAllReservesTokens()", async function () {
      it("Should return the correct data", async function () {
        const { meldProtocolDataProvider } = await loadFixture(
          setUpTestMinimalFixture
        );
        const reserveTokens =
          await meldProtocolDataProvider.getAllReservesTokens();

        expect(reserveTokens).to.have.lengthOf(0);
      });
    }); // End of getAllReservesTokens Context

    context("getAllMTokens()", async function () {
      it("Should return the correct data", async function () {
        const { meldProtocolDataProvider } = await loadFixture(
          setUpTestMinimalFixture
        );

        const allMTokens = await meldProtocolDataProvider.getAllMTokens();
        expect(allMTokens).to.have.lengthOf(0);
      });
    }); // End of getAllMTokens Context

    context("getReserveConfigurationData()", async function () {
      it("Should return the correct reserve configuration data", async function () {
        const { meldProtocolDataProvider, usdc } = await loadFixture(
          setUpTestMinimalFixture
        );

        // Get the USDC reserve configuration data
        const [
          decimals,
          ltv,
          liquidationThreshold,
          liquidationBonus,
          reserveFactor,
          supplyCapUSD,
          borrowCapUSD,
          flashLoanLimitUSD,
          usageAsCollateralEnabled,
          isActive,
          isFrozen,
          borrowingEnabled,
          stableBorrowRateEnabled,
        ] = await meldProtocolDataProvider.getReserveConfigurationData(
          await usdc.getAddress()
        );

        expect(decimals).to.equal(0);
        expect(ltv).to.equal(0);
        expect(liquidationThreshold).to.equal(0);
        expect(liquidationBonus).to.equal(0);
        expect(reserveFactor).to.equal(0);
        expect(supplyCapUSD).to.equal(0);
        expect(borrowCapUSD).to.equal(0);
        expect(flashLoanLimitUSD).to.equal(0);
        expect(usageAsCollateralEnabled).to.be.false;
        expect(borrowingEnabled).to.be.false;
        expect(stableBorrowRateEnabled).to.be.false;
        expect(isActive).to.be.false;
        expect(isFrozen).to.be.false;
      });
    }); // End of getReserveConfigurationData Context

    context("reserveExists()", function () {
      context("Happy Path Test Cases", async function () {
        it("Should return false if the asset does not exist", async function () {
          const { lendingPool, unsupportedToken } = await loadFixture(
            setUpTestMinimalFixture
          );

          expect(
            await lendingPool.reserveExists(await unsupportedToken.getAddress())
          ).to.be.false;
        });
      }); // End of reserveExists Happy Path Test Cases Context
    }); // End of reserveExists Context

    context("getReserveData()", async function () {
      it("Should return the correct reserve data", async function () {
        const { meldProtocolDataProvider, usdc } = await loadFixture(
          setUpTestMinimalFixture
        );

        // Get the USDC reserve data
        const [
          availableLiquidity,
          totalStableDebt,
          totalVariableDebt,
          liquidityRate,
          variableBorrowRate,
          stableBorrowRate,
          averageStableBorrowRate,
          liquidityIndex,
          variableBorrowIndex,
          lastUpdateTimestamp,
        ] = await meldProtocolDataProvider.getReserveData(
          await usdc.getAddress()
        );

        expect(availableLiquidity).to.equal(0);
        expect(totalStableDebt).to.equal(0);
        expect(totalVariableDebt).to.equal(0);
        expect(liquidityRate).to.equal(0);
        expect(variableBorrowRate).to.equal(0);
        expect(stableBorrowRate).to.equal(0);
        expect(averageStableBorrowRate).to.equal(0);
        expect(liquidityIndex).to.equal(0);
        expect(variableBorrowIndex).to.equal(0);
        expect(lastUpdateTimestamp).to.equal(0);
      });
    }); // End of getReserveData Context

    context("getUserReserveData()", async function () {
      it("Should return the correct reserve data", async function () {
        const { meldProtocolDataProvider, rando, usdc } = await loadFixture(
          setUpTestMinimalFixture
        );

        // Attempt to get the user reserve data
        // Should revert because the function makes calls to reserve tokens that won't exist if the reserve hasn't been initialized
        await expect(
          meldProtocolDataProvider.getUserReserveData(
            await usdc.getAddress(),
            rando.address
          )
        ).to.be.revertedWith(ProtocolErrors.LPC_RESERVE_DOES_NOT_EXIST);
      });
    }); // End of getUserReserveData Context

    context("getReserveTokensAddresses()", async function () {
      it("Should return the correct reserve tokens addresses", async function () {
        const { meldProtocolDataProvider, usdc } = await loadFixture(
          setUpTestMinimalFixture
        );

        // Get the reserve tokens addresses
        const [
          mTokenAddress,
          stableDebtTokenAddress,
          variableDebtTokenAddress,
        ] = await meldProtocolDataProvider.getReserveTokensAddresses(
          await usdc.getAddress()
        );

        expect(mTokenAddress).to.equal(ZeroAddress);
        expect(stableDebtTokenAddress).to.equal(ZeroAddress);
        expect(variableDebtTokenAddress).to.equal(ZeroAddress);
      });
    }); // End of getReserveTokensAddresses Context

    context("getSupplyCapData()", async function () {
      it("Should return the correct supply cap data", async function () {
        const { meldProtocolDataProvider, usdc } = await loadFixture(
          setUpTestMinimalFixture
        );

        // Attempt to get the supply data
        // Should revert because the function makes calls to reserve tokens that won't exist if the reserve hasn't been initialized
        await expect(
          meldProtocolDataProvider.getSupplyCapData(await usdc.getAddress())
        ).to.be.revertedWith(ProtocolErrors.LPC_RESERVE_DOES_NOT_EXIST);
      });
    }); // End of getSupplyCapData Context

    context("getBorrowCapData()", async function () {
      it("Should return the correct borrow cap data", async function () {
        const { meldProtocolDataProvider, usdc } = await loadFixture(
          setUpTestMinimalFixture
        );

        // Attempt to get the borrow data
        // Should revert because the function makes calls to reserve tokens that won't exist if the reserve hasn't been initialized
        await expect(
          meldProtocolDataProvider.getBorrowCapData(await usdc.getAddress())
        ).to.be.revertedWith(ProtocolErrors.LPC_RESERVE_DOES_NOT_EXIST);
      });
    }); // End of getBorrowCapData Context

    context("getReserveYieldBoostStaking()", async function () {
      it("Should return the correct yield boost staking address", async function () {
        const { meldProtocolDataProvider, meld } = await loadFixture(
          setUpTestMinimalFixture
        );

        expect(
          await meldProtocolDataProvider.getReserveYieldBoostStaking(meld)
        ).to.equal(ZeroAddress);
      });
    }); // End of getReserveYieldBoostStaking Context

    context("isUserAcceptingGeniusLoan", async function () {
      it("Should return the correct value", async function () {
        const { lendingPool, meldProtocolDataProvider, borrower } =
          await loadFixture(setUpForBorrowTestFixture);

        expect(
          await meldProtocolDataProvider.isUserAcceptingGeniusLoan(
            borrower.address
          )
        ).to.be.false;

        await lendingPool.connect(borrower).setUserAcceptGeniusLoan(true);

        expect(
          await meldProtocolDataProvider.isUserAcceptingGeniusLoan(
            borrower.address
          )
        ).to.be.true;
      });
    }); // End of isUserAcceptingGeniusLoan Context
  }); // End of Reserve is not yet initialized Context

  context("Reserve is initialized", async function () {
    context("getAllReservesTokens()", async function () {
      it("Should return the correct data", async function () {
        const { meldProtocolDataProvider, usdc, meld, dai } =
          await loadFixture(setUpTestFixture);
        const reserveTokens =
          await meldProtocolDataProvider.getAllReservesTokens();

        expect(reserveTokens).to.have.lengthOf(4);
        expect(reserveTokens[0].symbol).to.equal(await usdc.symbol());
        expect(reserveTokens[0].tokenAddress).to.equal(await usdc.getAddress());
        expect(reserveTokens[1].symbol).to.equal(await meld.symbol());
        expect(reserveTokens[1].tokenAddress).to.equal(await meld.getAddress());
        expect(reserveTokens[2].symbol).to.equal(await dai.symbol());
        expect(reserveTokens[2].tokenAddress).to.equal(await dai.getAddress());
      });
    }); // End of getAllReservesTokens Context

    context("getAllMTokens()", async function () {
      it("Should return the correct data", async function () {
        const { meldProtocolDataProvider, expectedReserveTokenAddresses } =
          await loadFixture(setUpTestFixture);

        const allMTokens = await meldProtocolDataProvider.getAllMTokens();
        expect(allMTokens[0].symbol).to.equal("mUSDC");
        expect(allMTokens[0].tokenAddress).to.equal(
          expectedReserveTokenAddresses.get("USDC").Mtoken
        );
        expect(allMTokens[1].symbol).to.equal("mMELD");
        expect(allMTokens[1].tokenAddress).to.equal(
          expectedReserveTokenAddresses.get("MELD").Mtoken
        );
        expect(allMTokens[2].symbol).to.equal("mDAI");
        expect(allMTokens[2].tokenAddress).to.equal(
          expectedReserveTokenAddresses.get("DAI").Mtoken
        );
        expect(allMTokens[3].symbol).to.equal("mUSDT");
        expect(allMTokens[3].tokenAddress).to.equal(
          expectedReserveTokenAddresses.get("USDT").Mtoken
        );
      });
    }); // End of getAllMTokens Context

    context("getReserveConfigurationData()", async function () {
      it("Should return the correct reserve configuration data", async function () {
        const {
          lendingPoolConfigurator,
          meldProtocolDataProvider,
          usdc,
          poolAdmin,
        } = await loadFixture(setUpTestFixture);

        const configuration: Configuration = <Configuration>{}; // Configuration object to be used in tests

        configuration.reservesParams = <iMeldPoolAssets<IReserveParams>>(
          getReservesConfigByPool(MeldPools.proto)
        );

        await lendingPoolConfigurator
          .connect(poolAdmin)
          .configureReserveAsCollateral(
            await usdc.getAddress(),
            configuration.reservesParams.USDC!.baseLTVAsCollateral,
            configuration.reservesParams.USDC!.liquidationThreshold,
            configuration.reservesParams.USDC!.liquidationBonus
          );

        await lendingPoolConfigurator
          .connect(poolAdmin)
          .enableBorrowingOnReserve(await usdc.getAddress(), true); //sets borowingEnabled and stableBorrowRateEnabled to true
        await lendingPoolConfigurator
          .connect(poolAdmin)
          .setReserveFactor(
            await usdc.getAddress(),
            configuration.reservesParams.USDC!.reserveFactor
          );

        await lendingPoolConfigurator
          .connect(poolAdmin)
          .setSupplyCapUSD(
            await usdc.getAddress(),
            configuration.reservesParams.USDC!.supplyCapUSD
          );

        await lendingPoolConfigurator
          .connect(poolAdmin)
          .setBorrowCapUSD(
            await usdc.getAddress(),
            configuration.reservesParams.USDC!.borrowCapUSD
          );

        await lendingPoolConfigurator
          .connect(poolAdmin)
          .setFlashLoanLimitUSD(
            await usdc.getAddress(),
            configuration.reservesParams.USDC!.flashLoanLimitUSD
          );

        // Get the USDC reserve configuration data
        const [
          decimals,
          ltv,
          liquidationThreshold,
          liquidationBonus,
          reserveFactor,
          supplyCapUSD,
          borrowCapUSD,
          flashLoanLimitUSD,
          usageAsCollateralEnabled,
          isActive,
          isFrozen,
          borrowingEnabled,
          stableBorrowRateEnabled,
        ] = await meldProtocolDataProvider.getReserveConfigurationData(
          await usdc.getAddress()
        );

        expect(decimals).to.equal(
          configuration.reservesParams.USDC!.reserveDecimals
        );
        expect(ltv).to.equal(
          configuration.reservesParams.USDC!.baseLTVAsCollateral
        );
        expect(liquidationThreshold).to.equal(
          configuration.reservesParams.USDC!.liquidationThreshold
        );
        expect(liquidationBonus).to.equal(
          configuration.reservesParams.USDC!.liquidationBonus
        );
        expect(reserveFactor).to.equal(
          configuration.reservesParams.USDC!.reserveFactor
        );
        expect(supplyCapUSD).to.equal(
          configuration.reservesParams.USDC!.supplyCapUSD
        );
        expect(borrowCapUSD).to.equal(
          configuration.reservesParams.USDC!.borrowCapUSD
        );
        expect(flashLoanLimitUSD).to.equal(
          configuration.reservesParams.USDC!.flashLoanLimitUSD
        );
        expect(usageAsCollateralEnabled).to.be.true;
        expect(borrowingEnabled).to.be.true;
        expect(stableBorrowRateEnabled).to.be.true;
        expect(isActive).to.be.true;
        expect(isFrozen).to.be.false;
      });
    }); // End of getReserveConfigurationData Context

    context("reserveExists()", function () {
      context("Happy Path Test Cases", async function () {
        it("Should return true if the asset exists", async function () {
          const { lendingPool, usdc } = await loadFixture(setUpTestFixture);

          expect(await lendingPool.reserveExists(await usdc.getAddress())).to.be
            .true;
        });
      }); // End of reserveExists Happy Path Test Cases Context
    }); // End of reserveExists Context

    context("getReserveData()", async function () {
      it("Should return the correct reserve data after deposit", async function () {
        const {
          lendingPool,
          meldProtocolDataProvider,
          lendingRateOracleAggregator,
          owner,
          depositor,
          usdc,
        } = await loadFixture(setUpTestFixture);

        // Get reserve data before deposit
        const reserveDataBeforeDeposit: ReserveData = await getReserveData(
          meldProtocolDataProvider,
          await usdc.getAddress(),
          await lendingRateOracleAggregator.getAddress()
        );

        // Set up USDC Deposit. factor = 0 because deposit and approval amount are same
        const depositAmountUSDC = await allocateAndApproveTokens(
          usdc,
          owner,
          depositor,
          lendingPool,
          1000n,
          0n
        );

        // Deposit
        await (lendingPool.connect(depositor) as LendingPool).deposit(
          await usdc.getAddress(),
          depositAmountUSDC,
          depositor.address,
          true,
          0
        );

        // Hardhat time module. Gets timestamp of latest block.
        const blockTimestamp = await time.latest();

        // Calculate expected reserve data after deposit
        const expectedReserveDataAfterDeposit =
          calcExpectedReserveDataAfterDeposit(
            depositAmountUSDC,
            reserveDataBeforeDeposit,
            BigInt(blockTimestamp)
          );

        // Get the USDC reserve data
        const [
          availableLiquidity,
          totalStableDebt,
          totalVariableDebt,
          liquidityRate,
          variableBorrowRate,
          stableBorrowRate,
          averageStableBorrowRate,
          liquidityIndex,
          variableBorrowIndex,
          lastUpdateTimestamp,
        ] = await meldProtocolDataProvider.getReserveData(
          await usdc.getAddress()
        );

        expect(availableLiquidity).to.equal(
          expectedReserveDataAfterDeposit.availableLiquidity
        );
        expect(totalStableDebt).to.equal(
          expectedReserveDataAfterDeposit.totalStableDebt
        );
        expect(totalVariableDebt).to.equal(
          expectedReserveDataAfterDeposit.totalVariableDebt
        );
        expect(liquidityRate).to.equal(
          expectedReserveDataAfterDeposit.liquidityRate
        );
        expect(variableBorrowRate).to.equal(
          expectedReserveDataAfterDeposit.variableBorrowRate
        );
        expect(stableBorrowRate).to.equal(
          expectedReserveDataAfterDeposit.stableBorrowRate
        );
        expect(averageStableBorrowRate).to.equal(
          expectedReserveDataAfterDeposit.averageStableBorrowRate
        );
        expect(liquidityIndex).to.equal(
          expectedReserveDataAfterDeposit.liquidityIndex
        );
        expect(variableBorrowIndex).to.equal(
          expectedReserveDataAfterDeposit.variableBorrowIndex
        );
        expect(lastUpdateTimestamp).to.equal(
          expectedReserveDataAfterDeposit.lastUpdateTimestamp
        );
      });

      it("Should return the correct reserve data after borrow", async function () {
        const {
          lendingPool,
          meldProtocolDataProvider,
          lendingRateOracleAggregator,
          borrower,
          usdc,
        } = await loadFixture(setUpForBorrowTestFixture);

        // Get reserve data before borrow
        const reserveDataBeforeBorrow: ReserveData = await getReserveData(
          meldProtocolDataProvider,
          await usdc.getAddress(),
          await lendingRateOracleAggregator.getAddress()
        );

        // Borrower borrows USDC from the lending pool, using MELD as collateral
        const amountToBorrow = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "0.01"
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

        // Simulate time passing
        await time.increase(ONE_YEAR / 2);

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

        // Get the USDC reserve data
        const [
          availableLiquidity,
          totalStableDebt,
          totalVariableDebt,
          liquidityRate,
          variableBorrowRate,
          stableBorrowRate,
          averageStableBorrowRate,
          liquidityIndex,
          variableBorrowIndex,
          lastUpdateTimestamp,
        ] = await meldProtocolDataProvider.getReserveData(
          await usdc.getAddress()
        );

        expect(availableLiquidity).to.equal(
          expectedReserveDataAfterBorrow.availableLiquidity
        );
        expect(totalStableDebt).to.equal(
          expectedReserveDataAfterBorrow.totalStableDebt
        );
        expect(totalVariableDebt).to.equal(
          expectedReserveDataAfterBorrow.totalVariableDebt
        );

        expect(liquidityRate).to.equal(
          expectedReserveDataAfterBorrow.liquidityRate
        );

        expect(variableBorrowRate).to.equal(
          expectedReserveDataAfterBorrow.variableBorrowRate
        );
        expect(stableBorrowRate).to.equal(
          expectedReserveDataAfterBorrow.stableBorrowRate
        );
        expect(averageStableBorrowRate).to.equal(
          expectedReserveDataAfterBorrow.averageStableBorrowRate
        );
        expect(liquidityIndex).to.equal(
          expectedReserveDataAfterBorrow.liquidityIndex
        );
        expect(variableBorrowIndex).to.equal(
          expectedReserveDataAfterBorrow.variableBorrowIndex
        );
        expect(lastUpdateTimestamp).to.equal(
          expectedReserveDataAfterBorrow.lastUpdateTimestamp
        );
      });
    }); // End of getReserveData Context

    context("getUserReserveData()", async function () {
      it("Should return the correct reserve data", async function () {
        const {
          lendingPool,
          meldProtocolDataProvider,
          lendingRateOracleAggregator,
          depositor,
          owner,
          usdc,
        } = await loadFixture(setUpTestFixture);

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
        await (lendingPool.connect(depositor) as LendingPool).deposit(
          await usdc.getAddress(),
          depositAmount,
          depositor.address,
          true,
          0
        );

        // Hardhat time module. Gets timestamp of latest block.
        const blockTimestamp = await time.latest();

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

        // Get the user reserve data
        const [
          currentMTokenBalance,
          currentStableDebt,
          currentVariableDebt,
          principalStableDebt,
          scaledVariableDebt,
          stableBorrowRate,
          liquidityRate,
          stableRateLastUpdated,
          usageAsCollateralEnabled,
        ] = await meldProtocolDataProvider.getUserReserveData(
          await usdc.getAddress(),
          depositor.address
        );

        expect(currentMTokenBalance).to.equal(
          expectedUserDataAfterDeposit.currentMTokenBalance
        );
        expect(currentStableDebt).to.equal(
          expectedUserDataAfterDeposit.currentStableDebt
        );
        expect(currentVariableDebt).to.equal(
          expectedUserDataAfterDeposit.currentVariableDebt
        );
        expect(principalStableDebt).to.equal(
          expectedUserDataAfterDeposit.principalStableDebt
        );
        expect(scaledVariableDebt).to.equal(
          expectedUserDataAfterDeposit.scaledVariableDebt
        );
        expect(stableBorrowRate).to.equal(
          expectedUserDataAfterDeposit.stableBorrowRate
        );
        expect(liquidityRate).to.equal(
          expectedUserDataAfterDeposit.liquidityRate
        );
        expect(stableRateLastUpdated).to.equal(
          expectedUserDataAfterDeposit.stableRateLastUpdated
        );
        expect(usageAsCollateralEnabled).to.equal(
          expectedUserDataAfterDeposit.usageAsCollateralEnabled
        );
      });
    }); // End of getUserReserveData Context

    context("getReserveTokensAddresses()", async function () {
      it("Should return the correct reserve tokens addresses", async function () {
        const {
          meldProtocolDataProvider,
          expectedReserveTokenAddresses,
          usdc,
        } = await loadFixture(setUpTestFixture);

        // Get the reserve tokens addresses
        const [
          mTokenAddress,
          stableDebtTokenAddress,
          variableDebtTokenAddress,
        ] = await meldProtocolDataProvider.getReserveTokensAddresses(
          await usdc.getAddress()
        );

        expect(mTokenAddress).to.equal(
          expectedReserveTokenAddresses.get("USDC").Mtoken
        );
        expect(stableDebtTokenAddress).to.equal(
          expectedReserveTokenAddresses.get("USDC").StableDebtToken
        );
        expect(variableDebtTokenAddress).to.equal(
          expectedReserveTokenAddresses.get("USDC").VariableDebtToken
        );
      });
    }); // End of getReserveTokensAddresses Context

    context("getSupplyCapData()", async function () {
      it("Should return the correct supply cap data", async function () {
        const {
          meldProtocolDataProvider,
          usdc,
          lendingPoolConfigurator,
          lendingPool,
          owner,
          depositor,
          poolAdmin,
        } = await loadFixture(setUpTestInitNoConfigReserveFixture);

        // Get the supply cap data
        const [supplyCap, currentSupplied, supplyCapUSD, currentSuppliedUSD] =
          await meldProtocolDataProvider.getSupplyCapData(
            await usdc.getAddress()
          );

        expect(supplyCap).to.equal(0n);
        expect(currentSupplied).to.equal(0n);
        expect(supplyCapUSD).to.equal(0n);
        expect(currentSuppliedUSD).to.equal(0n);

        // Set the supply cap
        const supplyCapUSDAmount = 1000000n;
        await lendingPoolConfigurator
          .connect(poolAdmin)
          .setSupplyCapUSD(await usdc.getAddress(), supplyCapUSDAmount);

        // Deposit
        const depositAmount = await allocateAndApproveTokens(
          usdc,
          owner,
          depositor,
          lendingPool,
          1000n,
          2n
        );

        await lendingPool
          .connect(depositor)
          .deposit(
            await usdc.getAddress(),
            depositAmount,
            depositor.address,
            true,
            0
          );

        const [
          afterSupplyCapSetSupplyCap,
          afterSupplyCapSetCurrentSupply,
          afterSupplyCapSetSupplyCapUSD,
          afterSupplyCapSetCurrentSupplyUSD,
        ] = await meldProtocolDataProvider.getSupplyCapData(
          await usdc.getAddress()
        );

        const tokenUnits = 10n ** (await usdc.decimals());
        expect(afterSupplyCapSetSupplyCap).to.equal(
          supplyCapUSDAmount * tokenUnits
        );
        expect(afterSupplyCapSetCurrentSupply).to.equal(depositAmount);
        expect(afterSupplyCapSetSupplyCapUSD).to.equal(supplyCapUSDAmount);
        expect(afterSupplyCapSetCurrentSupplyUSD).to.equal(
          depositAmount / tokenUnits
        );
      });
    }); // End of getSupplyCap Context
    context("getBorrowCapData()", async function () {
      it("Should return the correct borrow cap data", async function () {
        const {
          meldProtocolDataProvider,
          usdc,
          lendingPoolConfigurator,
          poolAdmin,
        } = await loadFixture(setUpTestInitNoConfigReserveFixture);

        // Get the borrow cap data
        const [borrowCap, currentBorrowed, borrowCapUSD, currentBorrowedUSD] =
          await meldProtocolDataProvider.getBorrowCapData(
            await usdc.getAddress()
          );

        expect(borrowCap).to.equal(0n);
        expect(currentBorrowed).to.equal(0n);
        expect(borrowCapUSD).to.equal(0n);
        expect(currentBorrowedUSD).to.equal(0n);

        // Set the borrow cap
        const borrowCapUSDAmount = 1000000n;
        await lendingPoolConfigurator
          .connect(poolAdmin)
          .setBorrowCapUSD(await usdc.getAddress(), borrowCapUSDAmount);

        const [
          afterBorrowCapSetBorrowCap,
          afterBorrowCapSetCurrentBorrow,
          afterBorrowCapSetBorrowCapUSD,
          afterBorrowCapSetCurrentBorrowUSD,
        ] = await meldProtocolDataProvider.getBorrowCapData(
          await usdc.getAddress()
        );

        const tokenUnits = 10n ** (await usdc.decimals());

        expect(afterBorrowCapSetBorrowCap).to.equal(
          borrowCapUSDAmount * tokenUnits
        );
        expect(afterBorrowCapSetCurrentBorrow).to.equal(0n);
        expect(afterBorrowCapSetBorrowCapUSD).to.equal(borrowCapUSDAmount);
        expect(afterBorrowCapSetCurrentBorrowUSD).to.equal(0n);
      });
    }); // End of getBorrowCap Context

    context("getFlashLoanLimitData()", async function () {
      it("Should return the correct flash loan limit data", async function () {
        const {
          meldProtocolDataProvider,
          usdc,
          lendingPoolConfigurator,
          poolAdmin,
        } = await loadFixture(setUpTestInitNoConfigReserveFixture);

        // Get the flash loan limit data
        const [flashLoanLimit, flashLoanLimitUSD] =
          await meldProtocolDataProvider.getFlashLoanLimitData(
            await usdc.getAddress()
          );

        expect(flashLoanLimit).to.equal(0n);
        expect(flashLoanLimitUSD).to.equal(0n);

        // Set the flash loan limit
        const flashLoanLimitUSDAmount = 1000000n;
        await lendingPoolConfigurator
          .connect(poolAdmin)
          .setFlashLoanLimitUSD(
            await usdc.getAddress(),
            flashLoanLimitUSDAmount
          );

        const [
          afterFlashLoanLimitSetFlashLoanLimit,
          afterFlashLoanLimitSetFlashLoanLimitUSD,
        ] = await meldProtocolDataProvider.getFlashLoanLimitData(
          await usdc.getAddress()
        );

        const tokenUnits = 10n ** (await usdc.decimals());

        expect(afterFlashLoanLimitSetFlashLoanLimit).to.equal(
          flashLoanLimitUSDAmount * tokenUnits
        );
        expect(afterFlashLoanLimitSetFlashLoanLimitUSD).to.equal(
          flashLoanLimitUSDAmount
        );
      });
    }); // End of getFlashLoanLimit Context

    context("getReserveYieldBoostStaking()", async function () {
      it("Should return the correct reserve yield boost staking address", async function () {
        const {
          meldProtocolDataProvider,
          meld,
          rando,
          poolAdmin,
          lendingPoolConfigurator,
        } = await loadFixture(setUpTestFixture);

        expect(
          await meldProtocolDataProvider.getReserveYieldBoostStaking(meld)
        ).to.equal(ZeroAddress);

        // Set yield boost staking address
        await lendingPoolConfigurator
          .connect(poolAdmin)
          .setYieldBoostStakingAddress(meld, rando);

        expect(
          await meldProtocolDataProvider.getReserveYieldBoostStaking(meld)
        ).to.equal(rando.address);
      });
    }); // End of getReserveYieldBoostStaking Context

    context("isUserAcceptingGeniusLoan", async function () {
      it("Should return the correct value", async function () {
        const { lendingPool, meldProtocolDataProvider, borrower } =
          await loadFixture(setUpForBorrowTestFixture);

        expect(
          await meldProtocolDataProvider.isUserAcceptingGeniusLoan(
            borrower.address
          )
        ).to.be.false;

        await lendingPool.connect(borrower).setUserAcceptGeniusLoan(true);

        expect(
          await meldProtocolDataProvider.isUserAcceptingGeniusLoan(
            borrower.address
          )
        ).to.be.true;
      });
    }); // End of isUserAcceptingGeniusLoan Context
  }); // End of Reserve is initialized Context
}); // End of MeldProtocolDataProvider Describe
