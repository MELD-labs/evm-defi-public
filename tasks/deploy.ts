import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment, Libraries } from "hardhat/types";
import {
  BaseContract,
  BigNumberish,
  Contract,
  ContractTransactionResponse,
  TransactionResponse,
} from "ethers";
import * as fs from "fs";
import path from "path";
import { loadPoolConfig } from "../test/helpers/utils/configuration";
import {
  IInterestRateStrategyParams,
  IReserveParams,
  PoolConfiguration,
  iMultiPoolsAssets,
  tEthereumAddress,
} from "../test/helpers/types";
import {
  AddressesProvider,
  DefaultReserveInterestRateStrategy,
  ERC20,
  ILendingPoolConfigurator,
  LendingRateOracleAggregator,
  MeldBankerNFT,
  MeldPriceOracle,
  PriceOracleAggregator,
  SupraOracleAdapter,
} from "../typechain-types";
import { ReserveConfigParams } from "../test/helpers/interfaces";
import { createInitReserveParams, switchEnvController } from "./utils";
import { deployDeterministically, getInitCode, getVaddAddress } from "./vadd";

type DeployedContract = BaseContract & {
  deploymentTransaction(): TransactionResponse;
};

type MeldBankerData = {
  meldBankerNFTData: ExportDeploymentInputData;
  meldBankerNFTMetadataData: ExportDeploymentInputData;
};

type ProxyData = {
  implAddress: string;
  implTransactionHash: string;
  initializeArgs: any[];
  vaddData?: VaddData;
};

type VaddData = {
  salt: string;
  deploymentTx: string;
};

type ExportDeploymentInputData = {
  contractName: string;
  contractInstance: DeployedContract;
  args: any[];
  alias?: string; // optional alias for the contract, used if multiple instances of the same contract are deployed
  proxyData?: ProxyData;
  vaddData?: VaddData;
};

type ExportAddressDeploymentData = {
  [contractName: string]: string;
};

type ContractDeploymentData = {
  address: string;
  transactionHash: string;
  sourceName: string;
  args: any[];
  abi: any;
  proxyData?: ProxyData;
  vaddData?: VaddData;
};

type FullExportDeploymentData = {
  network: string;
  chainId: number;
  commitHash: string;
  datetime: string;
  contracts: {
    [contractName: string]: ContractDeploymentData;
  };
  clonedContracts?: ClonedContractsData;
};

type TokensExportData = {
  [symbol: string]: TokenExportData;
};

type TokenExportData = {
  address: string;
  clonedContracts: ClonedContractsAddresses;
};

type ClonedContractsAddresses = {
  MToken: tEthereumAddress;
  StableDebtToken: tEthereumAddress;
  VariableDebtToken: tEthereumAddress;
  YieldBoostStaking?: tEthereumAddress;
  YieldBoostStorage?: tEthereumAddress;
};

type ClonedContractData = {
  sourceName: string;
  addresses: {
    [symbol: string]: tEthereumAddress;
  };
  abi: any;
};

type ClonedContractsData = {
  MToken: ClonedContractData;
  StableDebtToken: ClonedContractData;
  VariableDebtToken: ClonedContractData;
  YieldBoostStaking?: ClonedContractData;
  YieldBoostStorage?: ClonedContractData;
};

type SaltsObject = {
  [contractName: string]: string;
};

const getAddr = async (exportData: ExportDeploymentInputData) =>
  await exportData.contractInstance.getAddress();

task("deployMeldBankerNFT", "Deploys the MeldBankerNFT contract")
  .addParam(
    "addressesprovider",
    "The address of the AddressesProvider contract"
  )
  .addOptionalParam(
    "salt",
    "The salt to use to deploy the contract deterministically"
  )
  .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
    /**
     * Deploy the MeldBankerNFT contract
     * The command to run this task is:
     * yarn hardhat deployMeldBankerNFT --addressesprovider <ADDRESSES_PROVIDER_ADDRESS> --network <network>
     * Example:
     * yarn hardhat deployMeldBankerNFT --addressesprovider 0x1234 --network kanazawa
     *
     * If you want to deploy the contract deterministically, you can provide a salt
     * yarn hardhat deployMeldBankerNFT --addressesprovider 0x1234 --salt 1234 --network kanazawa
     *
     * This will create two files in the folder `./deployments/<network>/MeldBankerNFT/<datetime>/`:
     * - addresses.json: contains the address of the deployed contract
     * - deployment.json: contains the deployment information (address, transaction hash, abi, args)
     */

    const { addressesprovider, salt } = taskArgs;

    const exportData = await deployContract(
      hre,
      "MeldBankerNFT",
      [addressesprovider],
      salt
    );

    await exportDeploymentInfo(hre, "MeldBankerNFT", [exportData]);
  });

