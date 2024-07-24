// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {WadRayMath} from "./WadRayMath.sol";

/**
 * @title MathUtils library
 * @notice Implements math functions to calculate interest using a linear interest rate formula and a binomial approximation
 * @author MELD team
 */
library MathUtils {
    using WadRayMath for uint256;

    /// @dev Ignoring leap years
    uint256 internal constant SECONDS_PER_YEAR = 365 days;

    /**
     * @notice Function to calculate the interest accumulated using a linear interest rate formula
     * @param _rate The interest rate, in ray
     * @param _lastUpdateTimestamp The timestamp of the last update of the interest
     * @return The interest rate linearly accumulated during the timeDelta, in ray
     */
    function calculateLinearInterest(
        uint256 _rate,
        uint40 _lastUpdateTimestamp
    ) internal view returns (uint256) {
        uint256 timeDifference = block.timestamp - uint256(_lastUpdateTimestamp);
        return ((_rate * timeDifference) / SECONDS_PER_YEAR) + WadRayMath.ray();
    }

    /**
     * @notice Calculates the compounded interest between the timestamp of the last update and the current block timestamp
     * @param _rate The interest rate (in ray)
     * @param _lastUpdateTimestamp The timestamp from which the interest accumulation needs to be calculated
     */
    function calculateCompoundedInterest(
        uint256 _rate,
        uint40 _lastUpdateTimestamp
    ) internal view returns (uint256) {
        return calculateCompoundedInterest(_rate, _lastUpdateTimestamp, block.timestamp);
    }

    /**
     * @notice Function to calculate the interest using a compounded interest rate formula
     * To avoid expensive exponentiation, the calculation is performed using a binomial approximation:
     *
     *  (1+x)^n = 1+n*x+[n/2*(n-1)]*x^2+[n/6*(n-1)*(n-2)*x^3...
     *
     * The approximation slightly underpays liquidity providers and undercharges borrowers, with the advantage of great gas cost reductions
     * The whitepaper contains reference to the approximation and a table showing the margin of error per different time periods
     *
     * @param _rate The interest rate, in ray
     * @param _lastUpdateTimestamp The timestamp of the last update of the interest
     * @return The interest rate compounded during the timeDelta, in ray
     */
    function calculateCompoundedInterest(
        uint256 _rate,
        uint40 _lastUpdateTimestamp,
        uint256 _currentTimestamp
    ) internal pure returns (uint256) {
        uint256 exp = _currentTimestamp - uint256(_lastUpdateTimestamp);

        if (exp == 0) {
            return WadRayMath.ray();
        }

        uint256 expMinusOne = exp - 1;
        uint256 expMinusTwo = exp > 2 ? exp - 2 : 0;
        uint256 ratePerSecond = _rate / SECONDS_PER_YEAR;

        uint256 basePowerTwo = ratePerSecond.rayMul(ratePerSecond);
        uint256 basePowerThree = basePowerTwo.rayMul(ratePerSecond);

        uint256 secondTerm = (exp * expMinusOne * basePowerTwo) / 2;
        uint256 thirdTerm = (exp * expMinusOne * expMinusTwo * basePowerThree) / 6;

        return WadRayMath.ray() + (ratePerSecond * exp) + secondTerm + thirdTerm;
    }
}
