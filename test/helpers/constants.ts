export const PERCENTAGE_FACTOR = "10000";
export const HALF_PERCENTAGE = "5000";
export const WAD = (10n ** 18n).toString();
export const HALF_WAD = (BigInt(WAD) / 2n).toString();
export const RAY = (10n ** 27n).toString();
export const HALF_RAY = (BigInt(RAY) / 2n).toString();
export const WAD_RAY_RATIO = (10n ** 9n).toString();
export const oneRay = 10n ** 27n;
export const MAX_UINT_AMOUNT =
  "115792089237316195423570985008687907853269984665640564039457584007913129639935";
export const ONE_HOUR = 60 * 60;
export const ONE_YEAR = ONE_HOUR * 24 * 365;

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const oneEther = 10n ** 18n;
export const _1e18 = 10n ** 18n;
export const LIQUIDATION_CLOSE_FACTOR_PERCENT = 10000n;
export const MAX_STABLE_LOAN_PERCENT = 2500n;

export const MOCK_ORACLE_PRICES = {
  // Only setting prices for assets that are used in tests
  MELD: ((_1e18 * 83n) / 100n).toString(), // $0.83
  USDC: _1e18.toString(),
  USDT: _1e18.toString(),
  DAI: _1e18.toString(),
};

export const ADDRESSES_PROVIDER_IDS = {
  LENDING_POOL: "LENDING_POOL",
  LENDING_POOL_CONFIGURATOR: "LENDING_POOL_CONFIGURATOR",
  PRICE_ORACLE: "PRICE_ORACLE",
  LENDING_RATE_ORACLE: "LENDING_RATE_ORACLE",
  MELD_BANKER_NFT: "MELD_BANKER_NFT",
  MELD_BANKER_NFT_MINTER: "MELD_BANKER_NFT_MINTER",
  YIELD_BOOST_FACTORY: "YIELD_BOOST_FACTORY",
  MELD_TOKEN: "MELD_TOKEN",
  MELD_STAKING_STORAGE: "MELD_STAKING_STORAGE",
  PROTOCOL_DATA_PROVIDER: "PROTOCOL_DATA_PROVIDER",
};
