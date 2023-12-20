// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/* solhint-disable function-max-lines*/
/* solhint-disable ordering*/

import {_packValidationData} from "@account-abstraction/contracts/core/Helpers.sol";
import {UserOperation, UserOperationLib} from "@account-abstraction/contracts/interfaces/UserOperation.sol";
import {ISessionValidationModule} from "../../interfaces/modules/ISessionValidationModule.sol";
import {ISessionKeyManagerModuleHybrid} from "../../interfaces/modules/SessionKeyManagers/ISessionKeyManagerModuleHybrid.sol";
import {ISignatureValidator, EIP1271_MAGIC_VALUE} from "../../interfaces/ISignatureValidator.sol";
import {StatefulSessionKeyManagerBase} from "./StatefulSessionKeyManagerBase.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "forge-std/console2.sol";

/**
 * @title Session Key Manager module for Biconomy Modular Smart Accounts.
 * @dev Similar to the Stateful Session Key Manager module, but the session enable transaction
 *      is batched with the first transaction that uses the session key.
 *      Session creation is offline.
 * @author Ankur Dubey - <ankur@biconomy.io>
 * @author Fil Makarov - <filipp.makarov@biconomy.io>
 */
contract SessionKeyManagerHybrid is
    StatefulSessionKeyManagerBase,
    ISessionKeyManagerModuleHybrid
{
    using UserOperationLib for UserOperation;

    /// @inheritdoc StatefulSessionKeyManagerBase
    function validateUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash
    ) external virtual override returns (uint256 rv) {
        uint256 gas = gasleft();

        if (_isBatchExecuteCall(userOp)) {
            rv = _validateUserOpBatchExecute(userOp, userOpHash);
        } else {
            rv = _validateUserOpSingleExecute(userOp, userOpHash);
        }

        console2.log("SessionKeyManagerHybrid.validateUserOp", gas - gasleft());
    }

    /***************************** Single Call Handler ***********************************/

    function _validateUserOpSingleExecute(
        UserOperation calldata userOp,
        bytes32 userOpHash
    ) internal returns (uint256 rv) {
        /*
         * Module Signature Layout
         * Offset (in bytes)    | Length (in bytes) | Contents
         * 0x0                  | 0x1               | 0x01 if sessionEnableTransaction, 0x00 otherwise
         * 0x1                  | --                | Data depending on the above flag
         */
        bytes calldata moduleSignature = userOp.signature[96:];

        if (_isSessionEnableTransaction(moduleSignature)) {
            (
                uint256 sessionKeyIndex,
                uint48 validUntil,
                uint48 validAfter,
                address sessionValidationModule,
                bytes calldata sessionKeyData,
                bytes calldata sessionEnableData,
                bytes calldata sessionEnableSignature,
                bytes calldata sessionKeySignature
            ) = _parseSessionEnableSignatureSingleCall(moduleSignature);

            _verifySessionEnableDataSignature(
                sessionEnableData,
                sessionEnableSignature,
                userOp.getSender()
            );

            _validateSessionKeySessionEnableTransaction(
                validUntil,
                validAfter,
                sessionKeyIndex,
                sessionValidationModule,
                sessionKeyData,
                sessionEnableData
            );

            rv = _packValidationData(
                //_packValidationData expects true if sig validation has failed, false otherwise
                !ISessionValidationModule(sessionValidationModule)
                    .validateSessionUserOp(
                        userOp,
                        userOpHash,
                        sessionKeyData,
                        sessionKeySignature
                    ),
                validUntil,
                validAfter
            );
        } else {
            (
                bytes32 sessionDataDigest,
                bytes calldata sessionKeySignature
            ) = _parseSessionDataPreEnabledSignatureSingleCall(moduleSignature);

            SessionData storage sessionData = _validateSessionKeyPreEnabled(
                userOp.getSender(),
                sessionDataDigest
            );

            rv = _packValidationData(
                //_packValidationData expects true if sig validation has failed, false otherwise
                !ISessionValidationModule(sessionData.sessionValidationModule)
                    .validateSessionUserOp(
                        userOp,
                        userOpHash,
                        sessionData.sessionKeyData,
                        sessionKeySignature
                    ),
                sessionData.validUntil,
                sessionData.validAfter
            );
        }
    }

    /***************************** Single Call Parsers ***********************************/

    function _parseSessionEnableSignatureSingleCall(
        bytes calldata _moduleSignature
    )
        internal
        pure
        returns (
            uint256 sessionKeyIndex,
            uint48 validUntil,
            uint48 validAfter,
            address sessionValidationModule,
            bytes calldata sessionKeyData,
            bytes calldata sessionEnableData,
            bytes calldata sessionEnableSignature,
            bytes calldata sessionKeySignature
        )
    {
        /*
         * Session Enable Signature Layout
         * Offset (in bytes)    | Length (in bytes) | Contents
         * 0x0                  | 0x1               | Is Session Enable Transaction Flag
         * 0x1                  | 0x1               | Index of Session Key in Session Enable Data
         * 0x2                  | 0x6               | Valid Until
         * 0x8                  | 0x6               | Valid After
         * 0xe                  | 0x14              | Session Validation Module Address
         * 0x22                 | --                | abi.encode(sessionKeyData, sessionEnableData,
         *                      |                   |   sessionEnableSignature, sessionKeySignature)
         */
        assembly ("memory-safe") {
            let offset := add(_moduleSignature.offset, 0x1)

            sessionKeyIndex := shr(248, calldataload(offset))
            offset := add(offset, 0x1)

            validUntil := shr(208, calldataload(offset))
            offset := add(offset, 0x6)

            validAfter := shr(208, calldataload(offset))
            offset := add(offset, 0x6)

            sessionValidationModule := shr(96, calldataload(offset))
            offset := add(offset, 0x14)

            let baseOffset := offset
            let dataPointer := add(baseOffset, calldataload(offset))

            sessionKeyData.offset := add(dataPointer, 0x20)
            sessionKeyData.length := calldataload(dataPointer)
            offset := add(offset, 0x20)

            dataPointer := add(baseOffset, calldataload(offset))
            sessionEnableData.offset := add(dataPointer, 0x20)
            sessionEnableData.length := calldataload(dataPointer)
            offset := add(offset, 0x20)

            dataPointer := add(baseOffset, calldataload(offset))
            sessionEnableSignature.offset := add(dataPointer, 0x20)
            sessionEnableSignature.length := calldataload(dataPointer)
            offset := add(offset, 0x20)

            dataPointer := add(baseOffset, calldataload(offset))
            sessionKeySignature.offset := add(dataPointer, 0x20)
            sessionKeySignature.length := calldataload(dataPointer)
        }
    }

    function _parseSessionDataPreEnabledSignatureSingleCall(
        bytes calldata _moduleSignature
    )
        internal
        pure
        returns (bytes32 sessionDataDigest, bytes calldata sessionKeySignature)
    {
        /*
         * Session Data Pre Enabled Signature Layout
         * Offset (in bytes)    | Length (in bytes) | Contents
         * 0x0                  | 0x1               | Is Session Enable Transaction Flag
         * 0x1                  | --                | abi.encode(bytes32 sessionDataDigest, sessionKeySignature)
         */
        assembly ("memory-safe") {
            let offset := add(_moduleSignature.offset, 0x1)
            let baseOffset := offset

            sessionDataDigest := calldataload(offset)
            offset := add(offset, 0x20)

            let dataPointer := add(baseOffset, calldataload(offset))
            sessionKeySignature.offset := add(dataPointer, 0x20)
            sessionKeySignature.length := calldataload(dataPointer)
        }
    }

    /***************************** Batch Call Handler ***********************************/

    function _validateUserOpBatchExecute(
        UserOperation calldata userOp,
        bytes32 userOpHash
    ) internal returns (uint256) {
        // Parse session enable data, signature list and main session signature
        (
            bytes[] calldata sessionEnableDataList,
            bytes[] calldata sessionEnableSignatureList,
            bytes[] calldata sessionInfos,
            bytes calldata sessionKeySignature
        ) = _parseValidateUserOpBatchSignature(userOp.signature[96:]);

        // Pre-verify all session enable data signatures
        address userOpSender = userOp.getSender();
        _verifySessionEnableDataSignatures(
            sessionEnableDataList,
            sessionEnableSignatureList,
            userOpSender
        );

        // Calcuate the expected common signer of each operation
        address expectedSessionKeySigner = ECDSA.recover(
            ECDSA.toEthSignedMessageHash(userOpHash),
            sessionKeySignature
        );

        // Parse batch call calldata to get to,value,calldatas for every operation
        uint256 length = sessionInfos.length;
        (
            address[] calldata destinations,
            uint256[] calldata callValues,
            bytes[] calldata operationCalldatas
        ) = _parseBatchCallCalldata(userOp.callData);
        require(
            destinations.length == length,
            "SKM: SessionInfo length mismatch"
        );

        // For each operation in the batch, verify it using the corresponding session key
        // Also find the earliest validUntil and latest validAfter
        uint48 earliestValidUntil = type(uint48).max;
        uint48 latestValidAfter;
        for (uint256 i = 0; i < length; ) {
            bytes calldata sessionInfo = sessionInfos[i];
            uint48 validUntil;
            uint48 validAfter;
            address sessionKeyReturned;

            if (_isSessionEnableTransaction(sessionInfo)) {
                (
                    uint256 sessionKeyEnableDataIndex,
                    uint256 sessionKeyIndex,
                    uint48 _validUntil,
                    uint48 _validAfter,
                    address sessionValidationModule,
                    bytes calldata sessionKeyData,
                    bytes calldata callSpecificData
                ) = _parseSessionEnableSignatureBatchCall(sessionInfo);

                validUntil = _validUntil;
                validAfter = _validAfter;

                if (sessionKeyEnableDataIndex >= sessionEnableDataList.length) {
                    revert("SKM: SKEnableDataIndexInvalid");
                }

                _validateSessionKeySessionEnableTransaction(
                    validUntil,
                    validAfter,
                    sessionKeyIndex,
                    sessionValidationModule,
                    sessionKeyData,
                    sessionEnableDataList[sessionKeyEnableDataIndex] // The signature has already been verified
                );

                sessionKeyReturned = ISessionValidationModule(
                    sessionValidationModule
                ).validateSessionParams(
                        destinations[i],
                        callValues[i],
                        operationCalldatas[i],
                        sessionKeyData,
                        callSpecificData
                    );
            } else {
                (
                    bytes32 sessionDataDigest,
                    bytes calldata callSpecificData
                ) = _parseSessionDataPreEnabledSignatureBatchCall(sessionInfo);

                SessionData storage sessionData = _validateSessionKeyPreEnabled(
                    userOpSender,
                    sessionDataDigest
                );

                validUntil = sessionData.validUntil;
                validAfter = sessionData.validAfter;

                sessionKeyReturned = ISessionValidationModule(
                    sessionData.sessionValidationModule
                ).validateSessionParams(
                        destinations[i],
                        callValues[i],
                        operationCalldatas[i],
                        sessionData.sessionKeyData,
                        callSpecificData
                    );
            }

            // compare if userOp was signed with the proper session key
            if (expectedSessionKeySigner != sessionKeyReturned)
                return SIG_VALIDATION_FAILED;

            // intersect validUntils and validAfters
            if (validUntil != 0 && validUntil < earliestValidUntil) {
                earliestValidUntil = validUntil;
            }
            if (validAfter > latestValidAfter) {
                latestValidAfter = validAfter;
            }

            unchecked {
                ++i;
            }
        }

        return
            _packValidationData(
                false, // sig validation failed = false; if we are here, it is valid
                earliestValidUntil,
                latestValidAfter
            );
    }

    function _verifySessionEnableDataSignatures(
        bytes[] calldata sessionEnableDataList,
        bytes[] calldata sessionEnableSignatureList,
        address userOpSender
    ) internal view {
        uint256 length = sessionEnableDataList.length;
        if (length != sessionEnableSignatureList.length) {
            revert("SKM: EDListLengthMismatch");
        }
        for (uint256 i = 0; i < length; ) {
            _verifySessionEnableDataSignature(
                sessionEnableDataList[i],
                sessionEnableSignatureList[i],
                userOpSender
            );
            unchecked {
                ++i;
            }
        }
    }

    /***************************** Batch Call Parsers ***********************************/

    function _parseValidateUserOpBatchSignature(
        bytes calldata _moduleSignature
    )
        internal
        pure
        returns (
            bytes[] calldata sessionEnableDataList,
            bytes[] calldata sessionEnableSignatureList,
            bytes[] calldata sessionInfos,
            bytes calldata sessionKeySignature
        )
    {
        {
            /*
             * Module Signature Layout
             * abi.encode(bytes[] sessionEnableDataList, bytes[] sessionEnableSignatureList, bytes[] sessionInfo, bytes sessionKeySignature)
             */
            assembly ("memory-safe") {
                let offset := _moduleSignature.offset
                let baseOffset := offset

                let dataPointer := add(baseOffset, calldataload(offset))
                sessionEnableDataList.offset := add(dataPointer, 0x20)
                sessionEnableDataList.length := calldataload(dataPointer)
                offset := add(offset, 0x20)

                dataPointer := add(baseOffset, calldataload(offset))
                sessionEnableSignatureList.offset := add(dataPointer, 0x20)
                sessionEnableSignatureList.length := calldataload(dataPointer)
                offset := add(offset, 0x20)

                dataPointer := add(baseOffset, calldataload(offset))
                sessionInfos.offset := add(dataPointer, 0x20)
                sessionInfos.length := calldataload(dataPointer)
                offset := add(offset, 0x20)

                dataPointer := add(baseOffset, calldataload(offset))
                sessionKeySignature.offset := add(dataPointer, 0x20)
                sessionKeySignature.length := calldataload(dataPointer)
            }
        }
    }

    function _parseSessionDataPreEnabledSignatureBatchCall(
        bytes calldata _moduleSignature
    )
        internal
        pure
        returns (bytes32 sessionDataDigest, bytes calldata callSpecificData)
    {
        /*
         * Session Data Pre Enabled Signature Layout
         * Offset (in bytes)    | Length (in bytes) | Contents
         * 0x0                  | 0x1               | Is Session Enable Transaction Flag
         * 0x1                  | 0x20              | bytes32 sessionDataDigest
         * 0x21                 | ---               | abi.encode(callSpecificData)
         */
        assembly ("memory-safe") {
            let offset := add(_moduleSignature.offset, 0x1)

            sessionDataDigest := calldataload(offset)
            offset := add(offset, 0x20)

            let baseOffset := offset
            let dataPointer := add(baseOffset, calldataload(offset))

            callSpecificData.offset := add(dataPointer, 0x20)
            callSpecificData.length := calldataload(dataPointer)
        }
    }

    function _parseSessionEnableSignatureBatchCall(
        bytes calldata _moduleSignature
    )
        internal
        pure
        returns (
            uint256 sessionEnableDataIndex,
            uint256 sessionKeyIndex,
            uint48 validUntil,
            uint48 validAfter,
            address sessionValidationModule,
            bytes calldata sessionKeyData,
            bytes calldata callSpecificData
        )
    {
        /*
         * Session Enable Signature Layout
         * Offset (in bytes)    | Length (in bytes) | Contents
         * 0x0                  | 0x1               | Is Session Enable Transaction Flag
         * 0x1                  | 0x1               | Index of Session Enable Data in Session Enable Data List
         * 0x2                  | 0x1               | Index of Session Key in Session Enable Data
         * 0x3                  | 0x6               | Valid Until
         * 0x9                  | 0x6               | Valid After
         * 0xf                  | 0x14              | Session Validation Module Address
         * 0x23                 | --                | abi.encode(sessionKeyData, callSpecificData)
         */
        assembly ("memory-safe") {
            let offset := add(_moduleSignature.offset, 0x1)

            sessionEnableDataIndex := shr(248, calldataload(offset))
            offset := add(offset, 0x1)

            sessionKeyIndex := shr(248, calldataload(offset))
            offset := add(offset, 0x1)

            validUntil := shr(208, calldataload(offset))
            offset := add(offset, 0x6)

            validAfter := shr(208, calldataload(offset))
            offset := add(offset, 0x6)

            sessionValidationModule := shr(96, calldataload(offset))
            offset := add(offset, 0x14)

            let baseOffset := offset
            let dataPointer := add(baseOffset, calldataload(offset))

            sessionKeyData.offset := add(dataPointer, 0x20)
            sessionKeyData.length := calldataload(dataPointer)
            offset := add(offset, 0x20)

            dataPointer := add(baseOffset, calldataload(offset))
            callSpecificData.offset := add(dataPointer, 0x20)
            callSpecificData.length := calldataload(dataPointer)
        }
    }

    function _parseBatchCallCalldata(
        bytes calldata _userOpCalldata
    )
        internal
        pure
        returns (
            address[] calldata destinations,
            uint256[] calldata callValues,
            bytes[] calldata operationCalldatas
        )
    {
        assembly ("memory-safe") {
            let offset := add(_userOpCalldata.offset, 0x4)
            let baseOffset := offset

            let dataPointer := add(baseOffset, calldataload(offset))
            destinations.offset := add(dataPointer, 0x20)
            destinations.length := calldataload(dataPointer)
            offset := add(offset, 0x20)

            dataPointer := add(baseOffset, calldataload(offset))
            callValues.offset := add(dataPointer, 0x20)
            callValues.length := calldataload(dataPointer)
            offset := add(offset, 0x20)

            dataPointer := add(baseOffset, calldataload(offset))
            operationCalldatas.offset := add(dataPointer, 0x20)
            operationCalldatas.length := calldataload(dataPointer)
        }
    }

    /***************************** Common ***********************************/

    function _verifySessionEnableDataSignature(
        bytes calldata _sessionEnableData,
        bytes calldata _sessionEnableSignature,
        address _smartAccount
    ) internal view {
        // Verify the signature on the session enable data
        bytes32 sessionEnableDataDigest = keccak256(_sessionEnableData);
        if (
            ISignatureValidator(_smartAccount).isValidSignature(
                sessionEnableDataDigest,
                _sessionEnableSignature
            ) != EIP1271_MAGIC_VALUE
        ) {
            revert("SessionNotApproved");
        }
    }

    function _validateSessionKeySessionEnableTransaction(
        uint48 validUntil,
        uint48 validAfter,
        uint256 sessionKeyIndex,
        address sessionValidationModule,
        bytes calldata sessionKeyData,
        bytes calldata sessionEnableData
    ) internal {
        (
            uint64 sessionChainId,
            bytes32 sessionDigest
        ) = _parseSessionFromSessionEnableData(
                sessionEnableData,
                sessionKeyIndex
            );

        if (sessionChainId != block.chainid) {
            revert("SessionChainIdMismatch");
        }

        bytes32 computedDigest = _sessionDataDigestUnpacked(
            validUntil,
            validAfter,
            sessionValidationModule,
            sessionKeyData
        );

        if (sessionDigest != computedDigest) {
            revert("SessionKeyDataHashMismatch");
        }

        // Cache the session key data in the smart account storage for next validation
        SessionData memory sessionData = SessionData({
            validUntil: validUntil,
            validAfter: validAfter,
            sessionValidationModule: sessionValidationModule,
            sessionKeyData: sessionKeyData
        });
        _enabledSessionsData[computedDigest][msg.sender] = sessionData;
        emit SessionCreated(msg.sender, computedDigest, sessionData);
    }

    function _validateSessionKeyPreEnabled(
        address smartAccount,
        bytes32 sessionKeyDataDigest
    ) internal view returns (SessionData storage sessionData) {
        sessionData = _enabledSessionsData[sessionKeyDataDigest][smartAccount];
        require(
            sessionData.sessionValidationModule != address(0),
            "SKM: Session key is not enabled"
        );
    }

    function _isSessionEnableTransaction(
        bytes calldata _moduleSignature
    ) internal pure returns (bool isSessionEnableTransaction) {
        assembly ("memory-safe") {
            isSessionEnableTransaction := shr(
                248,
                calldataload(_moduleSignature.offset)
            )
        }
    }

    function _parseSessionFromSessionEnableData(
        bytes calldata _sessionEnableData,
        uint256 _sessionKeyIndex
    ) internal pure returns (uint64 sessionChainId, bytes32 sessionDigest) {
        uint8 enabledKeysCount;

        /*
         * Session Enable Data Layout
         * Offset (in bytes)    | Length (in bytes) | Contents
         * 0x0                  | 0x1               | No of session keys enabled
         * 0x1                  | 0x8 x count       | Chain IDs
         * 0x1 + 0x8 x count    | 0x20 x count      | Session Data Hash
         */
        assembly ("memory-safe") {
            let offset := _sessionEnableData.offset

            enabledKeysCount := shr(248, calldataload(offset))
            offset := add(offset, 0x1)

            sessionChainId := shr(
                192,
                calldataload(add(offset, mul(0x8, _sessionKeyIndex)))
            )
            offset := add(offset, mul(0x8, enabledKeysCount))

            sessionDigest := calldataload(
                add(offset, mul(0x20, _sessionKeyIndex))
            )
        }

        if (_sessionKeyIndex >= enabledKeysCount) {
            revert("SessionKeyIndexInvalid");
        }
    }
}
