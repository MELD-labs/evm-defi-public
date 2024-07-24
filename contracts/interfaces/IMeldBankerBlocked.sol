// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title IMeldBankerBlocked interface
 * @notice This defines a function to check if a Meld Banker NFT is blocked in the protocol
 * @author MELD team
 */
interface IMeldBankerBlocked {
    /**
     * @notice Checks if a MeldBanker NFT is blocked in the protocol
     * @dev If the NFT is used to boost supply or discount borrowing, it is blocked and cannot be transferred or used
     * @param _nftId The ID of the NFT
     * @return bool True if it is a golden Meld Banker
     */
    function isMeldBankerBlocked(uint256 _nftId) external view returns (bool);
}
