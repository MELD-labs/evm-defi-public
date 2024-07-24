import { ethers } from "hardhat";
import { MaxUint256, ZeroAddress } from "ethers";
import {
  deployLibraries,
  allocateAndApproveTokens,
  loadPoolConfigForEnv,
  setUpTestFixture,
} from "./helpers/utils/utils";
import {
  IMeldConfiguration,
  PoolConfiguration,
  RateMode,
  Action,
  MeldBankerType,
} from "./helpers/types";
import { UserReserveData } from "./helpers/interfaces";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { DataTypes } from "../typechain-types/contracts/lending/LendingPool";
import { convertToCurrencyDecimals } from "./helpers/utils/contracts-helpers";
import {
  calcLinearInterest,
  calcCompoundedInterest,
} from "./helpers/utils/calculations";
import { getUserData } from "./helpers/utils/helpers";
import { ProtocolErrors } from "./helpers/types";
import { oneRay, ONE_YEAR, _1e18 } from "./helpers/constants";
import "./helpers/utils/math";

describe("LendingPool", function () {
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
      oracleAdmin,
      treasury,
      depositor,
      borrower,
    } = await setUpTestFixture();

    // Get pool configuration values
    const poolConfig: PoolConfiguration = loadPoolConfigForEnv();

    const {
      Mocks: { AllAssetsInitialPrices },
      LendingRateOracleRatesCommon,
      ReservesConfig,
    } = poolConfig as IMeldConfiguration;

    // Set test price values
    await meldPriceOracle
      .connect(oracleAdmin)
      .setAssetPrice(await usdc.getAddress(), AllAssetsInitialPrices.USDC);

    await meldPriceOracle
      .connect(oracleAdmin)
      .setAssetPrice(await meld.getAddress(), AllAssetsInitialPrices.MELD);

    // Set test market lending rates
    meldLendingRateOracle
      .connect(oracleAdmin)
      .setMarketBorrowRate(
        await usdc.getAddress(),
        LendingRateOracleRatesCommon.USDC!.borrowRate
      );

    meldLendingRateOracle
      .connect(oracleAdmin)
      .setMarketBorrowRate(
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
          ReservesConfig.USDC!.reserveFactor
        )
    )
      .to.emit(lendingPoolConfigurator, "ReserveFactorChanged")
      .withArgs(await usdc.getAddress(), ReservesConfig.USDC!.reserveFactor);

    // Enable borrowing on reserve
    await expect(
      lendingPoolConfigurator.connect(poolAdmin).enableBorrowingOnReserve(
        await tether.getAddress(),
        true // stableBorrowRateEnabled
      )
    )
      .to.emit(lendingPoolConfigurator, "BorrowingEnabledOnReserve")
      .withArgs(await tether.getAddress(), true);

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

    // Config values are 0, but need them to be > 0 for these test cases
    await expect(
      lendingPoolConfigurator
        .connect(poolAdmin)
        .configureReserveAsCollateral(
          await tether.getAddress(),
          8000,
          8500,
          10500
        )
    )
      .to.emit(lendingPoolConfigurator, "CollateralConfigurationChanged")
      .withArgs(await tether.getAddress(), 8000, 8500, 10500);

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

    // Depositor deposits USDT liquidity
    const depositAmountUSDT = await allocateAndApproveTokens(
      tether,
      owner,
      depositor,
      lendingPool,
      5000n,
      0n
    );

    await lendingPool
      .connect(depositor)
      .deposit(
        await tether.getAddress(),
        depositAmountUSDT,
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
      poolAdmin,
      oracleAdmin,
      treasury,
      depositor,
      borrower,
      depositAmountMELD,
    };
  }

  async function meldBankerNftNotSetFixture() {
    const [deployer, bankerAdmin] = await ethers.getSigners();

    const AddressesProvider =
      await ethers.getContractFactory("AddressesProvider");
    const addressesProvider = await AddressesProvider.deploy(deployer);

    await addressesProvider.grantRole(
      await addressesProvider.BNKR_NFT_MINTER_BURNER_ROLE(),
      bankerAdmin
    );

    const {
      reserveLogic,
      validationLogic,
      genericLogic,
      liquidationLogic,
      borrowLogic,
      depositLogic,
      flashLoanLogic,
      withdrawLogic,
      repayLogic,
      yieldBoostLogic,
    } = await deployLibraries();

    const LendingPool = await ethers.getContractFactory("LendingPool", {
      libraries: {
        ReserveLogic: reserveLogic,
        ValidationLogic: validationLogic,
        GenericLogic: genericLogic,
        LiquidationLogic: liquidationLogic,
        BorrowLogic: borrowLogic,
        DepositLogic: depositLogic,
        FlashLoanLogic: flashLoanLogic,
        WithdrawLogic: withdrawLogic,
        RepayLogic: repayLogic,
        YieldBoostLogic: yieldBoostLogic,
      },
    });

    const lendingPool = await LendingPool.deploy();
    await lendingPool.initialize(addressesProvider);

    await addressesProvider.setLendingPool(lendingPool);

    const MeldBankerNft = await ethers.getContractFactory("MeldBankerNFT");
    const meldBankerNft = await MeldBankerNft.deploy(addressesProvider);

    return {
      deployer,
      lendingPool,
      addressesProvider,
      meldBankerNft,
    };
  }

  context("Initialize Reserve", async function () {
    context("Error Test Cases", async function () {
      it("Should revert if the caller does not have correct role", async function () {
        const {
          lendingPool,
          addressesProvider,
          rando,
          usdc,
          unsupportedToken,
        } = await loadFixture(setUpTestFixture);

        const unsupportedTokenAddress = await unsupportedToken.getAddress();

        const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.LENDING_POOL_CONFIGURATOR_ROLE()}`;

        // Pass in random token addresses
        await expect(
          lendingPool
            .connect(rando)
            .initReserve(
              await usdc.getAddress(),
              unsupportedTokenAddress,
              unsupportedTokenAddress,
              unsupportedTokenAddress,
              unsupportedTokenAddress
            )
        ).to.be.revertedWith(expectedException);
      });
    }); // End of Initialize Reserve Error Test Cases Context
  }); // End of Initialize Reserve Context
  context("Getters and Setters", function () {
    context("setConfiguration()", function () {
      context("Error Test Cases", async function () {
        it("Should revert if called by address other than the LendingPoolCoordinator", async function () {
          const { lendingPool, addressesProvider, owner, usdc } =
            await loadFixture(setUpTestFixture);

          const expectedException = `AccessControl: account ${owner.address.toLowerCase()} is missing role ${await addressesProvider.LENDING_POOL_CONFIGURATOR_ROLE()}`;

          await expect(
            lendingPool.setConfiguration(await usdc.getAddress(), 0)
          ).to.be.revertedWith(expectedException);
        });
      }); // End of Error Test Cases Context
    }); // End of setConfiguration Context

    context("setUserUseReserveAsCollateral()", function () {
      context("Happy Path Test Cases", async function () {
        it("Should emit the correct events", async function () {
          const { lendingPool, usdc, owner, depositor } =
            await loadFixture(setUpTestFixture);

          // Set up Deposit. factor = 0 because deposit and approval amount are same
          const depositAmount = await allocateAndApproveTokens(
            usdc,
            owner,
            depositor,
            lendingPool,
            1000n,
            0n
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

          await expect(
            lendingPool
              .connect(depositor)
              .setUserUseReserveAsCollateral(await usdc.getAddress(), false)
          )
            .to.emit(lendingPool, "ReserveUsedAsCollateralDisabled")
            .withArgs(await usdc.getAddress(), depositor.address);

          await expect(
            lendingPool
              .connect(depositor)
              .setUserUseReserveAsCollateral(await usdc.getAddress(), true)
          )
            .to.emit(lendingPool, "ReserveUsedAsCollateralEnabled")
            .withArgs(await usdc.getAddress(), depositor.address);
        });

        it("Should update state correctly", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
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

          await lendingPool
            .connect(depositor)
            .setUserUseReserveAsCollateral(await usdc.getAddress(), false);

          const userData1: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await usdc.getAddress(),
            depositor.address
          );

          expect(userData1.usageAsCollateralEnabled).to.be.false;

          await lendingPool
            .connect(depositor)
            .setUserUseReserveAsCollateral(await usdc.getAddress(), true);

          const userData2: UserReserveData = await getUserData(
            lendingPool,
            meldProtocolDataProvider,
            await usdc.getAddress(),
            depositor.address
          );

          expect(userData2.usageAsCollateralEnabled).to.be.true;
        });
      }); // End of setUserUseReserveAsCollateral Happy Path Test Cases Context

      context("Error Test Cases", async function () {
        it("Should revert if the caller’s balance of the asset’s mToken is not > 0", async function () {
          const { lendingPool, usdc, depositor } =
            await loadFixture(setUpTestFixture);

          await expect(
            lendingPool
              .connect(depositor)
              .setUserUseReserveAsCollateral(await usdc.getAddress(), true)
          ).to.be.revertedWith(
            ProtocolErrors.VL_UNDERLYING_BALANCE_NOT_GREATER_THAN_0
          );
        });

        it("Should revert if disabling reserve as collateral decreases collateral balance too much", async function () {
          const { lendingPool, meld, usdc, borrower } = await loadFixture(
            setUpForBorrowTestFixture
          );

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
              .setUserUseReserveAsCollateral(await meld.getAddress(), false)
          ).to.be.revertedWith(ProtocolErrors.VL_DEPOSIT_ALREADY_IN_USE);
        });

        it("Should revert if disabling reserve as collateral decreases health factor too much", async function () {
          const {
            lendingPool,
            meld,
            usdc,
            tether,
            owner,
            borrower,
            meldPriceOracle,
            oracleAdmin,
          } = await loadFixture(setUpForBorrowTestFixture);

          // Borrower deposits tether as second collateral
          const depositAmountUSDT = await allocateAndApproveTokens(
            tether,
            owner,
            borrower,
            lendingPool,
            25000n,
            0n
          );

          await lendingPool
            .connect(borrower)
            .deposit(
              await tether.getAddress(),
              depositAmountUSDT,
              borrower.address,
              true,
              0
            );

          // Borrower borrows USDC from the lending pool
          const amountToBorrow = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "19000"
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

          // Simulate time passing
          await time.increase(ONE_YEAR / 2);

          // Simulate price of collateral going down drastically
          await meldPriceOracle
            .connect(oracleAdmin)
            .setAssetPrice(
              await meld.getAddress(),
              _1e18.multipliedBy("0.000000000001")
            );
          await meldPriceOracle
            .connect(oracleAdmin)
            .setAssetPrice(
              await tether.getAddress(),
              _1e18.multipliedBy("0.000000000001")
            );

          await expect(
            lendingPool
              .connect(borrower)
              .setUserUseReserveAsCollateral(await meld.getAddress(), false)
          ).to.be.revertedWith(ProtocolErrors.VL_DEPOSIT_ALREADY_IN_USE);
        });
      }); // End of Error Test Cases Context
    }); // End of setUserUseReserveAsCollateral Context

    context("setReserveInterestRateStrategyAddress()", function () {
      context("Error Test Cases", async function () {
        it("Should revert if called by address other than the LendingPoolConfigurator", async function () {
          const { lendingPool, addressesProvider, usdc, owner, rando } =
            await loadFixture(setUpTestFixture);

          const expectedException = `AccessControl: account ${owner.address.toLowerCase()} is missing role ${await addressesProvider.LENDING_POOL_CONFIGURATOR_ROLE()}`;

          await expect(
            lendingPool.setReserveInterestRateStrategyAddress(
              await usdc.getAddress(),
              rando.address
            )
          ).to.be.revertedWith(expectedException);
        });
      }); // End of setReserveInterestRateStrategyAddress Error Test Cases Context
    }); // End of setReserveInterestRateStrategyAddress Context

    context("setYieldBoostStakingAddress()", function () {
      context("Error Test Cases", async function () {
        it("Should revert if called by address other than the LendingPoolConfigurator", async function () {
          const { lendingPool, addressesProvider, usdc, rando } =
            await loadFixture(setUpTestFixture);

          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.LENDING_POOL_CONFIGURATOR_ROLE()}`;

          await expect(
            lendingPool
              .connect(rando)
              .setYieldBoostStakingAddress(usdc, ZeroAddress)
          ).to.be.revertedWith(expectedException);
        });
      }); // End of setYieldBoostStakingAddress Error Test Cases Context
    }); // End of setYieldBoostStakingAddress Context

    context("setYieldBoostMultiplier()", function () {
      context("Happy Path Test Cases", async function () {
        it("Should emit the correct events", async function () {
          const { poolAdmin, lendingPool, usdc } =
            await loadFixture(setUpTestFixture);

          const oldYieldBoostMultiplier =
            await lendingPool.yieldBoostMultipliers(
              MeldBankerType.GOLDEN,
              Action.DEPOSIT
            );

          const newYieldBoostMultiplier = 95_00;

          await expect(
            lendingPool
              .connect(poolAdmin)
              .setYieldBoostMultiplier(
                usdc,
                MeldBankerType.GOLDEN,
                Action.DEPOSIT,
                newYieldBoostMultiplier
              )
          )
            .to.emit(lendingPool, "SetYieldBoostMultplier")
            .withArgs(
              await usdc.getAddress(),
              MeldBankerType.GOLDEN,
              Action.DEPOSIT,
              oldYieldBoostMultiplier,
              newYieldBoostMultiplier
            );
        });

        it("Should update state correctly", async function () {
          const { poolAdmin, lendingPool, usdc } =
            await loadFixture(setUpTestFixture);

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
        });
      }); // End of Happy Path Test Cases Context

      context("Error Test Cases", async function () {
        it("Should revert if called by address other than the Pool Admin", async function () {
          const { rando, lendingPool, addressesProvider, usdc } =
            await loadFixture(setUpTestFixture);

          const newYieldBoostMultiplier = 1_00;

          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.POOL_ADMIN_ROLE()}`;

          await expect(
            lendingPool
              .connect(rando)
              .setYieldBoostMultiplier(
                usdc,
                MeldBankerType.NONE,
                Action.BORROW,
                newYieldBoostMultiplier
              )
          ).to.be.revertedWith(expectedException);
        });

        it("Should revert if asset address is the zero address", async function () {
          const { poolAdmin, lendingPool } =
            await loadFixture(setUpTestFixture);

          const newYieldBoostMultiplier = 1_00;

          await expect(
            lendingPool
              .connect(poolAdmin)
              .setYieldBoostMultiplier(
                ZeroAddress,
                MeldBankerType.NONE,
                Action.BORROW,
                newYieldBoostMultiplier
              )
          ).to.be.revertedWith(ProtocolErrors.INVALID_ADDRESS);
        });

        it("Should revert if yield boost is not enabled for the reserve", async function () {
          const { poolAdmin, lendingPool, meld } =
            await loadFixture(setUpTestFixture);

          const newYieldBoostMultiplier = 1_00;

          await expect(
            lendingPool
              .connect(poolAdmin)
              .setYieldBoostMultiplier(
                meld,
                MeldBankerType.NONE,
                Action.BORROW,
                newYieldBoostMultiplier
              )
          ).to.be.revertedWith(
            ProtocolErrors.LP_YIELD_BOOST_STAKING_NOT_ENABLED
          );
        });

        it("Should revert if MeldBankerType is invalid", async function () {
          const { poolAdmin, lendingPool, usdc } =
            await loadFixture(setUpTestFixture);

          const newYieldBoostMultiplier = 5_00;

          await expect(
            lendingPool
              .connect(poolAdmin)
              .setYieldBoostMultiplier(
                usdc,
                4n,
                Action.NONE,
                newYieldBoostMultiplier
              )
          ).to.be.reverted;
        });

        it("Should revert if Action is invalid", async function () {
          const { poolAdmin, lendingPool, usdc } =
            await loadFixture(setUpTestFixture);

          const newYieldBoostMultiplier = 5_00;

          await expect(
            lendingPool
              .connect(poolAdmin)
              .setYieldBoostMultiplier(
                usdc,
                MeldBankerType.GOLDEN,
                4n,
                newYieldBoostMultiplier
              )
          ).to.be.reverted;
        });
      }); // End of Error Test Cases Context
    }); // End of setYieldBoostMultiplier Context

    context("refreshYieldBoostAmount()", function () {
      context("Error Test Cases", async function () {
        it("Should revert if user is the zero address", async function () {
          const { lendingPool, usdc, rando } =
            await loadFixture(setUpTestFixture);

          await expect(
            lendingPool
              .connect(rando)
              .refreshYieldBoostAmount(ZeroAddress, usdc)
          ).to.be.revertedWith(ProtocolErrors.INVALID_ADDRESS);
        });

        it("Should revert if asset is the zero address", async function () {
          const { lendingPool, usdc, rando } =
            await loadFixture(setUpTestFixture);

          await expect(
            lendingPool
              .connect(rando)
              .refreshYieldBoostAmount(usdc, ZeroAddress)
          ).to.be.revertedWith(ProtocolErrors.INVALID_ADDRESS);
        });
      }); // End of refreshYieldBoostAmount Error Test Cases Context
    }); // End of refreshYieldBoostAmount Context

    context("setLiquidationProtocolFeePercentage()", function () {
      context("Happy Path Test Cases", async function () {
        it("Should emit the correct events", async function () {
          const { poolAdmin, lendingPool } =
            await loadFixture(setUpTestFixture);

          const oldLiqProtocolFee =
            await lendingPool.liquidationProtocolFeePercentage();

          const newLiqProtocolFee = 15_00; // 15%;

          await expect(
            lendingPool
              .connect(poolAdmin)
              .setLiquidationProtocolFeePercentage(newLiqProtocolFee)
          )
            .to.emit(lendingPool, "LiquidtionProtocolFeePercentageUpdated")
            .withArgs(poolAdmin.address, oldLiqProtocolFee, newLiqProtocolFee);
        });
        it("Should update state correctly", async function () {
          const { lendingPool, poolAdmin } =
            await loadFixture(setUpTestFixture);

          const newLiqProtocolFee = 15_00; // 15%;

          await lendingPool
            .connect(poolAdmin)
            .setLiquidationProtocolFeePercentage(newLiqProtocolFee);

          expect(await lendingPool.liquidationProtocolFeePercentage()).to.equal(
            newLiqProtocolFee
          );
        });
      }); // End of setLiquidationProtocolFeePercentage Happy Path Test Cases Context

      context("Error Test Cases", async function () {
        it("Should revert if called by address other than the Pool Admin", async function () {
          const { lendingPool, addressesProvider, rando } =
            await loadFixture(setUpTestFixture);

          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.POOL_ADMIN_ROLE()}`;

          await expect(
            lendingPool
              .connect(rando)
              .setLiquidationProtocolFeePercentage(15_00)
          ).to.be.revertedWith(expectedException);
        });

        it("Should revert if the new fee is greater than 100%", async function () {
          const { lendingPool, poolAdmin } =
            await loadFixture(setUpTestFixture);

          await expect(
            lendingPool
              .connect(poolAdmin)
              .setLiquidationProtocolFeePercentage(101_00)
          ).to.be.revertedWith(ProtocolErrors.VALUE_ABOVE_100_PERCENT);
        });
      }); // End of setLiquidationProtocolFeePercentage Error Test Cases Context
    }); // End of setLiquidationProtocolFeePercentage Context

    context("setFlashLoanPremium()", function () {
      context("Happy Path Test Cases", async function () {
        it("Should emit the correct events", async function () {
          const { poolAdmin, lendingPool } =
            await loadFixture(setUpTestFixture);

          const oldFlashLoanPremium = await lendingPool.flashLoanPremiumTotal();

          const newFlashLoanPremium = 12;

          await expect(
            lendingPool
              .connect(poolAdmin)
              .setFlashLoanPremium(newFlashLoanPremium)
          )
            .to.emit(lendingPool, "FlashLoanPremiumUpdated")
            .withArgs(
              poolAdmin.address,
              oldFlashLoanPremium,
              newFlashLoanPremium
            );
        });

        it("Should update state correctly", async function () {
          const { lendingPool, poolAdmin } =
            await loadFixture(setUpTestFixture);

          const newFlashLoanPremium = 8;

          await lendingPool
            .connect(poolAdmin)
            .setFlashLoanPremium(newFlashLoanPremium);

          expect(await lendingPool.flashLoanPremiumTotal()).to.equal(
            newFlashLoanPremium
          );
        });
      }); // End of setFlashLoanPremium Happy Path Test Cases Context

      context("Error Test Cases", async function () {
        it("Should revert if called by address other than the Pool Admin", async function () {
          const { lendingPool, addressesProvider, rando } =
            await loadFixture(setUpTestFixture);

          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.POOL_ADMIN_ROLE()}`;

          await expect(
            lendingPool.connect(rando).setFlashLoanPremium(13)
          ).to.be.revertedWith(expectedException);
        });

        it("Should revert if the new fee is greater than 100%", async function () {
          const { lendingPool, poolAdmin } =
            await loadFixture(setUpTestFixture);

          await expect(
            lendingPool.connect(poolAdmin).setFlashLoanPremium(101_00)
          ).to.be.revertedWith(ProtocolErrors.VALUE_ABOVE_100_PERCENT);
        });
      }); // End of setFlashLoanPremium Error Test Cases Context
    }); // End of setFlashLoanPremium Context

    context("setMeldBankerNFT()", function () {
      context("Happy Path Test Cases", async function () {
        it("Should emit the right event", async function () {
          const { deployer, addressesProvider, lendingPool, meldBankerNft } =
            await loadFixture(meldBankerNftNotSetFixture);

          await addressesProvider
            .connect(deployer)
            .setMeldBankerNFT(meldBankerNft);

          await expect(lendingPool.connect(deployer).setMeldBankerNFT())
            .to.emit(lendingPool, "MeldBankerNFTSet")
            .withArgs(deployer.address, await meldBankerNft.getAddress());
        });
        it("Should update state correctly", async function () {
          const { deployer, addressesProvider, lendingPool, meldBankerNft } =
            await loadFixture(meldBankerNftNotSetFixture);

          await addressesProvider
            .connect(deployer)
            .setMeldBankerNFT(meldBankerNft);

          await lendingPool.connect(deployer).setMeldBankerNFT();

          expect(await lendingPool.meldBankerNFT()).to.equal(
            await meldBankerNft.getAddress()
          );
        });
      }); // End of setMeldBankerNFT Happy Path Test Cases Context

      context("Error Test Cases", async function () {
        it("Should revert if it is already set", async function () {
          const { deployer, addressesProvider, lendingPool, meldBankerNft } =
            await loadFixture(meldBankerNftNotSetFixture);

          await addressesProvider
            .connect(deployer)
            .setMeldBankerNFT(meldBankerNft);

          await lendingPool.connect(deployer).setMeldBankerNFT();

          await expect(
            lendingPool.connect(deployer).setMeldBankerNFT()
          ).to.be.revertedWith(ProtocolErrors.LP_MELD_BANKER_NFT_ALREADY_SET);
        });
        it("Should revert if it is the zero address", async function () {
          const { deployer, lendingPool } = await loadFixture(
            meldBankerNftNotSetFixture
          );

          await expect(
            lendingPool.connect(deployer).setMeldBankerNFT()
          ).to.be.revertedWith(ProtocolErrors.INVALID_ADDRESS);
        });
      }); // End of setMeldBankerNFT Error Test Cases Context
    }); // End of setMeldBankerNFT Context

    context("getReservesList()", function () {
      context("Happy Path Test Cases", async function () {
        it("Should return the correct data", async function () {
          const { lendingPool, usdc, meld, tether } =
            await loadFixture(setUpTestFixture);

          const reservesList = await lendingPool.getReservesList();

          //check to see if reservesList includes await meld.getAddress() and await usdc.getAddress()
          expect(reservesList).to.include(await meld.getAddress());
          expect(reservesList).to.include(await usdc.getAddress());
          expect(reservesList).to.include(await tether.getAddress());
        });
      }); // End of getReservesList Happy Path Test Cases Context
    }); // End of getReservesList Context

    context("reserveExists()", function () {
      context("Happy Path Test Cases", async function () {
        it("Should return false if the asset does not exist", async function () {
          const { lendingPool, unsupportedToken } =
            await loadFixture(setUpTestFixture);

          expect(
            await lendingPool.reserveExists(await unsupportedToken.getAddress())
          ).to.be.false;
        });
        it("Should return true if the asset exists", async function () {
          const { lendingPool, usdc } = await loadFixture(setUpTestFixture);

          expect(await lendingPool.reserveExists(await usdc.getAddress())).to.be
            .true;
        });
      }); // End of reserveExists Happy Path Test Cases Context
    }); // End of reserveExists Context

    context("getReserveNormalizedIncome()", function () {
      context("Happy Path Test Cases", async function () {
        it("Should return the correct data before and after deposit", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            usdc,
            owner,
            depositor,
          } = await loadFixture(setUpTestFixture);

          // Check normalized income for USDC before deposit
          const reserveData = await meldProtocolDataProvider.getReserveData(
            await usdc.getAddress()
          );

          const liquidityRate = reserveData.liquidityRate;
          const currentTimestamp = Math.floor(Date.now() / 1000);

          const expectedNormalizedIncome = calcLinearInterest(
            liquidityRate,
            BigInt(currentTimestamp),
            BigInt(reserveData.lastUpdateTimestamp)
          );
          const usdcReserveNormalizedIncome =
            await lendingPool.getReserveNormalizedIncome(
              await usdc.getAddress()
            );

          expect(usdcReserveNormalizedIncome).to.equal(
            expectedNormalizedIncome
          );

          // Check normalized income for USDC after deposit

          // Set up Deposit. factor = 0 because deposit and approval amount are same
          const depositAmount = await allocateAndApproveTokens(
            usdc,
            owner,
            depositor,
            lendingPool,
            1000n,
            0n
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

          const reserveDataAfterDeposit =
            await meldProtocolDataProvider.getReserveData(
              await usdc.getAddress()
            );

          const liquidityRateAfterDeposit =
            reserveDataAfterDeposit.liquidityRate;

          // Hardhat time module. Gets timestamp of latest block.
          const blockTimestamp = await time.latest();

          const expectedNormalizedIncomeAfterDeposit = calcLinearInterest(
            liquidityRateAfterDeposit,
            BigInt(blockTimestamp),
            BigInt(reserveDataAfterDeposit.lastUpdateTimestamp)
          );
          const usdcReserveNormalizedIncomeAfterDeposit =
            await lendingPool.getReserveNormalizedIncome(
              await usdc.getAddress()
            );

          expect(usdcReserveNormalizedIncomeAfterDeposit).to.equal(
            expectedNormalizedIncomeAfterDeposit
          );
        });

        it("Should return the correct data after borrow", async function () {
          const { lendingPool, meldProtocolDataProvider, usdc, borrower } =
            await loadFixture(setUpForBorrowTestFixture);

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

          // Simulate time passing
          await time.increase(ONE_YEAR / 2);

          const reserveDataAfterBorrow =
            await meldProtocolDataProvider.getReserveData(
              await usdc.getAddress()
            );

          const liquidityRateAfterBorrow = reserveDataAfterBorrow.liquidityRate;

          // Hardhat time module. Gets timestamp of latest block.
          const blockTimestamp2 = await time.latest();

          const expectedNormalizedIncomeAfterBorrow = calcLinearInterest(
            liquidityRateAfterBorrow,
            BigInt(blockTimestamp2),
            BigInt(reserveDataAfterBorrow.lastUpdateTimestamp)
          );
          const usdcReserveNormalizedIncomeAfterBorrow =
            await lendingPool.getReserveNormalizedIncome(
              await usdc.getAddress()
            );

          expect(usdcReserveNormalizedIncomeAfterBorrow).to.equal(
            expectedNormalizedIncomeAfterBorrow
          );
        });
      }); // End of getReserveNormalizedIncome Happy Path Test Cases Context
    }); // End of getReserveNormalizedIncome Context

    context("getReserveNormalizedVariableDebt()", function () {
      context("Happy Path Test Cases", async function () {
        it("Should return the correct data before and after borrowing", async function () {
          const { lendingPool, meldProtocolDataProvider, usdc, borrower } =
            await loadFixture(setUpForBorrowTestFixture);

          // Check normalized variable debt for USDC before borrowing
          const reserveData = await meldProtocolDataProvider.getReserveData(
            await usdc.getAddress()
          );

          const currentVariableBorrowRate = reserveData.variableBorrowRate;
          const currentTimestamp = Math.floor(Date.now() / 1000);

          const expectedNormalizedVariableDebt = calcCompoundedInterest(
            currentVariableBorrowRate,
            BigInt(currentTimestamp),
            BigInt(reserveData.lastUpdateTimestamp)
          );
          const usdcReserveNormalizedVariableDebt =
            await lendingPool.getReserveNormalizedVariableDebt(
              await usdc.getAddress()
            );

          expect(usdcReserveNormalizedVariableDebt).to.equal(
            expectedNormalizedVariableDebt
          );

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

          // Simulate time passing
          await time.increase(ONE_YEAR / 2);

          const reserveDataAfterBorrow =
            await meldProtocolDataProvider.getReserveData(
              await usdc.getAddress()
            );

          const currentVariableBorrowRateAfterBorrow =
            reserveDataAfterBorrow.variableBorrowRate;

          // Hardhat time module. Gets timestamp of latest block.
          const blockTimestamp2 = await time.latest();

          const expectedNormalizedDebtAfterBorrow = calcCompoundedInterest(
            currentVariableBorrowRateAfterBorrow,
            BigInt(blockTimestamp2),
            BigInt(reserveDataAfterBorrow.lastUpdateTimestamp)
          );
          const usdcReserveNormalizedDebtAfterBorrow =
            await lendingPool.getReserveNormalizedVariableDebt(
              await usdc.getAddress()
            );

          expect(usdcReserveNormalizedDebtAfterBorrow).to.equal(
            expectedNormalizedDebtAfterBorrow
          );
        });
      }); // End of getReserveNormalizedVariableDebt Happy Path Test Cases Context
    }); // End of getReserveNormalizedVariableDebt Context

    context("maxStableRateBorrowSizePercent()", function () {
      context("Happy Path Test Cases", async function () {
        it("Should return the correct data", async function () {
          const { lendingPool } = await loadFixture(setUpTestFixture);

          expect(await lendingPool.maxStableRateBorrowSizePercent()).to.equal(
            2500
          );
        });
      }); // End of getMaxStableRateBorrowSizePercent Happy Path Test Cases Context
    }); // End of getMaxStableRateBorrowSizePercent Context

    context("flashLoanPremiumTotal()", function () {
      context("Happy Path Test Cases", async function () {
        it("Should return the correct data", async function () {
          const { lendingPool } = await loadFixture(setUpTestFixture);

          expect(await lendingPool.flashLoanPremiumTotal()).to.equal(9);
        });
      }); // End of getFlashLoanPremiumTotal Happy Path Test Cases Context
    }); // End of getFlashLoanPremiumTotal Context

    context("MAX_NUMBER_OF_RESERVES()", function () {
      context("Happy Path Test Cases", async function () {
        it("Should return the correct data", async function () {
          const { lendingPool } = await loadFixture(setUpTestFixture);

          expect(await lendingPool.MAX_NUMBER_OF_RESERVES()).to.equal(128);
        });
      }); // End of getMaxNumberReserves Happy Path Test Cases Context
    }); // End of getMaxNumberReserves Context

    context("liquidationProtocolFeePercentage()", function () {
      context("Happy Path Test Cases", async function () {
        it("Should return the correct data", async function () {
          it("Should update state correctly", async function () {
            const { lendingPool, poolAdmin } =
              await loadFixture(setUpTestFixture);

            const oldLiqProtocolFee = 10_00; // 10%;
            expect(
              await lendingPool.liquidationProtocolFeePercentage()
            ).to.equal(oldLiqProtocolFee);
            const newLiqProtocolFee = 15_00; // 15%;

            await lendingPool
              .connect(poolAdmin)
              .setLiquidationProtocolFeePercentage(newLiqProtocolFee);

            expect(
              await lendingPool.getLiquidationProtocolFeePercentage()
            ).to.equal(newLiqProtocolFee);
          });
        });
      }); // End of getLiquidationProtocolFeePercentage Happy Path Test Cases Context
    }); // End of getLiquidationProtocolFeePercentage Context

    context("getReserveData()", function () {
      context("Happy Path Test Cases", async function () {
        it("Should return the correct reserve data", async function () {
          const {
            lendingPool,
            lendingPoolConfigurator,
            expectedReserveTokenAddresses,
            usdc,
            poolAdmin,
          } = await loadFixture(setUpTestFixture);

          await lendingPoolConfigurator
            .connect(poolAdmin)
            .configureReserveAsCollateral(
              await usdc.getAddress(),
              5000,
              6000,
              10500n
            );
          await lendingPoolConfigurator
            .connect(poolAdmin)
            .enableBorrowingOnReserve(await usdc.getAddress(), true);
          await lendingPoolConfigurator
            .connect(poolAdmin)
            .enableReserveStableRate(await usdc.getAddress());
          await lendingPoolConfigurator
            .connect(poolAdmin)
            .setReserveFactor(await usdc.getAddress(), 100n);

          const reserveData: DataTypes.ReserveDataStructOutput =
            await lendingPool.getReserveData(await usdc.getAddress());
          const configuration = await lendingPool.getConfiguration(
            await usdc.getAddress()
          );

          expect(reserveData.configuration.toString()).to.equal(
            configuration.toString()
          );
          expect(reserveData.liquidityIndex.toString()).to.equal(oneRay);
          expect(reserveData.variableBorrowIndex).to.equal(oneRay);
          expect(reserveData.currentLiquidityRate).to.equal(0n);
          expect(reserveData.currentVariableBorrowRate).to.equal(0n);
          expect(reserveData.currentStableBorrowRate).to.equal(0n);
          expect(reserveData.lastUpdateTimestamp).to.equal(0n);
          expect(reserveData.mTokenAddress).to.equal(
            expectedReserveTokenAddresses.get("USDC").Mtoken
          );
          expect(reserveData.stableDebtTokenAddress).to.equal(
            expectedReserveTokenAddresses.get("USDC").StableDebtToken
          );
          expect(reserveData.variableDebtTokenAddress).to.equal(
            expectedReserveTokenAddresses.get("USDC").VariableDebtToken
          );
          expect(reserveData.id).to.equal(0);
        });
      }); // End of getReserveData Happy Path Test Cases Context
    }); // End of getReserveData Context

    context("getUserAccountData()", function () {
      context("Happy Path Test Cases", async function () {
        it("Should return the correct data when user has NOT borrowed funds", async function () {
          const {
            lendingPool,
            priceOracleAggregator,
            meldProtocolDataProvider,
            usdc,
            meld,
            owner,
            depositor,
          } = await loadFixture(setUpTestFixture);

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
          await lendingPool
            .connect(depositor)
            .deposit(
              await usdc.getAddress(),
              depositAmountUSDC,
              depositor.address,
              true,
              0
            );

          // Set up MELD Deposit. factor = 0 because deposit and approval amount are same
          const depositAmountMELD = await allocateAndApproveTokens(
            meld,
            owner,
            depositor,
            lendingPool,
            500n,
            0n
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

          const {
            totalCollateralUSD,
            totalDebtUSD,
            availableBorrowsUSD,
            currentLiquidationThreshold,
            ltv,
            healthFactor,
          } = await lendingPool.getUserAccountData(depositor.address);

          // Get ltv and liquidationThreshold
          const reserveConfigDataMELD =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await meld.getAddress()
            );

          const reserveConfigDataUSDC =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await usdc.getAddress()
            );

          // Caclculations based on GenericLogic.calculateUserAccountData

          // Get USDC value
          const [usdcUnitPriceInUSD, oracleSuccess1] =
            await priceOracleAggregator.getAssetPrice(await usdc.getAddress());

          expect(oracleSuccess1).to.be.true;

          const usdcCurrencyUnit = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "1"
          );

          // Get MELD value
          const [meldUnitPriceInUSD, oracleSuccess2] =
            await priceOracleAggregator.getAssetPrice(await meld.getAddress());

          expect(oracleSuccess2).to.be.true;

          const meldCurrencyUnit = await convertToCurrencyDecimals(
            await meld.getAddress(),
            "1"
          );

          const expecteUSDCCollateralUSD =
            (depositAmountUSDC * usdcUnitPriceInUSD) / usdcCurrencyUnit;
          const expecteMELDCollateralUSD =
            (depositAmountMELD * meldUnitPriceInUSD) / meldCurrencyUnit;
          const expectedTotalCollateralUSD =
            expecteUSDCCollateralUSD + expecteMELDCollateralUSD;
          const expectedTotalDebtUSD = 0n;
          const expectedTotalCollateralUSDConverted: bigint =
            expectedTotalCollateralUSD;

          let expectedAvailableBorrowsUSD =
            expectedTotalCollateralUSDConverted.percentMul(ltv);
          expectedAvailableBorrowsUSD =
            expectedAvailableBorrowsUSD - expectedTotalDebtUSD;

          const expectedCurrentLiquidationThreshold =
            (reserveConfigDataUSDC.liquidationThreshold +
              reserveConfigDataMELD.liquidationThreshold) /
            2n;
          const expectedCurrentLiquidationLTV =
            (reserveConfigDataUSDC.ltv + reserveConfigDataMELD.ltv) / 2n;

          expect(totalCollateralUSD).to.equal(expectedTotalCollateralUSD);
          expect(totalDebtUSD).to.equal(expectedTotalDebtUSD);
          expect(availableBorrowsUSD).to.equal(expectedAvailableBorrowsUSD);
          expect(currentLiquidationThreshold).to.equal(
            expectedCurrentLiquidationThreshold
          );
          expect(ltv).to.equal(expectedCurrentLiquidationLTV);
          expect(healthFactor).to.equal(MaxUint256); // HealthFactor is type(uint256).max if totalDebtInUSD == 0n
        });

        it("Should return the correct data when user has borrowed funds", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            priceOracleAggregator,
            usdc,
            meld,
            tether,
            borrower,
            depositAmountMELD,
          } = await loadFixture(setUpForBorrowTestFixture);

          // Borrower borrows USDC from the lending pool, using MELD as collateral
          const amountToBorrowUSDC = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "200"
          );

          // Borrow USDC at stable rate
          await lendingPool
            .connect(borrower)
            .borrow(
              await usdc.getAddress(),
              amountToBorrowUSDC,
              RateMode.Stable,
              borrower.address,
              0
            );

          // Borrower borrows USDT from the lending pool, using MELD as collateral
          const amountToBorrowUSDT = await convertToCurrencyDecimals(
            await tether.getAddress(),
            "100"
          );

          // Borrow USDT at variable rate
          await lendingPool
            .connect(borrower)
            .borrow(
              await tether.getAddress(),
              amountToBorrowUSDT,
              RateMode.Variable,
              borrower.address,
              0
            );

          const {
            totalCollateralUSD,
            totalDebtUSD,
            availableBorrowsUSD,
            currentLiquidationThreshold,
            ltv,
            healthFactor,
          } = await lendingPool.getUserAccountData(borrower.address);

          // Caclculations based on GenericLogic.calculateUserAccountData
          // Calculate expected collateral
          const [meldPrice, meldPriceSuccess] =
            await priceOracleAggregator.getAssetPrice(await meld.getAddress());
          expect(meldPriceSuccess).to.be.true;
          const meldTokenUnit = await convertToCurrencyDecimals(
            await meld.getAddress(),
            "1"
          );

          const expectedTotalCollateralUSD =
            (depositAmountMELD * meldPrice) / meldTokenUnit;

          // Instantiate reserve token contracts
          const reserveTokenAddressesUSDC =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await usdc.getAddress()
            );

          const stableDebtToken = await ethers.getContractAt(
            "StableDebtToken",
            reserveTokenAddressesUSDC.stableDebtTokenAddress
          );

          const reserveTokenAddressesUSDT =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await tether.getAddress()
            );

          const variableDebtToken = await ethers.getContractAt(
            "VariableDebtToken",
            reserveTokenAddressesUSDT.variableDebtTokenAddress
          );

          // Get USDC price in USD
          const [usdcUnitPriceInUSD, usdcUnitPriceInUSDSuccess] =
            await priceOracleAggregator.getAssetPrice(await usdc.getAddress());
          expect(usdcUnitPriceInUSDSuccess).to.be.true;
          const usdcTokenUnit = await convertToCurrencyDecimals(
            await usdc.getAddress(),
            "1"
          );

          // Get USDT price in USD
          const [usdtUnitPriceInUSD, usdtUnitPriceInUSDSuccess] =
            await priceOracleAggregator.getAssetPrice(
              await tether.getAddress()
            );
          expect(usdtUnitPriceInUSDSuccess).to.be.true;
          const usdtTokenUnit = await convertToCurrencyDecimals(
            await tether.getAddress(),
            "1"
          );

          // Calculate expected debt
          const stableDebt = await stableDebtToken.balanceOf(borrower.address);
          const variableDebt = await variableDebtToken.balanceOf(
            borrower.address
          );
          const usdcDebtInUSD =
            (stableDebt * usdcUnitPriceInUSD) / usdcTokenUnit;
          const usdtDebtInUSD =
            (variableDebt * usdtUnitPriceInUSD) / usdtTokenUnit;
          const expectedTotalDebtUSD = usdcDebtInUSD + usdtDebtInUSD;

          // Calculate expected available borrows
          let expectedAvailableBorrowsUSD =
            expectedTotalCollateralUSD.percentMul(ltv);
          expectedAvailableBorrowsUSD =
            expectedAvailableBorrowsUSD - expectedTotalDebtUSD;

          // Get ltv and liquidationThreshold
          const reserveConfigData =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await meld.getAddress()
            );

          // Calculate expected health factor
          const exectedHealthFactor = expectedTotalCollateralUSD
            .percentMul(reserveConfigData.liquidationThreshold)
            .wadDiv(expectedTotalDebtUSD);

          expect(totalCollateralUSD).to.equal(expectedTotalCollateralUSD);
          expect(totalDebtUSD).to.equal(expectedTotalDebtUSD);
          expect(availableBorrowsUSD).to.equal(expectedAvailableBorrowsUSD);
          expect(currentLiquidationThreshold).to.equal(
            reserveConfigData.liquidationThreshold
          );
          expect(ltv).to.equal(reserveConfigData.ltv);
          expect(healthFactor).to.equal(exectedHealthFactor);
        });
      }); // End of getUserAccountData Happy Path Test Cases Context
    }); // End of getUserAccountData Context

    context("yieldBoostMultipliers()", function () {
      context("Happy Path Test Cases", async function () {
        it("Should return the correct data", async function () {
          it("Should update state correctly", async function () {
            const { poolAdmin, lendingPool, usdc } =
              await loadFixture(setUpTestFixture);

            const expectedOldYieldBoostMultiplier = 0n;

            expect(
              await lendingPool.yieldBoostMultipliers(
                MeldBankerType.NONE,
                Action.BORROW
              )
            ).to.equal(expectedOldYieldBoostMultiplier);

            const newYieldBoostMultiplier = 8_00;

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
          });
        });
      }); // End of yieldBoostMultipliers Happy Path Test Cases Context
    }); // End of yieldBoostMultipliers Context
  }); // End of Lending Pool Getters and Setters Context
}); // End of Lending Pool Describe
