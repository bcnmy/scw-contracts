// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;
import "../../interfaces/modules/SessionValidationModules/IABISessionValidationModule.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title ABI Session Validation Module for Biconomy Smart Accounts.
 * @dev Validates userOps for any contract / method / params.
 *         -
 *
 * Inspired by https://github.com/zerodevapp/kernel/blob/main/src/validator/SessionKeyValidator.sol
 */
contract ABISessionValidationModule is IABISessionValidationModule {
    /**
     * @dev validates if the _op (UserOperation) matches the SessionKey permissions
     * and that _op has been signed by this SessionKey
     * Please mind the decimals of your exact token when setting maxAmount
     * @param _op User Operation to be validated.
     * @param _userOpHash Hash of the User Operation to be validated.
     * @param _sessionKeyData SessionKey data, that describes sessionKey permissions
     * @param _sessionKeySignature Signature over the the _userOpHash.
     * @return true if the _op is valid, false otherwise.
     */
    function validateSessionUserOp(
        UserOperation calldata _op,
        bytes32 _userOpHash,
        bytes calldata _sessionKeyData,
        bytes calldata _sessionKeySignature
    ) external pure override returns (bool) {
        require(
            bytes4(_op.callData[0:4]) == EXECUTE_OPTIMIZED_SELECTOR ||
                bytes4(_op.callData[0:4]) == EXECUTE_SELECTOR,
            "ABISV Invalid Selector"
        );

        bytes calldata callData = _op.callData;
        address destContract;
        uint256 callValue;
        bytes calldata data;
        assembly {
            destContract := calldataload(add(callData.offset, 0x4))
            callValue := calldataload(add(callData.offset, 0x24))

            let dataOffset := add(
                add(callData.offset, 0x04),
                calldataload(add(callData.offset, 0x44))
            )

            let length := calldataload(dataOffset)
            data.offset := add(dataOffset, 0x20)
            data.length := length
        }

        return
            _validateSessionParams(
                destContract,
                callValue,
                data,
                _sessionKeyData
            ) ==
            ECDSA.recover(
                ECDSA.toEthSignedMessageHash(_userOpHash),
                _sessionKeySignature
            );
    }

    /**
     * @dev validates that the call (destinationContract, callValue, funcCallData)
     * complies with the Session Key permissions represented by sessionKeyData
     * @param destinationContract address of the contract to be called
     * @param callValue value to be sent with the call
     * @param _funcCallData the data for the call. is parsed inside the SVM
     * @param _sessionKeyData SessionKey data, that describes sessionKey permissions
     * @return sessionKey address of the sessionKey that signed the userOp
     * for example to store a list of allowed tokens or receivers
     */
    function validateSessionParams(
        address destinationContract,
        uint256 callValue,
        bytes calldata _funcCallData,
        bytes calldata _sessionKeyData,
        bytes memory /*_callSpecificData*/
    ) external pure virtual override returns (address) {
        return
            _validateSessionParams(
                destinationContract,
                callValue,
                _funcCallData,
                _sessionKeyData
            );
    }

    function _validateSessionParams(
        address destinationContract,
        uint256 callValue,
        bytes calldata _funcCallData,
        bytes calldata _sessionKeyData
    ) internal pure virtual returns (address) {
        address sessionKey;
        Permission calldata permission;
        assembly {
            sessionKey := calldataload(_sessionKeyData.offset)
            // struct in calldata is defined by its offset
            // for bytes calldata bytesObject we define bytesObject.offset and bytesObject.length,
            // for struct calldata structObject we define structObject = offset
            permission := add(
                _sessionKeyData.offset,
                calldataload(add(_sessionKeyData.offset, 0x20))
            )
        }

        if (destinationContract != permission.destinationContract) {
            revert("ABISV Wrong Destination");
        }
        if (callValue > permission.valueLimit) {
            revert("ABISV Value exceeded");
        }

        if (!_checkPermission(_funcCallData, permission))
            revert("ABISV: Permission violated");

        return sessionKey;
    }

    function _checkPermission(
        bytes calldata data,
        Permission calldata permission
    ) internal pure returns (bool) {
        if (bytes4(data[0:4]) != permission.selector) return false;
        uint256 length = permission.rules.length;
        for (uint256 i; i < length; ) {
            Rule calldata rule = permission.rules[i];
            Condition condition = rule.condition;
            uint256 offset = rule.offset;
            bytes32 value = rule.value;
            bytes32 param = bytes32(data[4 + offset:4 + offset + 32]);
            if (condition == Condition.EQUAL && param != value) {
                return false;
            } else if (
                condition == Condition.LESS_THAN_OR_EQUAL && param > value
            ) {
                return false;
            } else if (condition == Condition.LESS_THAN && param >= value) {
                return false;
            } else if (
                condition == Condition.GREATER_THAN_OR_EQUAL && param < value
            ) {
                return false;
            } else if (condition == Condition.GREATER_THAN && param <= value) {
                return false;
            } else if (condition == Condition.NOT_EQUAL && param == value) {
                return false;
            }
            unchecked {
                ++i;
            }
        }
        return true;
    }
}
