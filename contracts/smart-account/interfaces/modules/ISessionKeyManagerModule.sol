// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title Session Key Manager module for Biconomy Modular Smart Accounts.
 * @dev Performs basic verifications for every session key signed userOp.
 * Checks if the session key has been enabled, that it is not due and has not yet expired
 * Then passes the validation flow to appropriate Session Validation module
 *         - For the sake of efficiency and flexibility, doesn't limit what operations
 *           Session Validation modules can perform
 *         - Should be used with carefully verified and audited Session Validation Modules only
 *         - Compatible with Biconomy Modular Interface v 0.1
 * @author Fil Makarov - <filipp.makarov@biconomy.io>
 */
interface ISessionKeyManagerModule {
    struct SessionStorage {
        bytes32 merkleRoot;
    }

    /**
     * @dev Emitted when the merkle root is updated for the Smart Account
     * It happens when there's a need to add\remove\replace session (leaves) in the Merkle Tree
     */
    event MerkleRootUpdated(address smartAccount, bytes32 newRoot);

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

    /**
     * @dev sets the merkle root of a tree containing session keys for msg.sender
     * should be called by Smart Account
     * @param _merkleRoot Merkle Root of a tree that contains session keys with their permissions and parameters
     */
    function setMerkleRoot(bytes32 _merkleRoot) external;

    /**
     * @dev returns the SessionStorage object for a given smartAccount
     * @param smartAccount Smart Account address
     */
    function getSessionKeys(
        address smartAccount
    ) external view returns (SessionStorage memory);
}
