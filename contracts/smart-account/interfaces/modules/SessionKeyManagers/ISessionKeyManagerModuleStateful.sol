// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IStatefulSessionKeyManagerBase} from "./IStatefulSessionKeyManagerBase.sol";

/**
 * @title Stateful Session Key Manager module for Biconomy Modular Smart Accounts.
 * @dev Stores the session key data on-chain to save calldata costs in subsequent transactions.
 *      This module is optimised for L2s where calldata is expensive and hence session key data is stored on-chain.
 * @author Ankur Dubey - <ankur@biconomy.io>
 */
interface ISessionKeyManagerModuleStateful is IStatefulSessionKeyManagerBase {
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
     * @dev creates a session for a smart account
     * @param sessionData session data
     */
    function enableSession(SessionData calldata sessionData) external;
}
