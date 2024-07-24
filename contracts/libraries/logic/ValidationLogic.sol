// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {
    GenericLogic,
    ReserveLogic,
    ReserveConfiguration,
    UserConfiguration,
    WadRayMath,
    PercentageMath,
    Errors,
    DataTypes
} from "./GenericLogic.sol";
import {Helpers} from "../helpers/Helpers.sol";
import {IMeldProtocolDataProvider} from "../../interfaces/IMeldProtocolDataProvider.sol";
import {IMToken} from "../../interfaces/IMToken.sol";
import {IPriceOracle} from "../../interfaces/IPriceOracle.sol";

/**
 * @title ValidationLogic library
 * @notice Implements the validation functions for the MELD protocol
 * @dev The validation functions are used to validate the inputs and the state of the protocol
 * before executing the actions.
 * @author MELD team
 */
library ValidationLogic {
    using ReserveLogic for DataTypes.ReserveData;
    using WadRayMath for uint256;
    using PercentageMath for uint256;
    using SafeERC20 for IERC20;
    using ReserveConfiguration for DataTypes.ReserveConfigurationMap;
    using UserConfiguration for DataTypes.UserConfigurationMap;

    struct ValidateBorrowInputVars {
        address asset;
        address userAddress;
        uint256 amount;
        uint256 interestRateMode;
        uint256 maxStableLoanPercent;
        DataTypes.UserConfigurationMap userConfig;
        uint256 reservesCount;
        address oracle;
        address dataProviderAddress;
    }

    struct ValidateBorrowLocalVars {
        uint256 currentLtv;
        uint256 currentLiquidationThreshold;
        uint256 amountOfCollateralNeededUSD;
        uint256 userCollateralBalanceUSD;
        uint256 userBorrowBalanceUSD;
        uint256 availableLiquidity;
        uint256 healthFactor;
        uint256 borrowAmountUSD;
        bool isActive;
        bool isFrozen;
        bool borrowingEnabled;
        bool stableRateBorrowingEnabled;
    }

    uint256 public constant REBALANCE_UP_LIQUIDITY_RATE_THRESHOLD = 4000;
    uint256 public constant REBALANCE_UP_USAGE_RATIO_THRESHOLD = 0.95 * 1e27; //usage ratio of 95%

    /**
     * @notice Validates the action of setting an asset as collateral
     * @param _reserve The state of the reserve that the user is enabling or disabling as collateral
     * @param _reserveAddress The address of the reserve
     * @param _useAsCollateral `true` if the user wants to use the deposit as collateral, `false` otherwise
     * @param _reservesData The data of all the reserves
     * @param _userConfig The state of the user for the specific reserve
     * @param _reserves The addresses of all the active reserves
     * @param _reservesCount The number of reserves
     * @param _oracle The price oracle
     */
    function validateSetUseReserveAsCollateral(
        DataTypes.ReserveData storage _reserve,
        address _reserveAddress,
        bool _useAsCollateral,
        mapping(address => DataTypes.ReserveData) storage _reservesData,
        DataTypes.UserConfigurationMap storage _userConfig,
        mapping(uint256 => address) storage _reserves,
        uint256 _reservesCount,
        address _oracle
    ) external view {
        uint256 underlyingBalance = IERC20(_reserve.mTokenAddress).balanceOf(msg.sender);
        require(underlyingBalance > 0, Errors.VL_UNDERLYING_BALANCE_NOT_GREATER_THAN_0);

        require(
            _useAsCollateral ||
                GenericLogic.balanceDecreaseAllowed(
                    _reserveAddress,
                    msg.sender,
                    underlyingBalance,
                    _reservesData,
                    _userConfig,
                    _reserves,
                    _reservesCount,
                    _oracle
                ),
            Errors.VL_DEPOSIT_ALREADY_IN_USE
        );
    }

    /**
     * @notice Validates a deposit action
     * @param _reserve The reserve into which the user is depositing
     * @param _amount The amount to be deposited
     * @param _onBehalfOf The address on behalf of which the user is depositing
     * @param _asset The address of the underlying asset being deposited
     * @param _dataProviderAddress The address of the data provider
     * @return amountToDeposit The final amount to be deposited
     */
    function validateDeposit(
        DataTypes.ReserveData storage _reserve,
        uint256 _amount,
        address _onBehalfOf,
        address _asset,
        address _dataProviderAddress
    ) internal returns (uint256 amountToDeposit) {
        (bool isActive, bool isFrozen, , ) = _reserve.configuration.getFlags();

        require(_onBehalfOf != address(0), Errors.INVALID_ADDRESS);
        require(_amount != 0, Errors.VL_INVALID_AMOUNT);
        require(isActive, Errors.VL_NO_ACTIVE_RESERVE);
        require(!isFrozen, Errors.VL_RESERVE_FROZEN);

        _reserve.updateState();

        // The caller provides the underlying tokens for the deposit
        uint256 userBalance = IERC20(_asset).balanceOf(msg.sender);
        amountToDeposit = _amount;

        if (_amount == type(uint256).max) {
            amountToDeposit = userBalance;
        }

        require(amountToDeposit <= userBalance, Errors.VL_NOT_ENOUGH_AVAILABLE_USER_BALANCE);

        IMeldProtocolDataProvider dataProvider = IMeldProtocolDataProvider(_dataProviderAddress);
        (uint256 supplyCap, uint256 currentSupplied, , ) = dataProvider.getSupplyCapData(_asset);
        if (supplyCap != 0) {
            require(
                amountToDeposit + currentSupplied <= supplyCap,
                Errors.VL_RESERVE_SUPPLY_CAP_REACHED
            );
        }
    }

    /**
     * @notice Validates a withdraw action
     * @param _reserveAddress The address of the reserve
     * @param _amount The amount to be withdrawn
     * @param _to The address to which the amount is to be withdrawn
     * @param _reservesData The data of all the reserves
     * @param _userConfig The user configuration
     * @param _reserves The addresses of the reserves
     * @param _reservesCount The number of reserves
     * @param _oracle The price oracle
     */
    function validateWithdraw(
        address _reserveAddress,
        uint256 _amount,
        address _from,
        address _to,
        mapping(address => DataTypes.ReserveData) storage _reservesData,
        DataTypes.UserConfigurationMap storage _userConfig,
        mapping(uint256 => address) storage _reserves,
        uint256 _reservesCount,
        address _oracle
    ) internal returns (uint256 amountToWithdraw, uint256 userBalance) {
        require(_reserveAddress != address(0), Errors.INVALID_ADDRESS);
        require(_to != address(0), Errors.INVALID_ADDRESS);
        require(_amount != 0, Errors.VL_INVALID_AMOUNT);

        DataTypes.ReserveData storage reserve = _reservesData[_reserveAddress];

        (bool isActive, , , ) = reserve.configuration.getFlags();
        require(isActive, Errors.VL_NO_ACTIVE_RESERVE);

        reserve.updateState();

        address mToken = reserve.mTokenAddress;
        userBalance = IMToken(mToken).balanceOf(_from);

        amountToWithdraw = _amount;

        if (_amount == type(uint256).max) {
            amountToWithdraw = userBalance;
        }

        require(amountToWithdraw <= userBalance, Errors.VL_NOT_ENOUGH_AVAILABLE_USER_BALANCE);

        require(
            GenericLogic.balanceDecreaseAllowed(
                _reserveAddress,
                _from,
                amountToWithdraw,
                _reservesData,
                _userConfig,
                _reserves,
                _reservesCount,
                _oracle
            ),
            Errors.VL_TRANSFER_NOT_ALLOWED
        );
    }

    /**
     * @notice Validates a borrow action
     * @param _inputVars ValidateBorrowInputVars struct of input parameters
     * @param _reserves The addresses of all the reserves
     * @param _reservesData The data of all the reserves
     * @param _reserve The state of the reserve from which the user is borrowing
     * @return borrowAmount The final borrowed
     */
    function validateBorrow(
        ValidateBorrowInputVars memory _inputVars,
        mapping(uint256 => address) storage _reserves,
        mapping(address => DataTypes.ReserveData) storage _reservesData,
        DataTypes.ReserveData storage _reserve
    ) internal returns (uint256 borrowAmount) {
        ValidateBorrowLocalVars memory vars;

        (
            vars.isActive,
            vars.isFrozen,
            vars.borrowingEnabled,
            vars.stableRateBorrowingEnabled
        ) = _reserve.configuration.getFlags();

        require(vars.isActive, Errors.VL_NO_ACTIVE_RESERVE);
        require(!vars.isFrozen, Errors.VL_RESERVE_FROZEN);
        require(_inputVars.amount != 0, Errors.VL_INVALID_AMOUNT);

        require(vars.borrowingEnabled, Errors.VL_BORROWING_NOT_ENABLED);

        _reserve.updateState();

        //validate interest rate mode
        require(
            uint256(DataTypes.InterestRateMode.VARIABLE) == _inputVars.interestRateMode ||
                uint256(DataTypes.InterestRateMode.STABLE) == _inputVars.interestRateMode,
            Errors.VL_INVALID_INTEREST_RATE_MODE_SELECTED
        );

        (
            vars.userCollateralBalanceUSD,
            vars.userBorrowBalanceUSD,
            vars.currentLtv,
            vars.currentLiquidationThreshold,
            vars.healthFactor
        ) = GenericLogic.calculateUserAccountData(
            _inputVars.userAddress,
            _reservesData,
            _inputVars.userConfig,
            _reserves,
            _inputVars.reservesCount,
            _inputVars.oracle
        );

        require(vars.userCollateralBalanceUSD > 0, Errors.VL_COLLATERAL_BALANCE_IS_0);

        require(
            vars.healthFactor > GenericLogic.HEALTH_FACTOR_LIQUIDATION_THRESHOLD,
            Errors.VL_HEALTH_FACTOR_LOWER_THAN_LIQUIDATION_THRESHOLD
        );

        (uint256 assetPrice, bool oracleSuccess) = IPriceOracle(_inputVars.oracle).getAssetPrice(
            _inputVars.asset
        );
        require(oracleSuccess, Errors.INVALID_ASSET_PRICE);

        if (_inputVars.amount == type(uint256).max) {
            // User is borrowing the maximum possible amount. User can't borrow more than the LTV amount minus the amount already borrowed
            vars.borrowAmountUSD =
                vars.userCollateralBalanceUSD.percentMul(vars.currentLtv) -
                vars.userBorrowBalanceUSD;

            // Double check that the borrow is covered by the available collateral
            require(
                vars.borrowAmountUSD <= vars.userCollateralBalanceUSD,
                Errors.VL_COLLATERAL_CANNOT_COVER_NEW_BORROW
            );
            require(vars.borrowAmountUSD != 0, Errors.VL_INVALID_AMOUNT);

            uint256 assetDecimals = _reserve.configuration.getDecimals();
            uint256 tokenUnit = 10 ** assetDecimals;

            borrowAmount = (tokenUnit * vars.borrowAmountUSD) / assetPrice;
        } else {
            uint256 amountInUSD = (assetPrice * _inputVars.amount) /
                (10 ** _reserve.configuration.getDecimals());

            // Add the current already borrowed amount to the amount requested to calculate the total collateral needed.
            vars.amountOfCollateralNeededUSD = (vars.userBorrowBalanceUSD + amountInUSD).percentDiv(
                vars.currentLtv
            ); //LTV is calculated in percentage

            require(
                vars.amountOfCollateralNeededUSD <= vars.userCollateralBalanceUSD,
                Errors.VL_COLLATERAL_CANNOT_COVER_NEW_BORROW
            );

            borrowAmount = _inputVars.amount;
        }

        IMeldProtocolDataProvider dataProvider = IMeldProtocolDataProvider(
            _inputVars.dataProviderAddress
        );

        (uint256 borrowCap, uint256 currentBorrowed, , ) = dataProvider.getBorrowCapData(
            _inputVars.asset
        );

        if (borrowCap != 0) {
            require(
                borrowAmount + currentBorrowed <= borrowCap,
                Errors.VL_RESERVE_BORROW_CAP_REACHED
            );
        }

        /**
         * Following conditions need to be met if the user is borrowing at a stable rate:
         * 1. Reserve must be enabled for stable rate borrowing
         * 2. Users cannot borrow from the reserve if their collateral is (mostly) the same currency
         *    they are borrowing, to prevent abuses.
         * 3. Users will be able to borrow only a portion of the total available liquidity
         *
         * For borrowing at a stable rate, the liquidity of the borrowed token must cover the amount to be borrowed.
         */

        vars.availableLiquidity = IERC20(_inputVars.asset).balanceOf(_reserve.mTokenAddress);

        if (_inputVars.interestRateMode == uint256(DataTypes.InterestRateMode.STABLE)) {
            //check if the borrow mode is stable and if stable rate borrowing is enabled on this reserve

            require(vars.stableRateBorrowingEnabled, Errors.VL_STABLE_BORROWING_NOT_ENABLED);

            require(
                !_inputVars.userConfig.isUsingAsCollateral(_reserve.id) ||
                    _reserve.configuration.getLiquidationThreshold() == 0 ||
                    borrowAmount > IERC20(_reserve.mTokenAddress).balanceOf(_inputVars.userAddress),
                Errors.VL_COLLATERAL_SAME_AS_BORROWING_CURRENCY
            );

            //calculate the max available loan size in stable rate mode as a percentage of the
            //available liquidity
            uint256 maxLoanSizeStable = vars.availableLiquidity.percentMul(
                _inputVars.maxStableLoanPercent
            );

            // The borrow amount calculated based on the user's collateral value may be too high in the case of stable rate borrowing
            if ((_inputVars.amount == type(uint256).max)) {
                borrowAmount = borrowAmount > maxLoanSizeStable ? maxLoanSizeStable : borrowAmount;
            } else {
                // Not using max amount flag. User provided a specific borrow amount
                require(
                    borrowAmount <= maxLoanSizeStable,
                    Errors.VL_AMOUNT_BIGGER_THAN_MAX_LOAN_SIZE_STABLE
                );
            }
        } else {
            // variable borrow mode
            if ((_inputVars.amount == type(uint256).max)) {
                borrowAmount = borrowAmount > vars.availableLiquidity
                    ? vars.availableLiquidity
                    : borrowAmount;
            } else {
                // Not using max amount flag. User provided a specific borrow amount
                require(
                    vars.availableLiquidity > borrowAmount,
                    Errors.VL_CURRENT_AVAILABLE_LIQUIDITY_NOT_ENOUGH_FOR_BORROW
                );
            }
        }
    }

    /**
     * @notice Validates a repay action
     * @param _reserve The reserve state for which the user is repaying
     * @param _amountSent The amount sent for the repayment. Can be an actual value or type(uint256).max
     * @param _interestRateMode The interest rate mode at which the user wants to borrow: 1 for Stable, 2 for Variable
     * @param _onBehalfOf The address of the user msg.sender is repaying for
     */
    function validateRepay(
        DataTypes.ReserveData storage _reserve,
        uint256 _amountSent,
        uint256 _interestRateMode,
        address _onBehalfOf
    ) internal returns (uint256 stableDebt, uint256 variableDebt) {
        require(_onBehalfOf != address(0), Errors.INVALID_ADDRESS);
        require(_amountSent > 0, Errors.VL_INVALID_AMOUNT);

        require(
            uint256(DataTypes.InterestRateMode.VARIABLE) == _interestRateMode ||
                uint256(DataTypes.InterestRateMode.STABLE) == _interestRateMode,
            Errors.VL_INVALID_INTEREST_RATE_MODE_SELECTED
        );

        bool isActive = _reserve.configuration.getActive();
        require(isActive, Errors.VL_NO_ACTIVE_RESERVE);

        _reserve.updateState();

        (stableDebt, variableDebt) = Helpers.getUserCurrentDebt(_onBehalfOf, _reserve);

        require(
            (stableDebt > 0 &&
                DataTypes.InterestRateMode(_interestRateMode) ==
                DataTypes.InterestRateMode.STABLE) ||
                (variableDebt > 0 &&
                    DataTypes.InterestRateMode(_interestRateMode) ==
                    DataTypes.InterestRateMode.VARIABLE),
            Errors.VL_NO_DEBT_OF_SELECTED_TYPE
        );

        require(
            _amountSent != type(uint256).max || msg.sender == _onBehalfOf,
            Errors.VL_NO_EXPLICIT_AMOUNT_TO_REPAY_ON_BEHALF
        );
    }

    /**
     * @notice Validates an mToken transfer
     * @param _from The user from which the mTokens are being transferred
     * @param _reservesData The state of all the reserves
     * @param _userConfig The state of the user for the specific reserve
     * @param _reserves The addresses of all the active reserves
     * @param _reservesCount The number of reserves
     * @param _oracle The price oracle
     */
    function validateTransfer(
        address _from,
        mapping(address => DataTypes.ReserveData) storage _reservesData,
        DataTypes.UserConfigurationMap storage _userConfig,
        mapping(uint256 => address) storage _reserves,
        uint256 _reservesCount,
        address _oracle
    ) internal view {
        (, , , , uint256 healthFactor) = GenericLogic.calculateUserAccountData(
            _from,
            _reservesData,
            _userConfig,
            _reserves,
            _reservesCount,
            _oracle
        );

        require(
            healthFactor >= GenericLogic.HEALTH_FACTOR_LIQUIDATION_THRESHOLD,
            Errors.VL_TRANSFER_NOT_ALLOWED
        );
    }

    /**
     * @notice Validates the liquidation action
     * @param _collateralReserve The reserve data of the collateral
     * @param _debtReserve The reserve data of the principal
     * @param _userConfig The user configuration
     * @param _user The address of the user (borrower)
     * @param _debtToCover The debt amount of borrowed `asset` the liquidator wants to cover
     * @param _userHealthFactor The user's health factor
     */
    function validateLiquidationCall(
        DataTypes.ReserveData storage _collateralReserve,
        DataTypes.ReserveData storage _debtReserve,
        DataTypes.UserConfigurationMap storage _userConfig,
        address _user,
        uint256 _debtToCover,
        uint256 _userHealthFactor
    ) internal view returns (uint256 userStableDebt, uint256 userVariableDebt) {
        require(_debtToCover != 0, Errors.VL_INVALID_AMOUNT);

        require(
            _userHealthFactor < GenericLogic.HEALTH_FACTOR_LIQUIDATION_THRESHOLD,
            Errors.LL_HEALTH_FACTOR_NOT_BELOW_THRESHOLD
        );

        bool isCollateralEnabled = _collateralReserve.configuration.getLiquidationThreshold() > 0 &&
            _userConfig.isUsingAsCollateral(_collateralReserve.id);

        //if collateral asset isn't enabled as collateral by user, it cannot be liquidated
        require(isCollateralEnabled, Errors.LL_COLLATERAL_CANNOT_BE_LIQUIDATED);

        (userStableDebt, userVariableDebt) = Helpers.getUserCurrentDebt(_user, _debtReserve);

        require(
            userStableDebt > 0 || userVariableDebt > 0,
            Errors.LL_SPECIFIED_CURRENCY_NOT_BORROWED_BY_USER
        );
    }

    /**
     * @notice Validates the flash loan action
     * @param receiverAddress The address of the receiver
     * @param _dataProviderAddress The address of the data provider
     * @param assets The array of assets that are requested
     * @param amounts The array of amounts that are requested
     */
    function validateFlashLoan(
        address receiverAddress,
        address _dataProviderAddress,
        address[] memory assets,
        uint256[] memory amounts
    ) internal view {
        require(receiverAddress != address(0), Errors.INVALID_ADDRESS);
        require(assets.length > 0, Errors.EMPTY_ARRAY);
        require(assets.length == amounts.length, Errors.INCONSISTENT_ARRAY_SIZE);

        IMeldProtocolDataProvider dataProvider = IMeldProtocolDataProvider(_dataProviderAddress);

        for (uint256 i = 0; i < assets.length; i++) {
            address currentAsset = assets[i];
            uint256 currentAmount = amounts[i];
            require(currentAsset != address(0), Errors.INVALID_ADDRESS);
            require(currentAmount > 0, Errors.VL_INVALID_AMOUNT);
            (uint256 flashLoanLimit, ) = dataProvider.getFlashLoanLimitData(currentAsset);
            require(currentAmount <= flashLoanLimit, Errors.VL_FLASH_LOAN_AMOUNT_OVER_LIMIT);
        }
    }
}
