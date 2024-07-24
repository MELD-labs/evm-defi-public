// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IPriceOracle} from "./IPriceOracle.sol";

/**
 * @title IMeldPriceOracle Interface
 * @dev Interface for the MELD price oracle, extending the IPriceOracle interface.
 * This interface defines the necessary events and functions for setting and updating
 * asset prices and the maximum age of prices considered valid.
 * @author MELD team
 */
interface IMeldPriceOracle is IPriceOracle {
    /**
     * @notice Emitted when the price of an asset is updated.
     * @param executedBy The address of the user who executed the price update.
     * @param asset The address of the asset whose price was updated.
     * @param oldPrice The previous price of the asset before the update.
     * @param newPrice The new price of the asset after the update.
     */
    event AssetPriceUpdated(
        address indexed executedBy,
        address indexed asset,
        uint256 oldPrice,
        uint256 newPrice
    );

    /**
     * @notice Emitted when the maximum price age is updated.
     * @param executedBy The address of the user who executed the update.
     * @param oldMaxPriceAge The previous maximum age of prices considered valid.
     * @param newMaxPriceAge The new maximum age of prices considered valid.
     */
    event MaxPriceAgeUpdated(
        address indexed executedBy,
        uint256 oldMaxPriceAge,
        uint256 newMaxPriceAge
    );

    /**
     * @notice Sets the price of a single asset.
     * @dev Updates the price of the specified asset and emits the AssetPriceUpdated event.
     * @param _asset The address of the asset whose price is to be set.
     * @param _price The new price of the asset.
     */
    function setAssetPrice(address _asset, uint256 _price) external;

    /**
     * @notice Sets the prices of multiple assets.
     * @dev Updates the prices of the specified assets and emits the AssetPriceUpdated event for each.
     * @param _assetList An array of asset addresses whose prices are to be set.
     * @param _priceList An array of new prices corresponding to the assets in assetList.
     */
    function setMultipleAssetsPrice(
        address[] calldata _assetList,
        uint256[] calldata _priceList
    ) external;

    /**
     * @notice Sets the maximum age of prices considered valid.
     * @dev Updates the maximum price age and emits the MaxPriceAgeUpdated event.
     * @param _newMaxPriceAge The new maximum age of prices considered valid.
     */
    function setMaxPriceAge(uint256 _newMaxPriceAge) external;
}
