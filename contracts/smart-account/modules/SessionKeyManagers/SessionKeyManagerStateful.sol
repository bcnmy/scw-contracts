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
        // TODO: optimise
        (bytes memory moduleSignature, ) = abi.decode(
            userOp.signature,
            (bytes, address)
        );

        (bytes32 sessionDataDigest, bytes memory sessionKeySignature) = abi
            .decode(moduleSignature, (bytes32, bytes));

        validateSessionKey(userOp.sender, sessionDataDigest);

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
        require(
            _enabledSessionsData[sessionKeyDataDigest][smartAccount]
                .sessionValidationModule != address(0),
            "SKM: Session Key is not enabled"
        );
    }
}
