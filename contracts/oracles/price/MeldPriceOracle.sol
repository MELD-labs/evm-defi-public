// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {LendingBase, IAddressesProvider} from "../../base/LendingBase.sol";
import {Errors} from "../../libraries/helpers/Errors.sol";
import {IMeldPriceOracle} from "../../interfaces/IMeldPriceOracle.sol";

/**
 * @title MeldPriceOracle
 * @notice A contract for managing and updating asset prices
 * @dev Implements the IMeldPriceOracle interface
 * @author MELD team
 */
contract MeldPriceOracle is LendingBase, IMeldPriceOracle {
    /// @notice Stores the latest price of an asset
    mapping(address asset => uint256 price) private prices;

    /// @notice Stores the timestamp of the last price update for an asset
    mapping(address asset => uint256 timestamp) public timestamps;

    /// @notice Maximum age a price can have to be considered valid
    uint256 public maxPriceAge = 15 minutes;

    /**
     * @notice Initializes the MeldPriceOracle
     * @param _addressesProvider The address of the AddressesProvider contract
     */
    constructor(address _addressesProvider) {
        require(_addressesProvider != address(0), Errors.INVALID_ADDRESS);
        addressesProvider = IAddressesProvider(_addressesProvider);
    }

    /**
     * @notice Sets the maximum age in seconds a price can have to be considered valid
     * @dev Updates the maximum price age and emits the MaxPriceAgeUpdated event.
     * @param _newMaxPriceAge The new maximum age for a price
     */
    function setMaxPriceAge(
        uint256 _newMaxPriceAge
    ) external override whenNotPaused onlyRole(addressesProvider.ORACLE_MANAGEMENT_ROLE()) {
        require(_newMaxPriceAge > 0, Errors.EMPTY_VALUE);
        emit MaxPriceAgeUpdated(msg.sender, maxPriceAge, _newMaxPriceAge);
        maxPriceAge = _newMaxPriceAge;
    }

    /**
     * @notice Sets prices for multiple assets
     * @dev Updates the prices of the specified assets and emits the AssetPriceUpdated event for each.
     * @param _assetList Array of asset addresses
     * @param _priceList Array of prices corresponding to the assets
     */
    function setMultipleAssetsPrice(
        address[] calldata _assetList,
        uint256[] calldata _priceList
    ) external {
        require(_assetList.length == _priceList.length, Errors.INCONSISTENT_ARRAY_SIZE);
        require(_assetList.length > 0, Errors.EMPTY_ARRAY);
        for (uint256 i = 0; i < _assetList.length; i++) {
            setAssetPrice(_assetList[i], _priceList[i]);
        }
    }

    /**
     * @notice Retrieves the price of an asset
     * @dev Checks if the price is valid based on its timestamp
     * @param _asset The address of the asset
     * @return price The price of the asset
     * @return success Boolean indicating if the price is valid
     */
    function getAssetPrice(
        address _asset
    ) external view override returns (uint256 price, bool success) {
        price = prices[_asset];
        success = price > 0 && _validTimestamp(timestamps[_asset]);
    }

    /**
     * @notice Sets the price for a single asset
     * @dev Updates the price of the specified asset and emits the AssetPriceUpdated event.
     * @param _asset The address of the asset
     * @param _price The new price of the asset
     */
    function setAssetPrice(
        address _asset,
        uint256 _price
    ) public onlyRole(addressesProvider.ORACLE_MANAGEMENT_ROLE()) {
        emit AssetPriceUpdated(msg.sender, _asset, prices[_asset], _price);
        prices[_asset] = _price;
        timestamps[_asset] = block.timestamp;
    }

    /**
     * @notice Checks if a timestamp is within the valid age range
     * @dev Used internally to validate price timestamps
     * @param _timestamp The timestamp to validate
     * @return bool Boolean indicating if the timestamp is valid
     */
    function _validTimestamp(uint256 _timestamp) internal view returns (bool) {
        return block.timestamp - _timestamp <= maxPriceAge;
    }
}
