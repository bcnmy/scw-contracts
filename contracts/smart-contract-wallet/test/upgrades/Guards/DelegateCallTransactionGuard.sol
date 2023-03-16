// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.17;

import {Enum} from "../../../common/Enum.sol";
import {BaseGuard} from "./GuardManager.sol";
import {Transaction, FeeRefund} from "../../../BaseSmartAccount.sol";

contract DelegateCallTransactionGuard is BaseGuard {
    error DelegateCallGuardRestricted();

    address public immutable allowedTarget;

    constructor(address target) {
        allowedTarget = target;
    }

    // solhint-disable-next-line payable-fallback
    fallback() external {
        // We don't revert on fallback to avoid issues in case of a SmartAccount upgrade
        // E.g. The expected check method might change and then the Smart Account would be locked.
    }

    function checkTransaction(
        Transaction memory _tx,
        FeeRefund memory,
        bytes memory,
        address
    ) external view override {
        if (
            _tx.operation == Enum.Operation.DelegateCall &&
            _tx.to != allowedTarget
        ) revert DelegateCallGuardRestricted();
    }

    function checkAfterExecution(bytes32, bool) external view override {}
}
