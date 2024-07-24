// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {DebtTokenBase, Errors} from "./base/DebtTokenBase.sol";
import {MathUtils, WadRayMath} from "../libraries/math/MathUtils.sol";
import {ILendingPool} from "../interfaces/ILendingPool.sol";
import {IStableDebtToken} from "../interfaces/IStableDebtToken.sol";
import {IAddressesProvider} from "../interfaces/IAddressesProvider.sol";

/**
 * @title StableDebtToken
 * @notice Implements a stable debt token to track the borrowing positions of users at stable rate
 * @author MELD team
 */
contract StableDebtToken is DebtTokenBase, IStableDebtToken {
    using WadRayMath for uint256;

    struct MintLocalVars {
        uint256 previousSupply;
        uint256 nextSupply;
        uint256 amountInRay;
        uint256 newStableRate;
        uint256 currentAvgStableRate;
    }

    uint256 internal avgStableRate;
    mapping(address => uint40) internal timestamps;
    mapping(address => uint256) internal usersStableRate;
    uint40 internal totalSupplyTimestamp;

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
     * @notice Mints debt token to the `_onBehalfOf` address.
     * - The resulting rate is the weighted average between the rate of the new debt
     * and the rate of the previous debt
     * @param _user The address receiving the borrowed underlying, being the delegatee in case
     * of credit delegate, or same as `_onBehalfOf` otherwise
     * @param _onBehalfOf The address receiving the debt tokens
     * @param _amount The amount of debt tokens to mint
     * @param _rate The rate of the debt being minted
     */
    function mint(
        address _user,
        address _onBehalfOf,
        uint256 _amount,
        uint256 _rate
    ) external override onlyRole(addressesProvider.LENDING_POOL_ROLE()) returns (bool) {
        MintLocalVars memory vars;

        if (_user != _onBehalfOf) {
            _decreaseBorrowAllowance(_onBehalfOf, _user, _amount);
        }

        (, uint256 currentBalance, uint256 balanceIncrease) = _calculateBalanceIncrease(
            _onBehalfOf
        );

        vars.previousSupply = totalSupply();
        vars.currentAvgStableRate = avgStableRate;
        vars.nextSupply = totalSupply_ = vars.previousSupply + _amount;

        vars.amountInRay = _amount.wadToRay();

        vars.newStableRate = ((usersStableRate[_onBehalfOf].rayMul(currentBalance.wadToRay())) +
            (vars.amountInRay.rayMul(_rate))).rayDiv(((currentBalance + _amount).wadToRay()));

        require(vars.newStableRate <= type(uint128).max, Errors.SDT_STABLE_DEBT_OVERFLOW);
        usersStableRate[_onBehalfOf] = vars.newStableRate;

        totalSupplyTimestamp = timestamps[_onBehalfOf] = uint40(block.timestamp);

        vars.currentAvgStableRate = avgStableRate = ((
            vars.currentAvgStableRate.rayMul(vars.previousSupply.wadToRay())
        ) + (_rate.rayMul(vars.amountInRay))).rayDiv(vars.nextSupply.wadToRay());

        _mintStableDebt(_onBehalfOf, _amount + balanceIncrease);

        // Call yield boost staking protocol
        pool.refreshYieldBoostAmount(_user, underlyingAsset);

        emit Transfer(address(0), _onBehalfOf, _amount);

        emit Mint(
            _user,
            _onBehalfOf,
            _amount,
            currentBalance,
            balanceIncrease,
            vars.newStableRate,
            vars.currentAvgStableRate,
            vars.nextSupply
        );

        return currentBalance == 0;
    }

    /**
     * @notice Burns debt of `_user`
     * - The resulting rate is the weighted average between the rate of the new debt
     * and the rate of the previous debt
     * @dev If the balance increase due to interest is higher than the amount to burn, new debt tokens are minted
     * @param _user The address of the user getting his debt burned
     * @param _amount The amount of debt tokens getting burned
     */
    function burn(
        address _user,
        uint256 _amount
    ) external override onlyRole(addressesProvider.LENDING_POOL_ROLE()) {
        (, uint256 currentBalance, uint256 balanceIncrease) = _calculateBalanceIncrease(_user);

        uint256 previousSupply = totalSupply();
        uint256 newAvgStableRate = 0;
        uint256 nextSupply = 0;
        uint256 userStableRate = usersStableRate[_user];

        if (previousSupply <= _amount) {
            avgStableRate = 0;
            totalSupply_ = 0;
        } else {
            nextSupply = totalSupply_ = previousSupply - _amount;
            uint256 firstTerm = avgStableRate.rayMul(previousSupply.wadToRay());
            uint256 secondTerm = userStableRate.rayMul(_amount.wadToRay());

            if (secondTerm >= firstTerm) {
                newAvgStableRate = avgStableRate = totalSupply_ = 0;
            } else {
                newAvgStableRate = avgStableRate = (firstTerm - secondTerm).rayDiv(
                    nextSupply.wadToRay()
                );
            }
        }

        if (_amount == currentBalance) {
            usersStableRate[_user] = 0;
            timestamps[_user] = 0;
        } else {
            timestamps[_user] = uint40(block.timestamp);
        }
        totalSupplyTimestamp = uint40(block.timestamp);

        if (balanceIncrease > _amount) {
            uint256 amountToMint = balanceIncrease - _amount;
            _mintStableDebt(_user, amountToMint);
            emit Mint(
                _user,
                _user,
                amountToMint,
                currentBalance,
                balanceIncrease,
                userStableRate,
                newAvgStableRate,
                nextSupply
            );
        } else {
            uint256 amountToBurn = _amount - balanceIncrease;
            _burnStableDebt(_user, amountToBurn);
            emit Burn(
                _user,
                amountToBurn,
                currentBalance,
                balanceIncrease,
                newAvgStableRate,
                nextSupply
            );
        }

        // Call yield boost staking protocol
        pool.refreshYieldBoostAmount(_user, underlyingAsset);

        emit Transfer(_user, address(0), _amount);
    }

    /**
     * @notice Returns the average rate of all the stable rate loans.
     * @return The average stable rate
     */
    function getAverageStableRate() external view virtual override returns (uint256) {
        return avgStableRate;
    }

    /**
     * @notice Returns the stable rate of the user debt
     * @param _user The address of the user
     * @return The stable rate of the user
     */
    function getUserStableRate(address _user) external view virtual override returns (uint256) {
        return usersStableRate[_user];
    }

    /**
     * @notice Returns the timestamp of the last update of the user
     * @param _user The address of the user
     * @return The timestamp
     */
    function getUserLastUpdated(address _user) external view virtual override returns (uint40) {
        return timestamps[_user];
    }

    /**
     * @notice Returns the principal debt balance of the user
     * @param _user The address of the user
     * @return The debt balance of the user since the last burn/mint action
     */
    function principalBalanceOf(address _user) external view virtual override returns (uint256) {
        return super.balanceOf(_user);
    }

    /**
     * @notice Returns the principal, the total supply, the average stable rate, and the total supply timestamp
     */
    function getSupplyData() public view override returns (uint256, uint256, uint256, uint40) {
        uint256 avgRate = avgStableRate;
        return (super.totalSupply(), _calcTotalSupply(avgRate), avgRate, totalSupplyTimestamp);
    }

    /**
     * @notice Returns the timestamp of the last update of the total supply
     * @return The timestamp
     */
    function getTotalSupplyLastUpdated() public view override returns (uint40) {
        return totalSupplyTimestamp;
    }

    /**
     * @notice Returns the total supply
     * @return The total supply
     */
    function totalSupply() public view override returns (uint256) {
        return _calcTotalSupply(avgStableRate);
    }

    /**
     * @notice Returns the total supply and the average stable rate
     */
    function getTotalSupplyAndAvgRate() public view override returns (uint256, uint256) {
        uint256 avgRate = avgStableRate;
        return (_calcTotalSupply(avgRate), avgRate);
    }

    /**
     * @notice Calculates the current user debt balance, including interested owed
     * @return The accumulated debt of the user
     */
    function balanceOf(address account) public view virtual override returns (uint256) {
        uint256 principalBalance = super.balanceOf(account);

        uint256 stableRate = usersStableRate[account];
        if (principalBalance == 0) {
            return 0;
        }

        uint256 cumulatedInterest = MathUtils.calculateCompoundedInterest(
            stableRate,
            timestamps[account]
        );

        return principalBalance.rayMul(cumulatedInterest);
    }

    /**
     * @notice Returns the address of the underlying asset of this debt token
     * @return The address of the underlying asset
     */
    function UNDERLYING_ASSET_ADDRESS() public view override returns (address) {
        // solhint-disable-previous-line func-name-mixedcase
        return underlyingAsset;
    }

    /**
     * @notice Adjusts the balance of the user, adding the balance increase
     * @param _account The address of the user
     * @param _amount The amount of tokens to be added to the balance
     */
    function _mintStableDebt(address _account, uint256 _amount) internal {
        uint256 oldAccountBalance = balances[_account];
        balances[_account] = oldAccountBalance + _amount;
    }

    /**
     * @notice Adjusts the balance of the user, subtracting the balance decrease
     * @param _account The address of the user
     * @param _amount The amount of tokens to be subtracted from the balance
     */
    function _burnStableDebt(address _account, uint256 _amount) internal {
        uint256 oldAccountBalance = balances[_account];
        require(oldAccountBalance >= _amount, Errors.SDT_BURN_EXCEEDS_BALANCE);
        balances[_account] = oldAccountBalance - _amount;
    }

    /**
     * @notice Returns the address of the underlying asset of this debt token
     * @return The address of the underlying asset
     */
    function _getUnderlyingAssetAddress() internal view override returns (address) {
        return underlyingAsset;
    }

    /**
     * @notice Calculates the total supply of the debt token
     * @param avgRate The average stable rate
     * @return The total supply
     */
    function _calcTotalSupply(uint256 avgRate) internal view virtual returns (uint256) {
        uint256 principalSupply = super.totalSupply();

        if (principalSupply == 0) {
            return 0;
        }

        uint256 cumulatedInterest = MathUtils.calculateCompoundedInterest(
            avgRate,
            totalSupplyTimestamp
        );

        return principalSupply.rayMul(cumulatedInterest);
    }

    /**
     * @notice Calculates the balance increase of the user
     * @param _user The address of the user
     * @return The previous principal balance, the next principal balance and the balance increase
     */
    function _calculateBalanceIncrease(
        address _user
    ) internal view returns (uint256, uint256, uint256) {
        uint256 previousPrincipalBalance = super.balanceOf(_user);

        if (previousPrincipalBalance == 0) {
            return (0, 0, 0);
        }

        uint256 balanceIncrease = balanceOf(_user) - previousPrincipalBalance;

        return (
            previousPrincipalBalance,
            previousPrincipalBalance + balanceIncrease,
            balanceIncrease
        );
    }
}
