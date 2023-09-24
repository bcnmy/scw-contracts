// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;
import "./ISessionValidationModule.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract NativeTransferSessionValidationModule is ISessionValidationModule {
    error SubscriptionUtilised();

    uint256 public lastPaymentTimestamp;

    function validateSessionParams(
        address destinationContract,
        uint256 callValue,
        bytes calldata _funcCallData,
        bytes calldata _sessionKeyData,
        bytes calldata /*_callSpecificData*/
    ) external virtual override returns (address) {
        (destinationContract);
        (
            address sessionKey,
            address recipient,
            uint256 subscriptionAmount
        ) = abi.decode(_sessionKeyData, (address, address, uint256));

        require(callValue == 0, "Non Zero Value");

        (address recipientCalled, uint256 amount) = abi.decode(
            _funcCallData[4:],
            (address, uint256)
        );

        require(recipient == recipientCalled, "Wrong Recipient");
        require(amount <= subscriptionAmount, "Max Amount Exceeded");
        return sessionKey;
    }

    function validateSessionUserOp(
        UserOperation calldata _op,
        bytes32 _userOpHash,
        bytes calldata _sessionKeyData,
        bytes calldata _sessionKeySignature
    ) external override returns (bool) {
        require(
            bytes4(_op.callData[0:4]) == EXECUTE_OPTIMIZED_SELECTOR ||
                bytes4(_op.callData[0:4]) == EXECUTE_SELECTOR,
            "Invalid Selector"
        );
        (
            address sessionKey,
            address recipient,
            uint256 subscriptionAmount
        ) = abi.decode(_sessionKeyData, (address, address, uint256));

        if (
            block.timestamp - lastPaymentTimestamp < 30 days &&
            lastPaymentTimestamp != 0
        ) {
            revert SubscriptionUtilised();
        }
        lastPaymentTimestamp = block.timestamp;

        (address target, uint256 callValue /*bytes memory func*/, ) = abi
            .decode(
                _op.callData[4:], // skip selector
                (address, uint256, bytes)
            );
        if (callValue != 0) {
            revert("Non Zero Value");
        }
        /*if (func.length != 0) {
            revert("Must be native transfer"); 
        }*/
        if (callValue > subscriptionAmount) {
            revert("Max Amount Exceeded");
        }
        if (target != recipient) {
            revert("Wrong Recipient");
        }

        return
            ECDSA.recover(
                ECDSA.toEthSignedMessageHash(_userOpHash),
                _sessionKeySignature
            ) == sessionKey;
    }
}
