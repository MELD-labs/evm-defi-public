// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title IMeldBankerNFTMetadataSetter interface
 * @notice This is the interface to set the metadata of a specific MeldBanker NFT in the MeldBanker NFT Metadata contract
 * @author MELD team
 */
interface IMeldBankerNFTMetadataSetter {
    /**
     * @notice  Sets metadata of the NFT, based on the `_nftId`
     * @param   _nftId  ID of the NFT
     * @param   _uri    Metadata of the NFT
     */
    function setMetadata(uint256 _nftId, string memory _uri) external;
}
