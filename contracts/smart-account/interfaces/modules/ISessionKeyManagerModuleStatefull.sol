// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title Session Key Manager module for Biconomy Modular Smart Accounts.
 * @dev TODO
 * @author Ankur Dubey - <ankur@biconomy.io>
 * @author Fil Makarov - <filipp.makarov@biconomy.io>
 */
interface ISessionKeyManagerModuleStatefull {
    struct SessionData {
        uint48 validUntil;
        uint48 validAfter;
        address sessionValidationModule;
        bytes sessionKeyData;
    }

    /**
     * @dev validates that Session Key + parameters are enabled
     * by being included into the merkle tree
     * @param userOpSender smartAccount for which session key is being validated
     * @param sessionKeyDataDigest digest of session key data
     * @dev if doesn't revert, session key is considered valid
     */
    function validateSessionKey(
        address userOpSender,
        bytes32 sessionKeyDataDigest
    ) external;

    /**
     * @dev enables session key for a smart account
     * @param sessionData session data
     */
    function enableSessionKey(SessionData calldata sessionData) external;
}
