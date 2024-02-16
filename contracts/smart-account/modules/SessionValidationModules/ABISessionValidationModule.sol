// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "../../interfaces/modules/ISessionValidationModule.sol";

/**
 * @title ABI Session Validation Module for Biconomy Smart Accounts.
 * @dev Validates userOps for any contract / method / params.
 * The _sessionKeyData layout:
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
    uint256 private constant RULE_LENGTH = 35;
    uint256 private constant SELECTOR_LENGTH = 4;

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
        bytes calldata callData = _op.callData;

        require(
            bytes4(callData[0:4]) == EXECUTE_OPTIMIZED_SELECTOR ||
                bytes4(callData[0:4]) == EXECUTE_SELECTOR,
            "ABISV Not Execute Selector"
        );

        uint160 destContract;
        uint256 callValue;
        bytes calldata data;
        assembly {
            //offset of the first 32-byte arg is 0x4
            destContract := calldataload(add(callData.offset, SELECTOR_LENGTH))
            //offset of the second 32-byte arg is 0x24 = 0x4 (SELECTOR_LENGTH) + 0x20 (first 32-byte arg)
            callValue := calldataload(add(callData.offset, 0x24))

            //we get the data offset from the calldata itself, so no assumptions are made about the data layout
            let dataOffset := add(
                add(callData.offset, 0x04),
                //offset of the bytes arg is stored after selector and two first 32-byte args
                // 0x4+0x20+0x20=0x44
                calldataload(add(callData.offset, 0x44))
            )

            let length := calldataload(dataOffset)
            //data itself starts after the length which is another 32bytes word, so we add 0x20
            data.offset := add(dataOffset, 0x20)
            data.length := length
        }

        return
            _validateSessionParams(
                address(destContract),
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
        // every address is 20bytes
        address sessionKey = address(bytes20(_sessionKeyData[0:20]));
        address permittedDestinationContract = address(
            bytes20(_sessionKeyData[20:40])
        );
        // every selector is 4bytes
        bytes4 permittedSelector = bytes4(_sessionKeyData[40:44]);
        // value limit is encoded as uint128 which is 16 bytes length
        uint256 permittedValueLimit = uint256(
            uint128(bytes16(_sessionKeyData[44:60]))
        );
        // rules list length is encoded as uint16 which is 2 bytes length
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

        // avoided explicit check that (_sessionKeyData.length - 62) is the multiple of RULE_LENGTH
        // also avoided calculating the rules list length from the rules list itself
        // both to save on gas
        // there is a test case that demonstrates that if the incorrect rules list length is provided
        // the validation will fail
        if (
            !_checkRulesForPermission(
                _funcCallData,
                rulesListLength,
                bytes(_sessionKeyData[62:]) //the rest of the _sessionKeyData is the rules list
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

            // get the 32bytes word to verify against reference value from the actual calldata of the userOp
            bytes32 param = bytes32(
                data[SELECTOR_LENGTH + offset:SELECTOR_LENGTH + offset + 32]
            );

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
                    rulePassed := iszero(eq(param, value))
                }
            }

            if (!rulePassed) {
                return false;
            }
        }
        return true;
    }

    /**
     * @dev Parses a rule with a given index from the rules list
     * @param rules the rules list as a bytes array
     * @param index the index of the rule to be parsed
     * @return offset - the offset of the parameter in the calldata (multiplier of 32)
     * @return condition - the condition to be checked
     * @return value - the reference value to be checked against
     */
    function _parseRule(
        bytes calldata rules,
        uint256 index
    ) internal pure returns (uint256 offset, uint256 condition, bytes32 value) {
        // offset length is 2 bytes
        offset = uint256(
            uint16(bytes2(rules[index * RULE_LENGTH:index * RULE_LENGTH + 2]))
        );
        // condition length is 1 byte
        condition = uint256(
            uint8(
                bytes1(rules[index * RULE_LENGTH + 2:index * RULE_LENGTH + 3])
            )
        );
        // value length is 32 bytes
        value = bytes32(
            rules[index * RULE_LENGTH + 3:index * RULE_LENGTH + RULE_LENGTH]
        );
    }
}