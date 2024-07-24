// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {
    ValidationLogic,
    GenericLogic,
    ReserveLogic,
    UserConfiguration,
    DataTypes,
    Errors
} from "./ValidationLogic.sol";
import {IMToken, IAddressesProvider} from "../../interfaces/IMToken.sol";

/**
 * @title DepositLogic library
 * @notice Implements the deposit action
 * @author MELD team
 */
library DepositLogic {
    using ReserveLogic for DataTypes.ReserveData;
    using UserConfiguration for DataTypes.UserConfigurationMap;
    using SafeERC20 for IERC20;

    struct ExecuteDepositParams {
        address asset;
        address onBehalfOf;
        address addressesProvider;
        bool useAsCollateralOnFirstDeposit;
        uint256 amount;
    }

    /**
     * @notice Emitted when a user deposits an asset into the reserve
     * @param reserve The address of the reserve
     * @param user The address of the depositor
     * @param onBehalfOf The beneficiary of the deposit
     * @param amount The amount deposited
     */
    event Deposit(
        address indexed reserve,
        address indexed user,
        address indexed onBehalfOf,
        uint256 amount
    );

    /**
     * @notice Function to deposit an asset into the reserve. A corresponding amount of the overlying asset (mToken) is minted
     * @dev If it's the first deposit, the user can decide if he wants to use the deposit as collateral or not
     * @param _reserves Data of all the reserves
     * @param _usersConfig Mapping of all user configurations
     * @param _params Struct that contains the parameters needed to deposit funds into the protocol
     * @return amountToDeposit The final amount to be deposited
     */
    function executeDeposit(
        mapping(address => DataTypes.ReserveData) storage _reserves,
        mapping(address => DataTypes.UserConfigurationMap) storage _usersConfig,
        ExecuteDepositParams calldata _params
    ) external returns (uint256 amountToDeposit) {
        require(_params.asset != address(0), Errors.INVALID_ADDRESS);

        DataTypes.ReserveData storage reserve = _reserves[_params.asset];

        address dataProviderAddress = IAddressesProvider(_params.addressesProvider)
            .getProtocolDataProvider();

        amountToDeposit = ValidationLogic.validateDeposit(
            reserve,
            _params.amount,
            _params.onBehalfOf,
            _params.asset,
            dataProviderAddress
        );

        address mToken = reserve.mTokenAddress;

        reserve.updateInterestRates(_params.asset, mToken, amountToDeposit, 0);

        IERC20(_params.asset).safeTransferFrom(msg.sender, mToken, amountToDeposit);

        bool isFirstDeposit = IMToken(mToken).mint(
            _params.onBehalfOf,
            amountToDeposit,
            reserve.liquidityIndex
        );

        if (isFirstDeposit && _params.useAsCollateralOnFirstDeposit) {
            _usersConfig[_params.onBehalfOf].setUsingAsCollateral(reserve.id, true);
            emit GenericLogic.ReserveUsedAsCollateralEnabled(_params.asset, _params.onBehalfOf);
        }

        emit Deposit(_params.asset, msg.sender, _params.onBehalfOf, amountToDeposit);
    }
}
