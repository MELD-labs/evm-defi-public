import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { ILendingPoolConfigurator } from "../typechain-types/contracts/lending/LendingPoolConfigurator";
import { PoolConfiguration } from "../test/helpers/types";
import {
  InitReserveFileParams,
  createInitReserveParams,
  switchEnvController,
} from "./utils";
import { loadPoolConfig } from "../test/helpers/utils/configuration";

type InitReserveInputStruct = ILendingPoolConfigurator.InitReserveInputStruct;

type BigNumberish = string | number | bigint;

type ConfigReserveParams = {
  asset: string;
  reserveFactor: BigNumberish;
  supplyCap: BigNumberish;
  borrowCap: BigNumberish;
  flashLoanLimit: BigNumberish;
  active: boolean;
  frozen: boolean;
  borrowingEnabled: boolean;
  stableBorrowingEnabled: boolean;
  usageAsCollateralEnabled: boolean;
  ltv: BigNumberish;
  liquidationThreshold: BigNumberish;
  liquidationBonus: BigNumberish;
};

task("grantRole", "Grant a role to an address")
  .addParam(
    "addressesprovider",
    "The address of the AddressesProvider contract"
  )
  .addParam("role", "The string of the role to grant")
  .addParam("to", "The address to grant the role to")
  .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
    /**
     * Grant a role to an address
     * The command to run this task is:
     * yarn hardhat grantRole --addressesprovider <ADDRESSES_PROVIDER_ADDRESS> --role <ROLE> --to <ADDRESS> --network <network>
     * Example:
     * yarn hardhat grantRole --addressesprovider 0x1234 --role DEFAULT_ADMIN_ROLE --to 0x4321 --network kanazawa
     */
    const { ethers } = hre;
    const { addressesprovider, role } = taskArgs;
    const toAddress = taskArgs.to;
    const [adminSigner] = await ethers.getSigners();

    const addressesProviderContract = await ethers.getContractAt(
      "AddressesProvider",
      addressesprovider
    );

    if (
      !(await checkRole(
        addressesProviderContract,
        "DEFAULT_ADMIN_ROLE",
        adminSigner.address
      ))
    ) {
      throw new Error("Admin address does not have DEFAULT_ADMIN_ROLE");
    }

    await actRole(
      addressesProviderContract,
      adminSigner,
      role,
      toAddress,
      "grant"
    );

    console.log(
      `Address ${toAddress} has ${role} role: ${await checkRole(
        addressesProviderContract,
        role,
        toAddress
      )}`
    );
  });

task("revokeRole", "Revoke a role from an address")
  .addParam(
    "addressesprovider",
    "The address of the AddressesProvider contract"
  )
  .addParam("role", "The string of the role to revoke")
  .addParam("to", "The address to revoke the role from")
  .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
    /**
     * Revoke a role from an address
     * The command to run this task is:
     * yarn hardhat revokeRole --addressesprovider <ADDRESSES_PROVIDER_ADDRESS> --role <ROLE> --to <ADDRESS> --network <network>
     * Example:
     * yarn hardhat revokeRole --addressesprovider 0x1234 --role PRIMARY_ADMIN_ROLE --to 0x4321 --network kanazawa
     */
    const { ethers } = hre;
    const { addressesprovider, role } = taskArgs;
    const toAddress = taskArgs.to;
    const [adminSigner] = await ethers.getSigners();

    const addressesProviderContract = await ethers.getContractAt(
      "AddressesProvider",
      addressesprovider
    );

    if (adminSigner.address === toAddress) {
      throw new Error(
        "You should not revoke a role from yourself. Use renounceRole instead"
      );
    }

    if (
      !(await checkRole(
        addressesProviderContract,
        "DEFAULT_ADMIN_ROLE",
        adminSigner.address
      ))
    ) {
      throw new Error("Admin address does not have DEFAULT_ADMIN_ROLE");
    }

    await actRole(
      addressesProviderContract,
      adminSigner,
      role,
      toAddress,
      "revoke"
    );

    console.log(
      `Address ${toAddress} has ${role} role: ${await checkRole(
        addressesProviderContract,
        role,
        toAddress
      )}`
    );
  });