task("deployProtocol", "Deploys the L&B protocol contracts")
  .addOptionalParam(
    "saltsfile",
    "If provided, the file containing the salts make some of the deployments deterministic"
  )
  .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
    /**
     * Deploy the L&B protocol contracts
     * The command to run this task is:
     * yarn hardhat deployProtocol --network <network>
     * Example:
     * yarn hardhat deployProtocol --network kanazawa
     *
     * If you want to deploy the protocol with deterministic addresses, you can provide a file with salts
     * yarn hardhat deployProtocol --network kanazawa --saltsfile <saltsfile>
     * Example:
     * yarn hardhat deployProtocol --network kanazawa --saltsfile salts.json
     *
     * The salts file should be a JSON file with the following format:
     * {
     *  "AddressesProvider": "1234",
     *  "MeldProtocolDataProvider": "5678",
     * }
     *
     * The contracts deployed with proxy (LendingPool and LendingPoolConfigurator) cannot be deployed deterministically
     *
     * This will create three files in the folder `./deployments/<network>/Protocol/<datetime>/`:
     * - addresses.json: contains the address of the deployed contracts
     * - deployment.json: contains the deployment information such as network, chainId, commit hash, datetime
     *   and information of every contract (address, transaction hash, abi, args, abi)
     * - supportedTokens.json: contains the addresses of the supported tokens of the protocol, including the address of each token
     *   and the addresses of the cloned contracts (MToken, StableDebtToken, VariableDebtToken, YieldBoostStaking, YieldBoostStorage)
     */

    const { ethers } = hre;

    const networkName = hre.network.name;
    const chainId = hre.network.config.chainId;

    const saltsFile = taskArgs.saltsfile;
    let salts: SaltsObject = {};
    if (saltsFile) {
      salts = JSON.parse(fs.readFileSync(saltsFile, "utf8"));
    }

    const env =
      networkName == "hardhat" || networkName == "localhost"
        ? "dev"
        : networkName;
    console.log("env: ", env);

    const poolConfig: PoolConfiguration = loadPoolConfig(
      switchEnvController(networkName)
    );

    let txReponse: ContractTransactionResponse;

    if (env == "dev") {
      console.log("\n=> Deploying Mocks...\n");

      const tokensData = await deployMockTokens(hre);
      const mockSupraSValueFeedData = await deployContract(
        hre,
        "MockSupraSValueFeed",
        [],
        salts["MockSupraSValueFeed"]
      );
      const mockMeldStakingStorageData = await deployContract(
        hre,
        "MockMeldStakingStorage",
        [],
        salts["MockMeldStakingStorage"]
      );
      await exportDeploymentInfo(hre, "Mocks", [
        ...tokensData,
        mockSupraSValueFeedData,
        mockMeldStakingStorageData,
      ]);

      poolConfig.MeldStakingStorageAddress = await getAddr(
        mockMeldStakingStorageData
      );

      poolConfig.SupraOracleFeedAddress = await getAddr(
        mockSupraSValueFeedData
      );

      const newReserveAssets: iMultiPoolsAssets<string> = {};
      for (const symbol of Object.keys(poolConfig.ReserveAssets)) {
        const tokenData = tokensData.find(
          (tokenData) => tokenData.alias === symbol
        );
        newReserveAssets[symbol] = await getAddr(tokenData!);
      }
      poolConfig.ReserveAssets = newReserveAssets;

      console.log("");
    }

    const {
      ReserveAssets,
      ReserveFactorTreasuryAddress,
      SupraOracleFeedAddress,
      MeldStakingStorageAddress,
      MeldBankerNFTAddress,
    } = poolConfig;

    const exportData: ExportDeploymentInputData[] = [];

    const [deployer] = await ethers.getSigners();
    console.log("Deployer address: %s", deployer.address);
    console.log("Treasury address: %s", ReserveFactorTreasuryAddress);
    console.log("SupraOracle Feed address: ", SupraOracleFeedAddress);
    console.log("Network %s and chainId %s", hre.network.name, chainId);

    const { librariesData, libraries } = await deployLibraries(
      hre,
      salts["libraries"]
    );

    console.log("\n=> Deploying Contracts...\n");

    // ADDRESSES PROVIDER
    const addressesProviderData = await deployContract(
      hre,
      "AddressesProvider",
      [deployer.address],
      salts["AddressesProvider"]
    );

    exportData.push(addressesProviderData);

    const addressesProviderAddr = await getAddr(addressesProviderData);
    const addressesProvider =
      addressesProviderData.contractInstance as AddressesProvider;

    // LENDING POOL
    const lendingPoolData = await deployProxy(
      hre,
      "LendingPool",
      [addressesProviderAddr],
      libraries,
      salts["proxy-LendingPool"],
      salts["LendingPool"]
    );

    exportData.push(lendingPoolData);

    const lendingPoolAddress = await getAddr(lendingPoolData);

    // LENDING POOL CONFIGURATOR

    const mTokenImplAddress = await getAddr(
      await deployContract(hre, "MToken", [], salts["MToken"])
    );
    const stableDebtTokenImplAddress = await getAddr(
      await deployContract(hre, "StableDebtToken", [], salts["StableDebtToken"])
    );
    const variableDebtTokenImplAddress = await getAddr(
      await deployContract(
        hre,
        "VariableDebtToken",
        [],
        salts["VariableDebtToken"]
      )
    );

    const lendingPoolConfiguratorData = await deployProxy(
      hre,
      "LendingPoolConfigurator",
      [
        addressesProviderAddr,
        lendingPoolAddress,
        mTokenImplAddress,
        stableDebtTokenImplAddress,
        variableDebtTokenImplAddress,
      ],
      {},
      salts["proxy-LendingPoolConfigurator"],
      salts["LendingPoolConfigurator"]
    );

    exportData.push(lendingPoolConfiguratorData);

    // MELD LENDING RATE ORACLE
    const meldLendingRateOracleData = await deployContract(
      hre,
      "MeldLendingRateOracle",
      [addressesProviderAddr],
      salts["MeldLendingRateOracle"]
    );

    exportData.push(meldLendingRateOracleData);

    // LENDING RATE ORACLE AGGREGATOR
    const lendingRateOracleAggregatorData = await deployContract(
      hre,
      "LendingRateOracleAggregator",
      [addressesProviderAddr],
      salts["LendingRateOracleAggregator"]
    );

    exportData.push(lendingRateOracleAggregatorData);

    const lendingRateOracleAggregator =
      lendingRateOracleAggregatorData.contractInstance as LendingRateOracleAggregator;

    // MELD PRICE ORACLE
    const meldPriceOracleData = await deployContract(
      hre,
      "MeldPriceOracle",
      [addressesProviderAddr],
      salts["MeldPriceOracle"]
    );

    exportData.push(meldPriceOracleData);

    // SUPRA ORACLE ADAPTER
    const supraOracleAdapterData = await deployContract(
      hre,
      "SupraOracleAdapter",
      [addressesProviderAddr, SupraOracleFeedAddress],
      salts["SupraOracleAdapter"]
    );

    exportData.push(supraOracleAdapterData);

    // PRICE ORACLE AGGREGATOR
    const priceOracleAggregatorData = await deployContract(
      hre,
      "PriceOracleAggregator",
      [addressesProviderAddr],
      salts["PriceOracleAggregator"]
    );

    exportData.push(priceOracleAggregatorData);

    const priceOracleAggregator =
      priceOracleAggregatorData.contractInstance as PriceOracleAggregator;

    // YIELD BOOST FACTORY

    txReponse = await addressesProvider.setMeldStakingStorage(
      MeldStakingStorageAddress
    );
    await txReponse.wait();

    const yieldBoostFactoryData = await deployContract(
      hre,
      "YieldBoostFactory",
      [addressesProviderAddr],
      salts["YieldBoostFactory"]
    );

    exportData.push(yieldBoostFactoryData);

    // MELD PROTOCOL DATA PROVIDER
    const meldProtocolDataProviderData = await deployContract(
      hre,
      "MeldProtocolDataProvider",
      [addressesProviderAddr],
      salts["MeldProtocolDataProvider"]
    );

    exportData.push(meldProtocolDataProviderData);

    console.log("\n=> Configuring protocol...");

    console.log("\n  => Granting roles...\n");

    await hre.run("grantRole", {
      addressesprovider: addressesProviderAddr,
      role: "POOL_ADMIN_ROLE",
      to: deployer.address,
    });

    await hre.run("grantRole", {
      addressesprovider: addressesProviderAddr,
      role: "ORACLE_MANAGEMENT_ROLE",
      to: deployer.address,
    });

    await hre.run("grantRole", {
      addressesprovider: addressesProviderAddr,
      role: "BNKR_NFT_MINTER_BURNER_ROLE",
      to: deployer.address,
    });

    console.log("Done");

    console.log("\n  => Setting AddressProvider addresses...\n");

    txReponse = await priceOracleAggregator.setPriceOracleList([
      await getAddr(supraOracleAdapterData),
      await getAddr(meldPriceOracleData),
    ]);
    await txReponse.wait();

    txReponse = await lendingRateOracleAggregator.setLendingRateOracleList([
      await getAddr(meldLendingRateOracleData),
    ]);
    await txReponse.wait();

    txReponse = await addressesProvider.setLendingRateOracle(
      await getAddr(lendingRateOracleAggregatorData)
    );
    await txReponse.wait();

    txReponse = await addressesProvider.setPriceOracle(
      await getAddr(priceOracleAggregatorData)
    );
    await txReponse.wait();

    txReponse = await addressesProvider.setYieldBoostFactory(
      await getAddr(yieldBoostFactoryData)
    );
    await txReponse.wait();

    txReponse = await addressesProvider.setMeldToken(ReserveAssets["MELD"]);
    await txReponse.wait();

    txReponse = await addressesProvider.setProtocolDataProvider(
      await getAddr(meldProtocolDataProviderData)
    );
    await txReponse.wait();

    txReponse = await addressesProvider.setLendingPool(lendingPoolAddress);
    await txReponse.wait();

    txReponse = await addressesProvider.setLendingPoolConfigurator(
      await getAddr(lendingPoolConfiguratorData)
    );
    await txReponse.wait();

    console.log("Done");

    const allMeldBankerNFTData = await manageMeldBankerNFT(
      hre,
      addressesProvider,
      MeldBankerNFTAddress,
      salts
    );

    exportData.push(...Object.values(allMeldBankerNFTData));

    const rateStrategiesData = await initAndConfigReserves(
      hre,
      addressesProviderAddr,
      poolConfig,
      await ethers.getContractAt(
        "LendingPoolConfigurator",
        await getAddr(lendingPoolConfiguratorData)
      ),
      await getAddr(supraOracleAdapterData),
      await getAddr(meldPriceOracleData),
      await getAddr(meldLendingRateOracleData)
    );

    exportData.push(...rateStrategiesData);

    console.log(
      "Protocol deployed and configured successfully using token addresses:\n - %s",
      Object.entries(ReserveAssets)
        .map(([key, value]) => `${key}: ${value}`)
        .join("\n - ")
    );

    exportData.push(...librariesData);

    const tokensExportData: TokensExportData = await populateTokensExportData(
      hre,
      ReserveAssets,
      await getAddr(meldProtocolDataProviderData)
    );

    await exportDeploymentInfo(hre, "Protocol", exportData, tokensExportData);

    if (networkName == "kanazawa" || networkName == "meld") {
      console.log(
        "Consider verifying the contracts with the following command:"
      );
      console.log(`yarn verify:${networkName}`);
    }
  });

