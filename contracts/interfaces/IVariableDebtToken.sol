// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IScaledBalanceToken} from "./IScaledBalanceToken.sol";
import {IInitializableDebtToken} from "./IInitializableDebtToken.sol";

/**
 * @title IVariableDebtToken interface
 * @notice Interface for the MELD variable debt token
 * @author MELD team
 */
interface IVariableDebtToken is IScaledBalanceToken, IInitializableDebtToken {
    /**
     * @notice Emitted after the mint action
     * @param from The address performing the mint
     * @param onBehalfOf The address of the user on which behalf minting has been performed
     * @param value The amount to be minted
     * @param index The last index of the reserve
     */
    event Mint(address indexed from, address indexed onBehalfOf, uint256 value, uint256 index);

    /**
     * @notice Emitted when variable debt is burnt
     * @param user The user which debt has been burned
     * @param amount The amount of debt being burned
     * @param index The index of the user
     */
    event Burn(address indexed user, uint256 amount, uint256 index);

    /**
     * @notice Mints debt token to the `onBehalfOf` address
     * @param _user The address receiving the borrowed underlying, being the delegatee in case
     * of credit delegate, or same as `onBehalfOf` otherwise
     * @param _onBehalfOf The address receiving the debt tokens
     * @param _amount The amount of debt being minted
     * @param _index The variable debt index of the reserve
     * @return `true` if the the previous balance of the user is 0
     */
    function mint(
        address _user,
        address _onBehalfOf,
        uint256 _amount,
        uint256 _index
    ) external returns (bool);

    /**
     * @notice Burns user variable debt
     * @param _user The user which debt is burnt
     * @param _amount The amount of debt being burned
     * @param _index The variable debt index of the reserve
     */
    function burn(address _user, uint256 _amount, uint256 _index) external;

    /**
     * @notice Returns the address of the underlying asset of this debt token
     * @return The address of the underlying asset
     */
    function UNDERLYING_ASSET_ADDRESS() external view returns (address); // solhint-disable-line func-name-mixedcase
}
