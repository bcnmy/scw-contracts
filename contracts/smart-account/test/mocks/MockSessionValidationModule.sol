// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import {ISessionValidationModule} from "../../modules/SessionValidationModules/ISessionValidationModule.sol";
import {UserOperation} from "@account-abstraction/contracts/interfaces/UserOperation.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract MockSessionValidationModule is ISessionValidationModule {
    function validateSessionParams(
        address destinationContract,
        uint256 callValue,
        bytes calldata _funcCallData,
        bytes calldata _sessionKeyData,
        bytes calldata /*_callSpecificData*/
    ) external virtual override returns (address) {
        (destinationContract, callValue, _funcCallData);
        address sessionKey = abi.decode(_sessionKeyData, (address));
        return sessionKey;
    }

    function validateSessionUserOp(
        UserOperation calldata _op,
        bytes32 _userOpHash,
        bytes calldata _sessionKeyData,
        bytes calldata _sessionKeySignature
    ) external pure override returns (bool) {
        require(
            bytes4(_op.callData[0:4]) == EXECUTE_OPTIMIZED_SELECTOR ||
                bytes4(_op.callData[0:4]) == EXECUTE_SELECTOR,
            "MockSV Invalid Selector"
        );

        address sessionKey = abi.decode(_sessionKeyData, (address));

        return
            ECDSA.recover(
                ECDSA.toEthSignedMessageHash(_userOpHash),
                _sessionKeySignature
            ) == sessionKey;
    }
}
