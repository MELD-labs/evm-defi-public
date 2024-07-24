// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title ILendingPoolConfigurator interface
 * @notice Provides the interface to configure the LendingPool and initialize the reserves
 * @author MELD team
 */
interface ILendingPoolConfigurator {
    struct InitReserveInput {
        bool yieldBoostEnabled;
        uint8 underlyingAssetDecimals;
        address interestRateStrategyAddress;
        address underlyingAsset;
        address treasury;
        string underlyingAssetName;
        string mTokenName;
        string mTokenSymbol;
        string variableDebtTokenName;
        string variableDebtTokenSymbol;
        string stableDebtTokenName;
        string stableDebtTokenSymbol;
    }

    /**
     * @notice Emitted when the LendingPool configurator is initialized
     * @param executedBy The address of the account that executed the initialization
     * @param addressesProvider The address of the LendingPoolAddressesProvider
     * @param lendingPool The address of the LendingPool
     * @param mTokenImpl The address of the mToken implementation contract
     * @param stableDebtTokenImpl The address of the stable debt token implementation contract
     * @param variableDebtTokenImpl The address of the variable debt token implementation contract
     */
    event LendingPoolConfiguratorInitialized(
        address indexed executedBy,
        address indexed addressesProvider,
        address indexed lendingPool,
        address mTokenImpl,
        address stableDebtTokenImpl,
        address variableDebtTokenImpl
    );

    /**
     * @notice Emitted when a reserve is initialized.
     * @param asset The address of the underlying asset of the reserve
     * @param mToken The address of the associated mToken contract
     * @param stableDebtToken The address of the associated stable rate debt token
     * @param variableDebtToken The address of the associated variable rate debt token
     * @param interestRateStrategyAddress The address of the interest rate strategy for the reserve
     * @param yieldBoostEnabled True if yield boost is enabled, false otherwise
     */
    event ReserveInitialized(
        address indexed asset,
        address indexed mToken,
        address stableDebtToken,
        address variableDebtToken,
        address interestRateStrategyAddress,
        bool yieldBoostEnabled
    );

    /**
     * @notice Emitted when borrowing is enabled on a reserve
     * @param asset The address of the underlying asset of the reserve
     * @param stableRateEnabled True if stable rate borrowing is enabled, false otherwise
     */
    event BorrowingEnabledOnReserve(address indexed asset, bool stableRateEnabled);

    /**
     * @notice Emitted when borrowing is disabled on a reserve
     * @param asset The address of the underlying asset of the reserve
     */
    event BorrowingDisabledOnReserve(address indexed asset);

    /**
     * @notice Emitted when the collateralization risk parameters for the specified asset are updated.
     * @param asset The address of the underlying asset of the reserve
     * @param ltv The loan to value of the asset when used as collateral
     * @param liquidationThreshold The threshold at which loans using this asset as collateral will be considered undercollateralized
     * @param liquidationBonus The bonus liquidators receive to liquidate this asset
     */
    event CollateralConfigurationChanged(
        address indexed asset,
        uint256 ltv,
        uint256 liquidationThreshold,
        uint256 liquidationBonus
    );

    /**
     * @notice Emitted when stable rate borrowing is enabled on a reserve
     * @param asset The address of the underlying asset of the reserve
     */
    event StableRateEnabledOnReserve(address indexed asset);

    /**
     * @notice Emitted when stable rate borrowing is disabled on a reserve
     * @param asset The address of the underlying asset of the reserve
     */
    event StableRateDisabledOnReserve(address indexed asset);

    /**
     * @notice Emitted when a reserve is activated
     * @param asset The address of the underlying asset of the reserve
     */
    event ReserveActivated(address indexed asset);

    /**
     * @notice Emitted when a reserve is deactivated
     * @param asset The address of the underlying asset of the reserve
     */
    event ReserveDeactivated(address indexed asset);

    /**
     * @notice Emitted when a reserve is frozen
     * @param asset The address of the underlying asset of the reserve
     */
    event ReserveFrozen(address indexed asset);

    /**
     * @notice Emitted when a reserve is unfrozen
     * @param asset The address of the underlying asset of the reserve
     */
    event ReserveUnfrozen(address indexed asset);

    /**
     * @notice Emitted when a reserve factor is updated
     * @param asset The address of the underlying asset of the reserve
     * @param factor The new reserve factor
     */
    event ReserveFactorChanged(address indexed asset, uint256 factor);

    /**
     * @notice Emitted when a reserve supply cap is updated
     * @param asset The address of the underlying asset of the reserve
     * @param supplyCapUSD The new supply cap in USD
     */
    event ReserveSupplyCapUSDChanged(address indexed asset, uint256 supplyCapUSD);

    /**
     * @notice Emitted when a reserve borrow cap is updated
     * @param asset The address of the underlying asset of the reserve
     * @param borrowCapUSD The new borrow cap in USD
     */
    event ReserveBorrowCapUSDChanged(address indexed asset, uint256 borrowCapUSD);

