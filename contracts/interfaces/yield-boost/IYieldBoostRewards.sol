// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title IYieldBoostRewards interface
 * @notice Contains the struct for rewards
 * @author MELD team
 */
interface IYieldBoostRewards {
    struct Rewards {
        uint256 assetRewards;
        uint256 meldRewards;
    }
}
