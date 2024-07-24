// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title IYieldBoostStakingMinimal interface
 * @notice This interface includes only the IYieldBoostStakingM functions needed by the lending and borrowing contracts
 * @author MELD team
 */
interface IYieldBoostStakingMinimal {
    /**
     * @notice Sets a stake amount for the user
     * @dev If the user has no stake, a new stake position is created
     * @dev If the user has a stake, the stake position is updated
     * @dev If the stake amount is 0, the stake position is removed, claiming rewards in the process
     * @param _user Address of the staker
     * @param _amount Amount to stake
     */
    function setStakeAmount(address _user, uint256 _amount) external;
}
