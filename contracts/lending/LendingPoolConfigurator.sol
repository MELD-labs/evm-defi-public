// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {LendingBase, IAddressesProvider} from "../base/LendingBase.sol";
import {PercentageMath} from "../libraries/math/PercentageMath.sol";
import {ReserveConfiguration, Errors} from "../libraries/configuration/ReserveConfiguration.sol";
import {ILendingPoolConfigurator} from "../interfaces/ILendingPoolConfigurator.sol";
import {ILendingPool, DataTypes} from "../interfaces/ILendingPool.sol";
import {IYieldBoostFactory} from "../interfaces/yield-boost/IYieldBoostFactory.sol";
import {MToken} from "../tokenization/MToken.sol";
import {StableDebtToken} from "../tokenization/StableDebtToken.sol";
import {VariableDebtToken} from "../tokenization/VariableDebtToken.sol";

/**
 * @title LendingPoolConfigurator contract
 * @notice Implements the functions to create and configure LendingPool reserves
 * @author MELD team
 */
contract LendingPoolConfigurator is
    LendingBase,
    ILendingPoolConfigurator,
    UUPSUpgradeable,
    Initializable
{
    using PercentageMath for uint256;
    using ReserveConfiguration for DataTypes.ReserveConfigurationMap;

    ILendingPool public lendingPool;
    address public mTokenImpl;
    address public stableDebtTokenImpl;
    address public variableDebtTokenImpl;

    modifier onlyExistingReserve(address asset) {
        checkReserveExists(asset);
        _;
    }

    /**
     * @notice Initializes the LendingPoolConfigurator
     * @param _addressesProvider The address of the AddressesProvider
     * @param _lendingPool The address of the LendingPool
     * @param _mTokenImpl The address of the MToken implementation
     * @param _stableDebtTokenImpl The address of the StableDebtToken implementation
     * @param _variableDebtTokenImpl The address of the VariableDebtToken implementation
     */
    function initialize(
        address _addressesProvider,
        address _lendingPool,
        address _mTokenImpl,
        address _stableDebtTokenImpl,
        address _variableDebtTokenImpl
    ) public initializer {
        require(_addressesProvider != address(0), Errors.INVALID_ADDRESS);
        require(_lendingPool != address(0), Errors.INVALID_ADDRESS);
        require(_mTokenImpl != address(0), Errors.INVALID_ADDRESS);
        require(_stableDebtTokenImpl != address(0), Errors.INVALID_ADDRESS);
        require(_variableDebtTokenImpl != address(0), Errors.INVALID_ADDRESS);
        addressesProvider = IAddressesProvider(_addressesProvider);
        lendingPool = ILendingPool(_lendingPool);
        mTokenImpl = _mTokenImpl;
        stableDebtTokenImpl = _stableDebtTokenImpl;
        variableDebtTokenImpl = _variableDebtTokenImpl;

        emit LendingPoolConfiguratorInitialized(
            msg.sender,
            _addressesProvider,
            _lendingPool,
            _mTokenImpl,
            _stableDebtTokenImpl,
            _variableDebtTokenImpl
        );
    }

    /**
     * @notice Initializes multiple reserves in a single transaction
     * @param _input List of InitReserveInput objects containing the data for each reserve
     */
    function batchInitReserve(
        InitReserveInput[] calldata _input
    ) external override whenNotPaused onlyRole(addressesProvider.POOL_ADMIN_ROLE()) {
        for (uint256 i = 0; i < _input.length; i++) {
            _initReserve(_input[i]);
        }
    }

    /**
     * @notice Enables borrowing on a reserve
     * @param _asset The address of the underlying asset of the reserve
     * @param _stableBorrowRateEnabled True if stable borrow rate needs to be enabled by default on this reserve
     */
    function enableBorrowingOnReserve(
        address _asset,
        bool _stableBorrowRateEnabled
    )
        external
        override
        whenNotPaused
        onlyExistingReserve(_asset)
        onlyRole(addressesProvider.POOL_ADMIN_ROLE())
    {
        DataTypes.ReserveConfigurationMap memory currentConfig = lendingPool.getConfiguration(
            _asset
        );

        currentConfig.setBorrowingEnabled(true);
        currentConfig.setStableRateBorrowingEnabled(_stableBorrowRateEnabled);

        lendingPool.setConfiguration(_asset, currentConfig.data);

        emit BorrowingEnabledOnReserve(_asset, _stableBorrowRateEnabled);
    }

    /**
     * @notice Disables borrowing on a reserve
     * @param _asset The address of the underlying asset of the reserve
     */
    function disableBorrowingOnReserve(
        address _asset
    )
        external
        override
        whenNotPaused
        onlyExistingReserve(_asset)
        onlyRole(addressesProvider.POOL_ADMIN_ROLE())
    {
        DataTypes.ReserveConfigurationMap memory currentConfig = lendingPool.getConfiguration(
            _asset
        );

        currentConfig.setBorrowingEnabled(false);

        lendingPool.setConfiguration(_asset, currentConfig.data);
        emit BorrowingDisabledOnReserve(_asset);
    }

    /**
     * @notice Configures the reserve collateralization parameters
     * all the values are expressed in percentages with two decimals of precision. A valid value is 10000, which means 100.00%
     * @param _asset The address of the underlying asset of the reserve
     * @param _ltv The loan to value of the asset when used as collateral
     * @param _liquidationThreshold The threshold at which loans using this asset as collateral will be considered undercollateralized
     * @param _liquidationBonus The bonus liquidators receive to liquidate this asset. The values is always above 100%. A value of 105%
     * means the liquidator will receive a 5% bonus
     */
    function configureReserveAsCollateral(
        address _asset,
        uint256 _ltv,
        uint256 _liquidationThreshold,
        uint256 _liquidationBonus
    )
        external
        override
        whenNotPaused
        onlyExistingReserve(_asset)
        onlyRole(addressesProvider.POOL_ADMIN_ROLE())
    {
        DataTypes.ReserveConfigurationMap memory currentConfig = lendingPool.getConfiguration(
            _asset
        );

        //validation of the parameters: the LTV can
        //only be lower or equal to the liquidation threshold
        //(otherwise a loan against the asset would cause instantaneous liquidation)
        require(_ltv <= _liquidationThreshold, Errors.LPC_INVALID_CONFIGURATION);

        if (_liquidationThreshold != 0) {
            //liquidation bonus must be bigger than 100.00%, otherwise the liquidator would receive less
            //collateral than needed to cover the debt
            require(
                _liquidationBonus > PercentageMath.PERCENTAGE_FACTOR,
                Errors.LPC_INVALID_CONFIGURATION
            );

            //if threshold * bonus is less than PERCENTAGE_FACTOR, it's guaranteed that at the moment
            //a loan is taken there is enough collateral available to cover the liquidation bonus
            require(
                _liquidationThreshold.percentMul(_liquidationBonus) <=
                    PercentageMath.PERCENTAGE_FACTOR,
                Errors.LPC_INVALID_CONFIGURATION
            );
        } else {
            require(_liquidationBonus == 0, Errors.LPC_INVALID_CONFIGURATION);
            //if the liquidation threshold is being set to 0,
            // the reserve is being disabled as collateral. To do so,
            //we need to ensure no liquidity is deposited
            _checkNoLiquidity(_asset);
        }

        currentConfig.setLtv(_ltv);
        currentConfig.setLiquidationThreshold(_liquidationThreshold);
        currentConfig.setLiquidationBonus(_liquidationBonus);

        lendingPool.setConfiguration(_asset, currentConfig.data);

        emit CollateralConfigurationChanged(_asset, _ltv, _liquidationThreshold, _liquidationBonus);
    }

    /**
     * @notice Enable stable rate borrowing on a reserve
     * @param _asset The address of the underlying asset of the reserve
     */
    function enableReserveStableRate(
        address _asset
    )
        external
        override
        whenNotPaused
        onlyExistingReserve(_asset)
        onlyRole(addressesProvider.POOL_ADMIN_ROLE())
    {
        DataTypes.ReserveConfigurationMap memory currentConfig = lendingPool.getConfiguration(
            _asset
        );

        currentConfig.setStableRateBorrowingEnabled(true);

        lendingPool.setConfiguration(_asset, currentConfig.data);

        emit StableRateEnabledOnReserve(_asset);
    }

    /**
     * @notice Disable stable rate borrowing on a reserve
     * @param _asset The address of the underlying asset of the reserve
     */
    function disableReserveStableRate(
        address _asset
    )
        external
        override
        whenNotPaused
        onlyExistingReserve(_asset)
        onlyRole(addressesProvider.POOL_ADMIN_ROLE())
    {
        DataTypes.ReserveConfigurationMap memory currentConfig = lendingPool.getConfiguration(
            _asset
        );

        currentConfig.setStableRateBorrowingEnabled(false);

        lendingPool.setConfiguration(_asset, currentConfig.data);

        emit StableRateDisabledOnReserve(_asset);
    }

    /**
     * @notice Activates a reserve
     * @param _asset The address of the underlying asset of the reserve
     */
    function activateReserve(
        address _asset
    )
        external
        override
        whenNotPaused
        onlyExistingReserve(_asset)
        onlyRole(addressesProvider.POOL_ADMIN_ROLE())
    {
        DataTypes.ReserveConfigurationMap memory currentConfig = lendingPool.getConfiguration(
            _asset
        );

        currentConfig.setActive(true);

        lendingPool.setConfiguration(_asset, currentConfig.data);

        emit ReserveActivated(_asset);
    }

    /**
     * @notice Deactivates a reserve
     * @param _asset The address of the underlying asset of the reserve
     */
    function deactivateReserve(
        address _asset
    )
        external
        override
        whenNotPaused
        onlyExistingReserve(_asset)
        onlyRole(addressesProvider.POOL_ADMIN_ROLE())
    {
        _checkNoLiquidity(_asset);

        DataTypes.ReserveConfigurationMap memory currentConfig = lendingPool.getConfiguration(
            _asset
        );

        currentConfig.setActive(false);

        lendingPool.setConfiguration(_asset, currentConfig.data);

        emit ReserveDeactivated(_asset);
    }

    /**
     * @notice Freezes a reserve. A frozen reserve doesn't allow any new deposit, borrow or rate swap
     *  but allows repayments, liquidations, rate rebalances and withdrawals
     * @param _asset The address of the underlying asset of the reserve
     */
    function freezeReserve(
        address _asset
    )
        external
        override
        whenNotPaused
        onlyExistingReserve(_asset)
        onlyRole(addressesProvider.POOL_ADMIN_ROLE())
    {
        DataTypes.ReserveConfigurationMap memory currentConfig = lendingPool.getConfiguration(
            _asset
        );

        currentConfig.setFrozen(true);

        lendingPool.setConfiguration(_asset, currentConfig.data);

        emit ReserveFrozen(_asset);
    }

    /**
     * @notice Unfreezes a reserve
     * @param _asset The address of the underlying asset of the reserve
     */
    function unfreezeReserve(
        address _asset
    )
        external
        override
        whenNotPaused
        onlyExistingReserve(_asset)
        onlyRole(addressesProvider.POOL_ADMIN_ROLE())
    {
        DataTypes.ReserveConfigurationMap memory currentConfig = lendingPool.getConfiguration(
            _asset
        );

        currentConfig.setFrozen(false);

        lendingPool.setConfiguration(_asset, currentConfig.data);

        emit ReserveUnfrozen(_asset);
    }

    /**
     * @notice Updates the reserve factor of a reserve
     * @param _asset The address of the underlying asset of the reserve
     * @param _reserveFactor The new reserve factor of the reserve
     */
    function setReserveFactor(
        address _asset,
        uint256 _reserveFactor
    )
        external
        override
        whenNotPaused
        onlyExistingReserve(_asset)
        onlyRole(addressesProvider.POOL_ADMIN_ROLE())
    {
        DataTypes.ReserveConfigurationMap memory currentConfig = lendingPool.getConfiguration(
            _asset
        );

        currentConfig.setReserveFactor(_reserveFactor);

        lendingPool.setConfiguration(_asset, currentConfig.data);

        emit ReserveFactorChanged(_asset, _reserveFactor);
    }

    /**
     * @notice Sets the supply cap of the reserve in USD
     * @param _asset The address of the underlying asset of the reserve
     * @param _supplyCapUSD The new supply cap of the reserve, in USD
     */
    function setSupplyCapUSD(
        address _asset,
        uint256 _supplyCapUSD
    )
        external
        override
        whenNotPaused
        onlyExistingReserve(_asset)
        onlyRole(addressesProvider.POOL_ADMIN_ROLE())
    {
        DataTypes.ReserveConfigurationMap memory currentConfig = lendingPool.getConfiguration(
            _asset
        );

        currentConfig.setSupplyCapUSD(_supplyCapUSD);

        lendingPool.setConfiguration(_asset, currentConfig.data);

        emit ReserveSupplyCapUSDChanged(_asset, _supplyCapUSD);
    }

    /**
     * @notice Sets the borrow cap of the reserve in USD
     * @param _asset The address of the underlying asset of the reserve
     * @param _borrowCapUSD The new borrow cap of the reserve, in USD
     */
    function setBorrowCapUSD(
        address _asset,
        uint256 _borrowCapUSD
    )
        external
        override
        whenNotPaused
        onlyExistingReserve(_asset)
        onlyRole(addressesProvider.POOL_ADMIN_ROLE())
    {
        DataTypes.ReserveConfigurationMap memory currentConfig = lendingPool.getConfiguration(
            _asset
        );

        currentConfig.setBorrowCapUSD(_borrowCapUSD);

        lendingPool.setConfiguration(_asset, currentConfig.data);

        emit ReserveBorrowCapUSDChanged(_asset, _borrowCapUSD);
    }

    /**
     * @notice Sets the flash loan limit of the reserve in USD
     * @param _asset The address of the underlying asset of the reserve
     * @param _flashLoanLimitUSD The new flash loan limit of the reserve, in USD
     */
    function setFlashLoanLimitUSD(
        address _asset,
        uint256 _flashLoanLimitUSD
    )
        external
        override
        whenNotPaused
        onlyExistingReserve(_asset)
        onlyRole(addressesProvider.POOL_ADMIN_ROLE())
    {
        DataTypes.ReserveConfigurationMap memory currentConfig = lendingPool.getConfiguration(
            _asset
        );

        currentConfig.setFlashLoanLimitUSD(_flashLoanLimitUSD);

        lendingPool.setConfiguration(_asset, currentConfig.data);

        emit ReserveFlashLoanLimitUSDChanged(_asset, _flashLoanLimitUSD);
    }

    /**
     * @notice Updates the address of the yield boost staking contract
     * @dev Only callable by the pool admin
     * @param _asset The address of the underlying asset of the reserve
     * @param _yieldBoostStaking The address of the yield boost staking contract
     */
    function setYieldBoostStakingAddress(
        address _asset,
        address _yieldBoostStaking
    )
        external
        override
        whenNotPaused
        onlyExistingReserve(_asset)
        onlyRole(addressesProvider.POOL_ADMIN_ROLE())
    {
        _setYieldBoostStakingAddress(_asset, _yieldBoostStaking);
    }

    /**
     * @notice Sets the interest rate strategy of a reserve
     * @param _asset The address of the underlying asset of the reserve
     * @param _rateStrategyAddress The new address of the interest strategy contract
     */
    function setReserveInterestRateStrategyAddress(
        address _asset,
        address _rateStrategyAddress
    )
        external
        override
        whenNotPaused
        onlyExistingReserve(_asset)
        onlyRole(addressesProvider.POOL_ADMIN_ROLE())
    {
        require(_rateStrategyAddress != address(0), Errors.INVALID_ADDRESS);
        lendingPool.setReserveInterestRateStrategyAddress(_asset, _rateStrategyAddress);
        emit ReserveInterestRateStrategyChanged(_asset, _rateStrategyAddress);
    }

    /**
     * @notice Checks if a reserve is already initialized by checking the mToken address.
     * if the mToken address is not set, the reserve has not been initialized
     * @param _asset The address of the underlying asset to check
     */
    function checkReserveExists(address _asset) public view {
        DataTypes.ReserveData memory reserveData = lendingPool.getReserveData(_asset);

        require(reserveData.mTokenAddress != address(0), Errors.LPC_RESERVE_DOES_NOT_EXIST);
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

    /**
     * @notice Initializes a reserve
     * @param _input The input parameters to initialize a reserve
     */
    function _initReserve(InitReserveInput calldata _input) private {
        require(Address.isContract(_input.underlyingAsset), Errors.LPC_NOT_CONTRACT);
        require(_input.interestRateStrategyAddress != address(0), Errors.INVALID_ADDRESS);
        require(_input.treasury != address(0), Errors.INVALID_ADDRESS);

        address mTokenAddress = _createMToken(_input);
        address stableDebtTokenAddress = _createStableDebtToken(_input);
        address variableDebtTokenAddress = _createVariableDebtToken(_input);

        lendingPool.initReserve(
            _input.underlyingAsset,
            mTokenAddress,
            stableDebtTokenAddress,
            variableDebtTokenAddress,
            _input.interestRateStrategyAddress
        );

        DataTypes.ReserveConfigurationMap memory currentConfig = lendingPool.getConfiguration(
            _input.underlyingAsset
        );

        currentConfig.setDecimals(_input.underlyingAssetDecimals);
        currentConfig.setActive(true);
        currentConfig.setFrozen(false);

        lendingPool.setConfiguration(_input.underlyingAsset, currentConfig.data);

        if (_input.yieldBoostEnabled) {
            address yieldBoostStakingAddress = IYieldBoostFactory(
                addressesProvider.getYieldBoostFactory()
            ).createYieldBoostInstance(_input.underlyingAsset);
            _setYieldBoostStakingAddress(_input.underlyingAsset, yieldBoostStakingAddress);
        }

        emit ReserveInitialized(
            _input.underlyingAsset,
            mTokenAddress,
            stableDebtTokenAddress,
            variableDebtTokenAddress,
            _input.interestRateStrategyAddress,
            _input.yieldBoostEnabled
        );
    }

    /**
     * @notice Creates a new MToken instance
     * @param _input The input parameters of a reserve
     * @return The new MToken instance
     */
    function _createMToken(InitReserveInput calldata _input) private returns (address) {
        address mTokenAddress = Clones.clone(mTokenImpl);
        MToken(mTokenAddress).initialize(
            addressesProvider,
            lendingPool,
            _input.treasury,
            _input.underlyingAsset,
            _input.underlyingAssetDecimals,
            _input.mTokenName,
            _input.mTokenSymbol
        );
        return mTokenAddress;
    }

    /**
     * @notice Creates a new StableDebtToken instance
     * @param _input The input parameters of a reserve
     * @return The new StableDebtToken instance
     */
    function _createStableDebtToken(InitReserveInput calldata _input) private returns (address) {
        address stableDebtTokenAddress = Clones.clone(stableDebtTokenImpl);
        StableDebtToken(stableDebtTokenAddress).initialize(
            addressesProvider,
            lendingPool,
            _input.underlyingAsset,
            _input.underlyingAssetDecimals,
            _input.stableDebtTokenName,
            _input.stableDebtTokenSymbol
        );
        return stableDebtTokenAddress;
    }

    /**
     * @notice Creates a new VariableDebtToken instance
     * @param _input The input parameters of a reserve
     * @return The new VariableDebtToken instance
     */
    function _createVariableDebtToken(InitReserveInput calldata _input) private returns (address) {
        address variableDebtTokenAddress = Clones.clone(variableDebtTokenImpl);
        VariableDebtToken(variableDebtTokenAddress).initialize(
            addressesProvider,
            lendingPool,
            _input.underlyingAsset,
            _input.underlyingAssetDecimals,
            _input.variableDebtTokenName,
            _input.variableDebtTokenSymbol
        );
        return variableDebtTokenAddress;
    }

    /**
     * @notice Updates the address of the yield boost staking contract
     * @param _asset The address of the underlying asset of the reserve
     * @param _yieldBoostStaking The address of the yield boost staking contract
     */
    function _setYieldBoostStakingAddress(address _asset, address _yieldBoostStaking) private {
        lendingPool.setYieldBoostStakingAddress(_asset, _yieldBoostStaking);

        emit YieldBoostStakingAddressChanged(_asset, _yieldBoostStaking);
    }

    /**
     * @notice Checks if a reserve has no liquidity deposited
     * @param _asset The address of the underlying asset of the reserve
     */
    function _checkNoLiquidity(address _asset) private view {
        require(_asset != address(0), Errors.INVALID_ADDRESS);
        DataTypes.ReserveData memory reserveData = lendingPool.getReserveData(_asset);

        uint256 availableLiquidity = IERC20(_asset).balanceOf(reserveData.mTokenAddress);

        require(
            availableLiquidity == 0 && reserveData.currentLiquidityRate == 0,
            Errors.LPC_RESERVE_LIQUIDITY_NOT_0
        );
    }
}
