// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface ILendingRateOracle {
    /**
     * @notice returns the borrow rate for the specific asset.
     * @param _asset The address of the asset
     * @return borrowRate The borrow rate for the specific asset
     * @return success true if the borrow rate was returned successfully
     */
    function getMarketBorrowRate(
        address _asset
    ) external view returns (uint256 borrowRate, bool success);
}
