// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IYieldBoostRewards} from "./IYieldBoostRewards.sol";

/**
 * @title IYieldBoostStaking interface
 * @notice This interface defines the functions and events for the staking
 * @author MELD team
 */
interface IYieldBoostStaking {
    /**
     * @notice Event emitted when the contract is initialized.
     * @param executedBy Address that executed the initialization. Should be the YieldBoostFactory
     * @param meldTokenAddress Address of the MELD token
     * @param assetAddress Address of the asset
     * @param ybStorage Address of the YieldBoostStorage
     */
    event Initialized(
        address indexed executedBy,
        address indexed meldTokenAddress,
        address indexed assetAddress,
        address ybStorage
    );

    /**
     * @notice  Event emitted when a stake position is created.
     * @param   user  Address of the staker
     * @param   amount  Amount staked
     */
    event StakePositionCreated(address indexed user, uint256 amount);

    /**
     * @notice  Event emitted when a stake position is updated.
     * @param   user  Address of the staker
     * @param   oldAmount  Old amount staked
     * @param   newAmount  New amount staked
     */
    event StakePositionUpdated(address indexed user, uint256 oldAmount, uint256 newAmount);

    /**
     * @notice  Event emitted when a stake position is removed.
     * @param   user  Address of the staker
     * @param   oldAmount  Amount staked
     */
    event StakePositionRemoved(address indexed user, uint256 oldAmount);

    /**
     * @notice  Event emitted when the unclaimed rewards of a staker are updated.
     * @param   user  Address of the staker
     * @param   oldUnclaimedAssetRewards  Old unclaimed asset rewards of the staker
     * @param   oldUnclaimedMeldRewards  Old unclaimed MELD rewards of the staker
     * @param   newUnclaimedAssetRewards  New unclaimed asset rewards of the staker
     * @param   newUnclaimedMeldRewards  New unclaimed MELD rewards of the staker
     * @param   fromEpoch  Epoch from which the rewards are updated
     * @param   toEpoch  Epoch until which the rewards are updated
     */
    event UnclaimedRewardsUpdated(
        address indexed user,
        uint256 oldUnclaimedAssetRewards,
        uint256 oldUnclaimedMeldRewards,
        uint256 newUnclaimedAssetRewards,
        uint256 newUnclaimedMeldRewards,
        uint256 fromEpoch,
        uint256 toEpoch
    );

    /**
     * @notice  Event emitted when the rewards of a staker are claimed.
     * @param   user  Address of the staker
     * @param   receiver  Address that will receive the rewards (this is used for Genius Loan)
     * @param   assetRewards  Asset rewards claimed by the staker
     * @param   meldRewards  MELD rewards claimed by the staker
     */
    event RewardsClaimed(
        address indexed user,
        address indexed receiver,
        uint256 assetRewards,
        uint256 meldRewards
    );

    /**
     * @notice  Event emitted when the rewards are set.
     * @param   executedBy  Address that executed the initialization
     * @param   epoch  Epoch of the rewards
     * @param   assetAmount  Amount of asset rewards
     * @param   meldAmount  Amount of meld rewards
     */
    event RewardsSet(
        address indexed executedBy,
        uint256 indexed epoch,
        uint256 assetAmount,
        uint256 meldAmount
    );

    /**
     * @notice  Event emitted when a token is deposited into the treasury
     * @param   token  Address of the token deposited
     * @param   from  Address that deposited the token
     * @param   amount  Amount of tokens deposited
     */
    event TokenDeposited(address indexed token, address indexed from, uint256 amount);

    /**
     * @notice  Event emitted when a token is withdrawn from the treasury
     * @param   token  Address of the token withdrawn
     * @param   to  Address that withdrew the token
     * @param   amount  Amount of tokens withdrawn
     */
    event TokenWithdrawn(address indexed token, address indexed to, uint256 amount);

    /**
     * @notice Event emitted when the position of a staker is removed from the total staked amount.
     *         This happens when a staker is removed from the staking and the rewards for a past epoch have not been set.
     *         The min and last staked amount are removed from the global position for this epoch
     * @param user Address of the staker
     * @param epoch Epoch without rewards set
     * @param minStakedAmount Minimum staked amount staked by the user in the epoch
     * @param lastStakedAmount Last staked amount staked by the user in the epoch
     */
    event StuckRewardsAvoided(
        address indexed user,
        uint256 epoch,
        uint256 minStakedAmount,
        uint256 lastStakedAmount
    );

    /**
     * @notice  Sets the YieldBoostStorage and underlying asset address
     * @param _assetAddress Address of the asset
     * @param _ybStorage Address of the YieldBoostStorage
     */
    function initialize(address _assetAddress, address _ybStorage) external;

    /**
     * @notice Sets a stake amount for the user
     * @dev If the user has no stake, a new stake position is created
     * @dev If the user has a stake, the stake position is updated
     * @dev If the stake amount is 0, the stake position is removed, claiming rewards in the process
     * @param _user Address of the staker
     * @param _amount Amount to stake
     */
    function setStakeAmount(address _user, uint256 _amount) external;

    /**
     * @notice  Sets the amount of rewards to be distributed in one epoch.
     * @dev     The signer of this transaction must be the rewards setter
     * @dev     Needs previous epochs to be "rewarded"
     * @param   _rewards  Rewarded amount in asset tokens and MELD tokens with all decimals
     * @param   _epoch  Epoch to distribute rewards to
     */
    function setRewards(IYieldBoostRewards.Rewards memory _rewards, uint256 _epoch) external;

    /**
     * @notice  Claims the rewards of the staker
     * @dev     The rewards are updated before claiming them
     * @dev     The rewards are sent to the msg.sender
     */
    function claimRewards() external;

    /**
     * @notice  Claims the rewards of a staker
     * @param   _user  Address of the staker
     * @dev     The rewards are updated before claiming them
     * @dev     The rewards are sent to the msg.sender
     * @dev     Only callable by an address with the Genius Loan role
     * @dev     The user must have acceped the Genius Loan beforehand
     */
    function claimRewardsOnBehalfOf(address _user) external;

    /**
     * @notice  Updates the unclaimed rewards of a staker
     * @param   _user  Address of the staker to update
     */
    function updateUnclaimedRewards(
        address _user
    ) external returns (IYieldBoostRewards.Rewards memory);

    /**
     * @notice  Updates the staking information of a staker in previous epochs
     * @param   _user  Address of the staker to update
     */
    function updateStakerPreviousEpochs(address _user) external;

    /**
     * @notice  Updates the staking information of a staker in previous epochs until a certain epoch
     * @param   _user  Address of the staker to update
     * @param   _untilEpoch  Epoch until the staking information will be updated
     */
    function updateStakerPreviousEpochs(address _user, uint256 _untilEpoch) external;

    /**
     * @notice  Updates the last and min staked amount of previous epochs
     * @param   _untilEpoch  Epoch to update the last and min staked amount of previous epochs until
     */
    function updateGlobalPreviousEpochs(uint256 _untilEpoch) external;

    /**
     * @notice Returns the address of the MELD token
     * @return address Address of the MELD token
     */
    function meldTokenAddress() external view returns (address);

    /**
     * @notice Returns the address of the asset
     * @return address Address of the asset
     */
    function assetAddress() external view returns (address);

    /**
     * @notice Returns the address of the YieldBoostStorage
     * @return address Address of the YieldBoostStorage
     */
    function yieldBoostStorageAddress() external view returns (address);
}
