// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {DataTypes} from "../types/DataTypes.sol";

/**
 * @title Helpers library
 * @author MELD team
 */
library Helpers {
    /**
     * @notice Fetches the user current stable and variable debt balances
     * @param _user The user address
     * @param _reserve The reserve data object
     * @return The stable and variable debt balance
     */
    function getUserCurrentDebt(
        address _user,
        DataTypes.ReserveData storage _reserve
    ) internal view returns (uint256, uint256) {
        return (
            IERC20(_reserve.stableDebtTokenAddress).balanceOf(_user),
            IERC20(_reserve.variableDebtTokenAddress).balanceOf(_user)
        );
    }
}
