// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import {ISessionValidationModule} from "../../modules/SessionValidationModules/ISessionValidationModule.sol";
import {UserOperation} from "../../modules/BaseAuthorizationModule.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract MockSessionValidationModule is ISessionValidationModule {
    function validateSessionUserOp(
        UserOperation calldata _op,
        bytes32 _userOpHash,
        bytes calldata _data,
        bytes calldata _sig
    ) external view returns (bool) {
        address sessionKey = address(bytes20(_data[0:20]));
        return
            ECDSA.recover(ECDSA.toEthSignedMessageHash(_userOpHash), _sig) ==
            sessionKey;
    }
}
