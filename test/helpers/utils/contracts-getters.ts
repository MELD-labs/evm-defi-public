import { MeldProtocolDataProvider__factory } from "../../../typechain-types/factories/contracts/misc";
import { LendingRateOracleAggregator__factory } from "../../../typechain-types/factories/contracts/oracles/lending-rate";
import {
  MToken__factory,
  StableDebtToken__factory,
  VariableDebtToken__factory,
} from "../../../typechain-types/factories/contracts/tokenization";
import { IERC20Metadata__factory } from "../../../typechain-types/factories/@openzeppelin/contracts/token/ERC20/extensions";
import { ERC20__factory } from "../../../typechain-types/factories/@openzeppelin/contracts/token/ERC20";
import { tEthereumAddress } from "../types";
import { ethers } from "hardhat";

export const getFirstSigner = async () => (await ethers.getSigners())[0];

export const getMToken = async (address: tEthereumAddress) =>
  await MToken__factory.connect(address, await getFirstSigner());

export const getStableDebtToken = async (address: tEthereumAddress) =>
  await StableDebtToken__factory.connect(address, await getFirstSigner());

export const getVariableDebtToken = async (address: tEthereumAddress) =>
  await VariableDebtToken__factory.connect(address, await getFirstSigner());

export const getMintableERC20 = async (address: tEthereumAddress) =>
  //ERCO20 from OpenZeppelin is not actually mintable, but the calling function in hellper.ts is only calling balanceOf()
  await ERC20__factory.connect(address, await getFirstSigner());

export const getIErc20Metadata = async (address: tEthereumAddress) =>
  await IERC20Metadata__factory.connect(address, await getFirstSigner());

export const getMeldProtocolDataProvider = async (address: tEthereumAddress) =>
  await MeldProtocolDataProvider__factory.connect(
    address,
    await getFirstSigner()
  );

export const getLendingRateOracle = async (address: tEthereumAddress) =>
  await LendingRateOracleAggregator__factory.connect(
    address,
    await getFirstSigner()
  );
