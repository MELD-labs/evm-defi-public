/*
 * Error messages prefix glossary:
 *  - VL = ValidationLogic
 *  - MATH = Math libraries
 *  - MT = mToken or DebtTokens
 *  - LP = LendingPool
 *  - AP = AddressesProvider
 *  - LPC = LendingPoolConfiguration
 *  - RL = ReserveLogic
 *  - LL = LiquidationLogic
 *  - P = Pausable
 */
export enum ProtocolErrors {
  //common errors
  BORROW_ALLOWANCE_NOT_ENOUGH = "BORROW_ALLOWANCE_NOT_ENOUGH", // User borrows on behalf, but allowance are too small
  INVALID_ADDRESS = "INVALID_ADDRESS", // 'Invalid address provided'
  PRICE_ORACLE_NOT_SET = "PRICE_ORACLE_NOT_SET", // 'Price oracle is not set'
  LENDING_RATE_ORACLE_NOT_SET = "LENDING_RATE_ORACLE_NOT_SET", // 'Lending Rate oracle is not set'
  INVALID_ASSET_PRICE = "INVALID_ASSET_PRICE", // 'Price from oracle invalid'
  INVALID_MARKET_BORROW_RATE = "INVALID_MARKET_BORROW_RATE", // Market borrow rate from the oracle is invalid

  CURRENT_AVAILABLE_LIQUIDITY_NOT_ENOUGH = "CURRENT_AVAILABLE_LIQUIDITY_NOT_ENOUGH", // 'The current liquidity is not enough'
  INCONSISTENT_ARRAY_SIZE = "INCONSISTENT_ARRAY_SIZE", // 'Array sizes do not match'
  EMPTY_ARRAY = "EMPTY_ARRAY", // 'Empty array'
  EMPTY_VALUE = "EMPTY_VALUE", // 'Empty value'
  VALUE_ABOVE_100_PERCENT = "VALUE_ABOVE_100_PERCENT", // 'Value is above 100%'
  UPGRADEABILITY_NOT_ALLOWED = "UPGRADEABILITY_NOT_ALLOWED", // 'Value is above 100%'

