// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title IScaledBalanceToken interface
 * @notice Interface for the scaled balance token
 * @author MELD team
 */
interface IScaledBalanceToken {
    /**
     * @notice Returns the scaled balance of the user. The scaled balance is the sum of all the
     * updated stored balance divided by the reserve's liquidity index at the moment of the update
     * @param _user The user whose balance is calculated
     * @return The scaled balance of the user
     */
    function scaledBalanceOf(address _user) external view returns (uint256);

    /**
     * @notice Returns the scaled balance of the user and the scaled total supply.
     * @param _user The address of the user
     * @return The scaled balance of the user
     * @return The scaled balance and the scaled total supply
     */
    function getScaledUserBalanceAndSupply(address _user) external view returns (uint256, uint256);

    /**
     * @notice Returns the scaled total supply of the token. Represents sum(debt/index)
     * @return The scaled total supply
     */
    function scaledTotalSupply() external view returns (uint256);
}