task("renounceRole", "Renounce a role from an address")
  .addParam(
    "addressesprovider",
    "The address of the AddressesProvider contract"
  )
  .addParam("role", "The string of the role to renounce")
  .addOptionalParam(
    "backupaddress",
    "In case the role is DEFAULT_ADMIN_ROLE, another admin address (to avoid locking)"
  )
  .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
    /**
     * Renounce a role from an address
     * The command to run this task is:
     * yarn hardhat renounceRole --addressesprovider <ADDRESSES_PROVIDER_ADDRESS> --role <ROLE> --network <network>
     * Example:
     * yarn hardhat renounceRole --addressesprovider 0x1234 --role POOL_ADMIN_ROLE --network meld
     * Note: In case the role to renounce is DEFAULT_ADMIN_ROLE or PRIMARY_ADMIN_ROLE, you need to provide a backup admin address to avoid locking the system
     */
    const { ethers } = hre;
    const { addressesprovider, role } = taskArgs;
    const [signer] = await ethers.getSigners();

    const addressesProviderContract = await ethers.getContractAt(
      "AddressesProvider",
      addressesprovider
    );

    if (role === "DEFAULT_ADMIN_ROLE" || role === "PRIMARY_ADMIN_ROLE") {
      if (!taskArgs.backupaddress) {
        throw new Error(
          "You need to provide a backup admin address to avoid locking the system"
        );
      }
      if (signer.address === taskArgs.backupaddress) {
        throw new Error(
          "You need to provide a different address than the current admin address"
        );
      }
      if (
        !(await checkRole(
          addressesProviderContract,
          "DEFAULT_ADMIN_ROLE",
          taskArgs.backupaddress
        ))
      ) {
        throw new Error("Backup address does not have DEFAULT_ADMIN_ROLE");
      }
    }

    if (!(await checkRole(addressesProviderContract, role, signer.address))) {
      throw new Error(`Signer address does not have ${role} role`);
    }

    await actRole(
      addressesProviderContract,
      signer,
      role,
      signer.address,
      "renounce"
    );

    console.log(
      `Admin address has ${role} role: ${await checkRole(
        addressesProviderContract,
        role,
        signer.address
      )}`
    );
  });

task("checkRole", "Check if an address has a role")
  .addParam(
    "addressesprovider",
    "The address of the AddressesProvider contract"
  )
  .addParam("role", "The string of the role to check")
  .addParam("address", "The address to check")
  .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
    /**
     * Check if an address has a role
     * The command to run this task is:
     * yarn hardhat checkRole --addressesprovider <ADDRESSES_PROVIDER_ADDRESS> --role <ROLE> --address <ADDRESS> --network <network>
     * Example:
     * yarn hardhat checkRole --addressesprovider 0x1234 --role ORACLE_MANAGEMENT_ROLE --address 0x4321 --network kanazawa
     */
    const { ethers } = hre;
    const { addressesprovider, role } = taskArgs;
    const address = taskArgs.address;

    const addressesProviderContract = await ethers.getContractAt(
      "AddressesProvider",
      addressesprovider
    );

    console.log(
      `Address ${address} has ${role} role: ${await checkRole(
        addressesProviderContract,
        role,
        address
      )}`
    );
  });

