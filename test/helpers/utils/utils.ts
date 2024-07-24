import { ethers, upgrades } from "hardhat";
import { network } from "hardhat";
import {
  BaseContract,
  Contract,
  ContractTransactionResponse,
  Wallet,
  Signature,
} from "ethers";
import { getContractAddress } from "@ethersproject/address";
import "./math";
import { loadPoolConfig, ConfigNames } from "./configuration";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import {
  LendingPool,
  SampleERC20,
  MeldProtocolDataProvider,
  DefaultReserveInterestRateStrategy,
  LendingPoolConfigurator,
  MeldPriceOracle,
  PriceOracleAggregator,
  MeldLendingRateOracle,
  AddressesProvider,
  SupraOracleAdapter,
  YieldBoostFactory,
  MeldBankerNFT,
  YieldBoostStaking,
  YieldBoostStorage,
} from "../../../typechain-types";
import type { ILendingPoolConfigurator } from "../../../typechain-types/contracts/lending/LendingPoolConfigurator";
import {
  IMeldConfiguration,
  IReserveParams,
  MeldPools,
  PoolConfiguration,
  iMultiPoolsAssets,
} from "../types";
import {
  BlockTimestamps,
  ReserveInitParams,
  ReserveConfigParams,
} from "../interfaces";
import {
  convertToCurrencyDecimals,
  getParamPerPool,
} from "./contracts-helpers";
import { expect } from "chai";

const confirmations = Number(
  network.name == "hardhat" ? 1 : process.env.CONFIRMATIONS
);

async function deployLibraries() {
  const GenericLogic = await ethers.getContractFactory("GenericLogic");
  const genericLogic = await GenericLogic.deploy();

  const ReserveLogic = await ethers.getContractFactory("ReserveLogic");
  const reserveLogic = await ReserveLogic.deploy();

  const ValidationLogic = await ethers.getContractFactory("ValidationLogic", {
    libraries: {
      GenericLogic: await genericLogic.getAddress(),
    },
  });

  const validationLogic = await ValidationLogic.deploy();

  const LiquidationLogic = await ethers.getContractFactory("LiquidationLogic", {
    libraries: {
      GenericLogic: await genericLogic.getAddress(),
    },
  });

  const liquidationLogic = await LiquidationLogic.deploy();

  const BorrowLogic = await ethers.getContractFactory("BorrowLogic", {
    libraries: {
      GenericLogic: await genericLogic.getAddress(),
    },
  });
  const borrowLogic = await BorrowLogic.deploy();

  const DepositLogic = await ethers.getContractFactory("DepositLogic");
  const depositLogic = await DepositLogic.deploy();

  const FlashLoanLogic = await ethers.getContractFactory("FlashLoanLogic");
  const flashLoanLogic = await FlashLoanLogic.deploy();

  const WithdrawLogic = await ethers.getContractFactory("WithdrawLogic", {
    libraries: {
      GenericLogic: await genericLogic.getAddress(),
    },
  });
  const withdrawLogic = await WithdrawLogic.deploy();

  const RepayLogic = await ethers.getContractFactory("RepayLogic");
  const repayLogic = await RepayLogic.deploy();

  const YieldBoostLogic = await ethers.getContractFactory("YieldBoostLogic");
  const yieldBoostLogic = await YieldBoostLogic.deploy();

  return {
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
  };
}

async function deployContracts(
  addressesProviderSetters: boolean,
  reservesConfig: IMeldConfiguration["ReservesConfig"],
  defaultAdmin: SignerWithAddress,
  poolAdmin: SignerWithAddress,
  oracleAdmin: SignerWithAddress,
  bankerAdmin: SignerWithAddress,
  pauser: SignerWithAddress,
  unpauser: SignerWithAddress,
  roleDestroyer: SignerWithAddress,
  skipSetMeldBankerNFT = false
) {
  upgrades.silenceWarnings();
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

  await addressesProvider.setLendingPool(lendingPool); // Needed for MeldBankerNFT

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

  if (addressesProviderSetters) {
    await addressesProvider.setLendingPoolConfigurator(lendingPoolConfigurator);
    await addressesProvider.setLendingRateOracle(lendingRateOracleAggregator);
    await addressesProvider.setPriceOracle(priceOracleAggregator);
    await addressesProvider.setMeldBankerNFTMinter(meldBankerNftMinter);
    await addressesProvider.setYieldBoostFactory(yieldBoostFactory);
    await addressesProvider.setProtocolDataProvider(meldProtocolDataProvider);
    if (!skipSetMeldBankerNFT) {
      await lendingPool.connect(poolAdmin).setMeldBankerNFT();
    }
  }

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

  const tetherInterestRateStrategy = (await interestRateStrategyFactory.deploy(
    addressesProvider,
    reservesConfig.USDT!.strategy.optimalUtilizationRate,
    reservesConfig.USDT!.strategy.baseVariableBorrowRate,
    reservesConfig.USDT!.strategy.variableRateSlope1,
    reservesConfig.USDT!.strategy.variableRateSlope2,
    reservesConfig.USDT!.strategy.stableRateSlope1,
    reservesConfig.USDT!.strategy.stableRateSlope2
  )) as DefaultReserveInterestRateStrategy & Contract;

  const daiInterestRateStrategy = (await interestRateStrategyFactory.deploy(
    addressesProvider,
    reservesConfig.DAI!.strategy.optimalUtilizationRate,
    reservesConfig.DAI!.strategy.baseVariableBorrowRate,
    reservesConfig.DAI!.strategy.variableRateSlope1,
    reservesConfig.DAI!.strategy.variableRateSlope2,
    reservesConfig.DAI!.strategy.stableRateSlope1,
    reservesConfig.DAI!.strategy.stableRateSlope2
  )) as DefaultReserveInterestRateStrategy & Contract;

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
    meldInterestRateStrategy,
    tetherInterestRateStrategy,
    daiInterestRateStrategy,
    mTokenImplAddress,
    stableDebtTokenImplAddress,
    variableDebtTokenImplAddress,
  };
}

