// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

interface ISessionKeyManager {
    /**
     * @dev validates that Session Key + parameters are enabled
     * by being included into the merkle tree
     * @param userOpSender smartAccount for which session key is being validated
     * @param validUntil timestamp when the session key expires
     * @param validAfter timestamp when the session key becomes valid
     * @param sessionValidationModule address of the Session Validation Module
     * @param sessionKeyData session parameters (limitations/permissions)
     * @param merkleProof merkle proof for the leaf which represents this session key + params
     * @dev if doesn't revert, session key is considered valid
     */
    function validateSessionKey(
        address userOpSender,
        uint48 validUntil,
        uint48 validAfter,
        address sessionValidationModule,
        bytes calldata sessionKeyData,
        bytes32[] calldata merkleProof
    ) external;
}
