import { ethers, upgrades } from "hardhat";
import { network } from "hardhat";
import {
  loadFixture,
  time,
  mine,
} from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import {
  setUpTestFixture,
  allocateAndApproveTokens,
  getBlockTimestamps,
  prepareSplitSignature,
  deployLibraries,
  grantRoles,
  createTokensImplementations,
  loadPoolConfigForEnv,
  deployMockTokens,
  initializeReserves,
} from "./helpers/utils/utils";
import { ProtocolErrors } from "./helpers/types";
import { oneRay, ONE_YEAR, ONE_HOUR } from "./helpers/constants";
import { convertToCurrencyDecimals } from "./helpers/utils/contracts-helpers";
import { getReserveData, expectEqual } from "./helpers/utils/helpers";
import { ReserveData, BlockTimestamps } from "./helpers/interfaces";
import { calcExpectedReserveNormalizedIncome } from "./helpers/utils/calculations";
import { ZeroAddress, TypedDataEncoder, MaxUint256, Contract } from "ethers";
import {
  RateMode,
  IMeldConfiguration,
  PoolConfiguration,
} from "./helpers/types";
import {
  LendingPool,
  MeldProtocolDataProvider,
  DefaultReserveInterestRateStrategy,
  LendingPoolConfigurator,
  MeldPriceOracle,
  PriceOracleAggregator,
  AddressesProvider,
  MeldBankerNFT,
} from "../typechain-types";
import { ReserveInitParams } from "./helpers/interfaces";

