// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {Enum} from "../../common/Enum.sol";

/**
 */
interface ISimpleExecutionModule {
    /**
     * Smart Account Transaction
     */
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

    /**
     * @dev Allows to execute a transaction on SA.execute() internal method
     * @dev This method is to be written in a module which is enabled on a Smart Account
     * @param _tx Smart Account transaction
     */
    function execTransaction(
        Transaction memory _tx
    ) external payable returns (bool);
}
