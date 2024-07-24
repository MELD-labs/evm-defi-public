// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {
    IYieldBoostStorage,
    IYieldBoostRewards
} from "../interfaces/yield-boost/IYieldBoostStorage.sol";
import {YieldBoostRewardsLibrary} from "../libraries/yield-boost/YieldBoostRewardsLibrary.sol";
import {Errors} from "../libraries/helpers/Errors.sol";

/**
 * @title YieldBoostStorage
 * @notice This contract will hold the staking information and the global info of the yield boost staking system
 * @author MELD team
 */
contract YieldBoostStorage is IYieldBoostStorage {
    using YieldBoostRewardsLibrary for IYieldBoostRewards.Rewards;

    address private ybStakingAddress;

    GlobalInfo private globalInfo;

    mapping(address user => Staker) private stakers;

    /**
     * @notice Only callable by YieldBoostStaking
     */
    modifier onlyValidYBStaking() {
        require(ybStakingAddress == msg.sender, Errors.YB_ONLY_YB_STAKING);
        _;
    }

    /////// SETTERS ///////

    // GENERAL

    /**
     * @notice  Called from the YieldBoostFactory contract to set the initial values of the staking system
     * @param   _initTimestamp  Timestamp when the staking system starts
     * @param   _epochSize  Duration of an epoch in seconds
     * @param   _ybStakingAddress  Address of the YieldBoostStaking contract
     */
    function initialize(
        uint256 _initTimestamp,
        uint256 _epochSize,
        address _ybStakingAddress
    ) external override {
        require(ybStakingAddress == address(0), Errors.YB_ALREADY_INITIALIZED);
        require(_initTimestamp + _epochSize > block.timestamp, Errors.YB_INVALID_INIT_TIMESTAMP);
        globalInfo.initTimestamp = _initTimestamp;
        globalInfo.epochSize = _epochSize;
        globalInfo.lastEpochRewardsUpdated = 1; // Set to 1 since epoch 1 will not have rewards
        ybStakingAddress = _ybStakingAddress;

        emit Initialized(msg.sender, _ybStakingAddress, _initTimestamp, _epochSize);
    }

    // GLOBAL INFO

    /**
     * @notice  Sets the total base amount staked in the system
     * @param   _totalStakedAmount  Total amount staked in the system
     */
    function setTotalStakedAmount(uint256 _totalStakedAmount) external override onlyValidYBStaking {
        globalInfo.totalStakedAmount = _totalStakedAmount;
    }

    /**
     * @notice  Sets the total rewards for a given epoch
     * @param   _epoch  Epoch to set the rewards for
     * @param   _rewards Rewards struct that contains the asset and MELD rewards for the given epoch
     */
    function setRewards(
        uint256 _epoch,
        IYieldBoostRewards.Rewards memory _rewards
    ) external override onlyValidYBStaking {
        globalInfo.rewardsPerEpoch[_epoch] = _rewards;
        _updateGlobalPreviousEpochs(_epoch);
        globalInfo.lastEpochRewardsUpdated = _epoch;
    }

    /**
     * @notice  Sets the last amount staked in a given epoch
     * @param   _epoch  Epoch to set the last amount staked for
     * @param   _lastStakedAmount  Last amount staked in the given epoch
     */
    function setLastStakedAmountPerEpoch(
        uint256 _epoch,
        uint256 _lastStakedAmount
    ) external override onlyValidYBStaking {
        globalInfo.lastStakedAmountPerEpoch[_epoch] = _lastStakedAmount;
    }

    /**
     * @notice  Sets the min amount staked in a given epoch
     * @param   _epoch  Epoch to set the min amount staked for
     * @param   _minStakedAmount  Min amount staked in the given epoch
     */
    function setMinStakedAmountPerEpoch(
        uint256 _epoch,
        uint256 _minStakedAmount
    ) external override onlyValidYBStaking {
        globalInfo.minStakedAmountPerEpoch[_epoch] = _minStakedAmount;
    }

    /**
     * @notice  Updates the last and min staked amount of previous epochs
     * @param   _untilEpoch  Epoch to update the last and min staked amount of previous epochs until
     */
    function updateGlobalPreviousEpochs(uint256 _untilEpoch) external override onlyValidYBStaking {
        _updateGlobalPreviousEpochs(_untilEpoch);
    }

    // STAKERS

    /**
     * @notice  Creates a new staker
     * @param   _user address of the user
     */
    function createStaker(address _user) external override onlyValidYBStaking {
        uint256 currentEpoch = getCurrentEpoch();
        Staker storage staker = stakers[_user];
        staker.lastEpochStakingUpdated = currentEpoch;
        staker.lastEpochRewardsUpdated = currentEpoch;
        staker.stakingStartTimestamp = block.timestamp;
    }

    /**
     * @notice  Removes a staker
     * @param   _user address of the user
     */
    function removeStaker(address _user) external override onlyValidYBStaking {
        delete stakers[_user];
    }

    /**
     * @notice  Sets the base staked amount of a staker
     * @param   _user address of the user
     * @param   _stakedAmount  Staked amount of the staker
     */
    function setStakerStakedAmount(
        address _user,
        uint256 _stakedAmount
    ) external override onlyValidYBStaking {
        stakers[_user].stakedAmount = _stakedAmount;
    }

    /**
     * @notice  Sets the last epoch when the staked amount was updated for a staker
     * @param   _user address of the user
     * @param   _lastEpochStakingUpdated  Last epoch when the staked amount was updated for the staker
     */
    function setStakerLastEpochStakingUpdated(
        address _user,
        uint256 _lastEpochStakingUpdated
    ) external override onlyValidYBStaking {
        stakers[_user].lastEpochStakingUpdated = _lastEpochStakingUpdated;
    }

    /**
     * @notice  Sets the last epoch when the rewards were updated for a staker
     * @param   _user address of the user
     * @param   _lastEpochRewardsUpdated  Last epoch when the rewards were updated for the staker
     */
    function setStakerLastEpochRewardsUpdated(
        address _user,
        uint256 _lastEpochRewardsUpdated
    ) external override onlyValidYBStaking {
        stakers[_user].lastEpochRewardsUpdated = _lastEpochRewardsUpdated;
    }

    /**
     * @notice  Sets the unclaimed rewards of a staker
     * @param   _user address of the user
     * @param   _unclaimedRewards  Struct with the asset and MELD unclaimed rewards of the staker
     */
    function setStakerUnclaimedRewards(
        address _user,
        IYieldBoostRewards.Rewards memory _unclaimedRewards
    ) external override onlyValidYBStaking {
        stakers[_user].unclaimedRewards = _unclaimedRewards;
    }

    /**
     * @notice  Adds to the cumulative claimed rewards of a staker
     * @param   _user address of the user
     * @param   _claimedRewards  New asset and MELD rewards to be added to the staker
     */
    function addStakerCumulativeRewards(
        address _user,
        IYieldBoostRewards.Rewards memory _claimedRewards
    ) external override onlyValidYBStaking {
        stakers[_user].cumulativeRewards = stakers[_user].cumulativeRewards.add(_claimedRewards);
    }

    /**
     * @notice  Sets the last staked amount the staker had during the given epoch
     * @param   _user address of the user
     * @param   _epoch  Epoch to set the last staked amount
     * @param   _lastStakedAmount  Last staked amount the staker had during the given epoch
     */
    function setStakerLastStakedAmountPerEpoch(
        address _user,
        uint256 _epoch,
        uint256 _lastStakedAmount
    ) external override onlyValidYBStaking {
        stakers[_user].lastStakedAmountPerEpoch[_epoch] = _lastStakedAmount;

        if (_lastStakedAmount < stakers[_user].minStakedAmountPerEpoch[_epoch]) {
            stakers[_user].minStakedAmountPerEpoch[_epoch] = _lastStakedAmount;
        }
    }

    /**
     * @notice  Updates the staking information of a staker in previous epochs until a certain epoch
     * @param   _user  Address of the staker to update
     * @param   _untilEpoch  Epoch until the staking information will be updated
     */
    function updateStakerPreviousEpochs(
        address _user,
        uint256 _untilEpoch
    ) external override onlyValidYBStaking {
        Staker storage staker = stakers[_user];
        uint256 lastEpochUpdated = staker.lastEpochStakingUpdated;
        if (lastEpochUpdated >= _untilEpoch) {
            return;
        }
        uint256 rollingAmount = staker.lastStakedAmountPerEpoch[lastEpochUpdated];

        for (uint256 epoch = lastEpochUpdated + 1; epoch <= _untilEpoch; epoch++) {
            staker.lastStakedAmountPerEpoch[epoch] = rollingAmount;
            staker.minStakedAmountPerEpoch[epoch] = rollingAmount;
        }
        staker.lastEpochStakingUpdated = _untilEpoch;
    }

    /////// GETTERS ///////

    // GLOBAL INFO

    /**
     * @notice  Returns the timestamp when the staking system started
     * @return  uint256  Timestamp when the staking system started
     */
    function getInitTimestamp() external view override returns (uint256) {
        return globalInfo.initTimestamp;
    }

    /**
     * @notice  Returns the duration of an epoch in seconds
     * @return  uint256  Duration of an epoch in seconds
     */
    function getEpochSize() external view override returns (uint256) {
        return globalInfo.epochSize;
    }

    /**
     * @notice  Returns the total base amount staked in the system
     * @return  uint256  Total amount staked in the system
     */
    function getTotalStakedAmount() external view override returns (uint256) {
        return globalInfo.totalStakedAmount;
    }

    /**
     * @notice  Returns the last epoch when the global info was updated
     * @return  uint256  Last epoch when the global info was updated
     */
    function getLastEpochStakingUpdated() external view override returns (uint256) {
        return globalInfo.lastEpochStakingUpdated;
    }

    /**
     * @notice  Returns the last epoch when the rewards were updated
     * @return  uint256  Last epoch when the rewards were updated
     */
    function getLastEpochRewardsUpdated() external view override returns (uint256) {
        return globalInfo.lastEpochRewardsUpdated;
    }

    /**
     * @notice  Returns the total rewards for a given epoch
     * @param   _epoch  Epoch to get the rewards for
     * @return  Rewards  Total rewards (in asset and MELD) for the given epoch
     */
    function getTotalRewardsPerEpoch(
        uint256 _epoch
    ) external view override returns (IYieldBoostRewards.Rewards memory) {
        return globalInfo.rewardsPerEpoch[_epoch];
    }

    /**
     * @notice  Returns the minimum base amount staked in a given epoch
     * @param   _epoch  Epoch to get the minimum amount staked for
     * @return  uint256  Minimum base amount staked in the given epoch
     */
    function getMinStakedAmountPerEpoch(uint256 _epoch) external view override returns (uint256) {
        return globalInfo.minStakedAmountPerEpoch[_epoch];
    }

    /**
     * @notice  Returns the last amount staked in a given epoch
     * @param   _epoch  Epoch to get the last amount staked for
     * @return  uint256  Last amount staked in the given epoch
     */
    function getLastStakedAmountPerEpoch(uint256 _epoch) external view override returns (uint256) {
        return globalInfo.lastStakedAmountPerEpoch[_epoch];
    }

    // EPOCHS INFO

    /**
     * @notice  Returns the current epoch number
     * @dev     Uses helper function to get epoch from the timestamp of the block
     * @return  uint256  Current epoch number
     */
    function getCurrentEpoch() public view override returns (uint256) {
        return getEpoch(block.timestamp);
    }

    /**
     * @notice  Returns the epoch of an arbitrary timestamp
     * @dev     Used for offchain support
     * @param   _timestamp  Timestamp in seconds since epoch (traditional CS epoch)
     * @return  uint256  Epoch number of given timestamp
     */
    function getEpoch(uint256 _timestamp) public view override returns (uint256) {
        if (globalInfo.initTimestamp == 0 || _timestamp < globalInfo.initTimestamp) {
            return 0;
        }
        return ((_timestamp - globalInfo.initTimestamp) / globalInfo.epochSize) + 1;
    }

    /**
     * @notice  Returns the initial timestamp of a given epoch
     * @param   _epoch  Epoch number to get the start of
     * @return  uint256  Timestamp of the start of the epoch
     */
    function getEpochStart(uint256 _epoch) external view override returns (uint256) {
        if (globalInfo.initTimestamp == 0 || _epoch == 0) {
            return 0;
        }
        return globalInfo.initTimestamp + ((_epoch - 1) * globalInfo.epochSize);
    }

    /**
     * @notice  Returns the ending timestamp of a given epoch
     * @param   _epoch  Epoch number to get the end of
     * @return  uint256  Timestamp of the end of the epoch
     */
    function getEpochEnd(uint256 _epoch) external view override returns (uint256) {
        if (globalInfo.initTimestamp == 0 || _epoch == 0) {
            return 0;
        }
        return globalInfo.initTimestamp + (_epoch * globalInfo.epochSize);
    }

    // STAKERS

    /**
     * @notice  Returns if a given address is a staker
     * @param   _user  address to check if it is a staker
     * @return  bool  Returns if the given address is a staker
     */
    function isStaker(address _user) external view override returns (bool) {
        return stakers[_user].stakedAmount > 0;
    }

    /**
     * @notice  Returns the base staked amount of a staker
     * @param   _user address of the user
     * @return  uint256  Staked amount of the staker
     */
    function getStakerStakedAmount(address _user) external view override returns (uint256) {
        return stakers[_user].stakedAmount;
    }

    /**
     * @notice  Returns the last epoch when the staked amount was updated for a staker
     * @param   _user address of the user
     * @return  uint256  Last epoch when the staked amount was updated for the staker
     */
    function getStakerLastEpochStakingUpdated(
        address _user
    ) external view override returns (uint256) {
        return stakers[_user].lastEpochStakingUpdated;
    }

    /**
     * @notice  Returns the last epoch when the rewards were updated for a staker
     * @param   _user address of the user
     * @return  uint256  Last epoch when the rewards were updated for the staker
     */
    function getStakerLastEpochRewardsUpdated(
        address _user
    ) external view override returns (uint256) {
        return stakers[_user].lastEpochRewardsUpdated;
    }

    /**
     * @notice  Returns the unclaimed rewards of a staker
     * @param   _user address of the user
     * @return  Rewards  Unclaimed rewards of the staker
     */
    function getStakerUnclaimedRewards(
        address _user
    ) external view override returns (IYieldBoostRewards.Rewards memory) {
        return stakers[_user].unclaimedRewards;
    }

    /**
     * @notice  Returns the cumulative claimed rewards of a staker
     * @param   _user address of the user
     * @return  Rewards  Cumulative claimed rewards of the staker
     */
    function getStakerCumulativeRewards(
        address _user
    ) external view override returns (IYieldBoostRewards.Rewards memory) {
        return stakers[_user].cumulativeRewards;
    }

    /**
     * @notice  Returns the timestamp when the staker started
     * @param   _user address of the user
     * @return  uint256  Timestamp when the staker started
     */
    function getStakerStakingStartTimestamp(
        address _user
    ) external view override returns (uint256) {
        return stakers[_user].stakingStartTimestamp;
    }

    /**
     * @notice  Returns the minimum staked amount the staker had during the given epoch
     * @param   _user address of the user
     * @return  uint256  Minimum staked amount the staker had during the given epoch
     */
    function getStakerMinStakedAmountPerEpoch(
        address _user,
        uint256 _epoch
    ) external view override returns (uint256) {
        return stakers[_user].minStakedAmountPerEpoch[_epoch];
    }

    /**
     * @notice  Returns the last staked amount the staker had during the given epoch
     * @param   _user address of the user
     * @return  uint256  Last staked amount the staker had during the given epoch
     */
    function getStakerLastStakedAmountPerEpoch(
        address _user,
        uint256 _epoch
    ) external view override returns (uint256) {
        return stakers[_user].lastStakedAmountPerEpoch[_epoch];
    }

    /////// PRIVATE ///////

    /**
     * @notice  Updates the last and min staked amount of previous epochs
     * @param   _untilEpoch  Epoch to update the last and min staked amount of previous epochs until
     */
    function _updateGlobalPreviousEpochs(uint256 _untilEpoch) private {
        if (globalInfo.lastEpochStakingUpdated >= _untilEpoch) {
            return;
        }
        uint256 rollingAmount = globalInfo.lastStakedAmountPerEpoch[
            globalInfo.lastEpochStakingUpdated
        ];
        for (
            uint256 epoch = globalInfo.lastEpochStakingUpdated + 1;
            epoch <= _untilEpoch;
            epoch++
        ) {
            globalInfo.lastStakedAmountPerEpoch[epoch] = rollingAmount;
            globalInfo.minStakedAmountPerEpoch[epoch] = rollingAmount;
        }
        globalInfo.lastEpochStakingUpdated = _untilEpoch;
    }
}
