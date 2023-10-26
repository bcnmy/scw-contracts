// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/* solhint-disable function-max-lines */

import {BaseAuthorizationModule} from "./BaseAuthorizationModule.sol";
import {ISessionValidationModule} from "../interfaces/modules/ISessionValidationModule.sol";
import {ISessionKeyManagerModule} from "../interfaces/modules/ISessionKeyManagerModule.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {_packValidationData} from "@account-abstraction/contracts/core/Helpers.sol";
import {UserOperation} from "@account-abstraction/contracts/interfaces/UserOperation.sol";
import {IBatchedSessionRouterModule} from "../interfaces/modules/IBatchedSessionRouterModule.sol";
import {IAuthorizationModule} from "../interfaces/IAuthorizationModule.sol";
import {IModuleManager} from "../interfaces/base/IModuleManager.sol";

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

contract BatchedSessionRouter is
    BaseAuthorizationModule,
    IBatchedSessionRouterModule
{
    bytes4 public constant EXECUTE_BATCH_SELECTOR = 0x47e1da2a;
    bytes4 public constant EXECUTE_BATCH_OPTIMIZED_SELECTOR = 0x00004680;

    /// @inheritdoc IAuthorizationModule
    function validateUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash
    ) external virtual override returns (uint256) {
        // check this is a proper method call
        bytes4 selector = bytes4(userOp.callData[0:4]);
        require(
            selector == EXECUTE_BATCH_OPTIMIZED_SELECTOR ||
                selector == EXECUTE_BATCH_SELECTOR,
            "SR Invalid Selector"
        );

        (bytes memory moduleSignature, ) = abi.decode(
            userOp.signature,
            (bytes, address)
        );

        // parse the signature to get the array of required parameters
        (
            address sessionKeyManager,
            SessionData[] memory sessionData,
            bytes memory sessionKeySignature
        ) = abi.decode(moduleSignature, (address, SessionData[], bytes));

        if (!IModuleManager(userOp.sender).isModuleEnabled(sessionKeyManager)) {
            revert("SR Invalid SKM");
        }

        address recovered = ECDSA.recover(
            ECDSA.toEthSignedMessageHash(userOpHash),
            sessionKeySignature
        );

        uint48 earliestValidUntil = type(uint48).max;
        uint48 latestValidAfter;
        // parse userOp.calldata to get calldatas for every specific operation
        (
            address[] memory destinations,
            uint256[] memory callValues,
            bytes[] memory operationCalldatas
        ) = abi.decode(userOp.callData[4:], (address[], uint256[], bytes[]));

        uint256 length = sessionData.length;
        require(length == destinations.length, "Lengths mismatch");

        // iterate over batched operations
        for (uint256 i; i < length; ) {
            // validate the sessionKey
            // sessionKeyManager reverts if something wrong
            ISessionKeyManagerModule(sessionKeyManager).validateSessionKey(
                userOp.sender,
                sessionData[i].validUntil,
                sessionData[i].validAfter,
                sessionData[i].sessionValidationModule,
                sessionData[i].sessionKeyData,
                sessionData[i].merkleProof
            );

            // validate sessionKey permissions
            // sessionValidationModule reverts if something wrong
            address sessionKey = ISessionValidationModule(
                sessionData[i].sessionValidationModule
            ).validateSessionParams(
                    destinations[i],
                    callValues[i],
                    operationCalldatas[i],
                    sessionData[i].sessionKeyData,
                    sessionData[i].callSpecificData
                );

            // compare if userOp was signed with the proper session key
            if (recovered != sessionKey) return SIG_VALIDATION_FAILED;

            // intersect validUntils and validAfters
            if (
                sessionData[i].validUntil != 0 &&
                sessionData[i].validUntil < earliestValidUntil
            ) {
                earliestValidUntil = sessionData[i].validUntil;
            }
            if (sessionData[i].validAfter > latestValidAfter) {
                latestValidAfter = sessionData[i].validAfter;
            }

            unchecked {
                ++i;
            }
        }

        return (
            _packValidationData(
                false, // sig validation failed = false; if we are here, it is valid
                earliestValidUntil,
                latestValidAfter
            )
        );
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
    ) public pure override returns (bytes4) {
        (_dataHash, _signature);
        return 0xffffffff; // do not support it here
    }
}
