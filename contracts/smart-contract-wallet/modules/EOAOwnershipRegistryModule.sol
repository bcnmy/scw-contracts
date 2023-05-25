// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {BaseAuthorizationModule} from "./BaseAuthorizationModule.sol";
import {UserOperation} from "@account-abstraction/contracts/interfaces/UserOperation.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract EOAOwnershipRegistryModule is BaseAuthorizationModule {
    string public constant NAME = "EOA Ownership Registry Module";
    string public constant VERSION = "0.1.0";

    error NoOwnerRegisteredForSmartAccount(address smartAccount);
    error AlreadyInitedForSmartAccount(address smartAccount);
    error WrongSignatureLength();

    using ECDSA for bytes32;

    mapping(address => address) public smartAccountOwners;

    function initForSmartAccount(address owner) external returns (address) {
        if (smartAccountOwners[msg.sender] != address(0))
            revert AlreadyInitedForSmartAccount(msg.sender);
        smartAccountOwners[msg.sender] = owner;
        return address(this);
    }

    function setOwner(address owner) external {
        smartAccountOwners[msg.sender] = owner;
    }

    function validateUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash
    ) external view virtual returns (uint256) {
        (bytes memory moduleSignature, ) = abi.decode(
            userOp.signature,
            (bytes, address)
        );
        // validateUserOp gets a hash not prepended with 'x\x19Ethereum Signed Message:\n32'
        // so we have to do it manually
        bytes32 ethSignedHash = userOpHash.toEthSignedMessageHash();
        return _validateSignature(userOp, ethSignedHash, moduleSignature);
    }

    function _validateSignature(
        UserOperation calldata userOp,
        bytes32 ethSignedUserOpHash,
        bytes memory moduleSignature
    ) internal view virtual returns (uint256 sigValidationResult) {
        if (
            _verifySignature(
                ethSignedUserOpHash,
                moduleSignature,
                userOp.sender
            )
        ) {
            return 0;
        }
        return SIG_VALIDATION_FAILED;
    }

    // isValidSignature expects a hash prepended with 'x\x19Ethereum Signed Message:\n32'
    function isValidSignature(
        bytes32 ethSignedDataHash,
        bytes memory moduleSignature
    ) public view virtual override returns (bytes4) {
        return
            isValidSignatureForAddress(
                ethSignedDataHash,
                moduleSignature,
                msg.sender
            );
    }

    function isValidSignatureForAddress(
        bytes32 ethSignedDataHash,
        bytes memory moduleSignature,
        address smartAccount
    ) public view virtual returns (bytes4) {
        if (
            _verifySignature(ethSignedDataHash, moduleSignature, smartAccount)
        ) {
            return EIP1271_MAGIC_VALUE;
        }
        return bytes4(0xffffffff);
    }

    // Only EOA owners supported, no smart contracts.
    // To support smart contracts, can add a check if expectedSigner.isContract()
    // then call expectedSigner.isValidSignature(ethSignedHash, signature)
    // to check if the signature is valid.
    function _verifySignature(
        bytes32 dataHash,
        bytes memory signature,
        address account
    ) internal view returns (bool) {
        address expectedSigner = smartAccountOwners[account];
        if (expectedSigner == address(0))
            revert NoOwnerRegisteredForSmartAccount(account);
        if (signature.length < 65) revert WrongSignatureLength();
        (uint8 v, bytes32 r, bytes32 s) = signatureSplit(signature);
        if (v > 30) {
            //eth_sign flow
            (address _signer, ) = dataHash.toEthSignedMessageHash().tryRecover(
                v - 4,
                r,
                s
            );
            return expectedSigner == _signer;
        } else {
            return expectedSigner == dataHash.recover(signature);
        }
    }

    function signatureSplit(
        bytes memory signature
    ) internal pure returns (uint8 v, bytes32 r, bytes32 s) {
        // The signature format is a compact form of:
        //   {bytes32 r}{bytes32 s}{uint8 v}
        // Compact means, uint8 is not padded to 32 bytes.
        // solhint-disable-next-line no-inline-assembly
        assembly {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            // Here we are loading the last 32 bytes, including 31 bytes
            // of 's'. There is no 'mload8' to do this.
            //
            // 'byte' is not working due to the Solidity parser, so let's
            // use the second best option, 'and'
            v := and(mload(add(signature, 0x41)), 0xff)
        }
    }
}
