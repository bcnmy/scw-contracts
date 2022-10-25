// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.12;

import "../common/Enum.sol";

/// @title Executor - A contract that can execute transactions
contract Executor {
    // Could add a flag fromEntryPoint for AA txn
    event ExecutionFailure(address to, uint256 value, bytes data, Enum.Operation operation, uint256 txGas);
    event ExecutionSuccess(address to, uint256 value, bytes data, Enum.Operation operation, uint256 txGas);

    // Could add a flag fromEntryPoint for AA txn
    function execute(
        address to,
        uint256 value,
        bytes memory data,
        Enum.Operation operation,
        uint256 txGas
    ) internal returns (bool success) {
        if (operation == Enum.Operation.DelegateCall) {
            // solhint-disable-next-line no-inline-assembly
            assembly {
                success := delegatecall(txGas, to, add(data, 0x20), mload(data), 0, 0)
            }
        } else {
            // solhint-disable-next-line no-inline-assembly
            assembly {
                success := call(txGas, to, value, add(data, 0x20), mload(data), 0, 0)
            }
        }
        // Emit events here..
        if (success) emit ExecutionSuccess(to, value, data, operation, txGas);
        else emit ExecutionFailure(to, value, data, operation, txGas);
    }
    
}
