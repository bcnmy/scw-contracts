// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.23;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockProtocol {
    mapping(address => uint256) public states;
    mapping(address => bytes) public bytesStates;
    mapping(address => uint256) public unallowedTriggers;

    function interact(address token, uint256 amount) external {
        IERC20(token).transferFrom(msg.sender, address(this), amount);
    }

    function changeState(
        uint256 newValue,
        bytes calldata bytesValue
    ) external payable {
        states[msg.sender] = newValue;
        bytesStates[msg.sender] = bytesValue;
    }

    function getState(address user) external view returns (uint256) {
        return states[user];
    }

    function getBytesState(address user) external view returns (bytes memory) {
        return bytesStates[user];
    }

    function notAllowedMethod() external {
        unallowedTriggers[msg.sender]++;
    }

    function getUnallowedTriggers(
        address user
    ) external view returns (uint256) {
        return unallowedTriggers[user];
    }

    function testArgsMethod(
        uint256 arg1,
        uint256 arg2,
        uint256 arg3
    ) external {}
}
