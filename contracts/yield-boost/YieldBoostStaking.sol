// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {LendingBase, IAddressesProvider} from "../base/LendingBase.sol";
import {YieldBoostRewardsLibrary} from "../libraries/yield-boost/YieldBoostRewardsLibrary.sol";
import {Errors} from "../libraries/helpers/Errors.sol";
import {
    IYieldBoostStaking,
    IYieldBoostRewards
} from "../interfaces/yield-boost/IYieldBoostStaking.sol";
import {IYieldBoostStorage} from "../interfaces/yield-boost/IYieldBoostStorage.sol";
import {IMeldProtocolDataProvider} from "../interfaces/IMeldProtocolDataProvider.sol";

/**
 * @title YieldBoostStaking
 * @notice This contract will handle the staking of the users
 * @author MELD team
 */
contract YieldBoostStaking is IYieldBoostStaking, LendingBase {
    using YieldBoostRewardsLibrary for IYieldBoostRewards.Rewards;
    using SafeERC20 for IERC20;

    address private immutable addressesProviderAddress;
    IYieldBoostStorage private ybStorage;
    IMeldProtocolDataProvider private dataProvider;

    IERC20 private meldToken;
    IERC20 private assetToken;

    /**
     * @notice  Checks if the user corresponds to a staker
     * @param   _user  user to check
     */
    modifier isStaker(address _user) {
        require(ybStorage.isStaker(_user), Errors.YB_STAKER_DOES_NOT_EXIST);
        _;
    }

    /**
     * @notice Constructor of the contract
     * @dev Sets the address of the YieldBoostFactory
     * @param _addressesProvider Address of the Lending&Borrowing addresses provider
     */
    constructor(address _addressesProvider) {
        addressesProviderAddress = _addressesProvider;
    }

    /**
     * @notice  Sets the YieldBoostStorage and underlying asset address
     * @param _assetAddress Address of the asset
     * @param _ybStorage Address of the YieldBoostStorage
     */
    function initialize(address _assetAddress, address _ybStorage) external override {
        require(address(ybStorage) == address(0), Errors.YB_ALREADY_INITIALIZED);
        require(_assetAddress != address(0), Errors.INVALID_ADDRESS);
        require(_ybStorage != address(0), Errors.INVALID_ADDRESS);

        addressesProvider = IAddressesProvider(addressesProviderAddress);
        dataProvider = IMeldProtocolDataProvider(addressesProvider.getProtocolDataProvider());

        require(dataProvider.reserveExists(_assetAddress), Errors.YB_INVALID_ASSET);

        address meldTokenAddress_ = addressesProvider.getMeldToken();
        require(meldTokenAddress_ != address(0), Errors.YB_INVALID_MELD_TOKEN);

        meldToken = IERC20(meldTokenAddress_);
        assetToken = IERC20(_assetAddress);

        ybStorage = IYieldBoostStorage(_ybStorage);

        emit Initialized(msg.sender, meldTokenAddress_, _assetAddress, _ybStorage);
    }

    /**
     * @notice Sets a stake amount for the user
     * @dev If the user has no stake, a new stake position is created
     * @dev If the user has a stake, the stake position is updated
     * @dev If the stake amount is 0, the stake position is removed, claiming rewards in the process
     * @param _user Address of the staker
     * @param _amount New amount of the stake position
     */
    function setStakeAmount(
        address _user,
        uint256 _amount
    ) external override onlyRole(addressesProvider.LENDING_POOL_ROLE()) {
        uint256 currentStake = ybStorage.getStakerStakedAmount(_user);
        uint256 currentEpoch = ybStorage.getCurrentEpoch();

        updateGlobalPreviousEpochs(currentEpoch);
        if (currentStake == 0) {
            if (_amount == 0) {
                // Nothing should happen
                return;
            }
            // Create stake position
            ybStorage.createStaker(_user);
            emit StakePositionCreated(_user, _amount);
        } else {
            updateStakerPreviousEpochs(_user, currentEpoch);

            if (_amount == 0) {
                // Remove stake position
                _redeemPosition(_user, currentStake);
                return;
            }
        }
        // Update stake position
        _updateStakerStakedAmount(_user, currentStake, _amount, currentEpoch);

        emit StakePositionUpdated(_user, currentStake, _amount);
    }

    /**
     * @notice  Sets the amount of rewards to be distributed in one epoch.
     * @dev     The signer of this transaction must be the rewards setter
     * @dev     Needs previous epochs to be "rewarded"
     * @param   _rewards  Rewarded amount in asset tokens and MELD tokens with all decimals
     * @param   _epoch  Epoch to distribute rewards to
     */
    function setRewards(
        IYieldBoostRewards.Rewards memory _rewards,
        uint256 _epoch
    ) external override whenNotPaused onlyRole(addressesProvider.YB_REWARDS_SETTER_ROLE()) {
        require(
            _epoch == ybStorage.getLastEpochRewardsUpdated() + 1,
            Errors.YB_REWARDS_INVALID_EPOCH
        );
        require(_epoch < ybStorage.getCurrentEpoch(), Errors.YB_REWARDS_CURRENT_OR_FUTURE_EPOCH);
        require(!_rewards.isEmpty(), Errors.YB_REWARDS_INVALID_AMOUNT);
        ybStorage.setRewards(_epoch, _rewards);

        _deposit(assetToken, msg.sender, _rewards.assetRewards);
        _deposit(meldToken, msg.sender, _rewards.meldRewards);

        emit RewardsSet(msg.sender, _epoch, _rewards.assetRewards, _rewards.meldRewards);
    }

    /**
     * @notice  Claims the rewards of the staker
     * @dev     The rewards are updated before claiming them
     * @dev     The rewards are sent to the msg.sender
     */
    function claimRewards() external override whenNotPaused {
        _claimRewards(msg.sender, msg.sender);
    }

    /**
     * @notice  Claims the rewards of a staker
     * @param   _user  Address of the staker
     * @dev     The rewards are updated before claiming them
     * @dev     The rewards are sent to the msg.sender
     * @dev     Only callable by an address with the Genius Loan role
     * @dev     The user must have acceped the Genius Loan beforehand
     */
    function claimRewardsOnBehalfOf(
        address _user
    ) external override whenNotPaused onlyRole(addressesProvider.GENIUS_LOAN_ROLE()) {
        require(
            dataProvider.isUserAcceptingGeniusLoan(_user),
            Errors.YB_USER_NOT_ACCEPT_GENIUS_LOAN
        );
        _claimRewards(_user, msg.sender);
    }

    /**
     * @notice  Updates the staking information of a staker in previous epochs
     * @param   _user  address of the staker to update
     */
    function updateStakerPreviousEpochs(address _user) external override {
        uint256 currentEpoch = ybStorage.getCurrentEpoch();
        updateStakerPreviousEpochs(_user, currentEpoch);
    }

    /**
     * @notice Returns the address of the MELD token
     * @return address Address of the MELD token
     */
    function meldTokenAddress() external view override returns (address) {
        return address(meldToken);
    }

    /**
     * @notice Returns the address of the asset
     * @return address Address of the asset
     */
    function assetAddress() external view override returns (address) {
        return address(assetToken);
    }

    /**
     * @notice Returns the address of the YieldBoostStorage
     * @return address Address of the YieldBoostStorage
     */
    function yieldBoostStorageAddress() external view override returns (address) {
        return address(ybStorage);
    }

    /**
     * @notice  Updates the staking information of a staker in previous epochs until a certain epoch
     * @param   _user  address of the staker to update
     * @param   _untilEpoch  Epoch until the staking information will be updated
     */
    function updateStakerPreviousEpochs(
        address _user,
        uint256 _untilEpoch
    ) public override whenNotPaused isStaker(_user) {
        uint256 currentEpoch = ybStorage.getCurrentEpoch();
        require(_untilEpoch <= currentEpoch, Errors.YB_INVALID_EPOCH);
        ybStorage.updateStakerPreviousEpochs(_user, _untilEpoch);
    }

    /**
     * @notice  Updates the last and min staked amount of previous epochs
     * @param   _untilEpoch  Epoch to update the last and min staked amount of previous epochs until
     */
    function updateGlobalPreviousEpochs(uint256 _untilEpoch) public override whenNotPaused {
        uint256 currentEpoch = ybStorage.getCurrentEpoch();
        require(_untilEpoch <= currentEpoch, Errors.YB_INVALID_EPOCH);
        ybStorage.updateGlobalPreviousEpochs(_untilEpoch);
    }

    /**
     * @notice  Updates the unclaimed rewards of a staker
     * @param   _user  address of the staker to update
     */
    function updateUnclaimedRewards(
        address _user
    ) public override whenNotPaused isStaker(_user) returns (IYieldBoostRewards.Rewards memory) {
        uint256 currentEpoch = ybStorage.getCurrentEpoch();
        ybStorage.updateStakerPreviousEpochs(_user, currentEpoch);
        ybStorage.updateGlobalPreviousEpochs(currentEpoch);

        uint256 stakerLastEpochRewardsUpdated = ybStorage.getStakerLastEpochRewardsUpdated(_user);
        uint256 fromEpoch = stakerLastEpochRewardsUpdated == 0
            ? 2
            : stakerLastEpochRewardsUpdated + 1;
        IYieldBoostRewards.Rewards memory oldUnclaimedRewards = ybStorage.getStakerUnclaimedRewards(
            _user
        );
        uint256 calculateUntilEpoch = ybStorage.getLastEpochRewardsUpdated();

        if (fromEpoch > calculateUntilEpoch) {
            return oldUnclaimedRewards;
        }

        IYieldBoostRewards.Rewards memory newUnclaimedRewards = oldUnclaimedRewards;

        for (uint256 epoch = fromEpoch; epoch <= calculateUntilEpoch; epoch++) {
            uint256 stakerMinStakedAmountEpoch = ybStorage.getStakerMinStakedAmountPerEpoch(
                _user,
                epoch
            );
            uint256 globalMinStakedAmountEpoch = ybStorage.getMinStakedAmountPerEpoch(epoch);
            IYieldBoostRewards.Rewards memory totalRewardsEpoch = ybStorage.getTotalRewardsPerEpoch(
                epoch
            );
            IYieldBoostRewards.Rewards memory newRewardsEpoch = totalRewardsEpoch
                .scalarMul(stakerMinStakedAmountEpoch)
                .scalarDiv(globalMinStakedAmountEpoch);
            newUnclaimedRewards = newUnclaimedRewards.add(newRewardsEpoch);
        }

        ybStorage.setStakerUnclaimedRewards(_user, newUnclaimedRewards);
        ybStorage.setStakerLastEpochRewardsUpdated(_user, calculateUntilEpoch);
        emit UnclaimedRewardsUpdated(
            _user,
            oldUnclaimedRewards.assetRewards,
            oldUnclaimedRewards.meldRewards,
            newUnclaimedRewards.assetRewards,
            newUnclaimedRewards.meldRewards,
            fromEpoch,
            calculateUntilEpoch
        );
        return newUnclaimedRewards;
    }

    /**
     * @notice Claims the rewards of a staker
     * @param _user Address of the staker
     * @param _receiver Address that will receive the rewards (this is used for Genius Loan)
     */
    function _claimRewards(address _user, address _receiver) private isStaker(_user) {
        IYieldBoostRewards.Rewards memory unclaimedRewards = updateUnclaimedRewards(_user);

        if (unclaimedRewards.isEmpty()) {
            return;
        }

        ybStorage.setStakerUnclaimedRewards(_user, IYieldBoostRewards.Rewards(0, 0));
        ybStorage.addStakerCumulativeRewards(_user, unclaimedRewards);

        _withdraw(assetToken, _receiver, unclaimedRewards.assetRewards);
        _withdraw(meldToken, _receiver, unclaimedRewards.meldRewards);

        emit RewardsClaimed(
            _user,
            _receiver,
            unclaimedRewards.assetRewards,
            unclaimedRewards.meldRewards
        );
    }

    /**
     * @notice Deposit tokens into the treasury
     * @param _token Address of the token to deposit
     * @param _from Address that deposited the token
     * @param _amount Amount of tokens deposited
     */
    function _deposit(IERC20 _token, address _from, uint256 _amount) private {
        if (_amount > 0) {
            _token.safeTransferFrom(_from, address(this), _amount);
            emit TokenDeposited(address(_token), _from, _amount);
        }
    }

    /**
     * @notice Withdraw tokens from the treasury
     * @param _token Address of the token to withdraw
     * @param _to Address that withdrew the token
     * @param _amount Amount of tokens withdrawn
     */
    function _withdraw(IERC20 _token, address _to, uint256 _amount) private {
        if (_amount > 0) {
            _token.safeTransfer(_to, _amount);
            emit TokenWithdrawn(address(_token), _to, _amount);
        }
    }

    /**
     * @notice Redeem the stake position of a user
     * @param _user Address of the staker
     * @param _currentStake Current stake amount of the staker
     */
    function _redeemPosition(address _user, uint256 _currentStake) private {
        emit StakePositionUpdated(_user, _currentStake, 0);
        emit StakePositionRemoved(_user, _currentStake);
        uint256 currentEpoch = ybStorage.getCurrentEpoch();

        // Claim rewards
        _claimRewards(_user, _user);

        // Manage stuck rewards
        _manageStuckRewards(_user, currentEpoch);

        // Update stake position
        _updateStakerStakedAmount(_user, _currentStake, 0, currentEpoch);

        // Remove stake position
        ybStorage.removeStaker(_user);
    }

    /**
     * @notice Update the stake position of a user and the global staked amount
     * @param _user Address of the staker
     * @param _currentStake Current stake amount of the staker
     * @param _newAmount New stake amount of the staker
     * @param _currentEpoch Current epoch
     */
    function _updateStakerStakedAmount(
        address _user,
        uint256 _currentStake,
        uint256 _newAmount,
        uint256 _currentEpoch
    ) private {
        uint256 beforeUserMinStakedAmount = ybStorage.getStakerMinStakedAmountPerEpoch(
            _user,
            _currentEpoch
        );
        ybStorage.setStakerStakedAmount(_user, _newAmount);
        ybStorage.setStakerLastStakedAmountPerEpoch(_user, _currentEpoch, _newAmount);
        ybStorage.setStakerLastEpochStakingUpdated(_user, _currentEpoch);

        uint256 currentGlobalStakedAmount = ybStorage.getTotalStakedAmount();
        require(
            currentGlobalStakedAmount == ybStorage.getLastStakedAmountPerEpoch(_currentEpoch),
            Errors.YB_INCONSISTENT_STATE
        );

        if (_currentStake > _newAmount) {
            // Decrease
            uint256 diff = _currentStake - _newAmount;
            ybStorage.setTotalStakedAmount(currentGlobalStakedAmount - diff);
            ybStorage.setLastStakedAmountPerEpoch(_currentEpoch, currentGlobalStakedAmount - diff);

            uint256 afterUserMinStakedAmount = ybStorage.getStakerMinStakedAmountPerEpoch(
                _user,
                _currentEpoch
            );
            // Decrease global min, if user's min has been reduced
            if (afterUserMinStakedAmount < beforeUserMinStakedAmount) {
                ybStorage.setMinStakedAmountPerEpoch(
                    _currentEpoch,
                    ybStorage.getMinStakedAmountPerEpoch(_currentEpoch) -
                        (beforeUserMinStakedAmount - afterUserMinStakedAmount)
                );
            }
        } else {
            // Increase
            uint256 diff = _newAmount - _currentStake;
            ybStorage.setTotalStakedAmount(currentGlobalStakedAmount + diff);
            ybStorage.setLastStakedAmountPerEpoch(_currentEpoch, currentGlobalStakedAmount + diff);
        }
    }

    /**
     * @notice Removes the last and min staked amount from the staker of epochs that should have received rewards
     *         Also decreases the global last and min staked amount of these epochs
     * @param _user Address of the staker
     * @param _currentEpoch Current epoch
     */
    function _manageStuckRewards(address _user, uint256 _currentEpoch) private {
        uint256 lastEpochRewardsSet = ybStorage.getLastEpochRewardsUpdated();
        if (lastEpochRewardsSet + 1 >= _currentEpoch) {
            return;
        }
        for (uint256 epoch = lastEpochRewardsSet + 1; epoch < _currentEpoch; epoch++) {
            uint256 stakerLastStakedAmount = ybStorage.getStakerLastStakedAmountPerEpoch(
                _user,
                epoch
            );
            uint256 stakerMinStakedAmount = ybStorage.getStakerMinStakedAmountPerEpoch(
                _user,
                epoch
            );
            uint256 globalLastStakedAmount = ybStorage.getLastStakedAmountPerEpoch(epoch);
            uint256 globalMinStakedAmount = ybStorage.getMinStakedAmountPerEpoch(epoch);
            ybStorage.setStakerLastStakedAmountPerEpoch(_user, epoch, 0); // Also updates the min staked amount
            ybStorage.setLastStakedAmountPerEpoch(
                epoch,
                globalLastStakedAmount - stakerLastStakedAmount
            );
            ybStorage.setMinStakedAmountPerEpoch(
                epoch,
                globalMinStakedAmount - stakerMinStakedAmount
            );
            emit StuckRewardsAvoided(_user, epoch, stakerMinStakedAmount, stakerLastStakedAmount);
        }
    }
}
