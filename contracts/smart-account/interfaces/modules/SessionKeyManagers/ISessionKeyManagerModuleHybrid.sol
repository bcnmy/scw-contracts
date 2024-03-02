// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title Session Key Manager module for Biconomy Modular Smart Accounts.
 * @dev Stores the Session Information explicity in the storage, instead of maintainting
 *      a merkle tree.
 *      This reduces the amount of calldata required to validate a session key, making it cheaper on
 *      L2s.
 *      Allows for a session to be enabled explicity, or being batched with the first usage of said session
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
     * @dev creates multiple sessions for a smart account
     * @param sessionDatas session data corresponding to multiple sessions to be enabled
     */
    function enableSessions(SessionData[] calldata sessionDatas) external;

    /**
     * @notice Explicitly disable a session. Can be useful in situations where a session
     *         needs to be disabled before it expires.
     * @param _sessionDigest digest of session key data
     */
    function disableSession(bytes32 _sessionDigest) external;

    /**
     * @notice Explicitly disable multiple sessions. Can be useful in situations where a session
     *         needs to be disabled before it expires.
     * @param _sessionDigests digests of session key datas to be disabled
     */
    function disableSessions(bytes32[] calldata _sessionDigests) external;

    /**
     * @notice Returns session data for a given session digest and smart account
     * @param _sessionDataDigest digest of session key data
     * @param _sa smart account for which session data is to be fetched
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
