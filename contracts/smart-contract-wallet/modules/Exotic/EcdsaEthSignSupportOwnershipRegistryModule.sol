// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {BaseAuthorizationModule, UserOperation} from "../BaseAuthorizationModule.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title ECDSA ownership Authorization module for Biconomy Smart Accounts.
 * @dev Compatible with Biconomy Modular Interface v 0.1
 *         - It allows to validate user operations signed by EOA private key.
 *         - EIP-1271 compatible (ensures Smart Account can validate signed messages).
 *         - One owner per Smart Account.
 *         - Supports eth_sign flow
 * !!!!!!! Only EOA owners supported, no Smart Account Owners
 *         For Smart Contract Owners check SmartContractOwnership module instead
 * @author Fil Makarov - <filipp.makarov@biconomy.io>
 */

contract EcdsaWithEthSignSupportOwnershipRegistryModule is
    BaseAuthorizationModule
{
    string public constant NAME = "ECDSA Ownership Registry Module";
    string public constant VERSION = "0.1.0";

    error NoOwnerRegisteredForSmartAccount(address smartAccount);
    error AlreadyInitedForSmartAccount(address smartAccount);
    error WrongSignatureLength();
    error NotEOA(address account);

    using ECDSA for bytes32;

    mapping(address => address) public smartAccountOwners;

    /**
     * @dev Initializes the module for a Smart Account.
     * Should be used at a time of first enabling the module for a Smart Account.
     * @param owner The owner of the Smart Account.
     */
    function initForSmartAccount(address owner) external returns (address) {
        if (isSmartAccount(owner)) revert NotEOA(owner);
        if (smartAccountOwners[msg.sender] != address(0))
            revert AlreadyInitedForSmartAccount(msg.sender);
        smartAccountOwners[msg.sender] = owner;
        return address(this);
    }

    /**
     * @dev Sets/changes an for a Smart Account.
     * Should be called by Smart Account itself.
     * @param owner The owner of the Smart Account.
     */
    function setOwner(address owner) external {
        if (isSmartAccount(owner)) revert NotEOA(owner);
        smartAccountOwners[msg.sender] = owner;
    }

    /**
     * @dev Checks if the address provided is a smart contract.
     * @param account Address to be checked.
     */
    function isSmartAccount(address account) internal view returns (bool) {
        uint256 size;
        assembly {
            size := extcodesize(account)
        }
        return size > 0;
    }

    /**
     * @dev validates userOperation
     * @param userOp User Operation to be validated.
     * @param userOpHash Hash of the User Operation to be validated.
     * @return sigValidationResult 0 if signature is valid, SIG_VALIDATION_FAILED otherwise.
     */
    function validateUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash
    ) external view virtual returns (uint256) {
        (bytes memory moduleSignature, ) = abi.decode(
            userOp.signature,
            (bytes, address)
        );
        // validateUserOp gets from EP a hash not prepended with 'x\x19Ethereum Signed Message:\n32'
        // so we have to do it manually, as on the user side it is signed with personal_sign
        // that prepends with "\x19Ethereum Signed Message\n32"
        if (
            _verifySignature(
                userOpHash.toEthSignedMessageHash(),
                moduleSignature,
                userOp.sender
            )
        ) {
            return 0;
        }
        return SIG_VALIDATION_FAILED;
    }

    /**
     * @dev Validates a signature for a message.
     * To be called from a Smart Account.
     * @param dataHash Exact hash of the data that was signed.
     * @param moduleSignature Signature to be validated.
     * @return EIP1271_MAGIC_VALUE if signature is valid, 0xffffffff otherwise.
     */
    function isValidSignature(
        bytes32 dataHash,
        bytes memory moduleSignature
    ) public view virtual override returns (bytes4) {
        return
            isValidSignatureForAddress(dataHash, moduleSignature, msg.sender);
    }

    /**
     * @dev Validates a signature for a message signed by address.
     * @param dataHash Exact hash of the data that was signed.
     * @param moduleSignature Signature to be validated.
     * @param smartAccount expected signer Smart Account address.
     * @return EIP1271_MAGIC_VALUE if signature is valid, 0xffffffff otherwise.
     */
    function isValidSignatureForAddress(
        bytes32 dataHash,
        bytes memory moduleSignature,
        address smartAccount
    ) public view virtual returns (bytes4) {
        if (_verifySignature(dataHash, moduleSignature, smartAccount)) {
            return EIP1271_MAGIC_VALUE;
        }
        return bytes4(0xffffffff);
    }

    /**
     * @dev Validates a signature for a message.
     * Only EOA owners supported, no Smart Account Owners
     * For Smart Contrac Owners check SmartContractOwnership module instead
     * @param dataHash Hash of the data to be validated.
     * @param signature Signature to be validated.
     * @param smartAccount expected signer Smart Account address.
     * @return true if signature is valid, false otherwise.
     */
    function _verifySignature(
        bytes32 dataHash,
        bytes memory signature,
        address smartAccount
    ) internal view returns (bool) {
        address expectedSigner = smartAccountOwners[smartAccount];
        if (expectedSigner == address(0))
            revert NoOwnerRegisteredForSmartAccount(smartAccount);
        if (signature.length < 65) revert WrongSignatureLength();
        (uint8 v, bytes32 r, bytes32 s) = _signatureSplit(signature);
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

    function _signatureSplit(
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
