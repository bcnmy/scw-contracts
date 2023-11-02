// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

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

    function isValidSignatureForAddress(
        bytes32 signedDataHash,
        bytes memory moduleSignature
    ) external view returns (bytes4);
}
