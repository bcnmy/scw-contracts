// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {IAuthorizationModule} from "../../interfaces/IAuthorizationModule.sol";
import {ISignatureValidator} from "../../interfaces/ISignatureValidator.sol";

/* solhint-disable no-empty-blocks */
interface IBaseAuthorizationModule is
    IAuthorizationModule,
    ISignatureValidator
{

}