task("deployMockTokens", "Deploys mock tokens").setAction(
  async (_, hre: HardhatRuntimeEnvironment) => {
    /**
     * Deploy mock tokens
     * The command to run this task is:
     * yarn hardhat deployMockTokens --network <network>
     * Example:
     * yarn hardhat deployMockTokens --network kanazawa
     */

    const mocksExportData = await deployMockTokens(hre);

    await exportDeploymentInfo(hre, "MockTokens", mocksExportData);
  }
);

task(
  "getLibrariesAddresses",
  "Get expected addresses of libraries given a salt"
)
  .addParam("salt", "The salt to use to deploy the libraries")
  .addOptionalParam(
    "exportfile",
    "The path to export the libraries addresses as JSON"
  )
  .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
    /**
     * This task gets the expected addresses of the libraries given a salt.
     * Parameters:
     * - salt: The salt to use to deploy the libraries
     * Usage:
     * `yarn hardhat getLibrariesAddresses --salt <salt>`
     */
    const salt = taskArgs.salt;

    console.log("Getting addresses of libraries with salt", salt, "...");

    const libraries = await getLibrariesAddresses(hre, salt);

    console.log("Addresses:", libraries);

    const exportFile = taskArgs.exportfile;
    if (exportFile) {
      fs.writeFileSync(exportFile, JSON.stringify(libraries, null, 2));
      console.log("Addresses exported to", exportFile);
    }
  });

task(
  "getLendingPoolInitCode",
  "Get the init code hash of the LendingPool implementation contract given the salt for the libraries"
)
  .addParam("salt", "The salt to use to deploy the libraries")
  .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
    /**
     * This task gets the init code hash of the LendingPool implementation contract given the salt for the libraries
     * Parameters:
     * - salt: The salt to use to deploy the libraries
     * Usage:
     * `yarn hardhat getLendingPoolInitCode --salt <salt>`
     */
    const salt = taskArgs.salt;
    const libraries = await getLibrariesAddresses(hre, salt);
    const initCode = await getInitCode(hre, "LendingPool", [], libraries);
    const initCodeHash = hre.ethers.keccak256(initCode);
    console.log("initCodeHash:", initCodeHash);
  });

