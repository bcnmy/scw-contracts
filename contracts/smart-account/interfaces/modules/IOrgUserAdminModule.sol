// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**

 */
interface IOrgUserAdminModule {
    event OwnershipTransferred(
        address indexed smartAccount,
        address indexed oldOwner,
        address indexed newOwner
    );

    error AlreadyInitedForSmartAccount(address smartAccount);
    error WrongSignatureLength();
    error NotEOA(address account);
    error ZeroAddressNotAllowedAsOwner();
    error OwnerAlreadyUsedForSmartAccount(address owner, address smartAccount);
    error NotAnOwner(address owner, address smartAccount);

    /**
     * @dev Initializes the module for a Smart Account.
     * Should be used at a time of first enabling the module for a Smart Account.
     * @param eoaOwners The owner of the Smart Account. Should be EOA!
     */
    function initForSmartAccount(
        address[] calldata eoaOwners
    ) external returns (address);

    /**
     * @dev Sets/changes an for a Smart Account.
     * Should be called by Smart Account itself.
     * @param owner The current owner of the Smart Account to be replaced.
     * @param newOwner The new owner of the Smart Account.
     */
    function transferOwnership(address owner, address newOwner) external;

    /**
     * @dev Adds owner for Smart Account.
     * should be called by Smart Account.
     * @param owner The owner of the Smart Account.
     */
    function addOwner(address owner) external;

    /**
     * @dev Renounces ownership from owner
     * should be called by Smart Account.
     * @param owner The owner to be removed
     */
    function removeOwner(address owner) external;

    /**
     * @dev Returns the if the address provided is one of owners of the Smart Account.
     * @param smartAccount Smart Account address.
     * @param eoaAddress The address to check for ownership
     */
    function isOwner(
        address smartAccount,
        address eoaAddress
    ) external view returns (bool);

    /**
     * @dev Returns the number of owners of the Smart Account.
     * @param smartAccount Smart Account address.
     * @return The number of owners of the Smart Account.
     */
    function getNumberOfOwners(
        address smartAccount
    ) external view returns (uint256);

    /**
     * @dev Validates a signature for a message signed by address.
     * @dev Also try dataHash.toEthSignedMessageHash()
     * @param dataHash hash of the data
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
