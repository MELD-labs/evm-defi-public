// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title ISupraSValueFeed interface
 * @notice Interface for the S-Value feed of MELD
 * @author SupraOracles
 */
interface ISupraSValueFeed {
    // Data structure to hold the pair data
    // solhint-disable-next-line contract-name-camelcase
    struct priceFeed {
        uint256 round;
        uint256 decimals;
        uint256 time;
        uint256 price;
    }

    // Below functions enable you to retrieve different flavours of S-Value
    // Term "pair ID" and "Pair index" both refer to the same, pair index mentioned in our data pairs list.

    // Function to retrieve the data for a single data pair
    function getSvalue(uint256 _pairIndex) external view returns (priceFeed memory);

    //Function to fetch the data for a multiple data pairs
    function getSvalues(uint256[] memory _pairIndexes) external view returns (priceFeed[] memory);
}
