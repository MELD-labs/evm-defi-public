// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IReserveInterestRateStrategy} from "../interfaces/IReserveInterestRateStrategy.sol";
import {ILendingRateOracle} from "../interfaces/ILendingRateOracle.sol";
import {WadRayMath} from "../libraries/math/WadRayMath.sol";
import {PercentageMath} from "../libraries/math/PercentageMath.sol";
import {Errors} from "../libraries/helpers/Errors.sol";
import {LendingBase, IAddressesProvider} from "../base/LendingBase.sol";

/**
 * @title DefaultReserveInterestRateStrategy contract
 * @notice Implements the calculation of the interest rates depending on the reserve state
 * @dev The model of interest rate is based on 2 slopes, one before the `optimalUtilizationRate`
 * point of utilization and another from that one to 100%
 * @author MELD team
 */
contract DefaultReserveInterestRateStrategy is LendingBase, IReserveInterestRateStrategy {
    using WadRayMath for uint256;
    using PercentageMath for uint256;

    struct CalcInterestRatesLocalVars {
        uint256 totalDebt;
        uint256 currentVariableBorrowRate;
        uint256 currentStableBorrowRate;
        uint256 currentLiquidityRate;
        uint256 utilizationRate;
    }

    /**
     * @notice this constant represents the utilization rate at which the pool aims to obtain most competitive borrow rates.
     * Expressed in ray
     */
    uint256 public immutable optimalUtilizationRate;

    /**
     * @notice This constant represents the excess utilization rate above the optimal. It's always equal to
     * 1-optimal utilization rate. Added as a constant here for gas optimizations.
     * Expressed in ray
     */

    uint256 public immutable excessUtilizationRate;

    // Base variable borrow rate when Utilization rate = 0. Expressed in ray
    uint256 public immutable baseVariableBorrowRate;

    // Slope of the variable interest curve when utilization rate > 0 and <= optimalUtilizationRate. Expressed in ray
    uint256 public immutable variableRateSlope1;

    // Slope of the variable interest curve when utilization rate > optimalUtilizationRate. Expressed in ray
    uint256 public immutable variableRateSlope2;

    // Slope of the stable interest curve when utilization rate > 0 and <= optimalUtilizationRate. Expressed in ray
    uint256 public immutable stableRateSlope1;

    // Slope of the stable interest curve when utilization rate > optimalUtilizationRate. Expressed in ray
    uint256 public immutable stableRateSlope2;

    /**
     * @notice Initializes the DefaultReserveInterestRateStrategy
     * @param _addressesProvider The address of the AddressesProvider
     * @param _optimalUtilizationRate Optimal utilization rate
     * @param _baseVariableBorrowRate Base variable borrow rate
     * @param _variableRateSlope1 Slope 1 of the variable interest curve
     * @param _variableRateSlope2 Slope 2 of the variable interest curve
     * @param _stableRateSlope1 Slope 1 of the stable interest curve
     * @param _stableRateSlope2 Slope 2 of the stable interest curve
     */
    constructor(
        IAddressesProvider _addressesProvider,
        uint256 _optimalUtilizationRate,
        uint256 _baseVariableBorrowRate,
        uint256 _variableRateSlope1,
        uint256 _variableRateSlope2,
        uint256 _stableRateSlope1,
        uint256 _stableRateSlope2
    ) {
        optimalUtilizationRate = _optimalUtilizationRate;
        excessUtilizationRate = WadRayMath.ray() - _optimalUtilizationRate;
        addressesProvider = _addressesProvider;
        baseVariableBorrowRate = _baseVariableBorrowRate;
        variableRateSlope1 = _variableRateSlope1;
        variableRateSlope2 = _variableRateSlope2;
        stableRateSlope1 = _stableRateSlope1;
        stableRateSlope2 = _stableRateSlope2;
    }

    /**
     * @notice Returns the max variable borrow rate
     * @dev The max variable borrow rate is the base variable borrow rate plus the variable rate slopes
     * @return The max variable borrow rate
     */
    function getMaxVariableBorrowRate() external view override returns (uint256) {
        return baseVariableBorrowRate + variableRateSlope1 + variableRateSlope2;
    }

    /**
     * @notice Calculates the interest rates depending on the reserve's state and configurations
     * @param _reserve The address of the reserve
     * @param _mToken The address of the mToken for the reserve
     * @param _liquidityAdded The liquidity added during the operation
     * @param _liquidityTaken The liquidity taken during the operation
     * @param _totalStableDebt The total borrowed from the reserve at a stable rate
     * @param _totalVariableDebt The total borrowed from the reserve at a variable rate
     * @param _averageStableBorrowRate The weighted average of all the stable rate loans
     * @param _reserveFactor The reserve portion of the interest that goes to the treasury of the market
     * @return The liquidity rate, the stable borrow rate and the variable borrow rate
     */
    function calculateInterestRates(
        address _reserve,
        address _mToken,
        uint256 _liquidityAdded,
        uint256 _liquidityTaken,
        uint256 _totalStableDebt,
        uint256 _totalVariableDebt,
        uint256 _averageStableBorrowRate,
        uint256 _reserveFactor
    ) external view override returns (uint256, uint256, uint256) {
        uint256 availableLiquidity = IERC20(_reserve).balanceOf(_mToken);

        uint256 sumLiquidity = availableLiquidity + _liquidityAdded;
        require(sumLiquidity >= _liquidityTaken, Errors.CURRENT_AVAILABLE_LIQUIDITY_NOT_ENOUGH);
        availableLiquidity = sumLiquidity - _liquidityTaken;

        return
            calculateInterestRates(
                _reserve,
                availableLiquidity,
                _totalStableDebt,
                _totalVariableDebt,
                _averageStableBorrowRate,
                _reserveFactor
            );
    }

    /**
     * @notice Calculates the interest rates depending on the reserve's state and configurations.
     * NOTE This function is kept for compatibility with the previous DefaultInterestRateStrategy interface.
     * New protocol implementation uses the new calculateInterestRates() interface
     * @param _reserve The address of the reserve
     * @param _availableLiquidity The liquidity available in the corresponding mToken
     * @param _totalStableDebt The total borrowed from the reserve at a stable rate
     * @param _totalVariableDebt The total borrowed from the reserve at a variable rate
     * @param _averageStableBorrowRate The weighted average of all the stable rate loans
     * @param _reserveFactor The reserve portion of the interest that goes to the treasury of the market
     * @return The liquidity rate, the stable borrow rate and the variable borrow rate
     */
    function calculateInterestRates(
        address _reserve,
        uint256 _availableLiquidity,
        uint256 _totalStableDebt,
        uint256 _totalVariableDebt,
        uint256 _averageStableBorrowRate,
        uint256 _reserveFactor
    ) public view override returns (uint256, uint256, uint256) {
        CalcInterestRatesLocalVars memory vars;

        vars.totalDebt = _totalStableDebt + _totalVariableDebt;
        vars.currentVariableBorrowRate = 0;
        vars.currentStableBorrowRate = 0;
        vars.currentLiquidityRate = 0;

        vars.utilizationRate = vars.totalDebt == 0
            ? 0
            : vars.totalDebt.rayDiv(_availableLiquidity + vars.totalDebt);

        (uint256 baseStableBorrowRate, bool oracleSuccess) = ILendingRateOracle(
            addressesProvider.getLendingRateOracle()
        ).getMarketBorrowRate(_reserve);

        require(oracleSuccess, Errors.INVALID_MARKET_BORROW_RATE);

        if (vars.utilizationRate > optimalUtilizationRate) {
            uint256 excessUtilizationRateRatio = (vars.utilizationRate - optimalUtilizationRate)
                .rayDiv(excessUtilizationRate);

            vars.currentStableBorrowRate =
                baseStableBorrowRate +
                stableRateSlope1 +
                (stableRateSlope2.rayMul(excessUtilizationRateRatio));

            vars.currentVariableBorrowRate =
                baseVariableBorrowRate +
                variableRateSlope1 +
                (variableRateSlope2.rayMul(excessUtilizationRateRatio));
        } else {
            vars.currentStableBorrowRate =
                baseStableBorrowRate +
                (stableRateSlope1.rayMul(vars.utilizationRate.rayDiv(optimalUtilizationRate)));
            vars.currentVariableBorrowRate =
                baseVariableBorrowRate +
                (vars.utilizationRate.rayMul(variableRateSlope1).rayDiv(optimalUtilizationRate));
        }

        vars.currentLiquidityRate = _getOverallBorrowRate(
            _totalStableDebt,
            _totalVariableDebt,
            vars.currentVariableBorrowRate,
            _averageStableBorrowRate
        ).rayMul(vars.utilizationRate).percentMul(
                PercentageMath.PERCENTAGE_FACTOR - _reserveFactor
            );

        return (
            vars.currentLiquidityRate,
            vars.currentStableBorrowRate,
            vars.currentVariableBorrowRate
        );
    }

    /**
     * @notice Calculates the overall borrow rate as the weighted average between the total variable debt and total stable debt
     * @param _totalStableDebt The total borrowed from the reserve a stable rate
     * @param _totalVariableDebt The total borrowed from the reserve at a variable rate
     * @param _currentVariableBorrowRate The current variable borrow rate of the reserve
     * @param _currentAverageStableBorrowRate The current weighted average of all the stable rate loans
     * @return The weighted averaged borrow rate
     */
    function _getOverallBorrowRate(
        uint256 _totalStableDebt,
        uint256 _totalVariableDebt,
        uint256 _currentVariableBorrowRate,
        uint256 _currentAverageStableBorrowRate
    ) internal pure returns (uint256) {
        uint256 totalDebt = _totalStableDebt + _totalVariableDebt;

        if (totalDebt == 0) return 0;

        uint256 weightedVariableRate = _totalVariableDebt.wadToRay().rayMul(
            _currentVariableBorrowRate
        );

        uint256 weightedStableRate = _totalStableDebt.wadToRay().rayMul(
            _currentAverageStableBorrowRate
        );

        uint256 overallBorrowRate = (weightedVariableRate + weightedStableRate).rayDiv(
            totalDebt.wadToRay()
        );

        return overallBorrowRate;
    }
}