  //contract specific errors
  VL_INVALID_AMOUNT = "VL_INVALID_AMOUNT", // 'Amount must be greater than 0'
  VL_NO_ACTIVE_RESERVE = "VL_NO_ACTIVE_RESERVE", // 'Action requires an active reserve'
  VL_RESERVE_FROZEN = "VL_RESERVE_FROZEN", // 'Action requires an unfrozen reserve'
  VL_CURRENT_AVAILABLE_LIQUIDITY_NOT_ENOUGH_FOR_BORROW = "VL_CURRENT_AVAILABLE_LIQUIDITY_NOT_ENOUGH_FOR_BORROW", // 'The current liquidity is not enough to borrow the amount requested'
  VL_NOT_ENOUGH_AVAILABLE_USER_BALANCE = "VL_NOT_ENOUGH_AVAILABLE_USER_BALANCE", // 'User cannot withdraw more than the available balance'
  VL_TRANSFER_NOT_ALLOWED = "VL_TRANSFER_NOT_ALLOWED", // 'Transfer cannot be allowed.'
  VL_BORROWING_NOT_ENABLED = "VL_BORROWING_NOT_ENABLED", // 'Borrowing is not enabled'
  VL_INVALID_INTEREST_RATE_MODE_SELECTED = "VL_INVALID_INTEREST_RATE_MODE_SELECTED", // 'Invalid interest rate mode selected'
  VL_COLLATERAL_BALANCE_IS_0 = "VL_COLLATERAL_BALANCE_IS_0", // 'The collateral balance is 0'
  VL_HEALTH_FACTOR_LOWER_THAN_LIQUIDATION_THRESHOLD = "VL_HEALTH_FACTOR_LOWER_THAN_LIQUIDATION_THRESHOLD", // 'Health factor is lesser than the liquidation threshold'
  VL_COLLATERAL_CANNOT_COVER_NEW_BORROW = "VL_COLLATERAL_CANNOT_COVER_NEW_BORROW", // 'There is not enough collateral to cover a new borrow'
  VL_STABLE_BORROWING_NOT_ENABLED = "VL_STABLE_BORROWING_NOT_ENABLED", // stable borrowing not enabled
  VL_COLLATERAL_SAME_AS_BORROWING_CURRENCY = "VL_COLLATERAL_SAME_AS_BORROWING_CURRENCY", // collateral is (mostly) the same currency that is being borrowed
  VL_AMOUNT_BIGGER_THAN_MAX_LOAN_SIZE_STABLE = "VL_AMOUNT_BIGGER_THAN_MAX_LOAN_SIZE_STABLE", // 'The requested amount is greater than the max loan size in stable rate mode
  VL_NO_DEBT_OF_SELECTED_TYPE = "VL_NO_DEBT_OF_SELECTED_TYPE", // 'for repayment of stable debt, the user needs to have stable debt, otherwise, he needs to have variable debt'
  VL_NO_EXPLICIT_AMOUNT_TO_REPAY_ON_BEHALF = "VL_NO_EXPLICIT_AMOUNT_TO_REPAY_ON_BEHALF", // 'To repay on behalf of a user an explicit amount to repay is needed'
  VL_UNDERLYING_BALANCE_NOT_GREATER_THAN_0 = "VL_UNDERLYING_BALANCE_NOT_GREATER_THAN_0", // 'The underlying balance needs to be greater than 0'
  VL_DEPOSIT_ALREADY_IN_USE = "VL_DEPOSIT_ALREADY_IN_USE", // 'User deposit is already being used as collateral'
  VL_RESERVE_SUPPLY_CAP_REACHED = "VL_RESERVE_SUPPLY_CAP_REACHED", // 'Reserve reached the maximum supply cap'
  VL_RESERVE_BORROW_CAP_REACHED = "VL_RESERVE_BORROW_CAP_REACHED", // 'Reserve reached its borrow cap'
  VL_FLASH_LOAN_AMOUNT_OVER_LIMIT = "VL_FLASH_LOAN_AMOUNT_OVER_LIMIT", // 'Flash loan amount of one of the assets is over the limit'
  CT_RESERVE_TOKEN_ALREADY_INITIALIZED = "CT_RESERVE_TOKEN_ALREADY_INITIALIZED", // 'MToken, StableDebtToken, or VariableDebtToken has already been initialized'
  RL_RESERVE_ALREADY_INITIALIZED = "RL_RESERVE_ALREADY_INITIALIZED", // 'Reserve has already been initialized'
  LPC_RESERVE_LIQUIDITY_NOT_0 = "LPC_RESERVE_LIQUIDITY_NOT_0", // 'The liquidity of the reserve needs to be 0'
  LPC_INVALID_CONFIGURATION = "LPC_INVALID_CONFIGURATION", // 'Invalid risk parameters for the reserve'
  LPC_NOT_CONTRACT = "LPC_NOT_CONTRACT", // 'The underlying asset is not a contract'
  LPC_RESERVE_DOES_NOT_EXIST = "LPC_RESERVE_DOES_NOT_EXIST", // 'Reserve does not exist/has not been initialized'
  LL_HEALTH_FACTOR_NOT_BELOW_THRESHOLD = "LL_HEALTH_FACTOR_NOT_BELOW_THRESHOLD", // 'Health factor is not below the threshold'
  LL_COLLATERAL_CANNOT_BE_LIQUIDATED = "LL_COLLATERAL_CANNOT_BE_LIQUIDATED", // 'The collateral chosen cannot be liquidated'
  LL_SPECIFIED_CURRENCY_NOT_BORROWED_BY_USER = "LL_SPECIFIED_CURRENCY_NOT_BORROWED_BY_USER", // 'User did not borrow the specified currency'
  LL_NOT_ENOUGH_LIQUIDITY_TO_LIQUIDATE = "LL_NOT_ENOUGH_LIQUIDITY_TO_LIQUIDATE", // "There isn't enough liquidity available to liquidate"
  FLL_INVALID_FLASH_LOAN_EXECUTOR_RETURN = "FLL_INVALID_FLASH_LOAN_EXECUTOR_RETURN",
  MATH_MULTIPLICATION_OVERFLOW = "MATH_MULTIPLICATION_OVERFLOW",
  MATH_ADDITION_OVERFLOW = "MATH_ADDITION_OVERFLOW",
  MATH_DIVISION_BY_ZERO = "MATH_DIVISION_BY_ZERO",
  RL_LIQUIDITY_INDEX_OVERFLOW = "RL_LIQUIDITY_INDEX_OVERFLOW", //  Liquidity index overflows uint128
  RL_VARIABLE_BORROW_INDEX_OVERFLOW = "RL_VARIABLE_BORROW_INDEX_OVERFLOW", //  Variable borrow index overflows uint128
  RL_LIQUIDITY_RATE_OVERFLOW = "RL_LIQUIDITY_RATE_OVERFLOW", //  Liquidity rate overflows uint128
  RL_VARIABLE_BORROW_RATE_OVERFLOW = "RL_VARIABLE_BORROW_RATE_OVERFLOW", //  Variable borrow rate overflows uint128
  RL_STABLE_BORROW_RATE_OVERFLOW = "RL_STABLE_BORROW_RATE_OVERFLOW", //  Stable borrow rate overflows uint128
  CT_INVALID_MINT_AMOUNT = "CT_INVALID_MINT_AMOUNT", //invalid amount to mint
  CT_INVALID_BURN_AMOUNT = "CT_INVALID_BURN_AMOUNT", //invalid amount to burn
  MT_INVALID_OWNER = "MT_INVALID_OWNER", // The owner passed to the permit function cannot be the zero address
  MT_INVALID_DEADLINE = "MT_INVALID_DEADLINE", // The permit deadline has expired
  MT_INVALID_SIGNATURE = "MT_INVALID_SIGNATURE", // The permit signature is invalid
  LP_USER_NOT_ACCEPT_GENIUS_LOAN = "LP_USER_NOT_ACCEPT_GENIUS_LOAN", // 'User did not accept the loan terms'
  LP_BORROW_ALLOWANCE_NOT_ENOUGH = "LP_BORROW_ALLOWANCE_NOT_ENOUGH", // User borrows on behalf, but allowance are too small
  LP_CALLER_MUST_BE_AN_MTOKEN = "LP_CALLER_MUST_BE_AN_MTOKEN",
  LP_NO_MORE_RESERVES_ALLOWED = "LP_NO_MORE_RESERVES_ALLOWED",
  LP_MELD_BANKER_NFT_LOCKED = "LP_MELD_BANKER_NFT_LOCKED",
  LP_YIELD_BOOST_STAKING_NOT_ENABLED = "LP_YIELD_BOOST_STAKING_NOT_ENABLED", // yield boost was either never enabled or has been disabled
  LP_NOT_OWNER_OF_MELD_BANKER_NFT = "LP_NOT_OWNER_OF_MELD_BANKER_NFT",
  LP_INVALID_YIELD_BOOST_MULTIPLIER = "LP_INVALID_YIELD_BOOST_MULTIPLIER", // yield boost multiplier value is invalied
  LP_MELD_BANKER_NFT_ALREADY_SET = "LP_MELD_BANKER_NFT_ALREADY_SET",
  RC_INVALID_LTV = "RC_INVALID_LTV",
  RC_INVALID_LIQ_THRESHOLD = "RC_INVALID_LIQ_THRESHOLD",
  RC_INVALID_LIQ_BONUS = "RC_INVALID_LIQ_BONUS",
  RC_INVALID_DECIMALS = "RC_INVALID_DECIMALS",
  RC_INVALID_RESERVE_FACTOR = "RC_INVALID_RESERVE_FACTOR",
  RC_INVALID_SUPPLY_CAP_USD = "RC_INVALID_SUPPLY_CAP_USD",
  RC_INVALID_BORROW_CAP_USD = "RC_INVALID_BORROW_CAP_USD",
  RC_INVALID_FLASHLOAN_LIMIT_USD = "RC_INVALID_FLASHLOAN_LIMIT_USD",
  AP_INVALID_ADDRESS_ID = "AP_INVALID_ADDRESS_ID",
  AP_CANNOT_UPDATE_ADDRESS = "AP_CANNOT_UPDATE_ADDRESS",
  AP_CANNOT_UPDATE_ROLE = "AP_CANNOT_UPDATE_ROLE",
  AP_CANNOT_REMOVE_LAST_ADMIN = "AP_CANNOT_REMOVE_LAST_ADMIN",
  AP_CANNOT_STOP_UPGRADEABILITY = "AP_CANNOT_STOP_UPGRADEABILITY",
  AP_ROLE_NOT_DESTROYABLE = "AP_ROLE_NOT_DESTROYABLE",
  AP_ROLE_ALREADY_DESTROYED = "AP_ROLE_ALREADY_DESTROYED",
  AP_ROLE_HAS_MEMBERS = "AP_ROLE_HAS_MEMBERS",
  MB_NFT_BLOCKED = "MB_NFT_BLOCKED",
  MB_METADATA_ADDRESS_NOT_SET = "MB_METADATA_ADDRESS_NOT_SET",
  MB_INVALID_NFT_ID = "MB_INVALID_NFT_ID",
  MB_INVALID_LENDING_POOL = "MB_INVALID_LENDING_POOL",
  YB_REWARDS_INVALID_EPOCH = "YB_REWARDS_INVALID_EPOCH",
  YB_REWARDS_CURRENT_OR_FUTURE_EPOCH = "YB_REWARDS_CURRENT_OR_FUTURE_EPOCH",
  YB_REWARDS_INVALID_AMOUNT = "YB_REWARDS_INVALID_AMOUNT",
  YB_INSUFFICIENT_ALLOWANCE = "YB_INSUFFICIENT_ALLOWANCE",
  YB_STAKER_DOES_NOT_EXIST = "YB_STAKER_DOES_NOT_EXIST",
  YB_INVALID_EPOCH = "YB_INVALID_EPOCH",
  YB_ONLY_FACTORY = "YB_ONLY_FACTORY",
  YB_ONLY_YB_STAKING = "YB_ONLY_YB_STAKING",
  YB_ALREADY_INITIALIZED = "YB_ALREADY_INITIALIZED",
  YB_SENDER_CANNOT_SET_STAKE_AMOUNT = "YB_SENDER_CANNOT_SET_STAKE_AMOUNT",
  YB_INVALID_EPOCH_SIZE = "YB_INVALID_EPOCH_SIZE",
  YB_INVALID_ASSET = "YB_INVALID_ASSET",
  YB_INVALID_MELD_STAKING_STORAGE = "YB_INVALID_MELD_STAKING_STORAGE",
  YB_INVALID_MELD_TOKEN = "YB_INVALID_MELD_TOKEN",
  YB_USER_NOT_ACCEPT_GENIUS_LOAN = "YB_USER_NOT_ACCEPT_GENIUS_LOAN",

