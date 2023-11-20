// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {BaseAuthorizationModule} from "./BaseAuthorizationModule.sol";
import {_packValidationData} from "@account-abstraction/contracts/core/Helpers.sol";
import {UserOperation} from "@account-abstraction/contracts/interfaces/UserOperation.sol";
import {ISessionValidationModule} from "../interfaces/modules/ISessionValidationModule.sol";
import {ISessionKeyManagerModuleStatefull} from "../interfaces/modules/ISessionKeyManagerModuleStatefull.sol";
import {IAuthorizationModule} from "../interfaces/IAuthorizationModule.sol";
import {ISignatureValidator} from "../interfaces/ISignatureValidator.sol";
import "hardhat/console.sol";

/**
 * @title Session Key Manager module for Biconomy Modular Smart Accounts.
 * @dev TODO
 * @author Ankur Dubey - <ankur@biconomy.io>
 * @author Fil Makarov - <filipp.makarov@biconomy.io>
 */

contract SessionKeyManagerStatefull is
    BaseAuthorizationModule,
    ISessionKeyManagerModuleStatefull
{
    // Inverting the order of the mapping seems to make it non-compliant with the bundlers
    mapping(bytes32 sessionDataDigest => mapping(address sa => SessionData data))
        public enabledSessions;

    /// @inheritdoc IAuthorizationModule
    function validateUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash
    ) external virtual returns (uint256 rv) {
        // uint256 gas = gasleft();

        (bytes memory moduleSignature, ) = abi.decode(
            userOp.signature,
            (bytes, address)
        );

        (bytes32 sessionDataDigest, bytes memory sessionKeySignature) = abi
            .decode(moduleSignature, (bytes32, bytes));

        validateSessionKey(userOp.sender, sessionDataDigest);

        SessionData storage sessionData = enabledSessions[sessionDataDigest][
            userOp.sender
        ];

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

        // console.log("Statefull Validation Gas: ", gas - gasleft());
    }

    /// @inheritdoc ISessionKeyManagerModuleStatefull
    function validateSessionKey(
        address smartAccount,
        bytes32 sessionKeyDataDigest
    ) public virtual override {
        require(
            enabledSessions[sessionKeyDataDigest][smartAccount]
                .sessionValidationModule != address(0),
            "SessionKeyManager: session key is not enabled"
        );
    }

    /// @inheritdoc ISessionKeyManagerModuleStatefull
    function enableSessionKey(
        SessionData calldata sessionData
    ) external override {
        bytes32 sessionDataDigest = keccak256(
            abi.encodePacked(
                sessionData.validUntil,
                sessionData.validAfter,
                sessionData.sessionValidationModule,
                sessionData.sessionKeyData
            )
        );
        enabledSessions[sessionDataDigest][msg.sender] = sessionData;
    }

    /// @inheritdoc ISignatureValidator
    function isValidSignature(
        bytes32 _dataHash,
        bytes memory _signature
    ) public pure override returns (bytes4) {
        (_dataHash, _signature);
        return 0xffffffff; // do not support it here
    }

    /// @inheritdoc ISignatureValidator
    function isValidSignatureUnsafe(
        bytes32 _dataHash,
        bytes memory _signature
    ) public pure override returns (bytes4) {
        (_dataHash, _signature);
        return 0xffffffff; // do not support it here
    }
}
