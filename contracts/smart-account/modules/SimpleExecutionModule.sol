// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {ReentrancyGuard} from "../common/ReentrancyGuard.sol";
// import {ISignatureValidator} from "../interfaces/ISignatureValidator.sol";
import "../interfaces/modules/ISimpleExecutionModule.sol";

contract SimpleExecutionModule is ISimpleExecutionModule, ReentrancyGuard {
    /**
     * @dev Safe (ex-Gnosis) style transaction
     * @dev Allows to execute a transaction on SA.execute() internal method which opens up ability to do delegate calls
     * @dev required to be called by a Smart Account
     * @param _tx Smart Account transaction
     */

    // Should do validation using one of the validation modules..

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
