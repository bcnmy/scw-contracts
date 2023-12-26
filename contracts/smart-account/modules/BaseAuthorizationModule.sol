// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/* solhint-disable no-empty-blocks */

import {IBaseAuthorizationModule} from "../interfaces/modules/IBaseAuthorizationModule.sol";
import {AuthorizationModulesConstants} from "./AuthorizationModulesConstants.sol";

/// @dev Base contract for authorization modules
abstract contract BaseAuthorizationModule is
    IBaseAuthorizationModule,
    AuthorizationModulesConstants
{

}
