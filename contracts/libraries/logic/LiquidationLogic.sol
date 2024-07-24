// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {
    ValidationLogic,
    GenericLogic,
    ReserveLogic,
    ReserveConfiguration,
    UserConfiguration,
    Errors,
    DataTypes,
    PercentageMath,
    WadRayMath
} from "./ValidationLogic.sol";
import {IMToken} from "../../interfaces/IMToken.sol";
import {IPriceOracle} from "../../interfaces/IPriceOracle.sol";
import {IStableDebtToken} from "../../interfaces/IStableDebtToken.sol";
import {IVariableDebtToken} from "../../interfaces/IVariableDebtToken.sol";

/**
 * @title LiquidationLogic library
 * @notice Implements actions involving liquidations
 * @author MELD team
 */
library LiquidationLogic {
    using SafeERC20 for IERC20;
    using WadRayMath for uint256;
    using PercentageMath for uint256;
    using ReserveLogic for DataTypes.ReserveData;
    using ReserveConfiguration for DataTypes.ReserveConfigurationMap;
    using UserConfiguration for DataTypes.UserConfigurationMap;

    struct ExecuteLiquidationCallParams {
        uint256 reservesCount;
        uint256 debtToCover;
        uint256 liquidationProtocolFeePercentage;
        address collateralAsset;
        address debtAsset;
        address user;
        address priceOracle;
        bool receiveMToken;
    }

    struct LiquidationCallLocalVars {
        uint256 userCollateralBalance;
        uint256 maxLiquidatableDebt;
        uint256 debtAmountNeeded;
        uint256 healthFactor;
        uint256 liquidatorPreviousMTokenBalance;
        uint256 liquidationBonus;
        uint256 liquidationProtocolActualFee;
        uint256 liquidationProtocolFeeAmount;
        address collateralTreasuryAddress;
        IMToken collateralMToken;
    }

    struct AvailableCollateralToLiquidateLocalVars {
        uint256 collateralPrice;
        uint256 debtAssetPrice;
        uint256 maxAmountCollateralToLiquidate;
        uint256 debtAssetDecimals;
        uint256 collateralDecimals;
    }

    uint256 internal constant LIQUIDATION_CLOSE_FACTOR_PERCENT = 100_00; // 100%

    /**
     * @notice Emitted when a borrower is liquidated
     * @param collateral The address of the collateral being liquidated
     * @param debt The address of the debt reserve
     * @param user The address of the borrower being liquidated
     * @param debtToCover The total amount liquidated
     * @param liquidatedCollateralAmount The amount of collateral being liquidated
     * @param liquidator The address of the liquidator
     * @param receiveMToken true if the liquidator wants to receive mTokens, false otherwise
     */
    event LiquidationCall(
        address indexed collateral,
        address indexed debt,
        address indexed user,
        uint256 debtToCover,
        uint256 liquidatedCollateralAmount,
        address liquidator,
        bool receiveMToken
    );

    /**
     * @notice Function to liquidate a position if its Health Factor drops below 1
     * - The caller (liquidator) covers `debtToCover` amount of debt of the user getting liquidated, and receives
     *   a proportionally amount of the `collateralAsset` plus a bonus to cover market risk.
     *   The protocol takes a fee on the amount being repaid, as a percentage defined relative to the liquidator bonus.
     * @param _reservesData Data of all the reserves
     * @param _reservesList Mapping of all the active reserves.
     * @param _usersConfig Mapping of all user configurations
     * @param _params Struct that contains the parameters needed to liquidate an undercollateralized position. See {ExecuteLiquidationCallParams}
     * to receive the underlying collateral asset directly
     * @return userStableDebt The stable debt of the user being liquidated
     * @return userVariableDebt The variable debt of the user being liquidated
     * @return actualDebtToLiquidate The total amount of debt covered by the liquidator
     * @return maxCollateralToLiquidate The total amount of collateral liquidated. This may not be the amount received by the liquidator if there is a protocol fee.
     */
    function executeLiquidationCall(
        mapping(address => DataTypes.ReserveData) storage _reservesData,
        mapping(uint256 => address) storage _reservesList,
        mapping(address => DataTypes.UserConfigurationMap) storage _usersConfig,
        ExecuteLiquidationCallParams memory _params
    )
        external
        returns (
            uint256 userStableDebt,
            uint256 userVariableDebt,
            uint256 actualDebtToLiquidate,
            uint256 maxCollateralToLiquidate
        )
    {
        require(
            _params.collateralAsset != address(0) &&
                _params.debtAsset != address(0) &&
                _params.user != address(0),
            Errors.INVALID_ADDRESS
        );

        DataTypes.ReserveData storage collateralReserve = _reservesData[_params.collateralAsset];
        DataTypes.ReserveData storage debtReserve = _reservesData[_params.debtAsset];
        DataTypes.UserConfigurationMap storage userConfig = _usersConfig[_params.user];

        LiquidationCallLocalVars memory vars;

        require(
            collateralReserve.configuration.getActive() && debtReserve.configuration.getActive(),
            Errors.VL_NO_ACTIVE_RESERVE
        );

        debtReserve.updateState();

        (, , , , vars.healthFactor) = GenericLogic.calculateUserAccountData(
            _params.user,
            _reservesData,
            userConfig,
            _reservesList,
            _params.reservesCount,
            _params.priceOracle
        );

        (userStableDebt, userVariableDebt) = ValidationLogic.validateLiquidationCall(
            collateralReserve,
            debtReserve,
            userConfig,
            _params.user,
            _params.debtToCover,
            vars.healthFactor
        );

        vars.collateralMToken = IMToken(collateralReserve.mTokenAddress);

        // _params.user == borrower
        vars.userCollateralBalance = vars.collateralMToken.balanceOf(_params.user);

        vars.maxLiquidatableDebt = (userStableDebt + userVariableDebt).percentMul(
            LIQUIDATION_CLOSE_FACTOR_PERCENT
        );

        actualDebtToLiquidate = _params.debtToCover > vars.maxLiquidatableDebt
            ? vars.maxLiquidatableDebt
            : _params.debtToCover;

        vars.liquidationBonus = collateralReserve.configuration.getLiquidationBonus();
        vars.liquidationProtocolActualFee = _params.liquidationProtocolFeePercentage.percentMul(
            (vars.liquidationBonus - PercentageMath.PERCENTAGE_FACTOR)
        );

        (
            maxCollateralToLiquidate,
            vars.debtAmountNeeded
        ) = _calculateAvailableCollateralToLiquidate(
            collateralReserve,
            debtReserve,
            _params.collateralAsset,
            _params.debtAsset,
            _params.priceOracle,
            actualDebtToLiquidate,
            vars.userCollateralBalance,
            vars.liquidationProtocolActualFee + vars.liquidationBonus
        );

        // If debtAmountNeeded < actualDebtToLiquidate, there isn't enough
        // collateral to cover the actual amount that is being liquidated, hence we liquidate
        // a smaller amount
        if (vars.debtAmountNeeded < actualDebtToLiquidate) {
            actualDebtToLiquidate = vars.debtAmountNeeded;
        }

        // If the liquidator reclaims the underlying asset, we make sure there is enough available liquidity in the
        // collateral reserve
        if (!_params.receiveMToken) {
            uint256 currentAvailableCollateral = IERC20(_params.collateralAsset).balanceOf(
                address(vars.collateralMToken)
            );

            require(
                currentAvailableCollateral >= maxCollateralToLiquidate,
                Errors.LL_NOT_ENOUGH_LIQUIDITY_TO_LIQUIDATE
            );
        }

        if (userVariableDebt >= actualDebtToLiquidate) {
            IVariableDebtToken(debtReserve.variableDebtTokenAddress).burn(
                _params.user,
                actualDebtToLiquidate,
                debtReserve.variableBorrowIndex
            );
        } else {
            // If the user doesn't have variable debt, no need to try to burn variable debt tokens
            if (userVariableDebt > 0) {
                IVariableDebtToken(debtReserve.variableDebtTokenAddress).burn(
                    _params.user,
                    userVariableDebt,
                    debtReserve.variableBorrowIndex
                );
            }

            IStableDebtToken(debtReserve.stableDebtTokenAddress).burn(
                _params.user,
                actualDebtToLiquidate - userVariableDebt
            );
        }

        debtReserve.updateInterestRates(
            _params.debtAsset,
            debtReserve.mTokenAddress,
            actualDebtToLiquidate,
            0
        );

        vars.liquidationProtocolFeeAmount = maxCollateralToLiquidate.percentMul(
            vars.liquidationProtocolActualFee
        );

        vars.collateralTreasuryAddress = vars.collateralMToken.RESERVE_TREASURY_ADDRESS();

        if (_params.receiveMToken) {
            vars.liquidatorPreviousMTokenBalance = IERC20(vars.collateralMToken).balanceOf(
                msg.sender
            );

            // Transfer the protocol fee amount of mtokens to the treasury
            vars.collateralMToken.transferOnLiquidation(
                _params.user,
                vars.collateralTreasuryAddress,
                vars.liquidationProtocolFeeAmount
            );

            // Transfer the rest of mtokens to the liquidator
            vars.collateralMToken.transferOnLiquidation(
                _params.user,
                msg.sender,
                maxCollateralToLiquidate - vars.liquidationProtocolFeeAmount
            );

            if (vars.liquidatorPreviousMTokenBalance == 0) {
                DataTypes.UserConfigurationMap storage liquidatorConfig = _usersConfig[msg.sender];
                liquidatorConfig.setUsingAsCollateral(collateralReserve.id, true);
                emit GenericLogic.ReserveUsedAsCollateralEnabled(
                    _params.collateralAsset,
                    msg.sender
                );
            }
        } else {
            collateralReserve.updateState();
            collateralReserve.updateInterestRates(
                _params.collateralAsset,
                address(vars.collateralMToken),
                0,
                maxCollateralToLiquidate
            );

            // Burn the equivalent protocol fee amount of mToken, sending the underlying to the treasury
            vars.collateralMToken.burn(
                _params.user,
                vars.collateralTreasuryAddress,
                vars.liquidationProtocolFeeAmount,
                collateralReserve.liquidityIndex
            );
            // Burn the equivalent remaining amount of mToken, sending the underlying to the liquidator
            vars.collateralMToken.burn(
                _params.user,
                msg.sender,
                maxCollateralToLiquidate - vars.liquidationProtocolFeeAmount,
                collateralReserve.liquidityIndex
            );
        }

        // If the collateral being liquidated is equal to the user balance,
        // we set the currency as not being used as collateral anymore
        if (maxCollateralToLiquidate == vars.userCollateralBalance) {
            userConfig.setUsingAsCollateral(collateralReserve.id, false);
            emit GenericLogic.ReserveUsedAsCollateralDisabled(
                _params.collateralAsset,
                _params.user
            );
        }

        // Transfers the debt asset being repaid to the mToken, where the liquidity is kept
        IERC20(_params.debtAsset).safeTransferFrom(
            msg.sender,
            debtReserve.mTokenAddress,
            actualDebtToLiquidate
        );

        emit LiquidationCall(
            _params.collateralAsset,
            _params.debtAsset,
            _params.user,
            actualDebtToLiquidate,
            maxCollateralToLiquidate,
            msg.sender,
            _params.receiveMToken
        );
    }

    /**
     * @notice Calculates how much of a specific collateral can be liquidated, given
     * a certain amount of debt asset.
     * - This function needs to be called after all the checks to validate the liquidation have been performed,
     *   otherwise it might fail.
     * @param _collateralReserve The data of the collateral reserve
     * @param _debtReserve The data of the debt reserve
     * @param _collateralAsset The address of the underlying asset used as collateral, to receive as result of the liquidation
     * @param _debtAsset The address of the underlying borrowed asset to be repaid with the liquidation
     * @param _debtToCover The debt amount of borrowed `asset` the liquidator wants to cover
     * @param _userCollateralBalance The collateral balance for the specific `collateralAsset` of the user being liquidated
     * @return collateralAmount: The maximum amount that is possible to liquidate given all the liquidation constraints
     *                           (user balance, close factor)
     *         debtAmountNeeded: The amount to repay with the liquidation
     */
    function _calculateAvailableCollateralToLiquidate(
        DataTypes.ReserveData storage _collateralReserve,
        DataTypes.ReserveData storage _debtReserve,
        address _collateralAsset,
        address _debtAsset,
        address _oracle,
        uint256 _debtToCover,
        uint256 _userCollateralBalance,
        uint256 _liquidationMultiplier
    ) internal view returns (uint256, uint256) {
        uint256 collateralAmount = 0;
        uint256 debtAmountNeeded = 0;
        bool oracleSuccess;

        AvailableCollateralToLiquidateLocalVars memory vars;

        (vars.collateralPrice, oracleSuccess) = IPriceOracle(_oracle).getAssetPrice(
            _collateralAsset
        );
        require(oracleSuccess, Errors.INVALID_ASSET_PRICE);

        (vars.debtAssetPrice, oracleSuccess) = IPriceOracle(_oracle).getAssetPrice(_debtAsset);
        require(oracleSuccess, Errors.INVALID_ASSET_PRICE);

        vars.collateralDecimals = _collateralReserve.configuration.getDecimals();
        vars.debtAssetDecimals = _debtReserve.configuration.getDecimals();

        // This is the maximum possible amount of the selected collateral that can be liquidated, given the
        // max amount of liquidatable debt
        vars.maxAmountCollateralToLiquidate =
            (vars.debtAssetPrice *
                _debtToCover *
                (10 ** vars.collateralDecimals).percentMul(_liquidationMultiplier)) /
            (vars.collateralPrice * (10 ** vars.debtAssetDecimals));

        if (vars.maxAmountCollateralToLiquidate > _userCollateralBalance) {
            collateralAmount = _userCollateralBalance;

            debtAmountNeeded = ((vars.collateralPrice *
                collateralAmount *
                10 ** vars.debtAssetDecimals) /
                (vars.debtAssetPrice * 10 ** vars.collateralDecimals)).percentDiv(
                    _liquidationMultiplier
                );
        } else {
            collateralAmount = vars.maxAmountCollateralToLiquidate;
            debtAmountNeeded = _debtToCover;
        }

        return (collateralAmount, debtAmountNeeded);
    }
}
