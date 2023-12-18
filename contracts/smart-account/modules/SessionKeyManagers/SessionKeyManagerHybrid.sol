// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/* solhint-disable function-max-lines */

import {_packValidationData} from "@account-abstraction/contracts/core/Helpers.sol";
import {UserOperation} from "@account-abstraction/contracts/interfaces/UserOperation.sol";
import {ISessionValidationModule} from "../../interfaces/modules/ISessionValidationModule.sol";
import {ISessionKeyManagerModuleHybrid} from "../../interfaces/modules/SessionKeyManagers/ISessionKeyManagerModuleHybrid.sol";
import {ISignatureValidator, EIP1271_MAGIC_VALUE} from "../../interfaces/ISignatureValidator.sol";
import {StatefulSessionKeyManagerBase} from "./StatefulSessionKeyManagerBase.sol";

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
    /// @inheritdoc StatefulSessionKeyManagerBase
    function validateUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash
    ) external virtual override returns (uint256 rv) {
        /*
         * Module Signature Layout
         * Offset (in bytes)    | Length (in bytes) | Contents
         * 0x0                  | 0x1               | 0x01 if sessionEnableTransaction, 0x00 otherwise
         * 0x1                  | --                | Data depending on the above flag
         */
        bytes calldata moduleSignature = userOp.signature[96:];

        uint256 isSessionEnableTransaction;
        assembly ("memory-safe") {
            isSessionEnableTransaction := shr(
                248,
                calldataload(moduleSignature.offset)
            )
        }

        if (isSessionEnableTransaction == 1) {
            (
                uint256 sessionKeyIndex,
                uint48 validUntil,
                uint48 validAfter,
                address sessionValidationModule,
                bytes calldata sessionKeyData,
                bytes calldata sessionEnableData,
                bytes calldata sessionEnableSignature,
                bytes calldata sessionKeySignature
            ) = _parseSessionEnableSignature(moduleSignature);

            validateSessionKeySessionEnableTransaction(
                userOp.sender,
                validUntil,
                validAfter,
                sessionKeyIndex,
                sessionValidationModule,
                sessionKeyData,
                sessionEnableData,
                sessionEnableSignature
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
            ) = _parseSessionDataPreEnabledSignature(moduleSignature);

            validateSessionKeyPreEnabled(userOp.sender, sessionDataDigest);

            SessionData storage sessionData = _enabledSessionsData[
                sessionDataDigest
            ][userOp.sender];

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

    /// @inheritdoc ISessionKeyManagerModuleHybrid
    function validateSessionKeySessionEnableTransaction(
        address smartAccount,
        uint48 validUntil,
        uint48 validAfter,
        uint256 sessionKeyIndex,
        address sessionValidationModule,
        bytes calldata sessionKeyData,
        bytes calldata sessionEnableData,
        bytes calldata sessionEnableSignature
    ) public virtual override {
        // Verify the signature on the session enable data
        bytes32 sessionEnableDataDigest = keccak256(sessionEnableData);
        if (
            ISignatureValidator(smartAccount).isValidSignature(
                sessionEnableDataDigest,
                sessionEnableSignature
            ) != EIP1271_MAGIC_VALUE
        ) {
            revert("SessionNotApproved");
        }

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

    /// @inheritdoc ISessionKeyManagerModuleHybrid
    function validateSessionKeyPreEnabled(
        address smartAccount,
        bytes32 sessionKeyDataDigest
    ) public virtual override {
        require(
            _enabledSessionsData[sessionKeyDataDigest][smartAccount]
                .sessionValidationModule != address(0),
            "SKM: Session key is not enabled"
        );
    }

    function _parseSessionEnableSignature(
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
         * abi.encode(
         *  uint256 sessionKeyIndex,
         *  uint48 validUntil,
         *  uint48 validAfter,
         *  address sessionValidationModule,
         *  bytes calldata sessionKeyData,
         *  bytes calldata sessionEnableData,
         *  bytes calldata sessionEnableSignature,
         *  bytes calldata sessionKeySignature
         * )
         */
        assembly ("memory-safe") {
            let offset := add(_moduleSignature.offset, 0x1)
            let baseOffset := offset

            sessionKeyIndex := calldataload(offset)
            offset := add(offset, 0x20)

            validUntil := calldataload(offset)
            offset := add(offset, 0x20)

            validAfter := calldataload(offset)
            offset := add(offset, 0x20)

            sessionValidationModule := calldataload(offset)
            offset := add(offset, 0x20)

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

    function _parseSessionDataPreEnabledSignature(
        bytes calldata _moduleSignature
    )
        internal
        pure
        returns (bytes32 sessionDataDigest, bytes calldata sessionKeySignature)
    {
        /*
         * Session Data Pre Enabled Signature Layout
         * abi.encode(
         *  bytes32 sessionDataDigest,
         *  bytes calldata sessionKeySignature
         * )
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
