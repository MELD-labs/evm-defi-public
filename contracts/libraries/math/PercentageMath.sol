// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Errors} from "../helpers/Errors.sol";

/**
 * @title PercentageMath library
 * @notice Provides functions to perform percentage calculations with simple uint256
 * @dev The precision is 100_00, meaning that 100(100.00 %) is represented as 100_00
 */
library PercentageMath {
    uint256 public constant PERCENTAGE_FACTOR = 100_00; //percentage plus two decimals
    uint256 public constant HALF_PERCENT = PERCENTAGE_FACTOR / 2;

    /**
     * @notice Executes a percentage multiplication
     * @param _value The value of which the percentage needs to be calculated
     * @param _percentage The percentage of the value to be calculated
     * @return The percentage of value
     */
    function percentMul(uint256 _value, uint256 _percentage) internal pure returns (uint256) {
        if (_value == 0 || _percentage == 0) {
            return 0;
        }

        require(
            _value <= (type(uint256).max - HALF_PERCENT) / _percentage,
            Errors.MATH_MULTIPLICATION_OVERFLOW
        );

        return (_value * _percentage + HALF_PERCENT) / PERCENTAGE_FACTOR;
    }

    /**
     * @notice Executes a percentage division
     * @param _value The value of which the percentage needs to be calculated
     * @param _percentage The percentage of the value to be calculated
     * @return The value divided the percentage
     */
    function percentDiv(uint256 _value, uint256 _percentage) internal pure returns (uint256) {
        require(_percentage != 0, Errors.MATH_DIVISION_BY_ZERO);
        uint256 halfPercentage = _percentage / 2;

        require(
            _value <= (type(uint256).max - halfPercentage) / PERCENTAGE_FACTOR,
            Errors.MATH_MULTIPLICATION_OVERFLOW
        );

        return (_value * PERCENTAGE_FACTOR + halfPercentage) / _percentage;
    }
}
