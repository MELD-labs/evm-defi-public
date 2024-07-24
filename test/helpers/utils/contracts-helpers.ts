import { BigNumberish, ethers } from "ethers";
import { tEthereumAddress, MeldPools, iParamsPerPool } from "../types";
import { getIErc20Metadata } from "./contracts-getters";

export const getParamPerPool = <T>(
  { proto }: iParamsPerPool<T>,
  pool: MeldPools
) => {
  switch (pool) {
    case MeldPools.proto:
      return proto;
    default:
      return proto;
  }
};

export const convertToCurrencyDecimals = async (
  tokenAddress: tEthereumAddress,
  amount: BigNumberish
) => {
  const token = await getIErc20Metadata(tokenAddress);
  const decimals = await token.decimals();

  return ethers.parseUnits(amount.toString(), decimals);
};
