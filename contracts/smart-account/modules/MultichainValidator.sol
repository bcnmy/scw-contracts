// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {BaseAuthorizationModule, UserOperation, ISignatureValidator} from "./BaseAuthorizationModule.sol";
import {EcdsaOwnershipRegistryModule} from "./EcdsaOwnershipRegistryModule.sol";
import {UserOperationLib, UserOperation} from "@account-abstraction/contracts/interfaces/UserOperation.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {calldataKeccak} from "@account-abstraction/contracts/core/Helpers.sol";

import "hardhat/console.sol";

interface ISmartAccount {
    function nonce() external view returns (uint256);
}

struct SessionStorage {
    bytes32 merkleRoot;
}

contract MultichainECDSAValidator is EcdsaOwnershipRegistryModule {
    using UserOperationLib for UserOperation;

    // nonce specific to this chain
    // mapping(address => uint256) internal _localNonces;

    // TODO: work with userOp.sender and try to get is like it is done in Helper.sol
    // can be cheaper - CHECK THIS
    function validateUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash
    ) external view virtual override returns (uint256) {
        (bytes memory moduleSignature, ) = abi.decode(
            userOp.signature,
            (bytes, address)
        );

        if (moduleSignature.length == 65) {
            //it's not a multichain signature
            return
                _verifySignature(userOpHash, moduleSignature, userOp.sender)
                    ? VALIDATION_SUCCESS
                    : SIG_VALIDATION_FAILED;
        }

        //otherwise it is a multichain signature
        (
            bytes32 merkleTreeRoot,
            bytes32[] memory merkleProof,
            bytes memory multichainSignature
        ) = abi.decode(moduleSignature, (bytes32, bytes32[], bytes));

        if (
            !MerkleProof.verify(
                merkleProof,
                merkleTreeRoot,
                keccak256( //leaf
                    abi.encodePacked(
                        block.chainid,
                        ISmartAccount(userOp.sender).nonce(),
                        address(this)
                    )
                )
            )
        ) {
            revert("Invalid Chain Params");
        }

        // reconstruct hash = all the userOp fileds except nonce + merkleTreeRoot that is based on chainId, nonce, address(this)
        bytes32 multichainHash = keccak256(
            abi.encode(getChainAgnosticUserOpHash(userOp), merkleTreeRoot)
        );

        return
            _verifySignature(multichainHash, multichainSignature, userOp.sender)
                ? VALIDATION_SUCCESS
                : SIG_VALIDATION_FAILED;
    }

    function getChainAgnosticUserOpHash(
        UserOperation calldata userOp
    ) public pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    userOp.sender,
                    calldataKeccak(userOp.initCode), //hashInitCode
                    calldataKeccak(userOp.callData), // hashCallData
                    userOp.callGasLimit,
                    userOp.verificationGasLimit,
                    userOp.preVerificationGas,
                    userOp.maxFeePerGas,
                    userOp.maxPriorityFeePerGas,
                    calldataKeccak(userOp.paymasterAndData)
                )
            );
    }

    function getNonce(address smartAccount) external view returns (uint256) {
        return ISmartAccount(smartAccount).nonce();
    }

    /**
     * Inherits isValideSignature method from EcdsaOwnershipRegistryModule
     * isValidSignature is intended to work not with a multichain signature
     * but with a regular ecdsa signature over a message hash
     */
}
