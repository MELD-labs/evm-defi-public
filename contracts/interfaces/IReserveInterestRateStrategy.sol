// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title IReserveInterestRateStrategy interface
 * @notice Interface for the interest rate strategy of a reserve
 * @author MELD team
 */
interface IReserveInterestRateStrategy {
    /**
     * @notice Returns the base variable borrow rate
     * @return The base variable borrow rate
     */
    function baseVariableBorrowRate() external view returns (uint256);

    /**
     * @notice Returns the max variable borrow rate
     * @dev The max variable borrow rate is the base variable borrow rate plus the variable rate slopes
     * @return The max variable borrow rate
     */
    function getMaxVariableBorrowRate() external view returns (uint256);

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
    ) external view returns (uint256, uint256, uint256);

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
    ) external view returns (uint256, uint256, uint256);
}
