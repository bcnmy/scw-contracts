// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {BaseAuthorizationModule, UserOperation, ISignatureValidator} from "./BaseAuthorizationModule.sol";
import {EcdsaOwnershipRegistryModule} from "./EcdsaOwnershipRegistryModule.sol";
import {UserOperationLib} from "@account-abstraction/contracts/interfaces/UserOperation.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {calldataKeccak, _packValidationData} from "@account-abstraction/contracts/core/Helpers.sol";

contract MultichainECDSAValidator is EcdsaOwnershipRegistryModule {
    using UserOperationLib for UserOperation;

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