  // old

  INVALID_FROM_BALANCE_AFTER_TRANSFER = "Invalid from balance after transfer",
  INVALID_TO_BALANCE_AFTER_TRANSFER = "Invalid to balance after transfer",
  INVALID_OWNER_REVERT_MSG = "Ownable: caller is not the owner",
  INVALID_HF = "Invalid health factor",
  TRANSFER_AMOUNT_EXCEEDS_BALANCE = "ERC20: transfer amount exceeds balance",
  SAFEERC20_LOWLEVEL_CALL = "SafeERC20: low-level call failed",
}

export interface SymbolMap<T> {
  [symbol: string]: T;
}

export enum MeldPools {
  proto = "proto",
}

export enum eContractid {
  MToken = "MToken",
}

export type tEthereumAddress = string;

export interface iAssetCommon<T> {
  [key: string]: T;
}
// Not all tokens are configured for all envs. So some are optional here
export interface iMeldPoolAssets<T> {
  MELD: T;
  USDC?: T;
  USDT?: T;
  WBTC?: T;
  WETH?: T;
  WAVAX?: T;
  WMATIC?: T;
  COPI?: T;
  DAI?: T;
  tUSDC?: T;
  tUSDT?: T;
  twBTC?: T;
  twETH?: T;
  twAVAX?: T;
  tADA?: T;
  AVAX?: T;
  ADA?: T;
}

