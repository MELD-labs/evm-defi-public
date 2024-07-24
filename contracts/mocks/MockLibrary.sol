// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {ReserveLogic} from "../libraries/logic/ReserveLogic.sol";
import {UserConfiguration} from "../libraries/configuration/UserConfiguration.sol";
import {DataTypes} from "../libraries/types/DataTypes.sol";

library MockLibrary {
    using ReserveLogic for DataTypes.ReserveData;
    using UserConfiguration for DataTypes.UserConfigurationMap;

    struct MockStruct {
        address user;
        uint256 num;
    }

    event MockEvent(address indexed reserve, address indexed user, uint256 num);

    function executeMockFunction(
        mapping(address asset => MockStruct data) storage _mockMapping,
        address _asset,
        address _user,
        uint256 _num
    ) public {
        MockStruct storage data = _mockMapping[_asset];
        data.user = _user;
        data.num = _num;
        emit MockEvent(_asset, _user, _num);
    }
}
