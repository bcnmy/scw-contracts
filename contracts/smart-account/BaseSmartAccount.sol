// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.23;

import {IBaseSmartAccount} from "./interfaces/IBaseSmartAccount.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {UserOperationLib, UserOperation} from "@account-abstraction/contracts/interfaces/UserOperation.sol";
import "@account-abstraction/contracts/core/Helpers.sol";

/**
 * Basic account implementation.
 * This contract provides the basic logic for implementing the IAccount interface: validateUserOp function
 * Specific account implementation should inherit it and provide the account-specific logic
 */
abstract contract BaseSmartAccount is IBaseSmartAccount {
    using UserOperationLib for UserOperation;

    // Return value in case of signature failure, with no time-range.
    // equivalent to _packValidationData(true,0,0);
    uint256 internal constant SIG_VALIDATION_FAILED = 1;

    /// @inheritdoc IBaseSmartAccount
    function init(
        address handler,
        address moduleSetupContract,
        bytes calldata moduleSetupData
    ) external virtual override returns (address);

    /// @inheritdoc IBaseSmartAccount
    function validateUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external virtual override returns (uint256);

    /// @inheritdoc IBaseSmartAccount
    function nonce(
        uint192 _key
    ) public view virtual override returns (uint256) {
        return entryPoint().getNonce(address(this), _key);
    }

    /// @inheritdoc IBaseSmartAccount
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
        if (missingAccountFunds != 0) {
            payable(msg.sender).call{
                value: missingAccountFunds,
                gas: type(uint256).max
            }("");
            //ignore failure (its EntryPoint's job to verify, not account.)
        }
    }
}
