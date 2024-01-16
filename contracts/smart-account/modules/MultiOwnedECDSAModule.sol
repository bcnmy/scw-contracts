// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/* solhint-disable no-unused-import */

import {BaseAuthorizationModule} from "./BaseAuthorizationModule.sol";
import {EIP1271_MAGIC_VALUE} from "contracts/smart-account/interfaces/ISignatureValidator.sol";
import {UserOperation} from "@account-abstraction/contracts/interfaces/UserOperation.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IMultiOwnedECDSAModule} from "../interfaces/modules/IMultiOwnedECDSAModule.sol";
import {IAuthorizationModule} from "../interfaces/IAuthorizationModule.sol";
import {ISignatureValidator} from "../interfaces/ISignatureValidator.sol";

/**
 * @title ECDSA Multi Ownership Authorization Module for Biconomy Smart Accounts.
 * @dev Compatible with Biconomy Modular Interface v 0.1
 *         - It allows to validate user operations signed by EOA private key.
 *         - EIP-1271 compatible (ensures Smart Account can validate signed messages).
 *         - Multiple owners per Smart Account.
 *         - Does not support outdated eth_sign flow for cheaper validations
 *         (see https://support.metamask.io/hc/en-us/articles/14764161421467-What-is-eth-sign-and-why-is-it-a-risk-)
 * !!!!!!! Only EOA owners supported, no Smart Account Owners
 * @author Fil Makarov - <filipp.makarov@biconomy.io>
 */

contract MultiOwnedECDSAModule is
    BaseAuthorizationModule,
    IMultiOwnedECDSAModule
{
    using ECDSA for bytes32;

    string public constant NAME = "Multiowned ECDSA Ownership Module";
    string public constant VERSION = "0.2.0";

    // owner => smartAccount => isOwner
    mapping(address => mapping(address => bool)) internal _smartAccountOwners;
    mapping(address => uint256) internal numberOfOwners;

    /// @inheritdoc IMultiOwnedECDSAModule
    function initForSmartAccount(
        address[] calldata eoaOwners
    ) external returns (address) {
        if (numberOfOwners[msg.sender] != 0) {
            revert AlreadyInitedForSmartAccount(msg.sender);
        }
        uint256 ownersToAdd = eoaOwners.length;
        if (ownersToAdd == 0) revert NoOwnersToAdd();
        for (uint256 i; i < ownersToAdd; ++i) {
            if (eoaOwners[i] == address(0))
                revert ZeroAddressNotAllowedAsOwner();
            if (_smartAccountOwners[eoaOwners[i]][msg.sender])
                revert OwnerAlreadyUsedForSmartAccount(
                    eoaOwners[i],
                    msg.sender
                );

            _smartAccountOwners[eoaOwners[i]][msg.sender] = true;
            emit OwnershipTransferred(msg.sender, address(0), eoaOwners[i]);
        }
        numberOfOwners[msg.sender] = ownersToAdd;
        return address(this);
    }

    /// @inheritdoc IMultiOwnedECDSAModule
    function transferOwnership(
        address owner,
        address newOwner
    ) external override {
        if (_isSmartContract(newOwner)) revert NotEOA(newOwner);
        if (newOwner == address(0)) revert ZeroAddressNotAllowedAsOwner();
        if (owner == newOwner)
            revert OwnerAlreadyUsedForSmartAccount(newOwner, msg.sender);
        //address(0) is not an owner initially as it points to the address(0) = false
        if (!_smartAccountOwners[owner][msg.sender])
            revert NotAnOwner(owner, msg.sender);
        if (_smartAccountOwners[newOwner][msg.sender])
            revert OwnerAlreadyUsedForSmartAccount(newOwner, msg.sender);
        _transferOwnership(msg.sender, owner, newOwner);
    }

    /// @inheritdoc IMultiOwnedECDSAModule
    function addOwner(address owner) external override {
        if (_isSmartContract(owner)) revert NotEOA(owner);
        if (owner == address(0)) revert ZeroAddressNotAllowedAsOwner();
        if (_smartAccountOwners[owner][msg.sender])
            revert OwnerAlreadyUsedForSmartAccount(owner, msg.sender);

        _smartAccountOwners[owner][msg.sender] = true;
        unchecked {
            ++numberOfOwners[msg.sender];
        }
        emit OwnershipTransferred(msg.sender, address(0), owner);
    }

    /// @inheritdoc IMultiOwnedECDSAModule
    function removeOwner(address owner) external override {
        if (!_smartAccountOwners[owner][msg.sender])
            revert NotAnOwner(owner, msg.sender);
        _smartAccountOwners[owner][msg.sender] = false;
        unchecked {
            --numberOfOwners[msg.sender];
        }
        emit OwnershipTransferred(msg.sender, owner, address(0));
    }

    /// @inheritdoc IMultiOwnedECDSAModule
    function isOwner(
        address smartAccount,
        address eoaAddress
    ) external view override returns (bool) {
        return _smartAccountOwners[eoaAddress][smartAccount];
    }

    /// @inheritdoc IAuthorizationModule
    function validateUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash
    ) external view virtual override returns (uint256) {
        (bytes memory cleanEcdsaSignature, ) = abi.decode(
            userOp.signature,
            (bytes, address)
        );
        if (_verifySignature(userOpHash, cleanEcdsaSignature, userOp.sender)) {
            return VALIDATION_SUCCESS;
        }
        return SIG_VALIDATION_FAILED;
    }

    /**
     * @inheritdoc ISignatureValidator
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

    /// @inheritdoc IMultiOwnedECDSAModule
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

    /// @inheritdoc IMultiOwnedECDSAModule
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

    /// @inheritdoc IMultiOwnedECDSAModule
    function getNumberOfOwners(
        address smartAccount
    ) public view returns (uint256) {
        return numberOfOwners[smartAccount];
    }

    /**
     * @dev Transfers ownership for smartAccount and emits an event
     * @param newOwner Smart Account address.
     */
    function _transferOwnership(
        address smartAccount,
        address owner,
        address newOwner
    ) internal {
        _smartAccountOwners[owner][smartAccount] = false;
        _smartAccountOwners[newOwner][smartAccount] = true;
        emit OwnershipTransferred(smartAccount, owner, newOwner);
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
        if (signature.length < 65) revert WrongSignatureLength();
        address recovered = (dataHash.toEthSignedMessageHash()).recover(
            signature
        );
        if (
            recovered != address(0) &&
            _smartAccountOwners[recovered][smartAccount]
        ) {
            return true;
        }
        recovered = dataHash.recover(signature);
        if (
            recovered != address(0) &&
            _smartAccountOwners[recovered][smartAccount]
        ) {
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