async function grantRoles(
  addressesProvider: AddressesProvider,
  defaultAdmin: SignerWithAddress,
  poolAdmin: SignerWithAddress,
  oracleAdmin: SignerWithAddress,
  bankerAdmin: SignerWithAddress,
  pauser: SignerWithAddress,
  unpauser: SignerWithAddress,
  roleDestroyer: SignerWithAddress
) {
  // DEFAULT_ADMIN_ROLE is granted to deployer upon deployment.
  // DEFAULT_ADMIN_ROLE holder (deployer) grants POOL_ADMIN_ROLE
  await addressesProvider
    .connect(defaultAdmin)
    .grantRole(await addressesProvider.POOL_ADMIN_ROLE(), poolAdmin);
  // DEFAULT_ADMIN_ROLE holder (deployer) grants ORACLE_MANAGEMENT_ROLE
  await addressesProvider
    .connect(defaultAdmin)
    .grantRole(await addressesProvider.ORACLE_MANAGEMENT_ROLE(), oracleAdmin);
  // DEFAULT_ADMIN_ROLE holder (deployer) grants BNKR_NFT_MINTER_BURNER_ROLE
  await addressesProvider
    .connect(defaultAdmin)
    .grantRole(
      await addressesProvider.BNKR_NFT_MINTER_BURNER_ROLE(),
      bankerAdmin
    );

  // DEFAULT_ADMIN_ROLE holder (deployer) grants DESTROYER_ROLE
  await addressesProvider
    .connect(defaultAdmin)
    .grantRole(await addressesProvider.DESTROYER_ROLE(), roleDestroyer);

  // DEFAULT_ADMIN_ROLE holder (deployer) grants PAUSER_ROLE
  await addressesProvider.grantRole(
    await addressesProvider.PAUSER_ROLE(),
    pauser
  );

  // DEFAULT_ADMIN_ROLE holder (deployer) grants UNPAUSER_ROLE
  await addressesProvider.grantRole(
    await addressesProvider.UNPAUSER_ROLE(),
    unpauser
  );
}
async function deployMockTokens() {
  const sampleERC20Factory = await ethers.getContractFactory("SampleERC20");

  const initialSupply = 1000000 * 10 ** 6; // 1 million USDC
  const usdc = (await sampleERC20Factory.deploy(
    "USD Coin",
    "USDC",
    6,
    initialSupply
  )) as SampleERC20 & Contract;

  // This token will not be associated with a reserve
  const unsupportedToken = (await sampleERC20Factory.deploy(
    "unsupportedToken Token",
    "UT",
    6,
    initialSupply
  )) as SampleERC20 & Contract;

  const initialSupplyDecimals18 = ethers.parseEther("1000000"); //1 million MELD. MELD has same number of decimals as ETH

  const meld = (await sampleERC20Factory.deploy(
    "Meld",
    "MELD",
    18,
    initialSupplyDecimals18
  )) as SampleERC20 & Contract;

  const tether = (await sampleERC20Factory.deploy(
    "Tether USD",
    "USDT",
    6,
    initialSupply
  )) as SampleERC20 & Contract;

  const dai = (await sampleERC20Factory.deploy(
    "Dai Stablecoin",
    "DAI",
    18,
    initialSupplyDecimals18
  )) as SampleERC20 & Contract;

  return { usdc, unsupportedToken, meld, tether, dai };
}

