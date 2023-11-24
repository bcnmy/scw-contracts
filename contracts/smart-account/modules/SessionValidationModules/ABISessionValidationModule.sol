// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "../../interfaces/modules/ISessionValidationModule.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import "hardhat/console.sol";

/**
 * @title ABI Session Validation Module for Biconomy Smart Accounts.
 * @dev Validates userOps for any contract / method / params.
 *         -
 *
 * @author Fil Makarov - <filipp.makarov@biconomy.io>
 * Inspired by https://github.com/zerodevapp/kernel/blob/main/src/validator/SessionKeyValidator.sol
 */
contract ABISessionValidationModule is ISessionValidationModule {
    enum Condition {
        EQUAL,
        LESS_THAN_OR_EQUAL,
        LESS_THAN,
        GREATER_THAN_OR_EQUAL,
        GREATER_THAN,
        NOT_EQUAL
    }

    struct Rule {
        uint256 offset;
        bytes32 value;
        Condition condition;
    }

    struct Permission {
        address destinationContract;
        bytes4 selector;
        uint256 valueLimit;
        Rule[] rules;
    }

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

        console.log("SVM 1");
        //address sessionKey;
        //Permission calldata permission = _getPermission(_sessionKeyData[32:]);

        (address sessionKey, Permission memory permission) = abi
            .decode(_sessionKeyData, (address, Permission));

        console.log("SVM 2");
        console.logBytes(_sessionKeyData);

        console.log(
            permission.destinationContract,
            permission.valueLimit,
            permission.rules.length
        );

        {
            // we expect _op.callData to be `SmartAccount.execute(to, value, calldata)` calldata
            (address destinationContract, uint256 callValue, ) = abi.decode(
                _op.callData[4:], // skip selector
                (address, uint256, bytes)
            );
            if (destinationContract != permission.destinationContract) {
                revert("ABISV Wrong Destination");
            }
            if (callValue > permission.valueLimit) {
                revert("ABISV Value exceeded");
            }
        }

        bytes calldata data;
        {
            //offset represents where does the inner bytes array start
            uint256 offset = uint256(bytes32(_op.callData[4 + 64:4 + 96]));
            uint256 length = uint256(
                bytes32(_op.callData[4 + offset:4 + offset + 32])
            );
            data = _op.callData[4 + offset + 32:4 + offset + 32 + length];
        }

        if (!checkPermission(data, permission))
            revert("ABISV: Permission violated");
        
        return
            ECDSA.recover(
                ECDSA.toEthSignedMessageHash(_userOpHash),
                _sessionKeySignature
            ) == sessionKey;
    }

    /**
     * @dev validates that the call (destinationContract, callValue, funcCallData)
     * complies with the Session Key permissions represented by sessionKeyData
     * @param destinationContract address of the contract to be called
     * @param callValue value to be sent with the call
     * @param _funcCallData the data for the call. is parsed inside the SVM
     * @param _sessionKeyData SessionKey data, that describes sessionKey permissions
     * param _callSpecificData additional data, for example some proofs if the SVM utilizes merkle trees itself
     * for example to store a list of allowed tokens or receivers
     */
    function validateSessionParams(
        address destinationContract,
        uint256 callValue,
        bytes calldata _funcCallData,
        bytes calldata _sessionKeyData,
        bytes calldata /*_callSpecificData*/
    ) public virtual override returns (address) {
        Permission calldata permission = _getPermission(_sessionKeyData[20:]);

        if (destinationContract != permission.destinationContract) {
            revert("ABISV Wrong Destination");
        }
        if (callValue <= permission.valueLimit) {
            revert("ABISV Value exceeded");
        }

        if (!checkPermission(_funcCallData, permission))
            revert("ABISV: Permission violated");

        return address(bytes20(_sessionKeyData[0:20]));
    }


    function checkPermission(
        bytes calldata data,
        Permission memory permission
    ) internal pure returns (bool) {
        if (bytes4(data[0:4]) != permission.selector) return false;
        uint256 length = permission.rules.length;
        for (uint256 i; i < length; ) {
            Rule memory rule = permission.rules[i];
            bytes32 param = bytes32(data[4 + rule.offset:4 + rule.offset + 32]);
            if (rule.condition == Condition.EQUAL && param != rule.value) {
                return false;
            } else if (
                rule.condition == Condition.LESS_THAN_OR_EQUAL &&
                param > rule.value
            ) {
                return false;
            } else if (
                rule.condition == Condition.LESS_THAN && param >= rule.value
            ) {
                return false;
            } else if (
                rule.condition == Condition.GREATER_THAN_OR_EQUAL &&
                param < rule.value
            ) {
                return false;
            } else if (
                rule.condition == Condition.GREATER_THAN && param <= rule.value
            ) {
                return false;
            } else if (
                rule.condition == Condition.NOT_EQUAL && param == rule.value
            ) {
                return false;
            }
            unchecked {
                ++i;
            }
        }
        return true;
    }
}
