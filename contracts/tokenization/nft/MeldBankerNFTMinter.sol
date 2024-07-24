// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {LendingBase, IAddressesProvider} from "../../base/LendingBase.sol";
import {Errors} from "../../libraries/helpers/Errors.sol";
import {IMeldBankerNFT} from "../../interfaces/IMeldBankerNFT.sol";
import {IMeldBankerNFTMinter} from "../../interfaces/IMeldBankerNFTMinter.sol";
import {IMeldBankerNFTMetadataSetter} from "../../interfaces/IMeldBankerNFTMetadataSetter.sol";

/**
 * @title MeldBankerNFTMinter contract
 * @notice This contract will mint MeldBanker NFTs and set their metadata
 * @author MELD team
 */
contract MeldBankerNFTMinter is LendingBase, IMeldBankerNFTMinter {
    IMeldBankerNFT private immutable meldBankerNFT;

    /**
     * @notice Initializes the contract
     * @param _addressesProvider The address of the AddressesProvider
     */
    constructor(address _addressesProvider) {
        require(_addressesProvider != address(0), Errors.INVALID_ADDRESS);
        addressesProvider = IAddressesProvider(_addressesProvider);
        address meldBankerNFTAddress = addressesProvider.getMeldBankerNFT();
        require(meldBankerNFTAddress != address(0), Errors.INVALID_ADDRESS);
        meldBankerNFT = IMeldBankerNFT(meldBankerNFTAddress);
    }

    /**
     * @notice Mints a new MeldBanker NFT and sets its metadata
     * @dev Only the BNKR_NFT_MINTER_BURNER_ROLE role can call this function
     * @param _to Address of the receiver
     * @param _nftId The ID of the NFT to be minted
     * @param _golden True if the NFT is golden
     * @param _nftMetadata The ipfs hash of the NFT metadata
     */
    function mint(
        address _to,
        uint256 _nftId,
        bool _golden,
        string memory _nftMetadata
    ) external override onlyRole(addressesProvider.BNKR_NFT_MINTER_BURNER_ROLE()) {
        IMeldBankerNFTMetadataSetter(meldBankerNFT.nftMetadata()).setMetadata(_nftId, _nftMetadata);
        meldBankerNFT.mint(_to, _nftId, _golden);
    }
}
