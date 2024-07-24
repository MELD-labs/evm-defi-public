// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IYieldBoostRewards} from "./IYieldBoostRewards.sol";

/**
 * @title IYieldBoostStorage interface
 * @notice This interface defines the functions and events for the storage of the yield boost staking system
 * @author MELD team
 */
interface IYieldBoostStorage {
    /////// STRUCTS ///////

    struct GlobalInfo {
        mapping(uint256 epoch => IYieldBoostRewards.Rewards rewards) rewardsPerEpoch;
        mapping(uint256 epoch => uint256 minStakedAmount) minStakedAmountPerEpoch;
        mapping(uint256 epoch => uint256 lastStakedAmount) lastStakedAmountPerEpoch;
        uint256 initTimestamp;
        uint256 epochSize;
        uint256 totalStakedAmount;
        uint256 lastEpochStakingUpdated;
        uint256 lastEpochRewardsUpdated;
    }

    struct Staker {
        mapping(uint256 epoch => uint256 minStakedAmount) minStakedAmountPerEpoch;
        mapping(uint256 epoch => uint256 lastStakedAmount) lastStakedAmountPerEpoch;
        uint256 stakedAmount;
        uint256 lastEpochStakingUpdated;
        uint256 lastEpochRewardsUpdated;
        uint256 stakingStartTimestamp;
        IYieldBoostRewards.Rewards unclaimedRewards;
        address user;
        IYieldBoostRewards.Rewards cumulativeRewards;
    }

    /////// EVENTS ///////