    /**
     * @notice Emitted when a reserve flash loan limit is updated
     * @param asset The address of the underlying asset of the reserve
     * @param flashLoanLimitUSD The new flash loan limit in USD
     */
    event ReserveFlashLoanLimitUSDChanged(address indexed asset, uint256 flashLoanLimitUSD);

    /**
     * @notice Emitted when the address of the yield boost staking contract is updated
     * @param asset The address of the underlying asset of the reserve
     * @param yieldBoostStaking The address of the yield boost staking contract
     */
    event YieldBoostStakingAddressChanged(address indexed asset, address yieldBoostStaking);

    /**
     * @dev Emitted when a reserve interest strategy contract is updated
     * @param asset The address of the underlying asset of the reserve
     * @param strategy The new address of the interest strategy contract
     */
    event ReserveInterestRateStrategyChanged(address indexed asset, address strategy);

    /**
     * @notice Initializes multiple reserves in a single transaction
     * @param _input List of InitReserveInput objects containing the data for each reserve
     */
    function batchInitReserve(InitReserveInput[] calldata _input) external;

    /**
     * @notice Enables borrowing on a reserve
     * @param _asset The address of the underlying asset of the reserve
     * @param _stableBorrowRateEnabled True if stable borrow rate needs to be enabled by default on this reserve
     */
    function enableBorrowingOnReserve(address _asset, bool _stableBorrowRateEnabled) external;

    /**
     * @notice Disables borrowing on a reserve
     * @param _asset The address of the underlying asset of the reserve
     */
    function disableBorrowingOnReserve(address _asset) external;

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
    ) external;

    /**
     * @notice Enable stable rate borrowing on a reserve
     * @param _asset The address of the underlying asset of the reserve
     */
    function enableReserveStableRate(address _asset) external;

    /**
     * @notice Disable stable rate borrowing on a reserve
     * @param _asset The address of the underlying asset of the reserve
     */
    function disableReserveStableRate(address _asset) external;

    /**
     * @notice Activates a reserve
     * @param _asset The address of the underlying asset of the reserve
     */
    function activateReserve(address _asset) external;

    /**
     * @notice Deactivates a reserve
     * @param _asset The address of the underlying asset of the reserve
     */
    function deactivateReserve(address _asset) external;

    /**
     * @notice Freezes a reserve. A frozen reserve doesn't allow any new deposit, borrow or rate swap
     *  but allows repayments, liquidations, rate rebalances and withdrawals
     * @param _asset The address of the underlying asset of the reserve
     */
    function freezeReserve(address _asset) external;

    /**
     * @notice Unfreezes a reserve
     * @param _asset The address of the underlying asset of the reserve
     */
    function unfreezeReserve(address _asset) external;

    /**
     * @notice Updates the reserve factor of a reserve
     * @param _asset The address of the underlying asset of the reserve
     * @param _reserveFactor The new reserve factor of the reserve
     */
    function setReserveFactor(address _asset, uint256 _reserveFactor) external;

    /**
     * @notice Sets the supply cap of the reserve in USD
     * @param _asset The address of the underlying asset of the reserve
     * @param _supplyCapUSD The new supply cap of the reserve, in USD
     */
    function setSupplyCapUSD(address _asset, uint256 _supplyCapUSD) external;

    /**
     * @notice Sets the borrow cap of the reserve in USD
     * @param _asset The address of the underlying asset of the reserve
     * @param _borrowCapUSD The new borrow cap of the reserve, in USD
     */
    function setBorrowCapUSD(address _asset, uint256 _borrowCapUSD) external;

    /**
     * @notice Sets the flash loan limit of the reserve in USD
     * @param _asset The address of the underlying asset of the reserve
     * @param _flashLoanLimitUSD The new flash loan limit of the reserve, in USD
     */
    function setFlashLoanLimitUSD(address _asset, uint256 _flashLoanLimitUSD) external;

    /**
     * @notice Updates the address of the yield boost staking contract
     * @dev Only callable by the pool admin
     * @param _asset The address of the underlying asset of the reserve
     * @param _yieldBoostStaking The address of the yield boost staking contract
     */
    function setYieldBoostStakingAddress(address _asset, address _yieldBoostStaking) external;

    /**
     * @notice Sets the interest rate strategy of a reserve
     * @param _asset The address of the underlying asset of the reserve
     * @param _rateStrategyAddress The new address of the interest strategy contract
     */
    function setReserveInterestRateStrategyAddress(
        address _asset,
        address _rateStrategyAddress
    ) external;

    /**
     * @notice Checks if a reserve is already initialized by checking the mToken address.
     * if the mToken address is not set, the reserve has not been initialized
     * @param _asset The address of the underlying asset to check
     */
    function checkReserveExists(address _asset) external view;
}
