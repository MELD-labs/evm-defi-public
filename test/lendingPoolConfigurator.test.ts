import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ZeroAddress } from "ethers";
import { expect } from "chai";
import { Contract } from "ethers";
import {
  deployMockTokens,
  initializeReserves,
  createInitReserveParams,
  allocateAndApproveTokens,
  calculateTokenAddresses,
  getTokensParams,
  deployProtocolAndGetSignersFixture,
  loadPoolConfigForEnv,
  getReservesConfigByPool,
} from "./helpers/utils/utils";
import { getReserveData, expectEqual } from "./helpers/utils/helpers";
import { ReserveData, ReserveInitParams } from "./helpers/interfaces";
import { SampleERC20 } from "../typechain-types";
import type { ILendingPoolConfigurator } from "../typechain-types/contracts/lending/LendingPoolConfigurator";
import { _1e18, oneRay } from "./helpers/constants";
import {
  ProtocolErrors,
  IReserveParams,
  iMeldPoolAssets,
  Configuration,
  MeldPools,
  PoolConfiguration,
  IMeldConfiguration,
} from "./helpers/types";
import { LendingPoolConfigurator } from "../typechain-types";

describe("LendingPoolConfigurator", function () {
  async function setUpTestFixture() {
    // Deploy protocol
    const {
      lendingPool,
      lendingPoolConfigurator,
      meldProtocolDataProvider,
      reserveLogic,
      lendingRateOracleAggregator,
      meldLendingRateOracle,
      meldPriceOracle,
      usdcInterestRateStrategy,
      meldInterestRateStrategy,
      addressesProvider,
      owner,
      poolAdmin,
      treasury,
      rando,
    } = await deployProtocolAndGetSignersFixture();

    // Deploy mock asset tokens
    const { usdc, unsupportedToken, meld } = await deployMockTokens();

    await addressesProvider.setMeldToken(meld);

    return {
      lendingPool,
      lendingPoolConfigurator,
      meldProtocolDataProvider,
      reserveLogic,
      lendingRateOracleAggregator,
      meldLendingRateOracle,
      meldPriceOracle,
      usdcInterestRateStrategy,
      meldInterestRateStrategy,
      addressesProvider,
      usdc,
      unsupportedToken,
      meld,
      owner,
      poolAdmin,
      treasury,
      rando,
    };
  }

  async function setUpTestInitReserveFixture() {
    // Deploy protocol
    const {
      addressesProvider,
      lendingPool,
      lendingPoolConfigurator,
      meldProtocolDataProvider,
      reserveLogic,
      lendingRateOracleAggregator,
      meldLendingRateOracle,
      meldPriceOracle,
      usdcInterestRateStrategy,
      meldInterestRateStrategy,
      owner,
      poolAdmin,
      oracleAdmin,
      depositor,
      treasury,
      rando,
    } = await deployProtocolAndGetSignersFixture();

    // Deploy mock asset tokens
    const { usdc, unsupportedToken, meld } = await deployMockTokens();

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
      addressesProvider,
      lendingPool,
      lendingPoolConfigurator,
      meldProtocolDataProvider,
      reserveLogic,
      lendingRateOracleAggregator,
      meldLendingRateOracle,
      meldPriceOracle,
      usdc,
      unsupportedToken,
      meld,
      owner,
      poolAdmin,
      oracleAdmin,
      depositor,
      treasury,
      rando,
    };
  }
  context("Reserve Not Yet Initialized", async function () {
    it("Should be empty before initialization", async function () {
      const { meldProtocolDataProvider, lendingRateOracleAggregator, usdc } =
        await loadFixture(setUpTestFixture);

      const expectedReserveData = {
        address: await usdc.getAddress(),
        symbol: "USDC",
        decimals: 6n,
        totalLiquidity: 0n,
        availableLiquidity: 0n,
        totalStableDebt: 0n,
        totalVariableDebt: 0n,
        principalStableDebt: 0n,
        scaledVariableDebt: 0n,
        averageStableBorrowRate: 0n,
        variableBorrowRate: 0n,
        stableBorrowRate: 0n,
        utilizationRate: 0n,
        liquidityIndex: 0n,
        variableBorrowIndex: 0n,
        mTokenAddress: ZeroAddress,
        marketStableRate: 0n,
        lastUpdateTimestamp: 0n,
        totalStableDebtLastUpdated: 0n,
        liquidityRate: 0n,
        stableDebtTokenAddress: ZeroAddress,
        variableDebtTokenAddress: ZeroAddress,
      } as ReserveData;

      // Get reserve data before initialization
      const reserveDataBeforeInitialization: ReserveData = await getReserveData(
        meldProtocolDataProvider,
        await usdc.getAddress(),
        await lendingRateOracleAggregator.getAddress()
      );

      expectEqual(reserveDataBeforeInitialization, expectedReserveData);

      expect(
        await meldProtocolDataProvider.getReserveYieldBoostStaking(usdc)
      ).to.be.equal(ZeroAddress);
    });
  }); // End of Reserve Not Yet Initialized Context

  context("Initialize Reserves", async function () {
    context("Happy Flow Test Cases", async function () {
      context("Create one reserve", async function () {
        it("Should emit correct events", async function () {
          const {
            lendingPoolConfigurator,
            usdcInterestRateStrategy,
            addressesProvider,
            lendingPool,
            usdc,
            treasury,
            poolAdmin,
          } = await loadFixture(setUpTestFixture);

          const usdcReserveParams: ILendingPoolConfigurator.InitReserveInputStruct =
            await createInitReserveParams(
              usdc,
              usdcInterestRateStrategy,
              treasury.address
            );

          // Call before initializing the reserve so that nonce is correct
          const expectedTokenAddresses = await calculateTokenAddresses(
            lendingPoolConfigurator,
            ["USDC"]
          );

          // Check that tokens were created correctly
          const mUSDC = await ethers.getContractAt(
            "MToken",
            expectedTokenAddresses.get("USDC").Mtoken
          );

          const stableDebtToken = await ethers.getContractAt(
            "StableDebtToken",
            expectedTokenAddresses.get("USDC").StableDebtToken
          );

          const variableDebtToken = await ethers.getContractAt(
            "VariableDebtToken",
            expectedTokenAddresses.get("USDC").VariableDebtToken
          );

          // Initialize USDC reserve
          const initTx = await lendingPoolConfigurator
            .connect(poolAdmin)
            .batchInitReserve([usdcReserveParams]);

          // Check that reserve tokens emit the correct events
          await expect(initTx)
            .to.emit(mUSDC, "Initialized")
            .withArgs(
              await addressesProvider.getAddress(),
              await lendingPool.getAddress(),
              treasury.address,
              await usdc.getAddress(),
              await mUSDC.decimals(),
              await mUSDC.name(),
              await mUSDC.symbol()
            );

          await expect(initTx)
            .to.emit(stableDebtToken, "Initialized")
            .withArgs(
              await addressesProvider.getAddress(),
              await usdc.getAddress(),
              await lendingPool.getAddress(),
              await stableDebtToken.decimals(),
              await stableDebtToken.name(),
              await stableDebtToken.symbol()
            );

          await expect(initTx)
            .to.emit(variableDebtToken, "Initialized")
            .withArgs(
              await addressesProvider.getAddress(),
              await usdc.getAddress(),
              await lendingPool.getAddress(),
              await variableDebtToken.decimals(),
              await variableDebtToken.name(),
              await variableDebtToken.symbol()
            );

          // Check that lendingPoolConfigurator emits the  ReserveInitialized event with the correct parameters
          await expect(initTx)
            .to.emit(lendingPoolConfigurator, "ReserveInitialized")
            .withArgs(
              await usdc.getAddress(),
              expectedTokenAddresses.get("USDC").Mtoken,
              expectedTokenAddresses.get("USDC").StableDebtToken,
              expectedTokenAddresses.get("USDC").VariableDebtToken,
              await usdcInterestRateStrategy.getAddress(),
              true
            );
        });

        it("Should emit correct events when initializing a reserve with yield boost enabled", async function () {
          const {
            lendingPoolConfigurator,
            usdcInterestRateStrategy,
            addressesProvider,
            lendingPool,
            usdc,
            treasury,
            poolAdmin,
          } = await loadFixture(setUpTestFixture);

          const usdcReserveParams: ILendingPoolConfigurator.InitReserveInputStruct =
            await createInitReserveParams(
              usdc,
              usdcInterestRateStrategy,
              treasury.address
            );

          usdcReserveParams.yieldBoostEnabled = true;

          // Call before initializing the reserve so that nonce is correct
          const expectedTokenAddresses = await calculateTokenAddresses(
            lendingPoolConfigurator,
            ["USDC"]
          );

          // Check that tokens were created correctly
          const mUSDC = await ethers.getContractAt(
            "MToken",
            expectedTokenAddresses.get("USDC").Mtoken
          );

          const stableDebtToken = await ethers.getContractAt(
            "StableDebtToken",
            expectedTokenAddresses.get("USDC").StableDebtToken
          );

          const variableDebtToken = await ethers.getContractAt(
            "VariableDebtToken",
            expectedTokenAddresses.get("USDC").VariableDebtToken
          );

          // Initialize USDC reserve
          const initTx = await lendingPoolConfigurator
            .connect(poolAdmin)
            .batchInitReserve([usdcReserveParams]);

          // Check that reserve tokens emit the correct events
          await expect(initTx)
            .to.emit(mUSDC, "Initialized")
            .withArgs(
              await addressesProvider.getAddress(),
              await lendingPool.getAddress(),
              treasury.address,
              await usdc.getAddress(),
              await mUSDC.decimals(),
              await mUSDC.name(),
              await mUSDC.symbol()
            );

          await expect(initTx)
            .to.emit(stableDebtToken, "Initialized")
            .withArgs(
              await addressesProvider.getAddress(),
              await usdc.getAddress(),
              await lendingPool.getAddress(),
              await stableDebtToken.decimals(),
              await stableDebtToken.name(),
              await stableDebtToken.symbol()
            );

          await expect(initTx)
            .to.emit(variableDebtToken, "Initialized")
            .withArgs(
              await addressesProvider.getAddress(),
              await usdc.getAddress(),
              await lendingPool.getAddress(),
              await variableDebtToken.decimals(),
              await variableDebtToken.name(),
              await variableDebtToken.symbol()
            );

          // Check that lendingPoolConfigurator emits the  ReserveInitialized event with the correct parameters
          await expect(initTx)
            .to.emit(lendingPoolConfigurator, "ReserveInitialized")
            .withArgs(
              await usdc.getAddress(),
              expectedTokenAddresses.get("USDC").Mtoken,
              expectedTokenAddresses.get("USDC").StableDebtToken,
              expectedTokenAddresses.get("USDC").VariableDebtToken,
              await usdcInterestRateStrategy.getAddress(),
              true
            );
        });

        it("Should update state correctly", async function () {
          const {
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            lendingPoolConfigurator,
            usdcInterestRateStrategy,
            usdc,
            treasury,
            poolAdmin,
          } = await loadFixture(setUpTestFixture);

          const usdcReserveParams: ILendingPoolConfigurator.InitReserveInputStruct =
            await createInitReserveParams(
              usdc,
              usdcInterestRateStrategy,
              treasury.address
            );

          // Call before initializing the reserve so that nonce is correct
          const expectedTokenAddresses = await calculateTokenAddresses(
            lendingPoolConfigurator,
            ["USDC"]
          );

          const expectedReserveDataAfterInitialization = {
            address: await usdc.getAddress(),
            symbol: "USDC",
            decimals: 6n,
            totalLiquidity: 0n,
            availableLiquidity: 0n,
            totalStableDebt: 0n,
            totalVariableDebt: 0n,
            principalStableDebt: 0n,
            scaledVariableDebt: 0n,
            averageStableBorrowRate: 0n,
            variableBorrowRate: 0n,
            stableBorrowRate: 0n,
            utilizationRate: 0n,
            liquidityIndex: oneRay,
            variableBorrowIndex: oneRay,
            mTokenAddress: expectedTokenAddresses.get("USDC").Mtoken,
            marketStableRate: 0n,
            lastUpdateTimestamp: 0n,
            totalStableDebtLastUpdated: 0n,
            liquidityRate: 0n,
            stableDebtTokenAddress:
              expectedTokenAddresses.get("USDC").StableDebtToken,
            variableDebtTokenAddress:
              expectedTokenAddresses.get("USDC").VariableDebtToken,
          } as ReserveData;

          // Initialize USDC reserve
          await lendingPoolConfigurator
            .connect(poolAdmin)
            .batchInitReserve([usdcReserveParams]);

          // Get reserve data after initialization
          const reserveDataAfterInitialization: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Check reserve data
          expectEqual(
            reserveDataAfterInitialization,
            expectedReserveDataAfterInitialization
          );

          // Check the reserve data configuration
          const reserveConfigAfterInitialization =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await usdc.getAddress()
            );
          expect(reserveConfigAfterInitialization.decimals).to.equal(6);
          expect(reserveConfigAfterInitialization.ltv).to.equal(0);
          expect(
            reserveConfigAfterInitialization.liquidationThreshold
          ).to.equal(0);
          expect(reserveConfigAfterInitialization.liquidationBonus).to.equal(0);
          expect(reserveConfigAfterInitialization.reserveFactor).to.equal(0);
          expect(reserveConfigAfterInitialization.supplyCapUSD).to.equal(0);
          expect(reserveConfigAfterInitialization.borrowCapUSD).to.equal(0);
          expect(reserveConfigAfterInitialization.flashLoanLimitUSD).to.equal(
            0
          );
          expect(reserveConfigAfterInitialization.usageAsCollateralEnabled).to
            .be.false;
          expect(reserveConfigAfterInitialization.borrowingEnabled).to.be.false;
          expect(reserveConfigAfterInitialization.stableBorrowRateEnabled).to.be
            .false;
          expect(reserveConfigAfterInitialization.isActive).to.be.true;
          expect(reserveConfigAfterInitialization.isFrozen).to.be.false;

          // Check that reserve token was registered
          const allReservesTokens =
            await meldProtocolDataProvider.getAllReservesTokens();
          expect(allReservesTokens[0].symbol).to.equal("USDC");
          expect(allReservesTokens[0].tokenAddress).to.equal(
            await usdc.getAddress()
          );

          // Check that mToken was registered
          const allMTokens = await meldProtocolDataProvider.getAllMTokens();
          expect(allMTokens[0].symbol).to.equal("mUSDC");
          expect(allMTokens[0].tokenAddress).to.equal(
            expectedTokenAddresses.get("USDC").Mtoken
          );

          // Check that all token addresses can be retrieved correctly
          const allTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await usdc.getAddress()
            );
          expect(allTokenAddresses.mTokenAddress).to.equal(
            expectedTokenAddresses.get("USDC").Mtoken
          );
          expect(allTokenAddresses.stableDebtTokenAddress).to.equal(
            expectedTokenAddresses.get("USDC").StableDebtToken
          );
          expect(allTokenAddresses.variableDebtTokenAddress).to.equal(
            expectedTokenAddresses.get("USDC").VariableDebtToken
          );

          expect(
            await meldProtocolDataProvider.getReserveYieldBoostStaking(usdc)
          ).not.to.be.equal(ZeroAddress);

          const poolConfig: PoolConfiguration = loadPoolConfigForEnv();

          const { ReservesConfig } = poolConfig as IMeldConfiguration;

          const usdcStrategyParams = ReservesConfig.USDC?.strategy;

          const baseVariableBorrowRate =
            usdcStrategyParams?.baseVariableBorrowRate as string;
          const variableRateSlope1 =
            usdcStrategyParams?.variableRateSlope1 as string;
          const variableRateSlope2 =
            usdcStrategyParams?.variableRateSlope2 as string;

          expect(
            await usdcInterestRateStrategy.getMaxVariableBorrowRate()
          ).to.equal(
            BigInt(baseVariableBorrowRate) +
              BigInt(variableRateSlope1) +
              BigInt(variableRateSlope2)
          );
        });

        it("Should create tokens correctly", async function () {
          const {
            lendingPoolConfigurator,
            usdcInterestRateStrategy,
            usdc,
            treasury,
            poolAdmin,
          } = await loadFixture(setUpTestFixture);

          const usdcParams = await getTokensParams(usdc);

          // Call before initializing the reserve so that nonce is correct
          const expectedTokenAddresses = await calculateTokenAddresses(
            lendingPoolConfigurator,
            ["USDC"]
          );

          const usdcReserveParams: ILendingPoolConfigurator.InitReserveInputStruct =
            {
              yieldBoostEnabled: false,
              underlyingAssetDecimals: usdcParams.decimals,
              interestRateStrategyAddress:
                await usdcInterestRateStrategy.getAddress(),
              underlyingAsset: await usdc.getAddress(),
              treasury: treasury.address,
              underlyingAssetName: usdcParams.name,
              mTokenName: usdcParams.mTokenName,
              mTokenSymbol: usdcParams.mTokenSymbol,
              variableDebtTokenName: usdcParams.variableDebtTokenName,
              variableDebtTokenSymbol: usdcParams.variableDebtTokenSymbol,
              stableDebtTokenName: usdcParams.stableDebtTokenName,
              stableDebtTokenSymbol: usdcParams.stableDebtTokenSymbol,
            };

          // Initialize USDC reserve
          await lendingPoolConfigurator
            .connect(poolAdmin)
            .batchInitReserve([usdcReserveParams]);

          // Check that tokens were created correctly
          const mUSDC = await ethers.getContractAt(
            "MToken",
            expectedTokenAddresses.get("USDC").Mtoken
          );

          expect(await mUSDC.name()).to.equal(usdcParams.mTokenName);
          expect(await mUSDC.symbol()).to.equal(usdcParams.mTokenSymbol);
          expect(await mUSDC.decimals()).to.equal(usdcParams.decimals);

          const stableDebtUSDC = await ethers.getContractAt(
            "StableDebtToken",
            expectedTokenAddresses.get("USDC").StableDebtToken
          );

          expect(await stableDebtUSDC.name()).to.equal(
            usdcParams.stableDebtTokenName
          );

          expect(await stableDebtUSDC.symbol()).to.equal(
            usdcParams.stableDebtTokenSymbol
          );
          expect(await stableDebtUSDC.decimals()).to.equal(usdcParams.decimals);

          const variableDebtUSDC = await ethers.getContractAt(
            "VariableDebtToken",
            expectedTokenAddresses.get("USDC").VariableDebtToken
          );
          expect(await variableDebtUSDC.name()).to.equal(
            usdcParams.variableDebtTokenName
          );
          expect(await variableDebtUSDC.symbol()).to.equal(
            usdcParams.variableDebtTokenSymbol
          );
          expect(await variableDebtUSDC.decimals()).to.equal(
            usdcParams.decimals
          );
        });
      }); // End of Create one reserve

      context("Create multiple reserves in a batch", async function () {
        it("Should emit correct events", async function () {
          const {
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            lendingPoolConfigurator,
            usdcInterestRateStrategy,
            meldInterestRateStrategy,
            usdc,
            meld,
            treasury,
            poolAdmin,
          } = await loadFixture(setUpTestFixture);

          const usdcReserveParams: ILendingPoolConfigurator.InitReserveInputStruct =
            await createInitReserveParams(
              usdc,
              usdcInterestRateStrategy,
              treasury.address
            );

          const meldReserveParams: ILendingPoolConfigurator.InitReserveInputStruct =
            await createInitReserveParams(
              meld,
              meldInterestRateStrategy,
              treasury.address
            );

          // Initialize USDC and MELD reserves
          const initTx = await lendingPoolConfigurator
            .connect(poolAdmin)
            .batchInitReserve([usdcReserveParams, meldReserveParams]);

          // Get USDC reserve data after initialization
          const reserveUSDCDataAfterInitialization: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Check that lendingPoolConfigurator emits the  ReserveInitialized event with the correct parameters for USDC
          await expect(initTx)
            .to.emit(lendingPoolConfigurator, "ReserveInitialized")
            .withArgs(
              await usdc.getAddress(),
              reserveUSDCDataAfterInitialization.mTokenAddress,
              reserveUSDCDataAfterInitialization.stableDebtTokenAddress,
              reserveUSDCDataAfterInitialization.variableDebtTokenAddress,
              await usdcInterestRateStrategy.getAddress(),
              true
            );

          // Get MELD reserve data after initialization
          const reserveMELDDataAfterInitialization: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await meld.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Check that lendingPoolConfigurator emits the  ReserveInitialized event with the correct parameters for USDC
          await expect(initTx)
            .to.emit(lendingPoolConfigurator, "ReserveInitialized")
            .withArgs(
              await meld.getAddress(),
              reserveMELDDataAfterInitialization.mTokenAddress,
              reserveMELDDataAfterInitialization.stableDebtTokenAddress,
              reserveMELDDataAfterInitialization.variableDebtTokenAddress,
              await meldInterestRateStrategy.getAddress(),
              false
            );
        });

        it("Should emit correct events when initializing multiple reserves with yield boost enabled", async function () {
          const {
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            lendingPoolConfigurator,
            usdcInterestRateStrategy,
            meldInterestRateStrategy,
            usdc,
            meld,
            treasury,
            poolAdmin,
          } = await loadFixture(setUpTestFixture);

          const usdcReserveParams: ILendingPoolConfigurator.InitReserveInputStruct =
            await createInitReserveParams(
              usdc,
              usdcInterestRateStrategy,
              treasury.address
            );

          usdcReserveParams.yieldBoostEnabled = true;

          const meldReserveParams: ILendingPoolConfigurator.InitReserveInputStruct =
            await createInitReserveParams(
              meld,
              meldInterestRateStrategy,
              treasury.address
            );

          meldReserveParams.yieldBoostEnabled = true;

          // Initialize USDC and MELD reserves
          const initTx = await lendingPoolConfigurator
            .connect(poolAdmin)
            .batchInitReserve([usdcReserveParams, meldReserveParams]);

          // Get USDC reserve data after initialization
          const reserveUSDCDataAfterInitialization: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Check that lendingPoolConfigurator emits the  ReserveInitialized event with the correct parameters for USDC
          await expect(initTx)
            .to.emit(lendingPoolConfigurator, "ReserveInitialized")
            .withArgs(
              await usdc.getAddress(),
              reserveUSDCDataAfterInitialization.mTokenAddress,
              reserveUSDCDataAfterInitialization.stableDebtTokenAddress,
              reserveUSDCDataAfterInitialization.variableDebtTokenAddress,
              await usdcInterestRateStrategy.getAddress(),
              true
            );

          // Get MELD reserve data after initialization
          const reserveMELDDataAfterInitialization: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await meld.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Check that lendingPoolConfigurator emits the  ReserveInitialized event with the correct parameters for USDC
          await expect(initTx)
            .to.emit(lendingPoolConfigurator, "ReserveInitialized")
            .withArgs(
              await meld.getAddress(),
              reserveMELDDataAfterInitialization.mTokenAddress,
              reserveMELDDataAfterInitialization.stableDebtTokenAddress,
              reserveMELDDataAfterInitialization.variableDebtTokenAddress,
              await meldInterestRateStrategy.getAddress(),
              true
            );
        });

        it("Should update state correctly", async function () {
          const {
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            lendingPoolConfigurator,
            usdcInterestRateStrategy,
            meldInterestRateStrategy,
            usdc,
            meld,
            treasury,
            poolAdmin,
          } = await loadFixture(setUpTestFixture);

          const usdcReserveParams: ILendingPoolConfigurator.InitReserveInputStruct =
            await createInitReserveParams(
              usdc,
              usdcInterestRateStrategy,
              treasury.address
            );

          const meldReserveParams: ILendingPoolConfigurator.InitReserveInputStruct =
            await createInitReserveParams(
              meld,
              meldInterestRateStrategy,
              treasury.address
            );

          // Call before initializing the reserve
          const expectedTokenAddresses = await calculateTokenAddresses(
            lendingPoolConfigurator,
            ["USDC", "MELD"]
          );

          const expectedUSDCReserveDataAfterInitialization = {
            address: await usdc.getAddress(),
            symbol: "USDC",
            decimals: 6n,
            totalLiquidity: 0n,
            availableLiquidity: 0n,
            totalStableDebt: 0n,
            totalVariableDebt: 0n,
            principalStableDebt: 0n,
            scaledVariableDebt: 0n,
            averageStableBorrowRate: 0n,
            variableBorrowRate: 0n,
            stableBorrowRate: 0n,
            utilizationRate: 0n,
            liquidityIndex: oneRay,
            variableBorrowIndex: oneRay,
            mTokenAddress: expectedTokenAddresses.get("USDC").Mtoken,
            marketStableRate: 0n,
            lastUpdateTimestamp: 0n,
            totalStableDebtLastUpdated: 0n,
            liquidityRate: 0n,
            stableDebtTokenAddress:
              expectedTokenAddresses.get("USDC").StableDebtToken,
            variableDebtTokenAddress:
              expectedTokenAddresses.get("USDC").VariableDebtToken,
          } as ReserveData;

          const expectedMELDReserveDataAfterInitialization = {
            address: await meld.getAddress(),
            symbol: "MELD",
            decimals: 18n,
            totalLiquidity: 0n,
            availableLiquidity: 0n,
            totalStableDebt: 0n,
            totalVariableDebt: 0n,
            principalStableDebt: 0n,
            scaledVariableDebt: 0n,
            averageStableBorrowRate: 0n,
            variableBorrowRate: 0n,
            stableBorrowRate: 0n,
            utilizationRate: 0n,
            liquidityIndex: oneRay,
            variableBorrowIndex: oneRay,
            mTokenAddress: expectedTokenAddresses.get("MELD").Mtoken,
            marketStableRate: 0n,
            lastUpdateTimestamp: 0n,
            totalStableDebtLastUpdated: 0n,
            liquidityRate: 0n,
            stableDebtTokenAddress:
              expectedTokenAddresses.get("MELD").StableDebtToken,
            variableDebtTokenAddress:
              expectedTokenAddresses.get("MELD").VariableDebtToken,
          } as ReserveData;

          // Initialize USDC and MELD reserves
          await lendingPoolConfigurator
            .connect(poolAdmin)
            .batchInitReserve([usdcReserveParams, meldReserveParams]);

          // Get USDC reserve data after initialization
          const reserveUSDCDataAfterInitialization: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await usdc.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Check the USDC reserve data
          expectEqual(
            reserveUSDCDataAfterInitialization,
            expectedUSDCReserveDataAfterInitialization
          );

          // Check the USDC reserve data configuration
          const reserveUSDCConfigAfterInitialization =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await usdc.getAddress()
            );
          expect(reserveUSDCConfigAfterInitialization.decimals).to.equal(6);
          expect(reserveUSDCConfigAfterInitialization.ltv).to.equal(0);
          expect(
            reserveUSDCConfigAfterInitialization.liquidationThreshold
          ).to.equal(0);
          expect(
            reserveUSDCConfigAfterInitialization.liquidationBonus
          ).to.equal(0);
          expect(reserveUSDCConfigAfterInitialization.reserveFactor).to.equal(
            0n
          );
          expect(reserveUSDCConfigAfterInitialization.supplyCapUSD).to.equal(
            0n
          );
          expect(reserveUSDCConfigAfterInitialization.borrowCapUSD).to.equal(
            0n
          );
          expect(
            reserveUSDCConfigAfterInitialization.flashLoanLimitUSD
          ).to.equal(0n);
          expect(reserveUSDCConfigAfterInitialization.usageAsCollateralEnabled)
            .to.be.false;
          expect(reserveUSDCConfigAfterInitialization.borrowingEnabled).to.be
            .false;
          expect(reserveUSDCConfigAfterInitialization.stableBorrowRateEnabled)
            .to.be.false;
          expect(reserveUSDCConfigAfterInitialization.isActive).to.be.true;
          expect(reserveUSDCConfigAfterInitialization.isFrozen).to.be.false;

          expect(
            await meldProtocolDataProvider.getReserveYieldBoostStaking(usdc)
          ).not.to.be.equal(ZeroAddress);

          // Get MELD reserve data after initialization
          const reserveMELDDataAfterInitialization: ReserveData =
            await getReserveData(
              meldProtocolDataProvider,
              await meld.getAddress(),
              await lendingRateOracleAggregator.getAddress()
            );

          // Check the MELD reserve data
          expectEqual(
            reserveMELDDataAfterInitialization,
            expectedMELDReserveDataAfterInitialization
          );

          // Check the MELD reserve data configuration
          const reserveMELDConfigAfterInitialization =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await meld.getAddress()
            );
          expect(reserveMELDConfigAfterInitialization.decimals).to.equal(18);
          expect(reserveMELDConfigAfterInitialization.ltv).to.equal(0);
          expect(
            reserveMELDConfigAfterInitialization.liquidationThreshold
          ).to.equal(0);
          expect(
            reserveMELDConfigAfterInitialization.liquidationBonus
          ).to.equal(0);
          expect(reserveMELDConfigAfterInitialization.reserveFactor).to.equal(
            0n
          );
          expect(reserveMELDConfigAfterInitialization.supplyCapUSD).to.equal(
            0n
          );
          expect(reserveMELDConfigAfterInitialization.borrowCapUSD).to.equal(
            0n
          );
          expect(
            reserveMELDConfigAfterInitialization.flashLoanLimitUSD
          ).to.equal(0n);
          expect(reserveMELDConfigAfterInitialization.usageAsCollateralEnabled)
            .to.be.false;
          expect(reserveMELDConfigAfterInitialization.borrowingEnabled).to.be
            .false;
          expect(reserveMELDConfigAfterInitialization.stableBorrowRateEnabled)
            .to.be.false;
          expect(reserveMELDConfigAfterInitialization.isActive).to.be.true;
          expect(reserveMELDConfigAfterInitialization.isFrozen).to.be.false;

          // Check that USDC and MELD reserve tokens were registered
          const allReservesTokens =
            await meldProtocolDataProvider.getAllReservesTokens();
          expect(allReservesTokens[0].symbol).to.equal("USDC");
          expect(allReservesTokens[0].tokenAddress).to.equal(
            await usdc.getAddress()
          );
          expect(allReservesTokens[1].symbol).to.equal("MELD");
          expect(allReservesTokens[1].tokenAddress).to.equal(
            await meld.getAddress()
          );

          // Check that USDC and mTokens were registered
          const allMTokens = await meldProtocolDataProvider.getAllMTokens();
          expect(allMTokens[0].symbol).to.equal("mUSDC");
          expect(allMTokens[0].tokenAddress).to.equal(
            expectedTokenAddresses.get("USDC").Mtoken
          );
          expect(allMTokens[1].symbol).to.equal("mMELD");
          expect(allMTokens[1].tokenAddress).to.equal(
            expectedTokenAddresses.get("MELD").Mtoken
          );

          // Check that all USDC token addresses can be retrieved correctly
          const allUSDCTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await usdc.getAddress()
            );
          expect(allUSDCTokenAddresses.stableDebtTokenAddress).to.equal(
            expectedTokenAddresses.get("USDC").StableDebtToken
          );
          expect(allUSDCTokenAddresses.variableDebtTokenAddress).to.equal(
            expectedTokenAddresses.get("USDC").VariableDebtToken
          );
          expect(allUSDCTokenAddresses.mTokenAddress).to.equal(
            expectedTokenAddresses.get("USDC").Mtoken
          );

          // Check that all MELD token addresses can be retrieved correctly
          const allMELDTokenAddresses =
            await meldProtocolDataProvider.getReserveTokensAddresses(
              await meld.getAddress()
            );
          expect(allMELDTokenAddresses.stableDebtTokenAddress).to.equal(
            expectedTokenAddresses.get("MELD").StableDebtToken
          );
          expect(allMELDTokenAddresses.variableDebtTokenAddress).to.equal(
            expectedTokenAddresses.get("MELD").VariableDebtToken
          );
          expect(allMELDTokenAddresses.mTokenAddress).to.equal(
            expectedTokenAddresses.get("MELD").Mtoken
          );

          expect(
            await meldProtocolDataProvider.getReserveYieldBoostStaking(meld)
          ).to.be.equal(ZeroAddress);
        });

        it("Should create tokens correctly", async function () {
          const {
            lendingPoolConfigurator,
            usdcInterestRateStrategy,
            meldInterestRateStrategy,
            usdc,
            meld,
            treasury,
            poolAdmin,
          } = await loadFixture(setUpTestFixture);

          const usdcParams = await getTokensParams(usdc);

          const usdcReserveParams: ILendingPoolConfigurator.InitReserveInputStruct =
            {
              yieldBoostEnabled: false,
              underlyingAssetDecimals: usdcParams.decimals,
              interestRateStrategyAddress:
                await usdcInterestRateStrategy.getAddress(),
              underlyingAsset: await usdc.getAddress(),
              treasury: treasury.address,
              underlyingAssetName: usdcParams.name,
              mTokenName: usdcParams.mTokenName,
              mTokenSymbol: usdcParams.mTokenSymbol,
              variableDebtTokenName: usdcParams.variableDebtTokenName,
              variableDebtTokenSymbol: usdcParams.variableDebtTokenSymbol,
              stableDebtTokenName: usdcParams.stableDebtTokenName,
              stableDebtTokenSymbol: usdcParams.stableDebtTokenSymbol,
            };

          const meldParams = await getTokensParams(meld);
          const meldReserveParams: ILendingPoolConfigurator.InitReserveInputStruct =
            {
              yieldBoostEnabled: false,
              underlyingAssetDecimals: meldParams.decimals,
              interestRateStrategyAddress:
                await meldInterestRateStrategy.getAddress(),
              underlyingAsset: await meld.getAddress(),
              treasury: treasury.address,
              underlyingAssetName: meldParams.name,
              mTokenName: meldParams.mTokenName,
              mTokenSymbol: meldParams.mTokenSymbol,
              variableDebtTokenName: meldParams.variableDebtTokenName,
              variableDebtTokenSymbol: meldParams.variableDebtTokenSymbol,
              stableDebtTokenName: meldParams.stableDebtTokenName,
              stableDebtTokenSymbol: meldParams.stableDebtTokenSymbol,
            };

          // Call before initializing the reserve
          const expectedTokenAddresses = await calculateTokenAddresses(
            lendingPoolConfigurator,
            ["USDC", "MELD"]
          );

          // Initialize USDC and MELD reserves
          await lendingPoolConfigurator
            .connect(poolAdmin)
            .batchInitReserve([usdcReserveParams, meldReserveParams]);

          // Check that USDC-related tokens were created correctly
          const mUSDC = await ethers.getContractAt(
            "MToken",
            expectedTokenAddresses.get("USDC").Mtoken
          );

          expect(await mUSDC.name()).to.equal(usdcParams.mTokenName);
          expect(await mUSDC.symbol()).to.equal(usdcParams.mTokenSymbol);
          expect(await mUSDC.decimals()).to.equal(usdcParams.decimals);

          const stableDebtUSDC = await ethers.getContractAt(
            "StableDebtToken",
            expectedTokenAddresses.get("USDC").StableDebtToken
          );

          expect(await stableDebtUSDC.name()).to.equal(
            usdcParams.stableDebtTokenName
          );

          expect(await stableDebtUSDC.symbol()).to.equal(
            usdcParams.stableDebtTokenSymbol
          );
          expect(await stableDebtUSDC.decimals()).to.equal(usdcParams.decimals);

          const variableDebtUSDC = await ethers.getContractAt(
            "VariableDebtToken",
            expectedTokenAddresses.get("USDC").VariableDebtToken
          );
          expect(await variableDebtUSDC.name()).to.equal(
            usdcParams.variableDebtTokenName
          );
          expect(await variableDebtUSDC.symbol()).to.equal(
            usdcParams.variableDebtTokenSymbol
          );
          expect(await variableDebtUSDC.decimals()).to.equal(
            usdcParams.decimals
          );

          // Check that MELD-related tokens were created correctly
          const mMELD = await ethers.getContractAt(
            "MToken",
            expectedTokenAddresses.get("MELD").Mtoken
          );

          expect(await mMELD.name()).to.equal(meldParams.mTokenName);
          expect(await mMELD.symbol()).to.equal(meldParams.mTokenSymbol);
          expect(await mMELD.decimals()).to.equal(meldParams.decimals);

          const stableDebtMELD = await ethers.getContractAt(
            "StableDebtToken",
            expectedTokenAddresses.get("MELD").StableDebtToken
          );

          expect(await stableDebtMELD.name()).to.equal(
            meldParams.stableDebtTokenName
          );

          expect(await stableDebtMELD.symbol()).to.equal(
            meldParams.stableDebtTokenSymbol
          );
          expect(await stableDebtMELD.decimals()).to.equal(meldParams.decimals);

          const variableDebtMELD = await ethers.getContractAt(
            "VariableDebtToken",
            expectedTokenAddresses.get("MELD").VariableDebtToken
          );
          expect(await variableDebtMELD.name()).to.equal(
            meldParams.variableDebtTokenName
          );
          expect(await variableDebtMELD.symbol()).to.equal(
            meldParams.variableDebtTokenSymbol
          );
          expect(await variableDebtMELD.decimals()).to.equal(
            meldParams.decimals
          );
        });
      }); // End of Create multiple reserves in a batch
    }); // End of Create Reserves Happy Flow Test Cases

    context("Error Test Cases", async function () {
      it("Should revert if interestRateStrategyAddress is the zero address", async function () {
        const { lendingPoolConfigurator, usdc, treasury, poolAdmin } =
          await loadFixture(setUpTestFixture);

        const usdcParams = await getTokensParams(usdc);

        const usdcReserveParams: ILendingPoolConfigurator.InitReserveInputStruct =
          {
            yieldBoostEnabled: false,
            underlyingAssetDecimals: usdcParams.decimals,
            interestRateStrategyAddress: ZeroAddress,
            underlyingAsset: await usdc.getAddress(),
            treasury: treasury.address,
            underlyingAssetName: usdcParams.name,
            mTokenName: usdcParams.mTokenName,
            mTokenSymbol: usdcParams.mTokenSymbol,
            variableDebtTokenName: usdcParams.variableDebtTokenName,
            variableDebtTokenSymbol: usdcParams.variableDebtTokenSymbol,
            stableDebtTokenName: usdcParams.stableDebtTokenName,
            stableDebtTokenSymbol: usdcParams.stableDebtTokenSymbol,
          };

        // Attempt to Initialize USDC reserve
        await expect(
          lendingPoolConfigurator
            .connect(poolAdmin)
            .batchInitReserve([usdcReserveParams])
        ).to.be.revertedWith(ProtocolErrors.INVALID_ADDRESS);
      });

      it("Should revert if treasury address is the zero address", async function () {
        const {
          lendingPoolConfigurator,
          usdcInterestRateStrategy,
          usdc,
          poolAdmin,
        } = await loadFixture(setUpTestFixture);

        const usdcParams = await getTokensParams(usdc);

        const usdcReserveParams: ILendingPoolConfigurator.InitReserveInputStruct =
          {
            yieldBoostEnabled: false,
            underlyingAssetDecimals: usdcParams.decimals,
            interestRateStrategyAddress:
              await usdcInterestRateStrategy.getAddress(),
            underlyingAsset: await usdc.getAddress(),
            treasury: ZeroAddress,
            underlyingAssetName: usdcParams.name,
            mTokenName: usdcParams.mTokenName,
            mTokenSymbol: usdcParams.mTokenSymbol,
            variableDebtTokenName: usdcParams.variableDebtTokenName,
            variableDebtTokenSymbol: usdcParams.variableDebtTokenSymbol,
            stableDebtTokenName: usdcParams.stableDebtTokenName,
            stableDebtTokenSymbol: usdcParams.stableDebtTokenSymbol,
          };

        // Attempt to Initialize USDC reserve
        await expect(
          lendingPoolConfigurator
            .connect(poolAdmin)
            .batchInitReserve([usdcReserveParams])
        ).to.be.revertedWith(ProtocolErrors.INVALID_ADDRESS);
      });

      it("Should revert if underlying assest address is not a contract", async function () {
        const {
          lendingPoolConfigurator,
          usdcInterestRateStrategy,
          usdc,
          treasury,
          rando,
          poolAdmin,
        } = await loadFixture(setUpTestFixture);

        const usdcParams = await getTokensParams(usdc);

        const usdcReserveParams: ILendingPoolConfigurator.InitReserveInputStruct =
          {
            yieldBoostEnabled: false,
            underlyingAssetDecimals: usdcParams.decimals,
            interestRateStrategyAddress:
              await usdcInterestRateStrategy.getAddress(),
            underlyingAsset: rando.address,
            treasury: treasury.address,
            underlyingAssetName: usdcParams.name,
            mTokenName: usdcParams.mTokenName,
            mTokenSymbol: usdcParams.mTokenSymbol,
            variableDebtTokenName: usdcParams.variableDebtTokenName,
            variableDebtTokenSymbol: usdcParams.variableDebtTokenSymbol,
            stableDebtTokenName: usdcParams.stableDebtTokenName,
            stableDebtTokenSymbol: usdcParams.stableDebtTokenSymbol,
          };

        // Attempt to Initialize USDC reserve
        await expect(
          lendingPoolConfigurator
            .connect(poolAdmin)
            .batchInitReserve([usdcReserveParams])
        ).to.be.revertedWith(ProtocolErrors.LPC_NOT_CONTRACT);
      });

      it("Should revert if reserve is already initialized", async function () {
        const {
          lendingPoolConfigurator,
          usdcInterestRateStrategy,
          usdc,
          treasury,
          poolAdmin,
        } = await loadFixture(setUpTestFixture);

        const usdcParams = await getTokensParams(usdc);

        const usdcReserveParams: ILendingPoolConfigurator.InitReserveInputStruct =
          {
            yieldBoostEnabled: false,
            underlyingAssetDecimals: usdcParams.decimals,
            interestRateStrategyAddress:
              await usdcInterestRateStrategy.getAddress(),
            underlyingAsset: await usdc.getAddress(),
            treasury: treasury.address,
            underlyingAssetName: usdcParams.name,
            mTokenName: usdcParams.mTokenName,
            mTokenSymbol: usdcParams.mTokenSymbol,
            variableDebtTokenName: usdcParams.variableDebtTokenName,
            variableDebtTokenSymbol: usdcParams.variableDebtTokenSymbol,
            stableDebtTokenName: usdcParams.stableDebtTokenName,
            stableDebtTokenSymbol: usdcParams.stableDebtTokenSymbol,
          };

        await lendingPoolConfigurator
          .connect(poolAdmin)
          .batchInitReserve([usdcReserveParams]);

        // Attempt to Initialize USDC reserve again
        await expect(
          lendingPoolConfigurator
            .connect(poolAdmin)
            .batchInitReserve([usdcReserveParams])
        ).to.be.revertedWith(ProtocolErrors.RL_RESERVE_ALREADY_INITIALIZED);
      });

      it("Should revert if adding reserve makes reserve count go over the max", async function () {
        const {
          lendingPoolConfigurator,
          usdcInterestRateStrategy,
          usdc,
          treasury,
          poolAdmin,
        } = await loadFixture(setUpTestFixture);

        let token;
        const usdcParams = await getTokensParams(usdc);

        const usdcReserveParams: ILendingPoolConfigurator.InitReserveInputStruct =
          {
            yieldBoostEnabled: false,
            underlyingAssetDecimals: usdcParams.decimals,
            interestRateStrategyAddress:
              await usdcInterestRateStrategy.getAddress(),
            underlyingAsset: await usdc.getAddress(),
            treasury: treasury.address,
            underlyingAssetName: usdcParams.name,
            mTokenName: usdcParams.mTokenName,
            mTokenSymbol: usdcParams.mTokenSymbol,
            variableDebtTokenName: usdcParams.variableDebtTokenName,
            variableDebtTokenSymbol: usdcParams.variableDebtTokenSymbol,
            stableDebtTokenName: usdcParams.stableDebtTokenName,
            stableDebtTokenSymbol: usdcParams.stableDebtTokenSymbol,
          };

        const sampleERC20Factory =
          await ethers.getContractFactory("SampleERC20");
        const initialSupplyDecimals18 = ethers.parseEther("1000000");

        // Max number of reserves is 128 and can't be changed. Need to loop multiple times to trigger the max revert error
        for (let i = 0; i < 128; i++) {
          // To get past other checks, need to deploy a new token and initialize it's reserve in each loop (128 times)
          token = (await sampleERC20Factory.deploy(
            "SomeToken",
            "STKN",
            18,
            initialSupplyDecimals18
          )) as SampleERC20 & Contract;

          const tokenParams = await getTokensParams(token);
          const tokenReserveParams: ILendingPoolConfigurator.InitReserveInputStruct =
            {
              yieldBoostEnabled: false,
              underlyingAssetDecimals: tokenParams.decimals,
              interestRateStrategyAddress:
                await usdcInterestRateStrategy.getAddress(),
              underlyingAsset: await token.getAddress(),
              treasury: treasury.address,
              underlyingAssetName: tokenParams.name,
              mTokenName: tokenParams.mTokenName,
              mTokenSymbol: tokenParams.mTokenSymbol,
              variableDebtTokenName: tokenParams.variableDebtTokenName,
              variableDebtTokenSymbol: tokenParams.variableDebtTokenSymbol,
              stableDebtTokenName: tokenParams.stableDebtTokenName,
              stableDebtTokenSymbol: tokenParams.stableDebtTokenSymbol,
            };

          // Should not revert
          await lendingPoolConfigurator
            .connect(poolAdmin)
            .batchInitReserve([tokenReserveParams]);
        }

        // Attempt to Initialize USDC reserve as 129th reserve
        await expect(
          lendingPoolConfigurator
            .connect(poolAdmin)
            .batchInitReserve([usdcReserveParams])
        ).to.be.revertedWith(ProtocolErrors.LP_NO_MORE_RESERVES_ALLOWED);
      });

      it("Should revert if the caller does not have correct role", async function () {
        const {
          lendingPoolConfigurator,
          addressesProvider,
          usdc,
          treasury,
          rando,
        } = await loadFixture(setUpTestFixture);

        const usdcParams = await getTokensParams(usdc);

        const usdcReserveParams: ILendingPoolConfigurator.InitReserveInputStruct =
          {
            yieldBoostEnabled: false,
            underlyingAssetDecimals: usdcParams.decimals,
            interestRateStrategyAddress: ZeroAddress,
            underlyingAsset: await usdc.getAddress(),
            treasury: treasury.address,
            underlyingAssetName: usdcParams.name,
            mTokenName: usdcParams.mTokenName,
            mTokenSymbol: usdcParams.mTokenSymbol,
            variableDebtTokenName: usdcParams.variableDebtTokenName,
            variableDebtTokenSymbol: usdcParams.variableDebtTokenSymbol,
            stableDebtTokenName: usdcParams.stableDebtTokenName,
            stableDebtTokenSymbol: usdcParams.stableDebtTokenSymbol,
          };

        const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.POOL_ADMIN_ROLE()}`;

        // Attempt to Initialize USDC reserve
        await expect(
          lendingPoolConfigurator
            .connect(rando)
            .batchInitReserve([usdcReserveParams])
        ).to.be.revertedWith(expectedException);
      });
    }); // End of Create Reserves Error Test Cases
  }); // End of Create Reserves Context

  context("Configure Reserves", async function () {
    context("configureReserveAsCollateral()", async function () {
      context("Happy Flow Test Cases", async function () {
        it("Should emit correct event", async function () {
          const { lendingPoolConfigurator, usdc, poolAdmin } =
            await loadFixture(setUpTestInitReserveFixture);

          const configuration: Configuration = <Configuration>{}; // Configuration object to be used in tests

          configuration.reservesParams = <iMeldPoolAssets<IReserveParams>>(
            getReservesConfigByPool(MeldPools.proto)
          );

          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .configureReserveAsCollateral(
                await usdc.getAddress(),
                configuration.reservesParams.USDC!.baseLTVAsCollateral,
                configuration.reservesParams.USDC!.liquidationThreshold,
                configuration.reservesParams.USDC!.liquidationBonus
              )
          )
            .to.emit(lendingPoolConfigurator, "CollateralConfigurationChanged")
            .withArgs(
              await usdc.getAddress(),
              configuration.reservesParams.USDC!.baseLTVAsCollateral,
              configuration.reservesParams.USDC!.liquidationThreshold,
              configuration.reservesParams.USDC!.liquidationBonus
            );
        });

        it("Should update state correctly", async function () {
          const {
            lendingPoolConfigurator,
            meldProtocolDataProvider,
            usdc,
            meld,
            poolAdmin,
          } = await loadFixture(setUpTestInitReserveFixture);

          const configuration: Configuration = <Configuration>{}; // Configuration object to be used in tests

          configuration.reservesParams = <iMeldPoolAssets<IReserveParams>>(
            getReservesConfigByPool(MeldPools.proto)
          );

          // Check the USDC reserve data configuration
          const reserveUSDCConfigBefore =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await usdc.getAddress()
            );

          // Check the MELD reserve data configuration
          const reserveMELDConfigBefore =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await meld.getAddress()
            );

          await lendingPoolConfigurator
            .connect(poolAdmin)
            .configureReserveAsCollateral(
              await usdc.getAddress(),
              configuration.reservesParams.USDC!.baseLTVAsCollateral,
              configuration.reservesParams.USDC!.liquidationThreshold,
              configuration.reservesParams.USDC!.liquidationBonus
            );

          // Check the USDC reserve data configuration again
          const reserveUSDCConfigAfter =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await usdc.getAddress()
            );

          // Check the MELD reserve data configuration again
          const reserveMELDConfigAfter =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await meld.getAddress()
            );

          expect(reserveUSDCConfigAfter.decimals).to.equal(
            reserveUSDCConfigBefore.decimals
          );
          expect(reserveUSDCConfigAfter.ltv).to.equal(
            configuration.reservesParams.USDC!.baseLTVAsCollateral
          );
          expect(reserveUSDCConfigAfter.liquidationThreshold).to.equal(
            configuration.reservesParams.USDC!.liquidationThreshold
          );
          expect(reserveUSDCConfigAfter.liquidationBonus).to.equal(
            configuration.reservesParams.USDC!.liquidationBonus
          );
          expect(reserveUSDCConfigAfter.reserveFactor).to.equal(0);
          expect(reserveUSDCConfigAfter.supplyCapUSD).to.equal(0n);
          expect(reserveUSDCConfigAfter.borrowCapUSD).to.equal(0n);
          expect(reserveUSDCConfigAfter.flashLoanLimitUSD).to.equal(0n);
          expect(reserveUSDCConfigAfter.usageAsCollateralEnabled).to.be.true;
          expect(reserveUSDCConfigAfter.borrowingEnabled).to.be.false;
          expect(reserveUSDCConfigAfter.stableBorrowRateEnabled).to.be.false;
          expect(reserveUSDCConfigAfter.isActive).to.be.true;
          expect(reserveUSDCConfigAfter.isFrozen).to.be.false;

          // Chek MELD reserve data configuration wasn't changed by the call to configure the USDC reserve
          expect(reserveMELDConfigAfter.decimals).to.equal(
            reserveMELDConfigBefore.decimals
          );
          expect(reserveMELDConfigAfter.ltv).to.equal(
            reserveMELDConfigBefore.ltv
          );
          expect(reserveMELDConfigAfter.liquidationThreshold).to.equal(
            reserveMELDConfigBefore.liquidationThreshold
          );
          expect(reserveMELDConfigAfter.liquidationBonus).to.equal(
            reserveMELDConfigBefore.liquidationBonus
          );
          expect(reserveMELDConfigAfter.reserveFactor).to.equal(
            reserveMELDConfigBefore.reserveFactor
          );
          expect(reserveMELDConfigAfter.usageAsCollateralEnabled).to.equal(
            reserveMELDConfigBefore.usageAsCollateralEnabled
          );
          expect(reserveMELDConfigAfter.borrowingEnabled).to.equal(
            reserveMELDConfigBefore.borrowingEnabled
          );
          expect(reserveMELDConfigAfter.stableBorrowRateEnabled).to.equal(
            reserveMELDConfigBefore.stableBorrowRateEnabled
          );
          expect(reserveMELDConfigAfter.isActive).to.equal(
            reserveMELDConfigBefore.isActive
          );
          expect(reserveMELDConfigAfter.isFrozen).to.equal(
            reserveMELDConfigBefore.isFrozen
          );
        });
      }); // End of configureReserveAsCollateral Happy Flow Test Cases Context

      context("Error Test Cases", async function () {
        it("Should revert if asset is the zero address", async function () {
          const { lendingPoolConfigurator } = await loadFixture(
            setUpTestInitReserveFixture
          );

          const configuration: Configuration = <Configuration>{}; // Configuration object to be used in tests

          configuration.reservesParams = <iMeldPoolAssets<IReserveParams>>(
            getReservesConfigByPool(MeldPools.proto)
          );

          await expect(
            lendingPoolConfigurator.configureReserveAsCollateral(
              ZeroAddress,
              configuration.reservesParams.USDC!.baseLTVAsCollateral,
              configuration.reservesParams.USDC!.liquidationThreshold,
              configuration.reservesParams.USDC!.liquidationBonus
            )
          ).to.be.revertedWith(ProtocolErrors.LPC_RESERVE_DOES_NOT_EXIST);
        });

        it("Should revert if ltv > liquidationThreshold", async function () {
          const { lendingPoolConfigurator, usdc, poolAdmin } =
            await loadFixture(setUpTestInitReserveFixture);

          const configuration: Configuration = <Configuration>{}; // Configuration object to be used in tests

          configuration.reservesParams = <iMeldPoolAssets<IReserveParams>>(
            getReservesConfigByPool(MeldPools.proto)
          );

          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .configureReserveAsCollateral(
                await usdc.getAddress(),
                BigInt(
                  configuration.reservesParams.USDC!.liquidationThreshold
                ) + 1n,
                configuration.reservesParams.USDC!.liquidationThreshold,
                configuration.reservesParams.USDC!.liquidationBonus
              )
          ).to.be.revertedWith(ProtocolErrors.LPC_INVALID_CONFIGURATION);
        });

        it("Should revert if asset reserve is not initialized", async function () {
          const { lendingPoolConfigurator, unsupportedToken } =
            await loadFixture(setUpTestFixture);

          await expect(
            lendingPoolConfigurator.configureReserveAsCollateral(
              await unsupportedToken.getAddress(),
              5000,
              6000,
              10500n
            )
          ).to.be.revertedWith(ProtocolErrors.LPC_RESERVE_DOES_NOT_EXIST);
        });

        it("Should revert if the caller does not have correct role", async function () {
          const { lendingPoolConfigurator, addressesProvider, usdc, rando } =
            await loadFixture(setUpTestInitReserveFixture);

          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.POOL_ADMIN_ROLE()}`;

          await expect(
            lendingPoolConfigurator
              .connect(rando)
              .configureReserveAsCollateral(
                await usdc.getAddress(),
                5000,
                6000,
                10500n
              )
          ).to.be.revertedWith(expectedException);
        });

        context(
          "Reserve is being enabled as collateral (liquidationThreshold != 0)",
          async function () {
            it("Should revert if liquidationBonus not > 100.00%", async function () {
              // liquidationThreshold of 0 means that the reserve is not used as collateral or is being disabled as collateral, so
              // !=0 means the reserve is being enabled as collateral
              // liquidation bonus must be bigger than 100.00%, otherwise the liquidator would receive less
              // collateral than needed to cover the debt
              const { lendingPoolConfigurator, usdc, poolAdmin } =
                await loadFixture(setUpTestInitReserveFixture);

              const configuration: Configuration = <Configuration>{}; // Configuration object to be used in tests

              configuration.reservesParams = <iMeldPoolAssets<IReserveParams>>(
                getReservesConfigByPool(MeldPools.proto)
              );

              await expect(
                lendingPoolConfigurator
                  .connect(poolAdmin)
                  .configureReserveAsCollateral(
                    await usdc.getAddress(),
                    configuration.reservesParams.USDC!.baseLTVAsCollateral,
                    configuration.reservesParams.USDC!.liquidationThreshold,
                    10000 // 100.00%
                  )
              ).to.be.revertedWith(ProtocolErrors.LPC_INVALID_CONFIGURATION);

              await expect(
                lendingPoolConfigurator
                  .connect(poolAdmin)
                  .configureReserveAsCollateral(
                    await usdc.getAddress(),
                    configuration.reservesParams.USDC!.baseLTVAsCollateral,
                    configuration.reservesParams.USDC!.liquidationThreshold,
                    9999 // 99.99%
                  )
              ).to.be.revertedWith(ProtocolErrors.LPC_INVALID_CONFIGURATION);
            });

            it("Should revert if liquidationThreshold x liquidationBonus is > 100.00%", async function () {
              // liquidationThreshold of 0 means that the reserve is not used as collateral or is being disabled as collateral, so
              // !=0 means the reserve is being enabled as collateral
              // if threshold * bonus is less than PERCENTAGE_FACTOR, it's guaranteed that at the moment
              // a loan is taken there is enough collateral available to cover the liquidation bonus
              const { lendingPoolConfigurator, usdc, poolAdmin } =
                await loadFixture(setUpTestInitReserveFixture);

              const configuration: Configuration = <Configuration>{}; // Configuration object to be used in tests

              configuration.reservesParams = <iMeldPoolAssets<IReserveParams>>(
                getReservesConfigByPool(MeldPools.proto)
              );

              await expect(
                lendingPoolConfigurator
                  .connect(poolAdmin)
                  .configureReserveAsCollateral(
                    await usdc.getAddress(),
                    configuration.reservesParams.USDC!.baseLTVAsCollateral,
                    8500, // 85%
                    12000 // 120.00%
                  )
              ).to.be.revertedWith(ProtocolErrors.LPC_INVALID_CONFIGURATION);
            });
          }
        ); // End of Reserve is being enabled as collateral (liquidationThreshold != 0) Context

        context(
          "Reserve is being disabled as collateral (liquidationThreshold == 0)",
          async function () {
            it("Should revert if asset is the zero address", async function () {
              // Should trigger INVALID_ADDRESS error in _checkNoLidquidity
              const { lendingPoolConfigurator, poolAdmin } = await loadFixture(
                setUpTestInitReserveFixture
              );

              const configuration: Configuration = <Configuration>{}; // Configuration object to be used in tests

              configuration.reservesParams = <iMeldPoolAssets<IReserveParams>>(
                getReservesConfigByPool(MeldPools.proto)
              );

              await expect(
                lendingPoolConfigurator
                  .connect(poolAdmin)
                  .configureReserveAsCollateral(ZeroAddress, 0, 0, 0n)
              ).to.be.revertedWith(ProtocolErrors.LPC_RESERVE_DOES_NOT_EXIST);
            });

            it("Should revert if liquidationBonus !=0", async function () {
              // liquidationThreshold of 0 means that the reserve is not used as collateral or is being disabled as collateral
              // liquidationBonus shouldn't be set if the reserve is not used as collateral
              const { lendingPoolConfigurator, usdc, poolAdmin } =
                await loadFixture(setUpTestInitReserveFixture);

              const configuration: Configuration = <Configuration>{}; // Configuration object to be used in tests

              configuration.reservesParams = <iMeldPoolAssets<IReserveParams>>(
                getReservesConfigByPool(MeldPools.proto)
              );

              await expect(
                lendingPoolConfigurator
                  .connect(poolAdmin)
                  .configureReserveAsCollateral(
                    await usdc.getAddress(),
                    configuration.reservesParams.USDC!.baseLTVAsCollateral,
                    0,
                    configuration.reservesParams.USDC!.liquidationBonus
                  )
              ).to.be.revertedWith(ProtocolErrors.LPC_INVALID_CONFIGURATION);
            });

            it("Should revert if there is liquidity for the reserve", async function () {
              // liquidationThreshold of 0 means that the reserve is not used as collateral or is being disabled as collateral
              // The reserve can't be disabled as collateral if there is liquidity deposited for the reserve
              const {
                lendingPool,
                lendingPoolConfigurator,
                meldProtocolDataProvider,
                lendingRateOracleAggregator,
                meldPriceOracle,
                usdc,
                owner,
                depositor,
                poolAdmin,
                oracleAdmin,
              } = await loadFixture(setUpTestInitReserveFixture);

              await meldPriceOracle
                .connect(oracleAdmin)
                .setAssetPrice(usdc, _1e18);

              // Set up USDC Deposit.
              const depositAmount = await allocateAndApproveTokens(
                usdc,
                owner,
                depositor,
                lendingPool,
                1000n,
                0n
              );

              // Deposit liquidity for the reserve
              await lendingPool
                .connect(depositor)
                .deposit(
                  await usdc.getAddress(),
                  depositAmount,
                  depositor.address,
                  true,
                  0
                );

              const reserveDataAfterDeposit: ReserveData = await getReserveData(
                meldProtocolDataProvider,
                await usdc.getAddress(),
                await lendingRateOracleAggregator.getAddress()
              );

              // Instantiate mUSDC contract
              const mUSDC = await ethers.getContractAt(
                "MToken",
                reserveDataAfterDeposit.mTokenAddress
              );

              expect(await usdc.balanceOf(await mUSDC.getAddress())).to.equal(
                depositAmount
              ); // make sure the deposit was successful

              await expect(
                lendingPoolConfigurator
                  .connect(poolAdmin)
                  .configureReserveAsCollateral(
                    await usdc.getAddress(),
                    0,
                    0,
                    0n
                  )
              ).to.be.revertedWith(ProtocolErrors.LPC_RESERVE_LIQUIDITY_NOT_0);
            });
          }
        ); // End of Reserve is being disabled as collateral (liquidationThreshold == 0) Context
      }); // End of configureReserveAsCollateral Error Test Cases Context
    }); // End of configureReserveAsCollateral Context

    context("enableBorrowingOnReserve()", async function () {
      context("Happy Flow Test Cases", async function () {
        it("Should emit correct event", async function () {
          const { lendingPoolConfigurator, usdc, poolAdmin } =
            await loadFixture(setUpTestInitReserveFixture);

          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .enableBorrowingOnReserve(await usdc.getAddress(), true)
          )
            .to.emit(lendingPoolConfigurator, "BorrowingEnabledOnReserve")
            .withArgs(await usdc.getAddress(), true);
        });

        it("Should update state correctly", async function () {
          const {
            lendingPoolConfigurator,
            meldProtocolDataProvider,
            usdc,
            meld,
            poolAdmin,
          } = await loadFixture(setUpTestInitReserveFixture);

          // This function always sets borrowingEnabled to true.
          // It sets stableBorrowRateEnabled to the value of the parameter
          await lendingPoolConfigurator
            .connect(poolAdmin)
            .enableBorrowingOnReserve(await usdc.getAddress(), true);

          // Check the USDC reserve data configuration after
          const reserveUSDCConfig =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await usdc.getAddress()
            );

          // Check the MELD reserve data configuration
          const reserveMELDCConfig =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await meld.getAddress()
            );

          expect(reserveUSDCConfig.borrowingEnabled).to.be.true;
          expect(reserveUSDCConfig.stableBorrowRateEnabled).to.be.true;
          expect(reserveMELDCConfig.borrowingEnabled).to.be.false;
          expect(reserveMELDCConfig.stableBorrowRateEnabled).to.be.false;

          await lendingPoolConfigurator
            .connect(poolAdmin)
            .enableBorrowingOnReserve(await usdc.getAddress(), false);

          const reserveUSDCConfig2 =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await usdc.getAddress()
            );

          const reserveMELDConfig2 =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await meld.getAddress()
            );

          expect(reserveUSDCConfig2.borrowingEnabled).to.be.true;
          expect(reserveUSDCConfig2.stableBorrowRateEnabled).to.be.false;
          expect(reserveMELDConfig2.borrowingEnabled).to.be.false;
          expect(reserveMELDConfig2.stableBorrowRateEnabled).to.be.false;
        });
      }); // End of Happy Flow Test Cases Context

      context("Error Test Cases", async function () {
        it("Should revert if asset is the zero address", async function () {
          const { lendingPoolConfigurator, poolAdmin } = await loadFixture(
            setUpTestInitReserveFixture
          );

          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .enableBorrowingOnReserve(ZeroAddress, true)
          ).to.be.revertedWith(ProtocolErrors.LPC_RESERVE_DOES_NOT_EXIST);
        });

        it("Should revert if asset reserve is not initialized", async function () {
          const { lendingPoolConfigurator, unsupportedToken, poolAdmin } =
            await loadFixture(setUpTestFixture);

          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .enableBorrowingOnReserve(
                await unsupportedToken.getAddress(),
                true
              )
          ).to.be.revertedWith(ProtocolErrors.LPC_RESERVE_DOES_NOT_EXIST);
        });

        it("Should revert if the caller does not have correct role", async function () {
          const { lendingPoolConfigurator, addressesProvider, usdc, rando } =
            await loadFixture(setUpTestInitReserveFixture);

          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.POOL_ADMIN_ROLE()}`;

          await expect(
            lendingPoolConfigurator
              .connect(rando)
              .enableBorrowingOnReserve(await usdc.getAddress(), true)
          ).to.be.revertedWith(expectedException);
        });
      }); // End of Error Test Cases Context
    }); // End of enableBorrowingOnReserve Context

    context("disableBorrowingOnReserve()", async function () {
      context("Happy Flow Test Cases", async function () {
        it("Should emit correct event", async function () {
          const { lendingPoolConfigurator, usdc, poolAdmin } =
            await loadFixture(setUpTestInitReserveFixture);

          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .disableBorrowingOnReserve(await usdc.getAddress())
          )
            .to.emit(lendingPoolConfigurator, "BorrowingDisabledOnReserve")
            .withArgs(await usdc.getAddress());
        });

        it("Should update state correctly", async function () {
          const {
            lendingPoolConfigurator,
            meldProtocolDataProvider,
            usdc,
            meld,
            poolAdmin,
          } = await loadFixture(setUpTestInitReserveFixture);

          // Enable borrowing on the USDC reserve
          await lendingPoolConfigurator
            .connect(poolAdmin)
            .enableBorrowingOnReserve(await usdc.getAddress(), true);

          // Disable borrowing on the USDC reserve
          await lendingPoolConfigurator
            .connect(poolAdmin)
            .disableBorrowingOnReserve(await usdc.getAddress());

          // Check the USDC reserve data configuration
          const reserveUSDCConfig =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await usdc.getAddress()
            );

          // Check the MELD reserve data configuration
          const reserveMELDConfig =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await meld.getAddress()
            );

          expect(reserveUSDCConfig.borrowingEnabled).to.be.false;
          expect(reserveUSDCConfig.stableBorrowRateEnabled).to.be.true;
          expect(reserveMELDConfig.borrowingEnabled).to.be.false;
          expect(reserveMELDConfig.stableBorrowRateEnabled).to.be.false;
        });
      }); // End of Happy Flow Test Cases Context

      context("Error Test Cases", async function () {
        it("Should revert if asset is the zero address", async function () {
          const { lendingPoolConfigurator, poolAdmin } = await loadFixture(
            setUpTestInitReserveFixture
          );

          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .disableBorrowingOnReserve(ethers.ZeroAddress)
          ).to.be.revertedWith(ProtocolErrors.LPC_RESERVE_DOES_NOT_EXIST);
        });

        it("Should revert if asset reserve is not initialized", async function () {
          const { lendingPoolConfigurator, usdc, poolAdmin } =
            await loadFixture(setUpTestFixture);

          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .disableBorrowingOnReserve(await usdc.getAddress())
          ).to.be.revertedWith(ProtocolErrors.LPC_RESERVE_DOES_NOT_EXIST);
        });

        it("Should revert if the caller does not have correct role", async function () {
          const { lendingPoolConfigurator, addressesProvider, usdc, rando } =
            await loadFixture(setUpTestInitReserveFixture);

          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.POOL_ADMIN_ROLE()}`;

          await expect(
            lendingPoolConfigurator
              .connect(rando)
              .disableBorrowingOnReserve(await usdc.getAddress())
          ).to.be.revertedWith(expectedException);
        });
      }); // End of Error Test Cases Context
    }); // End of disableBorrowingOnReserve Context

    context("enableReserveStableRate()", async function () {
      context("Happy Flow Test Cases", async function () {
        it("Should emit correct event", async function () {
          const { lendingPoolConfigurator, usdc, poolAdmin } =
            await loadFixture(setUpTestInitReserveFixture);

          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .enableReserveStableRate(await usdc.getAddress())
          )
            .to.emit(lendingPoolConfigurator, "StableRateEnabledOnReserve")
            .withArgs(await usdc.getAddress());
        });

        it("Should update state correctly", async function () {
          const {
            lendingPoolConfigurator,
            meldProtocolDataProvider,
            usdc,
            meld,
            poolAdmin,
          } = await loadFixture(setUpTestInitReserveFixture);

          // Disable stable rate on the USDC reserve
          await lendingPoolConfigurator
            .connect(poolAdmin)
            .enableReserveStableRate(await usdc.getAddress());

          // Check the USDC reserve data configuration
          const reserveUSDCConfig =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await usdc.getAddress()
            );

          // Check the MELD reserve data configuration
          const reserveMELDConfig =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await meld.getAddress()
            );

          expect(reserveUSDCConfig.stableBorrowRateEnabled).to.be.true;
          expect(reserveMELDConfig.stableBorrowRateEnabled).to.be.false;
        });
      }); // End of Happy Flow Test Cases Context

      context("Error Test Cases", async function () {
        it("Should revert if asset is the zero address", async function () {
          const { lendingPoolConfigurator, poolAdmin } = await loadFixture(
            setUpTestInitReserveFixture
          );

          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .enableReserveStableRate(ZeroAddress)
          ).to.be.revertedWith(ProtocolErrors.LPC_RESERVE_DOES_NOT_EXIST);
        });

        it("Should revert if asset reserve is not initialized", async function () {
          const { lendingPoolConfigurator, usdc, poolAdmin } =
            await loadFixture(setUpTestFixture);

          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .enableReserveStableRate(await usdc.getAddress())
          ).to.be.revertedWith(ProtocolErrors.LPC_RESERVE_DOES_NOT_EXIST);
        });

        it("Should revert if the caller does not have correct role", async function () {
          const { lendingPoolConfigurator, addressesProvider, usdc, rando } =
            await loadFixture(setUpTestInitReserveFixture);

          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.POOL_ADMIN_ROLE()}`;

          await expect(
            lendingPoolConfigurator
              .connect(rando)
              .enableReserveStableRate(await usdc.getAddress())
          ).to.be.revertedWith(expectedException);
        });
      }); // End of Error Test Cases Context
    }); // End of enableReserveStableRate Context

    context("disableReserveStableRate()", async function () {
      context("Happy Flow Test Cases", async function () {
        it("Should emit correct event", async function () {
          const { lendingPoolConfigurator, usdc, poolAdmin } =
            await loadFixture(setUpTestInitReserveFixture);

          // Disable stable rate on the USDC reserve
          await lendingPoolConfigurator
            .connect(poolAdmin)
            .enableReserveStableRate(await usdc.getAddress());

          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .disableReserveStableRate(await usdc.getAddress())
          )
            .to.emit(lendingPoolConfigurator, "StableRateDisabledOnReserve")
            .withArgs(await usdc.getAddress());
        });

        it("Should update state correctly", async function () {
          const {
            lendingPoolConfigurator,
            meldProtocolDataProvider,
            usdc,
            meld,
            poolAdmin,
          } = await loadFixture(setUpTestInitReserveFixture);

          // Enable stable rate on the USDC reserve and then disable it
          await lendingPoolConfigurator
            .connect(poolAdmin)
            .enableReserveStableRate(await usdc.getAddress());
          await lendingPoolConfigurator
            .connect(poolAdmin)
            .disableReserveStableRate(await usdc.getAddress());

          // Check the USDC reserve data configuration
          const reserveUSDCConfig =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await usdc.getAddress()
            );

          // Check the MELD reserve data configuration
          const reserveMELDConfig =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await meld.getAddress()
            );

          expect(reserveUSDCConfig.stableBorrowRateEnabled).to.be.false;
          expect(reserveMELDConfig.stableBorrowRateEnabled).to.be.false;
        });
      }); // End of Happy Flow Test Cases Context

      context("Error Test Cases", async function () {
        it("Should revert if asset is the zero address", async function () {
          const { lendingPoolConfigurator, poolAdmin } = await loadFixture(
            setUpTestInitReserveFixture
          );

          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .disableReserveStableRate(ZeroAddress)
          ).to.be.revertedWith(ProtocolErrors.LPC_RESERVE_DOES_NOT_EXIST);
        });

        it("Should revert if asset reserve is not initialized", async function () {
          const { lendingPoolConfigurator, usdc, poolAdmin } =
            await loadFixture(setUpTestFixture);

          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .disableReserveStableRate(await usdc.getAddress())
          ).to.be.revertedWith(ProtocolErrors.LPC_RESERVE_DOES_NOT_EXIST);
        });

        it("Should revert if the caller does not have correct role", async function () {
          const { lendingPoolConfigurator, addressesProvider, usdc, rando } =
            await loadFixture(setUpTestInitReserveFixture);

          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.POOL_ADMIN_ROLE()}`;

          await expect(
            lendingPoolConfigurator
              .connect(rando)
              .disableReserveStableRate(await usdc.getAddress())
          ).to.be.revertedWith(expectedException);
        });
      }); // End of Error Test Cases Context
    }); // End of disableReserveStableRate Context

    context("activateReserve()", async function () {
      context("Happy Flow Test Cases", async function () {
        it("Should emit correct event", async function () {
          const { lendingPoolConfigurator, usdc, poolAdmin } =
            await loadFixture(setUpTestInitReserveFixture);

          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .activateReserve(await usdc.getAddress())
          )
            .to.emit(lendingPoolConfigurator, "ReserveActivated")
            .withArgs(await usdc.getAddress());
        });

        it("Should update state correctly", async function () {
          const {
            lendingPoolConfigurator,
            meldProtocolDataProvider,
            usdc,
            meld,
            poolAdmin,
          } = await loadFixture(setUpTestInitReserveFixture);

          // Deactivate the USDC reserve
          await lendingPoolConfigurator
            .connect(poolAdmin)
            .deactivateReserve(await usdc.getAddress());

          // Activate the USDC reserve
          await lendingPoolConfigurator
            .connect(poolAdmin)
            .activateReserve(await usdc.getAddress());

          // Check the USDC reserve data configuration
          const reserveUSDCConfig =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await usdc.getAddress()
            );

          // Check the MELD reserve data configuration
          const reserveMELDConfig =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await meld.getAddress()
            );

          expect(reserveUSDCConfig.isActive).to.be.true;
          expect(reserveMELDConfig.isActive).to.be.true; // reserves are activated during initialization
        });
      }); // End of Happy Flow Test Cases Context

      context("Error Test Cases", async function () {
        it("Should revert if asset is the zero address", async function () {
          const { lendingPoolConfigurator, poolAdmin } = await loadFixture(
            setUpTestInitReserveFixture
          );
          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .activateReserve(ZeroAddress)
          ).to.be.revertedWith(ProtocolErrors.LPC_RESERVE_DOES_NOT_EXIST);
        });

        it("Should revert if asset reserve is not initialized", async function () {
          const { lendingPoolConfigurator, usdc, poolAdmin } =
            await loadFixture(setUpTestFixture);

          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .activateReserve(await usdc.getAddress())
          ).to.be.revertedWith(ProtocolErrors.LPC_RESERVE_DOES_NOT_EXIST);
        });

        it("Should revert if the caller does not have correct role", async function () {
          const { lendingPoolConfigurator, addressesProvider, usdc, rando } =
            await loadFixture(setUpTestInitReserveFixture);

          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.POOL_ADMIN_ROLE()}`;

          await expect(
            lendingPoolConfigurator
              .connect(rando)
              .activateReserve(await usdc.getAddress())
          ).to.be.revertedWith(expectedException);
        });
      }); // End of Error Test Cases Context
    }); // End of activateReserve Context

    context("deactivateReserve()", async function () {
      context("Happy Flow Test Cases", async function () {
        it("Should emit correct event", async function () {
          const { lendingPoolConfigurator, usdc, poolAdmin } =
            await loadFixture(setUpTestInitReserveFixture);

          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .deactivateReserve(await usdc.getAddress())
          )
            .to.emit(lendingPoolConfigurator, "ReserveDeactivated")
            .withArgs(await usdc.getAddress());
        });

        it("Should update state correctly", async function () {
          const {
            lendingPoolConfigurator,
            meldProtocolDataProvider,
            usdc,
            meld,
            poolAdmin,
          } = await loadFixture(setUpTestInitReserveFixture);
          // Deactivate the USDC reserve
          await lendingPoolConfigurator
            .connect(poolAdmin)
            .deactivateReserve(await usdc.getAddress());

          // Check the USDC reserve data configuration
          const reserveUSDCConfig =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await usdc.getAddress()
            );

          // Check the MELD reserve data configuration
          const reserveMELDConfig =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await meld.getAddress()
            );

          expect(reserveUSDCConfig.isActive).to.be.false;
          expect(reserveMELDConfig.isActive).to.be.true; // reserves are activated during initialization
        });
      }); // End of Happy Flow Test Cases Context

      context("Error Test Cases", async function () {
        it("Should revert if asset is the zero address", async function () {
          const { lendingPoolConfigurator, poolAdmin } = await loadFixture(
            setUpTestInitReserveFixture
          );

          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .deactivateReserve(ZeroAddress)
          ).to.be.revertedWith(ProtocolErrors.LPC_RESERVE_DOES_NOT_EXIST);
        });

        it("Should revert if asset reserve is not initialized", async function () {
          const { lendingPoolConfigurator, usdc, poolAdmin } =
            await loadFixture(setUpTestFixture);

          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .deactivateReserve(await usdc.getAddress())
          ).to.be.revertedWith(ProtocolErrors.LPC_RESERVE_DOES_NOT_EXIST);
        });

        it("Should revert if there is liquidity for the reserve", async function () {
          const {
            lendingPool,
            lendingPoolConfigurator,
            meldProtocolDataProvider,
            lendingRateOracleAggregator,
            meldPriceOracle,
            usdc,
            owner,
            depositor,
            poolAdmin,
            oracleAdmin,
          } = await loadFixture(setUpTestInitReserveFixture);

          await meldPriceOracle.connect(oracleAdmin).setAssetPrice(usdc, _1e18);

          // Set up USDC Deposit.
          const depositAmount = await allocateAndApproveTokens(
            usdc,
            owner,
            depositor,
            lendingPool,
            1000n,
            0n
          );

          // Deposit liquidity for the reserve
          await lendingPool
            .connect(depositor)
            .deposit(
              await usdc.getAddress(),
              depositAmount,
              depositor.address,
              true,
              0
            );

          const reserveDataAfterDeposit: ReserveData = await getReserveData(
            meldProtocolDataProvider,
            await usdc.getAddress(),
            await lendingRateOracleAggregator.getAddress()
          );

          // Instantiate mUSDC contract
          const mUSDC = await ethers.getContractAt(
            "MToken",
            reserveDataAfterDeposit.mTokenAddress
          );

          expect(await usdc.balanceOf(await mUSDC.getAddress())).to.equal(
            depositAmount
          ); // make sure the deposit was successful

          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .deactivateReserve(await usdc.getAddress())
          ).to.be.revertedWith(ProtocolErrors.LPC_RESERVE_LIQUIDITY_NOT_0);
        });

        it("Should revert if the caller does not have correct role", async function () {
          const { lendingPoolConfigurator, addressesProvider, usdc, rando } =
            await loadFixture(setUpTestInitReserveFixture);

          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.POOL_ADMIN_ROLE()}`;

          await expect(
            lendingPoolConfigurator
              .connect(rando)
              .deactivateReserve(await usdc.getAddress())
          ).to.be.revertedWith(expectedException);
        });
      }); // End of Error Test Cases Context
    }); // End of deactivateReserve Context

    context("freezeReserve()", async function () {
      context("Happy Flow Test Cases", async function () {
        it("Should emit correct event", async function () {
          const { lendingPoolConfigurator, usdc, poolAdmin } =
            await loadFixture(setUpTestInitReserveFixture);

          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .freezeReserve(await usdc.getAddress())
          )
            .to.emit(lendingPoolConfigurator, "ReserveFrozen")
            .withArgs(await usdc.getAddress());
        });

        it("Should update state correctly", async function () {
          const {
            lendingPoolConfigurator,
            meldProtocolDataProvider,
            usdc,
            meld,
            poolAdmin,
          } = await loadFixture(setUpTestInitReserveFixture);

          // Freeze the USDC reserve
          await lendingPoolConfigurator
            .connect(poolAdmin)
            .freezeReserve(await usdc.getAddress());

          // Check the USDC reserve data configuration
          const reserveUSDCConfig =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await usdc.getAddress()
            );

          // Check the MELD reserve data configuration
          const reserveMELDConfig =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await meld.getAddress()
            );

          expect(reserveUSDCConfig.isFrozen).to.be.true;
          expect(reserveMELDConfig.isFrozen).to.be.false;
        });
      }); // End of Happy Flow Test Cases Context

      context("Error Test Cases", async function () {
        it("Should revert if asset is the zero address", async function () {
          const { lendingPoolConfigurator, poolAdmin } = await loadFixture(
            setUpTestInitReserveFixture
          );
          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .freezeReserve(ethers.ZeroAddress)
          ).to.be.revertedWith(ProtocolErrors.LPC_RESERVE_DOES_NOT_EXIST);
        });

        it("Should revert if asset reserve is not initialized", async function () {
          const { lendingPoolConfigurator, usdc, poolAdmin } =
            await loadFixture(setUpTestFixture);

          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .freezeReserve(await usdc.getAddress())
          ).to.be.revertedWith(ProtocolErrors.LPC_RESERVE_DOES_NOT_EXIST);
        });

        it("Should revert if the caller does not have correct role", async function () {
          const { lendingPoolConfigurator, addressesProvider, usdc, rando } =
            await loadFixture(setUpTestInitReserveFixture);

          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.POOL_ADMIN_ROLE()}`;

          await expect(
            lendingPoolConfigurator
              .connect(rando)
              .freezeReserve(await usdc.getAddress())
          ).to.be.revertedWith(expectedException);
        });
      }); // End of Error Test Cases Context
    }); // End of freezeReserve Context

    context("unfreezeReserve()", async function () {
      context("Happy Flow Test Cases", async function () {
        it("Should emit correct event", async function () {
          const { lendingPoolConfigurator, usdc, poolAdmin } =
            await loadFixture(setUpTestInitReserveFixture);

          // Freeze the USDC reserve
          await lendingPoolConfigurator
            .connect(poolAdmin)
            .freezeReserve(await usdc.getAddress());

          // Unfreeze the USDC reserve
          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .unfreezeReserve(await usdc.getAddress())
          )
            .to.emit(lendingPoolConfigurator, "ReserveUnfrozen")
            .withArgs(await usdc.getAddress());
        });

        it("Should update state correctly", async function () {
          const {
            lendingPoolConfigurator,
            meldProtocolDataProvider,
            usdc,
            meld,
            poolAdmin,
          } = await loadFixture(setUpTestInitReserveFixture);

          // Freeze the USDC reserve
          await lendingPoolConfigurator
            .connect(poolAdmin)
            .freezeReserve(await usdc.getAddress());

          // Unfreeze the USDC reserve
          await lendingPoolConfigurator
            .connect(poolAdmin)
            .unfreezeReserve(await usdc.getAddress());

          // Check the USDC reserve data configuration
          const reserveUSDCConfig =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await usdc.getAddress()
            );

          // Check the MELD reserve data configuration
          const reserveMELDConfig =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await meld.getAddress()
            );

          expect(reserveUSDCConfig.isFrozen).to.be.false;
          expect(reserveMELDConfig.isFrozen).to.be.false;
        });
      }); // End of Happy Flow Test Cases Context

      context("Error Test Cases", async function () {
        it("Should revert if asset is the zero address", async function () {
          const { lendingPoolConfigurator, poolAdmin } = await loadFixture(
            setUpTestInitReserveFixture
          );

          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .unfreezeReserve(ethers.ZeroAddress)
          ).to.be.revertedWith(ProtocolErrors.LPC_RESERVE_DOES_NOT_EXIST);
        });

        it("Should revert if asset reserve is not initialized", async function () {
          const { lendingPoolConfigurator, usdc, poolAdmin } =
            await loadFixture(setUpTestFixture);

          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .unfreezeReserve(await usdc.getAddress())
          ).to.be.revertedWith(ProtocolErrors.LPC_RESERVE_DOES_NOT_EXIST);
        });

        it("Should revert if the caller does not have correct role", async function () {
          const { lendingPoolConfigurator, addressesProvider, usdc, rando } =
            await loadFixture(setUpTestInitReserveFixture);

          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.POOL_ADMIN_ROLE()}`;

          await expect(
            lendingPoolConfigurator
              .connect(rando)
              .unfreezeReserve(await usdc.getAddress())
          ).to.be.revertedWith(expectedException);
        });
      }); // End of Error Test Cases Context
    }); // End of unfreezeReserve Context

    context("setReserveFactor()", async function () {
      context("Happy Flow Test Cases", async function () {
        it("Should emit correct event", async function () {
          const { lendingPoolConfigurator, usdc, poolAdmin } =
            await loadFixture(setUpTestInitReserveFixture);

          const configuration: Configuration = <Configuration>{}; // Configuration object to be used in tests

          configuration.reservesParams = <iMeldPoolAssets<IReserveParams>>(
            getReservesConfigByPool(MeldPools.proto)
          );

          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .setReserveFactor(
                await usdc.getAddress(),
                configuration.reservesParams.USDC!.reserveFactor
              )
          )
            .to.emit(lendingPoolConfigurator, "ReserveFactorChanged")
            .withArgs(
              await usdc.getAddress(),
              configuration.reservesParams.USDC!.reserveFactor
            );
        });

        it("Should update state correctly", async function () {
          const {
            lendingPoolConfigurator,
            meldProtocolDataProvider,
            usdc,
            meld,
            poolAdmin,
          } = await loadFixture(setUpTestInitReserveFixture);

          const configuration: Configuration = <Configuration>{}; // Configuration object to be used in tests

          configuration.reservesParams = <iMeldPoolAssets<IReserveParams>>(
            getReservesConfigByPool(MeldPools.proto)
          );

          // Set the new reserve factor for the USDC reserve
          await lendingPoolConfigurator
            .connect(poolAdmin)
            .setReserveFactor(
              await usdc.getAddress(),
              configuration.reservesParams.USDC!.reserveFactor
            );

          // Check the USDC reserve data configuration
          const reserveUSDCConfig =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await usdc.getAddress()
            );

          // Check the MELD reserve data configuration
          const reserveMELDConfig =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await meld.getAddress()
            );

          expect(reserveUSDCConfig.reserveFactor).to.equal(
            configuration.reservesParams.USDC!.reserveFactor
          );
          expect(reserveMELDConfig.reserveFactor).to.equal(0);
        });
      }); // End of Happy Flow Test Cases Context

      context("Error Test Cases", async function () {
        it("Should revert if asset is the zero address", async function () {
          const { lendingPoolConfigurator, poolAdmin } = await loadFixture(
            setUpTestInitReserveFixture
          );

          const configuration: Configuration = <Configuration>{}; // Configuration object to be used in tests

          configuration.reservesParams = <iMeldPoolAssets<IReserveParams>>(
            getReservesConfigByPool(MeldPools.proto)
          );

          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .setReserveFactor(
                ethers.ZeroAddress,
                configuration.reservesParams.USDC!.reserveFactor
              )
          ).to.be.revertedWith(ProtocolErrors.LPC_RESERVE_DOES_NOT_EXIST);
        });

        it("Should revert if asset reserve is not initialized", async function () {
          const { lendingPoolConfigurator, unsupportedToken, poolAdmin } =
            await loadFixture(setUpTestFixture);
          const configuration: Configuration = <Configuration>{}; // Configuration object to be used in tests

          configuration.reservesParams = <iMeldPoolAssets<IReserveParams>>(
            getReservesConfigByPool(MeldPools.proto)
          );
          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .setReserveFactor(
                await unsupportedToken.getAddress(),
                configuration.reservesParams.USDC!.reserveFactor
              )
          ).to.be.revertedWith(ProtocolErrors.LPC_RESERVE_DOES_NOT_EXIST);
        });

        it("Should revert if the caller does not have correct role", async function () {
          const { lendingPoolConfigurator, addressesProvider, usdc, rando } =
            await loadFixture(setUpTestInitReserveFixture);

          const configuration: Configuration = <Configuration>{}; // Configuration object to be used in tests

          configuration.reservesParams = <iMeldPoolAssets<IReserveParams>>(
            getReservesConfigByPool(MeldPools.proto)
          );

          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.POOL_ADMIN_ROLE()}`;

          await expect(
            lendingPoolConfigurator
              .connect(rando)
              .setReserveFactor(
                await usdc.getAddress(),
                configuration.reservesParams.USDC!.reserveFactor
              )
          ).to.be.revertedWith(expectedException);
        });
      }); // End of Error Test Cases Context
    }); // End of setReserveFactor Context

    context("setSupplyCapUSD()", async function () {
      context("Happy Flow Test Cases", async function () {
        it("Should emit correct event", async function () {
          const { lendingPoolConfigurator, usdc, poolAdmin } =
            await loadFixture(setUpTestInitReserveFixture);

          const configuration: Configuration = <Configuration>{}; // Configuration object to be used in tests

          configuration.reservesParams = <iMeldPoolAssets<IReserveParams>>(
            getReservesConfigByPool(MeldPools.proto)
          );

          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .setSupplyCapUSD(
                await usdc.getAddress(),
                configuration.reservesParams.USDC!.supplyCapUSD
              )
          )
            .to.emit(lendingPoolConfigurator, "ReserveSupplyCapUSDChanged")
            .withArgs(
              await usdc.getAddress(),
              configuration.reservesParams.USDC!.supplyCapUSD
            );
        });

        it("Should update state correctly", async function () {
          const {
            lendingPoolConfigurator,
            meldProtocolDataProvider,
            meldPriceOracle,
            usdc,
            meld,
            poolAdmin,
            oracleAdmin,
          } = await loadFixture(setUpTestInitReserveFixture);

          await meldPriceOracle.connect(oracleAdmin).setAssetPrice(usdc, _1e18);
          const configuration: Configuration = <Configuration>{}; // Configuration object to be used in tests

          configuration.reservesParams = <iMeldPoolAssets<IReserveParams>>(
            getReservesConfigByPool(MeldPools.proto)
          );

          // Set the supply cap for the USDC reserve
          await lendingPoolConfigurator
            .connect(poolAdmin)
            .setSupplyCapUSD(
              await usdc.getAddress(),
              configuration.reservesParams.USDC!.supplyCapUSD
            );

          // Check the USDC supply cap data
          const reserveUSDCSupplyCapData =
            await meldProtocolDataProvider.getSupplyCapData(
              await usdc.getAddress()
            );

          expect(reserveUSDCSupplyCapData.supplyCapUSD).to.equal(
            configuration.reservesParams.USDC!.supplyCapUSD
          );

          // Check the USDC reserve data configuration
          const reserveUSDCConfig =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await usdc.getAddress()
            );

          // Check the MELD reserve data configuration
          const reserveMELDConfig =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await meld.getAddress()
            );

          expect(reserveUSDCConfig.supplyCapUSD).to.equal(
            configuration.reservesParams.USDC!.supplyCapUSD
          );
          expect(reserveMELDConfig.supplyCapUSD).to.equal(0);
        });

        it("Should update state correctly for the max value", async function () {
          const {
            lendingPoolConfigurator,
            meldProtocolDataProvider,
            meldPriceOracle,
            usdc,
            meld,
            poolAdmin,
            oracleAdmin,
          } = await loadFixture(setUpTestInitReserveFixture);

          await meldPriceOracle.connect(oracleAdmin).setAssetPrice(usdc, _1e18);
          const configuration: Configuration = <Configuration>{}; // Configuration object to be used in tests

          configuration.reservesParams = <iMeldPoolAssets<IReserveParams>>(
            getReservesConfigByPool(MeldPools.proto)
          );

          const supplyCapUSDAmount = 17_179_869_183;

          // Set the supply cap for the USDC reserve
          await lendingPoolConfigurator
            .connect(poolAdmin)
            .setSupplyCapUSD(await usdc.getAddress(), supplyCapUSDAmount);

          // Check the USDC supply cap data
          const reserveUSDCSupplyCapData =
            await meldProtocolDataProvider.getSupplyCapData(
              await usdc.getAddress()
            );

          expect(reserveUSDCSupplyCapData.supplyCapUSD).to.equal(
            supplyCapUSDAmount
          );

          // Check the USDC reserve data configuration
          const reserveUSDCConfig =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await usdc.getAddress()
            );

          // Check the MELD reserve data configuration
          const reserveMELDConfig =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await meld.getAddress()
            );

          expect(reserveUSDCConfig.supplyCapUSD).to.equal(supplyCapUSDAmount);
          expect(reserveMELDConfig.supplyCapUSD).to.equal(0);
        });
      }); // End of Happy Flow Test Cases Context

      context("Error Test Cases", async function () {
        it("Should revert if asset is the zero address", async function () {
          const { lendingPoolConfigurator, poolAdmin } = await loadFixture(
            setUpTestInitReserveFixture
          );

          const configuration: Configuration = <Configuration>{}; // Configuration object to be used in tests

          configuration.reservesParams = <iMeldPoolAssets<IReserveParams>>(
            getReservesConfigByPool(MeldPools.proto)
          );

          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .setSupplyCapUSD(
                ethers.ZeroAddress,
                configuration.reservesParams.USDC!.supplyCapUSD
              )
          ).to.be.revertedWith(ProtocolErrors.LPC_RESERVE_DOES_NOT_EXIST);
        });

        it("Should revert if asset reserve is not initialized", async function () {
          const { lendingPoolConfigurator, unsupportedToken, poolAdmin } =
            await loadFixture(setUpTestFixture);

          const configuration: Configuration = <Configuration>{}; // Configuration object to be used in tests

          configuration.reservesParams = <iMeldPoolAssets<IReserveParams>>(
            getReservesConfigByPool(MeldPools.proto)
          );

          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .setSupplyCapUSD(
                await unsupportedToken.getAddress(),
                configuration.reservesParams.USDC!.supplyCapUSD
              )
          ).to.be.revertedWith(ProtocolErrors.LPC_RESERVE_DOES_NOT_EXIST);
        });

        it("Should revert if the caller does not have correct role", async function () {
          const { lendingPoolConfigurator, addressesProvider, usdc, rando } =
            await loadFixture(setUpTestInitReserveFixture);

          const configuration: Configuration = <Configuration>{}; // Configuration object to be used in tests

          configuration.reservesParams = <iMeldPoolAssets<IReserveParams>>(
            getReservesConfigByPool(MeldPools.proto)
          );

          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.POOL_ADMIN_ROLE()}`;

          await expect(
            lendingPoolConfigurator
              .connect(rando)
              .setSupplyCapUSD(
                await usdc.getAddress(),
                configuration.reservesParams.USDC!.supplyCapUSD
              )
          ).to.be.revertedWith(expectedException);
        });

        it("Should revert if the supply cap is higher than the max value", async function () {
          const {
            lendingPoolConfigurator,
            meldProtocolDataProvider,
            usdc,
            poolAdmin,
          } = await loadFixture(setUpTestInitReserveFixture);

          const [, , , , , maxSupplyCapUSD] =
            await meldProtocolDataProvider.getReserveConfigurationMaxValues();
          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .setSupplyCapUSD(usdc, maxSupplyCapUSD + 1n)
          ).to.be.revertedWith(ProtocolErrors.RC_INVALID_SUPPLY_CAP_USD);
        });
      }); // End of Error Test Cases Context
    }); // End of setSupplyCapUSD Context

    context("setBorrowCapUSD()", async function () {
      context("Happy Flow Test Cases", async function () {
        it("Should emit correct event", async function () {
          const { lendingPoolConfigurator, usdc, poolAdmin } =
            await loadFixture(setUpTestInitReserveFixture);

          const configuration: Configuration = <Configuration>{}; // Configuration object to be used in tests

          configuration.reservesParams = <iMeldPoolAssets<IReserveParams>>(
            getReservesConfigByPool(MeldPools.proto)
          );

          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .setBorrowCapUSD(
                await usdc.getAddress(),
                configuration.reservesParams.USDC!.borrowCapUSD
              )
          )
            .to.emit(lendingPoolConfigurator, "ReserveBorrowCapUSDChanged")
            .withArgs(
              await usdc.getAddress(),
              configuration.reservesParams.USDC!.borrowCapUSD
            );
        });

        it("Should update state correctly", async function () {
          const {
            lendingPoolConfigurator,
            meldProtocolDataProvider,
            meldPriceOracle,
            usdc,
            meld,
            poolAdmin,
            oracleAdmin,
          } = await loadFixture(setUpTestInitReserveFixture);

          await meldPriceOracle.connect(oracleAdmin).setAssetPrice(usdc, _1e18);
          const configuration: Configuration = <Configuration>{}; // Configuration object to be used in tests

          configuration.reservesParams = <iMeldPoolAssets<IReserveParams>>(
            getReservesConfigByPool(MeldPools.proto)
          );

          // Set the borrow cap for the USDC reserve
          await lendingPoolConfigurator
            .connect(poolAdmin)
            .setBorrowCapUSD(
              await usdc.getAddress(),
              configuration.reservesParams.USDC!.borrowCapUSD
            );

          // Check the USDC borrow cap data
          const reserveUSDCBorrowCapData =
            await meldProtocolDataProvider.getBorrowCapData(
              await usdc.getAddress()
            );

          expect(reserveUSDCBorrowCapData.borrowCapUSD).to.equal(
            configuration.reservesParams.USDC!.borrowCapUSD
          );

          // Check the USDC reserve data configuration
          const reserveUSDCConfig =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await usdc.getAddress()
            );

          // Check the MELD reserve data configuration
          const reserveMELDConfig =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await meld.getAddress()
            );

          expect(reserveUSDCConfig.borrowCapUSD).to.equal(
            configuration.reservesParams.USDC!.borrowCapUSD
          );
          expect(reserveMELDConfig.borrowCapUSD).to.equal(0);
        });
        it("Should update state correctly for the max value", async function () {
          const {
            lendingPoolConfigurator,
            meldProtocolDataProvider,
            meldPriceOracle,
            usdc,
            meld,
            poolAdmin,
            oracleAdmin,
          } = await loadFixture(setUpTestInitReserveFixture);

          await meldPriceOracle.connect(oracleAdmin).setAssetPrice(usdc, _1e18);

          const borrowCapUSDAmount = 17_179_869_183;

          // Set the borrow cap for the USDC reserve
          await lendingPoolConfigurator
            .connect(poolAdmin)
            .setBorrowCapUSD(await usdc.getAddress(), borrowCapUSDAmount);

          // Check the USDC borrow cap data
          const reserveUSDCBorrowCapData =
            await meldProtocolDataProvider.getBorrowCapData(
              await usdc.getAddress()
            );

          expect(reserveUSDCBorrowCapData.borrowCapUSD).to.equal(
            borrowCapUSDAmount
          );

          // Check the USDC reserve data configuration
          const reserveUSDCConfig =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await usdc.getAddress()
            );

          // Check the MELD reserve data configuration
          const reserveMELDConfig =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await meld.getAddress()
            );

          expect(reserveUSDCConfig.borrowCapUSD).to.equal(borrowCapUSDAmount);
          expect(reserveMELDConfig.borrowCapUSD).to.equal(0);
        });
      }); // End of Happy Flow Test Cases Context

      context("Error Test Cases", async function () {
        it("Should revert if asset is the zero address", async function () {
          const { lendingPoolConfigurator, poolAdmin } = await loadFixture(
            setUpTestInitReserveFixture
          );

          const configuration: Configuration = <Configuration>{}; // Configuration object to be used in tests

          configuration.reservesParams = <iMeldPoolAssets<IReserveParams>>(
            getReservesConfigByPool(MeldPools.proto)
          );

          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .setBorrowCapUSD(
                ethers.ZeroAddress,
                configuration.reservesParams.USDC!.borrowCapUSD
              )
          ).to.be.revertedWith(ProtocolErrors.LPC_RESERVE_DOES_NOT_EXIST);
        });

        it("Should revert if asset reserve is not initialized", async function () {
          const { lendingPoolConfigurator, unsupportedToken, poolAdmin } =
            await loadFixture(setUpTestFixture);

          const configuration: Configuration = <Configuration>{}; // Configuration object to be used in tests

          configuration.reservesParams = <iMeldPoolAssets<IReserveParams>>(
            getReservesConfigByPool(MeldPools.proto)
          );

          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .setBorrowCapUSD(
                await unsupportedToken.getAddress(),
                configuration.reservesParams.USDC!.borrowCapUSD
              )
          ).to.be.revertedWith(ProtocolErrors.LPC_RESERVE_DOES_NOT_EXIST);
        });

        it("Should revert if the caller does not have correct role", async function () {
          const { lendingPoolConfigurator, addressesProvider, usdc, rando } =
            await loadFixture(setUpTestInitReserveFixture);

          const configuration: Configuration = <Configuration>{}; // Configuration object to be used in tests

          configuration.reservesParams = <iMeldPoolAssets<IReserveParams>>(
            getReservesConfigByPool(MeldPools.proto)
          );

          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.POOL_ADMIN_ROLE()}`;

          await expect(
            lendingPoolConfigurator
              .connect(rando)
              .setBorrowCapUSD(
                await usdc.getAddress(),
                configuration.reservesParams.USDC!.borrowCapUSD
              )
          ).to.be.revertedWith(expectedException);
        });

        it("Should revert if the borrow cap is higher than the max value", async function () {
          const {
            lendingPoolConfigurator,
            meldProtocolDataProvider,
            usdc,
            poolAdmin,
          } = await loadFixture(setUpTestInitReserveFixture);

          const [, , , , , , maxBorrowCapUSD] =
            await meldProtocolDataProvider.getReserveConfigurationMaxValues();
          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .setBorrowCapUSD(usdc, maxBorrowCapUSD + 1n)
          ).to.be.revertedWith(ProtocolErrors.RC_INVALID_BORROW_CAP_USD);
        });
      }); // End of Error Test Cases Context
    }); // End of setBorrowCapUSD Context

    context("setFlashLoanLimitUSD()", async function () {
      context("Happy Flow Test Cases", async function () {
        it("Should emit correct event", async function () {
          const { lendingPoolConfigurator, usdc, poolAdmin } =
            await loadFixture(setUpTestInitReserveFixture);

          const configuration: Configuration = <Configuration>{}; // Configuration object to be used in tests

          configuration.reservesParams = <iMeldPoolAssets<IReserveParams>>(
            getReservesConfigByPool(MeldPools.proto)
          );

          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .setFlashLoanLimitUSD(
                await usdc.getAddress(),
                configuration.reservesParams.USDC!.flashLoanLimitUSD
              )
          )
            .to.emit(lendingPoolConfigurator, "ReserveFlashLoanLimitUSDChanged")
            .withArgs(
              await usdc.getAddress(),
              configuration.reservesParams.USDC!.flashLoanLimitUSD
            );
        });

        it("Should update state correctly", async function () {
          const {
            lendingPoolConfigurator,
            meldProtocolDataProvider,
            meldPriceOracle,
            usdc,
            meld,
            poolAdmin,
            oracleAdmin,
          } = await loadFixture(setUpTestInitReserveFixture);

          await meldPriceOracle.connect(oracleAdmin).setAssetPrice(usdc, _1e18);
          const configuration: Configuration = <Configuration>{}; // Configuration object to be used in tests

          configuration.reservesParams = <iMeldPoolAssets<IReserveParams>>(
            getReservesConfigByPool(MeldPools.proto)
          );

          // Set the flash loan limit for the USDC reserve
          await lendingPoolConfigurator
            .connect(poolAdmin)
            .setFlashLoanLimitUSD(
              await usdc.getAddress(),
              configuration.reservesParams.USDC!.flashLoanLimitUSD
            );

          // Check the USDC flash loan limit data
          const reserveUSDCFlashLoanLimitData =
            await meldProtocolDataProvider.getFlashLoanLimitData(
              await usdc.getAddress()
            );

          expect(reserveUSDCFlashLoanLimitData.flashLoanLimitUSD).to.equal(
            configuration.reservesParams.USDC!.flashLoanLimitUSD
          );

          // Check the USDC reserve data configuration
          const reserveUSDCConfig =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await usdc.getAddress()
            );

          // Check the MELD reserve data configuration
          const reserveMELDConfig =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await meld.getAddress()
            );

          expect(reserveUSDCConfig.flashLoanLimitUSD).to.equal(
            configuration.reservesParams.USDC!.flashLoanLimitUSD
          );
          expect(reserveMELDConfig.flashLoanLimitUSD).to.equal(0);
        });

        it("Should update state correctly for the max value", async function () {
          const {
            lendingPoolConfigurator,
            meldProtocolDataProvider,
            meldPriceOracle,
            usdc,
            meld,
            poolAdmin,
            oracleAdmin,
          } = await loadFixture(setUpTestInitReserveFixture);

          await meldPriceOracle.connect(oracleAdmin).setAssetPrice(usdc, _1e18);

          const [, , , , , , , maxFlashLoanLimitUSD] =
            await meldProtocolDataProvider.getReserveConfigurationMaxValues();

          // Set the flash loan limit for the USDC reserve
          await lendingPoolConfigurator
            .connect(poolAdmin)
            .setFlashLoanLimitUSD(
              await usdc.getAddress(),
              maxFlashLoanLimitUSD
            );

          // Check the USDC flash loan limit data
          const reserveUSDCFlashLoanLimitData =
            await meldProtocolDataProvider.getFlashLoanLimitData(
              await usdc.getAddress()
            );

          expect(reserveUSDCFlashLoanLimitData.flashLoanLimitUSD).to.equal(
            maxFlashLoanLimitUSD
          );

          // Check the USDC reserve data configuration
          const reserveUSDCConfig =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await usdc.getAddress()
            );

          // Check the MELD reserve data configuration
          const reserveMELDConfig =
            await meldProtocolDataProvider.getReserveConfigurationData(
              await meld.getAddress()
            );

          expect(reserveUSDCConfig.flashLoanLimitUSD).to.equal(
            maxFlashLoanLimitUSD
          );
          expect(reserveMELDConfig.flashLoanLimitUSD).to.equal(0);
        });
      }); // End of Happy Flow Test Cases Context

      context("Error Test Cases", async function () {
        it("Should revert if asset is the zero address", async function () {
          const { lendingPoolConfigurator, poolAdmin } = await loadFixture(
            setUpTestInitReserveFixture
          );

          const configuration: Configuration = <Configuration>{}; // Configuration object to be used in tests

          configuration.reservesParams = <iMeldPoolAssets<IReserveParams>>(
            getReservesConfigByPool(MeldPools.proto)
          );

          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .setFlashLoanLimitUSD(
                ethers.ZeroAddress,
                configuration.reservesParams.USDC!.flashLoanLimitUSD
              )
          ).to.be.revertedWith(ProtocolErrors.LPC_RESERVE_DOES_NOT_EXIST);
        });

        it("Should revert if asset reserve is not initialized", async function () {
          const { lendingPoolConfigurator, unsupportedToken, poolAdmin } =
            await loadFixture(setUpTestFixture);

          const configuration: Configuration = <Configuration>{}; // Configuration object to be used in tests

          configuration.reservesParams = <iMeldPoolAssets<IReserveParams>>(
            getReservesConfigByPool(MeldPools.proto)
          );

          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .setFlashLoanLimitUSD(
                await unsupportedToken.getAddress(),
                configuration.reservesParams.USDC!.flashLoanLimitUSD
              )
          ).to.be.revertedWith(ProtocolErrors.LPC_RESERVE_DOES_NOT_EXIST);
        });

        it("Should revert if the caller does not have correct role", async function () {
          const { lendingPoolConfigurator, addressesProvider, usdc, rando } =
            await loadFixture(setUpTestInitReserveFixture);

          const configuration: Configuration = <Configuration>{}; // Configuration object to be used in tests

          configuration.reservesParams = <iMeldPoolAssets<IReserveParams>>(
            getReservesConfigByPool(MeldPools.proto)
          );

          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.POOL_ADMIN_ROLE()}`;

          await expect(
            lendingPoolConfigurator
              .connect(rando)
              .setFlashLoanLimitUSD(
                await usdc.getAddress(),
                configuration.reservesParams.USDC!.flashLoanLimitUSD
              )
          ).to.be.revertedWith(expectedException);
        });

        it("Should revert if the flash loan limit is higher than the max value", async function () {
          const {
            lendingPoolConfigurator,
            meldProtocolDataProvider,
            usdc,
            poolAdmin,
          } = await loadFixture(setUpTestInitReserveFixture);

          const [, , , , , , , maxFlashLoanLimitUSD] =
            await meldProtocolDataProvider.getReserveConfigurationMaxValues();
          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .setFlashLoanLimitUSD(usdc, maxFlashLoanLimitUSD + 1n)
          ).to.be.revertedWith(ProtocolErrors.RC_INVALID_FLASHLOAN_LIMIT_USD);
        });
      }); // End of Error Test Cases Context
    }); // End of setFlashLoanLimitUSD Context

    context("setYieldBoostStakingAddress()", async function () {
      context("Happy Flow Test Cases", async function () {
        it("Should emit correct event when setting a YieldBoostStaking address", async function () {
          const { lendingPoolConfigurator, usdc, poolAdmin, rando } =
            await loadFixture(setUpTestInitReserveFixture);

          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .setYieldBoostStakingAddress(usdc, rando)
          )
            .to.emit(lendingPoolConfigurator, "YieldBoostStakingAddressChanged")
            .withArgs(await usdc.getAddress(), rando.address);
        });

        it("Should emit correct event when setting a YieldBoostStaking address to the zero address", async function () {
          const { lendingPoolConfigurator, usdc, poolAdmin } =
            await loadFixture(setUpTestInitReserveFixture);

          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .setYieldBoostStakingAddress(usdc, ZeroAddress)
          )
            .to.emit(lendingPoolConfigurator, "YieldBoostStakingAddressChanged")
            .withArgs(await usdc.getAddress(), ZeroAddress);
        });

        it("Should update state correctly", async function () {
          const {
            lendingPoolConfigurator,
            meldProtocolDataProvider,
            usdc,
            poolAdmin,
            rando,
          } = await loadFixture(setUpTestInitReserveFixture);

          // Set the YieldBoostStaking address for the USDC reserve
          await lendingPoolConfigurator
            .connect(poolAdmin)
            .setYieldBoostStakingAddress(usdc, rando);

          // Check the USDC yield boost staking address

          expect(
            await meldProtocolDataProvider.getReserveYieldBoostStaking(
              await usdc.getAddress()
            )
          ).to.equal(rando.address);
        });

        it("Should update state correctly when setting the YieldBoostStaking address to the zero address", async function () {
          const {
            lendingPoolConfigurator,
            meldProtocolDataProvider,
            usdc,
            poolAdmin,
          } = await loadFixture(setUpTestInitReserveFixture);

          // Set the YieldBoostStaking address for the USDC reserve to the zero address
          await lendingPoolConfigurator
            .connect(poolAdmin)
            .setYieldBoostStakingAddress(usdc, ZeroAddress);

          // Check the USDC yield boost staking address
          expect(
            await meldProtocolDataProvider.getReserveYieldBoostStaking(
              await usdc.getAddress()
            )
          ).to.equal(ZeroAddress);
        });
      }); // End of Happy Flow Test Cases Context

      context("Error Test Cases", async function () {
        it("Should revert if the caller does not have correct role", async function () {
          const { lendingPoolConfigurator, addressesProvider, rando, usdc } =
            await loadFixture(setUpTestInitReserveFixture);

          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.POOL_ADMIN_ROLE()}`;

          await expect(
            lendingPoolConfigurator
              .connect(rando)
              .setYieldBoostStakingAddress(usdc, ZeroAddress)
          ).to.be.revertedWith(expectedException);
        });

        it("Should revert if the asset is the zero address", async function () {
          const { lendingPoolConfigurator, poolAdmin } = await loadFixture(
            setUpTestInitReserveFixture
          );
          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .setYieldBoostStakingAddress(ZeroAddress, ZeroAddress)
          ).to.be.revertedWith(ProtocolErrors.LPC_RESERVE_DOES_NOT_EXIST);
        });

        it("Should revert if the asset reserve is not initialized", async function () {
          const { lendingPoolConfigurator, unsupportedToken, poolAdmin } =
            await loadFixture(setUpTestFixture);

          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .setYieldBoostStakingAddress(
                await unsupportedToken.getAddress(),
                ZeroAddress
              )
          ).to.be.revertedWith(ProtocolErrors.LPC_RESERVE_DOES_NOT_EXIST);
        });
      }); // End of Error Test Cases Context
    }); // End of setYieldBoostStakingAddress Context

    context("setReserveInterestRateStrategyAddress()", async function () {
      context("Happy Flow Test Cases", async function () {
        it("Should emit correct event", async function () {
          const { lendingPoolConfigurator, usdc, poolAdmin, rando } =
            await loadFixture(setUpTestInitReserveFixture);

          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .setReserveInterestRateStrategyAddress(
                await usdc.getAddress(),
                rando.address
              )
          )
            .to.emit(
              lendingPoolConfigurator,
              "ReserveInterestRateStrategyChanged"
            )
            .withArgs(await usdc.getAddress(), rando.address);
        });

        it("Should update state correctly", async function () {
          const {
            lendingPoolConfigurator,
            meldProtocolDataProvider,
            usdc,
            poolAdmin,
            rando,
          } = await loadFixture(setUpTestInitReserveFixture);

          await lendingPoolConfigurator
            .connect(poolAdmin)
            .setReserveInterestRateStrategyAddress(
              await usdc.getAddress(),
              rando.address
            );

          // Check the interest rate strategy address
          const interestRateStrategyAddress =
            await meldProtocolDataProvider.getReserveInterestRateStrategyAddress(
              await usdc.getAddress()
            );

          expect(interestRateStrategyAddress).to.equal(rando.address);
        });
      }); // End of Happy Flow Test Cases Context

      context("Error Test Cases", async function () {
        it("Should revert if asset is the zero address", async function () {
          const { lendingPoolConfigurator, poolAdmin, rando } =
            await loadFixture(setUpTestInitReserveFixture);

          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .setReserveInterestRateStrategyAddress(ZeroAddress, rando.address)
          ).to.be.revertedWith(ProtocolErrors.LPC_RESERVE_DOES_NOT_EXIST);
        });

        it("Should revert if interest rate strategy is the zero address", async function () {
          const { lendingPoolConfigurator, usdc, poolAdmin } =
            await loadFixture(setUpTestInitReserveFixture);

          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .setReserveInterestRateStrategyAddress(
                await usdc.getAddress(),
                ZeroAddress
              )
          ).to.be.revertedWith(ProtocolErrors.INVALID_ADDRESS);
        });

        it("Should revert if asset reserve is not initialized", async function () {
          const {
            lendingPoolConfigurator,
            unsupportedToken,
            poolAdmin,
            rando,
          } = await loadFixture(setUpTestFixture);

          await expect(
            lendingPoolConfigurator
              .connect(poolAdmin)
              .setReserveInterestRateStrategyAddress(
                await unsupportedToken.getAddress(),
                rando.address
              )
          ).to.be.revertedWith(ProtocolErrors.LPC_RESERVE_DOES_NOT_EXIST);
        });

        it("Should revert if the caller does not have correct role", async function () {
          const { lendingPoolConfigurator, addressesProvider, usdc, rando } =
            await loadFixture(setUpTestInitReserveFixture);

          const expectedException = `AccessControl: account ${rando.address.toLowerCase()} is missing role ${await addressesProvider.POOL_ADMIN_ROLE()}`;

          await expect(
            lendingPoolConfigurator
              .connect(rando)
              .setReserveInterestRateStrategyAddress(
                await usdc.getAddress(),
                rando.address
              )
          ).to.be.revertedWith(expectedException);
        });
      }); // End of Error Test Cases Context
    }); // End of setReserveInterestRateStrategyAddress Context
  }); // End of Configure Reserve Context
});