export type iMultiPoolsAssets<T> = iAssetCommon<T> | iMeldPoolAssets<T>;

export interface IReserveParams
  extends IReserveBorrowParams,
    IReserveCollateralParams {
  mTokenImpl: eContractid;
  reserveFactor: string;
  supplyCapUSD: string;
  borrowCapUSD: string;
  flashLoanLimitUSD: string;
  yieldBoostEnabled: boolean;
  strategy: IInterestRateStrategyParams;
}

export interface IInterestRateStrategyParams {
  name: string;
  optimalUtilizationRate: string;
  baseVariableBorrowRate: string;
  variableRateSlope1: string;
  variableRateSlope2: string;
  stableRateSlope1: string;
  stableRateSlope2: string;
}

export interface IReserveBorrowParams {
  borrowingEnabled: boolean;
  stableBorrowRateEnabled: boolean;
  reserveDecimals: string;
}

export interface IReserveCollateralParams {
  baseLTVAsCollateral: string;
  liquidationThreshold: string;
  liquidationBonus: string;
}
export interface Configuration {
  reservesParams: iMeldPoolAssets<IReserveParams>;
}

export interface IMarketRates {
  borrowRate: string;
}

export interface iParamsPerPool<T> {
  [MeldPools.proto]: T;
}

export enum RateMode {
  None = "0",
  Stable = "1",
  Variable = "2",
}

