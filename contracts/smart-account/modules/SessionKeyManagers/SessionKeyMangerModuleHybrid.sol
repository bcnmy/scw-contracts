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
 *      Session creation is offline and completely free.
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
        (bytes memory moduleSignature, ) = abi.decode(
            userOp.signature,
            (bytes, address)
        );

        uint256 isSessionEnableTransaction;
        assembly {
            isSessionEnableTransaction := mload(add(moduleSignature, 0x20))
        }

        if (isSessionEnableTransaction == 1) {
            (
                ,
                uint48 validUntil,
                uint48 validAfter,
                uint256 sessionKeyIndex,
                address sessionValidationModule,
                bytes memory sessionKeyData,
                bytes memory sessionEnableData,
                bytes memory sessionEnableSignature,
                bytes memory sessionKeySignature
            ) = abi.decode(
                    moduleSignature,
                    (
                        uint256,
                        uint48,
                        uint48,
                        uint256,
                        address,
                        bytes,
                        bytes,
                        bytes,
                        bytes
                    )
                );

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
                ,
                bytes32 sessionDataDigest,
                bytes memory sessionKeySignature
            ) = abi.decode(moduleSignature, (uint256, bytes32, bytes));

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
        bytes memory sessionKeyData,
        bytes memory sessionEnableData,
        bytes memory sessionEnableSignature
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

        /*
         * Session Enable Data Layout
         * Offset (in bytes)    | Length (in bytes) | Contents
         * 0x0                  | 0x1               | No of session keys enabled
         * 0x1                  | 0x8 x count       | Chain IDs
         * 0x1 + 0x8 x count    | 0x20 x count      | Session Data Hash
         */
        uint8 enabledKeysCount;
        uint64 sessionChainId;
        bytes32 sessionDigest;

        assembly ("memory-safe") {
            let offset := add(sessionEnableData, 0x20)

            enabledKeysCount := shr(248, mload(offset))

            sessionChainId := shr(
                192,
                mload(add(add(offset, 0x1), mul(0x8, sessionKeyIndex)))
            )

            sessionDigest := mload(
                add(
                    add(add(offset, 0x1), mul(0x8, enabledKeysCount)),
                    mul(0x20, sessionKeyIndex)
                )
            )
        }

        if (sessionKeyIndex >= enabledKeysCount) {
            revert("SessionKeyIndexInvalid");
        }

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
}
