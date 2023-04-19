// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {BaseAuthorizationModule} from "./BaseAuthorizationModule.sol";
import {Enum} from "../../common/Enum.sol";
import {UserOperation} from "@account-abstraction/contracts/interfaces/UserOperation.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import "hardhat/console.sol";

contract EOAOwnershipRegistryModule is BaseAuthorizationModule {
    string public constant NAME = "EOA Ownership Registry Module";
    string public constant VERSION = "0.1.0";

    error NoOwnerRegisteredForSmartAccount(address smartAccount);

    using ECDSA for bytes32;

    mapping(address => address) public smartAccountOwners;

    constructor() {}

    function initForSmartAccount(address owner) external returns (address) {
        smartAccountOwners[msg.sender] = owner;
        return address(this);
    }

    function setOwner(address owner) external {
        smartAccountOwners[msg.sender] = owner;
    }

    function validateSignature(
        UserOperation calldata userOp,
        bytes32 userOpHash,
        bytes calldata moduleSignature
    ) external view virtual returns (uint256 sigValidationResult) {
        console.log("entered EOA sig validation");
        console.log("owner in the mapping ", smartAccountOwners[userOp.sender]);
        console.log("restored ", userOpHash.recover(moduleSignature));
        console.logBytes32(userOpHash);
        console.logBytes(moduleSignature);

        if (smartAccountOwners[userOp.sender] == address(0))
            revert NoOwnerRegisteredForSmartAccount(userOp.sender);
        if (
            smartAccountOwners[userOp.sender] ==
            userOpHash.recover(moduleSignature)
        ) {
            return 0;
        }
        return SIG_VALIDATION_FAILED;
    }

    function isValidSignature(
        bytes32 _hash,
        bytes memory moduleSignature
    ) public view virtual override returns (bytes4) {
        return isValidSignatureForAddress(_hash, moduleSignature, msg.sender);
    }

    function isValidSignatureForAddress(
        bytes32 _hash,
        bytes memory moduleSignature,
        address smartAccount
    ) public view virtual returns (bytes4) {
        console.logBytes32(_hash);
        console.logBytes(moduleSignature);
        if (smartAccountOwners[smartAccount] == address(0))
            revert NoOwnerRegisteredForSmartAccount(smartAccount);
        if (
            smartAccountOwners[smartAccount] == _hash.recover(moduleSignature)
        ) {
            return EIP1271_MAGIC_VALUE;
        }
        return bytes4(0xffffffff);
    }
}