export enum Action {
  NONE = "0",
  DEPOSIT = "1",
  BORROW = "2",
}
export enum MeldBankerType {
  NONE = "0",
  BANKER = "1",
  GOLDEN = "2",
}

export interface ObjectString {
  [key: string]: string;
}
export interface IMocksConfig {
  AllAssetsInitialPrices: { [key: string]: string };
}

export interface ILendingRateOracleRatesCommon {
  [token: string]: ILendingRate;
}

export interface ILendingRate {
  borrowRate: string;
}

export interface IBaseConfiguration {
  MarketId: string;
  MTokenNamePrefix: string;
  StableDebtTokenNamePrefix: string;
  VariableDebtTokenNamePrefix: string;
  SymbolPrefix: string;
  LendingRateOracleRatesCommon: iMultiPoolsAssets<IMarketRates>;
  ReserveFactorTreasuryAddress: string;
  ReserveAssets: iMultiPoolsAssets<tEthereumAddress>;
  OracleQuoteCurrency: string;
  OracleQuoteUnit: string;
}
export interface IMeldConfiguration extends IBaseConfiguration {
  ReservesConfig: iMeldPoolAssets<IReserveParams>;
  Mocks: IMocksConfig;
  SupraOracleFeedAddress: string;
  SupraPricePairPaths: SymbolMap<number[]>;
  MeldStakingStorageAddress: string;
  MeldBankerNFTAddress?: string;
}

export type PoolConfiguration = IMeldConfiguration;
