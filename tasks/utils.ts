import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
  IInterestRateStrategyParams,
  PoolConfiguration,
} from "../test/helpers/types";
import { ILendingPoolConfigurator } from "../typechain-types";
import { ConfigNames } from "../test/helpers/utils/configuration";

export type InitReserveFileParams = {
  underlyingAssetAddress: string;
  treasuryAddress: string;
  yieldBoostEnabled: boolean;
  strategy: IInterestRateStrategyParams;
};

export async function createInitReserveParams(
  hre: HardhatRuntimeEnvironment,
  poolConfig: PoolConfiguration,
  interestRateStrategyAddress: string,
  underlyingAssetAddress: string,
  treasuryAddress: string,
  yieldBoostEnabled: boolean
): Promise<ILendingPoolConfigurator.InitReserveInputStruct> {
  const underlyingAssetContract = await hre.ethers.getContractAt(
    "IERC20Metadata",
    underlyingAssetAddress
  );

  const name = await underlyingAssetContract.name();
  const symbol = await underlyingAssetContract.symbol();
  const decimals = await underlyingAssetContract.decimals();

  return {
    underlyingAssetDecimals: decimals,
    interestRateStrategyAddress,
    underlyingAsset: underlyingAssetAddress,
    treasury: treasuryAddress,
    underlyingAssetName: name,
    mTokenName: `${poolConfig.MTokenNamePrefix} ${symbol}`,
    mTokenSymbol: `${poolConfig.SymbolPrefix}${symbol}`,
    variableDebtTokenName: `${poolConfig.VariableDebtTokenNamePrefix} ${symbol}`,
    variableDebtTokenSymbol: `variableDebt${symbol}`,
    stableDebtTokenName: `${poolConfig.StableDebtTokenNamePrefix} ${symbol}`,
    stableDebtTokenSymbol: `stableDebt${symbol}`,
    yieldBoostEnabled: yieldBoostEnabled,
  };
}

export function switchEnvController(networkName: string) {
  switch (networkName) {
    case "hardhat":
    case "localhost":
      return ConfigNames.MeldDev;
    case "kanazawa":
      return ConfigNames.MeldTestnet;
    case "meld":
      return ConfigNames.MeldMainnet;
    default:
      throw new Error(
        `Unsupported newtork: ${networkName} is not one of the supported networks`
      );
  }
}
