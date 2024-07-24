import { task } from "hardhat/config";
import * as fs from "fs";
import path from "path";
import { HardhatRuntimeEnvironment } from "hardhat/types";

task("verifyAll", "Verify smart contracts")
  .addOptionalParam(
    "deploymentfile",
    "The path to a file with the contracts addresses and args"
  )
  /**
   * This task will verify all contracts available. If the `deploymentfile` is provided, it will use the addresses
   * and args from the file, otherwise it will use the addresses and args from the last deployment.
   * The file should be a JSON file following the format of the deployments file, e.g.:
   * {
   *   ...,  // Other fields
   *   "contracts": {
   *     "ContractName": {
   *      "address": "0x1234567890...",
   *      "args": ["arg1", "arg2"]
   *     },
   *     "AnotherContractName": {
   *       "address": "0x0987654321..."
   *     }
   *   }
   * }
   * The `args` field is optional and should be an array of strings.
   * To use this task, run `yarn hardhat verifyAll (--deploymentfile path/to/deploymentfile.json) --network networkName`
   * Examples:
   * - `yarn hardhat verifyAll --network kanazawa`
   * - `yarn hardhat verifyAll --deploymentfile deplyoments/meld/Protocol/2024-05-23T13-57-24.294Z/deployment.json --network meld`
   */
  .setAction(async (taskArgs, hre) => {
    let contractsInfo;
    let infoFilePath = taskArgs.deploymentfile;

    if (infoFilePath) {
      if (!infoFilePath.startsWith("/")) {
        infoFilePath = path.join(process.cwd(), infoFilePath);
      }
    } else {
      const networkName = hre.network.name;
      // Get last deployment file. Path is `deployments/${networkName}/Protocol/${datetime}/deployment.json`
      const deploymentsPath = path.join(
        process.cwd(),
        "deployments",
        networkName,
        "Protocol"
      );
      // Get the last datetime folder
      const datetimeFolders = fs.readdirSync(deploymentsPath);
      const lastDatetimeFolder = datetimeFolders[datetimeFolders.length - 1];
      infoFilePath = path.join(
        deploymentsPath,
        lastDatetimeFolder,
        "deployment.json"
      );
    }

    console.log("Info file path: ", infoFilePath);

    const fileInfo = require(infoFilePath);
    contractsInfo = fileInfo.contracts;

    if (!contractsInfo) {
      console.log("No contracts to verify");
      return;
    }
    console.log("");
    for (const contractName of Object.keys(contractsInfo)) {
      if (contractsInfo[contractName].proxyData) {
        console.log(`${contractName} is a proxy. Verifying proxy...`);
        await verifyProxy(
          hre,
          contractName,
          contractsInfo[contractName].address,
          [contractsInfo[contractName].proxyData.implAddress, "0x"]
        );
        console.log(`Verifying implementation...`);
        await verify(
          hre,
          contractName,
          contractsInfo[contractName].proxyData.implAddress
        );
      } else {
        await verify(
          hre,
          contractName,
          contractsInfo[contractName].address,
          contractsInfo[contractName].args
        );
      }
    }

    if (contractsInfo["LendingPoolConfigurator"]) {
      const lendingPoolConfigurator = await hre.ethers.getContractAt(
        "LendingPoolConfigurator",
        contractsInfo["LendingPoolConfigurator"].address
      );
      await verify(hre, "MToken", await lendingPoolConfigurator.mTokenImpl());
      await verify(
        hre,
        "StableDebtToken",
        await lendingPoolConfigurator.stableDebtTokenImpl()
      );
      await verify(
        hre,
        "VariableDebtToken",
        await lendingPoolConfigurator.variableDebtTokenImpl()
      );
    }

    if (contractsInfo["YieldBoostFactory"]) {
      const yieldBoostFactory = await hre.ethers.getContractAt(
        "YieldBoostFactory",
        contractsInfo["YieldBoostFactory"].address
      );
      await verify(
        hre,
        "YieldBoostStaking",
        await yieldBoostFactory.ybStakingImpl(),
        [await yieldBoostFactory.addressesProvider()]
      );
      await verify(
        hre,
        "YieldBoostStorage",
        await yieldBoostFactory.ybStorageImpl()
      );
    }
  });

async function verify(
  hre: HardhatRuntimeEnvironment,
  contractName: string,
  address: string,
  args: any[] = []
) {
  console.log("=> Verifying contract:", contractName);
  try {
    await hre.run("verify:verify", {
      address,
      constructorArguments: args,
    });
  } catch (error) {
    console.error(error);
  }
  console.log("");
}

async function verifyProxy(
  hre: HardhatRuntimeEnvironment,
  contractName: string,
  address: string,
  args: any[] = []
) {
  console.log("=> Verifying proxy for:", contractName);
  try {
    await hre.run("verify:verify", {
      contract:
        "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy",
      address,
      constructorArguments: args,
    });
  } catch (error) {
    console.error(error);
  }
  console.log("");
}