describe("MToken", function () {
  async function deployContractsWithMockLendingPoolFixture() {
    const [
      defaultAdmin,
      poolAdmin,
      oracleAdmin,
      bankerAdmin,
      roleDestroyer,
      pauser,
      unpauser,
      treasury,
    ] = await ethers.getSigners();

    upgrades.silenceWarnings();

    // Get pool configuration values
    const poolConfig: PoolConfiguration = loadPoolConfigForEnv();

    const { ReservesConfig } = poolConfig as IMeldConfiguration;
    const reservesConfig = ReservesConfig;

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

    const LendingPool = await ethers.getContractFactory(
      "MockLendingPoolWithTestFunctions",
      {
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
      }
    );

    const AddressesProvider =
      await ethers.getContractFactory("AddressesProvider");
    const addressesProvider = (await AddressesProvider.deploy(
      defaultAdmin
    )) as AddressesProvider & Contract;

    // Grant roles
    await grantRoles(
      addressesProvider,
      defaultAdmin,
      poolAdmin,
      oracleAdmin,
      bankerAdmin,
      pauser,
      unpauser,
      roleDestroyer
    );

    const lendingPool = (await upgrades.deployProxy(
      LendingPool,
      [await addressesProvider.getAddress()],
      {
        kind: "uups",
        unsafeAllowLinkedLibraries: true,
      }
    )) as LendingPool & Contract;

    const LendingPoolConfigurator = await ethers.getContractFactory(
      "LendingPoolConfigurator"
    );

    const {
      mTokenImplAddress,
      stableDebtTokenImplAddress,
      variableDebtTokenImplAddress,
    } = await createTokensImplementations();

    const lendingPoolConfigurator = (await upgrades.deployProxy(
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
      }
    )) as LendingPoolConfigurator & Contract;

    const LendingRateOracleAggregator = await ethers.getContractFactory(
      "LendingRateOracleAggregator"
    );
    const lendingRateOracleAggregator =
      await LendingRateOracleAggregator.deploy(addressesProvider);

    const MeldLendingRateOracle = await ethers.getContractFactory(
      "MeldLendingRateOracle"
    );
    const meldLendingRateOracle =
      await MeldLendingRateOracle.deploy(addressesProvider);

    await lendingRateOracleAggregator
      .connect(oracleAdmin)
      .setLendingRateOracleList([meldLendingRateOracle]);

    const MeldPriceOracle = await ethers.getContractFactory("MeldPriceOracle");
    const meldPriceOracle = (await MeldPriceOracle.deploy(
      addressesProvider
    )) as MeldPriceOracle & Contract;

    const PriceOracleAggregator = await ethers.getContractFactory(
      "PriceOracleAggregator"
    );
    const priceOracleAggregator = (await PriceOracleAggregator.deploy(
      addressesProvider
    )) as PriceOracleAggregator & Contract;

    await priceOracleAggregator
      .connect(oracleAdmin)
      .setPriceOracleList([meldPriceOracle]);

    await addressesProvider.setLendingPool(await lendingPool.getAddress());

    const MeldBankerNFT = await ethers.getContractFactory("MeldBankerNFT");
    const meldBankerNft = (await MeldBankerNFT.deploy(
      addressesProvider
    )) as MeldBankerNFT & Contract;

    const MeldBankerNFTMetadata = await ethers.getContractFactory(
      "MeldBankerNFTMetadata"
    );
    const meldBankerNftMetadata =
      await MeldBankerNFTMetadata.deploy(addressesProvider);

    await meldBankerNft
      .connect(defaultAdmin)
      .setMetadataAddress(meldBankerNftMetadata);

    await addressesProvider.setMeldBankerNFT(meldBankerNft); // Needed for MeldBankerNFTMinter

    const MeldBankerNFTMinter = await ethers.getContractFactory(
      "MeldBankerNFTMinter"
    );
    const meldBankerNftMinter =
      await MeldBankerNFTMinter.deploy(addressesProvider);

    const MockMeldStakingStorage = await ethers.getContractFactory(
      "MockMeldStakingStorage"
    );
    const mockMeldStakingStorage = await MockMeldStakingStorage.deploy();

    await addressesProvider.setMeldStakingStorage(mockMeldStakingStorage); // This is needed for the YieldBoostFactory

    const YieldBoostFactory =
      await ethers.getContractFactory("YieldBoostFactory");
    const yieldBoostFactory = await YieldBoostFactory.deploy(addressesProvider);

    const MeldProtocolDataProvider = await ethers.getContractFactory(
      "MeldProtocolDataProvider"
    );

    const meldProtocolDataProvider = (await MeldProtocolDataProvider.deploy(
      addressesProvider
    )) as MeldProtocolDataProvider & Contract;

    await addressesProvider.setLendingPoolConfigurator(lendingPoolConfigurator);
    await addressesProvider.setLendingRateOracle(lendingRateOracleAggregator);
    await addressesProvider.setPriceOracle(priceOracleAggregator);
    await addressesProvider.setMeldBankerNFTMinter(meldBankerNftMinter);
    await addressesProvider.setYieldBoostFactory(yieldBoostFactory);
    await addressesProvider.setProtocolDataProvider(meldProtocolDataProvider);

    const interestRateStrategyFactory = await ethers.getContractFactory(
      "DefaultReserveInterestRateStrategy"
    );

    const usdcInterestRateStrategy = (await interestRateStrategyFactory.deploy(
      addressesProvider,
      reservesConfig.USDC!.strategy.optimalUtilizationRate,
      reservesConfig.USDC!.strategy.baseVariableBorrowRate,
      reservesConfig.USDC!.strategy.variableRateSlope1,
      reservesConfig.USDC!.strategy.variableRateSlope2,
      reservesConfig.USDC!.strategy.stableRateSlope1,
      reservesConfig.USDC!.strategy.stableRateSlope2
    )) as DefaultReserveInterestRateStrategy & Contract;

    const meldInterestRateStrategy = (await interestRateStrategyFactory.deploy(
      addressesProvider,
      reservesConfig.MELD.strategy.optimalUtilizationRate,
      reservesConfig.MELD.strategy.baseVariableBorrowRate,
      reservesConfig.MELD.strategy.variableRateSlope1,
      reservesConfig.MELD.strategy.variableRateSlope2,
      reservesConfig.MELD.strategy.stableRateSlope1,
      reservesConfig.MELD.strategy.stableRateSlope2
    )) as DefaultReserveInterestRateStrategy & Contract;

    // Deploy mock asset tokens
    const { usdc, meld } = await deployMockTokens();

    // Required for staking
    await addressesProvider.setMeldToken(meld);

    //Initialize reserves
    const reserveInitParams: ReserveInitParams[] = [
      {
        underlyingAsset: usdc,
        interestRateStrategy: usdcInterestRateStrategy,
      },
      {
        underlyingAsset: meld,
        interestRateStrategy: meldInterestRateStrategy,
      },
    ];

    await initializeReserves(
      reserveInitParams,
      treasury.address,
      lendingPoolConfigurator as LendingPoolConfigurator,
      poolAdmin
    );

    return {
      lendingPool,
      lendingPoolConfigurator,
      addressesProvider,
      meldProtocolDataProvider,
      reserveLogic,
      lendingRateOracleAggregator,
      meldLendingRateOracle,
      meldPriceOracle,
      meldBankerNft,
      meldBankerNftMetadata,
      meldBankerNftMinter,
      yieldBoostFactory,
      priceOracleAggregator,
      usdcInterestRateStrategy,
      mTokenImplAddress,
      stableDebtTokenImplAddress,
      variableDebtTokenImplAddress,
      usdc,
    };
  }

  async function setUpDepositFixture() {
    const {
      owner,
      poolAdmin,
      oracleAdmin,
      treasury,
      meldBanker,
      goldenBanker,
      depositor,
      depositor2,
      depositor3,
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
      depositor,
      contracts.lendingPool,
      20_000n,
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

    // DAI
    const depositAmountDAI = await allocateAndApproveTokens(
      dai,
      owner,
      depositor3,
      contracts.lendingPool,
      2000n,
      0n
    );

    await contracts.lendingPool
      .connect(depositor3)
      .deposit(
        await dai.getAddress(),
        depositAmountDAI,
        depositor3.address,
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
      meldBanker,
      goldenBanker,
      depositor,
      depositor2,
      depositor3,
      delegatee,
      rando,
      usdc,
      meld,
      dai,
      tether,
      unsupportedToken,
      depositAmountUSDC,
      depositAmountUSDC2,
      meldBankerTokenId,
      goldenBankerTokenId,
      yieldBoostStorageUSDC,
      yieldBoostStakingUSDC,
      ...contracts,
    };
  }
  context("initialize()", async function () {
    context("Error Test Cases", async function () {
      it("Should revert if initialize is called a second time", async function () {
        const { expectedReserveTokenAddresses, rando } =
          await loadFixture(setUpTestFixture);

        const mUSDC = await ethers.getContractAt(
          "MToken",
          expectedReserveTokenAddresses.get("USDC").Mtoken
        );

        await expect(
          mUSDC
            .connect(rando)
            .initialize(
              rando,
              rando.address,
              rando.address,
              rando.address,
              18n,
              "MToken Name",
              "MTKN"
            )
        ).to.be.revertedWith(
          ProtocolErrors.CT_RESERVE_TOKEN_ALREADY_INITIALIZED
        );
      });
    }); // End of initialize Error Test Cases Context
  }); // End of initialize Context

  context("mint()", async function () {
    context("Error Test Cases", async function () {
      it("Should revert if the caller does not have correct role", async function () {
        const { addressesProvider, expectedReserveTokenAddresses, rando } =
          await loadFixture(setUpTestFixture);

        const mUSDC = await ethers.getContractAt(
          "MToken",
          expectedReserveTokenAddresses.get("USDC").Mtoken
        );
        const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.LENDING_POOL_ROLE()}`;

        await expect(
          mUSDC.connect(rando).mint(rando.address, 100n, oneRay)
        ).to.be.revertedWith(expectedException);
      });
    }); // End of mint Error Test Cases Context
  }); // End of mint Context

  context("burn()", async function () {
    context("Error Test Cases", async function () {
      it("Should revert if the caller does not have correct role", async function () {
        const {
          addressesProvider,
          expectedReserveTokenAddresses,
          rando,
          usdc,
        } = await loadFixture(setUpTestFixture);

        const mUSDC = await ethers.getContractAt(
          "MToken",
          expectedReserveTokenAddresses.get("USDC").Mtoken
        );

        const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.LENDING_POOL_ROLE()}`;

        await expect(
          mUSDC.connect(rando).burn(rando.address, usdc, 100n, oneRay)
        ).to.be.revertedWith(expectedException);
      });
    }); // End of burn Error Test Cases Context
  }); // End of burn Context

  context("mintToTreasury()", async function () {
    context("Happy Path Test Cases", async function () {
      it("Should not emit events if amount == 0", async function () {
        const { meldProtocolDataProvider, lendingPool, usdc } =
          await loadFixture(deployContractsWithMockLendingPoolFixture);

        const reserveTokenAddresses =
          await meldProtocolDataProvider.getReserveTokensAddresses(
            await usdc.getAddress()
          );

        const mUSDC = await ethers.getContractAt(
          "MToken",
          reserveTokenAddresses.mTokenAddress
        );

        await expect(
          lendingPool.mintToTreasury(0n, oneRay, await usdc.getAddress())
        ).to.not.emit(mUSDC, "Transfer");
        await expect(
          lendingPool.mintToTreasury(0n, oneRay, await usdc.getAddress())
        ).to.not.emit(mUSDC, "Mint");
      });
    });
    context("Error Test Cases", async function () {
      it("Should revert if the caller does not have correct role", async function () {
        const { addressesProvider, expectedReserveTokenAddresses, rando } =
          await loadFixture(setUpTestFixture);

        const mUSDC = await ethers.getContractAt(
          "MToken",
          expectedReserveTokenAddresses.get("USDC").Mtoken
        );

        const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.LENDING_POOL_ROLE()}`;

        await expect(
          mUSDC.connect(rando).mintToTreasury(100n, oneRay)
        ).to.be.revertedWith(expectedException);
      });
    }); // End of mintToTreasury Error Test Cases Context
  }); // End of mintToTreasury Context

  context("transferOnLiquidation()", async function () {
    context("Error Test Cases", async function () {
      it("Should revert if the caller does not have correct role", async function () {
        const {
          addressesProvider,
          expectedReserveTokenAddresses,
          rando,
          owner,
        } = await loadFixture(setUpTestFixture);

        const mUSDC = await ethers.getContractAt(
          "MToken",
          expectedReserveTokenAddresses.get("USDC").Mtoken
        );

        const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.LENDING_POOL_ROLE()}`;

        await expect(
          mUSDC
            .connect(rando)
            .transferOnLiquidation(
              await owner.getAddress(),
              await rando.getAddress(),
              100n
            )
        ).to.be.revertedWith(expectedException);
      });
    }); // End of transferOnLiquidation Error Test Cases Context
  }); // End of transferOnLiquidation Context

  context("transferUnderlyingTo()", async function () {
    context("Error Test Cases", async function () {
      it("Should revert if the caller does not have correct role", async function () {
        const { addressesProvider, expectedReserveTokenAddresses, rando } =
          await loadFixture(setUpTestFixture);

        const mUSDC = await ethers.getContractAt(
          "MToken",
          expectedReserveTokenAddresses.get("USDC").Mtoken
        );

        const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.LENDING_POOL_ROLE()}`;

        await expect(
          mUSDC
            .connect(rando)
            .transferUnderlyingTo(await rando.getAddress(), 100n)
        ).to.be.revertedWith(expectedException);
      });
    }); // End of transferUnderlyingTo Error Test Cases Context
  }); // End of transferUnderlyingTo Context

  context("getScaledUserBalanceAndSupply()", async function () {
    context("Happy Path Test Cases", async function () {
      it("Should return correct values", async function () {
        const {
          expectedReserveTokenAddresses,
          depositor,
          depositAmountUSDC,
          depositAmountUSDC2,
        } = await loadFixture(setUpDepositFixture);

        // Simulate time passing
        await time.increase(ONE_YEAR);

        const mUSDC = await ethers.getContractAt(
          "MToken",
          expectedReserveTokenAddresses.get("USDC").Mtoken
        );

        const result = await mUSDC.getScaledUserBalanceAndSupply(
          depositor.address
        );

        // Scaled balance and total supply should be the amuont supplied (scaled), without interest accrued
        expect(result[0]).to.be.equal(depositAmountUSDC); // scaled balance for depositor
        expect(result[1]).to.be.equal(depositAmountUSDC + depositAmountUSDC2); // scaled total supply
      });
    }); // End of getScaledUserBalanceAndSupply Happy Path Test Cases Context
  }); // End of getScaledUserBalanceAndSupply Context

  context("transfer()", async function () {
    context("Happy Path Test Cases", async function () {
      it("Should emit the correct events", async function () {
        const {
          expectedReserveTokenAddresses,
          meldProtocolDataProvider,
          lendingRateOracleAggregator,
          lendingPool,
          yieldBoostStakingUSDC,
          usdc,
          depositAmountUSDC,
          depositor,
          rando,
        } = await loadFixture(setUpDepositFixture);

        const mUSDC = await ethers.getContractAt(
          "MToken",
          expectedReserveTokenAddresses.get("USDC").Mtoken
        );

        const transferAmount = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "200"
        );
        const transferTx = await mUSDC
          .connect(depositor)
          .transfer(rando.address, transferAmount);
        const blockTimestamps: BlockTimestamps =
          await getBlockTimestamps(transferTx);

        // Get USDC reserve data after transfer
        const usdcReserveDataAfterLiquidation: ReserveData =
          await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

        // Regular user, so should emit StakePositionCreated, StakePositionUpdated, RefreshYieldBoostAmount events but not LockMeldBankerNFT
        await expect(transferTx)
          .to.emit(yieldBoostStakingUSDC, "StakePositionCreated")
          .withArgs(rando.address, transferAmount);

        await expect(transferTx)
          .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
          .withArgs(rando.address, 0, transferAmount);

        await expect(transferTx)
          .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
          .withArgs(
            depositor.address,
            depositAmountUSDC,
            depositAmountUSDC - transferAmount
          );

        await expect(transferTx).to.not.emit(lendingPool, "LockMeldBankerNFT");

        await expect(transferTx)
          .to.emit(lendingPool, "RefreshYieldBoostAmount")
          .withArgs(
            await usdc.getAddress(),
            depositor.address,
            depositAmountUSDC - transferAmount
          );

        await expect(transferTx)
          .to.emit(lendingPool, "RefreshYieldBoostAmount")
          .withArgs(await usdc.getAddress(), rando.address, transferAmount);

        await expect(transferTx)
          .to.emit(mUSDC, "Transfer")
          .withArgs(depositor.address, rando.address, transferAmount);

        // Events emitted when liquidator receives collateral mToken
        const liquidityIndex = calcExpectedReserveNormalizedIncome(
          usdcReserveDataAfterLiquidation,
          blockTimestamps.txTimestamp
        );

        await expect(transferTx)
          .to.emit(mUSDC, "BalanceTransfer")
          .withArgs(
            depositor.address,
            rando.address,
            transferAmount,
            liquidityIndex
          );
      });

      it("Should update stake correctly", async function () {
        const {
          expectedReserveTokenAddresses,
          meldProtocolDataProvider,
          lendingRateOracleAggregator,
          usdc,
          depositor,
          rando,
        } = await loadFixture(setUpDepositFixture);

        const mUSDC = await ethers.getContractAt(
          "MToken",
          expectedReserveTokenAddresses.get("USDC").Mtoken
        );

        const transferAmount = await mUSDC.balanceOf(depositor);

        // Get USDC reserve data before transfer
        const usdcReserveDataBeforeLiquidation: ReserveData =
          await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

        await mUSDC.connect(depositor).transfer(rando.address, transferAmount);

        // Get USDC reserve data after transfer
        const usdcReserveDataAfterLiquidation: ReserveData =
          await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

        // The reserve state should not change after a transfer
        expectEqual(
          usdcReserveDataAfterLiquidation,
          usdcReserveDataBeforeLiquidation
        );
      });

      it("Should update token balances correctly", async function () {
        const { expectedReserveTokenAddresses, usdc, depositor, rando } =
          await loadFixture(setUpDepositFixture);

        const mUSDC = await ethers.getContractAt(
          "MToken",
          expectedReserveTokenAddresses.get("USDC").Mtoken
        );

        const depistorBalanceBefore = await mUSDC.balanceOf(depositor.address);
        const randoBalanceBefore = await mUSDC.balanceOf(rando.address);

        const transferAmount = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "200"
        );

        await mUSDC.connect(depositor).transfer(rando.address, transferAmount);

        const depistorBalanceAfter = await mUSDC.balanceOf(depositor.address);
        const randoBalanceAfter = await mUSDC.balanceOf(rando.address);

        expect(depistorBalanceAfter).to.be.equal(
          depistorBalanceBefore - transferAmount
        );
        expect(randoBalanceAfter).to.be.equal(
          randoBalanceBefore + transferAmount
        );
      });
    }); // End of transfer Happy Path Test Cases Context

    context("Error Test Cases", async function () {
      it("Should revert if the receiver address is the zero address", async function () {
        const { expectedReserveTokenAddresses, depositor } =
          await loadFixture(setUpDepositFixture);

        const mUSDC = await ethers.getContractAt(
          "MToken",
          expectedReserveTokenAddresses.get("USDC").Mtoken
        );

        const depistorBalanceBefore = await mUSDC.balanceOf(depositor.address);

        const expectedException = "ERC20: transfer to the zero address";

        await expect(
          mUSDC
            .connect(depositor)
            .transfer(ZeroAddress, depistorBalanceBefore + 1n)
        ).to.be.revertedWith(expectedException);
      });

      it("Should revert if the amount is greater than the sender balance", async function () {
        const { expectedReserveTokenAddresses, depositor, rando } =
          await loadFixture(setUpDepositFixture);

        const mUSDC = await ethers.getContractAt(
          "MToken",
          expectedReserveTokenAddresses.get("USDC").Mtoken
        );

        const depistorBalanceBefore = await mUSDC.balanceOf(depositor.address);

        const expectedException = "ERC20: transfer amount exceeds balance";

        await expect(
          mUSDC
            .connect(depositor)
            .transfer(rando.address, depistorBalanceBefore + 1n)
        ).to.be.revertedWith(expectedException);
      });

      it("Should revert if the transfer would decrease the sender health factor too much", async function () {
        const {
          lendingPool,
          expectedReserveTokenAddresses,
          depositor,
          rando,
          depositAmountUSDC,
          usdc,
        } = await loadFixture(setUpDepositFixture);

        const mUSDC = await ethers.getContractAt(
          "MToken",
          expectedReserveTokenAddresses.get("USDC").Mtoken
        );

        const amountToBorrow = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "10000"
        );

        await lendingPool
          .connect(depositor)
          .borrow(
            await usdc.getAddress(),
            amountToBorrow,
            RateMode.Variable,
            depositor.address,
            0
          );

        await expect(
          mUSDC.connect(depositor).transfer(rando.address, depositAmountUSDC)
        ).to.be.revertedWith(ProtocolErrors.VL_TRANSFER_NOT_ALLOWED);
      });
    }); // End of transfer Error Test Cases Context
  }); // End of transfer Context

  context("transferFrom()", async function () {
    context("Happy Path Test Cases", async function () {
      it("Should emit the correct events", async function () {
        const {
          expectedReserveTokenAddresses,
          meldProtocolDataProvider,
          lendingRateOracleAggregator,
          lendingPool,
          yieldBoostStakingUSDC,
          usdc,
          depositAmountUSDC,
          depositor,
          rando,
          owner,
        } = await loadFixture(setUpDepositFixture);

        const mUSDC = await ethers.getContractAt(
          "MToken",
          expectedReserveTokenAddresses.get("USDC").Mtoken
        );

        const allowance = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "200"
        );

        // First approve an amount
        await mUSDC.connect(depositor).approve(owner.address, allowance);

        const transferAmount = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "200"
        );
        const transferTx = await mUSDC.transferFrom(
          depositor.address,
          rando.address,
          transferAmount
        );
        const blockTimestamps: BlockTimestamps =
          await getBlockTimestamps(transferTx);

        // Get USDC reserve data after transfer
        const usdcReserveDataAfterLiquidation: ReserveData =
          await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

        // Regular user, so should emit StakePositionCreated, StakePositionUpdated, RefreshYieldBoostAmount events but not LockMeldBankerNFT
        await expect(transferTx)
          .to.emit(yieldBoostStakingUSDC, "StakePositionCreated")
          .withArgs(rando.address, transferAmount);

        await expect(transferTx)
          .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
          .withArgs(rando.address, 0, transferAmount);

        await expect(transferTx)
          .to.emit(yieldBoostStakingUSDC, "StakePositionUpdated")
          .withArgs(
            depositor.address,
            depositAmountUSDC,
            depositAmountUSDC - transferAmount
          );

        await expect(transferTx).to.not.emit(lendingPool, "LockMeldBankerNFT");

        await expect(transferTx)
          .to.emit(lendingPool, "RefreshYieldBoostAmount")
          .withArgs(
            await usdc.getAddress(),
            depositor.address,
            depositAmountUSDC - transferAmount
          );

        await expect(transferTx)
          .to.emit(lendingPool, "RefreshYieldBoostAmount")
          .withArgs(await usdc.getAddress(), rando.address, transferAmount);

        await expect(transferTx)
          .to.emit(mUSDC, "Transfer")
          .withArgs(depositor.address, rando.address, transferAmount);

        // Events emitted when liquidator receives collateral mToken
        const liquidityIndex = calcExpectedReserveNormalizedIncome(
          usdcReserveDataAfterLiquidation,
          blockTimestamps.txTimestamp
        );

        await expect(transferTx)
          .to.emit(mUSDC, "BalanceTransfer")
          .withArgs(
            depositor.address,
            rando.address,
            transferAmount,
            liquidityIndex
          );

        await expect(transferTx)
          .to.emit(mUSDC, "Approval")
          .withArgs(
            depositor.address,
            owner.address,
            allowance - transferAmount
          );
      });

      it("Should update stake correctly", async function () {
        const {
          expectedReserveTokenAddresses,
          meldProtocolDataProvider,
          lendingRateOracleAggregator,
          usdc,
          depositor,
          rando,
          owner,
        } = await loadFixture(setUpDepositFixture);

        const mUSDC = await ethers.getContractAt(
          "MToken",
          expectedReserveTokenAddresses.get("USDC").Mtoken
        );

        const allowance = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "200"
        );

        // First approve an amount
        await mUSDC.connect(depositor).approve(owner.address, allowance);

        const allowanceAmountBefore = await mUSDC.allowance(
          depositor.address,
          owner.address
        );

        const transferAmount = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "200"
        );

        // Get USDC reserve data before transfer
        const usdcReserveDataBeforeLiquidation: ReserveData =
          await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

        await mUSDC.transferFrom(
          depositor.address,
          rando.address,
          transferAmount
        );

        // Get USDC reserve data after transfer
        const usdcReserveDataAfterLiquidation: ReserveData =
          await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

        // The reserve state should not change after a transfer
        expectEqual(
          usdcReserveDataAfterLiquidation,
          usdcReserveDataBeforeLiquidation
        );

        const allowanceAmountAfter = await mUSDC.allowance(
          depositor.address,
          owner.address
        );
        expect(allowanceAmountAfter).to.be.equal(
          allowanceAmountBefore - transferAmount
        );
      });

      it("Should update token balances correctly", async function () {
        const { expectedReserveTokenAddresses, usdc, depositor, rando, owner } =
          await loadFixture(setUpDepositFixture);

        const mUSDC = await ethers.getContractAt(
          "MToken",
          expectedReserveTokenAddresses.get("USDC").Mtoken
        );

        const depistorBalanceBefore = await mUSDC.balanceOf(depositor.address);
        const randoBalanceBefore = await mUSDC.balanceOf(rando.address);

        const allowance = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "200"
        );

        // First approve an amount
        await mUSDC.connect(depositor).approve(owner.address, allowance);

        const transferAmount = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "200"
        );

        await mUSDC.transferFrom(
          depositor.address,
          rando.address,
          transferAmount
        );

        const depistorBalanceAfter = await mUSDC.balanceOf(depositor.address);
        const randoBalanceAfter = await mUSDC.balanceOf(rando.address);

        expect(depistorBalanceAfter).to.be.equal(
          depistorBalanceBefore - transferAmount
        );
        expect(randoBalanceAfter).to.be.equal(
          randoBalanceBefore + transferAmount
        );
      });
    }); // End of transferFrom Happy Path Test Cases Context

    context("Error Test Cases", async function () {
      it("Should revert if the sender address is the zero address", async function () {
        const { expectedReserveTokenAddresses, usdc, depositor, owner, rando } =
          await loadFixture(setUpDepositFixture);

        const mUSDC = await ethers.getContractAt(
          "MToken",
          expectedReserveTokenAddresses.get("USDC").Mtoken
        );

        const allowance = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "200"
        );

        // First approve an amount
        await mUSDC.connect(depositor).approve(owner.address, allowance);

        const transferAmount = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "200"
        );

        // Because the ZeroAddress hasn't done any approvals
        const expectedException = "ERC20: transfer amount exceeds allowance";

        await expect(
          mUSDC.transferFrom(ZeroAddress, rando.address, transferAmount)
        ).to.be.revertedWith(expectedException);
      });

      it("Should revert if the receiver address is the zero address", async function () {
        const { expectedReserveTokenAddresses, usdc, depositor, owner } =
          await loadFixture(setUpDepositFixture);

        const mUSDC = await ethers.getContractAt(
          "MToken",
          expectedReserveTokenAddresses.get("USDC").Mtoken
        );

        const allowance = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "200"
        );

        // First approve an amount
        await mUSDC.connect(depositor).approve(owner.address, allowance);

        const transferAmount = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "200"
        );

        const expectedException = "ERC20: transfer to the zero address";

        await expect(
          mUSDC.transferFrom(depositor.address, ZeroAddress, transferAmount)
        ).to.be.revertedWith(expectedException);
      });

      it("Should revert if the amount is greater than the spender allowance", async function () {
        const { expectedReserveTokenAddresses, usdc, depositor, rando, owner } =
          await loadFixture(setUpDepositFixture);

        const mUSDC = await ethers.getContractAt(
          "MToken",
          expectedReserveTokenAddresses.get("USDC").Mtoken
        );

        const allowance = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "200"
        );

        // First approve an amount
        await mUSDC.connect(depositor).approve(owner.address, allowance);

        const transferAmount = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "201"
        );

        const expectedException = "ERC20: transfer amount exceeds allowance";

        await expect(
          mUSDC.transferFrom(depositor.address, rando.address, transferAmount)
        ).to.be.revertedWith(expectedException);
      });

      it("Should revert if the transfer would decrease the sender health factor too much", async function () {
        const {
          lendingPool,
          expectedReserveTokenAddresses,
          depositor,
          rando,
          owner,
          depositAmountUSDC,
          usdc,
        } = await loadFixture(setUpDepositFixture);

        const mUSDC = await ethers.getContractAt(
          "MToken",
          expectedReserveTokenAddresses.get("USDC").Mtoken
        );

        const amountToBorrow = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "10000"
        );

        await lendingPool
          .connect(depositor)
          .borrow(
            await usdc.getAddress(),
            amountToBorrow,
            RateMode.Variable,
            depositor.address,
            0
          );

        const allowance = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "20000"
        );

        // First approve an amount
        await mUSDC.connect(depositor).approve(owner.address, allowance);

        await expect(
          mUSDC.transferFrom(
            depositor.address,
            rando.address,
            depositAmountUSDC
          )
        ).to.be.revertedWith(ProtocolErrors.VL_TRANSFER_NOT_ALLOWED);
      });
    }); // End of transferFrom Error Test Cases Context
  }); // End of transferFrom Context

  context("scaledTotalSupply()", async function () {
    context("Happy Path Test Cases", async function () {
      it("Should return the correct values", async function () {
        const {
          expectedReserveTokenAddresses,
          depositAmountUSDC,
          depositAmountUSDC2,
        } = await loadFixture(setUpDepositFixture);

        // Simulate time passing
        await time.increase(ONE_YEAR);

        const mUSDC = await ethers.getContractAt(
          "MToken",
          expectedReserveTokenAddresses.get("USDC").Mtoken
        );

        const scaledTotalSupply = await mUSDC.scaledTotalSupply();

        // Scaled total supply should be the amuont supplied (scaled), without interest accrued
        expect(scaledTotalSupply).to.be.equal(
          depositAmountUSDC + depositAmountUSDC2
        ); // scaled total supply
      });
    }); // End of scaledTotalSupply Happy Path Test Cases Context
  }); // End of scaledTotalSupply Context

  context("UNDERLYING_ASSET_ADDRESS()", async function () {
    context("Happy Path Test Cases", async function () {
      it("Should return the correct value", async function () {
        const { expectedReserveTokenAddresses, usdc } =
          await loadFixture(setUpTestFixture);

        const mUSDC = await ethers.getContractAt(
          "MToken",
          expectedReserveTokenAddresses.get("USDC").Mtoken
        );

        const underlyingAsset = await mUSDC.UNDERLYING_ASSET_ADDRESS();
        expect(underlyingAsset).to.be.equal(await usdc.getAddress());
      });
    }); // End of UNDERLYING_ASSET_ADDRESS Happy Path Test Cases Context
  }); // End of UNDERLYING_ASSET_ADDRESS Context

  context("DOMAIN_SEPARATOR()", async function () {
    context("Happy Path Test Cases", async function () {
      it("Should return the correct value", async () => {
        const { expectedReserveTokenAddresses } =
          await loadFixture(setUpTestFixture);

        const mUSDC = await ethers.getContractAt(
          "MToken",
          expectedReserveTokenAddresses.get("USDC").Mtoken
        );

        const separator = await mUSDC.DOMAIN_SEPARATOR();

        const domain = {
          name: await mUSDC.name(),
          version: "1",
          chainId: network.config.chainId,
          verifyingContract: await mUSDC.getAddress(),
        };
        const domainSeparator = TypedDataEncoder.hashDomain(domain);

        expect(separator).to.be.equal(
          domainSeparator,
          "Invalid domain separator"
        );
      });
    }); // End of DOMAIN_SEPARATOR Happy Path Test Cases Context
  }); // End of DOMAIN_SEPARATOR Context

  context("permit()", async function () {
    context("Happy Path Test Cases", async function () {
      it("Should emit the correct events", async function () {
        const {
          expectedReserveTokenAddresses,
          usdc,
          depositor,
          rando,
          depositor2,
        } = await loadFixture(setUpTestFixture);

        const mUSDC = await ethers.getContractAt(
          "MToken",
          expectedReserveTokenAddresses.get("USDC").Mtoken
        );

        const owner = depositor;
        const spender = rando; // would normally be a contract, but using a signer here for simplicity
        const deadline = MaxUint256;
        const nonce = await mUSDC.nonces(depositor.address);

        const permitAmount = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "100"
        );

        const splitSignature = await prepareSplitSignature(
          mUSDC,
          owner,
          spender,
          permitAmount,
          nonce,
          deadline
        );

        // Any user can call permit, submitting signature components of a signature created by the owner
        await expect(
          mUSDC
            .connect(depositor2)
            .permit(
              await owner.getAddress(),
              await spender.getAddress(),
              permitAmount,
              deadline,
              splitSignature.v,
              splitSignature.r,
              splitSignature.s
            )
        )
          .to.emit(mUSDC, "Approval")
          .withArgs(owner.address, spender.address, permitAmount);
      });
      it("Should update state correctly", async function () {
        const {
          expectedReserveTokenAddresses,
          usdc,
          depositor,
          rando,
          depositor2,
        } = await loadFixture(setUpTestFixture);

        const mUSDC = await ethers.getContractAt(
          "MToken",
          expectedReserveTokenAddresses.get("USDC").Mtoken
        );

        const owner = depositor;
        const spender = rando; // would normally be a contract, but using a signer here for simplicity
        const deadline = BigInt(await time.latest()) + BigInt(ONE_HOUR);
        const nonce = await mUSDC.nonces(owner.address);
        const permitAmount = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "100"
        );

        const splitSignature = await prepareSplitSignature(
          mUSDC,
          owner,
          spender,
          permitAmount,
          nonce,
          deadline
        );

        expect(
          await mUSDC.allowance(owner.address, spender.address)
        ).to.be.equal(0n);
        expect(nonce).to.be.equal(0);

        // Any user can call permit, submitting signature components of a signature created by the owner
        await mUSDC
          .connect(depositor2)
          .permit(
            await owner.getAddress(),
            await spender.getAddress(),
            permitAmount,
            deadline,
            splitSignature.v,
            splitSignature.r,
            splitSignature.s
          );

        expect(
          await mUSDC.allowance(owner.address, spender.address)
        ).to.be.equal(permitAmount);
        expect(await mUSDC.nonces(owner.address)).to.be.equal(1);
      });
    }); // End of permit Happy Path Test Cases Context

    context("Error Test Cases", async function () {
      it("Should revert if the owner is the zero address", async function () {
        const {
          expectedReserveTokenAddresses,
          usdc,
          depositor,
          rando,
          depositor2,
        } = await loadFixture(setUpTestFixture);

        const mUSDC = await ethers.getContractAt(
          "MToken",
          expectedReserveTokenAddresses.get("USDC").Mtoken
        );

        const owner = depositor;
        const spender = rando; // would normally be a contract, but using a signer here for simplicity
        const deadline = MaxUint256; // essentially never expires
        const nonce = await mUSDC.nonces(owner.address);
        const permitAmount = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "100"
        );

        // Nonce doesn't match the actual nonce, so signature will be deemed invalid
        const splitSignature = await prepareSplitSignature(
          mUSDC,
          owner,
          spender,
          permitAmount,
          1n,
          deadline
        );

        expect(
          await mUSDC.allowance(owner.address, spender.address)
        ).to.be.equal(0n);
        expect(nonce).to.be.equal(0);

        // Any user can call permit, submitting signature components of a signature created by the owner
        await expect(
          mUSDC
            .connect(depositor2)
            .permit(
              ZeroAddress,
              await spender.getAddress(),
              permitAmount,
              deadline,
              splitSignature.v,
              splitSignature.r,
              splitSignature.s
            )
        ).to.be.revertedWith(ProtocolErrors.MT_INVALID_OWNER);
      });

      it("Should revert if the deadline has expired", async function () {
        const {
          expectedReserveTokenAddresses,
          usdc,
          depositor,
          rando,
          depositor2,
        } = await loadFixture(setUpTestFixture);

        const mUSDC = await ethers.getContractAt(
          "MToken",
          expectedReserveTokenAddresses.get("USDC").Mtoken
        );

        const owner = depositor;
        const spender = rando; // would normally be a contract, but using a signer here for simplicity
        const deadline = BigInt(await time.latest()) + BigInt(ONE_HOUR);
        const nonce = await mUSDC.nonces(owner.address);
        const permitAmount = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "100"
        );

        // Nonce doesn't match the actual nonce, so signature will be deemed invalid
        const splitSignature = await prepareSplitSignature(
          mUSDC,
          owner,
          spender,
          permitAmount,
          nonce,
          deadline
        );

        expect(
          await mUSDC.allowance(owner.address, spender.address)
        ).to.be.equal(0n);
        expect(nonce).to.be.equal(0);

        // Advance time past the expiration
        await time.increase(ONE_HOUR + 1);

        // Any user can call permit, submitting signature components of a signature created by the owner
        await expect(
          mUSDC
            .connect(depositor2)
            .permit(
              await owner.getAddress(),
              await spender.getAddress(),
              permitAmount,
              deadline,
              splitSignature.v,
              splitSignature.r,
              splitSignature.s
            )
        ).to.be.revertedWith(ProtocolErrors.MT_INVALID_DEADLINE);
      });

      it("Should revert if the deadline is earlier than current block time", async function () {
        const {
          expectedReserveTokenAddresses,
          usdc,
          depositor,
          rando,
          depositor2,
        } = await loadFixture(setUpTestFixture);

        const mUSDC = await ethers.getContractAt(
          "MToken",
          expectedReserveTokenAddresses.get("USDC").Mtoken
        );

        const owner = depositor;
        const spender = rando; // would normally be a contract, but using a signer here for simplicity
        const deadline = BigInt(await time.latest());

        const nonce = await mUSDC.nonces(owner.address);
        const permitAmount = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "100"
        );

        // Nonce doesn't match the actual nonce, so signature will be deemed invalid
        const splitSignature = await prepareSplitSignature(
          mUSDC,
          owner,
          spender,
          permitAmount,
          nonce,
          deadline
        );

        expect(
          await mUSDC.allowance(owner.address, spender.address)
        ).to.be.equal(0n);
        expect(nonce).to.be.equal(0);

        // Mine 2 block to advance the block time
        await mine(2);

        // Any user can call permit, submitting signature components of a signature created by the owner
        await expect(
          mUSDC
            .connect(depositor2)
            .permit(
              await owner.getAddress(),
              await spender.getAddress(),
              permitAmount,
              deadline,
              splitSignature.v,
              splitSignature.r,
              splitSignature.s
            )
        ).to.be.revertedWith(ProtocolErrors.MT_INVALID_DEADLINE);
      });

      it("Should revert if the deadline is 0", async function () {
        const {
          expectedReserveTokenAddresses,
          usdc,
          depositor,
          rando,
          depositor2,
        } = await loadFixture(setUpTestFixture);

        const mUSDC = await ethers.getContractAt(
          "MToken",
          expectedReserveTokenAddresses.get("USDC").Mtoken
        );

        const owner = depositor;
        const spender = rando; // would normally be a contract, but using a signer here for simplicity
        const deadline = 0n;
        const nonce = await mUSDC.nonces(owner.address);
        const permitAmount = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "100"
        );

        // Nonce doesn't match the actual nonce, so signature will be deemed invalid
        const splitSignature = await prepareSplitSignature(
          mUSDC,
          owner,
          spender,
          permitAmount,
          nonce,
          deadline
        );

        expect(
          await mUSDC.allowance(owner.address, spender.address)
        ).to.be.equal(0n);
        expect(nonce).to.be.equal(0);

        // Advance time past the expiration
        await time.increase(ONE_YEAR + 1);

        // Any user can call permit, submitting signature components of a signature created by the owner
        await expect(
          mUSDC
            .connect(depositor2)
            .permit(
              await owner.getAddress(),
              await spender.getAddress(),
              permitAmount,
              deadline,
              splitSignature.v,
              splitSignature.r,
              splitSignature.s
            )
        ).to.be.revertedWith(ProtocolErrors.MT_INVALID_DEADLINE);
      });

      it("Should revert if the signature is invalid because the nonce is incorrect", async function () {
        const {
          expectedReserveTokenAddresses,
          usdc,
          depositor,
          rando,
          depositor2,
        } = await loadFixture(setUpTestFixture);

        const mUSDC = await ethers.getContractAt(
          "MToken",
          expectedReserveTokenAddresses.get("USDC").Mtoken
        );

        const owner = depositor;
        const spender = rando; // would normally be a contract, but using a signer here for simplicity
        const deadline = MaxUint256;
        const nonce = await mUSDC.nonces(owner.address);
        const permitAmount = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "100"
        );

        // Nonce doesn't match the actual nonce, so signature will be deemed invalid
        const splitSignature = await prepareSplitSignature(
          mUSDC,
          owner,
          spender,
          permitAmount,
          1n,
          deadline
        );

        expect(
          await mUSDC.allowance(owner.address, spender.address)
        ).to.be.equal(0n);
        expect(nonce).to.be.equal(0);

        // Any user can call permit, submitting signature components of a signature created by the owner
        await expect(
          mUSDC
            .connect(depositor2)
            .permit(
              await owner.getAddress(),
              await spender.getAddress(),
              permitAmount,
              deadline,
              splitSignature.v,
              splitSignature.r,
              splitSignature.s
            )
        ).to.be.revertedWith(ProtocolErrors.MT_INVALID_SIGNATURE);
      });

      it("Should revert if the signature is invalid because the owner argument is not the party who signed the message", async function () {
        const {
          expectedReserveTokenAddresses,
          usdc,
          depositor,
          rando,
          depositor2,
        } = await loadFixture(setUpTestFixture);

        const mUSDC = await ethers.getContractAt(
          "MToken",
          expectedReserveTokenAddresses.get("USDC").Mtoken
        );

        const owner = depositor;
        const spender = rando; // would normally be a contract, but using a signer here for simplicity
        const deadline = MaxUint256;
        const nonce = await mUSDC.nonces(owner.address);
        const permitAmount = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "100"
        );

        const splitSignature = await prepareSplitSignature(
          mUSDC,
          owner,
          spender,
          permitAmount,
          nonce,
          deadline
        );

        expect(
          await mUSDC.allowance(owner.address, spender.address)
        ).to.be.equal(0n);
        expect(nonce).to.be.equal(0);

        // The spender is being passed in as the owner
        await expect(
          mUSDC
            .connect(depositor2)
            .permit(
              await spender.getAddress(),
              await spender.getAddress(),
              permitAmount,
              deadline,
              splitSignature.v,
              splitSignature.r,
              splitSignature.s
            )
        ).to.be.revertedWith(ProtocolErrors.MT_INVALID_SIGNATURE);
      });
    }); // End of permit Error Test Cases Context
  }); // End of permit Context

  context("decreaseAllowance()", async function () {
    context("Happy Path Test Cases", async function () {
      it("Should emit the correct event", async function () {
        const { expectedReserveTokenAddresses, depositor, rando, usdc } =
          await loadFixture(setUpTestFixture);
        const spender = rando;

        const mUSDC = await ethers.getContractAt(
          "MToken",
          expectedReserveTokenAddresses.get("USDC").Mtoken
        );

        const allowance = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "100"
        );

        // First approve an amount
        await mUSDC.connect(depositor).approve(spender.address, allowance);

        await expect(
          mUSDC
            .connect(depositor)
            .decreaseAllowance(spender.address, allowance / 2n)
        )
          .to.emit(mUSDC, "Approval")
          .withArgs(depositor.address, spender.address, allowance / 2n);
      });

      it("Should update state correctly", async function () {
        const { expectedReserveTokenAddresses, depositor, rando, usdc } =
          await loadFixture(setUpTestFixture);
        const spender = rando;

        const mUSDC = await ethers.getContractAt(
          "MToken",
          expectedReserveTokenAddresses.get("USDC").Mtoken
        );

        const allowance = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "100"
        );

        // First approve an amount
        await mUSDC.connect(depositor).approve(spender.address, allowance);
        expect(
          await mUSDC.allowance(depositor.address, spender.address)
        ).to.be.equal(allowance);

        await mUSDC
          .connect(depositor)
          .decreaseAllowance(spender.address, allowance / 2n);
        expect(
          await mUSDC.allowance(depositor.address, spender.address)
        ).to.be.equal(allowance / 2n);
      });
    }); // End of decreaseAllowance Happy Path Cases Context
    context("Error Test Cases", async function () {
      it("Should revert if allowance falls below zero", async function () {
        const { expectedReserveTokenAddresses, depositor, rando, usdc } =
          await loadFixture(setUpTestFixture);
        const spender = rando;

        const mUSDC = await ethers.getContractAt(
          "MToken",
          expectedReserveTokenAddresses.get("USDC").Mtoken
        );

        const allowance = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "100"
        );

        // First approve an amount
        await mUSDC.connect(depositor).approve(spender.address, allowance);

        const expectedException = "ERC20: decreased allowance below zero";

        await expect(
          mUSDC
            .connect(depositor)
            .decreaseAllowance(spender.address, allowance + 1n)
        ).to.be.revertedWith(expectedException);
      });

      it("Should revert if the spender is the zero address", async function () {
        const { expectedReserveTokenAddresses, depositor, rando, usdc } =
          await loadFixture(setUpTestFixture);
        const spender = rando;

        const mUSDC = await ethers.getContractAt(
          "MToken",
          expectedReserveTokenAddresses.get("USDC").Mtoken
        );

        const allowance = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "100"
        );

        // First approve an amount
        await mUSDC.connect(depositor).approve(spender.address, allowance);

        // It's the same revert message because the function checks a mapping and there is no allowance for ZeroAddress.
        // Decreasing by any amount will trigger this error
        const expectedException = "ERC20: decreased allowance below zero";

        await expect(
          mUSDC
            .connect(depositor)
            .decreaseAllowance(ZeroAddress, allowance / 2n)
        ).to.be.revertedWith(expectedException);
      });
    }); // End of decreaseAllowance Error Test Cases Context
  }); // End of decreaseAllowance Context

  context("increaseAllowance()", async function () {
    context("Happy Path Test Cases", async function () {
      it("Should emit the correct event", async function () {
        const { expectedReserveTokenAddresses, depositor, rando, usdc } =
          await loadFixture(setUpTestFixture);
        const spender = rando;

        const mUSDC = await ethers.getContractAt(
          "MToken",
          expectedReserveTokenAddresses.get("USDC").Mtoken
        );

        const allowance = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "100"
        );

        await expect(
          mUSDC.connect(depositor).increaseAllowance(spender.address, allowance)
        )
          .to.emit(mUSDC, "Approval")
          .withArgs(depositor.address, spender.address, allowance);
      });

      it("Should update state correctly", async function () {
        const { expectedReserveTokenAddresses, depositor, rando, usdc } =
          await loadFixture(setUpTestFixture);
        const spender = rando;

        const mUSDC = await ethers.getContractAt(
          "MToken",
          expectedReserveTokenAddresses.get("USDC").Mtoken
        );

        const allowance = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "100"
        );

        // First approve an amount
        await mUSDC.connect(depositor).approve(spender.address, allowance);

        expect(
          await mUSDC.allowance(depositor.address, spender.address)
        ).to.be.equal(allowance);

        await mUSDC
          .connect(depositor)
          .increaseAllowance(spender.address, allowance);

        expect(
          await mUSDC.allowance(depositor.address, spender.address)
        ).to.be.equal(allowance * 2n);
      });
    }); // End of increaseAllowance Happy Path Cases Context
    context("Error Test Cases", async function () {
      it("Should revert if the spender is the zero address", async function () {
        const { expectedReserveTokenAddresses, depositor, usdc } =
          await loadFixture(setUpTestFixture);

        const mUSDC = await ethers.getContractAt(
          "MToken",
          expectedReserveTokenAddresses.get("USDC").Mtoken
        );

        const allowance = await convertToCurrencyDecimals(
          await usdc.getAddress(),
          "100"
        );

        const expectedException = "ERC20: approve to the zero address";

        await expect(
          mUSDC.connect(depositor).increaseAllowance(ZeroAddress, allowance)
        ).to.be.revertedWith(expectedException);
      });
    }); // End of increaseAllowance Error Test Cases Context
  }); // End of increaseAllowance Context
}); // End of MToken Test Cases Context
