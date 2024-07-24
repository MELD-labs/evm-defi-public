// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {LendingBase, IAddressesProvider} from "../../base/LendingBase.sol";
import {Errors} from "../../libraries/helpers/Errors.sol";
import {ILendingRateOracle} from "../../interfaces/ILendingRateOracle.sol";

/**
 * @title LendingRateOracleAggregator
 * @notice A contract for aggregating lending rates from multiple oracles
 * @dev Implements the ILendingRateOracle interface
 * @author MELD team
 */
contract LendingRateOracleAggregator is LendingBase, ILendingRateOracle {
    /// @notice List of addresses for lending rate oracles
    address[] public lendingRateOracleList;

    /**
     * @notice Emitted when the lending rate oracle list is updated
     * @param executedBy The address that executed the update
     * @param oldLendingRateOracleList The old list of lending rate oracles
     * @param newLendingRateOracleList The new list of lending rate oracles
     */
    event LendingRateOracleListUpdated(
        address indexed executedBy,
        address[] oldLendingRateOracleList,
        address[] newLendingRateOracleList
    );

    /**
     * @notice Initializes the LendingRateOracleAggregator
     * @param _addressesProvider The address of the AddressesProvider contract
     */
    constructor(address _addressesProvider) {
        require(_addressesProvider != address(0), Errors.INVALID_ADDRESS);
        addressesProvider = IAddressesProvider(_addressesProvider);
    }

    /**
     * @notice Sets the list of lending rate oracles
     * @param _newLendingRateOracleList An array of new lending rate oracle addresses
     */
    function setLendingRateOracleList(
        address[] memory _newLendingRateOracleList
    ) external whenNotPaused onlyRole(addressesProvider.ORACLE_MANAGEMENT_ROLE()) {
        require(_newLendingRateOracleList.length > 0, Errors.EMPTY_ARRAY);
        emit LendingRateOracleListUpdated(
            msg.sender,
            lendingRateOracleList,
            _newLendingRateOracleList
        );
        lendingRateOracleList = _newLendingRateOracleList;
    }

    /**
     * @notice Retrieves the borrow rate of an asset from the list of oracles
     * @dev Iterates through the list of oracles until a successful borrow rate retrieval
     * @param _asset The address of the asset
     * @return borrowRate The borrow rate of the asset
     * @return success Boolean indicating if the borrow rate retrieval was successful
     */
    function getMarketBorrowRate(
        address _asset
    ) external view override returns (uint256 borrowRate, bool success) {
        require(lendingRateOracleList.length > 0, Errors.LENDING_RATE_ORACLE_NOT_SET);
        for (uint256 i = 0; i < lendingRateOracleList.length; i++) {
            (borrowRate, success) = ILendingRateOracle(lendingRateOracleList[i])
                .getMarketBorrowRate(_asset);
            if (success) {
                return (borrowRate, success);
            }
        }
    }
}
