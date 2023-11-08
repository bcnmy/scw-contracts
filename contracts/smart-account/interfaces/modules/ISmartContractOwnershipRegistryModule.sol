// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

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
interface ISmartContractOwnershipRegistryModule {
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
    function initForSmartAccount(address owner) external returns (address);

    /**
     * @dev Sets/changes an for a Smart Account.
     * @dev no need to check for address(0) as it is not a Smart Contract
     * Should be called by Smart Account itself.
     * @param owner The owner of the Smart Account.
     */
    function transferOwnership(address owner) external;

    /**
     * @dev Renounces ownership
     * should be called by Smart Account.
     */
    function renounceOwnership() external;

    /**
     * @dev Returns the owner of the Smart Account. Reverts for Smart Accounts without owners.
     * @param smartAccount Smart Account address.
     * @return owner The owner of the Smart Account.
     */
    function getOwner(address smartAccount) external view returns (address);

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
    ) external view returns (bytes4);
}
