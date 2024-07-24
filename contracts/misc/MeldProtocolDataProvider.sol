// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {LendingBase, IAddressesProvider} from "../base/LendingBase.sol";
import {
    ReserveConfiguration,
    Errors,
    DataTypes
} from "../libraries/configuration/ReserveConfiguration.sol";
import {UserConfiguration} from "../libraries/configuration/UserConfiguration.sol";
import {IMeldProtocolDataProvider} from "../interfaces/IMeldProtocolDataProvider.sol";
import {ILendingPool} from "../interfaces/ILendingPool.sol";
import {ILendingPoolConfigurator} from "../interfaces/ILendingPoolConfigurator.sol";
import {IStableDebtToken} from "../interfaces/IStableDebtToken.sol";
import {IVariableDebtToken} from "../interfaces/IVariableDebtToken.sol";
import {IPriceOracle} from "../interfaces/IPriceOracle.sol";

/**
 * @title MeldProtocolDataProvider
 * @notice Provides the data of the MELD protocol
 * @dev This contract is meant to be used by the MELD frontend/backend to retrieve the data of the protocol including reserves, users, etc.
 * @author MELD team
 */
contract MeldProtocolDataProvider is LendingBase, IMeldProtocolDataProvider {
    using ReserveConfiguration for DataTypes.ReserveConfigurationMap;
    using UserConfiguration for DataTypes.UserConfigurationMap;

    modifier onlyExistingReserve(address asset) {
        ILendingPoolConfigurator configurator = ILendingPoolConfigurator(
            addressesProvider.getLendingPoolConfigurator()
        );
        configurator.checkReserveExists(asset);
        _;
    }

    /**
     * @notice Initializes the MeldProtocolDataProvider
     * @param _addressesProvider The address of the AddressesProvider
     */
    constructor(IAddressesProvider _addressesProvider) {
        addressesProvider = _addressesProvider;
    }

    /**
     * @notice Returns the tokens of all the reserves of the protocol
     * @return An array of TokenData objects containing the tokens symbol and address
     */
    function getAllReservesTokens() external view override returns (TokenData[] memory) {
        ILendingPool pool = ILendingPool(addressesProvider.getLendingPool());
        address[] memory reserves = pool.getReservesList();
        TokenData[] memory reservesTokens = new TokenData[](reserves.length);
        for (uint256 i = 0; i < reserves.length; i++) {
            reservesTokens[i] = TokenData({
                symbol: IERC20Metadata(reserves[i]).symbol(),
                tokenAddress: reserves[i]
            });
        }
        return reservesTokens;
    }

    /**
     * @notice Returns the mTokens of all the reserves of the protocol
     * @return An array of TokenData objects with the mTokens symbol and address
     */
    function getAllMTokens() external view override returns (TokenData[] memory) {
        ILendingPool pool = ILendingPool(addressesProvider.getLendingPool());
        address[] memory reserves = pool.getReservesList();
        TokenData[] memory mTokens = new TokenData[](reserves.length);
        for (uint256 i = 0; i < reserves.length; i++) {
            DataTypes.ReserveData memory reserveData = pool.getReserveData(reserves[i]);
            mTokens[i] = TokenData({
                symbol: IERC20Metadata(reserveData.mTokenAddress).symbol(),
                tokenAddress: reserveData.mTokenAddress
            });
        }
        return mTokens;
    }

    /**
     * @notice Checks if the reserve already exists
     * @param _asset The address of the underlying asset of the reserve
     * @return bool true if the reserve already exists, false otherwise
     */
    function reserveExists(address _asset) external view override returns (bool) {
        return ILendingPool(addressesProvider.getLendingPool()).reserveExists(_asset);
    }

    /**
     * @notice Returns the configuration data of a specific reserve
     * @param _asset The address of the reserve
     * @return Struct containing the reserve configuration data
     */
    function getReserveConfigurationData(
        address _asset
    ) external view override returns (DataTypes.ReserveConfigurationData memory) {
        DataTypes.ReserveConfigurationMap memory configuration = ILendingPool(
            addressesProvider.getLendingPool()
        ).getConfiguration(_asset);

        return configuration.getReserveConfigurationData();
    }

    /**
     * @notice Returns the user data of a specific user for a specific reserve
     * @param _asset The address of the reserve
     * @param _user The address of the user
     * @return currentMTokenBalance The current balance of the user in the reserve
     * @return currentStableDebt The current stable debt of the user in the reserve
     * @return currentVariableDebt The current variable debt of the user in the reserve
     * @return principalStableDebt The principal of the stable debt of the user in the reserve
     * @return scaledVariableDebt The scaled variable debt of the user in the reserve
     * @return stableBorrowRate The stable borrow rate of the user in the reserve
     * @return liquidityRate The liquidity rate of the reserve
     * @return stableRateLastUpdated The timestamp of the last stable rate update
     * @return usageAsCollateralEnabled Whether the user is using the reserve as collateral
     */
    function getUserReserveData(
        address _asset,
        address _user
    )
        external
        view
        override
        onlyExistingReserve(_asset)
        returns (
            uint256 currentMTokenBalance,
            uint256 currentStableDebt,
            uint256 currentVariableDebt,
            uint256 principalStableDebt,
            uint256 scaledVariableDebt,
            uint256 stableBorrowRate,
            uint256 liquidityRate,
            uint40 stableRateLastUpdated,
            bool usageAsCollateralEnabled
        )
    {
        DataTypes.ReserveData memory reserve = ILendingPool(addressesProvider.getLendingPool())
            .getReserveData(_asset);

        DataTypes.UserConfigurationMap memory userConfig = ILendingPool(
            addressesProvider.getLendingPool()
        ).getUserConfiguration(_user);

        currentMTokenBalance = IERC20Metadata(reserve.mTokenAddress).balanceOf(_user);
        currentVariableDebt = IERC20Metadata(reserve.variableDebtTokenAddress).balanceOf(_user);
        currentStableDebt = IERC20Metadata(reserve.stableDebtTokenAddress).balanceOf(_user);
        principalStableDebt = IStableDebtToken(reserve.stableDebtTokenAddress).principalBalanceOf(
            _user
        );
        scaledVariableDebt = IVariableDebtToken(reserve.variableDebtTokenAddress).scaledBalanceOf(
            _user
        );
        liquidityRate = reserve.currentLiquidityRate;
        stableBorrowRate = IStableDebtToken(reserve.stableDebtTokenAddress).getUserStableRate(
            _user
        );
        stableRateLastUpdated = IStableDebtToken(reserve.stableDebtTokenAddress).getUserLastUpdated(
            _user
        );
        usageAsCollateralEnabled = userConfig.isUsingAsCollateral(reserve.id);
    }

    /**
     * @notice Returns the addresses of the mToken, stable debt token and variable debt token of a specific asset
     * @param _asset The address of the asset
     * @return mTokenAddress The address of the mToken
     * @return stableDebtTokenAddress The address of the stable debt token
     * @return variableDebtTokenAddress The address of the variable debt token
     */
    function getReserveTokensAddresses(
        address _asset
    )
        external
        view
        override
        returns (
            address mTokenAddress,
            address stableDebtTokenAddress,
            address variableDebtTokenAddress
        )
    {
        DataTypes.ReserveData memory reserve = ILendingPool(addressesProvider.getLendingPool())
            .getReserveData(_asset);

        return (
            reserve.mTokenAddress,
            reserve.stableDebtTokenAddress,
            reserve.variableDebtTokenAddress
        );
    }

    /**
     * @notice Returns the total supply and the supply cap of a specific asset
     * @param _asset The address of the asset
     * @return supplyCap The supply cap of the asset
     * @return currentSupplied The current total supply of the asset
     * @return supplyCapUSD The supply cap of the asset in USD
     * @return currentSuppliedUSD The current total supply of the asset in USD
     */
    function getSupplyCapData(
        address _asset
    )
        external
        view
        override
        onlyExistingReserve(_asset)
        returns (
            uint256 supplyCap,
            uint256 currentSupplied,
            uint256 supplyCapUSD,
            uint256 currentSuppliedUSD
        )
    {
        address oracleAddress = addressesProvider.getPriceOracle();
        require(oracleAddress != address(0), Errors.PRICE_ORACLE_NOT_SET);

        DataTypes.ReserveConfigurationMap memory configuration = ILendingPool(
            addressesProvider.getLendingPool()
        ).getConfiguration(_asset);

        supplyCapUSD = configuration.getReserveConfigurationData().supplyCapUSD;

        address mTokenAddress = ILendingPool(addressesProvider.getLendingPool())
            .getReserveData(_asset)
            .mTokenAddress;

        currentSupplied = IERC20Metadata(mTokenAddress).totalSupply();

        (uint256 reserveUnitPriceUSD, bool oracleSuccess) = IPriceOracle(oracleAddress)
            .getAssetPrice(_asset);
        require(oracleSuccess, Errors.INVALID_ASSET_PRICE);
        uint256 priceUSDDecimals = 1e18;

        uint256 decimals = IERC20Metadata(_asset).decimals();
        uint256 tokenUnit = 10 ** decimals;
        supplyCap = (tokenUnit * (supplyCapUSD * priceUSDDecimals)) / reserveUnitPriceUSD;
        currentSuppliedUSD =
            (currentSupplied * reserveUnitPriceUSD) /
            (priceUSDDecimals * tokenUnit);
    }

    /**
     * @notice Returns the total borrow and the borrow cap of a specific asset
     * @param _asset The address of the asset
     * @return borrowCap The borrow cap of the asset
     * @return currentBorrowed The current total borrowed value of the asset
     * @return borrowCapUSD The borrow cap of the asset in USD
     * @return currentBorrowedUSD The current total borrowed value of the asset in USD
     */
    function getBorrowCapData(
        address _asset
    )
        external
        view
        override
        onlyExistingReserve(_asset)
        returns (
            uint256 borrowCap,
            uint256 currentBorrowed,
            uint256 borrowCapUSD,
            uint256 currentBorrowedUSD
        )
    {
        address oracleAddress = addressesProvider.getPriceOracle();
        require(oracleAddress != address(0), Errors.PRICE_ORACLE_NOT_SET);

        DataTypes.ReserveConfigurationMap memory configuration = ILendingPool(
            addressesProvider.getLendingPool()
        ).getConfiguration(_asset);

        borrowCapUSD = configuration.getReserveConfigurationData().borrowCapUSD;

        (, uint256 totalStableDebt, uint256 totalVariableDebt, , , , , , , ) = getReserveData(
            _asset
        );
        currentBorrowed = totalStableDebt + totalVariableDebt;

        (uint256 reserveUnitPriceUSD, bool oracleSuccess) = IPriceOracle(oracleAddress)
            .getAssetPrice(_asset);
        require(oracleSuccess, Errors.INVALID_ASSET_PRICE);
        uint256 priceUSDDecimals = 1e18;

        uint256 decimals = IERC20Metadata(_asset).decimals();
        uint256 tokenUnit = 10 ** decimals;
        borrowCap = (tokenUnit * (borrowCapUSD * priceUSDDecimals)) / reserveUnitPriceUSD;
        currentBorrowedUSD =
            (currentBorrowed * reserveUnitPriceUSD) /
            (priceUSDDecimals * tokenUnit);
    }

    /**
     * @notice Returns the flash loan limit of a specific asset
     * @param _asset The address of the asset
     * @return flashLoanLimit The flash loan limit of the asset in the asset's decimals
     * @return flashLoanLimitUSD The flash loan limit of the asset in USD
     */
    function getFlashLoanLimitData(
        address _asset
    )
        external
        view
        override
        onlyExistingReserve(_asset)
        returns (uint256 flashLoanLimit, uint256 flashLoanLimitUSD)
    {
        address oracleAddress = addressesProvider.getPriceOracle();
        require(oracleAddress != address(0), Errors.PRICE_ORACLE_NOT_SET);

        DataTypes.ReserveConfigurationMap memory configuration = ILendingPool(
            addressesProvider.getLendingPool()
        ).getConfiguration(_asset);

        flashLoanLimitUSD = configuration.getReserveConfigurationData().flashLoanLimitUSD;

        (uint256 reserveUnitPriceUSD, bool oracleSuccess) = IPriceOracle(oracleAddress)
            .getAssetPrice(_asset);
        require(oracleSuccess, Errors.INVALID_ASSET_PRICE);
        uint256 priceUSDDecimals = 1e18;

        uint256 decimals = IERC20Metadata(_asset).decimals();
        uint256 tokenUnit = 10 ** decimals;
        flashLoanLimit = (tokenUnit * (flashLoanLimitUSD * priceUSDDecimals)) / reserveUnitPriceUSD;
    }

    /**
     * @notice Returns the address of the YieldBoostStaking of a specific asset
     * @param _asset The address of the asset
     * @return The address of the YieldBoostStaking (or ZeroAddress if yield boost not enabled for the asset)
     */
    function getReserveYieldBoostStaking(address _asset) external view override returns (address) {
        DataTypes.ReserveData memory reserve = ILendingPool(addressesProvider.getLendingPool())
            .getReserveData(_asset);

        return reserve.yieldBoostStaking;
    }

    /**
     * @notice Checks if a user is accepting the Genius Loan
     * @param _user The address of the user
     */
    function isUserAcceptingGeniusLoan(address _user) external view override returns (bool) {
        DataTypes.UserConfigurationMap memory userConfig = ILendingPool(
            addressesProvider.getLendingPool()
        ).getUserConfiguration(_user);
        return userConfig.isAcceptingGeniusLoan();
    }

    /**
     * @notice Gets the interest rate strategy of a reserve
     * @param _asset The address of the underlying asset of the reserve
     * @return The address of the interest strategy contract
     */
    function getReserveInterestRateStrategyAddress(address _asset) external view returns (address) {
        DataTypes.ReserveData memory reserve = ILendingPool(addressesProvider.getLendingPool())
            .getReserveData(_asset);
        return reserve.interestRateStrategyAddress;
    }

    /**
     * @notice Returns the configuration parameters of the MELD protocol
     * @return maxValidLtv The max amount of LTV of the protocol
     * @return maxValidLiquidationThreshold The max amount of liquidation threshold of the protocol
     * @return maxValidLiquidationBonus The max amount of liquidation bonus of the protocol
     * @return maxValidDecimals The max amount of decimals of the protocol
     * @return maxValidReserveFactor The max amount of reserve factor of the protocol
     * @return maxValidSupplyCapUSD The max amount of supply cap of the protocol in USD
     * @return maxValidBorrowCapUSD The max amount of borrow cap of the protocol in USD
     * @return maxflashLoanLimitUSD The max amount of flash loan limit in USD
     */
    function getReserveConfigurationMaxValues()
        external
        pure
        override
        returns (uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256)
    {
        return (
            ReserveConfiguration.MAX_VALID_LTV,
            ReserveConfiguration.MAX_VALID_LIQUIDATION_THRESHOLD,
            ReserveConfiguration.MAX_VALID_LIQUIDATION_BONUS,
            ReserveConfiguration.MAX_VALID_DECIMALS,
            ReserveConfiguration.MAX_VALID_RESERVE_FACTOR,
            ReserveConfiguration.MAX_VALID_SUPPLY_CAP_USD,
            ReserveConfiguration.MAX_VALID_BORROW_CAP_USD,
            ReserveConfiguration.MAX_FLASHLOAN_LIMIT_USD
        );
    }

    /**
     * @notice Returns the reserve data of a specific asset
     * @param _asset The address of the reserve
     * @return availableLiquidity The liquidity available in the reserve
     * @return totalStableDebt The total stable debt of the reserve
     * @return totalVariableDebt The total variable debt of the reserve
     * @return liquidityRate The current liquidity rate
     * @return variableBorrowRate The current variable borrow rate
     * @return stableBorrowRate The current stable borrow rate
     * @return averageStableBorrowRate The average stable borrow rate
     * @return liquidityIndex The liquidity index
     * @return variableBorrowIndex The variable borrow index
     * @return lastUpdateTimestamp The timestamp of the last update
     */
    function getReserveData(
        address _asset
    )
        public
        view
        override
        returns (
            uint256 availableLiquidity,
            uint256 totalStableDebt,
            uint256 totalVariableDebt,
            uint256 liquidityRate,
            uint256 variableBorrowRate,
            uint256 stableBorrowRate,
            uint256 averageStableBorrowRate,
            uint256 liquidityIndex,
            uint256 variableBorrowIndex,
            uint40 lastUpdateTimestamp
        )
    {
        DataTypes.ReserveData memory reserve = ILendingPool(addressesProvider.getLendingPool())
            .getReserveData(_asset);

        // Most return values are 0 for a reserve that has not been initialized
        availableLiquidity = reserve.mTokenAddress == address(0)
            ? 0
            : IERC20Metadata(_asset).balanceOf(reserve.mTokenAddress);
        totalStableDebt = reserve.stableDebtTokenAddress == address(0)
            ? 0
            : IERC20Metadata(reserve.stableDebtTokenAddress).totalSupply();
        totalVariableDebt = reserve.variableDebtTokenAddress == address(0)
            ? 0
            : IERC20Metadata(reserve.variableDebtTokenAddress).totalSupply();
        liquidityRate = reserve.currentLiquidityRate;
        variableBorrowRate = reserve.currentVariableBorrowRate;
        stableBorrowRate = reserve.currentStableBorrowRate;
        averageStableBorrowRate = reserve.stableDebtTokenAddress == address(0)
            ? 0
            : IStableDebtToken(reserve.stableDebtTokenAddress).getAverageStableRate();
        liquidityIndex = reserve.liquidityIndex;
        variableBorrowIndex = reserve.variableBorrowIndex;
        lastUpdateTimestamp = reserve.lastUpdateTimestamp;
    }
}
