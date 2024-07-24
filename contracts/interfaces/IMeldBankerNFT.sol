// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {
    IERC721Enumerable
} from "@openzeppelin/contracts/token/ERC721/extensions/IERC721Enumerable.sol";

/**
 * @title IMeldBankerNFT interface
 * @notice This defines the functions the MeldBanker NFT must implement
 * @author MELD team
 */
interface IMeldBankerNFT is IERC721Enumerable {
    /**
     * @notice  Event emitted when the NFT Metadata contract address is updated
     * @param   executedBy Address that executed the update
     * @param   oldNftMetadata  Address of the old NFT Metadata contract
     * @param   newNftMetadataAddress  Address of the new NFT Metadata contract
     */
    event MetadataAddressUpdated(
        address indexed executedBy,
        address oldNftMetadata,
        address newNftMetadataAddress
    );

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
     * @notice  Event emitted when a new MeldBanker NFT is minted
     * @param   executedBy Address that minted the NFT
     * @param   to  Address of the receiver
     * @param   nftId  The ID of the minted NFT
     * @param   golden  True if the NFT is golden
     */
    event Mint(address indexed executedBy, address indexed to, uint256 indexed nftId, bool golden);

    /**
     * @notice  Event emitted when a MeldBanker NFT is burned
     * @param   executedBy Address that burned the NFT
     * @param   owner  Address of the owner of the NFT
     * @param   nftId  The ID of the burned NFT
     * @param   golden  True if the NFT is golden
     */
    event Burn(
        address indexed executedBy,
        address indexed owner,
        uint256 indexed nftId,
        bool golden
    );

    /**
     * @notice Mints a new MeldBanker NFT
     * @param _to Address of the receiver
     * @param _nftId The ID of the NFT to be minted
     * @param _golden True if the NFT is golden
     */
    function mint(address _to, uint256 _nftId, bool _golden) external;

    /**
     * @notice Burns a MeldBanker NFT
     * @param _nftId The ID of the NFT to be burned
     */
    function burn(uint256 _nftId) external;

    /**
     * @notice  ADMIN: Sets the address of the MELD Staking NFT Metadata contract
     * @param   _metadataAddress  Address of the MELD Staking NFT Metadata contract
     */
    function setMetadataAddress(address _metadataAddress) external;

    /**
     * @notice  ADMIN: Updates the address of the AddressesProvider
     * @param   _addressesProvider Address of the AddressesProvider
     */
    function updateAddressesProvider(address _addressesProvider) external;

    /**
     * @notice Checks if a MeldBanker NFT is golden
     * @param _nftId The ID of the NFT
     * @return bool True if it is a golden Meld Banker
     */
    function isGolden(uint256 _nftId) external view returns (bool);

    /**
     * @notice Returns the address of the current NFT metadata contract
     * @return address The address of the NFT metadata contract
     */
    function nftMetadata() external view returns (address);

    /**
     * @notice  Returns if an NFT currently exists in the collection
     * @dev     Extends the internal exists function from ERC721 standard
     * @param   _tokenId  NFT ID to check for existance
     * @return  bool  Returns if the NFT exists or not
     */
    function exists(uint256 _tokenId) external view returns (bool);

    /**
     * @notice  Returns the total number of minted NFTs
     * @dev     Uses the internal Counters to manage the active NFTs
     * @return  uint256  Returns the number of minted NFTs on the collection
     */
    function getTotalMintedNfts() external view returns (uint256);

    /**
     * @notice  Returns all the NFTs owned by the `_owner` address
     * @param   _owner  The address to query for NFTs
     * @return  uint256[]  Returns an array of NFT IDs owned by the `_owner` address
     */
    function getAllTokensByOwner(address _owner) external view returns (uint256[] memory);
}
