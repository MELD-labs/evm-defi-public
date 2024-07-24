// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {
    ValidationLogic,
    ReserveLogic,
    ReserveConfiguration,
    UserConfiguration,
    Errors,
    DataTypes,
    PercentageMath
} from "./ValidationLogic.sol";
import {IMToken} from "../../interfaces/IMToken.sol";
import {IFlashLoanReceiver} from "../../interfaces/IFlashLoanReceiver.sol";

/**
 * @title FlashLoanLogic library
 * @notice Implements actions involving flash loans
 * @author MELD team
 */
library FlashLoanLogic {
    using SafeERC20 for IERC20;
    using PercentageMath for uint256;
    using ReserveLogic for DataTypes.ReserveData;
    using ReserveConfiguration for DataTypes.ReserveConfigurationMap;
    using UserConfiguration for DataTypes.UserConfigurationMap;

    struct FlashLoanLocalVars {
        uint256 i;
        uint256 currentAmount;
        uint256 currentPremium;
        IFlashLoanReceiver receiver;
        address currentAsset;
        address currentMTokenAddress;
    }

    struct ExecuteFlashLoanParams {
        address dataProviderAddress;
        address[] assets;
        uint256[] amounts;
        bytes params;
    }

    /**
     * @dev Emitted on flashLoan()
     * @param target The address of the flash loan receiver contract
     * @param asset The address of the asset being flash borrowed
     * @param amount The amount flash borrowed
     * @param premium The fee flash borrowed
     */
    event FlashLoan(address indexed target, address indexed asset, uint256 amount, uint256 premium);

    /**
     * @dev Executes a flash loan
     * @param _reservesData the data of the reserves
     * @param _flashLoanPremiumTotal the total flash loan premium
     * @param _params the parameters of the flash loan
     */
    function executeFlashLoan(
        mapping(address => DataTypes.ReserveData) storage _reservesData,
        uint256 _flashLoanPremiumTotal,
        ExecuteFlashLoanParams memory _params
    ) external {
        ValidationLogic.validateFlashLoan(
            msg.sender,
            _params.dataProviderAddress,
            _params.assets,
            _params.amounts
        );

        FlashLoanLocalVars memory vars;

        address[] memory mTokenAddresses = new address[](_params.assets.length);
        uint256[] memory premiums = new uint256[](_params.assets.length);

        vars.receiver = IFlashLoanReceiver(msg.sender);

        for (vars.i = 0; vars.i < _params.assets.length; vars.i++) {
            mTokenAddresses[vars.i] = _reservesData[_params.assets[vars.i]].mTokenAddress;

            premiums[vars.i] = _params.amounts[vars.i].percentMul(_flashLoanPremiumTotal);

            // Transfers the assets to the receiver
            IMToken(mTokenAddresses[vars.i]).transferUnderlyingTo(
                msg.sender,
                _params.amounts[vars.i]
            );
        }

        require(
            vars.receiver.executeOperation(
                _params.assets,
                _params.amounts,
                premiums,
                msg.sender,
                _params.params
            ),
            Errors.FLL_INVALID_FLASH_LOAN_EXECUTOR_RETURN
        );

        for (vars.i = 0; vars.i < _params.assets.length; vars.i++) {
            vars.currentAsset = _params.assets[vars.i];
            vars.currentAmount = _params.amounts[vars.i];
            vars.currentPremium = premiums[vars.i];
            vars.currentMTokenAddress = mTokenAddresses[vars.i];

            _reservesData[vars.currentAsset].updateState();

            _reservesData[vars.currentAsset].updateInterestRates(
                vars.currentAsset,
                vars.currentMTokenAddress,
                vars.currentAmount,
                0
            );

            // Transfers the flash loan fee to the treasury of the reserve
            IERC20(vars.currentAsset).safeTransferFrom(
                msg.sender,
                IMToken(vars.currentMTokenAddress).RESERVE_TREASURY_ADDRESS(),
                vars.currentPremium
            );

            // Returns the flash loan
            IERC20(vars.currentAsset).safeTransferFrom(
                msg.sender,
                vars.currentMTokenAddress,
                vars.currentAmount
            );

            emit FlashLoan(msg.sender, vars.currentAsset, vars.currentAmount, vars.currentPremium);
        }
    }
}
