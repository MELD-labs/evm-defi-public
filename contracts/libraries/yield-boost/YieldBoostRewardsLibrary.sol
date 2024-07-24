// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IYieldBoostRewards} from "../../interfaces/yield-boost/IYieldBoostRewards.sol";

/**
 * @title YieldBoostRewardsLibrary library
 * @notice Defines the functions to handle rewards
 * @author MELD team
 */
library YieldBoostRewardsLibrary {
    /**
     * @notice Checks if the rewards struct is empty
     * @param _self Rewards struct
     */
    function isEmpty(IYieldBoostRewards.Rewards memory _self) internal pure returns (bool) {
        return _self.assetRewards == 0 && _self.meldRewards == 0;
    }

    /**
     * @notice Adds two rewards structs
     * @param _self First rewards struct
     * @param _other Second rewards struct
     */
    function add(
        IYieldBoostRewards.Rewards memory _self,
        IYieldBoostRewards.Rewards memory _other
    ) internal pure returns (IYieldBoostRewards.Rewards memory) {
        return
            IYieldBoostRewards.Rewards(
                _self.assetRewards + _other.assetRewards,
                _self.meldRewards + _other.meldRewards
            );
    }

    /**
     * @notice Multiplies a rewards struct by a scalar
     * @param _self Rewards struct
     * @param _scalar Scalar to multiply by
     */
    function scalarMul(
        IYieldBoostRewards.Rewards memory _self,
        uint256 _scalar
    ) internal pure returns (IYieldBoostRewards.Rewards memory) {
        return
            IYieldBoostRewards.Rewards(_self.assetRewards * _scalar, _self.meldRewards * _scalar);
    }

    /**
     * @notice Divides a rewards struct by a scalar
     * @param _self Rewards struct
     * @param _scalar Scalar to divide by
     */
    function scalarDiv(
        IYieldBoostRewards.Rewards memory _self,
        uint256 _scalar
    ) internal pure returns (IYieldBoostRewards.Rewards memory) {
        return
            IYieldBoostRewards.Rewards(_self.assetRewards / _scalar, _self.meldRewards / _scalar);
    }
}
