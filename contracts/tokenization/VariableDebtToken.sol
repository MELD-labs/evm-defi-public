// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {DebtTokenBase, Errors} from "./base/DebtTokenBase.sol";
import {WadRayMath} from "../libraries/math/WadRayMath.sol";
import {IVariableDebtToken} from "../interfaces/IVariableDebtToken.sol";
import {ILendingPool} from "../interfaces/ILendingPool.sol";
import {IAddressesProvider} from "../interfaces/IAddressesProvider.sol";

/**
 * @title VariableDebtToken
 * @notice Implements a variable debt token to track the borrowing positions of users at a variable rate
 * @author MELD team
 */
contract VariableDebtToken is DebtTokenBase, IVariableDebtToken {
    using WadRayMath for uint256;

    ILendingPool internal pool;
    address internal underlyingAsset;

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
    ) external whenUninitialized {
        require(address(_addressesProvider) != address(0), Errors.INVALID_ADDRESS);
        _setName(_debtTokenName);
        _setSymbol(_debtTokenSymbol);
        _setDecimals(_debtTokenDecimals);

        addressesProvider = _addressesProvider;
        pool = _pool;
        underlyingAsset = _underlyingAsset;
        initialized = true;

        emit Initialized(
            address(_addressesProvider),
            _underlyingAsset,
            address(_pool),
            _debtTokenDecimals,
            _debtTokenName,
            _debtTokenSymbol
        );
    }

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
    ) external override onlyRole(addressesProvider.LENDING_POOL_ROLE()) returns (bool) {
        if (_user != _onBehalfOf) {
            _decreaseBorrowAllowance(_onBehalfOf, _user, _amount);
        }

        uint256 previousBalance = super.balanceOf(_onBehalfOf);
        uint256 amountScaled = _amount.rayDiv(_index);
        require(amountScaled != 0, Errors.CT_INVALID_MINT_AMOUNT);

        _mint(_onBehalfOf, amountScaled);

        // Call yield boost staking protocol
        pool.refreshYieldBoostAmount(_user, underlyingAsset);

        emit Transfer(address(0), _onBehalfOf, _amount);
        emit Mint(_user, _onBehalfOf, _amount, _index);

        return previousBalance == 0;
    }

    /**
     * @notice Burns user variable debt
     * @param _user The user which debt is burnt
     * @param _amount The amount of debt being burned
     * @param _index The variable debt index of the reserve
     */
    function burn(
        address _user,
        uint256 _amount,
        uint256 _index
    ) external override onlyRole(addressesProvider.LENDING_POOL_ROLE()) {
        uint256 amountScaled = _amount.rayDiv(_index);
        require(amountScaled != 0, Errors.CT_INVALID_BURN_AMOUNT);

        _burn(_user, amountScaled);

        // Call yield boost staking protocol
        pool.refreshYieldBoostAmount(_user, underlyingAsset);

        emit Transfer(_user, address(0), _amount);
        emit Burn(_user, _amount, _index);
    }

    /**
     * @notice Returns the scaled balance of the user and the scaled total supply.
     * @param _user The address of the user
     * @return The scaled balance of the user
     * @return The scaled balance and the scaled total supply
     */
    function getScaledUserBalanceAndSupply(
        address _user
    ) external view override returns (uint256, uint256) {
        return (super.balanceOf(_user), super.totalSupply());
    }

    /**
     * @notice Returns the balance of the user, including interested owed
     * @param _user The user for which the balance is calculated
     * @return The balance of the user
     */
    function balanceOf(address _user) public view virtual override returns (uint256) {
        uint256 scaledBalance = super.balanceOf(_user);

        if (scaledBalance == 0) {
            return 0;
        }

        return scaledBalance.rayMul(pool.getReserveNormalizedVariableDebt(underlyingAsset));
    }

    /**
     * @notice Returns the scaled balance of the user. The scaled balance is the sum of all the
     * updated stored balance divided by the reserve's liquidity index at the moment of the update
     * @param _user The user whose balance is calculated
     * @return The scaled balance of the user
     */
    function scaledBalanceOf(address _user) public view virtual override returns (uint256) {
        return super.balanceOf(_user);
    }

    /**
     * @notice Returns the total supply
     * @return The total supply
     */
    function totalSupply() public view virtual override returns (uint256) {
        return super.totalSupply().rayMul(pool.getReserveNormalizedVariableDebt(underlyingAsset));
    }

    /**
     * @notice Returns the scaled total supply of the token. Represents sum(debt/index)
     * @return The scaled total supply
     */
    function scaledTotalSupply() public view virtual override returns (uint256) {
        return super.totalSupply();
    }

    /**
     * @notice Returns the address of the underlying asset of this debt token
     * @return The address of the underlying asset
     */
    function UNDERLYING_ASSET_ADDRESS() public view returns (address) {
        // solhint-disable-previous-line func-name-mixedcase
        return underlyingAsset;
    }

    /**
     * @notice Returns the address of the underlying asset of this debt token
     * @return The address of the underlying asset
     */
    function _getUnderlyingAssetAddress() internal view override returns (address) {
        return underlyingAsset;
    }
}
