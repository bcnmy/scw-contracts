// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {UserOperation} from "../BaseAuthorizationModule.sol";

interface ISessionValidationModule {
    function validateSessionUserOp(
        UserOperation calldata _op,
        bytes32 _userOpHash,
        bytes calldata _data,
        bytes calldata _sig
    ) external view returns (bool);
}
