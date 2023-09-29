// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/* solhint-disable no-empty-blocks */

import {IAuthorizationModule} from "../interfaces/IAuthorizationModule.sol";
import {ISignatureValidator} from "../interfaces/ISignatureValidator.sol";

contract AuthorizationModulesConstants {
    uint256 internal constant VALIDATION_SUCCESS = 0;
    uint256 internal constant SIG_VALIDATION_FAILED = 1;
}

abstract contract BaseAuthorizationModule is
    IAuthorizationModule,
    ISignatureValidator,
    AuthorizationModulesConstants
{}
