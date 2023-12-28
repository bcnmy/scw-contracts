// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title Batched Session Router
 * @dev Built to process executeBatch and executeBatch_y6U calls
 *         - Every call inside batch should be covered by an appropriate Session Validation Module
 *         - Parses data provided and sequentially
 *                 a) verifies the session key was enabled via SessionKeyManager
 *                 b) verifies the session key permissions via Session Validation Modules
 *         - Should be used with carefully verified and audited Session Validation Modules only
 *         - Compatible with Biconomy Modular Interface v 0.1
 * @author Fil Makarov - <filipp.makarov@biconomy.io>
 */
interface IBatchedSessionRouterModule {
    struct SessionData {
        uint48 validUntil;
        uint48 validAfter;
        address sessionValidationModule;
        bytes sessionKeyData;
        bytes32[] merkleProof;
        bytes callSpecificData;
    }
}