task("createReserves", "Create new reserves from a configuration file")
  .addParam(
    "addressesprovider",
    "The address of the AddressesProvider contract"
  )
  .addParam("configfile", "The path to the reserves configuration file")
  .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
    /**
     * Create new reserves from a configuration file
     * The command to run this task is:
     * yarn hardhat createReserves --addressesprovider <ADDRESSES_PROVIDER_ADDRESS> --configfile <CONFIG_FILE_PATH> --network <network>
     * Example:
     * yarn hardhat createReserves --addressesprovider 0x1234 --configfile /tmp/reserves.json --network kanazawa
     * The configuration file should be a JSON file with the following structure:
     * [
     *   {
     *      "underlyingAssetAddress": "0x777777FDD5026127F247aa92Ba6dbd0EC882B095",
     *      "treasuryAddress": "0x33333506a912F2602Ff41368aE19db239E7DF184",
     *      "yieldBoostEnabled": true,
     *       "strategy": {
     *        "name": "testRateStrategy",
     *        "optimalUtilizationRate": "900000000000000000000000000",
     *        "baseVariableBorrowRate": "0",
     *         "variableRateSlope1": "70000000000000000000000000",
     *         "variableRateSlope2": "600000000000000000000000000",
     *        "stableRateSlope1": "20000000000000000000000000",
     *         "stableRateSlope2": "600000000000000000000000000"
     *      }
     *     },
     *   ...
     * ]
     */
    const { ethers } = hre;
    const { addressesprovider } = taskArgs;
    const [adminSigner] = await ethers.getSigners();

    const addressesProviderContract = await ethers.getContractAt(
      "AddressesProvider",
      addressesprovider
    );

    const lendingPoolConfigurator =
      await addressesProviderContract.getLendingPoolConfigurator();

    const lendingPoolConfiguratorContract = await ethers.getContractAt(
      "LendingPoolConfigurator",
      lendingPoolConfigurator
    );

    if (
      !(await checkRole(
        addressesProviderContract,
        "POOL_ADMIN_ROLE",
        adminSigner.address
      ))
    ) {
      throw new Error("Admin address does not have POOL_ADMIN_ROLE");
    }

    let configFilePath = taskArgs.configfile;
    if (!configFilePath.startsWith("/")) {
      configFilePath = `${process.cwd()}/${configFilePath}`;
    }

    const reservesConfig = require(configFilePath) as InitReserveFileParams[];

    const allReserveParams: InitReserveInputStruct[] = await buildReserveParams(
      hre,
      addressesprovider,
      reservesConfig
    );

    console.log("Creating reserves...");

    const batchInitReserveTx =
      await lendingPoolConfiguratorContract.batchInitReserve(allReserveParams);

    console.log(
      "Tx hash:",
      batchInitReserveTx.hash,
      "waiting for confirmation..."
    );

    await batchInitReserveTx.wait();

    console.log("Reserves created");
  });

task("getAllReserves", "Get all reserves")
  .addParam(
    "addressesprovider",
    "The address of the AddressesProvider contract"
  )
  .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
    /**
     * Get all reserves
     * The command to run this task is:
     * yarn hardhat getAllReserves --addressesprovider <ADDRESSES_PROVIDER_ADDRESS> --network <network>
     * Example:
     * yarn hardhat getAllReserves --addressesprovider 0x1234 --network kanazawa
     */
    const { ethers } = hre;
    const { addressesprovider } = taskArgs;

    const addressesProviderContract = await ethers.getContractAt(
      "AddressesProvider",
      addressesprovider
    );

    const dataProviderAddress =
      await addressesProviderContract.getProtocolDataProvider();

    const dataProviderContract = await ethers.getContractAt(
      "MeldProtocolDataProvider",
      dataProviderAddress
    );

    const reserves = await dataProviderContract.getAllReservesTokens();

    console.log("Reserves:");
    for (const reserve of reserves) {
      console.log(`- ${reserve[0]} => ${reserve[1]}`);
    }
  });

task("getReserveConfig", "Get the configuration of a reserve")
  .addParam(
    "addressesprovider",
    "The address of the AddressesProvider contract"
  )
  .addParam("asset", "The address of the underlying asset")
  .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
    /**
     * Get the configuration of a reserve
     * The command to run this task is:
     * yarn hardhat getReserveConfig --addressesprovider <ADDRESSES_PROVIDER_ADDRESS> --asset <ASSET_ADDRESS> --network <network>
     * Example:
     * yarn hardhat getReserveConfig --addressesprovider 0x1234 --asset 0x4321 --network kanazawa
     */
    const { ethers } = hre;
    const { addressesprovider, asset } = taskArgs;

    const addressesProviderContract = await ethers.getContractAt(
      "AddressesProvider",
      addressesprovider
    );
    const dataProviderAddress =
      await addressesProviderContract.getProtocolDataProvider();

    const dataProviderContract = await ethers.getContractAt(
      "MeldProtocolDataProvider",
      dataProviderAddress
    );

    await printReserveConfiguration(hre, dataProviderContract, asset);
  });

