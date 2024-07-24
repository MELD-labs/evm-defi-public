// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {
    ERC721,
    ERC721Enumerable
} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {LendingBase, IAddressesProvider} from "../../base/LendingBase.sol";
import {Errors} from "../../libraries/helpers/Errors.sol";
import {IMeldBankerNFT} from "../../interfaces/IMeldBankerNFT.sol";
import {IMeldBankerNFTMetadata} from "../../interfaces/IMeldBankerNFTMetadata.sol";
import {IMeldBankerBlocked} from "../../interfaces/IMeldBankerBlocked.sol";

/**
 * @title MeldBankerNFT contract
 * @notice This is the contract for the MeldBanker NFT. It provides benefits in the protocol for supply and borrowing
 * @author MELD team
 */
contract MeldBankerNFT is ERC721Enumerable, LendingBase, IMeldBankerNFT {
    IMeldBankerBlocked private meldBankerBlockedGetter;
    uint256 private totalMintedNfts;

    address public override nftMetadata;

    mapping(uint256 nftId => bool golden) public override isGolden;

    modifier onlyNonBlocked(uint256 _nftId) {
        require(!meldBankerBlockedGetter.isMeldBankerBlocked(_nftId), Errors.MB_NFT_BLOCKED);
        _;
    }

    /**
     * @notice Initializes the contract
     * @param _addressesProvider The address of the AddressesProvider
     */
    constructor(address _addressesProvider) ERC721("MELD Banker", "BNKR") {
        _updateAddressesProvider(_addressesProvider);
    }

    /**
     * @notice Mints a new MeldBanker NFT
     * @dev Only the BNKR_NFT_MINTER_BURNER_ROLE role can call this function
     * @param _to Address of the receiver
     * @param _nftId The ID of the NFT to be minted
     * @param _golden True if the NFT is golden
     */
    function mint(
        address _to,
        uint256 _nftId,
        bool _golden
    ) external override onlyRole(addressesProvider.BNKR_NFT_MINTER_BURNER_ROLE()) {
        require(_nftId > 0, Errors.MB_INVALID_NFT_ID);
        isGolden[_nftId] = _golden;
        totalMintedNfts += 1;
        emit Mint(_msgSender(), _to, _nftId, _golden);
        _safeMint(_to, _nftId);
    }

    /**
     * @notice Burns a MeldBanker NFT
     * @dev Only the BNKR_NFT_MINTER_BURNER_ROLE role can call this function
     * @param _nftId The ID of the NFT to be burned
     */
    function burn(
        uint256 _nftId
    )
        external
        override
        onlyRole(addressesProvider.BNKR_NFT_MINTER_BURNER_ROLE())
        onlyNonBlocked(_nftId)
    {
        emit Burn(_msgSender(), ownerOf(_nftId), _nftId, isGolden[_nftId]);
        _burn(_nftId);
    }

    /**
     * @notice  ADMIN: Sets the address of the MELD Staking NFT Metadata contract
     * @dev Only the PRIMARY_ADMIN_ROLE role can call this function
     * @param   _metadataAddress  Address of the MELD Staking NFT Metadata contract
     */
    function setMetadataAddress(
        address _metadataAddress
    ) external override whenNotPaused onlyRole(addressesProvider.PRIMARY_ADMIN_ROLE()) {
        require(_metadataAddress != address(0), Errors.INVALID_ADDRESS);
        emit MetadataAddressUpdated(_msgSender(), address(nftMetadata), _metadataAddress);
        nftMetadata = _metadataAddress;
    }

    /**
     * @notice  ADMIN: Updates the address of the AddressesProvider
     * @param   _addressesProvider Address of the AddressesProvider
     */
    function updateAddressesProvider(
        address _addressesProvider
    ) external override whenNotPaused onlyRole(addressesProvider.PRIMARY_ADMIN_ROLE()) {
        _updateAddressesProvider(_addressesProvider);
    }

    /**
     * @notice  Returns if an NFT currently exists in the collection
     * @dev     Extends the internal exists function from ERC721 standard
     * @param   _tokenId  NFT ID to check for existance
     * @return  bool  Returns if the NFT exists or not
     */
    function exists(uint256 _tokenId) external view override returns (bool) {
        return _exists(_tokenId);
    }

    /**
     * @notice  Returns the total number of minted NFTs
     * @dev     Uses the internal Counters to manage the active NFTs
     * @return  uint256  Returns the number of minted NFTs on the collection
     */
    function getTotalMintedNfts() external view override returns (uint256) {
        return totalMintedNfts;
    }

    /**
     * @notice  Returns all the NFTs owned by the `_owner` address
     * @param   _owner  The address to query for NFTs
     * @return  uint256[]  Returns an array of NFT IDs owned by the `_owner` address
     */
    function getAllTokensByOwner(address _owner) external view override returns (uint256[] memory) {
        uint256 tokenCount = balanceOf(_owner);
        uint256[] memory result = new uint256[](tokenCount);
        for (uint256 i = 0; i < tokenCount; i++) {
            result[i] = tokenOfOwnerByIndex(_owner, i);
        }
        return result;
    }

    /**
     * @notice Queries the MeldBanker NFT metadata contract to get the metadata of a specific NFT
     * @param _nftId The ID of the NFT
     * @return string The metadata of the NFT
     */
    function tokenURI(uint256 _nftId) public view virtual override returns (string memory) {
        require(nftMetadata != address(0), Errors.MB_METADATA_ADDRESS_NOT_SET);
        _requireMinted(_nftId);
        return IMeldBankerNFTMetadata(nftMetadata).getMetadata(_nftId);
    }

    /**
     * @notice  ADMIN: Updates the address of the AddressesProvider
     * @param   _addressesProvider Address of the AddressesProvider
     */
    function _updateAddressesProvider(address _addressesProvider) internal {
        require(_addressesProvider != address(0), Errors.INVALID_ADDRESS);
        emit AddressesProviderUpdated(_msgSender(), address(addressesProvider), _addressesProvider);
        addressesProvider = IAddressesProvider(_addressesProvider);
        address lendingPoolAddress = addressesProvider.getLendingPool();
        require(lendingPoolAddress != address(0), Errors.MB_INVALID_LENDING_POOL);
        meldBankerBlockedGetter = IMeldBankerBlocked(lendingPoolAddress);
    }

    /**
     * @notice  Transfers ownership of an NFT
     * @dev     Prevents blocked Meld Banker NFTs from being moved
     * @dev     Prevents NFTs to be sent to the zero address
     * @param   _from  Current owner of the NFT
     * @param   _to  Recepient of the transfer
     * @param   _tokenId  ID of the token to be moved
     */
    function _transfer(
        address _from,
        address _to,
        uint256 _tokenId
    ) internal override onlyNonBlocked(_tokenId) {
        // Call the original _transfer function
        super._transfer(_from, _to, _tokenId);
    }
}
