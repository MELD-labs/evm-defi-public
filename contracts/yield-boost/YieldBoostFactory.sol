// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {LendingBase, IAddressesProvider} from "../base/LendingBase.sol";
import {Errors} from "../libraries/helpers/Errors.sol";
import {IYieldBoostFactory} from "../interfaces/yield-boost/IYieldBoostFactory.sol";
import {IMeldStakingStorageMin} from "../interfaces/IMeldStakingStorageMin.sol";
import {YieldBoostStaking} from "./YieldBoostStaking.sol";
import {YieldBoostStorage} from "./YieldBoostStorage.sol";

/**
 * @title YieldBoostFactory
 * @notice This contract will handle the creation of the YieldBoost instances
 * @author MELD team
 */
contract YieldBoostFactory is IYieldBoostFactory, LendingBase {
    address public immutable ybStakingImpl;
    address public immutable ybStorageImpl;

    uint256 public immutable epochSize;

    IMeldStakingStorageMin private immutable meldStakingStorage;

    /**
     * @notice Constructor of the contract. It initializes the implementation addresses
     * @param _addressesProvider Address of the Lending&Borrowing addresses provider
     */
    constructor(address _addressesProvider) {
        require(_addressesProvider != address(0), Errors.INVALID_ADDRESS);
        addressesProvider = IAddressesProvider(_addressesProvider);
        address meldStakingStorageAddress = addressesProvider.getMeldStakingStorage();
        require(meldStakingStorageAddress != address(0), Errors.YB_INVALID_MELD_STAKING_STORAGE);
        meldStakingStorage = IMeldStakingStorageMin(meldStakingStorageAddress);
        epochSize = meldStakingStorage.getEpochSize();
        require(epochSize > 0, Errors.YB_INVALID_EPOCH_SIZE);
        ybStakingImpl = address(new YieldBoostStaking(_addressesProvider));
        ybStorageImpl = address(new YieldBoostStorage());
    }

    /**
     * @notice  Function to create a new Yield Boost instance (YieldBoostStaking and YieldBoostStorage)
     * @param   _asset  Address of the asset
     * @return  address Address of the new YieldBoostStaking
     */
    function createYieldBoostInstance(address _asset) external override returns (address) {
        YieldBoostStaking ybStaking = YieldBoostStaking(Clones.clone(ybStakingImpl));
        YieldBoostStorage ybStorage = YieldBoostStorage(Clones.clone(ybStorageImpl));

        ybStaking.initialize(_asset, address(ybStorage));

        uint256 initTimestamp = _calculateInitTimestamp();
        ybStorage.initialize(initTimestamp, epochSize, address(ybStaking));

        emit YieldBoostInstanceCreated(
            address(ybStaking.addressesProvider()),
            _asset,
            address(ybStaking),
            address(ybStorage)
        );

        return address(ybStaking);
    }

    /**
     * @notice  Calculates the initial timestamp for the newly created YieldBoostStaking and YieldBoostStorage
     * @dev     The initial timestamp is the start of the current epoch of the Meld Staking protocol
     * @return  uint256 Initial timestamp
     */
    function _calculateInitTimestamp() private view returns (uint256) {
        uint256 currentEpoch = meldStakingStorage.getCurrentEpoch();
        return meldStakingStorage.getEpochStart(currentEpoch);
    }
}
