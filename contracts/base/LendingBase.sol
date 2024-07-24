// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IAddressesProvider} from "../interfaces/IAddressesProvider.sol";

/**
 * @title LendingBase
 * @notice Base contract that multiple contracts in the protocol use to access the addresses provider and its access control
 * @author MELD team
 */
abstract contract LendingBase {
    IAddressesProvider public addressesProvider;

    /**
     * @notice  Checks if `msg.sender` has been granted `_role`. If not, reverts with a string message that includes the hexadecimal representation of `role`.
     * @param   _role The role to check
     */
    modifier onlyRole(bytes32 _role) {
        addressesProvider.checkRole(_role, msg.sender);
        _;
    }

    /**
     * @notice Modifier to make a function callable only when the protocol is not paused.
     */
    modifier whenNotPaused() {
        addressesProvider.requireNotPaused();
        _;
    }
}