async function getTokensParams(underlyingAsset: Contract) {
  const poolConfig: PoolConfiguration = loadPoolConfigForEnv();
  const {
    MTokenNamePrefix,
    StableDebtTokenNamePrefix,
    VariableDebtTokenNamePrefix,
    SymbolPrefix,
    ReservesConfig,
    ReserveAssets,
  } = poolConfig;

  let symbolKey: string | undefined;

  const symbol = await underlyingAsset.symbol();

  const env: ConfigNames = switchEnvController();
  if (env == ConfigNames.MeldDev) {
    symbolKey = symbol;
  } else {
    const underlyingAssetAddr = await underlyingAsset.getAddress();
    symbolKey = Object.keys(ReserveAssets).find(
      (key) =>
        ReserveAssets[key as keyof typeof ReserveAssets] === underlyingAssetAddr
    );
  }

  const name = await underlyingAsset.name();
  const decimals = await underlyingAsset.decimals();
  const mTokenName = `${MTokenNamePrefix} ${symbol}`;
  const mTokenSymbol = `${SymbolPrefix}${symbol}`;
  const variableDebtTokenName = `${VariableDebtTokenNamePrefix} ${symbol}`;
  const variableDebtTokenSymbol = `variableDebt${symbol}`;
  const stableDebtTokenName = `${StableDebtTokenNamePrefix} ${symbol}`;
  const stableDebtTokenSymbol = `stableDebt${symbol}`;
  const assetReserveConfig =
    ReservesConfig[symbolKey as keyof typeof ReservesConfig];
  const yieldBoostEnabled = assetReserveConfig
    ? assetReserveConfig.yieldBoostEnabled
    : false;
  return {
    yieldBoostEnabled,
    name,
    symbol,
    decimals,
    mTokenName,
    mTokenSymbol,
    variableDebtTokenName,
    variableDebtTokenSymbol,
    stableDebtTokenName,
    stableDebtTokenSymbol,
  };
}

async function createInitReserveParams(
  underlyingAsset: Contract,
  interestRateStrategy: Contract,
  treasuryAddress: string
): Promise<ILendingPoolConfigurator.InitReserveInputStruct> {
  const underlyingAssetParams = await getTokensParams(underlyingAsset);

  return {
    yieldBoostEnabled: underlyingAssetParams.yieldBoostEnabled,
    underlyingAssetDecimals: underlyingAssetParams.decimals,
    interestRateStrategyAddress: await interestRateStrategy.getAddress(),
    underlyingAsset: await underlyingAsset.getAddress(),
    treasury: treasuryAddress,
    underlyingAssetName: underlyingAssetParams.name,
    mTokenName: underlyingAssetParams.mTokenName,
    mTokenSymbol: underlyingAssetParams.mTokenSymbol,
    variableDebtTokenName: underlyingAssetParams.variableDebtTokenName,
    variableDebtTokenSymbol: underlyingAssetParams.variableDebtTokenSymbol,
    stableDebtTokenName: underlyingAssetParams.stableDebtTokenName,
    stableDebtTokenSymbol: underlyingAssetParams.stableDebtTokenSymbol,
  };
}

/**
 * This function initializes the reserves by looping over an array and calling the batchInitReserve function
 *
 * @param reserveInitParams An array of ReserveInitParams
 * @param treasury The treasurey address
 * @param lendingPoolConfigurator The LendingPoolconfigurator contract
 */
async function initializeReserves(
  reserveInitParams: ReserveInitParams[],
  treasuryAddress: string,
  lendingPoolConfigurator: LendingPoolConfigurator,
  poolAdmin: SignerWithAddress | Wallet
) {
  // Initialize paramter that will be an array of ILendingPoolConfigurator.InitReserveInputStruct
  const reserveParamsArray: ILendingPoolConfigurator.InitReserveInputStruct[] =
    [];

  for (const reserveInitParam of reserveInitParams) {
    //Initialize reserves
    const reserveParams: ILendingPoolConfigurator.InitReserveInputStruct =
      await createInitReserveParams(
        reserveInitParam.underlyingAsset,
        reserveInitParam.interestRateStrategy,
        treasuryAddress
      );

    reserveParamsArray.push(reserveParams);
  }

  const transactionResponse = await lendingPoolConfigurator
    .connect(poolAdmin)
    .batchInitReserve(reserveParamsArray);

  await transactionResponse.wait(confirmations);
}

