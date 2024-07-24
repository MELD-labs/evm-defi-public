// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ILendingPool} from "../interfaces/ILendingPool.sol";
import {Errors} from "../libraries/helpers/Errors.sol";
import {DataTypes} from "../libraries/types/DataTypes.sol";
import {ReserveLogic} from "../libraries/logic/ReserveLogic.sol";
import {ValidationLogic} from "../libraries/logic/ValidationLogic.sol";
import {GenericLogic} from "../libraries/logic/GenericLogic.sol";
import {LiquidationLogic} from "../libraries/logic/LiquidationLogic.sol";
import {BorrowLogic} from "../libraries/logic/BorrowLogic.sol";
import {DepositLogic} from "../libraries/logic/DepositLogic.sol";
import {FlashLoanLogic} from "../libraries/logic/FlashLoanLogic.sol";
import {WithdrawLogic} from "../libraries/logic/WithdrawLogic.sol";
import {YieldBoostLogic} from "../libraries/logic/YieldBoostLogic.sol";
import {RepayLogic} from "../libraries/logic/RepayLogic.sol";
import {ReserveConfiguration} from "../libraries/configuration/ReserveConfiguration.sol";
import {UserConfiguration} from "../libraries/configuration/UserConfiguration.sol";
import {WadRayMath} from "../libraries/math/WadRayMath.sol";
import {PercentageMath} from "../libraries/math/PercentageMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {LendingBase} from "../base/LendingBase.sol";
import {IMeldBankerBlocked} from "../interfaces/IMeldBankerBlocked.sol";
import {IMeldBankerNFT} from "../interfaces/IMeldBankerNFT.sol";
import {IYieldBoostStaking} from "../interfaces/yield-boost/IYieldBoostStaking.sol";
import {MockLibrary} from "./MockLibrary.sol";
import {
    ReentrancyGuardUpgradeable
} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

/**
 * @title MockLendingPoolWithNewLibrary contract
 * @notice Implements the actions of the LendingPool, including deposit, borrow, repay, liquidation, etc
 * @author MELD team
 */
