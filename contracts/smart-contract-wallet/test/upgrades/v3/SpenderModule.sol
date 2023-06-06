// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import "hardhat/console.sol";
import {Enum} from "../../../common/Enum.sol";

interface IModuleExecution {
    function execTransactionFromModule(
        address to,
        uint256 value,
        bytes memory data,
        Enum.Operation operation
    ) external returns (bool success);
}

contract SpenderModule {
    function spend(
        address _tokenAddress,
        address _to,
        uint256 _amount,
        address smartAccountAddress
    ) external {
        //console.log("SpenderModule called at", address(this));
        //console.log("gas before calling execTransactionFromModule: ", gasleft());
        IModuleExecution(smartAccountAddress).execTransactionFromModule(
            _tokenAddress,
            0,
            abi.encodeWithSignature("transfer(address,uint256)", _to, _amount),
            Enum.Operation.Call
        );
    }
}
