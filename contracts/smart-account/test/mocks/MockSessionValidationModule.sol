// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

import {ISessionValidationModule} from "../../interfaces/modules/ISessionValidationModule.sol";
import {UserOperation} from "@account-abstraction/contracts/interfaces/UserOperation.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract MockSessionValidationModule is ISessionValidationModule {
    event ValidateSessionParams(
        address destinationContract,
        uint256 callValue,
        bytes funcCallData,
        bytes sessionKeyData,
        bytes callSpecificData
    );

    function validateSessionUserOp(
        UserOperation calldata _op,
        bytes32 _userOpHash,
        bytes calldata _data,
        bytes calldata _sig
    ) external pure override returns (bool) {
        (_op);
        address sessionKey = address(bytes20(_data[0:20]));
        return
            ECDSA.recover(ECDSA.toEthSignedMessageHash(_userOpHash), _sig) ==
            sessionKey;
    }

    function validateSessionParams(
        address destinationContract,
        uint256 callValue,
        bytes calldata funcCallData,
        bytes calldata sessionKeyData,
        bytes calldata callSpecificData
    ) external override returns (address) {
        emit ValidateSessionParams(
            destinationContract,
            callValue,
            funcCallData,
            sessionKeyData,
            callSpecificData
        );

        address sessionKey = address(bytes20(sessionKeyData[0:20]));
        return sessionKey;
    }
}
