// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title IYieldBoostFactory interface
 * @notice Contains the functions and events for the YieldBoostFactory
 * @author MELD team
 */
interface IYieldBoostFactory {
    /**
     * @notice  Event emitted when a new YieldBoostInstance is created.
     * @param   addressesProvider  Address of the Lending&Borrowing AddressesProvider
     * @param   asset  Address of the asset
     * @param   yieldBoostStaking  Address of the YieldBoostStaking
     * @param   yieldBoostStorage  Address of the YieldBoostStorage
     */
    event YieldBoostInstanceCreated(
        address indexed addressesProvider,
        address indexed asset,
        address yieldBoostStaking,
        address yieldBoostStorage
    );

    /**
     * @notice  Function to create a new Yield Boost instance (YieldBoostStaking and YieldBoostStorage)
     * @param   _asset  Address of the asset
     * @return  address Address of the new YieldBoostStaking
     */
    function createYieldBoostInstance(address _asset) external returns (address);
}