// Configure reserves, using the default MeldPriceOracle and MeldLendingRateOracle
async function configureReservesForBorrowing(
  reserveConfigParams: ReserveConfigParams[],
  meldPriceOracle: MeldPriceOracle,
  lendingRateOracle: MeldLendingRateOracle,
  lendingPoolConfigurator: LendingPoolConfigurator,
  poolAdmin: SignerWithAddress | Wallet,
  oracleAdmin: SignerWithAddress | Wallet,
  supraOracleAdapter?: SupraOracleAdapter
) {
  let transactionResponse;

  // Get pool configuration values
  const poolConfig: PoolConfiguration = loadPoolConfigForEnv();

  const {
    Mocks: { AllAssetsInitialPrices },
    LendingRateOracleRatesCommon,
    ReserveAssets,
    ReservesConfig,
    SupraPricePairPaths,
  } = poolConfig as IMeldConfiguration;

  for (const reserveConfigParam of reserveConfigParams) {
    let symbolKey2: string | undefined;

    const symbol = await reserveConfigParam.underlyingAsset.symbol();

    const env: ConfigNames = switchEnvController();
    if (env == ConfigNames.MeldDev) {
      symbolKey2 = symbol;
    } else {
      const underlyingAssetAddr =
        await reserveConfigParam.underlyingAsset.getAddress();
      symbolKey2 = Object.keys(ReserveAssets).find(
        (key) =>
          ReserveAssets[key as keyof typeof ReserveAssets] ===
          underlyingAssetAddr
      );
    }
    const symbolKey = symbolKey2 as keyof typeof ReservesConfig;

    // Configure reserves
    if (network.name != "meld") {
      // Set the asset price
      transactionResponse = await meldPriceOracle
        .connect(oracleAdmin)
        .setAssetPrice(
          await reserveConfigParam.underlyingAsset.getAddress(),
          AllAssetsInitialPrices[symbolKey]
        );

      await transactionResponse.wait(confirmations);

      // Set test market lending rates
      transactionResponse = await lendingRateOracle
        .connect(oracleAdmin)
        .setMarketBorrowRate(
          await reserveConfigParam.underlyingAsset.getAddress(),
          LendingRateOracleRatesCommon[symbolKey]!.borrowRate
        );

      await transactionResponse.wait(confirmations);

      // long price validity to avoid errors in unit tests and on testnet
      transactionResponse = await meldPriceOracle
        .connect(oracleAdmin)
        .setMaxPriceAge(100000000000n);

      await transactionResponse.wait(confirmations);
    }

    // May not be present when running unit tests
    if (supraOracleAdapter) {
      // Set pair paths for the SupraOracleAdapter
      transactionResponse = await supraOracleAdapter.setPairPath(
        await reserveConfigParam.underlyingAsset.getAddress(),
        SupraPricePairPaths[symbolKey]
      );

      await transactionResponse.wait(confirmations);
      await expect(transactionResponse)
        .to.emit(supraOracleAdapter, "PairPathAdded")
        .withArgs(
          oracleAdmin.address,
          await reserveConfigParam.underlyingAsset.getAddress(),
          SupraPricePairPaths[symbolKey]
        );

      console.log(
        "SupraOracleAdapter pair path added for: %s",
        symbolKey,
        SupraPricePairPaths[symbolKey]
      );
    }

    // Enable borrowing on reserve
    if (reserveConfigParam.enableBorrowing) {
      transactionResponse = await lendingPoolConfigurator
        .connect(poolAdmin)
        .enableBorrowingOnReserve(
          await reserveConfigParam.underlyingAsset.getAddress(),
          reserveConfigParam.enableStableBorrowing
        );

      await transactionResponse.wait(confirmations);

      await expect(transactionResponse)
        .to.emit(lendingPoolConfigurator, "BorrowingEnabledOnReserve")
        .withArgs(
          await reserveConfigParam.underlyingAsset.getAddress(),
          reserveConfigParam.enableStableBorrowing
        );
    }

    // Set reserve factor
    transactionResponse = await lendingPoolConfigurator
      .connect(poolAdmin)
      .setReserveFactor(
        await reserveConfigParam.underlyingAsset.getAddress(),
        ReservesConfig[symbolKey]!.reserveFactor
      );

    await transactionResponse.wait(confirmations);

    await expect(transactionResponse)
      .to.emit(lendingPoolConfigurator, "ReserveFactorChanged")
      .withArgs(
        await reserveConfigParam.underlyingAsset.getAddress(),
        ReservesConfig[symbolKey]!.reserveFactor
      );

    // Set collateral configuration
    transactionResponse = await lendingPoolConfigurator
      .connect(poolAdmin)
      .configureReserveAsCollateral(
        await reserveConfigParam.underlyingAsset.getAddress(),
        ReservesConfig[symbolKey]!.baseLTVAsCollateral,
        ReservesConfig[symbolKey]!.liquidationThreshold,
        ReservesConfig[symbolKey]!.liquidationBonus
      );

    await transactionResponse.wait(confirmations);

    await expect(transactionResponse)
      .to.emit(lendingPoolConfigurator, "CollateralConfigurationChanged")
      .withArgs(
        await reserveConfigParam.underlyingAsset.getAddress(),
        ReservesConfig[symbolKey]!.baseLTVAsCollateral,
        ReservesConfig[symbolKey]!.liquidationThreshold,
        ReservesConfig[symbolKey]!.liquidationBonus
      );

    // Set supply cap
    transactionResponse = await lendingPoolConfigurator
      .connect(poolAdmin)
      .setSupplyCapUSD(
        await reserveConfigParam.underlyingAsset.getAddress(),
        ReservesConfig[symbolKey]!.supplyCapUSD
      );

    await transactionResponse.wait(confirmations);

    await expect(transactionResponse)
      .to.emit(lendingPoolConfigurator, "ReserveSupplyCapUSDChanged")
      .withArgs(
        await reserveConfigParam.underlyingAsset.getAddress(),
        ReservesConfig[symbolKey]!.supplyCapUSD
      );

    // Set borrow cap
    transactionResponse = await lendingPoolConfigurator
      .connect(poolAdmin)
      .setBorrowCapUSD(
        await reserveConfigParam.underlyingAsset.getAddress(),
        ReservesConfig[symbolKey]!.borrowCapUSD
      );

    await transactionResponse.wait(confirmations);

    await expect(transactionResponse)
      .to.emit(lendingPoolConfigurator, "ReserveBorrowCapUSDChanged")
      .withArgs(
        await reserveConfigParam.underlyingAsset.getAddress(),
        ReservesConfig[symbolKey]!.borrowCapUSD
      );

    // Set flash loan limit
    transactionResponse = await lendingPoolConfigurator
      .connect(poolAdmin)
      .setFlashLoanLimitUSD(
        await reserveConfigParam.underlyingAsset.getAddress(),
        ReservesConfig[symbolKey]!.flashLoanLimitUSD
      );

    await transactionResponse.wait(confirmations);

    await expect(transactionResponse)
      .to.emit(lendingPoolConfigurator, "ReserveFlashLoanLimitUSDChanged")
      .withArgs(
        await reserveConfigParam.underlyingAsset.getAddress(),
        ReservesConfig[symbolKey]!.flashLoanLimitUSD
      );
  }
}

