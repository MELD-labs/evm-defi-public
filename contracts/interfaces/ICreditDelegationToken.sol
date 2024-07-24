// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title ICreditDelegationToken interface
 * @notice Interface for the MELD credit delegation token.
 * @dev This interface defines the necessary functions for delegating borrowing power to another user.
 * @author MELD team
 */
interface ICreditDelegationToken {
    /**
     * @notice Emitted when borrowing allowance is delegated
     * @param fromUser The user from which the borrowing allowance is delegated
     * @param toUser The user receiving the delegated borrowing allowance
     * @param asset The address of the underlying asset
     * @param amount The amount being delegated
     */
    event BorrowAllowanceDelegated(
        address indexed fromUser,
        address indexed toUser,
        address asset,
        uint256 amount
    );

    /**
     * @notice delegates borrowing power to a user on the specific debt token
     * @param _delegatee the address receiving the delegated borrowing power
     * @param _amount the maximum amount being delegated. Delegation will still
     * respect the liquidation constraints (even if delegated, a delegatee cannot
     * force a delegator HF to go below 1)
     */
    function approveDelegation(address _delegatee, uint256 _amount) external;

    /**
     * @notice returns the borrow allowance of the user
     * @param _fromUser The user to giving allowance
     * @param _toUser The user to give allowance to
     * @return the current allowance of toUser
     */
    function borrowAllowance(address _fromUser, address _toUser) external view returns (uint256);
}
