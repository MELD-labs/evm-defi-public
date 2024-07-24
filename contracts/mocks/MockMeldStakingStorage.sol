// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IMeldStakingStorageMin} from "../interfaces/IMeldStakingStorageMin.sol";

/**
 * @title MockMeldStakingStorage
 * @notice This Mock is used to get the epoch info for the Yield Boost tests
 * @author MELD team
 */
contract MockMeldStakingStorage is IMeldStakingStorageMin {
    uint256 public stakingInitTimestamp = 1702987200;
    uint256 public epochSize = 5 days;

    function setStakingInitTimestamp(uint256 _stakingInitTimestamp) external {
        stakingInitTimestamp = _stakingInitTimestamp;
    }

    function setEpochSize(uint256 _epochSize) external {
        epochSize = _epochSize;
    }

    function getEpochSize() external view override returns (uint256) {
        return epochSize;
    }

    function getCurrentEpoch() external view override returns (uint256) {
        return ((block.timestamp - stakingInitTimestamp) / epochSize) + 1;
    }

    function getEpochStart(uint256 _epoch) external view override returns (uint256) {
        return stakingInitTimestamp + (_epoch - 1) * epochSize;
    }
}
