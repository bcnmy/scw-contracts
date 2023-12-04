// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IStatefulSessionKeyManagerBase
 * @dev Base contract for Session Key Manager Modules that store the session
 *      key data on-chain.
 *      These Session Key Manager module are typically optimised for L2s where calldata
 *      is expensive and hence session key data is stored on-chain.
 * @author Ankur Dubey - <ankur@biconomy.io>
 */
interface IStatefulSessionKeyManagerBase {
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
     * @notice Explicity disable a session. Can be useful is situations where a session
     *         needs to be disabled before it expires.
     * @param _sa smart account for which session key is being disabled
     * @param _sessionDigest digest of session key data
     */
    function disableSession(address _sa, bytes32 _sessionDigest) external;

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
}
