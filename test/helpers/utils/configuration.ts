import { PoolConfiguration } from "../types";
// import { getParamPerPool } from "./contracts-helpers";
import MeldDevConfig from "../../../markets/meld/dev";
import MeldTestnetConfig from "../../../markets/meld/kanazawa";
import MeldMainnetConfig from "../../../markets/meld/meld";
export enum ConfigNames {
  MeldDev = "MeldDev",
  MeldTestnet = "MeldTestnet",
  MeldMainnet = "MeldMainnet",
}

export const loadPoolConfig = (configName: ConfigNames): PoolConfiguration => {
  switch (configName) {
    case ConfigNames.MeldDev:
      return MeldDevConfig;
    case ConfigNames.MeldTestnet:
      return MeldTestnetConfig;
    case ConfigNames.MeldMainnet:
      return MeldMainnetConfig;
    default:
      throw new Error(
        `Unsupported pool configuration: ${configName} is not one of the supported configs ${Object.values(
          ConfigNames
        )}`
      );
  }
};
