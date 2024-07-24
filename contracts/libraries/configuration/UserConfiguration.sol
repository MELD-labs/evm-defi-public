// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Errors} from "../helpers/Errors.sol";
import {DataTypes} from "../types/DataTypes.sol";

/**
 * @title UserConfiguration library
 * @notice Implements the bitmap logic to handle the user configuration
 * @author MELD team
 */
library UserConfiguration {
    uint256 internal constant BORROWING_MASK =
        0x5555555555555555555555555555555555555555555555555555555555555555;

    /**
     * @notice Sets if the user is borrowing the reserve identified by reserveIndex
     * @param _self The configuration object
     * @param _reserveIndex The index of the reserve in the bitmap
     * @param _borrowing True if the user is borrowing the reserve, false otherwise
     */
    function setBorrowing(
        DataTypes.UserConfigurationMap storage _self,
        uint256 _reserveIndex,
        bool _borrowing
    ) internal {
        require(_reserveIndex < 128, Errors.UL_INVALID_INDEX);
        _self.data =
            (_self.data & ~(1 << (_reserveIndex * 2))) |
            (uint256(_borrowing ? 1 : 0) << (_reserveIndex * 2));
    }

    /**
     * @notice Sets if the user is using as collateral the reserve identified by reserveIndex
     * @param _self The configuration object
     * @param _reserveIndex The index of the reserve in the bitmap
     * @param _usingAsCollateral True if the user is using the reserve as collateral, false otherwise
     */
    function setUsingAsCollateral(
        DataTypes.UserConfigurationMap storage _self,
        uint256 _reserveIndex,
        bool _usingAsCollateral
    ) internal {
        require(_reserveIndex < 128, Errors.UL_INVALID_INDEX);
        _self.data =
            (_self.data & ~(1 << (_reserveIndex * 2 + 1))) |
            (uint256(_usingAsCollateral ? 1 : 0) << (_reserveIndex * 2 + 1));
    }

    /**
     * @notice Sets if the user is accepting to participate in genius loan
     * @param _self The configuration object
     * @param _acceptGeniusLoan True if the user is accepting the genius loan, false otherwise
     */
    function setAcceptGeniusLoan(
        DataTypes.UserConfigurationMap storage _self,
        bool _acceptGeniusLoan
    ) internal {
        _self.acceptGeniusLoan = _acceptGeniusLoan;
    }

    /**
     * @notice Used to validate if a user has been using the reserve for borrowing or as collateral
     * @param _self The configuration object
     * @param _reserveIndex The index of the reserve in the bitmap
     * @return True if the user has been using a reserve for borrowing or as collateral, false otherwise
     */
    function isUsingAsCollateralOrBorrowing(
        DataTypes.UserConfigurationMap memory _self,
        uint256 _reserveIndex
    ) internal pure returns (bool) {
        require(_reserveIndex < 128, Errors.UL_INVALID_INDEX);
        return (_self.data >> (_reserveIndex * 2)) & 3 != 0;
    }

    /**
     * @notice Used to validate if a user has been using the reserve for borrowing
     * @param _self The configuration object
     * @param _reserveIndex The index of the reserve in the bitmap
     * @return True if the user has been using a reserve for borrowing, false otherwise
     */
    function isBorrowing(
        DataTypes.UserConfigurationMap memory _self,
        uint256 _reserveIndex
    ) internal pure returns (bool) {
        require(_reserveIndex < 128, Errors.UL_INVALID_INDEX);
        return (_self.data >> (_reserveIndex * 2)) & 1 != 0;
    }

    /**
     * @notice Used to validate if a user has been using the reserve as collateral
     * @param _self The configuration object
     * @param _reserveIndex The index of the reserve in the bitmap
     * @return True if the user has been using a reserve as collateral, false otherwise
     */
    function isUsingAsCollateral(
        DataTypes.UserConfigurationMap memory _self,
        uint256 _reserveIndex
    ) internal pure returns (bool) {
        require(_reserveIndex < 128, Errors.UL_INVALID_INDEX);
        return (_self.data >> (_reserveIndex * 2 + 1)) & 1 != 0;
    }

    /**
     * @notice Used to validate if a user has been borrowing from any reserve
     * @param _self The configuration object
     * @return True if the user has been borrowing any reserve, false otherwise
     */
    function isBorrowingAny(
        DataTypes.UserConfigurationMap memory _self
    ) internal pure returns (bool) {
        return _self.data & BORROWING_MASK != 0;
    }

    /**
     * @notice Used to validate if a user has not been using any reserve
     * @param _self The configuration object
     * @return True if the user has been borrowing any reserve, false otherwise
     */
    function isEmpty(DataTypes.UserConfigurationMap memory _self) internal pure returns (bool) {
        return _self.data == 0;
    }

    /**
     * @notice Used to keep track if the user is accepting the genius loan
     * @param _self The configuration object
     * @return True if the user is accepting the genius loan, false otherwise
     */
    function isAcceptingGeniusLoan(
        DataTypes.UserConfigurationMap memory _self
    ) internal pure returns (bool) {
        return _self.acceptGeniusLoan;
    }
}
