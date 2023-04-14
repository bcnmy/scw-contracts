// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {IAccount} from "@account-abstraction/contracts/interfaces/IAccount.sol";
import {Enum} from "../../common/Enum.sol";

interface ISmartAccount is IAccount {
    /**
     * @dev Allows a Module to execute a transaction without any further confirmations.
     * @param to Destination address of module transaction.
     * @param value Ether value of module transaction.
     * @param data Data payload of module transaction.
     * @param operation Operation type of module transaction.
     */
    function execTransactionFromModule(
        address to,
        uint256 value,
        bytes calldata data,
        Enum.Operation operation
    ) external returns (bool success);
}
