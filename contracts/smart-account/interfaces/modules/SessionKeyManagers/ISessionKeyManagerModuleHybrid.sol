// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IStatefulSessionKeyManagerBase} from "./IStatefulSessionKeyManagerBase.sol";

/**
 * @title Session Key Manager module for Biconomy Modular Smart Accounts.
 * @dev Similar to the Stateful Session Key Manager module, but the session enable transaction
 *      is batched with the first transaction that uses the session key.
 *      Session creation is offline and completely free.
 * @author Ankur Dubey - <ankur@biconomy.io>
 */
interface ISessionKeyManagerModuleHybrid is IStatefulSessionKeyManagerBase {
    /**
     * @dev validates that Session Key + parameters are enabled
     * by being included into the merkle tree
     * @param userOpSender smartAccount for which session key is being validated
     * @param validUntil timestamp when the session key expires
     * @param validAfter timestamp when the session key becomes valid
     * @param sessionKeyIndex index of the session key being used
     * @param sessionValidationModule address of the Session Validation Module
     * @param sessionKeyData session parameters (limitations/permissions)
     * @param sessionEnableSignature eip1271 signature which enables the session key
     * @dev if doesn't revert, session key is considered valid
     */
    function validateSessionKeySessionEnableTransaction(
        address userOpSender,
        uint48 validUntil,
        uint48 validAfter,
        uint256 sessionKeyIndex,
        address sessionValidationModule,
        bytes calldata sessionKeyData,
        bytes calldata sessionEnableData,
        bytes calldata sessionEnableSignature
    ) external;

    /**
     * TODO
     * @param smartAccount smartAccount for which session key is being validated
     * @param sessionKeyDataDigest digest of the session key data
     */
    function validateSessionKeyPreEnabled(
        address smartAccount,
        bytes32 sessionKeyDataDigest
    ) external;
}
