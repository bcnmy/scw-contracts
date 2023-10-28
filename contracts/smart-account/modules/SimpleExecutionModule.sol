// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {ReentrancyGuard} from "../common/ReentrancyGuard.sol";
import "../interfaces/modules/ISimpleExecutionModule.sol";
import "../interfaces/modules/IExecFromModule.sol";

contract SimpleExecutionModule is ISimpleExecutionModule, ReentrancyGuard {
    /**
     * @dev Allows to execute a transaction on SA.execute() internal method which opens up ability to do delegate calls
     * @dev required to be called by a Smart Account hence signature validation should have been done 
     * using 4337 flow (validation modules) or non-4337 flow
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

        // Review: We could add post checks to double check undesired effects of the transaction
        // below should not be allowed
        // 1. changing implementation
        // 2. any changes in storage layout 
    }
}
