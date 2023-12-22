// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/* solhint-disable no-unused-import */

import {BaseAuthorizationModule} from "./BaseAuthorizationModule.sol";
import {EIP1271_MAGIC_VALUE} from "contracts/smart-account/interfaces/ISignatureValidator.sol";
import {UserOperation} from "@account-abstraction/contracts/interfaces/UserOperation.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IEcdsaOwnershipRegistryModule} from "../interfaces/modules/IEcdsaOwnershipRegistryModule.sol";
import {IAuthorizationModule} from "../interfaces/IAuthorizationModule.sol";
import {ISignatureValidator} from "../interfaces/ISignatureValidator.sol";

/**
 * @title ECDSA ownership Authorization module for Biconomy Smart Accounts.
 * @dev Compatible with Biconomy Modular Interface v 0.1
 *         - It allows to validate user operations signed by EOA private key.
 *         - EIP-1271 compatible (ensures Smart Account can validate signed messages).
 *         - One owner per Smart Account.
 *         - Does not support outdated eth_sign flow for cheaper validations
 *         (see https://support.metamask.io/hc/en-us/articles/14764161421467-What-is-eth-sign-and-why-is-it-a-risk-)
 * !!!!!!! Only EOA owners supported, no Smart Account Owners
 *         For Smart Contract Owners check SmartContractOwnership module instead
 * @author Fil Makarov - <filipp.makarov@biconomy.io>
 */

contract EcdsaOwnershipRegistryModule is
    BaseAuthorizationModule,
    IEcdsaOwnershipRegistryModule
{
    using ECDSA for bytes32;

    string public constant NAME = "ECDSA Ownership Registry Module";
    string public constant VERSION = "1.1.0";
    mapping(address => address) internal _smartAccountOwners;

    /// @inheritdoc IEcdsaOwnershipRegistryModule
    function initForSmartAccount(
        address eoaOwner
    ) external override returns (address) {
        if (_smartAccountOwners[msg.sender] != address(0)) {
            revert AlreadyInitedForSmartAccount(msg.sender);
        }
        if (eoaOwner == address(0)) revert ZeroAddressNotAllowedAsOwner();
        _smartAccountOwners[msg.sender] = eoaOwner;
        return address(this);
    }

    /// @inheritdoc IEcdsaOwnershipRegistryModule
    function transferOwnership(address owner) external override {
        if (_isSmartContract(owner)) revert NotEOA(owner);
        if (owner == address(0)) revert ZeroAddressNotAllowedAsOwner();
        _transferOwnership(msg.sender, owner);
    }

    /// @inheritdoc IEcdsaOwnershipRegistryModule
    function renounceOwnership() external override {
        _transferOwnership(msg.sender, address(0));
    }

    /// @inheritdoc IEcdsaOwnershipRegistryModule
    function getOwner(
        address smartAccount
    ) external view override returns (address) {
        address owner = _smartAccountOwners[smartAccount];
        if (owner == address(0)) {
            revert NoOwnerRegisteredForSmartAccount(smartAccount);
        }
        return owner;
    }

    /// @inheritdoc IAuthorizationModule
    function validateUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash
    ) external view virtual override returns (uint256) {
        if (
            _verifySignature(
                userOpHash,
                userOp.signature[96:161],
                userOp.sender
            )
        ) {
            return VALIDATION_SUCCESS;
        }
        return SIG_VALIDATION_FAILED;
    }

    /**
     * @inheritdoc ISignatureValidator
     * @dev Validates a signature for a message.
     * @dev Appends smart account address to the hash to avoid replay attacks
     * To be called from a Smart Account.
     * @param dataHash Hash of the message that was signed.
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

    /// @inheritdoc IEcdsaOwnershipRegistryModule
    function isValidSignatureForAddress(
        bytes32 dataHash,
        bytes memory moduleSignature,
        address smartAccount
    ) public view virtual override returns (bytes4) {
        if (
            _verifySignature(
                keccak256(
                    abi.encodePacked(
                        "\x19Ethereum Signed Message:\n52",
                        dataHash,
                        smartAccount
                    )
                ),
                moduleSignature,
                smartAccount
            )
        ) {
            return EIP1271_MAGIC_VALUE;
        }
        return bytes4(0xffffffff);
    }

    /// @inheritdoc ISignatureValidator
    function isValidSignatureUnsafe(
        bytes32 dataHash,
        bytes memory moduleSignature
    ) public view virtual returns (bytes4) {
        return
            isValidSignatureForAddressUnsafe(
                dataHash,
                moduleSignature,
                msg.sender
            );
    }

    /// @inheritdoc IEcdsaOwnershipRegistryModule
    function isValidSignatureForAddressUnsafe(
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
     * @dev Transfers ownership for smartAccount and emits an event
     * @param newOwner Smart Account address.
     */
    function _transferOwnership(
        address smartAccount,
        address newOwner
    ) internal {
        address _oldOwner = _smartAccountOwners[smartAccount];
        _smartAccountOwners[smartAccount] = newOwner;
        emit OwnershipTransferred(smartAccount, _oldOwner, newOwner);
    }

    /**
     * @dev Validates a signature for a message.
     * @dev Check if signature was made over dataHash.toEthSignedMessageHash() or just dataHash
     * The former is for personal_sign, the latter for the typed_data sign
     * Only EOA owners supported, no Smart Account Owners
     * For Smart Contract Owners check SmartContractOwnership Module instead
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
        address expectedSigner = _smartAccountOwners[smartAccount];
        if (expectedSigner == address(0)) {
            revert NoOwnerRegisteredForSmartAccount(smartAccount);
        }
        if (signature.length < 65) revert WrongSignatureLength();
        address recovered = (dataHash.toEthSignedMessageHash()).recover(
            signature
        );
        if (expectedSigner == recovered) {
            return true;
        }
        recovered = dataHash.recover(signature);
        if (expectedSigner == recovered) {
            return true;
        }
        return false;
    }

    /**
     * @dev Checks if the address provided is a smart contract.
     * @param account Address to be checked.
     */
    function _isSmartContract(address account) internal view returns (bool) {
        uint256 size;
        assembly {
            size := extcodesize(account)
        }
        return size > 0;
    }
}
