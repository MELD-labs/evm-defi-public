// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {
    IAccessControl,
    AccessControl,
    AccessControlEnumerable
} from "@openzeppelin/contracts/access/AccessControlEnumerable.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";
import {IAddressesProvider} from "../interfaces/IAddressesProvider.sol";
import {Errors} from "../libraries/helpers/Errors.sol";

/**
 * @title AddressesProvider contract
 * @notice Main registry of addresses part of or connected to the protocol, including permissioned roles
 * @author MELD team
 */
contract AddressesProvider is IAddressesProvider, AccessControlEnumerable, Pausable {
    // Different roles ids

    bool public override isUpgradeable = true;

    bytes32 public constant POOL_ADMIN_ROLE = keccak256("POOL_ADMIN_ROLE");
    bytes32 public constant LENDING_POOL_CONFIGURATOR_ROLE =
        keccak256("LENDING_POOL_CONFIGURATOR_ROLE");
    bytes32 public constant LENDING_POOL_ROLE = keccak256("LENDING_POOL_ROLE");
    bytes32 public constant ORACLE_MANAGEMENT_ROLE = keccak256("ORACLE_MANAGEMENT_ROLE");
    bytes32 public constant BNKR_NFT_MINTER_BURNER_ROLE = keccak256("BNKR_NFT_MINTER_BURNER_ROLE");
    bytes32 public constant YB_REWARDS_SETTER_ROLE = keccak256("YB_REWARDS_SETTER_ROLE");
    bytes32 public constant GENIUS_LOAN_ROLE = keccak256("GENIUS_LOAN_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant UNPAUSER_ROLE = keccak256("UNPAUSER_ROLE");
    bytes32 public constant DESTROYER_ROLE = keccak256("DESTROYER_ROLE");

    // The addresses for the different contracts
    mapping(bytes32 => address) private addresses;

    mapping(bytes32 => bool) private immutableAddresses;
    mapping(bytes32 => bool) private immutableRoles;
    mapping(bytes32 => bool) private destroyableRoles;
    mapping(bytes32 => bool) public override isDestroyedRole;

    bytes32 private constant LENDING_POOL = "LENDING_POOL";
    bytes32 private constant LENDING_POOL_CONFIGURATOR = "LENDING_POOL_CONFIGURATOR";
    bytes32 private constant PRICE_ORACLE = "PRICE_ORACLE";
    bytes32 private constant LENDING_RATE_ORACLE = "LENDING_RATE_ORACLE";
    bytes32 private constant MELD_BANKER_NFT = "MELD_BANKER_NFT";
    bytes32 private constant MELD_BANKER_NFT_MINTER = "MELD_BANKER_NFT_MINTER";
    bytes32 private constant YIELD_BOOST_FACTORY = "YIELD_BOOST_FACTORY";
    bytes32 private constant PROTOCOL_DATA_PROVIDER = "PROTOCOL_DATA_PROVIDER";
    bytes32 private constant MELD_TOKEN = "MELD_TOKEN";
    bytes32 private constant MELD_STAKING_STORAGE = "MELD_STAKING_STORAGE";

    uint256 private immutable DEPLOYMENT_TIMESTAMP; // solhint-disable-line immutable-vars-naming

    /**
     * @notice Checks if the role can be modified
     * @param _role The role to check
     */
    modifier onlyMutableRole(bytes32 _role) {
        require(!immutableRoles[_role], Errors.AP_CANNOT_UPDATE_ROLE);
        _;
    }

    /**
     * @notice Checks if the role can be destroyed
     * @param _role The role to check
     */
    modifier onlyDestroyableRole(bytes32 _role) {
        require(destroyableRoles[_role], Errors.AP_ROLE_NOT_DESTROYABLE);
        _;
    }

    /**
     * @notice Checks if there is more than one admin before renouncing the role
     * @param _role The role to check
     */
    modifier checkLastAdmin(bytes32 _role) {
        if (_role == DEFAULT_ADMIN_ROLE) {
            require(getRoleMemberCount(_role) > 1, Errors.AP_CANNOT_REMOVE_LAST_ADMIN);
        }
        _;
    }

    /**
     * @notice Checks that the role has not already been destroyed.
     * @param _role The role to check
     */
    modifier checkNotDestroyed(bytes32 _role) {
        require(!isDestroyedRole[_role], Errors.AP_ROLE_ALREADY_DESTROYED);
        _;
    }

    /**
     * @notice  Constructor of the contract
     * @param   _defaultAdmin This address will have the `DEFAULT_ADMIN_ROLE`
     */
    constructor(address _defaultAdmin) {
        require(_defaultAdmin != address(0), Errors.INVALID_ADDRESS);
        _grantRole(DEFAULT_ADMIN_ROLE, _defaultAdmin);
        immutableAddresses[LENDING_POOL] = true;
        immutableAddresses[LENDING_POOL_CONFIGURATOR] = true;
        immutableAddresses[MELD_BANKER_NFT] = true;
        immutableAddresses[YIELD_BOOST_FACTORY] = true;
        immutableAddresses[MELD_TOKEN] = true;
        immutableAddresses[MELD_STAKING_STORAGE] = true;

        immutableRoles[LENDING_POOL_ROLE] = true;
        immutableRoles[LENDING_POOL_CONFIGURATOR_ROLE] = true;

        // Roles that can be destroyed
        destroyableRoles[ORACLE_MANAGEMENT_ROLE] = true;
        destroyableRoles[GENIUS_LOAN_ROLE] = true;
        destroyableRoles[PAUSER_ROLE] = true;
        destroyableRoles[UNPAUSER_ROLE] = true;
        destroyableRoles[BNKR_NFT_MINTER_BURNER_ROLE] = true;

        DEPLOYMENT_TIMESTAMP = block.timestamp;
    }

    /**
     * @notice Sets an address for an id replacing the address saved in the addresses map
     * IMPORTANT Use this function carefully, as it will do a hard replacement
     * @param _id The id
     * @param _newAddress The address to set
     */
    function setAddressForId(
        bytes32 _id,
        address _newAddress
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) whenNotPaused {
        address oldAddress = addresses[_id];
        _setAddress(_id, _newAddress);
        emit AddressSet(msg.sender, _id, oldAddress, _newAddress);
    }

    /**
     * @notice Updates the LendingPool setting the new `pool` on the first time calling it
     * @dev Revokes the role from the previous address and grants it to the new address
     * @param _pool The new LendingPool
     */
    function setLendingPool(address _pool) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        address oldLendingPool = addresses[LENDING_POOL];
        super.revokeRole(LENDING_POOL_ROLE, oldLendingPool);
        _setAddress(LENDING_POOL, _pool);
        super.grantRole(LENDING_POOL_ROLE, _pool);
        emit LendingPoolUpdated(msg.sender, oldLendingPool, _pool);
    }

    /**
     * @notice Updates the  LendingPoolConfigurator  setting the new `configurator` on the first time calling it
     * @dev Revokes the role from the previous address and grants it to the new address
     * @param _configurator The new LendingPoolConfigurator
     */
    function setLendingPoolConfigurator(
        address _configurator
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        address oldConfigurator = addresses[LENDING_POOL_CONFIGURATOR];
        super.revokeRole(LENDING_POOL_CONFIGURATOR_ROLE, oldConfigurator);
        _setAddress(LENDING_POOL_CONFIGURATOR, _configurator);
        super.grantRole(LENDING_POOL_CONFIGURATOR_ROLE, _configurator);
        emit LendingPoolConfiguratorUpdated(msg.sender, oldConfigurator, _configurator);
    }

    /**
     * @notice Updates the address of the MeldProtocolDataProvider
     * @param _dataProvider The new MeldProtocolDataProvider address
     */
    function setProtocolDataProvider(
        address _dataProvider
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) whenNotPaused {
        address oldDataProvider = addresses[PROTOCOL_DATA_PROVIDER];
        _setAddress(PROTOCOL_DATA_PROVIDER, _dataProvider);
        emit ProtocolDataProviderUpdated(msg.sender, oldDataProvider, _dataProvider);
    }

    /**
     * @notice Updates the address of the PriceOracle
     * @param _priceOracle The new PriceOracle address
     */
    function setPriceOracle(
        address _priceOracle
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) whenNotPaused {
        address oldPriceOracle = addresses[PRICE_ORACLE];
        _setAddress(PRICE_ORACLE, _priceOracle);
        emit PriceOracleUpdated(msg.sender, oldPriceOracle, _priceOracle);
    }

    /**
     * @notice Updates the address of the LendingRateOracle
     * @param _lendingRateOracle The new LendingRateOracle address
     */
    function setLendingRateOracle(
        address _lendingRateOracle
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) whenNotPaused {
        address oldLendingRateOracle = addresses[LENDING_RATE_ORACLE];
        _setAddress(LENDING_RATE_ORACLE, _lendingRateOracle);
        emit LendingRateOracleUpdated(msg.sender, oldLendingRateOracle, _lendingRateOracle);
    }

    /**
     * @notice  ADMIN: Sets the address of the MELD Banker NFT contract
     * @dev     This function can only be called by the `DEFAULT_ADMIN_ROLE`
     * @param   _meldBankerNFT  Address of the MELD Banker NFT contract
     */
    function setMeldBankerNFT(
        address _meldBankerNFT
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        address oldNft = addresses[MELD_BANKER_NFT];
        _setAddress(MELD_BANKER_NFT, _meldBankerNFT);
        emit MeldBankerNFTUpdated(msg.sender, oldNft, _meldBankerNFT);
    }

    /**
     * @notice  ADMIN: Sets the address of the MELD Banker NFT Minter contract
     * @dev     This function can only be called by the `DEFAULT_ADMIN_ROLE`
     * @param   _meldBankerNFTMinter  Address of the MELD Banker NFT contract
     */
    function setMeldBankerNFTMinter(
        address _meldBankerNFTMinter
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) whenNotPaused {
        address oldMinter = addresses[MELD_BANKER_NFT_MINTER];
        _setAddress(MELD_BANKER_NFT_MINTER, _meldBankerNFTMinter);
        emit MeldBankerNFTMinterUpdated(msg.sender, oldMinter, _meldBankerNFTMinter);
    }

    /**
     * @notice  ADMIN: Sets the address of the YieldBoostFactory contract
     * @param   _yieldBoostFactory  Address of the YieldBoostFactory contract
     */
    function setYieldBoostFactory(
        address _yieldBoostFactory
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        address oldFactory = addresses[YIELD_BOOST_FACTORY];
        _setAddress(YIELD_BOOST_FACTORY, _yieldBoostFactory);
        emit YieldBoostFactoryUpdated(msg.sender, oldFactory, _yieldBoostFactory);
    }

    /**
     * @notice  ADMIN: Sets the address of the MELD Token contract
     * @param   _meldToken  Address of the MELD Token contract
     */
    function setMeldToken(address _meldToken) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        address oldToken = addresses[MELD_TOKEN];
        _setAddress(MELD_TOKEN, _meldToken);
        emit MeldTokenUpdated(msg.sender, oldToken, _meldToken);
    }

    /**
     * @notice  ADMIN: Sets the address of the MELD Staking Storage contract
     * @param   _meldStakingStorage  Address of the MELD Staking Storage contract
     */
    function setMeldStakingStorage(
        address _meldStakingStorage
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        address oldStorage = addresses[MELD_STAKING_STORAGE];
        _setAddress(MELD_STAKING_STORAGE, _meldStakingStorage);
        emit MeldStakingStorageUpdated(msg.sender, oldStorage, _meldStakingStorage);
    }

    /**
     * @notice Pauses the protocol
     * @dev This function can only be called by the `PAUSER_ROLE`
     */
    function pause() external override onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /**
     * @notice Unpauses the protocol
     * @dev This function can only be called by the `UNPAUSER_ROLE`
     */
    function unpause() external override onlyRole(UNPAUSER_ROLE) {
        _unpause();
    }

    /**
     * @notice Once called, prevents any future upgrades to the contract
     * @dev This function can only be called by the `DEFAULT_ADMIN_ROLE`
     * @dev Upgradeability can be stopped after 6 months
     * @dev This action is not reversible
     */
    function stopUpgradeability() external override onlyRole(DEFAULT_ADMIN_ROLE) {
        require(
            block.timestamp >= DEPLOYMENT_TIMESTAMP + 6 * 30 days,
            Errors.AP_CANNOT_STOP_UPGRADEABILITY
        );
        isUpgradeable = false;
        emit UpgradeabilityStopped(_msgSender());
    }

    /**
     * @notice Destroys a role so that it can no longer be used and sets the admin for the role to 0x00.
     *  Only applicable to certain roles
     *  IMPORTANT Use this function carefully
     * @dev Only callable by the `DESTROYER_ROLE. If the role still have members, revoke the role for those members first.
     * @param _role The role to be destroyed
     */
    function destroyRole(
        bytes32 _role
    )
        external
        override
        onlyRole(DESTROYER_ROLE)
        onlyDestroyableRole(_role)
        checkNotDestroyed(_role)
    {
        require(getRoleMemberCount(_role) == 0, Errors.AP_ROLE_HAS_MEMBERS);
        isDestroyedRole[_role] = true;
        _setRoleAdmin(_role, bytes32(uint256(1)));
        emit RoleDestroyed(_msgSender(), _role);
    }

    /**
     * @notice Sets `adminRole` as ``role``'s admin role.
     * @dev Only callable by the `DEFAULT_ADMIN_ROLE`
     * @param _role The role to set the admin for
     * @param _adminRole The role to be set as admin
     */
    function setRoleAdmin(
        bytes32 _role,
        bytes32 _adminRole
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) checkNotDestroyed(_role) {
        _setRoleAdmin(_role, _adminRole);
    }

    /**
     * @notice  Checks if `account` has been granted `role`. If not, reverts with a string message that includes the hexadecimal representation of `role`.
     * @param   _role The role to check
     * @param   _account The account to check if it has the role
     */
    function checkRole(bytes32 _role, address _account) external view override {
        _checkRole(_role, _account);
    }

    /**
     * @notice Reverts if the protocol is paused.
     */
    function requireNotPaused() external view override {
        _requireNotPaused();
    }

    /**
     * @notice Returns the address of the LendingPool proxy
     * @return The LendingPool proxy address
     */
    function getLendingPool() external view override returns (address) {
        return getAddressForId(LENDING_POOL);
    }

    /**
     * @notice Returns the address of the LendingPoolConfigurator
     * @return The LendingPoolConfigurator address
     */
    function getLendingPoolConfigurator() external view override returns (address) {
        return getAddressForId(LENDING_POOL_CONFIGURATOR);
    }

    /**
     * @notice Returns the address of the MeldProtocolDataProvider
     * @return The address of the MeldProtocolDataProvider
     */
    function getProtocolDataProvider() external view override returns (address) {
        return getAddressForId(PROTOCOL_DATA_PROVIDER);
    }

    /**
     * @notice Returns the address of the PriceOracleAggregator
     * @return The address of the PriceOracleAggregator
     */
    function getPriceOracle() external view override returns (address) {
        return getAddressForId(PRICE_ORACLE);
    }

    /**
     * @notice Returns the address of the LendingRateOracleAggregator
     * @return The LendingRateOracleAggregator address
     */
    function getLendingRateOracle() external view override returns (address) {
        return getAddressForId(LENDING_RATE_ORACLE);
    }

    /**
     * @notice Returns the address of the MeldBankerNFT
     * @return The MeldBankerNFT address
     */
    function getMeldBankerNFT() external view override returns (address) {
        return getAddressForId(MELD_BANKER_NFT);
    }

    /**
     * @notice Returns the address of the MeldBankerNFTMinter
     * @return The MeldBankerNFTMinter address
     */
    function getMeldBankerNFTMinter() external view override returns (address) {
        return getAddressForId(MELD_BANKER_NFT_MINTER);
    }

    /**
     * @notice Returns the address of the YieldBoostFactory
     * @return The YieldBoostFactory address
     */
    function getYieldBoostFactory() external view override returns (address) {
        return getAddressForId(YIELD_BOOST_FACTORY);
    }

    /**
     * @notice Returns the address of the MeldToken
     * @return The MeldToken address
     */
    function getMeldToken() external view override returns (address) {
        return getAddressForId(MELD_TOKEN);
    }

    /**
     * @notice Returns the address of the MeldStakingStorage
     * @return The MeldStakingStorage address
     */
    function getMeldStakingStorage() external view override returns (address) {
        return getAddressForId(MELD_STAKING_STORAGE);
    }

    /**
     * @notice  Exposes the DEFAULT_ADMIN_ROLE
     * @return  The DEFAULT_ADMIN_ROLE
     */
    function PRIMARY_ADMIN_ROLE() external pure override returns (bytes32) {
        // solhint-disable-previous-line func-name-mixedcase
        return DEFAULT_ADMIN_ROLE;
    }

    /**
     * @notice Grants `role` to `account`.
     * @dev Cannot grant the immutable roles
     * @param _role The role to grant
     * @param _account The account to grant the role to
     */
    function grantRole(
        bytes32 _role,
        address _account
    ) public virtual override(AccessControl, IAccessControl) onlyMutableRole(_role) {
        require(_account != address(0), Errors.INVALID_ADDRESS);
        super.grantRole(_role, _account);
    }

    /**
     * @notice Revokes `role` from `account`.
     * @dev Cannot revoke the immutable roles
     * @param _role The role to revoke
     * @param _account The account to revoke the role from
     */
    function revokeRole(
        bytes32 _role,
        address _account
    )
        public
        virtual
        override(AccessControl, IAccessControl)
        onlyMutableRole(_role)
        checkLastAdmin(_role)
    {
        super.revokeRole(_role, _account);
    }

    /**
     * @notice Revokes `role` from the calling account.
     * @dev Cannot renounce the DEFAULT_ADMIN_ROLE if it is the last admin
     * @param _role The role to renounce
     * @param _account The account to renounce the role from. Must be equal to the _msgSender()
     */
    function renounceRole(
        bytes32 _role,
        address _account
    ) public virtual override(AccessControl, IAccessControl) checkLastAdmin(_role) {
        super.renounceRole(_role, _account);
    }

    /**
     * @notice Returns an address by id
     * @return The address
     */
    function getAddressForId(bytes32 _id) public view override returns (address) {
        return addresses[_id];
    }

    /**
     * @notice Sets an address for an id replacing the address saved in the addresses map
     * Used by external setters that require validation
     * @param id The id
     * @param newAddress The address to set
     */
    function _setAddress(bytes32 id, address newAddress) internal {
        require(id != bytes32(0), Errors.AP_INVALID_ADDRESS_ID);
        if (immutableAddresses[id]) {
            require(addresses[id] == address(0), Errors.AP_CANNOT_UPDATE_ADDRESS);
        }
        require(newAddress != address(0), Errors.INVALID_ADDRESS);
        addresses[id] = newAddress;
    }
}
