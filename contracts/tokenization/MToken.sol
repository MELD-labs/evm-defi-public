// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {LendingBase, IAddressesProvider} from "../base/LendingBase.sol";
import {IncentivizedERC20, Errors} from "./IncentivizedERC20.sol";
import {WadRayMath} from "../libraries/math/WadRayMath.sol";
import {IMToken} from "../interfaces/IMToken.sol";
import {ILendingPool} from "../interfaces/ILendingPool.sol";

/**
 * @title MToken
 * @notice The main mToken contract, representing the interest bearing token for the specific asset
 * @dev Supports IERC20Permit
 * @author MELD team
 */
contract MToken is LendingBase, IncentivizedERC20("MTOKEN_IMPL", "MTOKEN_IMPL", 0), IMToken {
    using SafeERC20 for IERC20;
    using WadRayMath for uint256;

    /// @dev owner => next valid nonce to submit with permit()
    mapping(address => uint256) public override nonces;

    bytes public constant EIP712_REVISION = bytes("1");
    bytes32 internal constant EIP712_DOMAIN =
        keccak256(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
        );
    bytes32 public constant PERMIT_TYPEHASH =
        keccak256(
            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
        );

    ILendingPool internal pool;
    address internal treasury;
    address internal underlyingAsset;

    /**
     * @notice Initializes the mToken
     * @param _addressesProvider The address of the addresses provider
     * @param _pool The address of the lending pool where this mToken will be used
     * @param _treasury The address of the MELD treasury, receiving the fees on this mToken
     * @param _underlyingAsset The address of the underlying asset of this mToken (E.g. WETH for mWETH)
     * @param _mTokenDecimals The decimals of the mToken, same as the underlying asset's
     * @param _mTokenName The name of the mToken
     * @param _mTokenSymbol The symbol of the mToken
     */
    function initialize(
        IAddressesProvider _addressesProvider,
        ILendingPool _pool,
        address _treasury,
        address _underlyingAsset,
        uint8 _mTokenDecimals,
        string calldata _mTokenName,
        string calldata _mTokenSymbol
    ) external whenUninitialized {
        require(address(_addressesProvider) != address(0), Errors.INVALID_ADDRESS);

        uint256 chainId;

        // solhint-disable-next-line no-inline-assembly
        assembly {
            chainId := chainid()
        }

        _setName(_mTokenName);
        _setSymbol(_mTokenSymbol);
        _setDecimals(_mTokenDecimals);

        addressesProvider = _addressesProvider;
        pool = _pool;
        treasury = _treasury;
        underlyingAsset = _underlyingAsset;
        initialized = true;

        emit Initialized(
            address(addressesProvider),
            address(_pool),
            _treasury,
            _underlyingAsset,
            _mTokenDecimals,
            _mTokenName,
            _mTokenSymbol
        );
    }

    /**
     * @notice Mints `_amount` mTokens to `_user`
     * @dev Only callable by the LendingPool, as extra state updates there need to be managed
     * @param _user The address receiving the minted tokens
     * @param _amount The amount of tokens getting minted
     * @param _index The new liquidity index of the reserve
     * @return `true` if the the previous balance of the user was 0
     */
    function mint(
        address _user,
        uint256 _amount,
        uint256 _index
    ) external override onlyRole(addressesProvider.LENDING_POOL_ROLE()) returns (bool) {
        uint256 previousBalance = super.balanceOf(_user);

        uint256 amountScaled = _amount.rayDiv(_index);
        require(amountScaled != 0, Errors.CT_INVALID_MINT_AMOUNT);

        _mint(_user, amountScaled);

        // Call yield boost staking protocol
        pool.refreshYieldBoostAmount(_user, underlyingAsset);

        emit Transfer(address(0), _user, _amount);
        emit Mint(_user, _amount, _index);

        return previousBalance == 0;
    }

    /**
     * @notice Burns mTokens from `_user` and sends the equivalent amount of underlying to `_receiverOfUnderlying`
     * @dev Only callable by the LendingPool, as extra state updates there need to be managed
     * @param _user The owner of the mTokens, getting them burned
     * @param _receiverOfUnderlying The address that will receive the underlying asset
     * @param _amount The amount being burned
     * @param _index The new liquidity index of the reserve
     */
    function burn(
        address _user,
        address _receiverOfUnderlying,
        uint256 _amount,
        uint256 _index
    ) external override onlyRole(addressesProvider.LENDING_POOL_ROLE()) {
        uint256 amountScaled = _amount.rayDiv(_index);
        require(amountScaled != 0, Errors.CT_INVALID_BURN_AMOUNT);
        _burn(_user, amountScaled);

        IERC20(underlyingAsset).safeTransfer(_receiverOfUnderlying, _amount);

        // Call yield boost staking protocol
        pool.refreshYieldBoostAmount(_user, underlyingAsset);

        emit Transfer(_user, address(0), _amount);
        emit Burn(_user, _receiverOfUnderlying, _amount, _index);
    }

    /**
     * @notice Mints mTokens to the reserve treasury
     * @dev Only callable by the LendingPool
     * @param _amount The amount of tokens getting minted
     * @param _index The new liquidity index of the reserve
     */
    function mintToTreasury(
        uint256 _amount,
        uint256 _index
    ) external override onlyRole(addressesProvider.LENDING_POOL_ROLE()) {
        if (_amount == 0) {
            return;
        }

        // Compared to the normal mint, we don't check for rounding errors.
        // The amount to mint can easily be very small since it is a fraction of the interest accrued.
        // In that case, the treasury will experience a (very small) loss, but it
        // wont cause potentially valid transactions to fail.
        _mint(treasury, _amount.rayDiv(_index));

        emit Transfer(address(0), treasury, _amount);
        emit Mint(treasury, _amount, _index);
    }

    /**
     * @notice Transfers mTokens in the event of a borrow being liquidated, in case the liquidators reclaims the mToken
     * @dev Only callable by the LendingPool
     * @param _from The address getting liquidated, current owner of the mTokens
     * @param _to The recipient
     * @param _value The amount of tokens getting transferred
     */
    function transferOnLiquidation(
        address _from,
        address _to,
        uint256 _value
    ) external override onlyRole(addressesProvider.LENDING_POOL_ROLE()) {
        // Being a normal transfer, the Transfer() and BalanceTransfer() are emitted
        // so no need to emit a specific event here
        _transfer(_from, _to, _value, false);

        emit Transfer(_from, _to, _value);
    }

    /**
     * @notice Transfers the underlying asset to `target`. Used by the LendingPool to transfer
     * assets in borrow() and withdraw()
     * @param _target The recipient of the mTokens
     * @param _amount The amount getting transferred
     * @return The amount transferred
     */
    function transferUnderlyingTo(
        address _target,
        uint256 _amount
    ) external override onlyRole(addressesProvider.LENDING_POOL_ROLE()) returns (uint256) {
        IERC20(underlyingAsset).safeTransfer(_target, _amount);
        return _amount;
    }

    /**
     * @notice implements the permit function as for
     * https://github.com/ethereum/EIPs/blob/8a34d644aacf0f9f8f00815307fd7dd5da07655f/EIPS/eip-2612.md
     * @param _owner The owner of the funds
     * @param _spender The spender
     * @param _value The amount
     * @param _deadline The deadline timestamp, type(uint256).max for max deadline
     * @param _v Signature param
     * @param _s Signature param
     * @param _r Signature param
     */
    function permit(
        address _owner,
        address _spender,
        uint256 _value,
        uint256 _deadline,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) external {
        require(_owner != address(0), Errors.MT_INVALID_OWNER);
        require(block.timestamp <= _deadline, Errors.MT_INVALID_DEADLINE);
        uint256 currentValidNonce = nonces[_owner];
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        PERMIT_TYPEHASH,
                        _owner,
                        _spender,
                        _value,
                        currentValidNonce,
                        _deadline
                    )
                )
            )
        );

        address recoveredAddress = ecrecover(digest, _v, _r, _s);

        require(recoveredAddress == _owner, Errors.MT_INVALID_SIGNATURE);
        nonces[_owner] = currentValidNonce + 1;
        _approve(_owner, _spender, _value);
    }

    /**
     * @notice Returns the scaled balance of the user. The scaled balance is the sum of all the
     * updated stored balance divided by the reserve's liquidity index at the moment of the update
     * @param _user The user whose balance is calculated
     * @return The scaled balance of the user
     */
    function scaledBalanceOf(address _user) external view override returns (uint256) {
        return super.balanceOf(_user);
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
     * @notice Returns the address of the Meld treasury, receiving the fees on this mToken
     * @return The address of the Meld treasury
     */
    function RESERVE_TREASURY_ADDRESS() external view returns (address) {
        // solhint-disable-previous-line func-name-mixedcase
        return treasury;
    }

    /**
     * @notice Returns the address of the underlying asset of this mToken (E.g. WETH for mWETH)
     * @return The address of the underlying asset
     */
    function UNDERLYING_ASSET_ADDRESS() public view override returns (address) {
        // solhint-disable-previous-line func-name-mixedcase
        return underlyingAsset;
    }

    /**
     * @notice Calculates the balance of the user: principal balance + interest generated by the principal
     * @param _user The user whose balance is calculated
     * @return The balance of the user
     */
    function balanceOf(
        address _user
    ) public view override(IncentivizedERC20, IERC20) returns (uint256) {
        return super.balanceOf(_user).rayMul(pool.getReserveNormalizedIncome(underlyingAsset));
    }

    /**
     * @notice Returns the scaled total supply of the mToken. Represents sum(debt/index)
     * @return the scaled total supply
     */
    function scaledTotalSupply() public view virtual override returns (uint256) {
        return super.totalSupply();
    }

    /**
     * @notice calculates the total supply of the specific mToken
     * since the balance of every single user increases over time, the total supply
     * does that too.
     * @return the current total supply
     */
    function totalSupply() public view override(IncentivizedERC20, IERC20) returns (uint256) {
        uint256 currentSuppliedScaled = super.totalSupply();

        if (currentSuppliedScaled == 0) {
            return 0;
        }

        return currentSuppliedScaled.rayMul(pool.getReserveNormalizedIncome(underlyingAsset));
    }

    /**
     * @notice  Returns the domain separator for the mToken contract
     * @dev     Used to validate EIP712 signatures. Generated automatically by the EIP712 standard and current contract
     * @return  bytes32  The domain separator
     */
    // solhint-disable-next-line func-name-mixedcase
    function DOMAIN_SEPARATOR() public view override returns (bytes32) {
        uint256 chainId;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            chainId := chainid()
        }
        return
            keccak256(
                abi.encode(
                    EIP712_DOMAIN,
                    keccak256(bytes(name())),
                    keccak256(EIP712_REVISION),
                    chainId,
                    address(this)
                )
            );
    }

    /**
     * @notice Transfers the mTokens between two users. Validates the transfer
     * (ie checks for valid HF after the transfer) if required
     * @param _from The source address
     * @param _to The destination address
     * @param _amount The amount getting transferred
     * @param _validate `true` if the transfer needs to be validated
     */
    function _transfer(
        address _from,
        address _to,
        uint256 _amount,
        bool _validate
    ) internal whenNotPaused {
        uint256 index = pool.getReserveNormalizedIncome(underlyingAsset);

        uint256 fromBalanceBefore = super.balanceOf(_from).rayMul(index);
        uint256 toBalanceBefore = super.balanceOf(_to).rayMul(index);

        super._transfer(_from, _to, _amount.rayDiv(index));

        if (_validate) {
            pool.finalizeTransfer(
                underlyingAsset,
                _from,
                _to,
                _amount,
                fromBalanceBefore,
                toBalanceBefore
            );
        }

        // Call yield boost staking protocol
        pool.refreshYieldBoostAmount(_from, underlyingAsset);
        pool.refreshYieldBoostAmount(_to, underlyingAsset);

        emit BalanceTransfer(_from, _to, _amount, index);
    }

    /**
     * @notice Overrides the parent _transfer to force validated transfer() and transferFrom()
     * @param _from The source address
     * @param _to The destination address
     * @param _amount The amount getting transferred
     */
    function _transfer(address _from, address _to, uint256 _amount) internal override {
        _transfer(_from, _to, _amount, true);
    }
}