task(
  "getProxyInitCode",
  "Gets the init code hash of the ERC1967Proxy given the information of the implementation"
)
  .addParam("contract", "The name of the contract")
  .addParam("impladdress", "The address of the implementation contract")
  .addOptionalParam("librariesfile", "The path to the libraries file")
  .addOptionalVariadicPositionalParam(
    "initArgs",
    "The arguments of the initialize function"
  )
  .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
    /**
     * This task gets the init code hash of the ERC1967Proxy given the information of the implementation
     * Parameters:
     * - contract: The name of the implementation contract
     * - impladdress: The calculated expected address of the implementation contract
     * - librariesfile: The path to the libraries file if the implementation requires libraries (optional)
     * - initArgs: The arguments of the initialize function (optional)
     * The libraries file should be a JSON file with the following format:
     * {
     * "library1Name": "library1Address"
     * "library2Name": "library2Address"
     * ...
     * }
     *  Usage:
     * `yarn hardhat getProxyInitCode --contract <contract> --impladdress <impladdress> (--librariesfile <libraries-json-file>) (<initArgs>)`
     * Example:
     * `yarn hardhat getProxyInitCode --contract LendingPool --impladdress 0x1234 --librariesfile libraries.json 0x4321`
     */
    const contractName = taskArgs.contract;
    const implAddress = taskArgs.impladdress;
    const initArgs = taskArgs.initArgs || [];

    const librariesPath = taskArgs.librariesfile;
    let libraries: Libraries = {};
    if (librariesPath) {
      const librariesFile = path.resolve(librariesPath);
      libraries = JSON.parse(fs.readFileSync(librariesFile, "utf8"));
      console.log("Using libraries:", libraries);
    }
    const initializeData = await getProxyInitializeData(
      hre,
      contractName,
      initArgs,
      libraries
    );

    const initCode = await getInitCode(hre, "ERC1967Proxy", [
      implAddress,
      initializeData,
    ]);
    const initCodeHash = hre.ethers.keccak256(initCode);
    console.log("initCodeHash:", initCodeHash);
  });

async function initAndConfigReserves(
  hre: HardhatRuntimeEnvironment,
  addressesProviderAddr: string,
  poolConfig: PoolConfiguration,
  lendingPoolConfigurator: ILendingPoolConfigurator,
  supraOracleAdapterAddr: string,
  meldPriceOracleAddr: string,
  meldLendingRateOracleAddr: string
): Promise<ExportDeploymentInputData[]> {
  const { rateStrategiesData, initReserveInputArrays, reserveConfigParams } =
    await getStrategiesAndReserveParams(hre, addressesProviderAddr, poolConfig);

  await initializeReserves(initReserveInputArrays, lendingPoolConfigurator);

  await configReserves(
    hre,
    poolConfig,
    lendingPoolConfigurator,
    supraOracleAdapterAddr,
    meldPriceOracleAddr,
    meldLendingRateOracleAddr,
    reserveConfigParams
  );

  return rateStrategiesData;
}

async function configReserves(
  hre: HardhatRuntimeEnvironment,
  poolConfig: PoolConfiguration,
  lendingPoolConfigurator: ILendingPoolConfigurator,
  supraOracleAdapterAddr: string,
  meldPriceOracleAddr: string,
  meldLendingRateOracleAddr: string,
  reserveConfigParams: ReserveConfigParams[]
) {
  const { LendingRateOracleRatesCommon, ReserveAssets, ReservesConfig } =
    poolConfig;

  const meldPriceOracle = await hre.ethers.getContractAt(
    "MeldPriceOracle",
    meldPriceOracleAddr
  );
  const supraOracleAdapter = await hre.ethers.getContractAt(
    "SupraOracleAdapter",
    supraOracleAdapterAddr
  );
  const meldLendingRateOracle = await hre.ethers.getContractAt(
    "MeldLendingRateOracle",
    meldLendingRateOracleAddr
  );

  let txResponse, symbolKey;

  for (const reserveConfigParam of reserveConfigParams) {
    const underlyingAssetAddr =
      await reserveConfigParam.underlyingAsset.getAddress();
    symbolKey = Object.keys(ReserveAssets).find(
      (key) =>
        ReserveAssets[key as keyof typeof ReserveAssets] === underlyingAssetAddr
    ) as keyof typeof ReserveAssets;
    console.log(`\n  => Configuring ${symbolKey}...\n`);

    const reserveConfig = ReservesConfig[symbolKey] as IReserveParams;

    // Prices
    await setPrices(
      underlyingAssetAddr,
      symbolKey!,
      supraOracleAdapter,
      meldPriceOracle,
      poolConfig
    );

    // Borrow rates
    const borrowRate = LendingRateOracleRatesCommon[symbolKey]!.borrowRate;
    if (!borrowRate) {
      txResponse = await meldLendingRateOracle.setMarketBorrowRate(
        underlyingAssetAddr,
        LendingRateOracleRatesCommon[symbolKey]!.borrowRate
      );
      console.log(
        "Setting borrow rate on MeldLendingRateOracle...",
        txResponse.hash
      );
      await txResponse.wait();
    } else {
      console.log("No borrow rate provided");
    }

    // Enable borrowing
    if (reserveConfigParam.enableBorrowing) {
      txResponse = await lendingPoolConfigurator.enableBorrowingOnReserve(
        underlyingAssetAddr,
        reserveConfigParam.enableStableBorrowing
      );
      console.log(
        "Enabling borrowing on LendingPoolConfigurator...",
        txResponse.hash
      );
      await txResponse.wait();
    } else {
      console.log("Borrowing disabled for this reserve");
    }

    // Set reserve factor
    txResponse = await lendingPoolConfigurator.setReserveFactor(
      underlyingAssetAddr,
      reserveConfig.reserveFactor
    );
    console.log(
      "Setting reserve factor on LendingPoolConfigurator...",
      txResponse.hash
    );
    await txResponse.wait();

    // Set collateral config
    txResponse = await lendingPoolConfigurator.configureReserveAsCollateral(
      underlyingAssetAddr,
      reserveConfig.baseLTVAsCollateral,
      reserveConfig.liquidationThreshold,
      reserveConfig.liquidationBonus
    );
    console.log(
      "Setting collateral config on LendingPoolConfigurator...",
      txResponse.hash
    );
    await txResponse.wait();

    // Set supply cap
    txResponse = await lendingPoolConfigurator.setSupplyCapUSD(
      underlyingAssetAddr,
      reserveConfig.supplyCapUSD
    );
    console.log(
      "Setting supply cap on LendingPoolConfigurator...",
      txResponse.hash
    );
    await txResponse.wait();

    // Set borrow cap
    txResponse = await lendingPoolConfigurator.setBorrowCapUSD(
      underlyingAssetAddr,
      reserveConfig.borrowCapUSD
    );
    console.log(
      "Setting borrow cap on LendingPoolConfigurator...",
      txResponse.hash
    );
    await txResponse.wait();

    // Set flash loan limit
    txResponse = await lendingPoolConfigurator.setFlashLoanLimitUSD(
      underlyingAssetAddr,
      reserveConfig.flashLoanLimitUSD
    );
    console.log(
      "Setting flash loan limit on LendingPoolConfigurator...",
      txResponse.hash
    );
    await txResponse.wait();

    console.log(`Reserve ${symbolKey} configured`);
  }
  console.log("\nAll reserves configured\n");
}