/**
 * @dev Converts a currency amount to the underlying decimals, transfers the tokens to the 'from' address and approves the 'to' addressand approves the spending of the tokens
 * @param token The token contract
 * @param from: Signer whose address will transfer tokens to the 'to' address
 * @param to: Signer whose address will receive tokens from the 'from' address and approve the spender
 * @param spender: Contract that will be approved to spend tokens from the 'to' address
 * @param amount: Amount of tokens to be used in the test, for instance, as a deposit amoun. Is converted to correct decimals for token
 * @param factor: Factor to multiply the amount by, for instance, to approve a higher amount than the deposit amount
 * @returns The converted currency amount that can be used as, for exmaple, a deposit amount
 * */
async function allocateAndApproveTokens(
  token: SampleERC20,
  from: SignerWithAddress,
  to: SignerWithAddress,
  spender: Contract | BaseContract,
  amount: bigint | number,
  factor: bigint
): Promise<bigint> {
  const currencyAmount = await convertToCurrencyDecimals(
    await token.getAddress(),
    amount.toString()
  );
  const approvalAmount: bigint =
    factor > 0 ? currencyAmount * factor : currencyAmount;

  const balanceBefore = await token.balanceOf(to.address);

  // Make sure "to" address has enough tokens
  await token.connect(from).transfer(to.address, approvalAmount);
  expect(await token.balanceOf(to.address)).to.equal(
    balanceBefore + approvalAmount
  );

  await token.connect(to).approve(await spender.getAddress(), approvalAmount);
  expect(
    await token.allowance(to.address, await spender.getAddress())
  ).to.equal(approvalAmount);

  return currencyAmount;
}

/**
 * @dev Computes the addresses of tokens that will be created/cloned for each reserve
 * @param deployingContract The contract that will deploy the tokens. This should be the LendingPoolConfiguator contract
 * @param reserveList The reserves for which to compute the token addresses, e.g. ["USDC"] or ["USDC", "MELD"]
 * @returns A Map of each reserve to the token addresses for that reserve:
 *
 * Map(2) {
 *'USDC' => {
 *  Mtoken: '0x2ACDe8bc8567D49CF2Fe54999d4d4A1cd1a9fFEA',
 *  StableDebtToken: '0x2340E2c1Fd4370ff362e6567818c7330e3D9Cb63',
 *  VariableDebtToken: '0x8203678f6fB1BFF06aFf4d1bCD0EdCCCeb1914e4',
 * },
 * 'MELD' => {
 *   Mtoken: '0x0977Fda4C5305B5aE1298BA2bb8950ffd3cD199b',
 *   StableDebtToken: '0x81f4eb0C91fEc7269f5CEf7246Bb5773D320c932',
 *   VariableDebtToken: '0x09525f3199EfC1855eAa69a14Bd9c6Ab8e6ac79c',
 * }
 *}
 *
 * */
