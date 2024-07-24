// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {
    IERC20Metadata,
    IERC20
} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {Errors} from "../libraries/helpers/Errors.sol";

/**
 * @title IncentivizedERC20
 * @notice IncentivizedERC20 is a contract created to be used as a base for the mTokens and debt tokens
 * @author MELD team
 */
abstract contract IncentivizedERC20 is Context, IERC20, IERC20Metadata {
    mapping(address => uint256) internal balances;

    mapping(address => mapping(address => uint256)) private allowances;
    uint256 internal totalSupply_;
    string private name_;
    string private symbol_;
    uint8 private decimals_;
    bool internal initialized;

    modifier whenUninitialized() {
        require(!initialized, Errors.CT_RESERVE_TOKEN_ALREADY_INITIALIZED);
        _;
    }

    /**
     * @notice Initializes the contract
     * @param _name The name of the token
     * @param _symbol The symbol of the token
     * @param _decimals The decimals of the token
     */
    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name_ = _name;
        symbol_ = _symbol;
        decimals_ = _decimals;
    }

    /**
     * @notice Executes a transfer of tokens from _msgSender() to recipient
     * @param _recipient The recipient of the tokens
     * @param _amount The amount of tokens being transferred
     * @return `true` if the transfer succeeds, `false` otherwise
     */
    function transfer(address _recipient, uint256 _amount) public virtual override returns (bool) {
        _transfer(_msgSender(), _recipient, _amount);
        emit Transfer(_msgSender(), _recipient, _amount);
        return true;
    }

    /**
     * @notice Allows `spender` to spend the tokens owned by _msgSender()
     * @param _spender The user allowed to spend _msgSender() tokens
     * @return `true`
     */
    function approve(address _spender, uint256 _amount) public virtual override returns (bool) {
        _approve(_msgSender(), _spender, _amount);
        return true;
    }

    /**
     * @notice Executes a transfer of token from sender to recipient, if _msgSender() is allowed to do so
     * @param _sender The owner of the tokens
     * @param _recipient The recipient of the tokens
     * @param _amount The amount of tokens being transferred
     * @return `true` if the transfer succeeds, `false` otherwise
     */
    function transferFrom(
        address _sender,
        address _recipient,
        uint256 _amount
    ) public virtual override returns (bool) {
        require(
            allowances[_sender][_msgSender()] >= _amount,
            "ERC20: transfer amount exceeds allowance"
        );
        _transfer(_sender, _recipient, _amount);
        _approve(_sender, _msgSender(), allowances[_sender][_msgSender()] - _amount);
        emit Transfer(_sender, _recipient, _amount);
        return true;
    }

    /**
     * @notice Increases the allowance of spender to spend _msgSender() tokens
     * @param _spender The user allowed to spend on behalf of _msgSender()
     * @param _addedValue The amount being added to the allowance
     * @return `true`
     */
    function increaseAllowance(
        address _spender,
        uint256 _addedValue
    ) public virtual returns (bool) {
        _approve(_msgSender(), _spender, allowances[_msgSender()][_spender] + _addedValue);
        return true;
    }

    /**
     * @notice Decreases the allowance of spender to spend _msgSender() tokens
     * @param _spender The user allowed to spend on behalf of _msgSender()
     * @param _subtractedValue The amount being subtracted to the allowance
     * @return `true`
     */
    function decreaseAllowance(
        address _spender,
        uint256 _subtractedValue
    ) public virtual returns (bool) {
        require(
            allowances[_msgSender()][_spender] >= _subtractedValue,
            "ERC20: decreased allowance below zero"
        );
        _approve(_msgSender(), _spender, allowances[_msgSender()][_spender] - _subtractedValue);
        return true;
    }

    /**
     * @notice Returns the allowance of spender on the tokens owned by owner
     * @param _owner The owner of the tokens
     * @param _spender The user allowed to spend the owner's tokens
     * @return The amount of owner's tokens spender is allowed to spend
     */
    function allowance(
        address _owner,
        address _spender
    ) public view virtual override returns (uint256) {
        return allowances[_owner][_spender];
    }

    /**
     * @return The total supply of the token
     */
    function totalSupply() public view virtual override returns (uint256) {
        return totalSupply_;
    }

    /**
     * @return The name of the token
     */
    function name() public view override returns (string memory) {
        return name_;
    }

    /**
     * @return The symbol of the token
     */
    function symbol() public view override returns (string memory) {
        return symbol_;
    }

    /**
     * @return The decimals of the token
     */
    function decimals() public view override returns (uint8) {
        return decimals_;
    }

    /**
     * @return The balance of the token for the account
     * @param _account The account to get the balance of the account
     */
    function balanceOf(address _account) public view virtual override returns (uint256) {
        return balances[_account];
    }

    /**
     * @notice Transfers tokens from one address to another
     * @param _sender Sender of the tokens
     * @param _recipient Recipient of the tokens
     * @param _amount Amount of tokens to transfer
     */
    function _transfer(address _sender, address _recipient, uint256 _amount) internal virtual {
        require(_sender != address(0), "ERC20: transfer from the zero address");
        require(_recipient != address(0), "ERC20: transfer to the zero address");

        _beforeTokenTransfer(_sender, _recipient, _amount);

        uint256 oldSenderBalance = balances[_sender];
        require(oldSenderBalance >= _amount, "ERC20: transfer amount exceeds balance");
        balances[_sender] = oldSenderBalance - _amount;
        balances[_recipient] += _amount;
    }

    /**
     * @notice Mints tokens to the account
     * @param _account The account to mint the tokens to
     * @param _amount The amount of tokens to mint
     */
    function _mint(address _account, uint256 _amount) internal virtual {
        require(_account != address(0), "ERC20: mint to the zero address");

        _beforeTokenTransfer(address(0), _account, _amount);

        uint256 oldTotalSupply = totalSupply_;
        totalSupply_ = oldTotalSupply + _amount;

        uint256 oldAccountBalance = balances[_account];
        balances[_account] = oldAccountBalance + _amount;
    }

    /**
     * @notice Burns tokens from the account
     * @param _account The account to burn the tokens from
     * @param _amount The amount of tokens to burn
     */
    function _burn(address _account, uint256 _amount) internal virtual {
        require(_account != address(0), "ERC20: burn from the zero address");

        _beforeTokenTransfer(_account, address(0), _amount);

        uint256 oldTotalSupply = totalSupply_;
        totalSupply_ = oldTotalSupply - _amount;

        uint256 oldAccountBalance = balances[_account];
        require(oldAccountBalance >= _amount, "ERC20: burn amount exceeds balance");
        balances[_account] = oldAccountBalance - _amount;
    }

    /**
     * @notice Sets the allowance of spender to spend on behalf of owner
     * @param _owner The owner of the tokens
     * @param _spender The user allowed to spend on behalf of the owner
     * @param _amount The amount being allowed to spend
     */
    function _approve(address _owner, address _spender, uint256 _amount) internal virtual {
        require(_owner != address(0), "ERC20: approve from the zero address");
        require(_spender != address(0), "ERC20: approve to the zero address");

        allowances[_owner][_spender] = _amount;
        emit Approval(_owner, _spender, _amount);
    }

    /**
     * @notice Sets the name of the token
     * @param _newName The new name of the token
     */
    function _setName(string memory _newName) internal {
        name_ = _newName;
    }

    /**
     * @notice Sets the symbol of the token
     * @param _newSymbol The new symbol of the token
     */
    function _setSymbol(string memory _newSymbol) internal {
        symbol_ = _newSymbol;
    }

    /**
     * @notice Sets the decimals of the token
     * @param _newDecimals The new decimals of the token
     */
    function _setDecimals(uint8 _newDecimals) internal {
        decimals_ = _newDecimals;
    }

    /**
     * @notice Hook that is called before any transfer of tokens. This includes minting and burning
     * @param _from The account the tokens are transferred from
     * @param _to The account the tokens are transferred to
     * @param _amount The amount of tokens being transferred
     */
    function _beforeTokenTransfer(address _from, address _to, uint256 _amount) internal virtual {
        // solhint-disable-previous-line no-empty-blocks
    }
}
