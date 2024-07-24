// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title IMeldBankerNFTMinter interface
 * @notice This is the interface to both mint an NFT and set its metadata in the same transaction
 * @author MELD team
 */
interface IMeldBankerNFTMinter {
    /**
     * @notice Mints a new MeldBanker NFT and sets its metadata
     * @dev Only the BNKR_NFT_MINTER_BURNER_RLE role can call this function
     * @param _to Address of the receiver
     * @param _nftId The ID of the NFT to be minted
     * @param _golden True if the NFT is golden
     * @param _nftMetadata The ipfs hash of the NFT metadata
     */
    function mint(address _to, uint256 _nftId, bool _golden, string memory _nftMetadata) external;
}
