// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title Session Key Manager module for Biconomy Modular Smart Accounts.
 * @dev TODO
 * @author Ankur Dubey - <ankur@biconomy.io>
 * @author Fil Makarov - <filipp.makarov@biconomy.io>
 */
interface ISessionKeyManagerModuleStateless {
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
    function validateSessionKey(
        address userOpSender,
        uint48 validUntil,
        uint48 validAfter,
        uint256 sessionKeyIndex,
        address sessionValidationModule,
        bytes calldata sessionKeyData,
        bytes calldata sessionEnableData,
        bytes calldata sessionEnableSignature
    ) external;
}
