// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IYieldBoostStaking} from "../interfaces/yield-boost/IYieldBoostStaking.sol";

/**
 * @title MockYBCaller
 * @notice This Mock only exists to test the YieldBoostStaking contract
 * @dev This contract is used to simulate the LendingPool, always returning true for `reserveExists()`
 * and acting as a middle contract to call `setStakeAmount()` in the YieldBoostStaking contract
 * @author MELD team
 */
contract MockYBCaller {
    IYieldBoostStaking public ybStaking;

    function setYBStakingAddress(address _ybStaking) external {
        ybStaking = IYieldBoostStaking(_ybStaking);
    }

    function reserveExists(address) external pure returns (bool) {
        return true;
    }

    function setStakeAmount(address _user, uint256 _amount) external {
        ybStaking.setStakeAmount(_user, _amount);
    }
}
