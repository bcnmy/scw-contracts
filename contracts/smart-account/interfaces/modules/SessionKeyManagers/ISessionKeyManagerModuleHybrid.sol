// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/* solhint-disable no-empty-blocks*/

/**
 * @title Session Key Manager module for Biconomy Modular Smart Accounts.
 * @dev Similar to the Stateful Session Key Manager module, but the session enable transaction
 *      is batched with the first transaction that uses the session key.
 *      Session creation is offline and completely free.
 * @author Ankur Dubey - <ankur@biconomy.io>
 */
interface ISessionKeyManagerModuleHybrid {
    struct SessionData {
        uint48 validUntil;
        uint48 validAfter;
        address sessionValidationModule;
        bytes sessionKeyData;
    }

    event SessionCreated(
        address indexed sa,
        bytes32 indexed sessionDataDigest,
        SessionData data
    );

    event SessionDisabled(
        address indexed sa,
        bytes32 indexed sessionDataDigest
    );

    /**
     * @dev creates a session for a smart account
     * @param sessionData session data
     */
    function enableSession(SessionData calldata sessionData) external;

    /**
     * @notice Explicity disable a session. Can be useful is situations where a session
     *         needs to be disabled before it expires.
     * @param _sessionDigest digest of session key data
     */
    function disableSession(bytes32 _sessionDigest) external;

    /**
     * @notice Returns session data for a given session digest and smart account
     * @param _sessionDataDigest digest of session key data
     * @param _sa smart account for which session key is being disabled
     * @return data SessionData struct
     */
    function enabledSessionsData(
        bytes32 _sessionDataDigest,
        address _sa
    ) external view returns (SessionData memory data);

    /**
     * @dev Returns session data digest
     * @param _data session data
     * @return digest of session data
     */
    function sessionDataDigest(
        SessionData calldata _data
    ) external pure returns (bytes32);
}