task("getAllReservesConfig", "Get the configuration of all reserves")
  .addParam(
    "addressesprovider",
    "The address of the AddressesProvider contract"
  )
  .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
    /**
     * Get the configuration of all reserves
     * The command to run this task is:
     * yarn hardhat getAllReservesConfig --addressesprovider <ADDRESSES_PROVIDER_ADDRESS> --network <network>
     * Example:
     * yarn hardhat getAllReservesConfig --addressesprovider 0x1234 --network kanazawa
     */
    const { ethers } = hre;
    const { addressesprovider } = taskArgs;

    const addressesProviderContract = await ethers.getContractAt(
      "AddressesProvider",
      addressesprovider
    );

    const lendingPoolAddress = await addressesProviderContract.getLendingPool();

    const lendingPoolContract = await ethers.getContractAt(
      "LendingPool",
      lendingPoolAddress
    );
    const dataProviderAddress =
      await addressesProviderContract.getProtocolDataProvider();

    const dataProviderContract = await ethers.getContractAt(
      "MeldProtocolDataProvider",
      dataProviderAddress
    );

    const reserves = await lendingPoolContract.getReservesList();

    console.log("reserves ", reserves);

    for (const reserve of reserves) {
      await printReserveConfiguration(hre, dataProviderContract, reserve);
    }
  });

