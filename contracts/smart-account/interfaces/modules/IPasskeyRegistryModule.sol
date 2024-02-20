// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {PassKeyId} from "../../modules/PasskeyValidationModules/Secp256r1.sol";

/**
 * @title Passkey ownership Authorization module for Biconomy Smart Accounts.
 * @dev Compatible with Biconomy Modular Interface v 0.2
 *         - It allows to validate user operations signed by passkeys.
 *         - One owner per Smart Account.
 *         For Smart Contract Owners check SmartContractOwnership module instead
 * @author Aman Raj - <aman.raj@biconomy.io>
 */
interface IPasskeyRegistryModule {
    error NoPassKeyRegisteredForSmartAccount(address smartAccount);
    error AlreadyInitedForSmartAccount(address smartAccount);

    /**
     * @dev Initializes the module for a Smart Account.
     * Should be used at a time of first enabling the module for a Smart Account.
     * @param _pubKeyX The x coordinate of the public key.
     * @param _pubKeyY The y coordinate of the public key.
     * @param _keyId The keyId of the Smart Account.
     * @return address of the module.
     */
    function initForSmartAccount(
        uint256 _pubKeyX,
        uint256 _pubKeyY,
        string calldata _keyId
    ) external returns (address);

    /**
     * @dev Validates an EIP-1271 signature
     * @dev Appends Smart Account address to the hash to avoid replay attacks
     * @param signedDataHash hash of the data
     * @param moduleSignature Signature to be validated.
     * @param smartAccount expected signer Smart Account address.
     * @return EIP1271_MAGIC_VALUE if signature is valid, 0xffffffff otherwise.
     */
    function isValidSignatureForAddress(
        bytes32 signedDataHash,
        bytes memory moduleSignature,
        address smartAccount
    ) external view returns (bytes4);

    /**
     * @dev Same as isValidSignatureForAddress but does not append Smart Account address to the hash
     * @dev Expects the data Hash to already include smart account address information
     * @param signedDataHash hash of the data which includes smart account address
     * @param moduleSignature Signature to be validated.
     * @param smartAccount expected signer Smart Account address.
     * @return EIP1271_MAGIC_VALUE if signature is valid, 0xffffffff otherwise.
     */
    function isValidSignatureForAddressUnsafe(
        bytes32 signedDataHash,
        bytes memory moduleSignature,
        address smartAccount
    ) external view returns (bytes4);

    /**
     * @dev Returns the owner of the Smart Account.
     * @param smartAccount Smart Account address.
     * @return PassKeyId The owner key of the Smart Account.
     */
    function getOwner(
        address smartAccount
    ) external view returns (PassKeyId memory);
}
