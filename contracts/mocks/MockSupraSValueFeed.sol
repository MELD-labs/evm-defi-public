// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ISupraSValueFeed} from "../interfaces/ISupraSValueFeed.sol";

contract MockSupraSValueFeed is ISupraSValueFeed {
    mapping(uint256 pairIndex => priceFeed priceData) public feeds;

    function setFeed(uint256 _pairIndex, uint256 _decimals, uint256 _price) external {
        feeds[_pairIndex] = priceFeed(
            block.timestamp * 1000,
            _decimals,
            block.timestamp * 1000,
            _price
        );
    }

    function setFeed(
        uint256 _pairIndex,
        uint256 _decimals,
        uint256 _price,
        uint256 _time
    ) external {
        feeds[_pairIndex] = priceFeed(_time * 1000, _decimals, _time * 1000, _price);
    }

    function getSvalue(uint256 _pairIndex) external view override returns (priceFeed memory) {
        return feeds[_pairIndex];
    }

    function getSvalues(
        uint256[] memory _pairIndexes
    ) external view override returns (priceFeed[] memory) {
        priceFeed[] memory priceFeeds = new priceFeed[](_pairIndexes.length);
        for (uint256 i = 0; i < _pairIndexes.length; i++) {
            priceFeeds[i] = feeds[_pairIndexes[i]];
        }
        return priceFeeds;
    }
}
