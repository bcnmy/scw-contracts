// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

/* solhint-disable avoid-low-level-calls */
/* solhint-disable no-inline-assembly */
/* solhint-disable reason-string */

import {IAccount} from "@account-abstraction/contracts/interfaces/IAccount.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {UserOperationLib, UserOperation} from "@account-abstraction/contracts/interfaces/UserOperation.sol";
import {Enum} from "../../../common/Enum.sol";
import {BaseSmartAccountErrorsV1} from "./ErrorsV1.sol";
import "@account-abstraction/contracts/core/Helpers.sol";

struct Transaction {
    address to;
    Enum.Operation operation;
    uint256 value;
    bytes data;
    uint256 targetTxGas;
}

struct FeeRefund {
    uint256 baseGas;
    uint256 gasPrice; //gasPrice or tokenGasPrice
    uint256 tokenGasPriceFactor;
    address gasToken;
    address payable refundReceiver;
}

/**
 * Basic account implementation.
 * This contract provides the basic logic for implementing the IAccount interface: validateUserOp function
 * Specific account implementation should inherit it and provide the account-specific logic
 */
abstract contract BaseSmartAccount is IAccount, BaseSmartAccountErrorsV1 {
    using UserOperationLib for UserOperation;

    //return value in case of signature failure, with no time-range.
    // equivalent to _packValidationData(true,0,0);
    uint256 internal constant SIG_VALIDATION_FAILED = 1;

    /**
     * Validate user's signature and nonce.
     * Subclass doesn't need to override this method.
     * Instead, it should override the specific internal validation methods.
     */
    function validateUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external virtual override returns (uint256 validationData) {
        if (msg.sender != address(entryPoint()))
            revert CallerIsNotAnEntryPoint(msg.sender);
        validationData = _validateSignature(userOp, userOpHash);
        _validateNonce(userOp.nonce);
        _payPrefund(missingAccountFunds);
    }

    /**
     * @dev Gnosis style transaction with optional repay in native tokens OR ERC20
     * @dev Allows to execute a transaction confirmed by required signature/s and then pays the account that submitted the transaction.
     * @notice The fees are always transferred, even if the user transaction fails.
     * @param _tx Smart Account transaction
     * @param refundInfo Required information for gas refunds
     * @param signatures Packed signature/s data ({bytes32 r}{bytes32 s}{uint8 v})
     */
    function execTransaction(
        Transaction memory _tx,
        FeeRefund memory refundInfo,
        bytes memory signatures
    ) external payable virtual returns (bool success);

    /**
     * @dev Initialize the Smart Account with required states
     * @param _owner Signatory of the Smart Account
     * @param _handler Default fallback handler provided in Smart Account
     * @notice devs need to make sure it is only callble once by initiazer or state check restrictions
     */
    function init(address _owner, address _handler) external virtual;

    /**
     * @return nonce the account nonce.
     * @dev This method returns the next sequential nonce.
     * @notice For a nonce of a specific key, use `entrypoint.getNonce(account, key)`
     */
    function nonce() public view virtual returns (uint256) {
        return entryPoint().getNonce(address(this), 0);
    }

    /**
     * return the entryPoint used by this account.
     * subclass should return the current entryPoint used by this account.
     */
    function entryPoint() public view virtual returns (IEntryPoint);

    /**
     * validate the signature is valid for this message.
     * @param userOp validate the userOp.signature field
     * @param userOpHash convenient field: the hash of the request, to check the signature against
     *          (also hashes the entrypoint and chain id)
     * @return validationData signature and time-range of this operation
     *      <20-byte> sigAuthorizer - 0 for valid signature, 1 to mark signature failure,
     *         otherwise, an address of an "authorizer" contract.
     *      <6-byte> validUntil - last timestamp this operation is valid. 0 for "indefinite"
     *      <6-byte> validAfter - first timestamp this operation is valid
     *      If the account doesn't use time-range, it is enough to return SIG_VALIDATION_FAILED value (1) for signature failure.
     *      Note that the validation code cannot use block.timestamp (or block.number) directly.
     */
    function _validateSignature(
        UserOperation calldata userOp,
        bytes32 userOpHash
    ) internal virtual returns (uint256 validationData);

    /**
     * sends to the entrypoint (msg.sender) the missing funds for this transaction.
     * subclass MAY override this method for better funds management
     * (e.g. send to the entryPoint more than the minimum required, so that in future transactions
     * it will not be required to send again)
     * @param missingAccountFunds the minimum value this method should send the entrypoint.
     *  this value MAY be zero, in case there is enough deposit, or the userOp has a paymaster.
     */
    function _payPrefund(uint256 missingAccountFunds) internal virtual {
        if (missingAccountFunds != 0) {
            payable(msg.sender).call{
                value: missingAccountFunds,
                gas: type(uint256).max
            }("");
            //ignore failure (its EntryPoint's job to verify, not account.)
        }
    }

    /**
     * Validate the nonce of the UserOperation.
     * This method may validate the nonce requirement of this account.
     * e.g.
     * To limit the nonce to use sequenced UserOps only (no "out of order" UserOps):
     *      `require(nonce < type(uint64).max)`
     * For a hypothetical account that *requires* the nonce to be out-of-order:
     *      `require(nonce & type(uint64).max == 0)`
     *
     * The actual nonce uniqueness is managed by the EntryPoint, and thus no other
     * action is needed by the account itself.
     *
     * @param nonce to validate
     *
     * solhint-disable-next-line no-empty-blocks
     */
    function _validateNonce(uint256 nonce) internal view virtual {
        (nonce);
    }
}
