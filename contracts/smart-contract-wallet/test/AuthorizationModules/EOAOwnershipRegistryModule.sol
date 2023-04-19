// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {BaseAuthorizationModule} from "./BaseAuthorizationModule.sol";
import {Enum} from "../../common/Enum.sol";
import {UserOperation} from "@account-abstraction/contracts/interfaces/UserOperation.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract EOAOwnershipRegistryModule is BaseAuthorizationModule {
    string public constant NAME = "EOA Ownership Registry Module";
    string public constant VERSION = "0.1.0";

    error NoOwnerRegisteredForSmartAccount(address smartAccount);

    using ECDSA for bytes32;

    mapping(address => address) public smartAccountOwners;

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
        if (verifySignature(userOpHash, moduleSignature, userOp.sender)) {
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
        if (verifySignature(_hash, moduleSignature, smartAccount)) {
            return EIP1271_MAGIC_VALUE;
        }
        return bytes4(0xffffffff);
    }

    function verifySignature(
        bytes32 _hash,
        bytes memory _signature,
        address account
    ) internal view returns (bool) {
        address expectedSigner = smartAccountOwners[account];
        if (expectedSigner == address(0))
            revert NoOwnerRegisteredForSmartAccount(account);
        bytes32 hash = _hash.toEthSignedMessageHash();
        return expectedSigner == hash.recover(_signature);
    }
}
