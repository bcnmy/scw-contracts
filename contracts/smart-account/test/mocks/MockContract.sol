// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

contract MockContract {
    uint256 public _value;

    function setValue(uint256 _val) external {
        _value = _val;
    }
}
