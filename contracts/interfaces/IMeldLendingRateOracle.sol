// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ILendingRateOracle} from "./ILendingRateOracle.sol";

/**
 * @title IMeldLendingRateOracle Interface
 * @notice Interface for the MELD lending rate oracle, extending the ILendingRateOracle interface.
 * This interface defines the necessary events and functions for setting and updating asset borrow rates.
 * @author MELD team
 */
interface IMeldLendingRateOracle is ILendingRateOracle {
    /**
     * @notice Emitted when the borrow rate of an asset is updated.
     * @param executedBy The address of the user who executed the borrow rate update.
     * @param asset The address of the asset whose borrow rate was updated.
     * @param oldBorrowRate The previous borrow rate of the asset before the update.
     * @param newBorrowRate The new borrow rate of the asset after the update.
     */
    event AssetBorrowRateUpdated(
        address indexed executedBy,
        address indexed asset,
        uint256 oldBorrowRate,
        uint256 newBorrowRate
    );

    /**
     * @notice Sets the borrow rate of a single asset.
     * @dev Updates the borrow rate of the specified asset and emits the AssetBorrowRateUpdated event. Passing type(uint256).max as the _borrowRate will result in
     * the getMarketBorrowRate function returning false for that asset.
     * @param _asset The address of the asset whose borrow rate is to be set.
     * @param _borrowRate The new borrow rate of the asset.
     */
    function setMarketBorrowRate(address _asset, uint256 _borrowRate) external;

    /**
     * @notice Sets the borrow rates of multiple assets.
     * @dev Updates the borrow rates of the specified assets and emits the AssetBorrowRateUpdated event for each. Setting the borrow rate to type(uint256).max for an asset will result in
     * the getMarketBorrowRate function returning false for that asset.
     * @param _assetList An array of asset addresses whose borrow rates are to be set.
     * @param _borrowRateList An array of new borrow rates corresponding to the assets in _assetList.
     */
    function setMultipleAssetsBorrowRate(
        address[] calldata _assetList,
        uint256[] calldata _borrowRateList
    ) external;
}