task("setReserveConfig", "Set the configuration of a reserve")
  .addParam(
    "addressesprovider",
    "The address of the AddressesProvider contract"
  )
  .addParam("configfile", "The path to the reserves configuration file")
  .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
    /**
     * Set the configuration of a reserve
     * The command to run this task is:
     * yarn hardhat setReserveConfig --addressesprovider <ADDRESSES_PROVIDER_ADDRESS> --configfile <CONFIG_FILE_PATH> --network <network>
     * Example:
     * yarn hardhat setReserveConfig --addressesprovider 0x1234 --configfile /tmp/reserve_config.json --network kanazawa
     * The configuration file should be a JSON file with the following structure:
     *
     * {
     *   "asset": "0x1234...",
     *   "reserveFactor": 1000,
     *   "supplyCap": 2000000,
     *   "borrowCap": 1000000,
     *   "flashLoanLimit": 1000000,
     *   "active": true,
     *   "frozen": false,
     *   "borrowingEnabled": true,
     *   "stableBorrowingEnabled": true,
     *   "usageAsCollateralEnabled": true,
     *   "ltv": 5000,
     *   "liquidationThreshold": 5500,
     *   "liquidationBonus": 10500
     * }
     * The reserveFactor, ltv, liquidationThreshold and liquidationBonus should be in basis points (1% = 100)
     * The supplyCap, borrowCap and flashLoanLimit should be in USD (full units, no decimals)
     * The active, frozen, borrowingEnabled, stableBorrowingEnabled and usageAsCollateralEnabled should be booleans
     * If a field is not present in the configuration file or its value is null, it will not be updated
     * If usageAsCollateralEnabled is set to false, the value of ltv, liquidationThreshold and liquidationBonus will be set to 0
     * If borrowingEnabled is set to false, the value of stableBorrowingEnabled will be ignored
     * If borrowingEnabled is set to true, the value of stableBorrowingEnabled will be mandatory
     */
    const { ethers } = hre;
    const { addressesprovider } = taskArgs;
    const [adminSigner] = await ethers.getSigners();

    const addressesProviderContract = await ethers.getContractAt(
      "AddressesProvider",
      addressesprovider
    );

    if (
      !(await checkRole(
        addressesProviderContract,
        "POOL_ADMIN_ROLE",
        adminSigner.address
      ))
    ) {
      throw new Error("Admin address does not have POOL_ADMIN_ROLE");
    }

    let configFilePath = taskArgs.configfile;
    if (!configFilePath.startsWith("/")) {
      configFilePath = `${process.cwd()}/${configFilePath}`;
    }
    const reservesConfig = require(configFilePath) as ConfigReserveParams;

    const dataProviderAddress =
      await addressesProviderContract.getProtocolDataProvider();

    const dataProviderContract = await ethers.getContractAt(
      "MeldProtocolDataProvider",
      dataProviderAddress
    );

    const lendingPoolConfigurator =
      await addressesProviderContract.getLendingPoolConfigurator();

    const lendingPoolConfiguratorContract = await ethers.getContractAt(
      "LendingPoolConfigurator",
      lendingPoolConfigurator
    );

    const tokenContract = await ethers.getContractAt(
      "IERC20Metadata",
      reservesConfig.asset
    );

    const name = await tokenContract.name();
    const symbol = await tokenContract.symbol();

    console.log(`=> Setting configuration for ${name} (${symbol})...\n`);

    const reserveData = await dataProviderContract.getReserveConfigurationData(
      reservesConfig.asset
    );

    const reserveFactor = reservesConfig.reserveFactor;
    if (reserveFactor !== null && reserveFactor !== undefined) {
      console.log(
        `- Setting reserve factor: ${valueToPercentage(reserveFactor)}`
      );
      if (reserveFactor == Number(reserveData[4])) {
        console.log("Reserve factor is already set to this value");
      } else {
        const setReserveFactorTx =
          await lendingPoolConfiguratorContract.setReserveFactor(
            reservesConfig.asset,
            reserveFactor
          );
        console.log(
          "Tx hash:",
          setReserveFactorTx.hash,
          "waiting for confirmation..."
        );
        await setReserveFactorTx.wait();
        console.log("Reserve factor set");
      }
      console.log();
    }

    const supplyCap = reservesConfig.supplyCap;
    if (supplyCap !== null && supplyCap !== undefined) {
      console.log(`- Setting supply cap: ${supplyCap}`);
      if (reserveData[5].equals(supplyCap)) {
        console.log("Supply cap is already set to this value");
      } else {
        const setReserveSupplyCapTx =
          await lendingPoolConfiguratorContract.setSupplyCapUSD(
            reservesConfig.asset,
            supplyCap
          );
        console.log(
          "Tx hash:",
          setReserveSupplyCapTx.hash,
          "waiting for confirmation..."
        );
        await setReserveSupplyCapTx.wait();
        console.log("Supply cap set");
      }
      console.log();
    }

    const borrowCap = reservesConfig.borrowCap;
    if (borrowCap !== null && borrowCap !== undefined) {
      console.log(`- Setting borrow cap: ${borrowCap}`);
      if (borrowCap == reserveData[6]) {
        console.log("Borrow cap is already set to this value");
      } else {
        const setReserveBorrowCapTx =
          await lendingPoolConfiguratorContract.setBorrowCapUSD(
            reservesConfig.asset,
            borrowCap
          );
        console.log(
          "Tx hash:",
          setReserveBorrowCapTx.hash,
          "waiting for confirmation..."
        );
        await setReserveBorrowCapTx.wait();
        console.log("Supply cap set");
      }
      console.log();
    }

    const flashLoanLimit = reservesConfig.flashLoanLimit;
    if (flashLoanLimit !== null && flashLoanLimit !== undefined) {
      console.log(`- Setting flash loan limit: ${flashLoanLimit}`);
      if (flashLoanLimit == reserveData[7]) {
        console.log("Flash loan limit is already set to this value");
      } else {
        const setReserveFlashLoanLimitTx =
          await lendingPoolConfiguratorContract.setFlashLoanLimitUSD(
            reservesConfig.asset,
            flashLoanLimit
          );
        console.log(
          "Tx hash:",
          setReserveFlashLoanLimitTx.hash,
          "waiting for confirmation..."
        );
        await setReserveFlashLoanLimitTx.wait();
        console.log("Flash loan limit set");
      }
      console.log();
    }

    const active = reservesConfig.active;
    if (active !== null && active !== undefined) {
      console.log(`- Setting active: ${active}`);
      if (active == reserveData[9]) {
        console.log("Active is already set to this value");
      } else {
        let setReserveActivationTx;
        if (active) {
          setReserveActivationTx =
            await lendingPoolConfiguratorContract.activateReserve(
              reservesConfig.asset
            );
        } else {
          setReserveActivationTx =
            await lendingPoolConfiguratorContract.deactivateReserve(
              reservesConfig.asset
            );
        }
        console.log(
          "Tx hash:",
          setReserveActivationTx.hash,
          "waiting for confirmation..."
        );
        await setReserveActivationTx.wait();
        console.log("Active set");
      }
      console.log();
    }

    const frozen = reservesConfig.frozen;
    if (frozen !== null && frozen !== undefined) {
      console.log(`- Setting frozen: ${frozen}`);
      if (frozen == reserveData[10]) {
        console.log("Frozen is already set to this value");
      } else {
        let setReserveFrozenTx;
        if (frozen) {
          setReserveFrozenTx =
            await lendingPoolConfiguratorContract.freezeReserve(
              reservesConfig.asset
            );
        } else {
          setReserveFrozenTx =
            await lendingPoolConfiguratorContract.unfreezeReserve(
              reservesConfig.asset
            );
        }
        console.log(
          "Tx hash:",
          setReserveFrozenTx.hash,
          "waiting for confirmation..."
        );
        await setReserveFrozenTx.wait();
        console.log("Frozen set");
      }
      console.log();
    }

    const stableBorrowingEnabled = reservesConfig.stableBorrowingEnabled;

    let borrowingEnabledTxSent = false;
    const borrowingEnabled = reservesConfig.borrowingEnabled;
    if (borrowingEnabled !== null && borrowingEnabled !== undefined) {
      console.log(`- Setting borrowing enabled: ${borrowingEnabled}`);
      if (borrowingEnabled == reserveData[11]) {
        console.log("Borrowing enabled is already set to this value");
      } else {
        let setBorrowingEnabledTx;
        if (borrowingEnabled) {
          console.log(
            `Also setting stable borrowing enabled: ${stableBorrowingEnabled}`
          );
          setBorrowingEnabledTx =
            await lendingPoolConfiguratorContract.enableBorrowingOnReserve(
              reservesConfig.asset,
              stableBorrowingEnabled
            );
        } else {
          setBorrowingEnabledTx =
            await lendingPoolConfiguratorContract.disableBorrowingOnReserve(
              reservesConfig.asset
            );
        }
        borrowingEnabledTxSent = true;
        console.log(
          "Tx hash:",
          setBorrowingEnabledTx.hash,
          "waiting for confirmation..."
        );
        await setBorrowingEnabledTx.wait();
        console.log("Borrowing enabled set");
      }
      console.log();
    }

    if (
      !borrowingEnabledTxSent && // If a enableBorrowingOnReserve or disableBorrowingOnReserve tx was sent, we don't need to send this one
      !reserveData[11] && // Also if borrowing is already disabled, we don't need to send this tx
      stableBorrowingEnabled !== null &&
      stableBorrowingEnabled !== undefined
    ) {
      console.log(
        `- Setting stable borrowing enabled: ${stableBorrowingEnabled}`
      );
      if (stableBorrowingEnabled == reserveData[12]) {
        console.log("Stable borrowing enabled is already set to this value");
      } else {
        let setStableBorrowingEnabledTx;
        if (stableBorrowingEnabled) {
          setStableBorrowingEnabledTx =
            await lendingPoolConfiguratorContract.enableReserveStableRate(
              reservesConfig.asset
            );
        } else {
          setStableBorrowingEnabledTx =
            await lendingPoolConfiguratorContract.disableReserveStableRate(
              reservesConfig.asset
            );
        }
        console.log(
          "Tx hash:",
          setStableBorrowingEnabledTx.hash,
          "waiting for confirmation..."
        );
        await setStableBorrowingEnabledTx.wait();
        console.log("Stable borrowing enabled set");
      }
      console.log();
    }

    const usageAsCollateralEnabled = reservesConfig.usageAsCollateralEnabled;
    if (
      usageAsCollateralEnabled !== null &&
      usageAsCollateralEnabled !== undefined
    ) {
      console.log(
        `- Setting usage as collateral enabled: ${usageAsCollateralEnabled}`
      );
      const ltv = reservesConfig.ltv ?? reserveData[1];
      const liquidationThreshold =
        reservesConfig.liquidationThreshold ?? reserveData[2];
      const liquidationBonus =
        reservesConfig.liquidationBonus ?? reserveData[3];

      if (
        usageAsCollateralEnabled == reserveData[8] && // If usage as collateral is already set to this value
        (!usageAsCollateralEnabled || // and it's being disabled
          (ltv == reserveData[1] && // OR it's being enabled but the LTV, liquidation threshold and liquidation bonus are already set to the same values
            liquidationThreshold == reserveData[2] &&
            liquidationBonus == reserveData[3]))
      ) {
        console.log("Usage as collateral enabled is already set to this value");
      } else {
        let configureReserveAsCollateralTx;
        if (!usageAsCollateralEnabled) {
          configureReserveAsCollateralTx =
            await lendingPoolConfiguratorContract.configureReserveAsCollateral(
              reservesConfig.asset,
              0,
              0,
              0
            );
        } else {
          console.log("Also setting");
          console.log(`- LTV: ${valueToPercentage(ltv)}`);
          console.log(
            `- Liquidation threshold: ${valueToPercentage(
              liquidationThreshold
            )}`
          );
          console.log(
            `- Liquidation bonus: ${valueToPercentage(liquidationBonus)}`
          );
          configureReserveAsCollateralTx =
            await lendingPoolConfiguratorContract.configureReserveAsCollateral(
              reservesConfig.asset,
              ltv,
              liquidationThreshold,
              liquidationBonus
            );
        }
        console.log(
          "Tx hash:",
          configureReserveAsCollateralTx.hash,
          "waiting for confirmation..."
        );
        await configureReserveAsCollateralTx.wait();
        console.log("Usage as collateral enabled set");
      }
      console.log();
    }

    console.log("Configuration set!");
  });

