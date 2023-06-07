// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;
import {IHooks} from "./IHooks.sol";
import "hardhat/console.sol";
import {Enum} from "../../../common/Enum.sol";

interface ISmartAccount {
    function execTransactionFromModule(
        address to,
        uint256 value,
        bytes memory data,
        Enum.Operation operation
    ) external returns (bool success);
}

contract MockHookModule is IHooks {
    uint256 public counter = 0;

    function preHook(
        address target,
        uint256 value,
        bytes memory data,
        address txnInitiator
    ) external {
        counter++;
        //console.log("preHook called at", address(this));
    }

    function postHook(
        address target,
        uint256 value,
        bytes memory data,
        address txnInitiator
    ) external {
        counter++;
        //console.log("postHook called at", address(this));
    }

    function transfer(
        address smartAccount,
        address token,
        address to,
        uint256 amount
    ) external {
        ISmartAccount(smartAccount).execTransactionFromModule(
            token,
            0,
            abi.encodeWithSignature("transfer(address,uint256)", to, amount),
            Enum.Operation.Call
        );
    }
}
