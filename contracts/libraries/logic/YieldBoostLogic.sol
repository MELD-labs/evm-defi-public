// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReserveLogic, PercentageMath, IMToken} from "./ReserveLogic.sol";
import {UserConfiguration, DataTypes, Errors} from "../configuration/UserConfiguration.sol";
import {Helpers} from "../helpers/Helpers.sol";

/**
 * @title YieldBoostLogic library
 * @notice Implements the actions related to the YieldBoost and MeldBanker NFTs
 * @author MELD team
 */
library YieldBoostLogic {
    using ReserveLogic for DataTypes.ReserveData;
    using UserConfiguration for DataTypes.UserConfigurationMap;
    using SafeERC20 for IERC20;
    using PercentageMath for uint256;

    struct MeldBankerData {
        uint256 tokenId;
        address asset;
        DataTypes.MeldBankerType meldBankerType;
        DataTypes.Action action;
    }

    /**
     * @notice Emitted when a user applies the Meld Banker benefit when depositing or borrowing
     * @param reserve The address of the reserve
     * @param user The address of the user
     * @param tokenId The ID of the Meld Banker NFT
     * @param action The action for which the Meld Banker NFT is used
     */
    event LockMeldBankerNFT(
        address indexed reserve,
        address indexed user,
        uint256 indexed tokenId,
        DataTypes.MeldBankerType,
        DataTypes.Action action
    );

    /**
     * @notice Emitted when a the Meld Banker NFT lock is lifted. This happens when a user withdraws, repays, or liquidates (in some circumstances) the full balance
     * @param reserve The address of the reserve
     * @param user The address of the user
     * @param tokenId The ID of the Meld Banker NFT
     */
    event UnlockMeldBankerNFT(
        address indexed reserve,
        address indexed user,
        uint256 indexed tokenId,
        DataTypes.MeldBankerType,
        DataTypes.Action action
    );

    /**
     * @notice Emitted when the yield boost amount is refreshed.
     * @param reserve The address of the reserve
     * @param user The address of the user
     * @param newStakeAmount The new stake amount
     */
    event RefreshYieldBoostAmount(
        address indexed reserve,
        address indexed user,
        uint256 newStakeAmount
    );

    /**
     * @notice Refreshes the yield boost amount for the lending pool.
     * @param _user The address of the user
     * @param _asset The address of the underlying asset of the reserve
     * @return newStakeAmount The new stake amount
     */
    function refreshYieldBoostAmount(
        DataTypes.ReserveData storage _reserve,
        mapping(address user => MeldBankerData) storage _userMeldBankerData,
        mapping(DataTypes.MeldBankerType => mapping(DataTypes.Action => uint256 yieldBoostMultiplier))
            storage _yieldBoostMultipliers,
        address _user,
        address _asset
    ) external view returns (uint256 newStakeAmount) {
        require(_user != address(0), Errors.INVALID_ADDRESS);
        require(_asset != address(0), Errors.INVALID_ADDRESS);

        address mToken = _reserve.mTokenAddress;
        uint256 depositStakeAmount;
        uint256 borrowStakeAmount;
        uint256 depositYieldBoostPercentage;
        uint256 borrowYieldBoostPercentage;

        MeldBankerData memory meldBankerNFTData = _userMeldBankerData[_user];

        //(MToken balance * deposit multiplier)  + ( total of debt token balances * borrow multiplier)

        // Need to get the correct multiplier for the correct asset. NFT holder only gets benefit for one asset and action combination
        if (meldBankerNFTData.asset == _asset) {
            if (meldBankerNFTData.action == DataTypes.Action.DEPOSIT) {
                // If the user is using the Meld Banker NFT for depositing, then the user should only get the deposit yield boost
                depositYieldBoostPercentage = _yieldBoostMultipliers[
                    meldBankerNFTData.meldBankerType
                ][DataTypes.Action.DEPOSIT];
            } else {
                // If the user is using the Meld Banker NFT for borrowing, then the user should only get the borrow yield boost
                borrowYieldBoostPercentage = _yieldBoostMultipliers[
                    meldBankerNFTData.meldBankerType
                ][DataTypes.Action.BORROW];
            }
        } else {
            // Regular users should get the default yield boost (100%) for deposit and 0 for borrow
            depositYieldBoostPercentage = _yieldBoostMultipliers[DataTypes.MeldBankerType.NONE][
                DataTypes.Action.DEPOSIT
            ];

            borrowYieldBoostPercentage = _yieldBoostMultipliers[DataTypes.MeldBankerType.NONE][
                DataTypes.Action.BORROW
            ];
        }

        if (depositYieldBoostPercentage > 0) {
            // Get user MToken balance
            uint256 mTokenBalance = IMToken(mToken).balanceOf(_user);
            depositStakeAmount = mTokenBalance.percentMul(depositYieldBoostPercentage);
        }

        if (borrowYieldBoostPercentage > 0) {
            // Get user debt
            (uint256 stableDebt, uint256 variableDebt) = Helpers.getUserCurrentDebt(
                _user,
                _reserve
            );
            borrowStakeAmount = (stableDebt + variableDebt).percentMul(borrowYieldBoostPercentage);
        }

        newStakeAmount = depositStakeAmount + borrowStakeAmount;
    }

    /**
     * @notice Locks the Meld Banker NFT so that it can't be used for other action/asset combinations until it's unlocked
     * @param _isMeldBankerBlocked A mapping of the Meld Banker NFTs that are currently locked
     * @param _isUsingMeldBanker A mapping of the users that are currently using a Meld Banker NFT
     * @param _userMeldBankerData A mapping of the Meld Banker NFTs that are currently being used by a user
     * @param _user The address of the user
     * @param _meldBankerData Data used to unlock the Meld Banker NFT.
     */
    function lockMeldBankerNFT(
        mapping(uint256 tokenId => bool) storage _isMeldBankerBlocked,
        mapping(address user => bool) storage _isUsingMeldBanker,
        mapping(address user => MeldBankerData) storage _userMeldBankerData,
        address _user,
        MeldBankerData memory _meldBankerData
    ) internal {
        _isMeldBankerBlocked[_meldBankerData.tokenId] = true;
        _isUsingMeldBanker[_user] = true;
        _userMeldBankerData[_user] = _meldBankerData;
        emit LockMeldBankerNFT(
            _meldBankerData.asset,
            _user,
            _meldBankerData.tokenId,
            _meldBankerData.meldBankerType,
            _meldBankerData.action
        );
    }

    /**
     * @notice Unlocks the Meld Banker NFT so that it can be used for other action/asset combinations until it's unlocked. Unlock only happens when the user withdraws/repays, liquidates the whole balance
     * @param _isMeldBankerBlocked A mapping of the Meld Banker NFTs that are currently locked
     * @param _isUsingMeldBanker A mapping of the users that are currently using a Meld Banker NFT
     * @param _userMeldBankerData A mapping of the Meld Banker NFTs that are currently being used by a user
     * @param _user The address of the user
     */
    function unlockMeldBankerNFT(
        mapping(uint256 tokenId => bool) storage _isMeldBankerBlocked,
        mapping(address user => bool) storage _isUsingMeldBanker,
        mapping(address user => MeldBankerData) storage _userMeldBankerData,
        address _user
    ) internal {
        MeldBankerData storage meldBankerData = _userMeldBankerData[_user];
        _isMeldBankerBlocked[meldBankerData.tokenId] = false;
        _isUsingMeldBanker[_user] = false;

        emit UnlockMeldBankerNFT(
            meldBankerData.asset,
            _user,
            meldBankerData.tokenId,
            meldBankerData.meldBankerType,
            meldBankerData.action
        );

        delete _userMeldBankerData[_user];
    }
}
