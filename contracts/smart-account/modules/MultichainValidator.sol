// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {BaseAuthorizationModule, UserOperation, ISignatureValidator} from "./BaseAuthorizationModule.sol";
import {EcdsaOwnershipRegistryModule} from "./EcdsaOwnershipRegistryModule.sol";
import {UserOperationLib, UserOperation} from "@account-abstraction/contracts/interfaces/UserOperation.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {calldataKeccak} from "@account-abstraction/contracts/core/Helpers.sol";

interface ISmartAccount {
    function nonce() external view returns (uint256);
}

struct SessionStorage {
    bytes32 merkleRoot;
}

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
            bytes32 merkleTreeRoot,
            bytes32[] memory merkleProof,
            bytes memory multichainSignature
        ) = abi.decode(moduleSignature, (bytes32, bytes32[], bytes));

        if (!MerkleProof.verify(merkleProof, merkleTreeRoot, userOpHash)) {
            revert("Invalid UserOp");
        }

        // reconstruct hash = all the userOp fileds except nonce + merkleTreeRoot that is based on chainId, nonce, address(this)
        /* bytes32 multichainHash = keccak256(
            abi.encode(getChainAgnosticUserOpHash(userOp), merkleTreeRoot)
        ); */

        return
            _verifySignature(
                merkleTreeRoot,
                multichainSignature,
                address(uint160(sender))
            )
                ? VALIDATION_SUCCESS
                : SIG_VALIDATION_FAILED;
    }

    /**
     * Inherits isValideSignature method from EcdsaOwnershipRegistryModule
     * isValidSignature is intended to work not with a multichain signature
     * but with a regular ecdsa signature over a message hash
     */

    // what else can vary?
    // userOp.maxFeePerGas,
    // userOp.maxPriorityFeePerGas,
    // paymaster and data
    // ?initcode? can it vary as well?
}
