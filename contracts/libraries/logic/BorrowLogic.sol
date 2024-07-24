// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IAccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {
    ValidationLogic,
    ReserveLogic,
    DataTypes,
    Errors,
    UserConfiguration
} from "./ValidationLogic.sol";
import {IMToken, IAddressesProvider} from "../../interfaces/IMToken.sol";
import {IStableDebtToken} from "../../interfaces/IStableDebtToken.sol";
import {IVariableDebtToken} from "../../interfaces/IVariableDebtToken.sol";

/**
 * @title BorrowLogic library
 * @notice Implements the borrow action
 * @author MELD team
 */
library BorrowLogic {
    using ReserveLogic for DataTypes.ReserveData;
    using UserConfiguration for DataTypes.UserConfigurationMap;

    struct ExecuteBorrowParams {
        address asset;
        address user;
        address onBehalfOf;
        address mTokenAddress;
        address addressesProvider;
        uint256 amount;
        uint256 interestRateMode;
        uint256 maxStableRateBorrowSizePercent;
        uint256 reservesCount;
    }

    /**
     * @notice Emitted when a user borrows an asset from the reserve
     * @param reserve The address of the reserve
     * @param user The address of the borrower
     * @param amount The amount borrowed
     * @param borrowRateMode The rate mode: 1 for Stable, 2 for Variable
     * @param borrowRate The rate at which the user has borrowed
     */
    event Borrow(
        address indexed reserve,
        address indexed user,
        address indexed onBehalfOf,
        uint256 amount,
        uint256 borrowRateMode,
        uint256 borrowRate
    );

    /**
     * @notice Executes the borrow process based on the parameters of the `_params` object
     * @param _reservesData Data of all the reserves
     * @param _reservesList Mapping of all the active reserves
     * @param _usersConfig Mapping of all user configurations
     * @param _params Struct that contains the parameters needed to borrow from the protocol
     * @return borrowAmount The final amount borrowed
     */
    function executeBorrow(
        mapping(address => DataTypes.ReserveData) storage _reservesData,
        mapping(uint256 => address) storage _reservesList,
        mapping(address => DataTypes.UserConfigurationMap) storage _usersConfig,
        ExecuteBorrowParams memory _params
    ) external returns (uint256 borrowAmount) {
        DataTypes.ReserveData storage reserve = _reservesData[_params.asset];
        DataTypes.UserConfigurationMap storage userConfig = _usersConfig[_params.onBehalfOf];

        address oracle = IAddressesProvider(_params.addressesProvider).getPriceOracle();
        address dataProviderAddress = IAddressesProvider(_params.addressesProvider)
            .getProtocolDataProvider();
        address debtTokenUser = _params.user;

        // If onBehalfOf is not the msg.sender, there can be credit delegation or genius loan
        if (
            _params.onBehalfOf != msg.sender &&
            IAccessControl(_params.addressesProvider).hasRole(
                IAddressesProvider(_params.addressesProvider).GENIUS_LOAN_ROLE(),
                msg.sender
            )
        ) {
            // If the _onBehalfOf is not the msg.sender and has the genius loan role, we assume it's not credit delegation, it's genius loan
            // So we check if the user configuration has accepted genius loan
            require(
                _usersConfig[_params.onBehalfOf].acceptGeniusLoan,
                Errors.LP_USER_NOT_ACCEPT_GENIUS_LOAN
            );
            debtTokenUser = _params.onBehalfOf; // Will not decrease allowance when minting debt token
        }

        borrowAmount = ValidationLogic.validateBorrow(
            ValidationLogic.ValidateBorrowInputVars(
                _params.asset,
                _params.onBehalfOf,
                _params.amount,
                _params.interestRateMode,
                _params.maxStableRateBorrowSizePercent,
                userConfig,
                _params.reservesCount,
                oracle,
                dataProviderAddress
            ),
            _reservesList,
            _reservesData,
            reserve
        );

        uint256 currentStableRate = 0;

        bool isFirstBorrowing = false;
        if (
            DataTypes.InterestRateMode(_params.interestRateMode) ==
            DataTypes.InterestRateMode.STABLE
        ) {
            currentStableRate = reserve.currentStableBorrowRate;

            isFirstBorrowing = IStableDebtToken(reserve.stableDebtTokenAddress).mint(
                debtTokenUser,
                _params.onBehalfOf,
                borrowAmount,
                currentStableRate
            );
        } else {
            isFirstBorrowing = IVariableDebtToken(reserve.variableDebtTokenAddress).mint(
                debtTokenUser,
                _params.onBehalfOf,
                borrowAmount,
                reserve.variableBorrowIndex
            );
        }

        if (isFirstBorrowing) {
            userConfig.setBorrowing(reserve.id, true);
        }

        reserve.updateInterestRates(_params.asset, _params.mTokenAddress, 0, borrowAmount);

        IMToken(_params.mTokenAddress).transferUnderlyingTo(_params.user, borrowAmount);

        emit Borrow(
            _params.asset,
            _params.user,
            _params.onBehalfOf,
            borrowAmount,
            _params.interestRateMode,
            DataTypes.InterestRateMode(_params.interestRateMode) ==
                DataTypes.InterestRateMode.STABLE
                ? currentStableRate
                : reserve.currentVariableBorrowRate
        );
    }
}