    /**
     * @notice  Event emitted when the contract is initialized.
     * @param   executedBy  Address that executed the configuration function
     * @param   ybStaking  Address of the YieldBoostStaking contract
     * @param   initTimestamp  Timestamp when the staking system starts
     * @param   epochSize  Duration of an epoch in seconds
     */
    event Initialized(
        address indexed executedBy,
        address indexed ybStaking,
        uint256 initTimestamp,
        uint256 epochSize
    );

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
    ) external;

    // GLOBAL INFO

    /**
     * @notice  Sets the total base amount staked in the system
     * @param   _totalStakedAmount  Total amount staked in the system
     */
    function setTotalStakedAmount(uint256 _totalStakedAmount) external;

    /**
     * @notice  Sets the total rewards for a given epoch
     * @param   _epoch  Epoch to set the rewards for
     * @param   _rewards IYieldBoostRewards.Rewards struct that contains the asset and MELD rewards for the given epoch
     */
    function setRewards(uint256 _epoch, IYieldBoostRewards.Rewards memory _rewards) external;

    /**
     * @notice  Sets the last amount staked in a given epoch
     * @param   _epoch  Epoch to set the last amount staked for
     * @param   _lastStakedAmount  Last amount staked in the given epoch
     */
    function setLastStakedAmountPerEpoch(uint256 _epoch, uint256 _lastStakedAmount) external;

    /**
     * @notice  Sets the min amount staked in a given epoch
     * @param   _epoch  Epoch to set the min amount staked for
     * @param   _minStakedAmount  Min amount staked in the given epoch
     */
    function setMinStakedAmountPerEpoch(uint256 _epoch, uint256 _minStakedAmount) external;

    /**
     * @notice  Updates the last and min staked amount of previous epochs
     * @param   _untilEpoch  Epoch to update the last and min staked amount of previous epochs until
     */
    function updateGlobalPreviousEpochs(uint256 _untilEpoch) external;

    // STAKERS

    /**
     * @notice  Creates a new staker
     * @param   _user address of the user
     */
    function createStaker(address _user) external;

    /**
     * @notice  Removes a staker
     * @param   _user address of the user
     */
    function removeStaker(address _user) external;

    /**
     * @notice  Sets the base staked amount of a staker
     * @param   _user address of the user
     * @param   _stakedAmount  Staked amount of the staker
     */
    function setStakerStakedAmount(address _user, uint256 _stakedAmount) external;

    /**
     * @notice  Sets the last epoch when the staked amount was updated for a staker
     * @param   _user address of the user
     * @param   _lastEpochStakingUpdated  Last epoch when the staked amount was updated for the staker
     */
    function setStakerLastEpochStakingUpdated(
        address _user,
        uint256 _lastEpochStakingUpdated
    ) external;

    /**
     * @notice  Sets the last epoch when the rewards were updated for a staker
     * @param   _user address of the user
     * @param   _lastEpochRewardsUpdated  Last epoch when the rewards were updated for the staker
     */
    function setStakerLastEpochRewardsUpdated(
        address _user,
        uint256 _lastEpochRewardsUpdated
    ) external;

    /**
     * @notice  Sets the unclaimed rewards of a staker
     * @param   _user address of the user
     * @param   _unclaimedRewards  Struct with the asset and MELD unclaimed rewards of the staker
     */
    function setStakerUnclaimedRewards(
        address _user,
        IYieldBoostRewards.Rewards memory _unclaimedRewards
    ) external;

    /**
     * @notice  Adds to the cumulative claimed rewards of a staker
     * @param   _user address of the user
     * @param   _claimedRewards  New asset and MELD rewards to be added to the staker
     */
    function addStakerCumulativeRewards(
        address _user,
        IYieldBoostRewards.Rewards memory _claimedRewards
    ) external;

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
    ) external;

    /**
     * @notice  Updates the staking information of a staker in previous epochs until a certain epoch
     * @param   _user  Address of the staker to update
     * @param   _untilEpoch  Epoch until the staking information will be updated
     */
    function updateStakerPreviousEpochs(address _user, uint256 _untilEpoch) external;

    /////// GETTERS ///////

    // GLOBAL INFO

    /**
     * @notice  Returns the timestamp when the staking system started
     * @return  uint256  Timestamp when the staking system started
     */
    function getInitTimestamp() external view returns (uint256);

    /**
     * @notice  Returns the duration of an epoch in seconds
     * @return  uint256  Duration of an epoch in seconds
     */
    function getEpochSize() external view returns (uint256);

    /**
     * @notice  Returns the total base amount staked in the system
     * @return  uint256  Total amount staked in the system
     */
    function getTotalStakedAmount() external view returns (uint256);

    /**
     * @notice  Returns the last epoch when the global info was updated
     * @return  uint256  Last epoch when the global info was updated
     */
    function getLastEpochStakingUpdated() external view returns (uint256);

    /**
     * @notice  Returns the last epoch when the rewards were updated
     * @return  uint256  Last epoch when the rewards were updated
     */
    function getLastEpochRewardsUpdated() external view returns (uint256);

    /**
     * @notice  Returns the total rewards for a given epoch
     * @param   _epoch  Epoch to get the rewards for
     * @return  IYieldBoostRewards.Rewards  Total rewards (in asset and MELD) for the given epoch
     */
    function getTotalRewardsPerEpoch(
        uint256 _epoch
    ) external view returns (IYieldBoostRewards.Rewards memory);

    /**
     * @notice  Returns the minimum base amount staked in a given epoch
     * @param   _epoch  Epoch to get the minimum amount staked for
     * @return  uint256  Minimum base amount staked in the given epoch
     */
    function getMinStakedAmountPerEpoch(uint256 _epoch) external view returns (uint256);

    /**
     * @notice  Returns the last amount staked in a given epoch
     * @param   _epoch  Epoch to get the last amount staked for
     * @return  uint256  Last amount staked in the given epoch
     */
    function getLastStakedAmountPerEpoch(uint256 _epoch) external view returns (uint256);

    // EPOCHS INFO

    /**
     * @notice  Returns the current epoch number
     * @dev     Uses helper function to get epoch from the timestamp of the block
     * @return  uint256  Current epoch number
     */
    function getCurrentEpoch() external view returns (uint256);

    /**
     * @notice  Returns the epoch of an arbitrary timestamp
     * @dev     Used for offchain support
     * @param   _timestamp  Timestamp in seconds since epoch (traditional CS epoch)
     * @return  uint256  Epoch number of given timestamp
     */
    function getEpoch(uint256 _timestamp) external view returns (uint256);

    /**
     * @notice  Returns the initial timestamp of a given epoch
     * @param   _epoch  Epoch number to get the start of
     * @return  uint256  Timestamp of the start of the epoch
     */
    function getEpochStart(uint256 _epoch) external view returns (uint256);

    /**
     * @notice  Returns the ending timestamp of a given epoch
     * @param   _epoch  Epoch number to get the end of
     * @return  uint256  Timestamp of the end of the epoch
     */
    function getEpochEnd(uint256 _epoch) external view returns (uint256);

    // STAKERS

    /**
     * @notice  Returns if a given address is a staker
     * @param   _user  address to check if it is a staker
     * @return  bool  Returns if the given address is a staker
     */
    function isStaker(address _user) external view returns (bool);

    /**
     * @notice  Returns the base staked amount of a staker
     * @param   _user address of the user
     * @return  uint256  Staked amount of the staker
     */
    function getStakerStakedAmount(address _user) external view returns (uint256);

    /**
     * @notice  Returns the last epoch when the staked amount was updated for a staker
     * @param   _user address of the user
     * @return  uint256  Last epoch when the staked amount was updated for the staker
     */
    function getStakerLastEpochStakingUpdated(address _user) external view returns (uint256);

    /**
     * @notice  Returns the last epoch when the rewards were updated for a staker
     * @param   _user address of the user
     * @return  uint256  Last epoch when the rewards were updated for the staker
     */
    function getStakerLastEpochRewardsUpdated(address _user) external view returns (uint256);

    /**
     * @notice  Returns the unclaimed rewards of a staker
     * @param   _user address of the user
     * @return  IYieldBoostRewards.Rewards  Unclaimed rewards of the staker
     */
    function getStakerUnclaimedRewards(
        address _user
    ) external view returns (IYieldBoostRewards.Rewards memory);

    /**
     * @notice  Returns the cumulative claimed rewards of a staker
     * @param   _user address of the user
     * @return  IYieldBoostRewards.Rewards  Cumulative claimed rewards of the staker
     */
    function getStakerCumulativeRewards(
        address _user
    ) external view returns (IYieldBoostRewards.Rewards memory);

    /**
     * @notice  Returns the timestamp when the staker started
     * @param   _user address of the user
     * @return  uint256  Timestamp when the staker started
     */
    function getStakerStakingStartTimestamp(address _user) external view returns (uint256);

    /**
     * @notice  Returns the minimum staked amount the staker had during the given epoch
     * @param   _user address of the user
     * @return  uint256  Minimum staked amount the staker had during the given epoch
     */
    function getStakerMinStakedAmountPerEpoch(
        address _user,
        uint256 _epoch
    ) external view returns (uint256);

    /**
     * @notice  Returns the last staked amount the staker had during the given epoch
     * @param   _user address of the user
     * @return  uint256  Last staked amount the staker had during the given epoch
     */
    function getStakerLastStakedAmountPerEpoch(
        address _user,
        uint256 _epoch
    ) external view returns (uint256);
}
