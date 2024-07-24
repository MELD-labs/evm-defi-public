// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {FlashLoanReceiverBase, IERC20} from "../base/FlashLoanReceiverBase.sol";
import {IAddressesProvider} from "../interfaces/IAddressesProvider.sol";

contract MockFlashLoanReceiver is FlashLoanReceiverBase {
    address public tokenOwner;
    bool public spendAllTokens;
    bool public forceFail;

    /**
     * @notice Constructor
     * @param _addressesProvider The protocol address provider
     */
    constructor(
        IAddressesProvider _addressesProvider,
        address _tokenOwner
    ) FlashLoanReceiverBase(_addressesProvider) {
        tokenOwner = _tokenOwner;
    }

    /**
     * @notice Calls the flashLoan function of the LendingPool
     * @param _assets the addresses of the assets being flash-borrowed
     * @param _amounts the amounts amounts being flash-borrowed
     * @param _params Variadic packed params to pass to the receiver as extra information
     */
    function flashLoan(
        address[] calldata _assets,
        uint256[] calldata _amounts,
        bytes calldata _params
    ) external {
        LENDING_POOL.flashLoan(_assets, _amounts, _params);
    }

    /**
     * @notice Executes the operation on the flash loan
     * @param _assets The assets being flash-borrowed
     * @param _amounts The amounts being flash-borrowed
     * @param _premiums The premiums of the flash loan
     * @param _initiator The initiator of the flash loan
     * @param _params Extra parameters for the flash loan
     * @return bool true if the operation was successful
     */
    function executeOperation(
        address[] calldata _assets,
        uint256[] calldata _amounts,
        uint256[] calldata _premiums,
        address _initiator,
        bytes calldata _params
    ) external override returns (bool) {
        if (forceFail) {
            return false;
        }
        _initiator;
        _params;
        for (uint256 i = 0; i < _assets.length; i++) {
            IERC20 currentToken = IERC20(_assets[i]);
            require(
                currentToken.balanceOf(address(this)) == _amounts[i],
                "Has not received the flash loan tokens properly"
            );
            currentToken.approve(address(LENDING_POOL), _amounts[i] + _premiums[i]);
            if (spendAllTokens) {
                // This will fail since the contract won't have enough tokens to repay the loan
                currentToken.transfer(tokenOwner, _amounts[i]);
            } else {
                // The contracts gets the tokens of the premium amount to be able to pay for the loan + premium
                currentToken.transferFrom(tokenOwner, address(this), _premiums[i]);
            }
        }

        return true;
    }

    function setSpendAllTokens(bool _spendAllTokens) external {
        spendAllTokens = _spendAllTokens;
    }

    function setForceFail(bool _forceFail) external {
        forceFail = _forceFail;
    }
}
