// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {_packValidationData} from "@account-abstraction/contracts/core/Helpers.sol";
import {UserOperation} from "@account-abstraction/contracts/interfaces/UserOperation.sol";
import {ISessionValidationModule} from "../../interfaces/modules/ISessionValidationModule.sol";
import {ISessionKeyManagerModuleStateful} from "../../interfaces/modules/SessionKeyManagers/ISessionKeyManagerModuleStateful.sol";
import {StatefulSessionKeyManagerBase} from "./StatefulSessionKeyManagerBase.sol";

/**
 * @title Stateful Session Key Manager module for Biconomy Modular Smart Accounts.
 * @dev Stores the session key data on-chain to save calldata costs in subsequent transactions.
 *      This module is optimised for L2s where calldata is expensive and hence session key data is stored on-chain.
 * @author Ankur Dubey - <ankur@biconomy.io>
 * @author Fil Makarov - <filipp.makarov@biconomy.io>
 */
contract SessionKeyManagerStateful is
    StatefulSessionKeyManagerBase,
    ISessionKeyManagerModuleStateful
{
    /// @inheritdoc StatefulSessionKeyManagerBase
    function validateUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash
    ) external virtual override returns (uint256 rv) {
        bytes calldata moduleSignature = userOp.signature[96:];

        (
            bytes32 sessionDataDigest,
            bytes calldata sessionKeySignature
        ) = _parseModuleSignature(moduleSignature);

        SessionData storage sessionData = _validateSessionKey(
            userOp.sender,
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

    /// @inheritdoc ISessionKeyManagerModuleStateful
    function enableSession(SessionData calldata sessionData) external override {
        bytes32 sessionDataDigest = sessionDataDigest(sessionData);
        _enabledSessionsData[sessionDataDigest][msg.sender] = sessionData;
        emit SessionCreated(msg.sender, sessionDataDigest, sessionData);
    }

    /// @inheritdoc ISessionKeyManagerModuleStateful
    function validateSessionKey(
        address smartAccount,
        bytes32 sessionKeyDataDigest
    ) public virtual override {
        _validateSessionKey(smartAccount, sessionKeyDataDigest);
    }

    function _validateSessionKey(
        address smartAccount,
        bytes32 sessionKeyDataDigest
    ) internal view returns (SessionData storage sessionData) {
        sessionData = _enabledSessionsData[sessionKeyDataDigest][smartAccount];
        require(
            sessionData.sessionValidationModule != address(0),
            "SKM: Session Key is not enabled"
        );
    }

    function _parseModuleSignature(
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
            let offset := _moduleSignature.offset
            let baseOffset := offset

            sessionDataDigest := calldataload(offset)
            offset := add(offset, 0x20)

            let dataPointer := add(baseOffset, calldataload(offset))
            sessionKeySignature.offset := add(dataPointer, 0x20)
            sessionKeySignature.length := calldataload(dataPointer)
        }
    }
}
