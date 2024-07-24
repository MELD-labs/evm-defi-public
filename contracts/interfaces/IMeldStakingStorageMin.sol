// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title IMeldStakingStorageMin
 * @notice This is a minimal interface for the Meld Staking Storage contract, used to get epoch information
 * @author MELD team
 */
interface IMeldStakingStorageMin {
    /**
     * @notice  Returns the duration of an epoch in seconds
     * @return  uint256  Duration of an epoch in seconds
     */
    function getEpochSize() external view returns (uint256);

    /**
     * @notice  Returns the current epoch number
     * @dev     Uses helper function to get epoch from the timestamp of the block
     * @return  uint256  Current epoch number
     */
    function getCurrentEpoch() external view returns (uint256);

    /**
     * @notice  Returns the initial timestamp of a given epoch
     * @param   _epoch  Epoch number to get the start of
     * @return  uint256  Timestamp of the start of the epoch
     */
    function getEpochStart(uint256 _epoch) external view returns (uint256);
}
