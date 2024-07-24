// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {
    ValidationLogic,
    ReserveLogic,
    UserConfiguration,
    Errors,
    DataTypes
} from "./ValidationLogic.sol";
import {IStableDebtToken} from "../../interfaces/IStableDebtToken.sol";
import {IVariableDebtToken} from "../../interfaces/IVariableDebtToken.sol";

/**
 * @title RepayLogic library
 * @notice Implements the repay action
 * @author MELD team
 */
library RepayLogic {
    using ReserveLogic for DataTypes.ReserveData;
    using UserConfiguration for DataTypes.UserConfigurationMap;
    using SafeERC20 for IERC20;

    struct ExecuteRepayParams {
        address asset;
        uint256 amount;
        uint256 rateMode;
        address onBehalfOf;
    }

    /**
     * @notice Emitted when a user repays a borrow in the reserve
     * @param reserve The address of the reserve
     * @param user The address of the borrower
     * @param repayer The address of the repayer
     * @param amount The amount repaid
     */
    event Repay(
        address indexed reserve,
        address indexed user,
        address indexed repayer,
        uint256 amount
    );

    /**
     * @notice Repays a loan (borrow) on the reserve. The target user is defined by the `ExecuteRepayParams onBehalfOf` parameter
     * @param _reservesData Data of all the reserves
     * @param _usersConfig Mapping of all user configurations
     * @param _params Struct containing the parameters needed to repay the loan (borrow)
     * @return stableDebt The borrower's stable
     * @return variableDebt The borrower's variable debt
     * @return paybackAmount The final amount repaid
     */
    function executeRepay(
        mapping(address => DataTypes.ReserveData) storage _reservesData,
        mapping(address => DataTypes.UserConfigurationMap) storage _usersConfig,
        ExecuteRepayParams memory _params
    ) external returns (uint256 stableDebt, uint256 variableDebt, uint256 paybackAmount) {
        require(_params.asset != address(0), Errors.INVALID_ADDRESS);

        DataTypes.ReserveData storage reserve = _reservesData[_params.asset];

        (stableDebt, variableDebt) = ValidationLogic.validateRepay(
            reserve,
            _params.amount,
            _params.rateMode,
            _params.onBehalfOf
        );

        DataTypes.InterestRateMode interestRateMode = DataTypes.InterestRateMode(_params.rateMode);

        paybackAmount = interestRateMode == DataTypes.InterestRateMode.STABLE
            ? stableDebt
            : variableDebt;

        // Get the repayer's balance of the underlying asset
        uint256 payerDebtAssetBalance = IERC20(_params.asset).balanceOf(msg.sender);

        // If the amount is equal to type(uint256).max, the user wants to repay all the debt. However,  if the underlying asset balance is not enough,
        // we should repay the maximum possible based on the underlying asset balance.
        if (_params.amount == type(uint256).max) {
            if (payerDebtAssetBalance < paybackAmount) {
                paybackAmount = payerDebtAssetBalance;
            }
        } else {
            if (_params.amount < paybackAmount) {
                paybackAmount = _params.amount;
            }
        }

        if (interestRateMode == DataTypes.InterestRateMode.STABLE) {
            IStableDebtToken(reserve.stableDebtTokenAddress).burn(
                _params.onBehalfOf,
                paybackAmount
            );
        } else {
            IVariableDebtToken(reserve.variableDebtTokenAddress).burn(
                _params.onBehalfOf,
                paybackAmount,
                reserve.variableBorrowIndex
            );
        }

        address mToken = reserve.mTokenAddress;
        reserve.updateInterestRates(_params.asset, mToken, paybackAmount, 0);

        IERC20(_params.asset).safeTransferFrom(msg.sender, mToken, paybackAmount);

        emit Repay(_params.asset, _params.onBehalfOf, msg.sender, paybackAmount);

        if (stableDebt + variableDebt - paybackAmount == 0) {
            _usersConfig[_params.onBehalfOf].setBorrowing(reserve.id, false);
        }
    }
}