async function checkRole(
  contract: any,
  role: string,
  address: string
): Promise<boolean> {
  const roleCode = await contract[role]();
  return await contract.hasRole(roleCode, address);
}

export async function actRole(
  contract: any,
  adminSigner: any,
  role: string,
  address: string,
  action: string
) {
  const functionName = `${action}Role`;
  console.log(`Attempting to ${action} role ${role} to ${address}`);
  const roleCode = await contract[role]();
  const actionRoleTx = await contract
    .connect(adminSigner)
    [functionName](roleCode, address);
  console.log("Tx hash:", actionRoleTx.hash, "waiting for confirmation...");
  await actionRoleTx.wait();
}

async function buildReserveParams(
  hre: HardhatRuntimeEnvironment,
  addressesProvider: string,
  reserveConfigs: InitReserveFileParams[]
): Promise<InitReserveInputStruct[]> {
  // Create a map to store deployed strategies
  const deployedRateStrategies: { [key: string]: any } = {};
  let reserveInterestRateStrategy;
  let reserveInterestRateStrategyAddress: string;
  const reserveInitParams: InitReserveInputStruct[] = [];

  console.log("Deploy and configure interest rate strategies ... ");

  const rateStrategyCF = await hre.ethers.getContractFactory(
    "DefaultReserveInterestRateStrategy"
  );

  const poolConfig: PoolConfiguration = loadPoolConfig(
    switchEnvController(hre.network.name)
  );

  // Loop through assets
  for (const reserveConfig of reserveConfigs) {
    const strategy = reserveConfig.strategy;

    // Check if the strategy has already been deployed in the current run
    if (!deployedRateStrategies[strategy.name]) {
      console.log(
        "Deploying %s Interest Rate Strategy with values %s",
        strategy.name,
        strategy
      );

      // Deploy DefaultReserveInterestRateStrategy instance

      reserveInterestRateStrategy = await rateStrategyCF.deploy(
        addressesProvider,
        strategy.optimalUtilizationRate,
        strategy.baseVariableBorrowRate,
        strategy.variableRateSlope1,
        strategy.variableRateSlope2,
        strategy.stableRateSlope1,
        strategy.stableRateSlope2
      );

      reserveInterestRateStrategyAddress =
        await reserveInterestRateStrategy.getAddress();

      // Store the deployed strategy in the map
      deployedRateStrategies[strategy.name] =
        reserveInterestRateStrategyAddress;
      console.log(
        "DefaultReserveInterestRateStrategy addresses: ",
        deployedRateStrategies
      );
    } else {
      reserveInterestRateStrategyAddress =
        deployedRateStrategies[strategy.name];
      console.log(
        `Using existing ${strategy.name} Interest Rate Strategy at address ${reserveInterestRateStrategyAddress}`
      );
    }

    reserveInitParams.push(
      await createInitReserveParams(
        hre,
        poolConfig,
        reserveInterestRateStrategyAddress,
        reserveConfig.underlyingAssetAddress,
        reserveConfig.treasuryAddress,
        reserveConfig.yieldBoostEnabled
      )
    );
  }
  return reserveInitParams;
}

