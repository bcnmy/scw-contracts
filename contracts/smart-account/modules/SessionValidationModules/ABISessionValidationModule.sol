// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "../../interfaces/modules/ISessionValidationModule.sol";

/**
 * @title ABI Session Validation Module for Biconomy Smart Accounts.
 * @dev Validates userOps for any contract / method / params.
 *      The _sessionKeyData layout:
 * Offset (in bytes)    | Length (in bytes) | Contents
 * 0x0                  | 0x14              | Session key (address)
 * 0x14                 | 0x14              | Permitted destination contract (address)
 * 0x28                 | 0x4               | Permitted selector (bytes4)
 * 0x2c                 | 0x10              | Permitted value limit (uint128)
 * 0x3c                 | 0x2               | Rules list length (uint16)
 * 0x3e + 0x23*N        | 0x23              | Rule #N
 *
 * Rule layout:
 * Offset (in bytes)    | Length (in bytes) | Contents
 * 0x0                  | 0x2               | Offset (uint16)
 * 0x2                  | 0x1               | Condition (uint8)
 * 0x3                  | 0x20              | Value (bytes32)
 *
 * Condition is a uint8, and can be one of the following:
 * 0: EQUAL
 * 1: LESS_THAN_OR_EQUAL
 * 2: LESS_THAN
 * 3: GREATER_THAN_OR_EQUAL
 * 4: GREATER_THAN
 * 5: NOT_EQUAL
 *
 * Inspired by https://github.com/zerodevapp/kernel/blob/main/src/validator/SessionKeyValidator.sol
 */
contract ABISessionValidationModule is ISessionValidationModule {
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
            "ABISV Not Execute Selector"
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
     * param _callSpecificData additional data, specific to the call, not used here
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
    function _validateSessionParams(
        address destinationContract,
        uint256 callValue,
        bytes calldata _funcCallData,
        bytes calldata _sessionKeyData
    ) internal pure virtual returns (address) {
        address sessionKey = address(bytes20(_sessionKeyData[0:20]));
        address permittedDestinationContract = address(
            bytes20(_sessionKeyData[20:40])
        );
        bytes4 permittedSelector = bytes4(_sessionKeyData[40:44]);
        uint256 permittedValueLimit = uint256(
            uint128(bytes16(_sessionKeyData[44:60]))
        );
        uint256 rulesListLength = uint256(
            uint16(bytes2(_sessionKeyData[60:62]))
        );

        if (destinationContract != permittedDestinationContract) {
            revert("ABISV Destination Forbidden");
        }

        if (bytes4(_funcCallData[0:4]) != permittedSelector) {
            revert("ABISV Selector Forbidden");
        }

        if (callValue > permittedValueLimit) {
            revert("ABISV Permitted Value Exceeded");
        }

        if (
            !_checkRulesForPermission(
                _funcCallData,
                rulesListLength,
                bytes(_sessionKeyData[62:])
            )
        ) {
            revert("ABISV Arg Rule Violated");
        }

        return sessionKey;
    }

    /**
     * @dev checks if the calldata matches the permission
     * @param data the data for the call. is parsed inside the SVM
     * @param rulesListLength the length of the rules list
     * @param rules the rules list
     * @return true if the calldata matches the permission, false otherwise
     */
    function _checkRulesForPermission(
        bytes calldata data,
        uint256 rulesListLength,
        bytes calldata rules
    ) internal pure returns (bool) {
        for (uint256 i; i < rulesListLength; ++i) {
            (uint256 offset, uint256 condition, bytes32 value) = _parseRule(
                rules,
                i
            );

            bytes32 param = bytes32(data[4 + offset:4 + offset + 32]);

            bool rulePassed;
            assembly ("memory-safe") {
                switch condition
                case 0 {
                    // Condition.EQUAL
                    rulePassed := eq(param, value)
                }
                case 1 {
                    // Condition.LESS_THAN_OR_EQUAL
                    rulePassed := or(lt(param, value), eq(param, value))
                }
                case 2 {
                    // Condition.LESS_THAN
                    rulePassed := lt(param, value)
                }
                case 3 {
                    // Condition.GREATER_THAN_OR_EQUAL
                    rulePassed := or(gt(param, value), eq(param, value))
                }
                case 4 {
                    // Condition.GREATER_THAN
                    rulePassed := gt(param, value)
                }
                case 5 {
                    // Condition.NOT_EQUAL
                    rulePassed := not(eq(param, value))
                }
            }

            if (!rulePassed) {
                return false;
            }
        }
        return true;
    }

    function _parseRule(
        bytes calldata rules,
        uint256 index
    ) internal pure returns (uint256 offset, uint256 condition, bytes32 value) {
        offset = uint256(uint16(bytes2(rules[index * 35:index * 35 + 2])));
        condition = uint256(
            uint8(bytes1(rules[index * 35 + 2:index * 35 + 3]))
        );
        value = bytes32(rules[index * 35 + 3:index * 35 + 35]);
    }
}
