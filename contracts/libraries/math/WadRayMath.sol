// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Errors} from "../helpers/Errors.sol";

/**
 * @title WadRayMath library
 * @notice Provides mul and div functions for wad and ray
 * @author MELD team
 */
library WadRayMath {
    uint256 internal constant WAD = 1e18;

    uint256 internal constant RAY = 1e27;
    uint256 internal constant HALF_RAY = RAY / 2;

    uint256 internal constant WAD_RAY_RATIO = 1e9;

    /**
     * @return One ray, 1e27
     */
    function ray() internal pure returns (uint256) {
        return RAY;
    }

    /**
     * @notice Divides two wad, rounding half up to the nearest wad
     * @param _a Wad
     * @param _b Wad
     * @return The result of a/b, in wad
     */
    function wadDiv(uint256 _a, uint256 _b) internal pure returns (uint256) {
        require(_b != 0, Errors.MATH_DIVISION_BY_ZERO);
        uint256 halfB = _b / 2;

        require(_a <= (type(uint256).max - halfB) / WAD, Errors.MATH_MULTIPLICATION_OVERFLOW);

        return (_a * WAD + halfB) / _b;
    }

    /**
     * @notice Multiplies two ray, rounding half up to the nearest ray
     * @param _a Ray
     * @param _b Ray
     * @return The result of a*b, in ray
     */
    function rayMul(uint256 _a, uint256 _b) internal pure returns (uint256) {
        if (_a == 0 || _b == 0) {
            return 0;
        }

        require(_a <= (type(uint256).max - HALF_RAY) / _b, Errors.MATH_MULTIPLICATION_OVERFLOW);

        return (_a * _b + HALF_RAY) / RAY;
    }

    /**
     * @notice Divides two ray, rounding half up to the nearest ray
     * @param _a Ray
     * @param _b Ray
     * @return The result of a/b, in ray
     */
    function rayDiv(uint256 _a, uint256 _b) internal pure returns (uint256) {
        require(_b != 0, Errors.MATH_DIVISION_BY_ZERO);
        uint256 halfB = _b / 2;

        require(_a <= (type(uint256).max - halfB) / RAY, Errors.MATH_MULTIPLICATION_OVERFLOW);

        return (_a * RAY + halfB) / _b;
    }

    /**
     * @notice Converts wad up to ray
     * @param _a Wad
     * @return a converted in ray
     */
    function wadToRay(uint256 _a) internal pure returns (uint256) {
        uint256 result = _a * WAD_RAY_RATIO;
        require(result / WAD_RAY_RATIO == _a, Errors.MATH_MULTIPLICATION_OVERFLOW);
        return result;
    }
}
