// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {BaseAuthorizationModule, UserOperation, ISignatureValidator} from "./BaseAuthorizationModule.sol";
import {ISessionValidationModule} from "./SessionValidationModules/ISessionValidationModule.sol";
import {ISessionKeyManager} from "../interfaces/ISessionKeyManager.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@account-abstraction/contracts/core/Helpers.sol";

import "@account-abstraction/contracts/core/EntryPoint.sol";
import "hardhat/console.sol";

struct SessionStorage {
    bytes32 merkleRoot;
}

/**
 * @title
 * @dev
 *         - Should be used with carefully verified and audited Session Validation Modules only
 *         - Compatible with Biconomy Modular Interface v 0.1
 * @author Fil Makarov - <filipp.makarov@biconomy.io>
 */

contract SessionRouter is BaseAuthorizationModule {
    bytes4 public constant EXECUTE_BATCH_SELECTOR = 0x47e1da2a;
    bytes4 public constant EXECUTE_BATCH_OPTIMIZED_SELECTOR = 0x00004680;

    /**
     * @dev validates userOperation. Expects it to be a executeBatch or executeBatch_y6U call
     * @param userOp User Operation to be validated.
     * @param userOpHash Hash of the User Operation to be validated.
     * @return sigValidationResult 0 if signature is valid, SIG_VALIDATION_FAILED otherwise.
     */
    function validateUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash
    ) external virtual returns (uint256) {
        // check this is a proper method call
        require(
            bytes4(userOp.callData[0:4]) == EXECUTE_BATCH_OPTIMIZED_SELECTOR ||
                bytes4(userOp.callData[0:4]) == EXECUTE_BATCH_SELECTOR,
            "SR Invalid Selector"
        );

        (bytes memory moduleSignature, ) = abi.decode(
            userOp.signature,
            (bytes, address)
        );

        // parse the signature to get the array of required parameters
        (
            address sessionKeyManager,
            uint48[] memory validUntil,
            uint48[] memory validAfter,
            address[] memory sessionValidationModule,
            bytes[] memory sessionKeyData,
            bytes32[][] memory merkleProof,
            bytes memory sessionKeySignature
        ) = abi.decode(
                moduleSignature,
                (
                    address,
                    uint48[],
                    uint48[],
                    address[],
                    bytes[],
                    bytes32[][],
                    bytes
                )
            );

        console.log("UserOpHash in contract");
        console.logBytes32(userOpHash);
        console.log("SKM contr ", sessionKeyManager);
        console.log("abi encoded contr");
        console.logBytes(abi.encode(userOpHash, sessionKeyManager));
        console.log("Resulting hash in contract");
        //console.logBytes32(keccak256(abi.encode(userOpHash, sessionKeyManager)));
        console.logBytes32(
            keccak256(abi.encodePacked(userOpHash, sessionKeyManager))
        );

        console.log("Signed Message Hash in contract");
        //console.logBytes32(ECDSA.toEthSignedMessageHash(keccak256(abi.encode(userOpHash, sessionKeyManager))));
        console.logBytes32(
            ECDSA.toEthSignedMessageHash(
                keccak256(abi.encodePacked(userOpHash, sessionKeyManager))
            )
        );

        // check lengths of arrays
        require(
            validUntil.length == validAfter.length,
            "SR Invalid data provided"
        );
        require(
            validUntil.length == sessionValidationModule.length,
            "SR Invalid data provided"
        );
        require(
            validUntil.length == sessionKeyData.length,
            "SR Invalid data provided"
        );
        require(
            validUntil.length == merkleProof.length,
            "SR Invalid data provided"
        );

        //console.log("Signature Over userOpHash and SK Manager address in contract");
        //console.logBytes(sessionKeySignature);

        address recovered = ECDSA.recover(
            //ECDSA.toEthSignedMessageHash(keccak256(abi.encode(userOpHash, sessionKeyManager))),
            ECDSA.toEthSignedMessageHash(
                keccak256(abi.encodePacked(userOpHash, sessionKeyManager))
            ),
            sessionKeySignature
        );

        uint48 earliestValidUntil = type(uint48).max;
        uint48 latestValidAfter;

        // iterate over batched operations
        for (uint i; i < sessionValidationModule.length; ) {
            // validate the sessionKey
            // sessionKeyManager reverts if something wrong
            ISessionKeyManager(sessionKeyManager).validateSessionKey(
                userOp.sender,
                validUntil[i],
                validAfter[i],
                sessionValidationModule[i],
                sessionKeyData[i],
                merkleProof[i]
            );

            (address sessionKey, , , ) = abi.decode(
                sessionKeyData[i],
                (address, address, address, uint256)
            );

            // compare if userOp was signed with the proper session key
            require(recovered == sessionKey, "Session Key not enabled");

            // parse userOp.calldata to get calldatas for every specific operation
            (
                address[] memory destinations,
                uint256[] memory callValues,
                bytes[] memory operationCalldatas
            ) = abi.decode(
                    userOp.callData[4:],
                    (address[], uint256[], bytes[])
                );

            // validate sessionKey permissions
            // sessionValidationModule reverts if something wrong
            ISessionValidationModule(sessionValidationModule[i])
                .validateSessionParams(
                    destinations[i],
                    callValues[i],
                    operationCalldatas[i],
                    sessionKeyData[i]
                );

            //intersect validUntils and validAfters
            if (validUntil[i] < earliestValidUntil) {
                earliestValidUntil = validUntil[i];
            }
            if (validAfter[i] > latestValidAfter) {
                latestValidAfter = validAfter[i];
            }

            unchecked {
                i++;
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

    function getHash(
        UserOperation memory userOp,
        address sessionKeyManager,
        address payable entryPoint
    ) external view returns (bytes32 userOpHash, bytes32 messageHash) {
        userOpHash = EntryPoint(entryPoint).getUserOpHash(userOp);
        //console.log("UserOpHash in contract");
        //console.logBytes32(userOpHash);
        messageHash = ECDSA.toEthSignedMessageHash(
            keccak256(abi.encodePacked(userOpHash, sessionKeyManager))
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
    ) public view override returns (bytes4) {
        return 0xffffffff; // do not support it here
    }
}
