// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {Enum} from "../../common/Enum.sol";

interface IExecFromModule {
    function execTransactionFromModule(
        address to,
        uint256 value,
        bytes memory data,
        Enum.Operation operation,
        uint256 txGas
    ) external returns (bool success);

    function execTransactionFromModule(
        address to,
        uint256 value,
        bytes memory data,
        Enum.Operation operation
    ) external returns (bool success);
}

/**
 */
interface ISimpleExecutionModule {
    
    struct Transaction {
        address to;
        Enum.Operation operation;
        uint256 value;
        bytes data;
    }

    /**
     * @notice Throws when the transaction execution fails
     */
    error ExecutionFailed();

    function execTransaction(
        Transaction memory _tx
    ) external payable returns (bool);
}