async function printReserveConfiguration(
  hre: HardhatRuntimeEnvironment,
  dataProviderContract: any,
  asset: string
) {
  const reserveData =
    await dataProviderContract.getReserveConfigurationData(asset);

  const yieldBoostStakingAddr =
    await dataProviderContract.getReserveYieldBoostStaking(asset);

  const yieldBoostEnabled = yieldBoostStakingAddr != hre.ethers.ZeroAddress;

  const tokenContract = await hre.ethers.getContractAt("IERC20Metadata", asset);

  const name = await tokenContract.name();
  const symbol = await tokenContract.symbol();

  const supplyCapStr = reserveData[5] == 0n ? "None" : reserveData[5] + " USD";
  const borrowCapStr = reserveData[6] == 0n ? "None" : reserveData[6] + " USD";
  const flashLoanLimitStr =
    reserveData[7] == 0n ? "None" : reserveData[7] + " USD";

  console.log(
    `=> Reserve configuration for "${name}" (${symbol}) - ${asset}\n`
  );
  console.log(`- Decimals: ${reserveData[0]}`);
  console.log(`- LTV: ${valueToPercentage(reserveData[1])}`);
  console.log(`- Liquidation threshold: ${valueToPercentage(reserveData[2])}`);
  console.log(`- Liquidation bonus: ${valueToPercentage(reserveData[3])}`);
  console.log(`- Reserve factor: ${valueToPercentage(reserveData[4])}`);
  console.log(`- Supply cap: ${supplyCapStr}`);
  console.log(`- Borrow cap: ${borrowCapStr}`);
  console.log(`- Flash loan limit: ${flashLoanLimitStr}`);
  console.log(`- Usage as collateral enabled: ${reserveData[8]}`);
  console.log(`- Reserve active: ${reserveData[9]}`);
  console.log(`- Reserve frozen: ${reserveData[10]}`);
  console.log(`- Borrowing enabled: ${reserveData[11]}`);
  console.log(`- Stable borrowing enabled: ${reserveData[12]}`);
  console.log(`- Yield boost enabled: ${yieldBoostEnabled}`);
  console.log("\n");
}

function valueToPercentage(value: BigNumberish): string {
  return (parseFloat(value.toString()) / 100).toFixed(2) + "%";
}
