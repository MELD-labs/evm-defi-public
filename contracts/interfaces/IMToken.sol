// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {IAddressesProvider} from "./IAddressesProvider.sol";
import {ILendingPool} from "./ILendingPool.sol";
import {IScaledBalanceToken} from "./IScaledBalanceToken.sol";

/**
 * @title IMToken interface
 * @notice Interface for the MToken contract
 * @author MELD team
 */
interface IMToken is IERC20, IERC20Permit, IScaledBalanceToken {
    /**
     * @notice Emitted when a debt token is initialized
     * @param addressesProvider The address of the addresses provider
     * @param pool The address of the lending pool where this mToken will be used
     * @param treasury The address of the MELD treasury, receiving the fees on this mToken
     * @param underlyingAsset The address of the underlying asset
     * @param mTokenDecimals the decimals of the MToken
     * @param mTokenName the name of the MToken
     * @param mTokenSymbol the symbol of the MToken
     */
    event Initialized(
        address indexed addressesProvider,
        address indexed pool,
        address treasury,
        address indexed underlyingAsset,
        uint8 mTokenDecimals,
        string mTokenName,
        string mTokenSymbol
    );

    /**
     * @notice Emitted after the mint action
     * @param from The address performing the mint
     * @param value The amount being
     * @param index The new liquidity index of the reserve
     */
    event Mint(address indexed from, uint256 value, uint256 index);

    /**
     * @notice Emitted after mTokens are burned
     * @param from The owner of the mTokens, getting them burned
     * @param target The address that will receive the underlying
     * @param value The amount being burned
     * @param index The new liquidity index of the reserve
     */
    event Burn(address indexed from, address indexed target, uint256 value, uint256 index);

    /**
     * @notice Emitted during the transfer action
     * @param from The user whose tokens are being transferred
     * @param to The recipient
     * @param value The amount being transferred
     * @param index The new liquidity index of the reserve
     */
    event BalanceTransfer(address indexed from, address indexed to, uint256 value, uint256 index);

    /**
     * @notice Initializes the debt token.
     * @param _addressesProvider The address of the addresses provider
     * @param _pool The address of the lending pool where this mToken will be used
     * @param _treasury The address of the MELD treasury, receiving the fees on this mToken
     * @param _underlyingAsset The address of the underlying asset of this mToken (E.g. WETH for mWETH)
     * @param _mTokenDecimals The decimals of the MToken, same as the underlying asset's
     * @param _mTokenName The name of the MToken
     * @param _mTokenSymbol The symbol of the MToken
     */
    function initialize(
        IAddressesProvider _addressesProvider,
        ILendingPool _pool,
        address _treasury,
        address _underlyingAsset,
        uint8 _mTokenDecimals,
        string memory _mTokenName,
        string memory _mTokenSymbol
    ) external;

    /**
     * @notice Mints `amount` mTokens to `user`
     * @param _user The address receiving the minted tokens
     * @param _amount The amount of tokens getting minted
     * @param _index The new liquidity index of the reserve
     * @return `true` if the the previous balance of the user was 0
     */
    function mint(address _user, uint256 _amount, uint256 _index) external returns (bool);

    /**
     * @notice Burns mTokens from `user` and sends the equivalent amount of underlying to `receiverOfUnderlying`
     * @param _user The owner of the mTokens, getting them burned
     * @param _receiverOfUnderlying The address that will receive the underlying
     * @param _amount The amount being burned
     * @param _index The new liquidity index of the reserve
     */
    function burn(
        address _user,
        address _receiverOfUnderlying,
        uint256 _amount,
        uint256 _index
    ) external;

    /**
     * @notice Mints mTokens to the reserve treasury
     * @param _amount The amount of tokens getting minted
     * @param _index The new liquidity index of the reserve
     */
    function mintToTreasury(uint256 _amount, uint256 _index) external;

    /**
     * @notice Transfers mTokens in the event of a borrow being liquidated, in case the liquidators reclaims the mToken
     * @param _from The address getting liquidated, current owner of the mTokens
     * @param _to The recipient
     * @param _value The amount of tokens getting transferred
     */
    function transferOnLiquidation(address _from, address _to, uint256 _value) external;

    /**
     * @notice Transfers the underlying asset to `target`. Used by the LendingPool to transfer
     * assets in borrow(), withdraw() and flashLoan()
     * @param _user The recipient of the underlying
     * @param _amount The amount getting transferred
     * @return The amount transferred
     */
    function transferUnderlyingTo(address _user, uint256 _amount) external returns (uint256);

    /**
     * @notice Returns the address of the Meld treasury, receiving the fees on this mToken
     * @return The address of the Meld treasury
     */
    function RESERVE_TREASURY_ADDRESS() external view returns (address); // solhint-disable-line func-name-mixedcase

    /**
     * @notice Returns the address of the underlying asset of this mToken (E.g. WETH for mWETH)
     * @return The address of the underlying asset
     */
    function UNDERLYING_ASSET_ADDRESS() external view returns (address); // solhint-disable-line func-name-mixedcase

    /**
     * @notice  Returns the domain separator for the mToken contract
     * @dev     Used to validate EIP712 signatures. Generated automatically by the EIP712 standard and current contract
     * @return  bytes32  The domain separator
     */
    // solhint-disable-next-line func-name-mixedcase
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}
