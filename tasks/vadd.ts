import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment, Libraries } from "hardhat/types";
import { SEAPORT_FACTORY_ADDRESS, SEAPORT_FACTORY_ABI } from "../constants";

task("initCode", "Get init code hash of any contract")
  .addParam("contract", "The name of the contract")
  .addOptionalParam("librariesfile", "The path to the libraries file")
  .addOptionalVariadicPositionalParam(
    "constructorArgs",
    "The constructor arguments"
  )
  .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
    /**
     * This task gets the init code hash of a contract.
     * Parameters:
     * - contract: The name of the contract
     * - librariesfile: The path to the libraries file (optional)
     * - constructorArgs: The constructor arguments (optional)
     * The libraries file should be a JSON file with the following format:
     * {
     *  "library1Name": "library1Address"
     *  "library2Name": "library2Address"
     *   ...
     * }
     * Usage:
     * `yarn hardhat initCode --contract <contract> (--librariesfile <libraries-json-file>) (<constructorArgs>)`
     */
    const { contract } = taskArgs;

    console.log("Getting init code hash of contract", contract);

    const constructorArgs = taskArgs.constructorArgs || [];

    const librariesPath = taskArgs.librariesfile;
    let libraries: Libraries = {};
    if (librariesPath) {
      libraries = readLibrariesFromFile(librariesPath);
      console.log("Using libraries:", libraries);
    }
    const initCode = await getInitCode(
      hre,
      contract,
      constructorArgs,
      libraries
    );
    const initCodeHash = hre.ethers.keccak256(initCode);
    console.log("initCodeHash:", initCodeHash);
  });

task(
  "getAddress",
  "Get address of a contract given its init code hash and salt"
)
  .addParam("salt", "The salt to use to deploy the contract")
  .addParam("initcodehash", "The init code hash of the contract")
  .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
    /**
     * This task gets the address of a contract given its init code hash and salt.
     * Parameters:
     * - salt: The salt to use to deploy the contract
     * - initcodehash: The init code hash of the contract
     * Usage:
     * `yarn hardhat getAddress --salt <salt> --initcodehash <initcodehash>`
     */
    const salt = parseInt(taskArgs.salt);

    const initCodeHash = taskArgs.initcodehash;

    console.log(
      "Getting address of contract with salt",
      salt,
      "and initCodeHash",
      initCodeHash,
      "..."
    );

    const address = await getVaddAddress(hre, salt, initCodeHash);

    console.log("Address:", address);
  });

task("deployDeterministically", "Deploy a contract with deterministic address")
  .addParam("salt", "The salt to use to deploy the contract")
  .addParam("contract", "The name of the contract")
  .addOptionalParam("librariesfile", "The path to the libraries file")
  .addOptionalVariadicPositionalParam(
    "constructorArgs",
    "The constructor arguments"
  )
  .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
    /*
     * This task deploys a contract deterministically using a salt and the Seaport factory contract.
     * The salt is used to generate the address of the contract.
     * The Seaport factory contract must be deployed in the network.
     * To deploy it in a local network, follow docs: https://github.com/ProjectOpenSea/seaport/blob/main/docs/Deployment.md
     * Parameters:
     * - salt: The salt to use to deploy the contract
     * - contract: The name of the contract
     * - librariesfile: The path to the libraries file (optional)
     * - constructorArgs: The constructor arguments (optional)
     * The libraries file should be a JSON file with the following format:
     * {
     * "library1Name": "library1Address"
     * "library2Name": "library2Address"
     * ...
     * }
     *  Usage:
     *  `yarn hardhat deployDeterministically --network <network> --salt <salt> --contract <contract> <constructorArgs>`
     * Example:
     *  `yarn hardhat deployDeterministically --network mumbai --salt 1638560 --contract Lock 1000`
     */

    const salt = parseInt(taskArgs.salt);

    const contractName = taskArgs.contract;
    const constructorArgs = taskArgs.constructorArgs || [];

    console.log("Deploying contract:", contractName);
    console.log("Using salt", salt);

    const librariesPath = taskArgs.librariesfile;
    let libraries: Libraries = {};
    if (librariesPath) {
      libraries = readLibrariesFromFile(librariesPath);
      console.log("Using libraries:", libraries);
    }

    const { address, txHash } = await deployDeterministically(
      hre,
      salt,
      contractName,
      constructorArgs,
      true,
      libraries
    );

    console.log("Contract deployed at address:", address);
    console.log("Transaction hash:", txHash);
  });

