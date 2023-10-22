// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.17;

import {IExecutor} from "../interfaces/base/IExecutor.sol";
import {Enum} from "../common/Enum.sol";

/// @title Executor - A contract that can execute transactions
abstract contract Executor is IExecutor {
    /**
     * @notice Executes a given operation (either Call or DelegateCall) to a specified address with provided data.
     * @param to The address to which the operation should be executed.
     * @param value The amount of ether (in wei) to send with the call (only for Call operations).
     * @param data The call data to send with the operation.
     * @param operation The type of operation to execute (either Call or DelegateCall).
     * @param txGas The amount of gas to use for the operation.
     * @return success A boolean indicating whether the operation was successful.
     */
    function _execute(
        address to,
        uint256 value,
        bytes memory data,
        Enum.Operation operation,
        uint256 txGas
    ) internal returns (bool success) {
        if (operation == Enum.Operation.DelegateCall) {
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
