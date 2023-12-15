// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

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
}
