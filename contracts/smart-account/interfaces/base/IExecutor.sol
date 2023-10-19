// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.19;

import {Enum} from "../../common/Enum.sol";

/// @title Executor - A contract that can execute transactions
interface IExecutor {
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
}
