// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {UserOperation} from "@account-abstraction/contracts/interfaces/UserOperation.sol";
import {EcdsaOwnershipRegistryModule} from "./EcdsaOwnershipRegistryModule.sol";
import {UserOperationLib} from "@account-abstraction/contracts/interfaces/UserOperation.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {_packValidationData} from "@account-abstraction/contracts/core/Helpers.sol";

/**
 * @title ECDSA Multichain Validator module for Biconomy Smart Accounts.
 * @dev Biconomy’s Multichain Validator module enables use cases which
 * require several actions to be authorized for several chains with just one
 * signature required from user.
 *         - Leverages Merkle Trees to efficiently manage large datasets
 *         - Inherits from the ECDSA Ownership Registry Module
 *         - Compatible with Biconomy Modular Interface v 0.1
 *         - Does not introduce any additional security trade-offs compared to the
 *           vanilla ERC-4337 flow.
 * @author Fil Makarov - <filipp.makarov@biconomy.io>
 */

contract MultichainECDSAValidator is EcdsaOwnershipRegistryModule {
    using UserOperationLib for UserOperation;

    /**
     * @dev Validates User Operation.
     * leaf = validUntil + validAfter + userOpHash
     * If the leaf is the part of the Tree with a root provided, userOp considered
     * to be authorized by user
     * @param userOp user operation to be validated
     * @param userOpHash hash of the userOp provided by the EP
     */

    function validateUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash
    ) external view virtual override returns (uint256) {
        (bytes memory moduleSignature, ) = abi.decode(
            userOp.signature,
            (bytes, address)
        );

        address sender;
        //read sender from userOp, which is first userOp member (saves gas)
        assembly {
            sender := calldataload(userOp)
        }

        if (moduleSignature.length == 65) {
            //it's not a multichain signature
            return
                _verifySignature(
                    userOpHash,
                    moduleSignature,
                    address(uint160(sender))
                )
                    ? VALIDATION_SUCCESS
                    : SIG_VALIDATION_FAILED;
        }

        //otherwise it is a multichain signature
        (
            uint48 validUntil,
            uint48 validAfter,
            bytes32 merkleTreeRoot,
            bytes32[] memory merkleProof,
            bytes memory multichainSignature
        ) = abi.decode(
                moduleSignature,
                (uint48, uint48, bytes32, bytes32[], bytes)
            );

        //make a leaf out of userOpHash, validUntil and validAfter
        bytes32 leaf = keccak256(
            abi.encodePacked(validUntil, validAfter, userOpHash)
        );

        if (!MerkleProof.verify(merkleProof, merkleTreeRoot, leaf)) {
            revert("Invalid UserOp");
        }

        return
            _verifySignature(
                merkleTreeRoot,
                multichainSignature,
                address(uint160(sender))
            )
                ? _packValidationData(
                    false, //sigVerificationFailed = false
                    validUntil == 0 ? type(uint48).max : validUntil,
                    validAfter
                )
                : SIG_VALIDATION_FAILED;
    }

    /**
     * Inherits isValideSignature method from EcdsaOwnershipRegistryModule
     * isValidSignature is intended to work not with a multichain signature
     * but with a regular ecdsa signature over a message hash
     */
}
