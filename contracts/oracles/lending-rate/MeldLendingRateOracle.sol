// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {LendingBase, IAddressesProvider} from "../../base/LendingBase.sol";
import {Errors} from "../../libraries/helpers/Errors.sol";
import {IMeldLendingRateOracle} from "../../interfaces/IMeldLendingRateOracle.sol";

/**
 * @title MeldLendingRateOracle
 * @notice A contract for setting and updating asset borrow rates
 * @dev The contract is used to set and update the borrow rates of assets
 * @author MELD team
 */
contract MeldLendingRateOracle is LendingBase, IMeldLendingRateOracle {
    mapping(address => uint256) public borrowRates;

    /**
     * @notice Initializes the MeldLendingRateOracle
     * @param _addressesProvider The address of the AddressesProvider contract
     */
    constructor(address _addressesProvider) {
        require(_addressesProvider != address(0), Errors.INVALID_ADDRESS);
        addressesProvider = IAddressesProvider(_addressesProvider);
    }

    /**
     * @notice Sets the borrow rates of multiple assets.
     * @dev Updates the borrow rates of the specified assets and emits the AssetBorrowRateUpdated event for each. Setting the borrow rate to anything above type(uint128).max for an asset will result in
     * the getMarketBorrowRate function returning false for that asset.
     * @param _assetList An array of asset addresses whose borrow rates are to be set.
     * @param _borrowRateList An array of new borrow rates corresponding to the assets in _assetList.
     */
    function setMultipleAssetsBorrowRate(
        address[] calldata _assetList,
        uint256[] calldata _borrowRateList
    ) external {
        require(_assetList.length == _borrowRateList.length, Errors.INCONSISTENT_ARRAY_SIZE);
        require(_assetList.length > 0, Errors.EMPTY_ARRAY);
        for (uint256 i = 0; i < _assetList.length; i++) {
            setMarketBorrowRate(_assetList[i], _borrowRateList[i]);
        }
    }

    /**
     * @notice returns the borrow rate for the specific asset.
     * @param _asset The address of the asset
     * @return borrowRate The borrow rate for the specific asset
     * @return success true if the borrow rate was returned successfully
     */
    function getMarketBorrowRate(
        address _asset
    ) external view override returns (uint256 borrowRate, bool success) {
        borrowRate = borrowRates[_asset];
        return (borrowRate, borrowRate <= type(uint128).max);
    }

    /**
     * @notice Sets the borrow rate of a single asset.
     * @dev Updates the borrow rate of the specified asset and emits the AssetBorrowRateUpdated event. Passing anything above type(uint128).max as the _borrowRate will result in
     * the getMarketBorrowRate function returning false for that asset.
     * @param _asset The address of the asset whose borrow rate is to be set.
     * @param _borrowRate The new borrow rate of the asset.
     */
    function setMarketBorrowRate(
        address _asset,
        uint256 _borrowRate
    ) public onlyRole(addressesProvider.ORACLE_MANAGEMENT_ROLE()) {
        emit AssetBorrowRateUpdated(msg.sender, _asset, borrowRates[_asset], _borrowRate);
        borrowRates[_asset] = _borrowRate;
    }
}
