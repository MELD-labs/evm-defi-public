// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReserveConfiguration, Errors, DataTypes} from "../configuration/ReserveConfiguration.sol";
import {MathUtils, WadRayMath} from "../math/MathUtils.sol";
import {PercentageMath} from "../math/PercentageMath.sol";
import {IVariableDebtToken} from "../../interfaces/IVariableDebtToken.sol";
import {IStableDebtToken} from "../../interfaces/IStableDebtToken.sol";
import {IMToken} from "../../interfaces/IMToken.sol";
import {IReserveInterestRateStrategy} from "../../interfaces/IReserveInterestRateStrategy.sol";

/**
 * @title ReserveLogic library
 * @notice Implements the logic to update the reserves state
 * @dev The library is used by the LendingPool, LiquidationLogic, ValidationLogic, and GenericLogic to update the state of the reserves
 * @author MELD team
 */
library ReserveLogic {
    using WadRayMath for uint256;
    using PercentageMath for uint256;

    using ReserveLogic for DataTypes.ReserveData;
    using ReserveConfiguration for DataTypes.ReserveConfigurationMap;

    struct MintToTreasuryLocalVars {
        uint256 currentStableDebt;
        uint256 principalStableDebt;
        uint256 previousStableDebt;
        uint256 currentVariableDebt;
        uint256 previousVariableDebt;
        uint256 avgStableRate;
        uint256 cumulatedStableInterest;
        uint256 totalDebtAccrued;
        uint256 amountToMint;
        uint256 reserveFactor;
        uint40 stableSupplyUpdatedTimestamp;
    }

    struct UpdateInterestRatesLocalVars {
        address stableDebtTokenAddress;
        uint256 totalStableDebt;
        uint256 newLiquidityRate;
        uint256 newStableRate;
        uint256 newVariableRate;
        uint256 avgStableRate;
        uint256 totalVariableDebt;
    }

    /**
     * @notice Emitted when a reserve's state is updated
     * @param asset The address of the underlying asset of the reserve
     * @param liquidityRate The new liquidity rate
     * @param stableBorrowRate The new stable borrow rate
     * @param variableBorrowRate The new variable borrow rate
     * @param liquidityIndex The new liquidity index
     * @param variableBorrowIndex The new variable borrow index
     */
    event ReserveDataUpdated(
        address indexed asset,
        uint256 liquidityRate,
        uint256 stableBorrowRate,
        uint256 variableBorrowRate,
        uint256 liquidityIndex,
        uint256 variableBorrowIndex
    );

    /**
     * @notice Initializes a reserve
     * @param _reserve The reserve object
     * @param _mTokenAddress The address of the mToken contract
     * @param _stableDebtTokenAddress The address of the stable debt token contract
     * @param _variableDebtTokenAddress The address of the variable debt token contract
     * @param _interestRateStrategyAddress The address of the interest rate strategy contract
     */
    function init(
        DataTypes.ReserveData storage _reserve,
        address _mTokenAddress,
        address _stableDebtTokenAddress,
        address _variableDebtTokenAddress,
        address _interestRateStrategyAddress
    ) external {
        require(_reserve.mTokenAddress == address(0), Errors.RL_RESERVE_ALREADY_INITIALIZED);

        _reserve.liquidityIndex = uint128(WadRayMath.ray());
        _reserve.variableBorrowIndex = uint128(WadRayMath.ray());
        _reserve.mTokenAddress = _mTokenAddress;
        _reserve.stableDebtTokenAddress = _stableDebtTokenAddress;
        _reserve.variableDebtTokenAddress = _variableDebtTokenAddress;
        _reserve.interestRateStrategyAddress = _interestRateStrategyAddress;
    }

    /**
     * @notice Updates the state of a reserve
     * @param _reserve The reserve object
     */
    function updateState(DataTypes.ReserveData storage _reserve) internal {
        uint256 scaledVariableDebt = IVariableDebtToken(_reserve.variableDebtTokenAddress)
            .scaledTotalSupply();
        uint256 previousVariableBorrowIndex = _reserve.variableBorrowIndex;
        uint256 previousLiquidityIndex = _reserve.liquidityIndex;
        uint40 lastUpdatedTimestamp = _reserve.lastUpdateTimestamp;

        (uint256 newLiquidityIndex, uint256 newVariableBorrowIndex) = _updateIndexes(
            _reserve,
            scaledVariableDebt,
            previousLiquidityIndex,
            previousVariableBorrowIndex,
            lastUpdatedTimestamp
        );

        _mintToTreasury(
            _reserve,
            scaledVariableDebt,
            previousVariableBorrowIndex,
            newLiquidityIndex,
            newVariableBorrowIndex,
            lastUpdatedTimestamp
        );
    }

    /**
     * @notice Updates the interest rates of the reserve
     * @param _reserve The reserve object
     * @param _reserveAddress The address of the reserve
     * @param _mTokenAddress The address of the mToken contract
     * @param _liquidityAdded The amount of liquidity added to the protocol
     * @param _liquidityTaken The amount of liquidity taken from the protocol
     */
    function updateInterestRates(
        DataTypes.ReserveData storage _reserve,
        address _reserveAddress,
        address _mTokenAddress,
        uint256 _liquidityAdded,
        uint256 _liquidityTaken
    ) internal {
        UpdateInterestRatesLocalVars memory vars;

        vars.stableDebtTokenAddress = _reserve.stableDebtTokenAddress;

        (vars.totalStableDebt, vars.avgStableRate) = IStableDebtToken(vars.stableDebtTokenAddress)
            .getTotalSupplyAndAvgRate();

        //calculates the total variable debt locally using the scaled total supply instead
        //of totalSupply(), as it's noticeably cheaper. Also, the index has been
        //updated by the previous updateState() call
        vars.totalVariableDebt = IVariableDebtToken(_reserve.variableDebtTokenAddress)
            .scaledTotalSupply()
            .rayMul(_reserve.variableBorrowIndex);

        (
            vars.newLiquidityRate,
            vars.newStableRate,
            vars.newVariableRate
        ) = IReserveInterestRateStrategy(_reserve.interestRateStrategyAddress)
            .calculateInterestRates(
                _reserveAddress,
                _mTokenAddress,
                _liquidityAdded,
                _liquidityTaken,
                vars.totalStableDebt,
                vars.totalVariableDebt,
                vars.avgStableRate,
                _reserve.configuration.getReserveFactor()
            );
        require(vars.newLiquidityRate <= type(uint128).max, Errors.RL_LIQUIDITY_RATE_OVERFLOW);
        require(vars.newStableRate <= type(uint128).max, Errors.RL_STABLE_BORROW_RATE_OVERFLOW);
        require(vars.newVariableRate <= type(uint128).max, Errors.RL_VARIABLE_BORROW_RATE_OVERFLOW);

        _reserve.currentLiquidityRate = uint128(vars.newLiquidityRate);
        _reserve.currentStableBorrowRate = uint128(vars.newStableRate);
        _reserve.currentVariableBorrowRate = uint128(vars.newVariableRate);

        emit ReserveDataUpdated(
            _reserveAddress,
            vars.newLiquidityRate,
            vars.newStableRate,
            vars.newVariableRate,
            _reserve.liquidityIndex,
            _reserve.variableBorrowIndex
        );
    }

    /**
     * @notice Returns the ongoing normalized income for the reserve
     * @dev A value of 1e27 means there is no income. As time passes, the income is accrued
     * @dev A value of 2*1e27 means for each unit of asset one unit of income has been accrued
     * @param _reserve The reserve object
     * @return the normalized income. expressed in ray
     */
    function getNormalizedIncome(
        DataTypes.ReserveData storage _reserve
    ) internal view returns (uint256) {
        uint40 timestamp = _reserve.lastUpdateTimestamp;

        if (timestamp == uint40(block.timestamp)) {
            //if the index was updated in the same block, no need to perform any calculation
            return _reserve.liquidityIndex;
        }

        uint256 cumulated = MathUtils
            .calculateLinearInterest(_reserve.currentLiquidityRate, timestamp)
            .rayMul(_reserve.liquidityIndex);

        return cumulated;
    }

    /**
     * @notice Returns the ongoing normalized variable debt for the reserve
     * @dev A value of 1e27 means there is no debt. As time passes, the income is accrued
     * @dev A value of 2*1e27 means that for each unit of debt, one unit worth of interest has been accumulated
     * @param _reserve The reserve object
     * @return The normalized variable debt. expressed in ray
     */
    function getNormalizedDebt(
        DataTypes.ReserveData storage _reserve
    ) internal view returns (uint256) {
        uint40 timestamp = _reserve.lastUpdateTimestamp;

        if (timestamp == uint40(block.timestamp)) {
            //if the index was updated in the same block, no need to perform any calculation
            return _reserve.variableBorrowIndex;
        }

        uint256 cumulated = MathUtils
            .calculateCompoundedInterest(_reserve.currentVariableBorrowRate, timestamp)
            .rayMul(_reserve.variableBorrowIndex);

        return cumulated;
    }

    /**
     * @notice Minting new tokens to the treasury as a result of the state update
     * @param _reserve The reserve object
     * @param _scaledVariableDebt The scaled total variable debt
     * @param _previousVariableBorrowIndex The index of the variable borrow at the last update
     * @param _newLiquidityIndex The new liquidity index
     * @param _newVariableBorrowIndex The new variable borrow index
     * @param _timestamp The timestamp of the last update
     */
    function _mintToTreasury(
        DataTypes.ReserveData storage _reserve,
        uint256 _scaledVariableDebt,
        uint256 _previousVariableBorrowIndex,
        uint256 _newLiquidityIndex,
        uint256 _newVariableBorrowIndex,
        uint40 _timestamp
    ) private {
        MintToTreasuryLocalVars memory vars;

        vars.reserveFactor = _reserve.configuration.getReserveFactor();

        if (vars.reserveFactor == 0) {
            return;
        }

        //fetching the principal, total stable debt and the avg stable rate
        (
            vars.principalStableDebt,
            vars.currentStableDebt,
            vars.avgStableRate,
            vars.stableSupplyUpdatedTimestamp
        ) = IStableDebtToken(_reserve.stableDebtTokenAddress).getSupplyData();

        //calculate the last principal variable debt
        vars.previousVariableDebt = _scaledVariableDebt.rayMul(_previousVariableBorrowIndex);

        //calculate the new total supply after accumulation of the index
        vars.currentVariableDebt = _scaledVariableDebt.rayMul(_newVariableBorrowIndex);

        //calculate the stable debt until the last timestamp update
        vars.cumulatedStableInterest = MathUtils.calculateCompoundedInterest(
            vars.avgStableRate,
            vars.stableSupplyUpdatedTimestamp,
            _timestamp
        );

        vars.previousStableDebt = vars.principalStableDebt.rayMul(vars.cumulatedStableInterest);

        //debt accrued is the sum of the current debt minus the sum of the debt at the last update
        vars.totalDebtAccrued =
            vars.currentVariableDebt +
            vars.currentStableDebt -
            vars.previousVariableDebt -
            vars.previousStableDebt;

        vars.amountToMint = vars.totalDebtAccrued.percentMul(vars.reserveFactor);

        if (vars.amountToMint != 0) {
            IMToken(_reserve.mTokenAddress).mintToTreasury(vars.amountToMint, _newLiquidityIndex);
        }
    }

    /**
     * @notice Updates the liquidity cumulative index and variable borrow index
     * @param _reserve The reserve object
     * @param _scaledVariableDebt The scaled total variable debt
     * @param _liquidityIndex The last stored liquidity index
     * @param _variableBorrowIndex The last stored variable borrow index
     * @param _timestamp The timestamp of the last update
     * @return The new liquidity index and the new variable borrow index
     */
    function _updateIndexes(
        DataTypes.ReserveData storage _reserve,
        uint256 _scaledVariableDebt,
        uint256 _liquidityIndex,
        uint256 _variableBorrowIndex,
        uint40 _timestamp
    ) private returns (uint256, uint256) {
        uint256 currentLiquidityRate = _reserve.currentLiquidityRate;

        uint256 newLiquidityIndex = _liquidityIndex;
        uint256 newVariableBorrowIndex = _variableBorrowIndex;

        //only cumulating if there is any income being produced
        if (currentLiquidityRate > 0) {
            uint256 cumulatedLiquidityInterest = MathUtils.calculateLinearInterest(
                currentLiquidityRate,
                _timestamp
            );
            newLiquidityIndex = cumulatedLiquidityInterest.rayMul(_liquidityIndex);
            require(newLiquidityIndex <= type(uint128).max, Errors.RL_LIQUIDITY_INDEX_OVERFLOW);

            _reserve.liquidityIndex = uint128(newLiquidityIndex);

            //as the liquidity rate might come only from stable rate loans, we need to ensure
            //that there is actual variable debt before accumulating
            if (_scaledVariableDebt != 0) {
                uint256 cumulatedVariableBorrowInterest = MathUtils.calculateCompoundedInterest(
                    _reserve.currentVariableBorrowRate,
                    _timestamp
                );
                newVariableBorrowIndex = cumulatedVariableBorrowInterest.rayMul(
                    _variableBorrowIndex
                );
                require(
                    newVariableBorrowIndex <= type(uint128).max,
                    Errors.RL_VARIABLE_BORROW_INDEX_OVERFLOW
                );
                _reserve.variableBorrowIndex = uint128(newVariableBorrowIndex);
            }
        }

        _reserve.lastUpdateTimestamp = uint40(block.timestamp);
        return (newLiquidityIndex, newVariableBorrowIndex);
    }
}
