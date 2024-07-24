// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ILendingPool} from "./ILendingPool.sol";
import {IAddressesProvider} from "./IAddressesProvider.sol";

/**
 * @title IInitializableDebtToken
 * @notice Interface for the initialize function common between debt tokens
 * @author MELD team
 */
interface IInitializableDebtToken {
    /**
     * @notice Emitted when a debt token is initialized
     * @param addressesProvider The address of the addresses provider
     * @param underlyingAsset The address of the underlying asset
     * @param pool The address of the associated lending pool
     * @param debtTokenDecimals the decimals of the debt token
     * @param debtTokenName the name of the debt token
     * @param debtTokenSymbol the symbol of the debt token
     */
    event Initialized(
        address indexed addressesProvider,
        address indexed underlyingAsset,
        address indexed pool,
        uint8 debtTokenDecimals,
        string debtTokenName,
        string debtTokenSymbol
    );

    /**
     * @notice Initializes the debt token.
     * @param _addressesProvider The address of the addresses provider
     * @param _pool The address of the lending pool where this mToken will be used
     * @param _underlyingAsset The address of the underlying asset of this mToken (E.g. WETH for mWETH)
     * @param _debtTokenDecimals The decimals of the debtToken, same as the underlying asset's
     * @param _debtTokenName The name of the token
     * @param _debtTokenSymbol The symbol of the token
     */
    function initialize(
        IAddressesProvider _addressesProvider,
        ILendingPool _pool,
        address _underlyingAsset,
        uint8 _debtTokenDecimals,
        string memory _debtTokenName,
        string memory _debtTokenSymbol
    ) external;
}
