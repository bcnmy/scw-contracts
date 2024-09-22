// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

/* solhint-disable avoid-low-level-calls */
/* solhint-disable no-inline-assembly */
/* solhint-disable reason-string */

import {IAccount} from "@vechain/account-abstraction-contracts/interfaces/IAccount.sol";
import {IEntryPoint} from "@vechain/account-abstraction-contracts/interfaces/IEntryPoint.sol";
import {UserOperationLib, UserOperation} from "@vechain/account-abstraction-contracts/interfaces/UserOperation.sol";
import {BaseSmartAccountErrors} from "./common/Errors.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * Basic account implementation.
 * This contract provides the basic logic for implementing the IAccount interface: validateUserOp function
 * Specific account implementation should inherit it and provide the account-specific logic
 */
abstract contract BaseSmartAccount is IAccount, BaseSmartAccountErrors {
    // VTHO Token Information
    address public constant VTHO_TOKEN_ADDRESS = 0x0000000000000000000000000000456E65726779;
    IERC20 public constant VTHO_TOKEN_CONTRACT = IERC20(VTHO_TOKEN_ADDRESS);

    using UserOperationLib for UserOperation;

    //return value in case of signature failure, with no time-range.
    // equivalent to _packValidationData(true,0,0);
    uint256 internal constant SIG_VALIDATION_FAILED = 1;

    /**
     * @dev Initialize the Smart Account with required states
     * @param handler Default fallback handler provided in Smart Account
     * @param moduleSetupContract Contract, that setups initial auth module for this smart account. It can be a module factory or
     *                            a registry module that serves several smart accounts.
     * @param moduleSetupData data containing address of the Setup Contract and a setup data
     * @notice devs need to make sure it is only callable once (use initializer modifier or state check restrictions)
     */
    function init(
        address handler,
        address moduleSetupContract,
        bytes calldata moduleSetupData
    ) external virtual returns (address);

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
     *      If the account doesn't use time-range, it is enough to return SIG_VALIDATION_FAILED value (1) for signature failure.
     *      Note that the validation code cannot use block.timestamp (or block.number) directly.
     */
    function validateUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external virtual override returns (uint256);

    /**
     * @return nonce the account nonce.
     * @dev This method returns the next sequential nonce.
     * @notice Provides 2D nonce functionality by allowing to use a nonce of a specific key.
     */
    function nonce(uint192 _key) public view virtual returns (uint256) {
        return entryPoint().getNonce(address(this), _key);
    }

    /**
     * return the entryPoint used by this account.
     * subclass should return the current entryPoint used by this account.
     */
    function entryPoint() public view virtual returns (IEntryPoint);

    /**
     * sends to the entrypoint (msg.sender) the missing funds for this transaction.
     * subclass MAY override this method for better funds management
     * (e.g. send to the entryPoint more than the minimum required, so that in future transactions
     * it will not be required to send again)
     * @param missingAccountFunds the minimum value this method should send the entrypoint.
     *  this value MAY be zero, in case there is enough deposit, or the userOp has a paymaster.
     */
    function _payPrefund(uint256 missingAccountFunds) internal virtual {
        // Review how entry point deposit accounting works when VHTO is transferred
        // Note: VTHO prior approval must have been set first
        if (missingAccountFunds != 0) {
            // Deposit specified amount to EP for SA
            entryPoint().depositAmountTo(address(this), missingAccountFunds);
        }
    }
}