async function setPrices(
  assetAddr: string,
  symbolKey: string,
  supraOracleAdapter: SupraOracleAdapter,
  meldPriceOracle: MeldPriceOracle,
  poolConfig: PoolConfiguration
) {
  const {
    Mocks: { AllAssetsInitialPrices },
    SupraPricePairPaths,
  } = poolConfig;

  let txResponse;

  // Set price on MeldPriceOracle
  const meldPrice = AllAssetsInitialPrices[symbolKey];
  if (meldPrice) {
    txResponse = await meldPriceOracle.setAssetPrice(
      assetAddr,
      AllAssetsInitialPrices[symbolKey]
    );
    console.log("Setting price on MeldPriceOracle...", txResponse.hash);
    await txResponse.wait();
  }

  if (await supraOracleAdapter.getDeployedCode()) {
    // Set pair paths for the SupraOracleAdapter
    txResponse = await supraOracleAdapter.setPairPath(
      assetAddr,
      SupraPricePairPaths[symbolKey]
    );
    console.log(
      `Setting pair path ${SupraPricePairPaths[symbolKey]} on SupraOracleAdapter...${txResponse.hash}`
    );
    await txResponse.wait();
  }
}

async function initializeReserves(
  reserveParamsArray: ILendingPoolConfigurator.InitReserveInputStruct[],
  lendingPoolConfigurator: ILendingPoolConfigurator
) {
  console.log("\n  => Initializing reserves...\n");
  const transactionResponse =
    await lendingPoolConfigurator.batchInitReserve(reserveParamsArray);

  console.log(`BatchInitReserve transaction hash: ${transactionResponse.hash}`);

  await transactionResponse.wait();

  console.log("Done");
}

async function getStrategiesAndReserveParams(
  hre: HardhatRuntimeEnvironment,
  addressesProviderAddr: string,
  poolConfig: PoolConfiguration
): Promise<{
  rateStrategiesData: ExportDeploymentInputData[];
  initReserveInputArrays: ILendingPoolConfigurator.InitReserveInputStruct[];
  reserveConfigParams: ReserveConfigParams[];
}> {
  const { ReserveAssets, ReservesConfig, ReserveFactorTreasuryAddress } =
    poolConfig;

  const reserveConfigParams: ReserveConfigParams[] = [];
  const deployedRateStrategies: { [key: string]: tEthereumAddress } = {};
  const rateStrategiesData: ExportDeploymentInputData[] = [];

  console.log("\n  => Deploy and configure interest rate strategies...\n");

  // Initialize paramter that will be an array of ILendingPoolConfigurator.InitReserveInputStruct
  const initReserveInputArrays: ILendingPoolConfigurator.InitReserveInputStruct[] =
    [];

  // Loop through assets
  for (const [symbol, params] of Object.entries(ReservesConfig)) {
    const { strategy, ...reserveParams } = params;

    const reserveInterestRateStrategy = await getOrDeployStrategy(
      hre,
      addressesProviderAddr,
      strategy,
      deployedRateStrategies,
      rateStrategiesData
    );

    const reserveStrategyAddr = await reserveInterestRateStrategy.getAddress();

    console.log(`Configuring ${symbol} reserve with params`, reserveParams);
    console.log(
      `and interest rate strategy ${strategy.name} at address ${reserveStrategyAddr}`
    );

    // Filter ReservesAssets by symbol
    const reserveAsset = ReserveAssets[symbol as keyof typeof ReserveAssets];

    if (!reserveAsset) {
      throw new Error(`Reserve asset for symbol ${symbol} is undefined`);
    }

    const underlyingAsset = (await hre.ethers.getContractAt(
      "ERC20",
      reserveAsset
    )) as ERC20 & Contract;

    const initReserveInputArray: ILendingPoolConfigurator.InitReserveInputStruct =
      await createInitReserveParams(
        hre,
        poolConfig,
        reserveStrategyAddr,
        reserveAsset,
        ReserveFactorTreasuryAddress,
        params.yieldBoostEnabled
      );
    initReserveInputArrays.push(initReserveInputArray);

    // Push to ReserveConfigParams array
    reserveConfigParams.push({
      underlyingAsset: underlyingAsset,
      enableBorrowing: params.borrowingEnabled,
      enableStableBorrowing: params.stableBorrowRateEnabled,
    });
  } // End of for loop

  console.log(
    "DefaultReserveInterestRateStrategy addresses: ",
    deployedRateStrategies
  );

  return {
    rateStrategiesData,
    initReserveInputArrays,
    reserveConfigParams,
  };
}

async function getOrDeployStrategy(
  hre: HardhatRuntimeEnvironment,
  addressesProviderAddr: string,
  strategy: IInterestRateStrategyParams,
  deployedRateStrategies: { [key: string]: any },
  rateStrategiesData: ExportDeploymentInputData[]
): Promise<DefaultReserveInterestRateStrategy> {
  let reserveInterestRateStrategy;
  // Check if the strategy has already been deployed
  if (!deployedRateStrategies[strategy.name]) {
    console.log(
      `Deploying ${strategy.name} Interest Rate Strategy with values`,
      strategy
    );

    // Deploy DefaultReserveInterestRateStrategy instance

    const strategyData = await deployContract(
      hre,
      "DefaultReserveInterestRateStrategy",
      [
        addressesProviderAddr,
        strategy.optimalUtilizationRate,
        strategy.baseVariableBorrowRate,
        strategy.variableRateSlope1,
        strategy.variableRateSlope2,
        strategy.stableRateSlope1,
        strategy.stableRateSlope2,
      ]
    );

    strategyData.alias = strategy.name;

    rateStrategiesData.push(strategyData);

    // Store the deployed strategy in the map
    deployedRateStrategies[strategy.name] = await getAddr(strategyData);
    reserveInterestRateStrategy =
      strategyData.contractInstance as DefaultReserveInterestRateStrategy &
        Contract;
  } else {
    const strategyAddr = deployedRateStrategies[strategy.name];
    console.log(
      `Using existing ${strategy.name} Interest Rate Strategy at address ${strategyAddr}`
    );

    reserveInterestRateStrategy = (await hre.ethers.getContractAt(
      "DefaultReserveInterestRateStrategy",
      strategyAddr
    )) as DefaultReserveInterestRateStrategy & Contract;
  }
  return reserveInterestRateStrategy;
}