async function calculateTokenAddresses(
  deployingContract: Contract | BaseContract,
  reserveList: string[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const reserveTokens = new Map<string, { [key: string]: string }>();

  // The nonce of the deploying contract helps determine the address of the cloned tokens
  // because it is seen as the deployer of the cloned tokens.
  let nonce: number = await ethers.provider.getTransactionCount(
    await deployingContract.getAddress()
  );

  // Order of token names is important because the address is calculated based on the nonce.
  // Nonce is determined in the order the tokens are cloned.
  const tokenList = ["Mtoken", "StableDebtToken", "VariableDebtToken"];

  // Loop through the reserves in the reserve list. Create a Map of eacht reserve to token addresses.
  for (let i = 0; i < reserveList.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tokens: any = {};

    for (let j = 0; j < tokenList.length; j++) {
      const expectedTokenAddress = getContractAddress({
        from: await deployingContract.getAddress(),
        nonce: nonce + j,
      });

      tokens[tokenList[j]] = expectedTokenAddress;
    }

    reserveTokens.set(reserveList[i], tokens);

    // Make sure that the nonce is correct at the start of the next loop
    nonce += tokenList.length;
  }
  return reserveTokens;
}

async function getBlockTimestamps(
  txResponse: ContractTransactionResponse
): Promise<BlockTimestamps> {
  const receipt = await txResponse.wait();

  // Get the block timestamp from the transaction receipt
  let txTimestamp: number;

  if (receipt) {
    const block = await receipt.getBlock();
    if (block) {
      txTimestamp = block.timestamp;
    } else {
      throw new Error("Block is null");
    }
  } else {
    throw new Error("Transaction receipt is null");
  }

  return {
    txTimestamp: BigInt(txTimestamp),
    latestBlockTimestamp: BigInt(await time.latest()),
  };
}

async function simulateAssetPriceCrash(
  underlyingAsset: SampleERC20,
  priceOracle: MeldPriceOracle,
  factor: bigint,
  oracleAdmin: SignerWithAddress
) {
  const [currentPrice, success] = await priceOracle.getAssetPrice(
    await underlyingAsset.getAddress()
  );

  expect(success).to.be.true;

  await priceOracle
    .connect(oracleAdmin)
    .setAssetPrice(await underlyingAsset.getAddress(), currentPrice / factor);

  await priceOracle.getAssetPrice(await underlyingAsset.getAddress());
}

function isAlmostEqual(y: bigint) {
  return function (x: bigint): boolean {
    let almostEqual = false;
    try {
      expect(x).to.be.closeTo(y, 1);
      almostEqual = true;
    } catch (e) {
      console.log("isAlmostEqual: ", e);
    }
    return almostEqual;
  };
}

function switchEnvController() {
  switch (network.name) {
    case "hardhat":
      return ConfigNames.MeldDev;
    case "localhost":
      return ConfigNames.MeldDev;
    case "kanazawa":
      return ConfigNames.MeldTestnet;
    case "meld":
      return ConfigNames.MeldMainnet;
    default:
      throw new Error(
        `Unsupported newtork: ${network.name} is not one of the supported networks`
      );
  }
}

function loadPoolConfigForEnv(): PoolConfiguration {
  const env: ConfigNames = switchEnvController();
  const poolConfig: PoolConfiguration = loadPoolConfig(env);
  return poolConfig;
}

async function createTokensImplementations() {
  const Mtoken = await ethers.getContractFactory("MToken");
  const mToken = await Mtoken.deploy();

  const StableDebtToken = await ethers.getContractFactory("StableDebtToken");
  const stableDebtToken = await StableDebtToken.deploy();

  const VariableDebtToken =
    await ethers.getContractFactory("VariableDebtToken");
  const variableDebtToken = await VariableDebtToken.deploy();

  return {
    mTokenImplAddress: await mToken.getAddress(),
    stableDebtTokenImplAddress: await stableDebtToken.getAddress(),
    variableDebtTokenImplAddress: await variableDebtToken.getAddress(),
  };
}

async function getYBAddresses(
  yieldBoostFactory: YieldBoostFactory,
  createYBInstanceTx: ContractTransactionResponse
) {
  const createYBInstanceRc = await createYBInstanceTx.wait();

  const ybInstanceCreatedTopic = (
    await yieldBoostFactory
      .filters!["YieldBoostInstanceCreated"]()
      .getTopicFilter()
  )[0];
  const unparsedEv = createYBInstanceRc!.logs.find(
    (evInfo) => evInfo.topics[0] == ybInstanceCreatedTopic
  );
  const parsedEv = yieldBoostFactory.interface.parseLog(unparsedEv!);

  return {
    ybStakingAddress: parsedEv!.args[2],
    ybStorageAddress: parsedEv!.args[3],
  };
}

async function getReserveYBContracts(
  reserves: string[],
  meldProtocolDataProvider: MeldProtocolDataProvider
) {
  // loop over reserves to get yield boost staking contracts for the reserves that have them
  const ybStakingContracts = [];
  const ybStorageContracts = [];

  for (const reserve of reserves) {
    const ybStakingAddress =
      await meldProtocolDataProvider.getReserveYieldBoostStaking(reserve);

    const yieldBoostStaking = (await ethers.getContractAt(
      "YieldBoostStaking",
      ybStakingAddress
    )) as YieldBoostStaking & Contract;

    const ybStorageAddress = await yieldBoostStaking.yieldBoostStorageAddress();

    const yieldBoostStorage = (await ethers.getContractAt(
      "YieldBoostStorage",
      ybStorageAddress
    )) as YieldBoostStorage & Contract;

    ybStakingContracts.push(yieldBoostStaking);
    ybStorageContracts.push(yieldBoostStorage);
  }
  return { ybStakingContracts, ybStorageContracts };
}

async function mintMELDBankerNFTs(
  meldBankerNft: MeldBankerNFT,
  bankerAdmin: SignerWithAddress,
  meldBanker: string,
  goldenBanker: string
) {
  // Regular MELD Banker NFT
  const meldBankerTokenId = 1n;
  let golden = false;
  await meldBankerNft
    .connect(bankerAdmin)
    .mint(meldBanker, meldBankerTokenId, golden);

  // Golden MELD Banker NFT
  const goldenBankerTokenId = 2n;
  golden = true;
  await meldBankerNft
    .connect(bankerAdmin)
    .mint(goldenBanker, goldenBankerTokenId, golden);
  return { meldBankerTokenId, goldenBankerTokenId };
}

async function setRewards(
  yieldBoostStorage: YieldBoostStorage,
  yieldBoostStaking: YieldBoostStaking,
  addressesProvider: AddressesProvider,
  rewardsSetter: SignerWithAddress,
  owner: SignerWithAddress,
  asset: SampleERC20,
  meld: SampleERC20
) {
  await allocateAndApproveTokens(
    asset,
    owner,
    rewardsSetter,
    yieldBoostStaking,
    100_000n,
    1n
  );
  await allocateAndApproveTokens(
    meld,
    owner,
    rewardsSetter,
    yieldBoostStaking,
    100_000n,
    1n
  );

  const rewards = {
    assetRewards: await convertToCurrencyDecimals(
      await asset.getAddress(),
      "100"
    ),
    meldRewards: await convertToCurrencyDecimals(
      await meld.getAddress(),
      "3000"
    ),
  };

  await addressesProvider.grantRole(
    await addressesProvider.YB_REWARDS_SETTER_ROLE(),
    rewardsSetter
  );

  // Advance by two epochs
  const lastUpdatedEpoch = await yieldBoostStorage.getLastEpochRewardsUpdated();
  const lastUpdatedTimestamp =
    await yieldBoostStorage.getEpochStart(lastUpdatedEpoch);
  const yieldBoostEpochSize = await yieldBoostStorage.getEpochSize();

  await time.increaseTo(lastUpdatedTimestamp + yieldBoostEpochSize * 2n);

  const currentEpoch = await yieldBoostStorage.getCurrentEpoch();
  const rewardsEpoch = currentEpoch - 1n;

  await yieldBoostStaking
    .connect(rewardsSetter)
    .setRewards(rewards, rewardsEpoch);
}

async function deployProtocolAndGetSignersFixture() {
  const [
    owner,
    poolAdmin,
    oracleAdmin,
    bankerAdmin,
    roleDestroyer,
    treasury,
    depositor,
    depositor2,
    depositor3,
    borrower,
    borrower2,
    borrower3,
    liquidator,
    rando,
    thirdParty,
    delegatee,
    meldBanker,
    goldenBanker,
    rewardsSetter,
    pauser,
    unpauser,
    flInitiator,
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
    roleDestroyer
  );

  return {
    ...contracts,
    owner,
    poolAdmin,
    oracleAdmin,
    bankerAdmin,
    treasury,
    depositor,
    depositor2,
    depositor3,
    borrower,
    borrower2,
    borrower3,
    liquidator,
    rando,
    thirdParty,
    delegatee,
    meldBanker,
    goldenBanker,
    rewardsSetter,
    pauser,
    unpauser,
    flInitiator,
  };
}

async function setUpTestFixture() {
  // Deploy protocol
  const {
    owner,
    poolAdmin,
    oracleAdmin,
    bankerAdmin,
    treasury,
    depositor,
    depositor2,
    depositor3,
    borrower,
    borrower2,
    borrower3,
    liquidator,
    rando,
    thirdParty,
    delegatee,
    meldBanker,
    goldenBanker,
    rewardsSetter,
    pauser,
    unpauser,
    flInitiator,
    ...contracts
  } = await deployProtocolAndGetSignersFixture();

  // Deploy mock asset tokens
  const { usdc, unsupportedToken, meld, tether, dai } =
    await deployMockTokens();

  // Required for staking
  await contracts.addressesProvider.setMeldToken(meld);

  // Call before initializing the reserves
  const expectedReserveTokenAddresses = await calculateTokenAddresses(
    contracts.lendingPoolConfigurator,
    ["USDC", "MELD", "DAI", "USDT"]
  );

  //Initialize reserves
  const reserveInitParams: ReserveInitParams[] = [
    {
      underlyingAsset: usdc,
      interestRateStrategy: contracts.usdcInterestRateStrategy,
    },
    {
      underlyingAsset: meld,
      interestRateStrategy: contracts.meldInterestRateStrategy,
    },
    {
      underlyingAsset: dai,
      interestRateStrategy: contracts.daiInterestRateStrategy,
    },
    {
      underlyingAsset: tether,
      interestRateStrategy: contracts.tetherInterestRateStrategy,
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
      enableStableBorrowing: true,
    },
    {
      underlyingAsset: meld,
      enableBorrowing: true,
      enableStableBorrowing: true,
    },
    {
      underlyingAsset: dai,
      enableBorrowing: true,
      enableStableBorrowing: true,
    },
    {
      underlyingAsset: tether,
      enableBorrowing: true,
      enableStableBorrowing: true,
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

  // Override configured supply cap
  await contracts.lendingPoolConfigurator
    .connect(poolAdmin)
    .setSupplyCapUSD(meld, 1000000000n);

  const ybContracts = await getReserveYBContracts(
    [await usdc.getAddress(), await dai.getAddress()],
    contracts.meldProtocolDataProvider
  );

  const yieldBoostStakingUSDC = ybContracts.ybStakingContracts[0];
  const yieldBoostStorageUSDC = ybContracts.ybStorageContracts[0];
  const yieldBoostStakingDAI = ybContracts.ybStakingContracts[1];
  const yieldBoostStorageDAI = ybContracts.ybStorageContracts[1];

  const { meldBankerTokenId, goldenBankerTokenId } = await mintMELDBankerNFTs(
    contracts.meldBankerNft,
    bankerAdmin,
    meldBanker.address,
    goldenBanker.address
  );

  return {
    ...contracts,
    expectedReserveTokenAddresses,
    yieldBoostStakingUSDC,
    yieldBoostStorageUSDC,
    yieldBoostStakingDAI,
    yieldBoostStorageDAI,
    usdc,
    unsupportedToken,
    meld,
    dai,
    tether,
    owner,
    poolAdmin,
    oracleAdmin,
    bankerAdmin,
    treasury,
    depositor,
    depositor2,
    depositor3,
    borrower,
    borrower2,
    borrower3,
    liquidator,
    rando,
    thirdParty,
    delegatee,
    meldBanker,
    goldenBanker,
    rewardsSetter,
    pauser,
    unpauser,
    flInitiator,
    meldBankerTokenId,
    goldenBankerTokenId,
  };
}

async function prepareSplitSignature(
  token: SampleERC20,
  owner: SignerWithAddress,
  spender: SignerWithAddress,
  value: bigint,
  nonce: bigint,
  deadline: bigint
): Promise<Signature> {
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const tokenName = await token.name();
  const tokenAddress = await token.getAddress();

  const domain = {
    name: tokenName,
    version: "1",
    chainId: chainId,
    verifyingContract: tokenAddress,
  };

  const types = {
    Permit: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };

  const message = {
    owner: await owner.getAddress(),
    spender: await spender.getAddress(),
    value: value,
    nonce: nonce,
    deadline: deadline,
  };

  const signature = await owner.signTypedData(domain, types, message);
  const verifiedAddress = ethers.verifyTypedData(
    domain,
    types,
    message,
    signature
  );
  expect(verifiedAddress).to.be.equal(await owner.getAddress());
  const splitSignature = ethers.Signature.from(signature);

  return splitSignature;
}

const getReservesConfigByPool = (
  pool: MeldPools
): iMultiPoolsAssets<IReserveParams> =>
  getParamPerPool<iMultiPoolsAssets<IReserveParams>>(
    {
      [MeldPools.proto]: {
        ...loadPoolConfig(ConfigNames.MeldDev).ReservesConfig,
      },
    },
    pool
  );

export {
  deployLibraries,
  deployContracts,
  grantRoles,
  deployMockTokens,
  getTokensParams,
  createInitReserveParams,
  initializeReserves,
  configureReservesForBorrowing,
  allocateAndApproveTokens,
  calculateTokenAddresses,
  getBlockTimestamps,
  simulateAssetPriceCrash,
  isAlmostEqual,
  loadPoolConfigForEnv,
  getYBAddresses,
  createTokensImplementations,
  getReserveYBContracts,
  mintMELDBankerNFTs,
  setRewards,
  deployProtocolAndGetSignersFixture,
  setUpTestFixture,
  prepareSplitSignature,
  getReservesConfigByPool,
};
