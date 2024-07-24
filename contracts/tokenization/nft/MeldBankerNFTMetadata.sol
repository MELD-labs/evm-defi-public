// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {LendingBase, IAddressesProvider} from "../../base/LendingBase.sol";
import {Errors} from "../../libraries/helpers/Errors.sol";
import {IMeldBankerNFTMetadata} from "../../interfaces/IMeldBankerNFTMetadata.sol";
import {IMeldBankerNFTMetadataSetter} from "../../interfaces/IMeldBankerNFTMetadataSetter.sol";

/**
 * @title MeldBankerNFTMetadata contract
 * @notice This is the contract for the MeldBanker NFT metadata. It provides dynamic metadata for the MeldBanker NFT
 * @author MELD team
 */
contract MeldBankerNFTMetadata is
    LendingBase,
    IMeldBankerNFTMetadata,
    IMeldBankerNFTMetadataSetter
{
    mapping(uint256 nftId => string uri) private tokenURIs;

    /**
     * @notice  Event emitted when the AddressesProvider is updated
     * @param   executedBy Address that executed the update
     * @param   oldAddress  Address of the old AddressesProvider
     * @param   newAddress  Address of the new AddressesProvider
     */
    event AddressesProviderUpdated(
        address indexed executedBy,
        address indexed oldAddress,
        address indexed newAddress
    );

    /**
     * @notice Initializes the contract
     * @param _addressesProvider The address of the AddressesProvider
     */
    constructor(address _addressesProvider) {
        _updateAddressesProvider(_addressesProvider);
    }

    /**
     * @notice  Sets metadata of the NFT, based on the `_nftId`
     * @param   _nftId  ID of the NFT
     * @param   _uri    Metadata of the NFT
     */
    function setMetadata(
        uint256 _nftId,
        string memory _uri
    ) external override whenNotPaused onlyRole(addressesProvider.BNKR_NFT_MINTER_BURNER_ROLE()) {
        tokenURIs[_nftId] = _uri;
        emit MetadataSet(msg.sender, _nftId, _uri);
    }

    /**
     * @notice  ADMIN: Updates the address of the AddressesProvider
     * @param   _addressesProvider Address of the AddressesProvider
     */
    function updateAddressesProvider(
        address _addressesProvider
    ) external onlyRole(addressesProvider.PRIMARY_ADMIN_ROLE()) {
        _updateAddressesProvider(_addressesProvider);
    }

    /**
     * @notice  Returns metadata of the NFT, based on the `_nftId`
     * @param   _nftId  ID of the NFT
     * @return  string  Metadata of the NFT
     */
    function getMetadata(uint256 _nftId) external view override returns (string memory) {
        return tokenURIs[_nftId];
    }

    /**
     * @notice  ADMIN: Updates the address of the AddressesProvider
     * @param   _addressesProvider Address of the AddressesProvider
     */
    function _updateAddressesProvider(address _addressesProvider) internal {
        require(_addressesProvider != address(0), Errors.INVALID_ADDRESS);
        emit AddressesProviderUpdated(msg.sender, address(addressesProvider), _addressesProvider);
        addressesProvider = IAddressesProvider(_addressesProvider);
        address lendingPoolAddress = addressesProvider.getLendingPool();
        require(lendingPoolAddress != address(0), Errors.MB_INVALID_LENDING_POOL);
    }
}
