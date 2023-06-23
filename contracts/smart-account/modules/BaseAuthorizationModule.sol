// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {IAuthorizationModule, UserOperation} from "../interfaces/IAuthorizationModule.sol";
import {ISignatureValidator, ISignatureValidatorConstants} from "../interfaces/ISignatureValidator.sol";

contract AuthorizationModulesConstants {
    uint256 internal constant VALIDATION_SUCCESS = 0;
    uint256 internal constant SIG_VALIDATION_FAILED = 1;
}

abstract contract BaseAuthorizationModule is
    IAuthorizationModule,
    ISignatureValidator,
    AuthorizationModulesConstants
{}
