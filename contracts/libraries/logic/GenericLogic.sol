// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    ReserveLogic,
    ReserveConfiguration,
    DataTypes,
    Errors,
    WadRayMath,
    PercentageMath
} from "./ReserveLogic.sol";
import {UserConfiguration} from "../configuration/UserConfiguration.sol";
import {IPriceOracle} from "../../interfaces/IPriceOracle.sol";

/**
 * @title GenericLogic library
 * @notice Implements generic logic for various protocol functions
 * @author MELD team
 */
library GenericLogic {
    using ReserveLogic for DataTypes.ReserveData;
    using WadRayMath for uint256;
    using PercentageMath for uint256;
    using ReserveConfiguration for DataTypes.ReserveConfigurationMap;
    using UserConfiguration for DataTypes.UserConfigurationMap;

    struct CalculateUserAccountDataVars {
        uint256 reserveUnitPrice;
        uint256 tokenUnit;
        uint256 compoundedLiquidityBalance;
        uint256 compoundedBorrowBalance;
        uint256 decimals;
        uint256 ltv;
        uint256 liquidationThreshold;
        uint256 i;
        uint256 healthFactor;
        uint256 totalCollateralInUSD;
        uint256 totalDebtInUSD;
        uint256 avgLtv;
        uint256 avgLiquidationThreshold;
        address currentReserveAddress;
    }

    struct BalanceDecreaseAllowedLocalVars {
        uint256 decimals;
        uint256 liquidationThreshold;
        uint256 totalCollateralInUSD;
        uint256 totalDebtInUSD;
        uint256 avgLiquidationThreshold;
        uint256 amountToDecreaseInUSD;
        uint256 collateralBalanceAfterDecrease;
        uint256 liquidationThresholdAfterDecrease;
        uint256 healthFactorAfterDecrease;
    }

    uint256 public constant HEALTH_FACTOR_LIQUIDATION_THRESHOLD = 1e18; // 1 with 18 decimals of precision

    /**
     * @notice Emitted when a reserve is disabled as collateral for a user
     * @param reserve The address of the reserve
     * @param user The address of the user
     */
    event ReserveUsedAsCollateralDisabled(address indexed reserve, address indexed user);

    /**
     * @notice Emitted when a reserve is enabled as collateral for a user
     * @param reserve The address of the reserve
     * @param user The address of the user
     */
    event ReserveUsedAsCollateralEnabled(address indexed reserve, address indexed user);

    /**
     * @notice Emitted when a user diables genius loans
     * @param user The address of the user
     */
    event GeniusLoanDisabled(address indexed user);

    /**
     * @notice Emitted when a user enables genius loans
     * @param user The address of the user
     */
    event GeniusLoanEnabled(address indexed user);

    /**
     * @notice Checks if a specific balance decrease is allowed
     * (i.e. doesn't bring the user borrow position health factor under HEALTH_FACTOR_LIQUIDATION_THRESHOLD)
     * @param _asset The address of the underlying asset of the reserve
     * @param _user The address of the user
     * @param _amount The amount to decrease
     * @param _reservesData The data of all the reserves
     * @param _userConfig The user configuration
     * @param _reserves The list of all the active reserves
     * @param _oracle The address of the oracle contract
     * @return true if the decrease of the balance is allowed
     */
    function balanceDecreaseAllowed(
        address _asset,
        address _user,
        uint256 _amount,
        mapping(address => DataTypes.ReserveData) storage _reservesData,
        DataTypes.UserConfigurationMap calldata _userConfig,
        mapping(uint256 => address) storage _reserves,
        uint256 _reservesCount,
        address _oracle
    ) external view returns (bool) {
        if (
            !_userConfig.isBorrowingAny() ||
            !_userConfig.isUsingAsCollateral(_reservesData[_asset].id)
        ) {
            return true;
        }

        BalanceDecreaseAllowedLocalVars memory vars;

        DataTypes.ReserveConfigurationData memory reserveConfigData = _reservesData[_asset]
            .configuration
            .getReserveConfigurationData();
        (vars.liquidationThreshold, vars.decimals) = (
            reserveConfigData.liquidationThreshold,
            reserveConfigData.decimals
        );

        if (vars.liquidationThreshold == 0) {
            return true;
        }

        (
            vars.totalCollateralInUSD,
            vars.totalDebtInUSD,
            ,
            vars.avgLiquidationThreshold,

        ) = calculateUserAccountData(
            _user,
            _reservesData,
            _userConfig,
            _reserves,
            _reservesCount,
            _oracle
        );

        if (vars.totalDebtInUSD == 0) {
            return true;
        }

        (uint256 assetPrice, bool oracleSuccess) = IPriceOracle(_oracle).getAssetPrice(_asset);
        require(oracleSuccess, Errors.INVALID_ASSET_PRICE);
        vars.amountToDecreaseInUSD = (assetPrice * _amount) / (10 ** vars.decimals);

        vars.collateralBalanceAfterDecrease =
            vars.totalCollateralInUSD -
            vars.amountToDecreaseInUSD;

        //if there is a borrow, there can't be 0 collateral
        if (vars.collateralBalanceAfterDecrease == 0) {
            return false;
        }

        vars.liquidationThresholdAfterDecrease =
            ((vars.totalCollateralInUSD * vars.avgLiquidationThreshold) -
                (vars.amountToDecreaseInUSD * vars.liquidationThreshold)) /
            vars.collateralBalanceAfterDecrease;

        vars.healthFactorAfterDecrease = calculateHealthFactorFromBalances(
            vars.collateralBalanceAfterDecrease,
            vars.totalDebtInUSD,
            vars.liquidationThresholdAfterDecrease
        );

        return vars.healthFactorAfterDecrease >= GenericLogic.HEALTH_FACTOR_LIQUIDATION_THRESHOLD;
    }

    /**
     * @notice Calculates the equivalent amount in USD that an user can borrow, depending on the available collateral and the
     * average Loan To Value
     * @param _totalCollateralInUSD The total collateral in USD
     * @param _totalDebtInUSD The total debt in USD
     * @param _ltv The average loan to value
     * @return the amount available to borrow in USD for the user
     */
    function calculateAvailableBorrowsUSD(
        uint256 _totalCollateralInUSD,
        uint256 _totalDebtInUSD,
        uint256 _ltv
    ) external pure returns (uint256) {
        uint256 availableBorrowsUSD = _totalCollateralInUSD.percentMul(_ltv);

        if (availableBorrowsUSD < _totalDebtInUSD) {
            return 0;
        }

        availableBorrowsUSD = availableBorrowsUSD - _totalDebtInUSD;
        return availableBorrowsUSD;
    }

    /**
     * @notice Calculates the user data across the reserves.
     * this includes the total liquidity/collateral/borrow balances in USD,
     * the average Loan To Value, the average Liquidation Ratio, and the Health factor.
     * @param _user The address of the user
     * @param _reservesData Data of all the reserves
     * @param _userConfig The configuration of the user
     * @param _reserves The list of the available reserves
     * @param _oracle The price oracle address
     * @return The total collateral and total debt of the user in USD, the avg ltv, liquidation threshold and the HF
     */
    function calculateUserAccountData(
        address _user,
        mapping(address => DataTypes.ReserveData) storage _reservesData,
        DataTypes.UserConfigurationMap memory _userConfig,
        mapping(uint256 => address) storage _reserves,
        uint256 _reservesCount,
        address _oracle
    ) public view returns (uint256, uint256, uint256, uint256, uint256) {
        CalculateUserAccountDataVars memory vars;

        if (_userConfig.isEmpty()) {
            return (0, 0, 0, 0, type(uint256).max);
        }
        for (vars.i = 0; vars.i < _reservesCount; vars.i++) {
            if (!_userConfig.isUsingAsCollateralOrBorrowing(vars.i)) {
                continue;
            }

            vars.currentReserveAddress = _reserves[vars.i];
            DataTypes.ReserveData storage currentReserve = _reservesData[
                vars.currentReserveAddress
            ];

            {
                DataTypes.ReserveConfigurationData memory reserveConfigData = currentReserve
                    .configuration
                    .getReserveConfigurationData();
                (vars.ltv, vars.liquidationThreshold, vars.decimals) = (
                    reserveConfigData.ltv,
                    reserveConfigData.liquidationThreshold,
                    reserveConfigData.decimals
                );
            }
            vars.tokenUnit = 10 ** vars.decimals;
            bool oracleSuccess;
            (vars.reserveUnitPrice, oracleSuccess) = IPriceOracle(_oracle).getAssetPrice(
                vars.currentReserveAddress
            );
            require(oracleSuccess, Errors.INVALID_ASSET_PRICE);

            if (vars.liquidationThreshold != 0 && _userConfig.isUsingAsCollateral(vars.i)) {
                vars.compoundedLiquidityBalance = IERC20(currentReserve.mTokenAddress).balanceOf(
                    _user
                );

                uint256 liquidityBalanceUSD = (vars.reserveUnitPrice *
                    vars.compoundedLiquidityBalance) / vars.tokenUnit;

                vars.totalCollateralInUSD = vars.totalCollateralInUSD + liquidityBalanceUSD;

                vars.avgLtv = vars.avgLtv + (liquidityBalanceUSD * vars.ltv);
                vars.avgLiquidationThreshold =
                    vars.avgLiquidationThreshold +
                    (liquidityBalanceUSD * vars.liquidationThreshold);
            }

            if (_userConfig.isBorrowing(vars.i)) {
                vars.compoundedBorrowBalance = IERC20(currentReserve.stableDebtTokenAddress)
                    .balanceOf(_user);
                vars.compoundedBorrowBalance =
                    vars.compoundedBorrowBalance +
                    IERC20(currentReserve.variableDebtTokenAddress).balanceOf(_user);

                vars.totalDebtInUSD =
                    vars.totalDebtInUSD +
                    ((vars.reserveUnitPrice * vars.compoundedBorrowBalance) / vars.tokenUnit);
            }
        }

        vars.avgLtv = vars.totalCollateralInUSD > 0 ? vars.avgLtv / vars.totalCollateralInUSD : 0;
        vars.avgLiquidationThreshold = vars.totalCollateralInUSD > 0
            ? vars.avgLiquidationThreshold / vars.totalCollateralInUSD
            : 0;

        vars.healthFactor = calculateHealthFactorFromBalances(
            vars.totalCollateralInUSD,
            vars.totalDebtInUSD,
            vars.avgLiquidationThreshold
        );
        return (
            vars.totalCollateralInUSD,
            vars.totalDebtInUSD,
            vars.avgLtv,
            vars.avgLiquidationThreshold,
            vars.healthFactor
        );
    }

    /**
     * @notice Calculates the health factor from the corresponding balances
     * @param _totalCollateralInUSD The total collateral in USD
     * @param _totalDebtInUSD The total debt in USD
     * @param _liquidationThreshold The avg liquidation threshold
     * @return The health factor calculated from the balances provided
     */
    function calculateHealthFactorFromBalances(
        uint256 _totalCollateralInUSD,
        uint256 _totalDebtInUSD,
        uint256 _liquidationThreshold
    ) public pure returns (uint256) {
        if (_totalDebtInUSD == 0) return type(uint256).max;

        return (_totalCollateralInUSD.percentMul(_liquidationThreshold)).wadDiv(_totalDebtInUSD);
    }
}
