// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {BaseAuthorizationModule} from "./BaseAuthorizationModule.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@account-abstraction/contracts/core/Helpers.sol";
import "./SessionValidationModules/ISessionValidationModule.sol";
import {ISessionKeyManager} from "../interfaces/ISessionKeyManager.sol";

struct SessionStorage {
    bytes32 merkleRoot;
}

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

contract SessionKeyManager is BaseAuthorizationModule, ISessionKeyManager {
    /**
     * @dev mapping of Smart Account to a SessionStorage
     * Info about session keys is stored as root of the merkle tree built over the session keys
     */
    mapping(address => SessionStorage) internal _userSessions;

    /**
     * @dev sets the merkle root of a tree containing session keys for msg.sender
     * should be called by Smart Account
     * @param _merkleRoot Merkle Root of a tree that contains session keys with their permissions and parameters
     */
    function setMerkleRoot(bytes32 _merkleRoot) external {
        _userSessions[msg.sender].merkleRoot = _merkleRoot;
        // TODO:should we add an event here? which emits the new merkle root
    }

    /**
     * @dev validates userOperation
     * @param userOp User Operation to be validated.
     * @param userOpHash Hash of the User Operation to be validated.
     * @return sigValidationResult 0 if signature is valid, SIG_VALIDATION_FAILED otherwise.
     */
    function validateUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash
    ) external virtual returns (uint256) {
        (bytes memory moduleSignature, ) = abi.decode(
            userOp.signature,
            (bytes, address)
        );
        (
            uint48 validUntil,
            uint48 validAfter,
            address sessionValidationModule,
            bytes memory sessionKeyData,
            bytes32[] memory merkleProof,
            bytes memory sessionKeySignature
        ) = abi.decode(
                moduleSignature,
                (uint48, uint48, address, bytes, bytes32[], bytes)
            );

        validateSessionKey(
            userOp.sender,
            validUntil,
            validAfter,
            sessionValidationModule,
            sessionKeyData,
            merkleProof
        );

        return
            _packValidationData(
                //_packValidationData expects true if sig validation has failed, false otherwise
                !ISessionValidationModule(sessionValidationModule)
                    .validateSessionUserOp(
                        userOp,
                        userOpHash,
                        sessionKeyData,
                        sessionKeySignature
                    ),
                validUntil,
                validAfter
            );
    }

    /**
     * @dev returns the SessionStorage object for a given smartAccount
     * @param smartAccount Smart Account address
     */
    function getSessionKeys(
        address smartAccount
    ) external view returns (SessionStorage memory) {
        return _userSessions[smartAccount];
    }

    /**
     * @dev validates that Session Key + parameters are enabled
     * by being included into the merkle tree
     * @param smartAccount smartAccount for which session key is being validated
     * @param validUntil timestamp when the session key expires
     * @param validAfter timestamp when the session key becomes valid
     * @param sessionValidationModule address of the Session Validation Module
     * @param sessionKeyData session parameters (limitations/permissions)
     * @param merkleProof merkle proof for the leaf which represents this session key + params
     * @dev if doesn't revert, session key is considered valid
     */

    function validateSessionKey(
        address smartAccount,
        uint48 validUntil,
        uint48 validAfter,
        address sessionValidationModule,
        bytes memory sessionKeyData,
        bytes32[] memory merkleProof
    ) public virtual override {
        SessionStorage storage sessionKeyStorage = _getSessionData(
            smartAccount
        );
        bytes32 leaf = keccak256(
            abi.encodePacked(
                validUntil,
                validAfter,
                sessionValidationModule,
                sessionKeyData
            )
        );
        if (
            !MerkleProof.verify(merkleProof, sessionKeyStorage.merkleRoot, leaf)
        ) {
            revert("SessionNotApproved");
        }
    }

    /**
     * @dev isValidSignature according to BaseAuthorizationModule
     * @param _dataHash Hash of the data to be validated.
     * @param _signature Signature over the the _dataHash.
     * @return always returns 0xffffffff as signing messages is not supported by SessionKeys
     */
    function isValidSignature(
        bytes32 _dataHash,
        bytes memory _signature
    ) public view override returns (bytes4) {
        (_dataHash, _signature);
        return 0xffffffff; // do not support it here
    }

    /**
     * @dev returns the SessionStorage object for a given smartAccount
     * @param _account Smart Account address
     * @return sessionKeyStorage SessionStorage object at storage
     */
    function _getSessionData(
        address _account
    ) internal view returns (SessionStorage storage sessionKeyStorage) {
        sessionKeyStorage = _userSessions[_account];
    }
}
