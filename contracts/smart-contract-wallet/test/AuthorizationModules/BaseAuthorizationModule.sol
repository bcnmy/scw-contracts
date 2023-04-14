// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {IModule} from "../../interfaces/IModule.sol";
import {ISignatureValidator} from "../../interfaces/ISignatureValidator.sol";

abstract contract BaseAuthorizationModule is IModule, ISignatureValidator {
    uint256 internal constant SIG_VALIDATION_FAILED = 1;
}