async function manageMeldBankerNFT(
  hre: HardhatRuntimeEnvironment,
  addressesProvider: AddressesProvider,
  meldBankerNFTAddress: string | undefined,
  salts: SaltsObject
): Promise<MeldBankerData> {
  console.log("  \n=> Managing MeldBankerNFT...\n");
  let meldBankerNFT: MeldBankerNFT;
  let txReponse: ContractTransactionResponse;
  const addressesProviderAddr = await addressesProvider.getAddress();

  if (meldBankerNFTAddress) {
    // Checking if provided MeldBankerNFT address is valid
    meldBankerNFT = (await hre.ethers.getContractAt(
      "MeldBankerNFT",
      meldBankerNFTAddress!
    )) as MeldBankerNFT;

    if (!(await meldBankerNFT.getDeployedCode())) {
      console.log(
        "ERROR! Provided MeldBankerNFT address is not a valid contract address"
      );
      console.log("Will deploy a new MeldBankerNFT contract instead.");
      meldBankerNFTAddress = undefined;
    }
  }

  const allMeldBankerData = {} as MeldBankerData;
  if (!meldBankerNFTAddress) {
    // Deploy MeldBankerNFT if not provided
    console.log("No valid MeldBankerNFT address provided, deploying...");
    const meldBankerNFTData = await deployContract(
      hre,
      "MeldBankerNFT",
      [addressesProviderAddr],
      salts["MeldBankerNFT"]
    );
    meldBankerNFT = meldBankerNFTData.contractInstance as MeldBankerNFT;

    const meldBankerMetadataData = await deployContract(
      hre,
      "MeldBankerNFTMetadata",
      [addressesProviderAddr],
      salts["MeldBankerNFTMetadata"]
    );

    txReponse = await meldBankerNFT.setMetadataAddress(
      await getAddr(meldBankerMetadataData)
    );
    await txReponse.wait();

    meldBankerNFTAddress = await getAddr(meldBankerNFTData);

    allMeldBankerData.meldBankerNFTData = meldBankerNFTData;
    allMeldBankerData.meldBankerNFTMetadataData = meldBankerMetadataData;
  } else {
    // Using provided MeldBankerNFT address
    console.log("Using provided MeldBankerNFT address", meldBankerNFTAddress);

    allMeldBankerData.meldBankerNFTData = {
      contractName: "MeldBankerNFT",
      contractInstance: meldBankerNFT! as DeployedContract,
      args: [addressesProviderAddr],
    };

    txReponse = await meldBankerNFT!.updateAddressesProvider(
      addressesProviderAddr
    );
    await txReponse.wait();

    // Adapt Metadata

    const meldBankerNFTMetadata = await hre.ethers.getContractAt(
      "MeldBankerNFTMetadata",
      await meldBankerNFT!.nftMetadata()
    );

    allMeldBankerData.meldBankerNFTMetadataData = {
      contractName: "MeldBankerNFTMetadata",
      contractInstance: meldBankerNFTMetadata as DeployedContract,
      args: [addressesProviderAddr],
    };

    try {
      txReponse = await meldBankerNFTMetadata.updateAddressesProvider(
        addressesProviderAddr
      );
      await txReponse.wait();
    } catch (e) {
      console.log("===========================");
      console.log("Error updating MeldBankerNFTMetadata");
      console.log(e);
      console.log(`
        This might be due to the contract not having the updateAddressesProvider function
        Or current signer not having the required role to call the function
        If the contract does not have the function, please deploy a version of the contract that has it and migrate the metadata
        If the signer does not have the required role, please call the function manually with a signer that has the required role
      `);
      console.log("===========================");
    }
  }

  txReponse = await addressesProvider.setMeldBankerNFT(meldBankerNFTAddress);
  await txReponse.wait();

  const lendingPool = await hre.ethers.getContractAt(
    "LendingPool",
    await addressesProvider.getLendingPool()
  );

  txReponse = await lendingPool.setMeldBankerNFT();
  await txReponse.wait();

  console.log("Done");

  return allMeldBankerData;
}

async function populateClonedContract(
  hre: HardhatRuntimeEnvironment,
  tokensExportData: TokensExportData,
  contractName: string
): Promise<ClonedContractData> {
  const artifact = await hre.artifacts.readArtifact(contractName);

  const contractData: ClonedContractData = {
    sourceName: artifact.sourceName,
    addresses: {},
    abi: artifact.abi,
  };

  const tokenAddresses = {} as { [symbol: string]: tEthereumAddress };

  for (const [tokenSymbol, tokenData] of Object.entries(tokensExportData)) {
    const address =
      tokenData.clonedContracts[contractName as keyof ClonedContractsAddresses];
    if (address) {
      tokenAddresses[tokenSymbol] = address;
    }
  }
  contractData.addresses = tokenAddresses;

  return contractData;
}

async function populateClonedContracts(
  hre: HardhatRuntimeEnvironment,
  tokensExportData: TokensExportData
): Promise<ClonedContractsData> {
  const clonedContractsData = {
    MToken: await populateClonedContract(hre, tokensExportData, "MToken"),
    StableDebtToken: await populateClonedContract(
      hre,
      tokensExportData,
      "StableDebtToken"
    ),
    VariableDebtToken: await populateClonedContract(
      hre,
      tokensExportData,
      "VariableDebtToken"
    ),
    YieldBoostStaking: await populateClonedContract(
      hre,
      tokensExportData,
      "YieldBoostStaking"
    ),
    YieldBoostStorage: await populateClonedContract(
      hre,
      tokensExportData,
      "YieldBoostStorage"
    ),
  };

  return clonedContractsData;
}

async function populateTokensExportData(
  hre: HardhatRuntimeEnvironment,
  ReserveAssets: iMultiPoolsAssets<string>,
  dataProviderAddr: string
): Promise<TokensExportData> {
  const dataProvider = await hre.ethers.getContractAt(
    "MeldProtocolDataProvider",
    dataProviderAddr
  );
  const tokensExportData: TokensExportData = {};

  for (const [symbol, address] of Object.entries(ReserveAssets)) {
    const { mTokenAddress, stableDebtTokenAddress, variableDebtTokenAddress } =
      await dataProvider.getReserveTokensAddresses(address);

    const clonedContracts: ClonedContractsAddresses = {
      MToken: mTokenAddress,
      StableDebtToken: stableDebtTokenAddress,
      VariableDebtToken: variableDebtTokenAddress,
    };

    const yieldBoostStakingAddress =
      await dataProvider.getReserveYieldBoostStaking(address);
    if (yieldBoostStakingAddress !== hre.ethers.ZeroAddress) {
      clonedContracts.YieldBoostStaking = yieldBoostStakingAddress;
      const yieldBoostStaking = await hre.ethers.getContractAt(
        "YieldBoostStaking",
        yieldBoostStakingAddress
      );
      clonedContracts.YieldBoostStorage =
        await yieldBoostStaking.yieldBoostStorageAddress();
    }

    tokensExportData[symbol] = {
      address: address,
      clonedContracts,
    };
  }
  return tokensExportData;
}

