// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.17;

import {Enum} from "../common/Enum.sol";

/// @title Executor - A contract that can execute transactions
abstract contract Executor {
    // Could add a flag fromEntryPoint for AA txn
    event ExecutionFailure(
        address indexed to,
        uint256 indexed value,
        bytes indexed data,
        Enum.Operation operation,
        uint256 txGas
    );
    event ExecutionSuccess(
        address indexed to,
        uint256 indexed value,
        bytes indexed data,
        Enum.Operation operation,
        uint256 txGas
    );

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
                success := delegatecall(
                    txGas,
                    to,
                    add(data, 0x20),
                    mload(data),
                    0,
                    0
                )
            }
        } else {
            // solhint-disable-next-line no-inline-assembly
            assembly {
                success := call(
                    txGas,
                    to,
                    value,
                    add(data, 0x20),
                    mload(data),
                    0,
                    0
                )
            }
        }
        if (success) emit ExecutionSuccess(to, value, data, operation, txGas);
        else emit ExecutionFailure(to, value, data, operation, txGas);
    }
}
