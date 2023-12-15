// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.20;

import {IBaseSmartAccount} from "./IBaseSmartAccount.sol";
import {IModuleManager} from "./base/IModuleManager.sol";

/* solhint-disable func-name-mixedcase */

interface ISmartAccount is IBaseSmartAccount, IModuleManager {
    // Events
    event ImplementationUpdated(
        address indexed oldImplementation,
        address indexed newImplementation
    );

    // Errors

    /**
     * @notice Throws if zero address has been provided as Entry Point address
     */

    error EntryPointCannotBeZero();

    /**
     * @notice Throws at mixedAuth when msg.sender is not an owner neither _self
     * @param caller address that tried to call mixedAuth-protected method
     */
    error MixedAuthFail(address caller);

    /**
     * @notice Throws if trying to change an owner of a SmartAccount to the zero address
     */
    error OwnerCannotBeZero();

    /**
     * @notice Throws if zero address has been provided as Base Implementation address
     */
    error BaseImplementationCannotBeZero();

    /**
     * @notice Throws if there is no code at implementationAddress
     * @param implementationAddress implementation address provided
     */
    error InvalidImplementation(address implementationAddress);

    /**
     * @notice Throws at onlyOwner when msg.sender is not an owner
     * @param caller address that tried to call onlyOwner method
     */
    error CallerIsNotOwner(address caller);

    /**
     * @notice Throws at _requireFromEntryPointOrOwner when msg.sender is not an EntryPoint neither an owner
     * @param caller address that tried to call _requireFromEntryPointOrOwner-protected method
     */
    error CallerIsNotEntryPointOrOwner(address caller);

    /**
     * @notice Throws at _requireFromEntryPointOrSelf when msg.sender is not an EntryPoint neither self
     * @param caller address that tried to call _requireFromEntryPointOrSelf-protected method
     */
    error CallerIsNotEntryPointOrSelf(address caller);

    /**
     * @notice Throws at _requireFromEntryPoint when msg.sender is not an EntryPoint
     * @param caller address that tried to call _requireFromEntryPoint-protected method
     */
    error CallerIsNotEntryPoint(address caller);

    /**
     * @notice Throws if trying to initialize a Smart Account that has already been initialized
     */
    error AlreadyInitialized();

    /**
     * @notice Throws if contract signature is provided in frong format
     * @param uintS s converted to uint256
     * @param contractSignatureLength length of a contract signature
     * @param signatureLength the whole signature length
     */
    error WrongContractSignatureFormat(
        uint256 uintS,
        uint256 contractSignatureLength,
        uint256 signatureLength
    );

    /**
     * @notice Throws if isValidSignature for the conrtact signature and data hash differs from EIP1271 Magic Value
     * @param contractSignature the contract signature that has been verified
     */
    error WrongContractSignature(bytes contractSignature);

    /**
     * @notice Throws when if trying to transfer to zero address
     */
    error TransferToZeroAddressAttempt();

    /**
     * @notice Throws when module address taken from signature is not enabled
     * @param moduleAddressProvided module address taken from signature
     */
    error WrongValidationModule(address moduleAddressProvided);

    /**
     * @notice Thrown when trying to use address of the Smart Account as an owner for itself
     */
    error OwnerCanNotBeSelf();

    /**
     * @notice Thrown when trying to use current owner as a new owner in a _setOwner() call
     */
    error OwnerProvidedIsSame();

    // Functions

    /**
     * @dev Initialize the Smart Account with required states
     * @param handler Default fallback handler provided in Smart Account
     * @param moduleSetupContract Contract, that setups initial auth module for this smart account.
     * It can be a module factory or a registry module that serves several smart accounts
     * @param moduleSetupData modules setup data (a standard calldata for the module setup contract)
     * @notice devs need to make sure it is only callable once by initializer or state check restrictions
     * @notice any further implementations that introduces a new state must have a reinit method
     * @notice reinitialization is not possible, as _initialSetupModules reverts if the account is already initialized
     *         which is when there is at least one enabled module
     */
    function init(
        address handler,
        address moduleSetupContract,
        bytes calldata moduleSetupData
    ) external returns (address);

    /**
     * @dev Interface function with the standard name for execute_ncC
     * @param dest Address of the contract to call
     * @param value Amount of native tokens to send along with the transaction
     * @param func Data of the transaction
     */
    function execute(address dest, uint256 value, bytes calldata func) external;

    /**
     * @dev Execute a transaction (called by entryPoint)
     * @notice Name is optimized for this method to be cheaper to be called
     * @param dest Address of the contract to call
     * @param value Amount of native tokens to send along with the transaction
     * @param func Data of the transaction
     */
    function execute_ncC(
        address dest,
        uint256 value,
        bytes calldata func
    ) external;

    /**
     * @dev Interface function with the standard name for executeBatch_y6U
     * @param dest Addresses of the contracts to call
     * @param value Amounts of native tokens to send along with the transactions
     * @param func Data of the transactions
     */
    function executeBatch(
        address[] calldata dest,
        uint256[] calldata value,
        bytes[] calldata func
    ) external;

    /**
     * @dev Execute a sequence of transactions
     * @notice Name is optimized for this method to be cheaper to be called
     * @param dest Addresses of the contracts to call
     * @param value Amounts of native tokens to send along with the transactions
     * @param func Data of the transactions
     */
    function executeBatch_y6U(
        address[] calldata dest,
        uint256[] calldata value,
        bytes[] calldata func
    ) external;

    /**
     * @notice All the new implementations MUST have this method!
     * @notice Updates the implementation of the base wallet
     * @param _implementation New wallet implementation
     */
    function updateImplementation(address _implementation) external;

    /**
     * @dev Deposit more funds for this account in the entryPoint
     */
    function addDeposit() external payable;

    /**
     * @dev Withdraw value from the account's deposit
     * @param withdrawAddress target to send to
     * @param amount to withdraw
     */
    function withdrawDepositTo(
        address payable withdrawAddress,
        uint256 amount
    ) external payable;

    /**
     * @dev Check current account deposit in the entryPoint
     */
    function getDeposit() external view returns (uint256);

    /**
     * @dev Returns the address of the implementation contract associated with this contract.
     * @notice The implementation address is stored in the contract's storage slot with index 0.
     * @return _implementation implementation address
     */
    function getImplementation()
        external
        view
        returns (address _implementation);

    function VERSION() external pure returns (string memory);
}
