// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.17;

import {IAccount} from "@account-abstraction/contracts/interfaces/IAccount.sol";
import {UserOperation} from "@account-abstraction/contracts/interfaces/UserOperation.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";

/**
 * Basic account implementation.
 * This contract provides the basic logic for implementing the IAccount interface: validateUserOp function
 * Specific account implementation should inherit it and provide the account-specific logic
 */
interface IBaseSmartAccount is IAccount {
    /**
     * @notice Throws at onlyEntryPoint when msg.sender is not an EntryPoint set for this Smart Account
     * @param caller address that tried to call onlyEntryPoint-protected method
     */
    error CallerIsNotAnEntryPoint(address caller);

    /**
     * @dev Initialize the Smart Account with required states.
     * @param handler Default fallback handler for the Smart Account.
     * @param moduleSetupContract Initializes the auth module; can be a factory or registry for multiple accounts.
     * @param moduleSetupData Contains address of the Setup Contract and setup data.
     * @notice Ensure this is callable only once (use initializer modifier or state checks).
     */
    function init(
        address handler,
        address moduleSetupContract,
        bytes calldata moduleSetupData
    ) external returns (address);

    /**
     * Validates the userOp.
     * @param userOp validate the userOp.signature field
     * @param userOpHash convenient field: the hash of the request, to check the signature against
     *          (also hashes the entrypoint and chain id)
     * @param missingAccountFunds the amount of funds required to pay to EntryPoint to pay for the userOp execution.
     * @return validationData signature and time-range of this operation
     *      <20-byte> sigAuthorizer - 0 for valid signature, 1 to mark signature failure,
     *         otherwise, an address of an "authorizer" contract.
     *      <6-byte> validUntil - last timestamp this operation is valid. 0 for "indefinite"
     *      <6-byte> validAfter - first timestamp this operation is valid
     *      If no time-range in account, return SIG_VALIDATION_FAILED (1) for signature failure.
     *      Note that the validation code cannot use block.timestamp (or block.number) directly.
     */
    function validateUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external returns (uint256);

    /**
     * @return nonce the account nonce.
     * @dev This method returns the next sequential nonce.
     * @notice Provides 2D nonce functionality by allowing to use a nonce of a specific key.
     */
    function nonce(uint192 _key) external view returns (uint256);

    /**
     * return the entryPoint used by this account.
     * subclass should return the current entryPoint used by this account.
     */
    function entryPoint() external view returns (IEntryPoint);
}