async function deployLibraries(
  hre: HardhatRuntimeEnvironment,
  salt: BigNumberish | undefined = undefined
) {
  const { ethers } = hre;

  console.log("\n=> Deploying libraries...\n");

  const librariesData: ExportDeploymentInputData[] = [];

  const deployLibraryClasically = async (
    name: string,
    libraries: Libraries = {}
  ) => {
    const libraryFactory = await ethers.getContractFactory(name, { libraries });
    const library = await libraryFactory.deploy();
    await confirmDeployment(name, library);

    librariesData.push({
      contractName: name,
      contractInstance: library as DeployedContract,
      args: [],
    });
    return await library.getAddress();
  };

  const deployLibraryDeterministically = async (
    name: string,
    libraries: Libraries = {}
  ) => {
    const { txHash, address } = await deployDeterministically(
      hre,
      parseInt(salt!.toString()),
      name,
      [],
      false,
      libraries
    );

    const libraryFactory = await ethers.getContractFactory(name, { libraries });

    librariesData.push({
      contractName: name,
      contractInstance: libraryFactory.attach(address) as DeployedContract,
      args: [],
      vaddData: {
        salt: salt!.toString(),
        deploymentTx: txHash,
      },
    });

    return address;
  };

  let deployLibrary =
    salt === undefined
      ? deployLibraryClasically
      : deployLibraryDeterministically;

  const genericLogicAddress = await deployLibrary("GenericLogic");
  const gLibraries = {
    GenericLogic: genericLogicAddress,
  };
  const reserveLogicAddress = await deployLibrary("ReserveLogic");
  const validationLogicAddress = await deployLibrary(
    "ValidationLogic",
    gLibraries
  );
  const liquidationLogicAddress = await deployLibrary(
    "LiquidationLogic",
    gLibraries
  );
  const borrowLogicAddress = await deployLibrary("BorrowLogic", gLibraries);
  const depositLogicAddress = await deployLibrary("DepositLogic");
  const flashLoanLogicAddress = await deployLibrary("FlashLoanLogic");
  const withdrawLogicAddress = await deployLibrary("WithdrawLogic", gLibraries);
  const repayLogicAddress = await deployLibrary("RepayLogic");
  const yieldBoostLogicAddress = await deployLibrary("YieldBoostLogic");

  console.log("");

  return {
    librariesData,
    libraries: {
      ...gLibraries,
      ReserveLogic: reserveLogicAddress,
      ValidationLogic: validationLogicAddress,
      LiquidationLogic: liquidationLogicAddress,
      BorrowLogic: borrowLogicAddress,
      DepositLogic: depositLogicAddress,
      FlashLoanLogic: flashLoanLogicAddress,
      WithdrawLogic: withdrawLogicAddress,
      RepayLogic: repayLogicAddress,
      YieldBoostLogic: yieldBoostLogicAddress,
    },
  };
}

export async function getLibrariesAddresses(
  hre: HardhatRuntimeEnvironment,
  salt: BigNumberish
) {
  salt = parseInt(salt.toString());

  const getLibraryAddress = async (name: string, libraries: Libraries = {}) => {
    const initCode = await getInitCode(hre, name, [], libraries);
    const initCodeHash = hre.ethers.keccak256(initCode);
    return getVaddAddress(hre, salt, initCodeHash);
  };

  const genericLogicAddress = await getLibraryAddress("GenericLogic");
  const gLibraries = {
    GenericLogic: genericLogicAddress,
  };
  const reserveLogicAddress = await getLibraryAddress("ReserveLogic");
  const validationLogicAddress = await getLibraryAddress(
    "ValidationLogic",
    gLibraries
  );
  const liquidationLogicAddress = await getLibraryAddress(
    "LiquidationLogic",
    gLibraries
  );
  const borrowLogicAddress = await getLibraryAddress("BorrowLogic", gLibraries);
  const depositLogicAddress = await getLibraryAddress("DepositLogic");
  const flashLoanLogicAddress = await getLibraryAddress("FlashLoanLogic");
  const withdrawLogicAddress = await getLibraryAddress(
    "WithdrawLogic",
    gLibraries
  );
  const repayLogicAddress = await getLibraryAddress("RepayLogic");
  const yieldBoostLogicAddress = await getLibraryAddress("YieldBoostLogic");

  return {
    ...gLibraries,
    ReserveLogic: reserveLogicAddress,
    ValidationLogic: validationLogicAddress,
    LiquidationLogic: liquidationLogicAddress,
    BorrowLogic: borrowLogicAddress,
    DepositLogic: depositLogicAddress,
    FlashLoanLogic: flashLoanLogicAddress,
    WithdrawLogic: withdrawLogicAddress,
    RepayLogic: repayLogicAddress,
    YieldBoostLogic: yieldBoostLogicAddress,
  };
}

async function deployMockTokens(
  hre: HardhatRuntimeEnvironment
): Promise<ExportDeploymentInputData[]> {
  const { ethers } = hre;

  const tokenFactory = await ethers.getContractFactory("SampleERC20");

  const initialSupply = {
    6: 1000000 * 10 ** 6,
    18: ethers.parseEther("1000000").toString(),
  };

  let allArgs = [
    ["USD Coin", "USDC", 6, initialSupply[6]],
    ["Unsupported Token", "UT", 6, initialSupply[6]],
    ["Meld", "MELD", 18, initialSupply[18]],
    ["Tether USD", "USDT", 18, initialSupply[18]],
    ["Dai Stablecoin", "DAI", 18, initialSupply[18]],
  ];

  const mocksExportData: ExportDeploymentInputData[] = [];

  for (let i = 0; i < allArgs.length; i++) {
    const args = allArgs[i];
    const token = await tokenFactory.deploy(
      args[0] as string,
      args[1] as string,
      args[2] as BigNumberish,
      args[3] as BigNumberish
    );
    await confirmDeployment(args[1] as string, token);

    mocksExportData.push({
      contractName: "SampleERC20",
      contractInstance: token as DeployedContract,
      args: args,
      alias: args[1] as string,
    });
  }
  return mocksExportData;
}

