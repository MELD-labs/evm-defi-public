// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {LendingBase} from "../../base/LendingBase.sol";
import {Errors} from "../../libraries/helpers/Errors.sol";
import {IncentivizedERC20} from "../IncentivizedERC20.sol";
import {ICreditDelegationToken} from "../../interfaces/ICreditDelegationToken.sol";

/**
 * @title DebtTokenBase
 * @notice Base contract for the different debt tokens
 * @author MELD team
 */
abstract contract DebtTokenBase is
    LendingBase,
    IncentivizedERC20("DEBTTOKEN_IMPL", "DEBTTOKEN_IMPL", 0),
    ICreditDelegationToken
{
    mapping(address => mapping(address => uint256)) internal borrowAllowances;

    /**
     * @notice delegates borrowing power to a user on the specific debt token
     * @param _delegatee the address receiving the delegated borrowing power
     * @param _amount the maximum amount being delegated. Delegation will still
     * respect the liquidation constraints (even if delegated, a delegatee cannot
     * force a delegator HF to go below 1)
     */
    function approveDelegation(address _delegatee, uint256 _amount) external override {
        borrowAllowances[_msgSender()][_delegatee] = _amount;
        emit BorrowAllowanceDelegated(
            _msgSender(),
            _delegatee,
            _getUnderlyingAssetAddress(),
            _amount
        );
    }

    /**
     * @notice returns the borrow allowance of the user
     * @param _fromUser The user giving the allowance
     * @param _toUser The user to give allowance to
     * @return the current allowance of _toUser
     */
    function borrowAllowance(
        address _fromUser,
        address _toUser
    ) external view override returns (uint256) {
        return borrowAllowances[_fromUser][_toUser];
    }

    /**
     * @notice Being non transferrable, the debt token does not implement any of the
     * standard ERC20 functions for transfer and allowance.
     * @dev The function reverts in order to avoid accidental transfers and unexpected behaviour
     * @return always reverts as the function is not supported
     */
    function transfer(address, uint256) public virtual override returns (bool) {
        revert("TRANSFER_NOT_SUPPORTED");
    }

    /**
     * @notice Being non transferrable, the debt token does not implement any of the
     * standard ERC20 functions for transfer and allowance.
     * @dev The function reverts in order to avoid accidental transfers and unexpected behaviour
     * @return always reverts as the function is not supported
     */
    function approve(address, uint256) public virtual override returns (bool) {
        revert("APPROVAL_NOT_SUPPORTED");
    }

    /**
     * @notice Being non transferrable, the debt token does not implement any of the
     * standard ERC20 functions for transfer and allowance.
     * @dev The function reverts in order to avoid accidental transfers and unexpected behaviour
     * @return always reverts as the function is not supported
     */
    function transferFrom(address, address, uint256) public virtual override returns (bool) {
        revert("TRANSFER_NOT_SUPPORTED");
    }

    /**
     * @notice Being non transferrable, the debt token does not implement any of the
     * standard ERC20 functions for transfer and allowance.
     * @dev The function reverts in order to avoid accidental transfers and unexpected behaviour
     * @return always reverts as the function is not supported
     */
    function increaseAllowance(address, uint256) public virtual override returns (bool) {
        revert("ALLOWANCE_NOT_SUPPORTED");
    }

    /**
     * @notice Being non transferrable, the debt token does not implement any of the
     * standard ERC20 functions for transfer and allowance.
     * @dev The function reverts in order to avoid accidental transfers and unexpected behaviour
     * @return always reverts as the function is not supported
     */
    function decreaseAllowance(address, uint256) public virtual override returns (bool) {
        revert("ALLOWANCE_NOT_SUPPORTED");
    }

    /**
     * @notice Being non transferrable, the debt token does not implement any of the
     * standard ERC20 functions for transfer and allowance.
     * @dev The function reverts in order to avoid accidental transfers and unexpected behaviour
     * @return always reverts as the function is not supported
     */
    function allowance(address, address) public view virtual override returns (uint256) {
        revert("ALLOWANCE_NOT_SUPPORTED");
    }

    /**
     * @notice Decreases the borrow allowance of the delegator on the specific debt token
     * @param _delegator Delegator of the borrowing power
     * @param _delegatee Delegatee of the borrowing power
     * @param _amount Amount to decrease the allowance by
     */
    function _decreaseBorrowAllowance(
        address _delegator,
        address _delegatee,
        uint256 _amount
    ) internal {
        require(
            borrowAllowances[_delegator][_delegatee] >= _amount,
            Errors.BORROW_ALLOWANCE_NOT_ENOUGH
        );
        uint256 newAllowance = borrowAllowances[_delegator][_delegatee] - _amount;

        borrowAllowances[_delegator][_delegatee] = newAllowance;

        emit BorrowAllowanceDelegated(
            _delegator,
            _delegatee,
            _getUnderlyingAssetAddress(),
            newAllowance
        );
    }

    /**
     * @notice Returns the address of the underlying asset of this debt token
     * @return The address of the underlying asset
     */
    function _getUnderlyingAssetAddress() internal view virtual returns (address);
}