task(
  "checkFactory",
  "Check if factory contract is deployed in the network"
).setAction(async (_, hre: HardhatRuntimeEnvironment) => {
  /**
   * This task checks if the Seaport factory contract is deployed in the network.
   * Usage:
   * `yarn hardhat checkFactory`
   */
  console.log(
    `Seaport factory is ${(await checkFactory(hre)) ? "NOT " : ""}DEPLOYED in ${
      hre.network.name
    }`
  );
});

async function getInitCode(
  hre: HardhatRuntimeEnvironment,
  contractName: string,
  constructorArgs: any[],
  libraries: Libraries = {}
) {
  const contractFactory = await hre.ethers.getContractFactory(contractName, {
    libraries,
  });

  const { data: initCode } = await contractFactory.getDeployTransaction(
    ...constructorArgs
  );
  return initCode;
}

async function getVaddAddress(
  hre: HardhatRuntimeEnvironment,
  salt: number,
  initCodeHash: string
) {
  const { ethers } = hre;
  const saltBytes = ethers.zeroPadValue(ethers.toBeHex(salt), 32);

  const address = ethers.getCreate2Address(
    SEAPORT_FACTORY_ADDRESS,
    saltBytes,
    initCodeHash
  );

  return address;
}

async function deployDeterministically(
  hre: HardhatRuntimeEnvironment,
  salt: number,
  contractName: string,
  constructorArgs: any[],
  crashIfAlreadyDeployed = true,
  libraries: Libraries = {}
) {
  const { ethers } = hre;
  const [deployerSigner] = await ethers.getSigners();

  const initCode = await getInitCode(
    hre,
    contractName,
    constructorArgs,
    libraries
  );

  // Check if the factory contract is deployed in this network
  const factoryCode = await ethers.provider.getCode(SEAPORT_FACTORY_ADDRESS);
  if (factoryCode === "0x") {
    throw new Error("Factory contract not deployed in this network!");
  }

  const factoryContract = new ethers.Contract(
    SEAPORT_FACTORY_ADDRESS,
    SEAPORT_FACTORY_ABI,
    deployerSigner
  );

  const saltBytes = ethers.zeroPadValue(ethers.toBeHex(salt), 32);

  const deploymentAddress = await factoryContract.findCreate2Address(
    saltBytes,
    initCode
  );

  if (deploymentAddress == ethers.ZeroAddress) {
    if (crashIfAlreadyDeployed) {
      throw new Error("Contract already deployed!");
    } else {
      const initCodeHash = hre.ethers.keccak256(initCode);
      return {
        address: await getVaddAddress(hre, salt, initCodeHash),
        txHash: null,
      };
    }
  }

  const tx = await factoryContract.safeCreate2(saltBytes, initCode);
  await tx.wait();

  return {
    address: deploymentAddress,
    txHash: tx.hash,
  };
}

async function checkFactory(hre: HardhatRuntimeEnvironment): Promise<boolean> {
  const { ethers } = hre;
  const factoryCode = await ethers.provider.getCode(SEAPORT_FACTORY_ADDRESS);
  return factoryCode === "0x";
}

function readLibrariesFromFile(librariesPath: string): Libraries {
  const fs = require("fs");
  const path = require("path");

  const librariesFile = path.resolve(librariesPath);
  const libraries = JSON.parse(fs.readFileSync(librariesFile, "utf8"));

  return libraries;
}

export { getInitCode, getVaddAddress, deployDeterministically, checkFactory };
