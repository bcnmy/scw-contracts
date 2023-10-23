// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {BaseAuthorizationModule, ISignatureValidator} from "./BaseAuthorizationModule.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {UserOperation} from "@account-abstraction/contracts/interfaces/UserOperation.sol";

/**
 * @title Smart Contract Ownership Authorization module for Biconomy Smart Accounts.
 * @dev Compatible with Biconomy Modular Interface v 0.1
 *         - It allows to validate user operations signed by other smart contracts via EIP-1271.
 *         - EIP-1271 compatible (ensures Smart Account can validate signed messages).
 *         - One owner per Smart Account.
 * @dev No EOA owners supported
 *         For EOA Owners check EcdsaOwnership module instead
 * @notice !!! This module doesn't follow the Storage Access Rules set by ERC-4337 !!!
 * https://eips.ethereum.org/EIPS/eip-4337#storage-associated-with-an-address
 * Thus it will not be compatible with the standard bundlers.
 * You can still use it in private environments or with custom bundlers which have
 * less restrictions than ones participating in the unified userOps mempool.
 *
 * @author Fil Makarov - <filipp.makarov@biconomy.io>
 */

contract SmartContractOwnershipRegistryModule is BaseAuthorizationModule {
    using ECDSA for bytes32;

    string public constant NAME = "Smart Contract Ownership Registry Module";
    string public constant VERSION = "0.1.0";
    mapping(address => address) internal _smartAccountOwners;

    event OwnershipTransferred(
        address indexed smartAccount,
        address indexed oldOwner,
        address indexed newOwner
    );

    error NoOwnerRegisteredForSmartAccount(address smartAccount);
    error AlreadyInitedForSmartAccount(address smartAccount);
    error WrongSignatureLength();
    error NotSmartContract(address account);

    /**
     * @dev Initializes the module for a Smart Account.
     * @dev no need to check for address(0) as it is not a Smart Contract
     * Should be used at a time of first enabling the module for a Smart Account.
     * @param owner The owner of the Smart Account.
     */
    function initForSmartAccount(address owner) external returns (address) {
        if (_smartAccountOwners[msg.sender] != address(0))
            revert AlreadyInitedForSmartAccount(msg.sender);
        if (!_isSmartContract(owner)) revert NotSmartContract(owner);
        _smartAccountOwners[msg.sender] = owner;
        return address(this);
    }

    /**
     * @dev Sets/changes an for a Smart Account.
     * @dev no need to check for address(0) as it is not a Smart Contract
     * Should be called by Smart Account itself.
     * @param owner The owner of the Smart Account.
     */
    function transferOwnership(address owner) external {
        if (!_isSmartContract(owner)) revert NotSmartContract(owner);
        _transferOwnership(msg.sender, owner);
    }

    /**
     * @dev Renounces ownership
     * should be called by Smart Account.
     */
    function renounceOwnership() external {
        _transferOwnership(msg.sender, address(0));
    }

    /**
     * @dev Returns the owner of the Smart Account. Reverts for Smart Accounts without owners.
     * @param smartAccount Smart Account address.
     * @return owner The owner of the Smart Account.
     */
    function getOwner(address smartAccount) external view returns (address) {
        address owner = _smartAccountOwners[smartAccount];
        if (owner == address(0))
            revert NoOwnerRegisteredForSmartAccount(smartAccount);
        return owner;
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
        // we send exactly the hash that has been received from EP
        // as in theory owner.isValidSignature can expect signatures not only
        // over eth signed hash. So if the frontend/backend creates a signature for
        // this module, it is in charge to provide a signature over the non-modified hash
        // or over a hash that is modiefied in the way owner expects
        if (_verifySignature(userOpHash, moduleSignature, userOp.sender)) {
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
     * Only Smart Account Owners, no EOA owners supported
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
        address expectedContractSigner = _smartAccountOwners[smartAccount];
        if (expectedContractSigner == address(0))
            revert NoOwnerRegisteredForSmartAccount(smartAccount);
        return
            ISignatureValidator(expectedContractSigner).isValidSignature(
                dataHash,
                signature
            ) == EIP1271_MAGIC_VALUE
                ? true
                : false;
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
