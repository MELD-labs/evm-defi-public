// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {
    ValidationLogic,
    GenericLogic,
    ReserveLogic,
    UserConfiguration,
    DataTypes
} from "./ValidationLogic.sol";
import {IMToken, IAddressesProvider} from "../../interfaces/IMToken.sol";

/**
 * @title WithLogic library
 * @notice Implements actions wihdrawals
 * @author MELD team
 */
library WithdrawLogic {
    using ReserveLogic for DataTypes.ReserveData;
    using UserConfiguration for DataTypes.UserConfigurationMap;

    struct ExecuteWithdrawParams {
        address asset;
        address onBehalfOf;
        address to;
        address addressesProvider;
        uint256 amount;
        uint256 reservesCount;
    }

    /**
     * @notice Emitted when a user withdraws an asset from the reserve
     * @param reserve The address of the reserve
     * @param onBehalfOf The address of the user who's funds are being withdawn
     * @param user The address of the withdrawer
     * @param to The destination of the assets
     * @param amount The amount withdrawn
     */
    event Withdraw(
        address indexed reserve,
        address indexed onBehalfOf,
        address user,
        address indexed to,
        uint256 amount
    );

    /**
     * @notice Withdraws an `amount` of underlying asset from the reserve, burning the equivalent mTokens owned
     * E.g. User has 100 mUSDC, calls withdraw() and receives 100 USDC, burning the 100 mUSDC
     * @param _reservesData Data of all the reserves
     * @param _reservesList Mapping of all the active reserves.
     * @param _usersConfig Mapping of all user configurations
     * @param _params Struct that contains the parameters needed to withdraw funds from the protocol
     * @return amountToWithdraw The final amount withdrawn
     * @return userBalance The user balance
     */
    function executeWithdraw(
        mapping(address => DataTypes.ReserveData) storage _reservesData,
        mapping(uint256 => address) storage _reservesList,
        mapping(address => DataTypes.UserConfigurationMap) storage _usersConfig,
        ExecuteWithdrawParams memory _params
    ) external returns (uint256 amountToWithdraw, uint256 userBalance) {
        address oracle = IAddressesProvider(_params.addressesProvider).getPriceOracle();

        (amountToWithdraw, userBalance) = ValidationLogic.validateWithdraw(
            _params.asset,
            _params.amount,
            _params.onBehalfOf,
            _params.to,
            _reservesData,
            _usersConfig[_params.onBehalfOf],
            _reservesList,
            _params.reservesCount,
            oracle
        );

        DataTypes.ReserveData storage reserve = _reservesData[_params.asset];

        address mToken = reserve.mTokenAddress;

        reserve.updateInterestRates(_params.asset, mToken, 0, amountToWithdraw);

        IMToken(mToken).burn(
            _params.onBehalfOf,
            _params.to,
            amountToWithdraw,
            reserve.liquidityIndex
        );

        emit Withdraw(_params.asset, _params.onBehalfOf, msg.sender, _params.to, amountToWithdraw);

        // User is withdrawing the whole balance
        if (amountToWithdraw == userBalance) {
            _usersConfig[_params.onBehalfOf].setUsingAsCollateral(reserve.id, false);
            emit GenericLogic.ReserveUsedAsCollateralDisabled(_params.asset, _params.onBehalfOf);
        }
    }
}
