// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {Enum} from "../common/Enum.sol";
import {ReentrancyGuard} from "../common/ReentrancyGuard.sol";
import {Math} from "../libs/Math.sol";

/**
 * @notice Throws when the transaction execution fails
 */
error ExecutionFailed();

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

struct Transaction {
    address to;
    Enum.Operation operation;
    uint256 value;
    bytes data;
}

contract SimpleExecutionModule is ReentrancyGuard {
    /**
     * @dev Safe (ex-Gnosis) style transaction
     * @dev Allows to execute a transaction on SA.execute() internal method which opens up ability to do delegate calls
     * @dev required to be called by a Smart Account
     * @param _tx Smart Account transaction
     */

    function execTransaction(
        Transaction memory _tx
    ) public payable virtual nonReentrant returns (bool success) {
        success = IExecFromModule(msg.sender).execTransactionFromModule(
            _tx.to,
            _tx.value,
            _tx.data,
            _tx.operation
        );
        if (!success) {
            revert ExecutionFailed();
        }
    }
}
