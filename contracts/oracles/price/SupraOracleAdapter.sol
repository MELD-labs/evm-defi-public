// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {LendingBase, IAddressesProvider} from "../../base/LendingBase.sol";
import {Errors} from "../..//libraries/helpers/Errors.sol";
import {IPriceOracle} from "../../interfaces/IPriceOracle.sol";
import {ISupraSValueFeed} from "../../interfaces/ISupraSValueFeed.sol";

/**
 * @title SupraOracleAdapter
 * @notice Adapter contract for converting SupraSValueFeed data to a standard PriceOracle format
 * @dev Implements the IPriceOracle interface
 * @author MELD team
 */
contract SupraOracleAdapter is LendingBase, IPriceOracle {
    /// @notice Mapping of asset addresses to their respective pair paths
    mapping(address asset => uint256[] pairPath) public pairPaths;

    /// @notice Maximum age a price can have to be considered valid
    uint256 public maxPriceAge;

    /// @notice Reference to the SupraSValueFeed contract
    ISupraSValueFeed public sValueFeed;

    /// @notice Constant unit price for conversion
    uint256 internal constant PRICE_UNIT = 1e18;

    /**
     * @notice Emitted when a pair path is added
     * @param executedBy The address that executed the function
     * @param asset The address of the asset
     * @param pairPath An array of price indexes representing the pair path
     */
    event PairPathAdded(address indexed executedBy, address indexed asset, uint256[] pairPath);

    /**
     * @notice Emitted when the price feed is updated
     * @param executedBy The address that executed the function
     * @param oldFeed The address of the old price feed
     * @param newFeed The address of the new price feed
     */
    event SValueFeedUpdated(address indexed executedBy, address oldFeed, address newFeed);

    /**
     * @notice Emitted when the maximum price age is updated
     * @param executedBy The address that executed the function
     * @param oldMaxPriceAge The previous maximum age of prices considered valid
     * @param newMaxPriceAge The new maximum age of prices considered valid
     */
    event MaxPriceAgeUpdated(
        address indexed executedBy,
        uint256 oldMaxPriceAge,
        uint256 newMaxPriceAge
    );

    /**
     * @notice Initializes the contract with a reference to the SupraSValueFeed contract
     * @param _addressesProvider The address of the AddressesProvider contract
     * @param _feedAddress Address of the SupraSValueFeed contract
     */
    constructor(address _addressesProvider, address _feedAddress) {
        require(_addressesProvider != address(0), Errors.INVALID_ADDRESS);
        addressesProvider = IAddressesProvider(_addressesProvider);
        require(_feedAddress != address(0), Errors.INVALID_ADDRESS);
        sValueFeed = ISupraSValueFeed(_feedAddress);
        maxPriceAge = 15 minutes;
    }

    /**
     * @notice Sets the pair path for an asset
     * @param _asset The address of the asset
     * @param _pairPath An array of price indexes representing the pair path. If the array is empty, the pair path is removed
     */
    function setPairPath(
        address _asset,
        uint256[] memory _pairPath
    ) external whenNotPaused onlyRole(addressesProvider.ORACLE_MANAGEMENT_ROLE()) {
        pairPaths[_asset] = _pairPath;
        emit PairPathAdded(msg.sender, _asset, _pairPath);
    }

    /**
     * @notice Sets the maximum age a price can have to be considered valid
     * @param _newMaxPriceAge The new maximum age for a price
     */
    function setMaxPriceAge(
        uint256 _newMaxPriceAge
    ) external whenNotPaused onlyRole(addressesProvider.ORACLE_MANAGEMENT_ROLE()) {
        require(_newMaxPriceAge > 0, Errors.EMPTY_VALUE);
        emit MaxPriceAgeUpdated(msg.sender, maxPriceAge, _newMaxPriceAge);
        maxPriceAge = _newMaxPriceAge;
    }

    /**
     * @notice Sets the new price feed contract address
     * @dev address can be set to 0 to deactivate this contract
     * @param _newFeedAddress The new contract address
     */
    function updateSupraSvalueFeed(
        address _newFeedAddress
    ) external whenNotPaused onlyRole(addressesProvider.ORACLE_MANAGEMENT_ROLE()) {
        emit SValueFeedUpdated(msg.sender, address(sValueFeed), _newFeedAddress);
        sValueFeed = ISupraSValueFeed(_newFeedAddress);
    }

    /**
     * @notice Retrieves the price of an asset
     * @param _asset The address of the asset
     * @return price The price of the asset
     * @return success Boolean indicating if the price retrieval was successful
     */
    function getAssetPrice(
        address _asset
    ) external view override returns (uint256 price, bool success) {
        if (address(sValueFeed) == address(0)) {
            return (0, false);
        }
        uint256[] memory pairPath = pairPaths[_asset];
        if (pairPath.length == 1) {
            ISupraSValueFeed.priceFeed memory priceInfo = sValueFeed.getSvalue(pairPath[0]);
            price = _convertToDecimals(PRICE_UNIT, priceInfo.price, priceInfo.decimals);
            success = _validTimestamp(priceInfo.time);
        } else if (pairPath.length > 1) {
            ISupraSValueFeed.priceFeed[] memory priceInfoArray = sValueFeed.getSvalues(pairPath);
            price = PRICE_UNIT;
            success = true;
            for (uint256 i = 0; i < priceInfoArray.length; i++) {
                price = _convertToDecimals(
                    price,
                    priceInfoArray[i].price,
                    priceInfoArray[i].decimals
                );
                success = success && _validTimestamp(priceInfoArray[i].time);
            }
        }
        // if pair path is empty it returns default values (0, false)
    }

    /**
     * @notice Checks if a timestamp is within the valid age range
     * @dev SupraOracles timestamp is in miliseconds, division by 1000 done
     * @param _timestamp The timestamp to validate
     * @return bool Boolean indicating if the timestamp is valid
     */
    function _validTimestamp(uint256 _timestamp) internal view returns (bool) {
        return block.timestamp - (_timestamp / 1000) <= maxPriceAge;
    }

    /**
     * @notice Converts a price to a different decimal base
     * @param _basePrice The base price for conversion
     * @param _newPrice The new price to convert
     * @param _decimal The decimal places to convert to
     * @return The converted price
     */
    function _convertToDecimals(
        uint256 _basePrice,
        uint256 _newPrice,
        uint256 _decimal
    ) internal pure returns (uint256) {
        return (_basePrice * _newPrice) / (10 ** _decimal);
    }
}
