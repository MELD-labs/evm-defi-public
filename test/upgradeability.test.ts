import { ethers, upgrades } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import {
  allocateAndApproveTokens,
  deployLibraries,
  deployProtocolAndGetSignersFixture,
  setUpTestFixture,
} from "./helpers/utils/utils";
import { Action, MeldBankerType, ProtocolErrors } from "./helpers/types";
import { expect } from "chai";
import { ONE_YEAR } from "./helpers/constants";
import { ZeroAddress } from "ethers";
import { ReserveData, UserReserveData } from "./helpers/interfaces";
import {
  expectEqual,
  getReserveData,
  getUserData,
} from "./helpers/utils/helpers";

describe("Upgradeability", function () {
  upgrades.silenceWarnings();

  async function deployMinimalFixture() {
    const [deployer, rando] = await ethers.getSigners();

    // Have to deploy AddressesProvider separately to test the event because deployContracts calls setMeldBankerNFT. The LendingPool constructor requires the MeldBankerNFT address to be set.
    const AddressesProvider =
      await ethers.getContractFactory("AddressesProvider");
    const addressesProvider = await AddressesProvider.deploy(deployer);

    const allLibraries = await deployLibraries();

    const libraries = {
      ReserveLogic: allLibraries.reserveLogic,
      ValidationLogic: allLibraries.validationLogic,
      GenericLogic: allLibraries.genericLogic,
      LiquidationLogic: allLibraries.liquidationLogic,
      BorrowLogic: allLibraries.borrowLogic,
      DepositLogic: allLibraries.depositLogic,
      FlashLoanLogic: allLibraries.flashLoanLogic,
      WithdrawLogic: allLibraries.withdrawLogic,
      RepayLogic: allLibraries.repayLogic,
      YieldBoostLogic: allLibraries.yieldBoostLogic,
    };

    const LendingPool = await ethers.getContractFactory("LendingPool", {
      libraries,
    });
    const lendingPool = await upgrades.deployProxy(
      LendingPool,
      [await addressesProvider.getAddress()],
      {
        kind: "uups",
        unsafeAllowLinkedLibraries: true,
      }
    );

    return {
      addressesProvider,
      lendingPool,
      deployer,
      rando,
      libraries,
    };
  }

  async function setUpProtocolFixture() {
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

  context("stopUpgradeability()", function () {
    context("Happy Path test cases", function () {
      it("Should emit an event when stopUpgradeability() is called after 6 months", async function () {
        const { owner, addressesProvider } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        // Call stopUpgradeability() after 6 months

        await time.increase(ONE_YEAR / 2);

        await expect(addressesProvider.stopUpgradeability())
          .to.emit(addressesProvider, "UpgradeabilityStopped")
          .withArgs(owner.address);
      });

      it("Should return the correct value for isUpgradeable() after stopUpgradeability() is called after 6 months", async function () {
        const { addressesProvider } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        // Call stopUpgradeability() after 6 months

        await time.increase(ONE_YEAR / 2);

        expect(await addressesProvider.isUpgradeable()).to.be.true;

        await addressesProvider.stopUpgradeability();

        expect(await addressesProvider.isUpgradeable()).to.be.false;
      });
    }); // end stopUpgradeability() Happy Path test cases

    context("Error test cases", function () {
      it("Should revert if stopUpgradeability() is called before 6 months", async function () {
        const { addressesProvider } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        // Call stopUpgradeability() before 6 months
        await expect(addressesProvider.stopUpgradeability()).to.be.revertedWith(
          ProtocolErrors.AP_CANNOT_STOP_UPGRADEABILITY
        );
      });

      it("Should revert if stopUpgradeability() is called by a non-admin", async function () {
        const { rando, addressesProvider } = await loadFixture(
          deployProtocolAndGetSignersFixture
        );

        // Call stopUpgradeability() after 6 months
        await time.increase(ONE_YEAR / 2);

        const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.DEFAULT_ADMIN_ROLE()}`;
        await expect(
          addressesProvider.connect(rando).stopUpgradeability()
        ).to.be.revertedWith(expectedException);
      });
    }); // end stopUpgradeability() Error test cases
  }); // end stopUpgradeability()

  context("LendingPool", function () {
    context("Deploy proxy for LendingPool", function () {
      context("Happy Path test cases", function () {
        it("Should emit an event when the LendingPool proxy is deployed", async function () {
          const { deployer, addressesProvider, libraries } =
            await loadFixture(deployMinimalFixture);

          const LendingPool = await ethers.getContractFactory("LendingPool", {
            libraries,
          });

          const lendingPool = await upgrades.deployProxy(
            LendingPool,
            [await addressesProvider.getAddress()],
            {
              kind: "uups",
              unsafeAllowLinkedLibraries: true,
            }
          );

          await expect(lendingPool.deploymentTransaction()).not.to.be.reverted;

          const newImplAddress = upgrades.erc1967.getImplementationAddress(
            await lendingPool.getAddress()
          );

          await expect(lendingPool.deploymentTransaction())
            .to.emit(lendingPool, "Upgraded")
            .withArgs(newImplAddress)
            .to.emit(lendingPool, "Initialized")
            .withArgs(1)
            .to.emit(lendingPool, "LendingPoolInitialized")
            .withArgs(deployer.address, await addressesProvider.getAddress());
        });

        it("Should have the correct values after the LendingPool proxy is deployed", async function () {
          const { addressesProvider, libraries } =
            await loadFixture(deployMinimalFixture);

          const LendingPool = await ethers.getContractFactory("LendingPool", {
            libraries,
          });

          const lendingPool = await upgrades.deployProxy(
            LendingPool,
            [await addressesProvider.getAddress()],
            {
              kind: "uups",
              unsafeAllowLinkedLibraries: true,
            }
          );

          const implAddress = await upgrades.erc1967.getImplementationAddress(
            await lendingPool.getAddress()
          );

          expect(await lendingPool.getAddress()).not.to.equal(implAddress);

          // Check values match those from the initiliaze function
          expect(await lendingPool.flashLoanPremiumTotal()).to.equal(9);
          expect(await lendingPool.maxStableRateBorrowSizePercent()).to.equal(
            25_00
          );
          expect(await lendingPool.liquidationProtocolFeePercentage()).to.equal(
            10_00
          );

          expect(
            await lendingPool.yieldBoostMultipliers(
              MeldBankerType.NONE,
              Action.DEPOSIT
            )
          ).to.equal(100_00);
          expect(
            await lendingPool.yieldBoostMultipliers(
              MeldBankerType.BANKER,
              Action.DEPOSIT
            )
          ).to.equal(107_00);
          expect(
            await lendingPool.yieldBoostMultipliers(
              MeldBankerType.GOLDEN,
              Action.DEPOSIT
            )
          ).to.equal(120_00);
          expect(
            await lendingPool.yieldBoostMultipliers(
              MeldBankerType.BANKER,
              Action.BORROW
            )
          ).to.equal(7_00);
          expect(
            await lendingPool.yieldBoostMultipliers(
              MeldBankerType.GOLDEN,
              Action.BORROW
            )
          ).to.equal(20_00);
        });

        it("Implementation should have zero values since the storage is in the proxy contract", async function () {
          const { addressesProvider, libraries } =
            await loadFixture(deployMinimalFixture);

          const LendingPool = await ethers.getContractFactory("LendingPool", {
            libraries,
          });

          const lendingPool = await upgrades.deployProxy(
            LendingPool,
            [await addressesProvider.getAddress()],
            {
              kind: "uups",
              unsafeAllowLinkedLibraries: true,
            }
          );

          const implAddress = await upgrades.erc1967.getImplementationAddress(
            await lendingPool.getAddress()
          );

          const lendingPoolImpl = await ethers.getContractAt(
            "LendingPool",
            implAddress
          );

          // Check values are zero
          expect(await lendingPoolImpl.flashLoanPremiumTotal()).to.equal(0);
          expect(
            await lendingPoolImpl.maxStableRateBorrowSizePercent()
          ).to.equal(0);
          expect(
            await lendingPoolImpl.liquidationProtocolFeePercentage()
          ).to.equal(0);
          expect(
            await lendingPoolImpl.yieldBoostMultipliers(
              MeldBankerType.GOLDEN,
              Action.DEPOSIT
            )
          ).to.equal(0);
          expect(
            await lendingPoolImpl.yieldBoostMultipliers(
              MeldBankerType.BANKER,
              Action.DEPOSIT
            )
          ).to.equal(0);
          expect(
            await lendingPoolImpl.yieldBoostMultipliers(
              MeldBankerType.GOLDEN,
              Action.DEPOSIT
            )
          ).to.equal(0);
          expect(
            await lendingPoolImpl.yieldBoostMultipliers(
              MeldBankerType.BANKER,
              Action.BORROW
            )
          ).to.equal(0);
          expect(
            await lendingPoolImpl.yieldBoostMultipliers(
              MeldBankerType.GOLDEN,
              Action.BORROW
            )
          ).to.equal(0);
        });
      }); // end Deploy proxy for LendingPool Happy Path test cases

      context("Error test cases", function () {
        it("Should revert if the LendingPool implementation is not UUPS", async function () {
          const { addressesProvider, libraries } =
            await loadFixture(deployMinimalFixture);

          const MockNotUpgradeableLendingPool = await ethers.getContractFactory(
            "MockNotUpgradeableLendingPool",
            {
              libraries,
            }
          );

          let deployError;

          try {
            await upgrades.deployProxy(
              MockNotUpgradeableLendingPool,
              [await addressesProvider.getAddress()],
              {
                kind: "uups",
                unsafeAllowLinkedLibraries: true,
              }
            );
          } catch (error) {
            deployError = error;
          }
          expect((deployError as Error).message).to.contain(
            "Contract `contracts/mocks/MockNotUpgradeableLendingPool.sol:MockNotUpgradeableLendingPool` is not upgrade safe"
          );
        });
      }); // end Deploy proxy for LendingPool Error test cases
    }); // end Deploy proxy for LendingPool

    context("Upgrade LendingPool proxy", function () {
      context("Happy Path test cases", function () {
        it("Should emit an event when the LendingPool proxy is upgraded with a new implementation", async function () {
          const { lendingPool, libraries } =
            await loadFixture(deployMinimalFixture);

          const LendingPool = await ethers.getContractFactory("LendingPool", {
            libraries,
          });

          const newLendingPool = await upgrades.upgradeProxy(
            await lendingPool.getAddress(),
            LendingPool,
            {
              unsafeAllowLinkedLibraries: true,
              redeployImplementation: "always",
            }
          );

          await expect(newLendingPool.deployTransaction).not.to.be.reverted;

          const newImplAddress =
            await upgrades.erc1967.getImplementationAddress(
              await newLendingPool.getAddress()
            );

          await expect(newLendingPool.deployTransaction)
            .to.emit(lendingPool, "Upgraded")
            .withArgs(newImplAddress);
        });

        it("Should have the correct values after the LendingPool proxy is upgraded", async function () {
          const { lendingPool, libraries } =
            await loadFixture(deployMinimalFixture);

          const MockLendingPool = await ethers.getContractFactory(
            "MockLendingPool",
            {
              libraries,
            }
          );

          const oldImplAddress =
            await upgrades.erc1967.getImplementationAddress(
              await lendingPool.getAddress()
            );

          const oldFlashLoanPremiumTotal =
            await lendingPool.flashLoanPremiumTotal();

          const oldMaxStableRateBorrowSizePercent =
            await lendingPool.maxStableRateBorrowSizePercent();

          const oldLiquidationProtocolFeePercentage =
            await lendingPool.liquidationProtocolFeePercentage();

          const oldYieldBoostMultiplierNoneDeposit =
            await lendingPool.yieldBoostMultipliers(
              MeldBankerType.NONE,
              Action.DEPOSIT
            );

          const oldYieldBoostMultiplierBankerDeposit =
            await lendingPool.yieldBoostMultipliers(
              MeldBankerType.BANKER,
              Action.DEPOSIT
            );

          const oldYieldBoostMultiplierGoldenDeposit =
            await lendingPool.yieldBoostMultipliers(
              MeldBankerType.GOLDEN,
              Action.DEPOSIT
            );

          const oldYieldBoostMultiplierBankerBorrow =
            await lendingPool.yieldBoostMultipliers(
              MeldBankerType.BANKER,
              Action.BORROW
            );

          const oldYieldBoostMultiplierGoldenBorrow =
            await lendingPool.yieldBoostMultipliers(
              MeldBankerType.GOLDEN,
              Action.BORROW
            );

          expect(oldFlashLoanPremiumTotal).not.to.equal(0);
          expect(oldMaxStableRateBorrowSizePercent).not.to.equal(0);
          expect(oldLiquidationProtocolFeePercentage).not.to.equal(0);
          expect(oldYieldBoostMultiplierNoneDeposit).not.to.equal(0);
          expect(oldYieldBoostMultiplierBankerDeposit).not.to.equal(0);
          expect(oldYieldBoostMultiplierGoldenDeposit).not.to.equal(0);
          expect(oldYieldBoostMultiplierBankerBorrow).not.to.equal(0);
          expect(oldYieldBoostMultiplierGoldenBorrow).not.to.equal(0);

          const newLendingPool = await upgrades.upgradeProxy(
            await lendingPool.getAddress(),
            MockLendingPool,
            {
              unsafeAllowLinkedLibraries: true,
              redeployImplementation: "always",
            }
          );

          expect(await lendingPool.getAddress()).to.equal(
            await newLendingPool.getAddress()
          );

          const newImplAddress =
            await upgrades.erc1967.getImplementationAddress(
              await newLendingPool.getAddress()
            );

          expect(newImplAddress).not.to.equal(oldImplAddress);

          const newFlashLoanPremiumTotal =
            await newLendingPool.flashLoanPremiumTotal();

          const newMaxStableRateBorrowSizePercent =
            await newLendingPool.maxStableRateBorrowSizePercent();

          const newLiquidationProtocolFeePercentage =
            await newLendingPool.liquidationProtocolFeePercentage();

          const newYieldBoostMultiplierNoneDeposit =
            await newLendingPool.yieldBoostMultipliers(
              MeldBankerType.NONE,
              Action.DEPOSIT
            );

          const newYieldBoostMultiplierBankerDeposit =
            await newLendingPool.yieldBoostMultipliers(
              MeldBankerType.BANKER,
              Action.DEPOSIT
            );

          const newYieldBoostMultiplierGoldenDeposit =
            await newLendingPool.yieldBoostMultipliers(
              MeldBankerType.GOLDEN,
              Action.DEPOSIT
            );

          const newYieldBoostMultiplierBankerBorrow =
            await newLendingPool.yieldBoostMultipliers(
              MeldBankerType.BANKER,
              Action.BORROW
            );

          const newYieldBoostMultiplierGoldenBorrow =
            await newLendingPool.yieldBoostMultipliers(
              MeldBankerType.GOLDEN,
              Action.BORROW
            );

          // Storage must be preserved
          expect(newFlashLoanPremiumTotal).to.equal(oldFlashLoanPremiumTotal);
          expect(newMaxStableRateBorrowSizePercent).to.equal(
            oldMaxStableRateBorrowSizePercent
          );
          expect(newLiquidationProtocolFeePercentage).to.equal(
            oldLiquidationProtocolFeePercentage
          );
          expect(newYieldBoostMultiplierNoneDeposit).to.equal(
            oldYieldBoostMultiplierNoneDeposit
          );
          expect(newYieldBoostMultiplierBankerDeposit).to.equal(
            oldYieldBoostMultiplierBankerDeposit
          );
          expect(newYieldBoostMultiplierGoldenDeposit).to.equal(
            oldYieldBoostMultiplierGoldenDeposit
          );
          expect(newYieldBoostMultiplierBankerBorrow).to.equal(
            oldYieldBoostMultiplierBankerBorrow
          );
          expect(newYieldBoostMultiplierGoldenBorrow).to.equal(
            oldYieldBoostMultiplierGoldenBorrow
          );

          // Try to call a function from the new implementation

          await expect(newLendingPool.setDoubleFlashLoanPremium(10)).not.to.be
            .reverted;

          expect(await newLendingPool.flashLoanPremiumTotal()).to.equal(20);
        });

        it("Implementation should have zero values since the storage is in the proxy contract", async function () {
          const { lendingPool, libraries } =
            await loadFixture(deployMinimalFixture);

          const MockLendingPool = await ethers.getContractFactory(
            "MockLendingPool",
            {
              libraries,
            }
          );

          const oldFlashLoanPremiumTotal =
            await lendingPool.flashLoanPremiumTotal();

          expect(oldFlashLoanPremiumTotal).not.to.equal(0);

          const newLendingPool = await upgrades.upgradeProxy(
            await lendingPool.getAddress(),
            MockLendingPool,
            {
              unsafeAllowLinkedLibraries: true,
              redeployImplementation: "always",
            }
          );

          const newImplAddress =
            await upgrades.erc1967.getImplementationAddress(
              await newLendingPool.getAddress()
            );

          const lendingPoolImpl = await ethers.getContractAt(
            "MockLendingPool",
            newImplAddress
          );

          // Check values match those from the initiliaze function
          expect(await lendingPoolImpl.flashLoanPremiumTotal()).to.equal(0);
          expect(
            await lendingPoolImpl.maxStableRateBorrowSizePercent()
          ).to.equal(0);
          expect(
            await lendingPoolImpl.liquidationProtocolFeePercentage()
          ).to.equal(0);
          expect(
            await lendingPoolImpl.yieldBoostMultipliers(
              MeldBankerType.NONE,
              Action.DEPOSIT
            )
          ).to.equal(0);
          expect(
            await lendingPoolImpl.yieldBoostMultipliers(
              MeldBankerType.BANKER,
              Action.DEPOSIT
            )
          ).to.equal(0);
          expect(
            await lendingPoolImpl.yieldBoostMultipliers(
              MeldBankerType.GOLDEN,
              Action.DEPOSIT
            )
          ).to.equal(0);
          expect(
            await lendingPoolImpl.yieldBoostMultipliers(
              MeldBankerType.BANKER,
              Action.BORROW
            )
          ).to.equal(0);
          expect(
            await lendingPoolImpl.yieldBoostMultipliers(
              MeldBankerType.GOLDEN,
              Action.BORROW
            )
          ).to.equal(0);
        });

        it("Should keep the storage values after the LendingPool proxy is upgraded", async function () {
          const { addressesProvider, deployer, lendingPool, libraries } =
            await loadFixture(deployMinimalFixture);

          const MockLendingPool = await ethers.getContractFactory(
            "MockLendingPool",
            {
              libraries,
            }
          );

          const oldImplAddress =
            await upgrades.erc1967.getImplementationAddress(
              await lendingPool.getAddress()
            );

          await addressesProvider.grantRole(
            await addressesProvider.POOL_ADMIN_ROLE(),
            deployer
          );

          const updatedFlashLoanPremiumTotal = 33;

          await lendingPool.setFlashLoanPremium(updatedFlashLoanPremiumTotal);

          expect(await lendingPool.flashLoanPremiumTotal()).to.equal(
            updatedFlashLoanPremiumTotal
          );

          const newLendingPool = await upgrades.upgradeProxy(
            await lendingPool.getAddress(),
            MockLendingPool,
            {
              unsafeAllowLinkedLibraries: true,
              redeployImplementation: "always",
            }
          );

          expect(await lendingPool.getAddress()).to.equal(
            await newLendingPool.getAddress()
          );

          const newImplAddress =
            await upgrades.erc1967.getImplementationAddress(
              await newLendingPool.getAddress()
            );

          expect(newImplAddress).not.to.equal(oldImplAddress);

          const newFlashLoanPremiumTotal =
            await newLendingPool.flashLoanPremiumTotal();

          expect(newFlashLoanPremiumTotal).to.equal(
            updatedFlashLoanPremiumTotal
          ); // Storage must be preserved
        });

        it("Should simulate a working protocol and then upgrade the LendingPool proxy", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            tether,
            usdc,
            meld,
            dai,
            borrower,
            depositor,
            lendingRateOracleAggregator,
          } = await loadFixture(setUpProtocolFixture);

          const oldImplAddress =
            await upgrades.erc1967.getImplementationAddress(
              await lendingPool.getAddress()
            );

          // Get reserve data before upgrading

          const tetherReserveDataBeforeUpgrade: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await tether.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          const usdcReserveDataBeforeUpgrade: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          const meldReserveDataBeforeUpgrade: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await meld.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          const daiReserveDataBeforeUpgrade: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await dai.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get borrower reserve data before upgrading

          const tetherBorrowerDataBeforeUpgrade: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await tether.getAddress(),
              borrower.address
            );

          const usdcBorrowerDataBeforeUpgrade: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              borrower.address
            );

          const meldBorrowerDataBeforeUpgrade: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              borrower.address
            );

          const daiBorrowerDataBeforeUpgrade: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await dai.getAddress(),
              borrower.address
            );

          // Get depositor reserve data before upgrading

          const tetherDepositorDataBeforeUpgrade: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await tether.getAddress(),
              depositor.address
            );

          const usdcDepositorDataBeforeUpgrade: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              depositor.address
            );

          const meldDepositorDataBeforeUpgrade: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              depositor.address
            );

          const daiDepositorDataBeforeUpgrade: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await dai.getAddress(),
              depositor.address
            );

          // Upgrade the LendingPool proxy

          const libraries = await deployLibraries();

          const MockLendingPool = await ethers.getContractFactory(
            "MockLendingPool",
            {
              libraries: {
                ReserveLogic: libraries.reserveLogic,
                ValidationLogic: libraries.validationLogic,
                GenericLogic: libraries.genericLogic,
                LiquidationLogic: libraries.liquidationLogic,
                BorrowLogic: libraries.borrowLogic,
                DepositLogic: libraries.depositLogic,
                FlashLoanLogic: libraries.flashLoanLogic,
                WithdrawLogic: libraries.withdrawLogic,
                RepayLogic: libraries.repayLogic,
                YieldBoostLogic: libraries.yieldBoostLogic,
              },
            }
          );

          const newLendingPool = await upgrades.upgradeProxy(
            await lendingPool.getAddress(),
            MockLendingPool,
            {
              unsafeAllowLinkedLibraries: true,
              redeployImplementation: "always",
            }
          );

          expect(await lendingPool.getAddress()).to.equal(
            await newLendingPool.getAddress()
          );

          const newImplAddress =
            await upgrades.erc1967.getImplementationAddress(
              await newLendingPool.getAddress()
            );

          expect(newImplAddress).not.to.equal(oldImplAddress);

          // Get reserve data after upgrading

          const tetherReserveDataAfterUpgrade: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await tether.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          const usdcReserveDataAfterUpgrade: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          const meldReserveDataAfterUpgrade: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          const daiReserveDataAfterUpgrade: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await dai.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get borrower reserve data after upgrading

          const tetherBorrowerDataAfterUpgrade: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await tether.getAddress(),
              borrower.address
            );

          const usdcBorrowerDataAfterUpgrade: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              borrower.address
            );

          const meldBorrowerDataAfterUpgrade: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              borrower.address
            );

          const daiBorrowerDataAfterUpgrade: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await dai.getAddress(),
              borrower.address
            );

          // Get depositor reserve data after upgrading

          const tetherDepositorDataAfterUpgrade: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await tether.getAddress(),
              depositor.address
            );

          const usdcDepositorDataAfterUpgrade: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              depositor.address
            );

          const meldDepositorDataAfterUpgrade: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              depositor.address
            );

          const daiDepositorDataAfterUpgrade: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await dai.getAddress(),
              depositor.address
            );

          // Check that the reserve data is the same before and after the upgrade

          expectEqual(
            tetherReserveDataBeforeUpgrade,
            tetherReserveDataAfterUpgrade
          );
          expectEqual(
            usdcReserveDataBeforeUpgrade,
            usdcReserveDataAfterUpgrade
          );
          expectEqual(
            meldReserveDataBeforeUpgrade,
            meldReserveDataAfterUpgrade
          );
          expectEqual(daiReserveDataBeforeUpgrade, daiReserveDataAfterUpgrade);

          // Check that the borrower data is the same before and after the upgrade

          expectEqual(
            tetherBorrowerDataBeforeUpgrade,
            tetherBorrowerDataAfterUpgrade
          );
          expectEqual(
            usdcBorrowerDataBeforeUpgrade,
            usdcBorrowerDataAfterUpgrade
          );
          expectEqual(
            meldBorrowerDataBeforeUpgrade,
            meldBorrowerDataAfterUpgrade
          );
          expectEqual(
            daiBorrowerDataBeforeUpgrade,
            daiBorrowerDataAfterUpgrade
          );

          // Check that the depositor data is the same before and after the upgrade

          expectEqual(
            tetherDepositorDataBeforeUpgrade,
            tetherDepositorDataAfterUpgrade
          );
          expectEqual(
            usdcDepositorDataBeforeUpgrade,
            usdcDepositorDataAfterUpgrade
          );
          expectEqual(
            meldDepositorDataBeforeUpgrade,
            meldDepositorDataAfterUpgrade
          );
          expectEqual(
            daiDepositorDataBeforeUpgrade,
            daiDepositorDataAfterUpgrade
          );
        });
        it("Should simulate a working protocol and then upgrade the LendingPool proxy with an additional Library and storage", async function () {
          const {
            lendingPool,
            meldProtocolDataProvider,
            tether,
            usdc,
            meld,
            dai,
            borrower,
            depositor,
            lendingRateOracleAggregator,
          } = await loadFixture(setUpProtocolFixture);

          const oldImplAddress =
            await upgrades.erc1967.getImplementationAddress(
              await lendingPool.getAddress()
            );

          // Get reserve data before upgrading

          const tetherReserveDataBeforeUpgrade: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await tether.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          const usdcReserveDataBeforeUpgrade: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          const meldReserveDataBeforeUpgrade: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await meld.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          const daiReserveDataBeforeUpgrade: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await dai.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get borrower reserve data before upgrading

          const tetherBorrowerDataBeforeUpgrade: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await tether.getAddress(),
              borrower.address
            );

          const usdcBorrowerDataBeforeUpgrade: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              borrower.address
            );

          const meldBorrowerDataBeforeUpgrade: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              borrower.address
            );

          const daiBorrowerDataBeforeUpgrade: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await dai.getAddress(),
              borrower.address
            );

          // Get depositor reserve data before upgrading

          const tetherDepositorDataBeforeUpgrade: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await tether.getAddress(),
              depositor.address
            );

          const usdcDepositorDataBeforeUpgrade: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              depositor.address
            );

          const meldDepositorDataBeforeUpgrade: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              depositor.address
            );

          const daiDepositorDataBeforeUpgrade: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await dai.getAddress(),
              depositor.address
            );

          // Upgrade the LendingPool proxy

          const libraries = await deployLibraries();

          const MockLibrary = await ethers.getContractFactory("MockLibrary");
          const mockLibrary = await MockLibrary.deploy();

          const MockLendingPool = await ethers.getContractFactory(
            "MockLendingPoolWithNewLibrary",
            {
              libraries: {
                ReserveLogic: libraries.reserveLogic,
                ValidationLogic: libraries.validationLogic,
                GenericLogic: libraries.genericLogic,
                LiquidationLogic: libraries.liquidationLogic,
                BorrowLogic: libraries.borrowLogic,
                DepositLogic: libraries.depositLogic,
                FlashLoanLogic: libraries.flashLoanLogic,
                WithdrawLogic: libraries.withdrawLogic,
                RepayLogic: libraries.repayLogic,
                YieldBoostLogic: libraries.yieldBoostLogic,
                MockLibrary: mockLibrary,
              },
            }
          );

          const newLendingPool = await upgrades.upgradeProxy(
            await lendingPool.getAddress(),
            MockLendingPool,
            {
              unsafeAllowLinkedLibraries: true,
              redeployImplementation: "always",
            }
          );

          expect(await lendingPool.getAddress()).to.equal(
            await newLendingPool.getAddress()
          );

          const newImplAddress =
            await upgrades.erc1967.getImplementationAddress(
              await newLendingPool.getAddress()
            );

          expect(newImplAddress).not.to.equal(oldImplAddress);

          const contractInstanceWithMockLibraryABI = await ethers.getContractAt(
            "MockLibrary",
            newLendingPool
          );

          // call new function
          await expect(newLendingPool.setMockMappingData(meld, depositor, 42))
            .to.emit(contractInstanceWithMockLibraryABI, "MockEvent")
            .withArgs(meld, depositor, 42);

          const mockData = await newLendingPool.mockMapping(meld);

          expect(mockData[0]).to.equal(depositor.address);
          expect(mockData[1]).to.equal(42n);

          // The rest should be the same as before the upgrade

          // Get reserve data after upgrading

          const tetherReserveDataAfterUpgrade: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await tether.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          const usdcReserveDataAfterUpgrade: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          const meldReserveDataAfterUpgrade: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await meld.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          const daiReserveDataAfterUpgrade: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await dai.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Get borrower reserve data after upgrading

          const tetherBorrowerDataAfterUpgrade: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await tether.getAddress(),
              borrower.address
            );

          const usdcBorrowerDataAfterUpgrade: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              borrower.address
            );

          const meldBorrowerDataAfterUpgrade: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              borrower.address
            );

          const daiBorrowerDataAfterUpgrade: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await dai.getAddress(),
              borrower.address
            );

          // Get depositor reserve data after upgrading

          const tetherDepositorDataAfterUpgrade: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await tether.getAddress(),
              depositor.address
            );

          const usdcDepositorDataAfterUpgrade: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await usdc.getAddress(),
              depositor.address
            );

          const meldDepositorDataAfterUpgrade: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await meld.getAddress(),
              depositor.address
            );

          const daiDepositorDataAfterUpgrade: UserReserveData =
            await getUserData(
              lendingPool,
              meldProtocolDataProvider,
              await dai.getAddress(),
              depositor.address
            );

          // Check that the reserve data is the same before and after the upgrade

          expectEqual(
            tetherReserveDataBeforeUpgrade,
            tetherReserveDataAfterUpgrade
          );
          expectEqual(
            usdcReserveDataBeforeUpgrade,
            usdcReserveDataAfterUpgrade
          );
          expectEqual(
            meldReserveDataBeforeUpgrade,
            meldReserveDataAfterUpgrade
          );
          expectEqual(daiReserveDataBeforeUpgrade, daiReserveDataAfterUpgrade);

          // Check that the borrower data is the same before and after the upgrade

          expectEqual(
            tetherBorrowerDataBeforeUpgrade,
            tetherBorrowerDataAfterUpgrade
          );
          expectEqual(
            usdcBorrowerDataBeforeUpgrade,
            usdcBorrowerDataAfterUpgrade
          );
          expectEqual(
            meldBorrowerDataBeforeUpgrade,
            meldBorrowerDataAfterUpgrade
          );
          expectEqual(
            daiBorrowerDataBeforeUpgrade,
            daiBorrowerDataAfterUpgrade
          );

          // Check that the depositor data is the same before and after the upgrade

          expectEqual(
            tetherDepositorDataBeforeUpgrade,
            tetherDepositorDataAfterUpgrade
          );
          expectEqual(
            usdcDepositorDataBeforeUpgrade,
            usdcDepositorDataAfterUpgrade
          );
          expectEqual(
            meldDepositorDataBeforeUpgrade,
            meldDepositorDataAfterUpgrade
          );
          expectEqual(
            daiDepositorDataBeforeUpgrade,
            daiDepositorDataAfterUpgrade
          );
        });
      }); // end Upgrade LendingPool Happy Path test cases

      context("Error test cases", function () {
        it("Should revert if the LendingPool proxy is upgraded from a wallet different from the DEFAULT_ADMIN", async function () {
          const { rando, deployer, addressesProvider, lendingPool, libraries } =
            await loadFixture(deployMinimalFixture);

          const LendingPool = await ethers.getContractFactory("LendingPool", {
            libraries,
          });

          await addressesProvider.grantRole(
            await addressesProvider.DEFAULT_ADMIN_ROLE(),
            rando
          );

          await addressesProvider.renounceRole(
            await addressesProvider.DEFAULT_ADMIN_ROLE(),
            deployer
          );

          const expectedException = `AccessControl: account ${deployer.address.toLowerCase()} is missing role ${await addressesProvider.DEFAULT_ADMIN_ROLE()}`;
          await expect(
            upgrades.upgradeProxy(await lendingPool.getAddress(), LendingPool, {
              unsafeAllowLinkedLibraries: true,
              redeployImplementation: "always",
            })
          ).to.be.revertedWith(expectedException);
        });

        it("Should revert if the new LendingPool implementation is not UUPS", async function () {
          const { lendingPool, libraries } =
            await loadFixture(deployMinimalFixture);

          const MockNotUpgradeableLendingPool = await ethers.getContractFactory(
            "MockNotUpgradeableLendingPool",
            {
              libraries,
            }
          );

          let upgradeError;

          try {
            await upgrades.validateUpgrade(
              await lendingPool.getAddress(),
              MockNotUpgradeableLendingPool,
              {
                // unsafeAllow: "missing-public-upgradeto",
                unsafeAllowLinkedLibraries: true,
                kind: "uups",
              }
            );
          } catch (error) {
            upgradeError = error;
          }
          expect((upgradeError as Error).message).to.contain(
            "Contract `contracts/mocks/MockNotUpgradeableLendingPool.sol:MockNotUpgradeableLendingPool` is not upgrade safe"
          );
        });

        it("Should revert if the upgradeability has been disabled in the AddressesProvider", async function () {
          const { addressesProvider, lendingPool, libraries } =
            await loadFixture(deployMinimalFixture);

          const LendingPool = await ethers.getContractFactory("LendingPool", {
            libraries,
          });

          await time.increase(ONE_YEAR / 2);

          await addressesProvider.stopUpgradeability();

          await expect(
            upgrades.upgradeProxy(await lendingPool.getAddress(), LendingPool, {
              unsafeAllowLinkedLibraries: true,
              redeployImplementation: "always",
            })
          ).to.be.revertedWith(ProtocolErrors.UPGRADEABILITY_NOT_ALLOWED);
        });

        it("Should revert when trying to call the initialize function after the upgrade", async function () {
          const { addressesProvider, lendingPool, libraries } =
            await loadFixture(deployMinimalFixture);

          const MockLendingPool = await ethers.getContractFactory(
            "MockLendingPool",
            {
              libraries,
            }
          );

          const newLendingPool = await upgrades.upgradeProxy(
            await lendingPool.getAddress(),
            MockLendingPool,
            {
              unsafeAllowLinkedLibraries: true,
              redeployImplementation: "always",
            }
          );

          await expect(
            newLendingPool.initialize(addressesProvider)
          ).to.be.revertedWith(
            "Initializable: contract is already initialized"
          );
        });
      }); // end Upgrade LendingPool Error test cases
    }); // end Upgrade LendingPool
  }); // end LendingPool

  context("LendingPoolConfigurator", function () {
    context("Deploy proxy for LendingPoolConfigurator", function () {
      context("Happy Path test cases", function () {
        it("Should emit an event when the LendingPoolConfigurator proxy is deployed", async function () {
          const {
            owner,
            addressesProvider,
            lendingPool,
            mTokenImplAddress,
            stableDebtTokenImplAddress,
            variableDebtTokenImplAddress,
          } = await loadFixture(setUpTestFixture);

          const LendingPoolConfigurator = await ethers.getContractFactory(
            "LendingPoolConfigurator"
          );

          const lendingPoolConfigurator = await upgrades.deployProxy(
            LendingPoolConfigurator,
            [
              await addressesProvider.getAddress(),
              await lendingPool.getAddress(),
              mTokenImplAddress,
              stableDebtTokenImplAddress,
              variableDebtTokenImplAddress,
            ],
            {
              kind: "uups",
              unsafeAllowLinkedLibraries: true,
            }
          );

          await expect(lendingPoolConfigurator.deploymentTransaction()).not.to
            .be.reverted;

          const newImplAddress =
            await upgrades.erc1967.getImplementationAddress(
              await lendingPoolConfigurator.getAddress()
            );

          await expect(lendingPoolConfigurator.deploymentTransaction())
            .to.emit(lendingPoolConfigurator, "Upgraded")
            .withArgs(newImplAddress)
            .to.emit(lendingPoolConfigurator, "Initialized")
            .withArgs(1)
            .to.emit(
              lendingPoolConfigurator,
              "LendingPoolConfiguratorInitialized"
            )
            .withArgs(
              owner.address,
              await addressesProvider.getAddress(),
              await lendingPool.getAddress(),
              mTokenImplAddress,
              stableDebtTokenImplAddress,
              variableDebtTokenImplAddress
            );
        });

        it("Should have the correct values after the LendingPoolConfigurator proxy is deployed", async function () {
          const {
            addressesProvider,
            lendingPool,
            mTokenImplAddress,
            stableDebtTokenImplAddress,
            variableDebtTokenImplAddress,
          } = await loadFixture(setUpTestFixture);

          const LendingPoolConfigurator = await ethers.getContractFactory(
            "LendingPoolConfigurator"
          );

          const lendingPoolConfigurator = await upgrades.deployProxy(
            LendingPoolConfigurator,
            [
              await addressesProvider.getAddress(),
              await lendingPool.getAddress(),

              mTokenImplAddress,
              stableDebtTokenImplAddress,
              variableDebtTokenImplAddress,
            ],
            {
              kind: "uups",
              unsafeAllowLinkedLibraries: true,
            }
          );

          const implAddress = await upgrades.erc1967.getImplementationAddress(
            await lendingPoolConfigurator.getAddress()
          );

          expect(await lendingPoolConfigurator.getAddress()).not.to.equal(
            implAddress
          );

          expect(await lendingPoolConfigurator.mTokenImpl()).to.equal(
            mTokenImplAddress
          );
          expect(await lendingPoolConfigurator.stableDebtTokenImpl()).to.equal(
            stableDebtTokenImplAddress
          );
          expect(
            await lendingPoolConfigurator.variableDebtTokenImpl()
          ).to.equal(variableDebtTokenImplAddress);
        });

        it("Implementation should have zero values since the storage is in the proxy contract", async function () {
          const {
            addressesProvider,
            lendingPool,
            mTokenImplAddress,
            stableDebtTokenImplAddress,
            variableDebtTokenImplAddress,
          } = await loadFixture(setUpTestFixture);

          const LendingPoolConfigurator = await ethers.getContractFactory(
            "LendingPoolConfigurator"
          );

          const lendingPoolConfigurator = await upgrades.deployProxy(
            LendingPoolConfigurator,
            [
              await addressesProvider.getAddress(),
              await lendingPool.getAddress(),
              mTokenImplAddress,
              stableDebtTokenImplAddress,
              variableDebtTokenImplAddress,
            ],
            {
              kind: "uups",
              unsafeAllowLinkedLibraries: true,
            }
          );

          const implAddress = await upgrades.erc1967.getImplementationAddress(
            await lendingPoolConfigurator.getAddress()
          );

          const lendingPoolConfiguratorImpl = await ethers.getContractAt(
            "LendingPoolConfigurator",
            implAddress
          );

          expect(await lendingPoolConfiguratorImpl.mTokenImpl()).to.equal(
            ZeroAddress
          );
          expect(
            await lendingPoolConfiguratorImpl.stableDebtTokenImpl()
          ).to.equal(ZeroAddress);
          expect(
            await lendingPoolConfiguratorImpl.variableDebtTokenImpl()
          ).to.equal(ZeroAddress);
        });
      }); // end Deploy proxy for LendingPoolConfigurator Happy Path test cases

      context("Error test cases", function () {
        it("Should revert if the LendingPoolConfigurator implementation is not UUPS", async function () {
          const {
            addressesProvider,
            lendingPool,
            mTokenImplAddress,
            stableDebtTokenImplAddress,
            variableDebtTokenImplAddress,
          } = await loadFixture(setUpTestFixture);

          const MockNotUpgradeableLendingPoolConfigurator =
            await ethers.getContractFactory(
              "MockNotUpgradeableLendingPoolConfigurator"
            );

          let deployError;

          try {
            await upgrades.deployProxy(
              MockNotUpgradeableLendingPoolConfigurator,
              [
                await addressesProvider.getAddress(),
                await lendingPool.getAddress(),
                mTokenImplAddress,
                stableDebtTokenImplAddress,
                variableDebtTokenImplAddress,
              ],
              {
                kind: "uups",
                unsafeAllowLinkedLibraries: true,
              }
            );
          } catch (error) {
            deployError = error;
          }
          expect((deployError as Error).message).to.contain(
            "Contract `contracts/mocks/MockNotUpgradeableLendingPoolConfigurator.sol:MockNotUpgradeableLendingPoolConfigurator` is not upgrade safe"
          );
        });
      }); // end Deploy proxy for LendingPoolConfigurator Error test cases
    }); // end Deploy proxy for LendingPoolConfigurator

    context("Upgrade LendingPoolConfigurator proxy", function () {
      context("Happy Path test cases", function () {
        it("Should emit an event when the LendingPoolConfigurator proxy is upgraded with a new implementation", async function () {
          const { lendingPoolConfigurator } =
            await loadFixture(setUpTestFixture);

          const LendingPoolConfigurator = await ethers.getContractFactory(
            "LendingPoolConfigurator"
          );

          const newLendingPoolConfigurator = await upgrades.upgradeProxy(
            await lendingPoolConfigurator.getAddress(),
            LendingPoolConfigurator,
            {
              unsafeAllowLinkedLibraries: true,
              redeployImplementation: "always",
            }
          );

          await expect(newLendingPoolConfigurator.deployTransaction).not.to.be
            .reverted;

          const newImplAddress =
            await upgrades.erc1967.getImplementationAddress(
              await lendingPoolConfigurator.getAddress()
            );

          await expect(newLendingPoolConfigurator.deployTransaction)
            .to.emit(lendingPoolConfigurator, "Upgraded")
            .withArgs(newImplAddress);
        });

        it("Should have the correct values after the LendingPoolConfigurator proxy is upgraded", async function () {
          const { lendingPoolConfigurator } =
            await loadFixture(setUpTestFixture);

          const MockLendingPoolConfigurator = await ethers.getContractFactory(
            "MockLendingPoolConfigurator"
          );

          const oldImplAddress =
            await upgrades.erc1967.getImplementationAddress(
              await lendingPoolConfigurator.getAddress()
            );

          const newLendingPoolConfigurator = await upgrades.upgradeProxy(
            await lendingPoolConfigurator.getAddress(),
            MockLendingPoolConfigurator,
            {
              unsafeAllowLinkedLibraries: true,
              redeployImplementation: "always",
            }
          );

          expect(await lendingPoolConfigurator.getAddress()).to.equal(
            await newLendingPoolConfigurator.getAddress()
          );

          const newImplAddress =
            await upgrades.erc1967.getImplementationAddress(
              await newLendingPoolConfigurator.getAddress()
            );

          expect(newImplAddress).not.to.equal(oldImplAddress);

          // Try to call a function from the new implementation

          expect(await newLendingPoolConfigurator.version()).to.equal(0);
        });

        it("Should have the correct values after the LendingPoolConfigurator proxy is upgraded when some actions were done before the upgrade", async function () {
          const {
            lendingPoolConfigurator,
            poolAdmin,
            usdc,
            dai,
            meldProtocolDataProvider,
          } = await loadFixture(setUpTestFixture);

          // Set supply cap  for USDC
          const newSupplyCap = 1_000_000;

          await lendingPoolConfigurator
            .connect(poolAdmin)
            .setSupplyCapUSD(usdc, newSupplyCap);

          const usdcSupplyCap =
            await meldProtocolDataProvider.getSupplyCapData(usdc);

          expect(usdcSupplyCap[2]).to.equal(newSupplyCap);

          // Deactivate DAI reserve

          await lendingPoolConfigurator
            .connect(poolAdmin)
            .deactivateReserve(dai);

          const daiReserveData =
            await meldProtocolDataProvider.getReserveConfigurationData(dai);

          expect(daiReserveData[9]).to.equal(false);

          // Upgrade the LendingPoolConfigurator proxy

          const MockLendingPoolConfigurator = await ethers.getContractFactory(
            "MockLendingPoolConfigurator"
          );

          const oldImplAddress =
            await upgrades.erc1967.getImplementationAddress(
              await lendingPoolConfigurator.getAddress()
            );

          const newLendingPoolConfigurator = await upgrades.upgradeProxy(
            await lendingPoolConfigurator.getAddress(),
            MockLendingPoolConfigurator,
            {
              unsafeAllowLinkedLibraries: true,
              redeployImplementation: "always",
            }
          );

          expect(await lendingPoolConfigurator.getAddress()).to.equal(
            await newLendingPoolConfigurator.getAddress()
          );

          const newImplAddress =
            await upgrades.erc1967.getImplementationAddress(
              await newLendingPoolConfigurator.getAddress()
            );

          expect(newImplAddress).not.to.equal(oldImplAddress);

          // Check the values after the upgrade

          const newUsdcSupplyCap =
            await meldProtocolDataProvider.getSupplyCapData(usdc);

          expect(newUsdcSupplyCap).to.eqls(usdcSupplyCap);

          const newDaiReserveData =
            await meldProtocolDataProvider.getReserveConfigurationData(dai);

          expect(newDaiReserveData).to.eqls(daiReserveData);
        });
      }); // end Upgrade LendingPoolConfigurator Happy Path test cases

      context("Error test cases", function () {
        it("Should revert if the LendingPoolConfigurator proxy is upgraded from a wallet different from the DEFAULT_ADMIN", async function () {
          const { rando, owner, lendingPoolConfigurator, addressesProvider } =
            await loadFixture(setUpTestFixture);

          const LendingPoolConfigurator = await ethers.getContractFactory(
            "LendingPoolConfigurator"
          );

          await addressesProvider.grantRole(
            await addressesProvider.DEFAULT_ADMIN_ROLE(),
            rando
          );

          await addressesProvider.renounceRole(
            await addressesProvider.DEFAULT_ADMIN_ROLE(),
            owner
          );

          const expectedException = `AccessControl: account ${owner.address.toLowerCase()} is missing role ${await addressesProvider.DEFAULT_ADMIN_ROLE()}`;
          await expect(
            upgrades.upgradeProxy(
              await lendingPoolConfigurator.getAddress(),
              LendingPoolConfigurator,
              {
                unsafeAllowLinkedLibraries: true,
                redeployImplementation: "always",
              }
            )
          ).to.be.revertedWith(expectedException);
        });

        it("Should revert if the new LendingPoolConfigurator implementation is not UUPS", async function () {
          const { lendingPoolConfigurator } =
            await loadFixture(setUpTestFixture);

          const MockNotUpgradeableLendingPoolConfigurator =
            await ethers.getContractFactory(
              "MockNotUpgradeableLendingPoolConfigurator"
            );

          let upgradeError;

          try {
            await upgrades.validateUpgrade(
              await lendingPoolConfigurator.getAddress(),
              MockNotUpgradeableLendingPoolConfigurator,
              {
                unsafeAllowLinkedLibraries: true,
                kind: "uups",
              }
            );
          } catch (error) {
            upgradeError = error;
          }
          expect((upgradeError as Error).message).to.contain(
            "Contract `contracts/mocks/MockNotUpgradeableLendingPoolConfigurator.sol:MockNotUpgradeableLendingPoolConfigurator` is not upgrade safe"
          );
        });

        it("Should revert if the upgradeability has been disabled in the AddressesProvider", async function () {
          const { addressesProvider, lendingPoolConfigurator } =
            await loadFixture(setUpTestFixture);

          const LendingPoolConfigurator = await ethers.getContractFactory(
            "LendingPoolConfigurator"
          );

          await time.increase(ONE_YEAR / 2);

          await addressesProvider.stopUpgradeability();

          await expect(
            upgrades.upgradeProxy(
              await lendingPoolConfigurator.getAddress(),
              LendingPoolConfigurator,
              {
                unsafeAllowLinkedLibraries: true,
                redeployImplementation: "always",
              }
            )
          ).to.be.revertedWith(ProtocolErrors.UPGRADEABILITY_NOT_ALLOWED);
        });

        it("Should revert when trying to call the initialize function after the upgrade", async function () {
          const { lendingPoolConfigurator } =
            await loadFixture(setUpTestFixture);

          const MockLendingPoolConfigurator = await ethers.getContractFactory(
            "MockLendingPoolConfigurator"
          );

          const newLendingPoolConfigurator = await upgrades.upgradeProxy(
            await lendingPoolConfigurator.getAddress(),
            MockLendingPoolConfigurator,
            {
              unsafeAllowLinkedLibraries: true,
              redeployImplementation: "always",
            }
          );

          await expect(
            newLendingPoolConfigurator.initialize(
              ZeroAddress,
              ZeroAddress,
              ZeroAddress,
              ZeroAddress,
              ZeroAddress
            )
          ).to.be.revertedWith(
            "Initializable: contract is already initialized"
          );
        });
      }); // end Upgrade LendingPoolConfigurator Error test cases
    }); // end Upgrade LendingPoolConfigurator
  }); // end LendingPoolConfigurator
});
