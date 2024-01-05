// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.23;

import {ISmartAccount} from "../../interfaces/ISmartAccount.sol";

contract MockEthSender {
    receive() external payable {
        //
    }

    function send(
        address to,
        uint256 amount,
        uint256 gasStipend
    ) external payable {
        bool success;
        assembly {
            success := call(
                gasStipend,
                to,
                amount,
                codesize(),
                0x00,
                codesize(),
                0x00
            )
        }
        if (!success) revert("Can not send eth");
    }

    function sendPreWarm(
        address to,
        uint256 amount,
        uint256 gasStipend
    ) external payable {
        // pre warming the storage slot in the proxy that stores the implementation address
        // this reduces the gas cost of the first delegatecall to the implementation
        // thanks to Ankur Dubey for this discovery
        ISmartAccount(to).getImplementation();

        bool success;
        assembly {
            success := call(
                gasStipend,
                to,
                amount,
                codesize(),
                0x00,
                codesize(),
                0x00
            )
        }
        if (!success) revert("Can not send eth");
    }
}
