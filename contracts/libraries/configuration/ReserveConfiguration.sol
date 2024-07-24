// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Errors} from "../helpers/Errors.sol";
import {DataTypes} from "../types/DataTypes.sol";

struct ConfigFlags {
    bool isActive;
    bool isFrozen;
    bool borrowingEnabled;
    bool stableBorrowRateEnabled;
}

/**
 * @title ReserveConfiguration library
 * @notice Provides the logic to read and write the configuration parameters of the reserves
 * @author MELD team
 */
library ReserveConfiguration {
    uint256 internal constant LTV_MASK =                   0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF0000; // prettier-ignore
    uint256 internal constant LIQUIDATION_THRESHOLD_MASK = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF0000FFFF; // prettier-ignore
    uint256 internal constant LIQUIDATION_BONUS_MASK =     0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF0000FFFFFFFF; // prettier-ignore
    uint256 internal constant DECIMALS_MASK =              0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF00FFFFFFFFFFFF; // prettier-ignore
    uint256 internal constant ACTIVE_MASK =                0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFFFFFFFFFF; // prettier-ignore
    uint256 internal constant FROZEN_MASK =                0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFDFFFFFFFFFFFFFF; // prettier-ignore
    uint256 internal constant BORROWING_MASK =             0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFBFFFFFFFFFFFFFF; // prettier-ignore
    uint256 internal constant STABLE_BORROWING_MASK =      0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF7FFFFFFFFFFFFFF; // prettier-ignore
    uint256 internal constant RESERVE_FACTOR_MASK =        0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF0000FFFFFFFFFFFFFFFF; // prettier-ignore
    uint256 internal constant SUPPLY_CAP_USD_MASK =        0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFC00000000FFFFFFFFFFFFFFFFFFFF; // prettier-ignore
    uint256 internal constant BORROW_CAP_USD_MASK =        0xFFFFFFFFFFFFFFFFFFFFFFFFFFF000000003FFFFFFFFFFFFFFFFFFFFFFFFFFFF; // prettier-ignore
    uint256 internal constant FLASHLOAN_LIMIT_USD_MASK =   0xFFFFFFFFFFFFFFFFFFC00000000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF; // prettier-ignore

    /// @dev For the LTV, the start bit is 0 (up to 15), hence no bitshifting is needed
    uint256 internal constant LIQUIDATION_THRESHOLD_START_BIT_POSITION = 16;
    uint256 internal constant LIQUIDATION_BONUS_START_BIT_POSITION = 32;
    uint256 internal constant RESERVE_DECIMALS_START_BIT_POSITION = 48;
    uint256 internal constant IS_ACTIVE_START_BIT_POSITION = 56;
    uint256 internal constant IS_FROZEN_START_BIT_POSITION = 57;
    uint256 internal constant BORROWING_ENABLED_START_BIT_POSITION = 58;
    uint256 internal constant STABLE_BORROWING_ENABLED_START_BIT_POSITION = 59;
    uint256 internal constant RESERVE_FACTOR_START_BIT_POSITION = 64;
    uint256 internal constant SUPPLY_CAP_USD_START_BIT_POSITION = 80;
    uint256 internal constant BORROW_CAP_USD_START_BIT_POSITION = 114;
    uint256 internal constant FLASHLOAN_LIMIT_USD_START_BIT_POSITION = 148;

    uint256 internal constant MAX_VALID_LTV = type(uint16).max; // 65535
    uint256 internal constant MAX_VALID_LIQUIDATION_THRESHOLD = type(uint16).max; // 65535
    uint256 internal constant MAX_VALID_LIQUIDATION_BONUS = type(uint16).max; // 65535
    uint256 internal constant MAX_VALID_DECIMALS = type(uint8).max; // 255
    uint256 internal constant MAX_VALID_RESERVE_FACTOR = type(uint16).max; // 65535
    uint256 internal constant MAX_VALID_SUPPLY_CAP_USD = 17_179_869_183; // 17.18 billion USD
    uint256 internal constant MAX_VALID_BORROW_CAP_USD = 17_179_869_183; // 17.18 billion USD
    uint256 internal constant MAX_FLASHLOAN_LIMIT_USD = 17_179_869_183; // 17.18 billion USD

    /**
     * @notice Gets the liquidation threshold of the reserve
     * @param _self The reserve configuration
     * @return The liquidation threshold
     */
    function getLiquidationThreshold(
        DataTypes.ReserveConfigurationMap storage _self
    ) internal view returns (uint256) {
        return
            (_self.data & ~LIQUIDATION_THRESHOLD_MASK) >> LIQUIDATION_THRESHOLD_START_BIT_POSITION;
    }

    /**
     * @notice Gets the liquidation bonus of the reserve
     * @param _self The reserve configuration
     * @return The liquidation bonus
     */
    function getLiquidationBonus(
        DataTypes.ReserveConfigurationMap storage _self
    ) internal view returns (uint256) {
        return (_self.data & ~LIQUIDATION_BONUS_MASK) >> LIQUIDATION_BONUS_START_BIT_POSITION;
    }

    /**
     * @notice Gets the decimals of the underlying asset of the reserve
     * @param _self The reserve configuration
     * @return The decimals of the asset
     */
    function getDecimals(
        DataTypes.ReserveConfigurationMap storage _self
    ) internal view returns (uint256) {
        return (_self.data & ~DECIMALS_MASK) >> RESERVE_DECIMALS_START_BIT_POSITION;
    }

    /**
     * @notice Gets the active state of the reserve
     * @param _self The reserve configuration
     * @return The active state
     */
    function getActive(
        DataTypes.ReserveConfigurationMap storage _self
    ) internal view returns (bool) {
        return (_self.data & ~ACTIVE_MASK) != 0;
    }

    /**
     * @notice Gets the reserve factor of the reserve
     * @param _self The reserve configuration
     * @return The reserve factor
     */
    function getReserveFactor(
        DataTypes.ReserveConfigurationMap storage _self
    ) internal view returns (uint256) {
        return (_self.data & ~RESERVE_FACTOR_MASK) >> RESERVE_FACTOR_START_BIT_POSITION;
    }

    /**
     * @notice Gets the configuration flags of the reserve
     * @param _self The reserve configuration
     * @return The state flags representing active, frozen, borrowing enabled, stableRateBorrowing enabled
     */
    function getFlags(
        DataTypes.ReserveConfigurationMap storage _self
    ) internal view returns (bool, bool, bool, bool) {
        uint256 dataLocal = _self.data;

        return (
            (dataLocal & ~ACTIVE_MASK) != 0,
            (dataLocal & ~FROZEN_MASK) != 0,
            (dataLocal & ~BORROWING_MASK) != 0,
            (dataLocal & ~STABLE_BORROWING_MASK) != 0
        );
    }

    /**
     * @notice Sets the Loan to Value of the reserve
     * @param _self The reserve configuration
     * @param _ltv the new ltv
     */
    function setLtv(DataTypes.ReserveConfigurationMap memory _self, uint256 _ltv) internal pure {
        require(_ltv <= MAX_VALID_LTV, Errors.RC_INVALID_LTV);

        _self.data = (_self.data & LTV_MASK) | _ltv;
    }

    /**
     * @notice Sets the liquidation threshold of the reserve
     * @param _self The reserve configuration
     * @param _threshold The new liquidation threshold
     */
    function setLiquidationThreshold(
        DataTypes.ReserveConfigurationMap memory _self,
        uint256 _threshold
    ) internal pure {
        require(_threshold <= MAX_VALID_LIQUIDATION_THRESHOLD, Errors.RC_INVALID_LIQ_THRESHOLD);

        _self.data =
            (_self.data & LIQUIDATION_THRESHOLD_MASK) |
            (_threshold << LIQUIDATION_THRESHOLD_START_BIT_POSITION);
    }

    /**
     * @notice Sets the liquidation bonus of the reserve
     * @param _self The reserve configuration
     * @param _bonus The new liquidation bonus
     */
    function setLiquidationBonus(
        DataTypes.ReserveConfigurationMap memory _self,
        uint256 _bonus
    ) internal pure {
        require(_bonus <= MAX_VALID_LIQUIDATION_BONUS, Errors.RC_INVALID_LIQ_BONUS);

        _self.data =
            (_self.data & LIQUIDATION_BONUS_MASK) |
            (_bonus << LIQUIDATION_BONUS_START_BIT_POSITION);
    }

    /**
     * @notice Sets the decimals of the underlying asset of the reserve
     * @param _self The reserve configuration
     * @param _decimals The decimals
     */
    function setDecimals(
        DataTypes.ReserveConfigurationMap memory _self,
        uint256 _decimals
    ) internal pure {
        require(_decimals <= MAX_VALID_DECIMALS, Errors.RC_INVALID_DECIMALS);

        _self.data =
            (_self.data & DECIMALS_MASK) |
            (_decimals << RESERVE_DECIMALS_START_BIT_POSITION);
    }

    /**
     * @notice Sets the active state of the reserve
     * @param _self The reserve configuration
     * @param _active The active state
     */
    function setActive(DataTypes.ReserveConfigurationMap memory _self, bool _active) internal pure {
        _self.data =
            (_self.data & ACTIVE_MASK) |
            (uint256(_active ? 1 : 0) << IS_ACTIVE_START_BIT_POSITION);
    }

    /**
     * @notice Sets the frozen state of the reserve
     * @param _self The reserve configuration
     * @param _frozen The frozen state
     */
    function setFrozen(DataTypes.ReserveConfigurationMap memory _self, bool _frozen) internal pure {
        _self.data =
            (_self.data & FROZEN_MASK) |
            (uint256(_frozen ? 1 : 0) << IS_FROZEN_START_BIT_POSITION);
    }

    /**
     * @notice Enables or disables borrowing on the reserve
     * @param _self The reserve configuration
     * @param _enabled True if the borrowing needs to be enabled, false otherwise
     */
    function setBorrowingEnabled(
        DataTypes.ReserveConfigurationMap memory _self,
        bool _enabled
    ) internal pure {
        _self.data =
            (_self.data & BORROWING_MASK) |
            (uint256(_enabled ? 1 : 0) << BORROWING_ENABLED_START_BIT_POSITION);
    }

    /**
     * @notice Enables or disables stable rate borrowing on the reserve
     * @param _self The reserve configuration
     * @param _enabled True if the stable rate borrowing needs to be enabled, false otherwise
     */
    function setStableRateBorrowingEnabled(
        DataTypes.ReserveConfigurationMap memory _self,
        bool _enabled
    ) internal pure {
        _self.data =
            (_self.data & STABLE_BORROWING_MASK) |
            (uint256(_enabled ? 1 : 0) << STABLE_BORROWING_ENABLED_START_BIT_POSITION);
    }

    /**
     * @notice Sets the reserve factor of the reserve
     * @param _self The reserve configuration
     * @param _reserveFactor The reserve factor
     */
    function setReserveFactor(
        DataTypes.ReserveConfigurationMap memory _self,
        uint256 _reserveFactor
    ) internal pure {
        require(_reserveFactor <= MAX_VALID_RESERVE_FACTOR, Errors.RC_INVALID_RESERVE_FACTOR);

        _self.data =
            (_self.data & RESERVE_FACTOR_MASK) |
            (_reserveFactor << RESERVE_FACTOR_START_BIT_POSITION);
    }

    /**
     * @notice Sets the supply cap of the reserve in USD
     * @param _self The reserve configuration
     * @param _supplyCapUSD The supply cap in USD
     */
    function setSupplyCapUSD(
        DataTypes.ReserveConfigurationMap memory _self,
        uint256 _supplyCapUSD
    ) internal pure {
        require(_supplyCapUSD <= MAX_VALID_SUPPLY_CAP_USD, Errors.RC_INVALID_SUPPLY_CAP_USD);

        _self.data =
            (_self.data & SUPPLY_CAP_USD_MASK) |
            (_supplyCapUSD << SUPPLY_CAP_USD_START_BIT_POSITION);
    }

    /**
     * @notice Sets the borrow cap of the reserve in USD
     * @param _self The reserve configuration
     * @param _borrowCapUSD The borrow cap in USD
     */
    function setBorrowCapUSD(
        DataTypes.ReserveConfigurationMap memory _self,
        uint256 _borrowCapUSD
    ) internal pure {
        require(_borrowCapUSD <= MAX_VALID_BORROW_CAP_USD, Errors.RC_INVALID_BORROW_CAP_USD);

        _self.data =
            (_self.data & BORROW_CAP_USD_MASK) |
            (_borrowCapUSD << BORROW_CAP_USD_START_BIT_POSITION);
    }

    /**
     * @notice Sets the flashLoan limit of the reserve in USD
     * @param _self The reserve configuration
     * @param _flashLoanLimitUSD The flashLoan limit in USD
     */
    function setFlashLoanLimitUSD(
        DataTypes.ReserveConfigurationMap memory _self,
        uint256 _flashLoanLimitUSD
    ) internal pure {
        require(
            _flashLoanLimitUSD <= MAX_FLASHLOAN_LIMIT_USD,
            Errors.RC_INVALID_FLASHLOAN_LIMIT_USD
        );

        _self.data =
            (_self.data & FLASHLOAN_LIMIT_USD_MASK) |
            (_flashLoanLimitUSD << FLASHLOAN_LIMIT_USD_START_BIT_POSITION);
    }

    /**
     * @notice Returns the configuration data of a specific reserve
     * @param _self The reserve configuration
     * @return reserveConfig Struct containing the reserve configuration data
     */
    function getReserveConfigurationData(
        DataTypes.ReserveConfigurationMap memory _self
    ) internal pure returns (DataTypes.ReserveConfigurationData memory reserveConfig) {
        uint256 dataLocal = _self.data;
        reserveConfig.ltv = dataLocal & ~LTV_MASK;
        reserveConfig.liquidationThreshold =
            (dataLocal & ~LIQUIDATION_THRESHOLD_MASK) >>
            LIQUIDATION_THRESHOLD_START_BIT_POSITION;
        reserveConfig.liquidationBonus =
            (dataLocal & ~LIQUIDATION_BONUS_MASK) >>
            LIQUIDATION_BONUS_START_BIT_POSITION;
        reserveConfig.decimals =
            (dataLocal & ~DECIMALS_MASK) >>
            RESERVE_DECIMALS_START_BIT_POSITION;
        reserveConfig.reserveFactor =
            (dataLocal & ~RESERVE_FACTOR_MASK) >>
            RESERVE_FACTOR_START_BIT_POSITION;
        reserveConfig.supplyCapUSD =
            (dataLocal & ~SUPPLY_CAP_USD_MASK) >>
            SUPPLY_CAP_USD_START_BIT_POSITION;
        reserveConfig.borrowCapUSD =
            (dataLocal & ~BORROW_CAP_USD_MASK) >>
            BORROW_CAP_USD_START_BIT_POSITION;
        reserveConfig.flashLoanLimitUSD =
            (dataLocal & ~FLASHLOAN_LIMIT_USD_MASK) >>
            FLASHLOAN_LIMIT_USD_START_BIT_POSITION;

        reserveConfig.isActive = (dataLocal & ~ACTIVE_MASK) != 0;
        reserveConfig.isFrozen = (dataLocal & ~FROZEN_MASK) != 0;
        reserveConfig.borrowingEnabled = (dataLocal & ~BORROWING_MASK) != 0;
        reserveConfig.stableBorrowRateEnabled = (dataLocal & ~STABLE_BORROWING_MASK) != 0;

        reserveConfig.usageAsCollateralEnabled = reserveConfig.liquidationThreshold > 0;
    }
}
