// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {LendingBase, IAddressesProvider} from "../../base/LendingBase.sol";
import {Errors} from "../../libraries/helpers/Errors.sol";
import {IPriceOracle} from "../../interfaces/IPriceOracle.sol";

/**
 * @title PriceOracleAggregator
 * @notice A contract for aggregating prices from multiple oracles
 * @dev Implements the IPriceOracle interface
 * @author MELD team
 */
contract PriceOracleAggregator is LendingBase, IPriceOracle {
    /// @notice List of addresses for price oracles
    address[] public priceOracleList;

    /**
     * @notice Emitted when the price oracle list is updated
     * @param executedBy The address that executed the update
     * @param oldPriceOracleList The old list of price oracles
     * @param newPriceOracleList The new list of price oracles
     */
    event PriceOracleListUpdated(
        address indexed executedBy,
        address[] oldPriceOracleList,
        address[] newPriceOracleList
    );

    /**
     * @notice Initializes the PriceOracleAggregator
     * @param _addressesProvider The address of the AddressesProvider contract
     */
    constructor(address _addressesProvider) {
        require(_addressesProvider != address(0), Errors.INVALID_ADDRESS);
        addressesProvider = IAddressesProvider(_addressesProvider);
    }

    /**
     * @notice Sets the list of price oracles
     * @param _newPriceOracleList An array of new price oracle addresses
     */
    function setPriceOracleList(
        address[] memory _newPriceOracleList
    ) external whenNotPaused onlyRole(addressesProvider.ORACLE_MANAGEMENT_ROLE()) {
        require(_newPriceOracleList.length > 0, Errors.EMPTY_ARRAY);
        emit PriceOracleListUpdated(msg.sender, priceOracleList, _newPriceOracleList);
        priceOracleList = _newPriceOracleList;
    }

    /**
     * @notice Retrieves the price of an asset from the list of oracles
     * @dev Iterates through the list of oracles until a successful price retrieval
     * @param _asset The address of the asset
     * @return price The price of the asset
     * @return success Boolean indicating if the price retrieval was successful
     */
    function getAssetPrice(
        address _asset
    ) external view override returns (uint256 price, bool success) {
        require(priceOracleList.length > 0, Errors.PRICE_ORACLE_NOT_SET);
        for (uint256 i = 0; i < priceOracleList.length; i++) {
            (price, success) = IPriceOracle(priceOracleList[i]).getAssetPrice(_asset);
            if (success) {
                return (price, success);
            }
        }
    }
}