async function getProxyInitializeData(
  hre: HardhatRuntimeEnvironment,
  contractName: string,
  args: any[],
  libraries: Libraries = {}
): Promise<string> {
  const { ethers } = hre;

  const implFactory = await ethers.getContractFactory(contractName, {
    libraries,
  });

  const contractInterface = implFactory.interface;

  const initializeFunction = contractInterface.getFunction("initialize");

  if (!initializeFunction) {
    throw new Error("initialize function not found in the contract interface");
  }
  const initializeData = contractInterface.encodeFunctionData(
    initializeFunction,
    args
  );
  return initializeData;
}

async function deployProxy(
  hre: HardhatRuntimeEnvironment,
  contractName: string,
  args: any[],
  libraries: Libraries = {},
  saltProxy: string | undefined = undefined,
  saltImpl: string | undefined = undefined
): Promise<ExportDeploymentInputData> {
  console.log(`Deploying proxy for ${contractName}...`);
  const initializeData = await getProxyInitializeData(
    hre,
    contractName,
    args,
    libraries
  );

  const implDeploymentData = await deployContract(
    hre,
    contractName,
    [],
    saltImpl,
    libraries
  );

  const impl = implDeploymentData.contractInstance;

  let implDeploymentHash = "unknown";
  if (impl.deploymentTransaction()) {
    implDeploymentHash = impl.deploymentTransaction()!.hash;
  } else if (implDeploymentData.vaddData) {
    implDeploymentHash = implDeploymentData.vaddData.deploymentTx;
  }

  const exportData = await deployContract(
    hre,
    "ERC1967Proxy",
    [await impl.getAddress(), initializeData],
    saltProxy
  );
  exportData.contractName = contractName;
  exportData.args = [];
  exportData.proxyData = {
    implAddress: await impl.getAddress(),
    implTransactionHash: implDeploymentHash,
    initializeArgs: args,
  };
  if (implDeploymentData.vaddData) {
    exportData.proxyData.vaddData = implDeploymentData.vaddData;
  }
  return exportData;
}

async function deployContract(
  hre: HardhatRuntimeEnvironment,
  contractName: string,
  args: any[],
  salt: string | undefined = undefined,
  libraries: Libraries = {}
): Promise<ExportDeploymentInputData> {
  const { ethers } = hre;

  const contractFactory = await ethers.getContractFactory(contractName, {
    libraries,
  });

  let contract;

  let exportData: ExportDeploymentInputData = {
    contractName: contractName,
    args: args,
    contractInstance: {} as DeployedContract,
  };

  if (salt) {
    const { address, txHash } = await deployDeterministically(
      hre,
      parseInt(salt),
      contractName,
      args,
      true,
      libraries
    );
    contract = contractFactory.attach(address as string);
    exportData.vaddData = {
      salt: salt,
      deploymentTx: txHash as string,
    };
    console.log(`Deploying ${contractName} deterministically...`, txHash);
    console.log(`${contractName} deployed at:`, address);
  } else {
    contract = await contractFactory.deploy(...args);
    await confirmDeployment(contractName, contract);
  }

  exportData.contractInstance = contract as DeployedContract;

  return exportData;
}

async function confirmDeployment(
  contractName: string,
  contractInstance: DeployedContract
) {
  const tx = contractInstance.deploymentTransaction();
  if (tx) {
    console.log(`Deploying ${contractName}...`, tx.hash);
    await tx.wait();
    console.log(
      `${contractName} deployed at:`,
      await contractInstance.getAddress()
    );
  } else {
    throw new Error(`Failed to deploy ${contractName}`);
  }
  console.log("");
}

async function exportDeploymentInfo(
  hre: HardhatRuntimeEnvironment,
  category: string,
  contracts: ExportDeploymentInputData[],
  supportedTokens?: TokensExportData
) {
  console.log(`\nExporting deployment info for "${category}"...`);
  const artifacts = hre.artifacts;
  const networkName = hre.network.name;
  const datetime = new Date().toISOString().replace(/:/g, "-");
  const deploymentFolder = path.join(
    __dirname,
    "../deployments",
    networkName,
    category,
    datetime
  );
  fs.mkdirSync(deploymentFolder, { recursive: true });

  // get github commit hash
  let commitHash = "";
  try {
    commitHash = require("child_process")
      .execSync("git rev-parse HEAD")
      .toString()
      .trim();
  } catch (e) {
    console.error(e);
    commitHash = "unknown";
  }

  const chainId = await hre.getChainId();

  const fullObject: FullExportDeploymentData = {
    network: networkName,
    chainId: parseInt(chainId),
    commitHash: commitHash,
    datetime: datetime,
    contracts: {},
  };
  const addresses: ExportAddressDeploymentData = {};

  for (const contract of contracts) {
    const contractName = contract.contractName;
    const contractInstance = contract.contractInstance;
    const args = contract.args;

    const alias = contract.alias || contractName;

    const artifact = await artifacts.readArtifact(contractName);

    const contractData: ContractDeploymentData = {
      address: await contractInstance.getAddress(),
      transactionHash: contractInstance.deploymentTransaction()
        ? contractInstance.deploymentTransaction()!.hash
        : "unknown",
      sourceName: artifact.sourceName,
      args: args,
      abi: artifact.abi,
    };

    if (contract.proxyData) {
      contractData.proxyData = contract.proxyData;
    }

    if (contract.vaddData) {
      contractData.vaddData = contract.vaddData;
    }

    fullObject.contracts[alias] = contractData;
    addresses[alias] = contractData.address;
  }

  if (supportedTokens) {
    const supportedTokensFilePath = path.join(
      deploymentFolder,
      "supportedTokens.json"
    );
    fs.writeFileSync(
      supportedTokensFilePath,
      JSON.stringify(supportedTokens, null, 2)
    );

    console.log("Supported tokens info saved to", supportedTokensFilePath);

    fullObject.clonedContracts = await populateClonedContracts(
      hre,
      supportedTokens
    );
  }

  const deploymentFilePath = path.join(deploymentFolder, "deployment.json");
  const addressesFilePath = path.join(deploymentFolder, "addresses.json");
  fs.writeFileSync(deploymentFilePath, JSON.stringify(fullObject, null, 2));
  console.log("Deployment info saved to", deploymentFilePath);
  fs.writeFileSync(addressesFilePath, JSON.stringify(addresses, null, 2));
  console.log("Addresses saved to", addressesFilePath);
}
