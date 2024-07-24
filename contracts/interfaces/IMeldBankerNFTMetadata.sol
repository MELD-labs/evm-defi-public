// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title IMeldBankerNFTMetadata interface
 * @notice This is the interface a contract must implement to be able to provide the metadata of the MeldBanker NFT
 * @author MELD team
 */
interface IMeldBankerNFTMetadata {
    /**
     * @notice  Event emitted when the metadata of the NFT is set
     * @param   executedBy Address that set the metadata
     * @param   nftId  The ID of the NFT
     * @param   uri  The metadata of the NFT
     */
    event MetadataSet(address indexed executedBy, uint256 indexed nftId, string uri);

    /**
     * @notice  Generates metadata on the fly, based on the `_nftId`
     * @dev     It gathers information about the MeldBanker NFT and generates a JSON string
     * @param   _nftId  ID of the NFT
     * @return  string  JSON string containing the metadata of the NFT
     */
    function getMetadata(uint256 _nftId) external view returns (string memory);
}