contract MockLendingPoolWithNewLibrary is
    LendingBase,
    ILendingPool,
    IMeldBankerBlocked,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    using ReserveLogic for DataTypes.ReserveData;
    using ReserveConfiguration for DataTypes.ReserveConfigurationMap;
    using UserConfiguration for DataTypes.UserConfigurationMap;
    using SafeERC20 for IERC20;
    using WadRayMath for uint256;
    using PercentageMath for uint256;

    uint256 public reservesCount;
    uint256 public constant MAX_NUMBER_OF_RESERVES = 128;
    uint256 public flashLoanPremiumTotal;
    uint256 public maxStableRateBorrowSizePercent;
    uint256 public liquidationProtocolFeePercentage;

    IMeldBankerNFT public meldBankerNFT;

    mapping(address asset => DataTypes.ReserveData) private reserves;
    mapping(address user => DataTypes.UserConfigurationMap) private usersConfig;

    // The list of the available reserves, structured as a mapping for gas savings reasons
    mapping(uint256 index => address asset) private reservesList;

    mapping(uint256 tokenId => bool) public override isMeldBankerBlocked;
    mapping(address user => bool) public override isUsingMeldBanker;
    mapping(address user => YieldBoostLogic.MeldBankerData) public override userMeldBankerData;
    mapping(DataTypes.MeldBankerType => mapping(DataTypes.Action => uint256 yieldBoostMultiplier))
        public
        override yieldBoostMultipliers;

    // NEW MAPPING FOR UPGRADEABILITY TEST
    mapping(address asset => MockLibrary.MockStruct data) public mockMapping;

    /**
     * @notice Function to deposit an asset into the reserve while using a MELD Banker NFT Id to receive a benefit. A corresponding amount of the overlying asset (mToken) is minted
     * @dev If it's the first deposit, the user can decide if s/he wants to use the deposit as collateral or not
     * @param _asset Address of the underlying asset to deposit
     * @param _amount Amount to deposit
     * @param _onBehalfOf Address of the user who will receive the mTokens, same as msg.sender if the user is acting on her/his behalf
     * @param _useAsCollateralOnFirstDeposit true if the deposit will be used as collateral if it's the first deposit, false otherwise
     * @param _tokenId The Meld Banker NFT tokenId to be used to receive protocol benefits
     * @return amountToDeposit The final amount to be deposited
     */
    function deposit(
        address _asset,
        uint256 _amount,
        address _onBehalfOf,
        bool _useAsCollateralOnFirstDeposit,
        uint256 _tokenId
    ) external override whenNotPaused returns (uint256 amountToDeposit) {
        // if tokenId > 0, the the depositor is attempting to apply the Meld Banker yield boost benefit
        if (_tokenId > 0) {
            _checkYieldBoostAndMeldBankerNFT(_asset);

            // If user is already using the Meld Banker benefit, it cannot be used again, except for more of the same action on the same asset reserve.
            require(
                !isUsingMeldBanker[_onBehalfOf] ||
                    (userMeldBankerData[_onBehalfOf].asset == _asset &&
                        userMeldBankerData[_onBehalfOf].action == DataTypes.Action.DEPOSIT),
                Errors.LP_MELD_BANKER_NFT_LOCKED
            );

            // Check if user owns the tokenId
            require(
                meldBankerNFT.ownerOf(_tokenId) == _onBehalfOf,
                Errors.LP_NOT_OWNER_OF_MELD_BANKER_NFT
            );

            DataTypes.MeldBankerType bankerType = meldBankerNFT.isGolden(_tokenId)
                ? DataTypes.MeldBankerType.GOLDEN
                : DataTypes.MeldBankerType.BANKER;

            YieldBoostLogic.MeldBankerData memory meldBankerData = YieldBoostLogic.MeldBankerData({
                tokenId: _tokenId,
                asset: _asset,
                meldBankerType: bankerType,
                action: DataTypes.Action.DEPOSIT
            });

            // lock the tokenId if it's not already locked
            if (!isMeldBankerBlocked[_tokenId]) {
                YieldBoostLogic.lockMeldBankerNFT(
                    isMeldBankerBlocked,
                    isUsingMeldBanker,
                    userMeldBankerData,
                    _onBehalfOf,
                    meldBankerData
                );
            }
        }

        amountToDeposit = DepositLogic.executeDeposit(
            reserves,
            usersConfig,
            DepositLogic.ExecuteDepositParams(
                _asset,
                _onBehalfOf,
                address(addressesProvider),
                _useAsCollateralOnFirstDeposit,
                _amount
            )
        );

        return amountToDeposit;
    }

    /**
     * @notice Withdraws an `amount` of underlying asset from the reserve, burning the equivalent mTokens owned
     * E.g. User has 100 mUSDC, calls withdraw() and receives 100 USDC, burning the 100 mUSDC
     * @param _asset The address of the underlying asset to withdraw
     * @param _onBehalfOf User address on behalf of whom the caller is acting.
     *   - Must be the same as msg.sender if the user is acting on own behalf. Can only be different from msg.sender if the caller has the Genius Loan role
     * @param _amount The underlying amount to be withdrawn
     *   - Send the value type(uint256).max in order to withdraw the whole mToken balance
     * @param _to Address that will receive the underlying, same as msg.sender if the user
     *   wants to receive it on her/his own wallet, or a different address if the beneficiary is a
     *   different wallet
     * @return The final amount withdrawn
     */
    function withdraw(
        address _asset,
        address _onBehalfOf,
        uint256 _amount,
        address _to
    ) external override returns (uint256) {
        (uint256 amountToWithdraw, uint256 userBalance) = WithdrawLogic.executeWithdraw(
            reserves,
            reservesList,
            usersConfig,
            WithdrawLogic.ExecuteWithdrawParams(
                _asset,
                _onBehalfOf,
                _to,
                address(addressesProvider),
                _amount,
                reservesCount
            )
        );

        // User is withdrawing the whole balance
        if (amountToWithdraw == userBalance) {
            YieldBoostLogic.MeldBankerData memory meldBankerNFTData = userMeldBankerData[
                _onBehalfOf
            ];

            if (
                meldBankerNFTData.asset == _asset &&
                meldBankerNFTData.action == DataTypes.Action.DEPOSIT
            ) {
                YieldBoostLogic.unlockMeldBankerNFT(
                    isMeldBankerBlocked,
                    isUsingMeldBanker,
                    userMeldBankerData,
                    _onBehalfOf
                );
            }
        }

        return amountToWithdraw;
    }

    /**
     * @notice Allows users to borrow a specific `amount` of the reserve underlying asset, provided that the borrower
     * already deposited enough collateral, or s/he was given enough allowance by a credit delegator on the
     * corresponding debt token (StableDebtToken or VariableDebtToken)
     * - E.g. User borrows 100 USDC passing as `onBehalfOf` her/his own address, receiving the 100 USDC in her/his wallet
     *   and 100 stable/variable debt tokens, depending on the `interestRateMode`
     * @param _asset The address of the underlying asset to borrow
     * @param _amount The amount to be borrowed
     * @param _interestRateMode The interest rate mode at which the user wants to borrow: 1 for Stable, 2 for Variable
     * @param _onBehalfOf Address of the user who will receive the debt. Should be the address of the borrower itself
     * calling the function if s/he wants to borrow against her/his own collateral, or the address of the credit delegator
     * if s/he has been given credit delegation allowance
     * @param _tokenId The Meld Banker NFT tokenId to be used to receive protocol benefits
     * @return The final amount borrowed
     */
    function borrow(
        address _asset,
        uint256 _amount,
        uint256 _interestRateMode,
        address _onBehalfOf,
        uint256 _tokenId
    ) external override whenNotPaused returns (uint256) {
        require(_asset != address(0), Errors.INVALID_ADDRESS);
        require(_onBehalfOf != address(0), Errors.INVALID_ADDRESS);

        // if tokenId > 0, the the borrower is attempting to apply the Meld Banker benefit
        if (_tokenId > 0) {
            _checkYieldBoostAndMeldBankerNFT(_asset);

            // If user is already using the Meld Banker benefit, it cannot be used again, except for more of the same action on the same asset reserve.
            require(
                !isUsingMeldBanker[_onBehalfOf] ||
                    (userMeldBankerData[_onBehalfOf].asset == _asset &&
                        userMeldBankerData[_onBehalfOf].action == DataTypes.Action.BORROW),
                Errors.LP_MELD_BANKER_NFT_LOCKED
            );

            // Check if user owns the tokenId
            require(
                IMeldBankerNFT(meldBankerNFT).ownerOf(_tokenId) == _onBehalfOf,
                Errors.LP_NOT_OWNER_OF_MELD_BANKER_NFT
            );

            DataTypes.MeldBankerType bankerType = IMeldBankerNFT(meldBankerNFT).isGolden(_tokenId)
                ? DataTypes.MeldBankerType.GOLDEN
                : DataTypes.MeldBankerType.BANKER;

            YieldBoostLogic.MeldBankerData memory meldBankerData = YieldBoostLogic.MeldBankerData({
                tokenId: _tokenId,
                asset: _asset,
                meldBankerType: bankerType,
                action: DataTypes.Action.BORROW
            });

            // lock the tokenId if it's not already locked
            if (!isMeldBankerBlocked[_tokenId]) {
                YieldBoostLogic.lockMeldBankerNFT(
                    isMeldBankerBlocked,
                    isUsingMeldBanker,
                    userMeldBankerData,
                    _onBehalfOf,
                    meldBankerData
                );
            }
        }

        DataTypes.ReserveData storage reserve = reserves[_asset];

        uint256 borrowAmount = BorrowLogic.executeBorrow(
            reserves,
            reservesList,
            usersConfig,
            BorrowLogic.ExecuteBorrowParams(
                _asset,
                msg.sender,
                _onBehalfOf,
                reserve.mTokenAddress,
                address(addressesProvider),
                _amount,
                _interestRateMode,
                maxStableRateBorrowSizePercent,
                reservesCount
            )
        );

        return borrowAmount;
    }

    /**
     * @notice Repays a borrowed `amount` on a specific reserve, burning the equivalent debt tokens ownπed
     * - E.g. User repays 100 USDC, burning 100 variable/stable debt tokens of the `onBehalfOf` address
     * @param _asset The address of the borrowed underlying asset previously borrowed
     * @param _amount The amount to repay
     * - Send the value type(uint256).max in order to repay the whole debt for `asset` on the specific `debtMode`
     * @param _rateMode The interest rate mode at of the debt the user wants to repay: 1 for Stable, 2 for Variable
     * @param _onBehalfOf Address of the user who will get her/his debt reduced/removed. Should be the address of the
     * user calling the function if he wants to reduce/remove her/his own debt, or the address of any other
     * other borrower whose debt should be removed
     * @return The final amount repaid
     */
    function repay(
        address _asset,
        uint256 _amount,
        uint256 _rateMode,
        address _onBehalfOf
    ) external override whenNotPaused returns (uint256) {
        (uint256 stableDebt, uint256 variableDebt, uint256 paybackAmount) = RepayLogic.executeRepay(
            reserves,
            usersConfig,
            RepayLogic.ExecuteRepayParams({
                asset: _asset,
                amount: _amount,
                rateMode: _rateMode,
                onBehalfOf: _onBehalfOf
            })
        );

        if (stableDebt + variableDebt - paybackAmount == 0) {
            YieldBoostLogic.MeldBankerData memory meldBankerNFTData = userMeldBankerData[
                _onBehalfOf
            ];

            if (
                meldBankerNFTData.asset == _asset &&
                meldBankerNFTData.action == DataTypes.Action.BORROW
            ) {
                YieldBoostLogic.unlockMeldBankerNFT(
                    isMeldBankerBlocked,
                    isUsingMeldBanker,
                    userMeldBankerData,
                    _onBehalfOf
                );
            }
        }

        return paybackAmount;
    }

    /**
     * @notice Function to liquidate a non-healthy position collateral-wise, with Health Factor below 1
     * - The caller (liquidator) covers `_debtToCover` amount of debt of the user getting liquidated, and receives
     *   a proportional amount of the `_collateralAsset` plus a bonus to cover market risk
     * @param _collateralAsset The address of the underlying asset used as collateral, to receive as result of the liquidation
     * @param _debtAsset The address of the underlying borrowed asset to be repaid with the liquidation
     * @param _user The address of the borrower getting liquidated
     * @param _debtToCover The debt amount of borrowed `asset` the liquidator wants to cover
     * - Send the value type(uint256).max in order to liquidate the whole debt of the user
     * @param _receiveMToken `true` if the liquidator wants to receive the collateral mTokens, `false` if s/he wants
     * to receive the underlying collateral asset directly
     * @return actualDebtToLiquidate The total amount of debt covered by the liquidator
     * @return maxCollateralToLiquidate The total amount of collateral liquidated.  This may not be the amount received by the liquidator if there is a protocol fee.
     */
    function liquidationCall(
        address _collateralAsset,
        address _debtAsset,
        address _user,
        uint256 _debtToCover,
        bool _receiveMToken
    )
        external
        override
        whenNotPaused
        returns (uint256 actualDebtToLiquidate, uint256 maxCollateralToLiquidate)
    {
        uint256 userStableDebt;
        uint256 userVarialedebt;

        (
            userStableDebt,
            userVarialedebt,
            actualDebtToLiquidate,
            maxCollateralToLiquidate
        ) = LiquidationLogic.executeLiquidationCall(
            reserves,
            reservesList,
            usersConfig,
            LiquidationLogic.ExecuteLiquidationCallParams({
                reservesCount: reservesCount,
                debtToCover: _debtToCover,
                liquidationProtocolFeePercentage: liquidationProtocolFeePercentage,
                collateralAsset: _collateralAsset,
                debtAsset: _debtAsset,
                user: _user,
                receiveMToken: _receiveMToken,
                priceOracle: addressesProvider.getPriceOracle()
            })
        );

        // Full debt was liquidated
        if (userStableDebt + userVarialedebt - actualDebtToLiquidate == 0) {
            YieldBoostLogic.MeldBankerData memory meldBankerNFTData = userMeldBankerData[_user];

            if (
                meldBankerNFTData.asset == _debtAsset &&
                meldBankerNFTData.action == DataTypes.Action.BORROW
            ) {
                YieldBoostLogic.unlockMeldBankerNFT(
                    isMeldBankerBlocked,
                    isUsingMeldBanker,
                    userMeldBankerData,
                    _user
                );
            }
        }

        return (actualDebtToLiquidate, maxCollateralToLiquidate);
    }

    /**
     * @notice Allows Smart Contracts to access the liquidity of the pool within one transaction, as long as the amount taken plus a fee is returned
     * @param _assets the addresses of the assets being flash-borrowed
     * @param _amounts the amounts amounts being flash-borrowed
     * @param _params Variadic packed params to pass to the receiver as extra information
     */
    function flashLoan(
        address[] calldata _assets,
        uint256[] calldata _amounts,
        bytes calldata _params
    ) external override whenNotPaused {
        FlashLoanLogic.executeFlashLoan(
            reserves,
            flashLoanPremiumTotal,
            FlashLoanLogic.ExecuteFlashLoanParams({
                dataProviderAddress: addressesProvider.getProtocolDataProvider(),
                assets: _assets,
                amounts: _amounts,
                params: _params
            })
        );
    }

    /**
     * @notice Validates and finalizes an mToken transfer
     * @dev Only callable by the overlying mToken of the `asset`
     * @param _asset The address of the underlying asset of the mToken
     * @param _from The user from which the mTokens are transferred
     * @param _to The user receiving the mTokens
     * @param _amount The amount being transferred/withdrawn
     * @param _balanceFromBefore The mToken balance of the `from` user before the transfer
     * @param _balanceToBefore The mToken balance of the `to` user before the transfer
     */
    function finalizeTransfer(
        address _asset,
        address _from,
        address _to,
        uint256 _amount,
        uint256 _balanceFromBefore,
        uint256 _balanceToBefore
    ) external override {
        require(msg.sender == reserves[_asset].mTokenAddress, Errors.LP_CALLER_MUST_BE_AN_MTOKEN);

        ValidationLogic.validateTransfer(
            _from,
            reserves,
            usersConfig[_from],
            reservesList,
            reservesCount,
            addressesProvider.getPriceOracle()
        );

        uint256 reserveId = reserves[_asset].id;

        if (_from != _to) {
            if (_balanceFromBefore - _amount == 0) {
                DataTypes.UserConfigurationMap storage fromConfig = usersConfig[_from];
                fromConfig.setUsingAsCollateral(reserveId, false);
                emit GenericLogic.ReserveUsedAsCollateralDisabled(_asset, _from);
            }

            if (_balanceToBefore == 0 && _amount != 0) {
                DataTypes.UserConfigurationMap storage toConfig = usersConfig[_to];
                toConfig.setUsingAsCollateral(reserveId, true);
                emit GenericLogic.ReserveUsedAsCollateralEnabled(_asset, _to);
            }
        }
    }

    /**
     * @notice Initializes a reserve
     * @dev Only callable by the LendingPoolConfigurator contract
     * @param _asset The address of the underlying asset of the reserve
     * @param _mTokenAddress The address of the overlying mToken contract
     * @param _stableDebtTokenAddress The address of the contract managing the stable debt of the reserve
     * @param _variableDebtTokenAddress The address of the contract managing the variable debt of the reserve
     * @param _interestRateStrategyAddress The address of the interest rate strategy contract
     */
    function initReserve(
        address _asset,
        address _mTokenAddress,
        address _stableDebtTokenAddress,
        address _variableDebtTokenAddress,
        address _interestRateStrategyAddress
    ) external override onlyRole(addressesProvider.LENDING_POOL_CONFIGURATOR_ROLE()) {
        require(reservesCount < MAX_NUMBER_OF_RESERVES, Errors.LP_NO_MORE_RESERVES_ALLOWED);
        require(!reserveExists(_asset), Errors.RL_RESERVE_ALREADY_INITIALIZED);

        reserves[_asset].init(
            _mTokenAddress,
            _stableDebtTokenAddress,
            _variableDebtTokenAddress,
            _interestRateStrategyAddress
        );

        reserves[_asset].id = uint8(reservesCount);
        reservesList[reservesCount] = _asset;
        reservesCount = reservesCount + 1;
    }

    /**
     * @notice Updates the address of the interest rate strategy contract
     * @dev Only callable by the LendingPoolConfigurator contract
     * @param _asset The address of the underlying asset of the reserve
     * @param _rateStrategyAddress The address of the interest rate strategy contract
     */
    function setReserveInterestRateStrategyAddress(
        address _asset,
        address _rateStrategyAddress
    ) external override onlyRole(addressesProvider.LENDING_POOL_CONFIGURATOR_ROLE()) {
        reserves[_asset].interestRateStrategyAddress = _rateStrategyAddress;
    }

    /**
     * @notice Allows depositors to enable/disable a specific deposited asset as collateral
     * @param _asset The address of the underlying asset deposited
     * @param _useAsCollateral `true` if the user wants to use the deposit as collateral, `false` otherwise
     */
    function setUserUseReserveAsCollateral(
        address _asset,
        bool _useAsCollateral
    ) external override whenNotPaused {
        DataTypes.ReserveData storage reserve = reserves[_asset];

        ValidationLogic.validateSetUseReserveAsCollateral(
            reserve,
            _asset,
            _useAsCollateral,
            reserves,
            usersConfig[msg.sender],
            reservesList,
            reservesCount,
            addressesProvider.getPriceOracle()
        );

        usersConfig[msg.sender].setUsingAsCollateral(reserve.id, _useAsCollateral);

        if (_useAsCollateral) {
            emit GenericLogic.ReserveUsedAsCollateralEnabled(_asset, msg.sender);
        } else {
            emit GenericLogic.ReserveUsedAsCollateralDisabled(_asset, msg.sender);
        }
    }

    /**
     * @notice Allows depositors to enable/disable genius loans
     * @param _acceptGeniusLoan True if the user is accepting the genius loan, false otherwise
     */
    function setUserAcceptGeniusLoan(bool _acceptGeniusLoan) external override whenNotPaused {
        usersConfig[msg.sender].setAcceptGeniusLoan(_acceptGeniusLoan);

        if (_acceptGeniusLoan) {
            emit GenericLogic.GeniusLoanEnabled(msg.sender);
        } else {
            emit GenericLogic.GeniusLoanDisabled(msg.sender);
        }
    }

    /**
     * @notice Sets the configuration bitmap of the reserve as a whole
     * @dev Only callable by the LendingPoolConfigurator contract
     * @param _asset The address of the underlying asset of the reserve
     * @param _configuration The new configuration bitmap
     */
    function setConfiguration(
        address _asset,
        uint256 _configuration
    ) external override onlyRole(addressesProvider.LENDING_POOL_CONFIGURATOR_ROLE()) {
        require(_asset != address(0), Errors.INVALID_ADDRESS);
        reserves[_asset].configuration.data = _configuration;
    }

    /**
     * @notice Sets the percentage of the liquidation reward that will be redirected to the protocol
     * @dev Only callable by the pool admin
     * @param _liquidtionProtocolFeePercentage The new percentage of the liquidation reward that will be redirected to the protocol in basis points (1% = 100)
     */
    function setLiquidationProtocolFeePercentage(
        uint256 _liquidtionProtocolFeePercentage
    ) external override whenNotPaused onlyRole(addressesProvider.POOL_ADMIN_ROLE()) {
        require(
            _liquidtionProtocolFeePercentage <= PercentageMath.PERCENTAGE_FACTOR,
            Errors.VALUE_ABOVE_100_PERCENT
        );
        emit LiquidtionProtocolFeePercentageUpdated(
            msg.sender,
            liquidationProtocolFeePercentage,
            _liquidtionProtocolFeePercentage
        );
        liquidationProtocolFeePercentage = _liquidtionProtocolFeePercentage;
    }

    /**
     * @notice Updates the address of the yield boost staking contract
     * @dev Only callable by the LendingPoolConfigurator contract
     * @param _asset The address of the underlying asset of the reserve
     * @param _yieldBoostStaking The address of the yield boost staking contract
     */
    function setYieldBoostStakingAddress(
        address _asset,
        address _yieldBoostStaking
    ) external override onlyRole(addressesProvider.LENDING_POOL_CONFIGURATOR_ROLE()) {
        reserves[_asset].yieldBoostStaking = _yieldBoostStaking;
    }

    /**
     * @notice Sets the multiplier that a user will receive for yield boost staking for the lending pool action and Meld Banker Type
     * @dev This multiplier is multiplied by the user's MToken balance (deposit multiplier) and/or debt token balance (borrow multiplier) to calculate the
     * yield boost stake amount. Only callable by the pool admin.
     * @param _asset The address of the underlying asset of the reserve
     * @param _meldBankerType The MeldBankerType
     * @param _action The action
     * @param _yieldBoostMultiplier The yield boost multiplier
     */
    function setYieldBoostMultiplier(
        address _asset,
        DataTypes.MeldBankerType _meldBankerType,
        DataTypes.Action _action,
        uint256 _yieldBoostMultiplier
    ) external onlyRole(addressesProvider.POOL_ADMIN_ROLE()) {
        require(_asset != address(0), Errors.INVALID_ADDRESS);
        require(
            reserves[_asset].yieldBoostStaking != address(0),
            Errors.LP_YIELD_BOOST_STAKING_NOT_ENABLED
        );

        uint256 currentYieldBoostMultiplier = yieldBoostMultipliers[_meldBankerType][_action];

        yieldBoostMultipliers[_meldBankerType][_action] = _yieldBoostMultiplier;

        emit SetYieldBoostMultplier(
            _asset,
            _meldBankerType,
            _action,
            currentYieldBoostMultiplier,
            _yieldBoostMultiplier
        );
    }

    /**
     * @notice Refreshes the yield boost amount for the lending pool.
     * @param _user The address of the user
     * @param _asset The address of the underlying asset of the reserve
     * @return newStakeAmount The new stake amount
     */
    function refreshYieldBoostAmount(
        address _user,
        address _asset
    ) external override returns (uint256 newStakeAmount) {
        require(_user != address(0), Errors.INVALID_ADDRESS);
        require(_asset != address(0), Errors.INVALID_ADDRESS);

        DataTypes.ReserveData storage reserve = reserves[_asset];

        // newStakeAmount should be 0 if yield boost is not active on the reserve
        if (reserve.yieldBoostStaking == address(0)) {
            return newStakeAmount;
        }

        newStakeAmount = YieldBoostLogic.refreshYieldBoostAmount(
            reserve,
            userMeldBankerData,
            yieldBoostMultipliers,
            _user,
            _asset
        );

        // Call yield boost staking protocol
        IYieldBoostStaking(reserve.yieldBoostStaking).setStakeAmount(_user, newStakeAmount);

        emit RefreshYieldBoostAmount(_asset, _user, newStakeAmount);
    }

    /**
     * @notice Sets the flash loan premium
     * @dev Only callable by the pool admin
     * @param _flashLoanPremiumTotal The new flash loan premium
     */
    function setFlashLoanPremium(
        uint256 _flashLoanPremiumTotal
    ) external override whenNotPaused onlyRole(addressesProvider.POOL_ADMIN_ROLE()) {
        require(
            _flashLoanPremiumTotal <= PercentageMath.PERCENTAGE_FACTOR,
            Errors.VALUE_ABOVE_100_PERCENT
        );
        emit FlashLoanPremiumUpdated(msg.sender, flashLoanPremiumTotal, _flashLoanPremiumTotal);
        flashLoanPremiumTotal = _flashLoanPremiumTotal;
    }

    /**
     * @notice Sets the address of the MeldBankerNFT, obtaining the address from the AddressesProvider
     */
    function setMeldBankerNFT() public override whenNotPaused {
        require(address(meldBankerNFT) == address(0), Errors.LP_MELD_BANKER_NFT_ALREADY_SET);
        address meldBankerNFTAddress = addressesProvider.getMeldBankerNFT();
        require(meldBankerNFTAddress != address(0), Errors.INVALID_ADDRESS);

        meldBankerNFT = IMeldBankerNFT(meldBankerNFTAddress);
        emit MeldBankerNFTSet(msg.sender, meldBankerNFTAddress);
    }

    /**
     * @notice Returns the user account data across all the reserves
     * @param _user The address of the user
     * @return totalCollateralUSD The total collateral in USD of the user
     * @return totalDebtUSD The total debt in USD of the user
     * @return availableBorrowsUSD The borrowing power left of the user
     * @return currentLiquidationThreshold The liquidation threshold of the user
     * @return ltv The loan to value of the user
     * @return healthFactor The current health factor of the user
     */
    function getUserAccountData(
        address _user
    )
        external
        view
        override
        returns (
            uint256 totalCollateralUSD,
            uint256 totalDebtUSD,
            uint256 availableBorrowsUSD,
            uint256 currentLiquidationThreshold,
            uint256 ltv,
            uint256 healthFactor
        )
    {
        (
            totalCollateralUSD,
            totalDebtUSD,
            ltv,
            currentLiquidationThreshold,
            healthFactor
        ) = GenericLogic.calculateUserAccountData(
            _user,
            reserves,
            usersConfig[_user],
            reservesList,
            reservesCount,
            addressesProvider.getPriceOracle()
        );

        availableBorrowsUSD = GenericLogic.calculateAvailableBorrowsUSD(
            totalCollateralUSD,
            totalDebtUSD,
            ltv
        );
    }

    /**
     * @notice Returns the configuration of the user across all the reserves
     * @param _user The user address
     * @return The configuration of the user
     */
    function getUserConfiguration(
        address _user
    ) external view override returns (DataTypes.UserConfigurationMap memory) {
        return usersConfig[_user];
    }

    /**
     * @notice Returns the ongoing normalized income for the reserve
     * @dev A value of 1e27 means there is no income. As time passes, the income is accrued
     * @dev A value of 2*1e27 means for each unit of asset one unit of income has been accrued
     * @param _asset The address of the underlying asset of the reserve
     * @return The normalized income expressed in ray
     */
    function getReserveNormalizedIncome(
        address _asset
    ) external view virtual override returns (uint256) {
        return reserves[_asset].getNormalizedIncome();
    }

    /**
     * @notice Returns the ongoing normalized variable debt for the reserve
     * @dev A value of 1e27 means there is no debt. As time passes, the income is accrued
     * @dev A value of 2*1e27 means that for each unit of debt, one unit worth of interest has been accumulated
     * @param _asset The address of the underlying asset of the reserve
     * @return The normalized variable debt expressed in ray
     */
    function getReserveNormalizedVariableDebt(
        address _asset
    ) external view override returns (uint256) {
        return reserves[_asset].getNormalizedDebt();
    }

    /**
     * @notice Returns the reserve data of the specific `_asset`
     * @param _asset The address of the underlying asset of the reserve
     * @return The data object of the reserve
     */
    function getReserveData(
        address _asset
    ) external view override returns (DataTypes.ReserveData memory) {
        return reserves[_asset];
    }

    /**
     * @notice Returns the list of the initialized reserves
     * @return The list of the initialized reserves
     */
    function getReservesList() external view override returns (address[] memory) {
        address[] memory _activeReserves = new address[](reservesCount);

        for (uint256 i = 0; i < reservesCount; i++) {
            _activeReserves[i] = reservesList[i];
        }
        return _activeReserves;
    }

    /**
     * @notice Returns the configuration of the reserve
     * @param _asset The address of the underlying asset of the reserve
     * @return The configuration of the reserve as a ReserveConfigurationMap
     */
    function getConfiguration(
        address _asset
    ) external view override returns (DataTypes.ReserveConfigurationMap memory) {
        return reserves[_asset].configuration;
    }

    /**
     * @notice Checks if the reserve already exists
     * @param _asset The address of the underlying asset of the reserve
     * @return bool true if the reserve already exists, false otherwise
     */
    function reserveExists(address _asset) public view override returns (bool) {
        // Need to check id != 0 and reserveList[0] != asset because _reservCount starts from 0.
        // The first reserve added will have id = 0, so check for id != 0 is not sufficient
        return reserves[_asset].id != 0 || reservesList[0] == _asset;
    }

    /**
     * @notice Checks if the Yield Boost is enabled for the asset and if the Meld Banker NFT is set
     * @dev If the Meld Banker NFT is not set, it will be set
     * @param _asset The address of the underlying asset of the reserve
     */
    function _checkYieldBoostAndMeldBankerNFT(address _asset) private {
        // NFT should only be applied if yieldBoostStaking is enabled
        require(
            reserves[_asset].yieldBoostStaking != address(0),
            Errors.LP_YIELD_BOOST_STAKING_NOT_ENABLED
        );

        if (address(meldBankerNFT) == address(0)) {
            setMeldBankerNFT();
        }
    }

    /**
     * @notice Checks if the contract can be upgraded
     * @dev Only the primary admin role can call this function
     * @dev Only can be upgraded if the addresses provider allows it
     */
    function _authorizeUpgrade(
        address
    ) internal virtual override onlyRole(addressesProvider.PRIMARY_ADMIN_ROLE()) {
        require(addressesProvider.isUpgradeable(), Errors.UPGRADEABILITY_NOT_ALLOWED);
    }

    ////////////////////// MOCK EXTRA FUNCTIONS //////////////////////

    function setMockMappingData(address _asset, address _user, uint256 _num) public {
        MockLibrary.executeMockFunction(mockMapping, _asset, _user, _num);
    }
}
