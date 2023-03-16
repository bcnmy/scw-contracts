// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

contract Upgrader {
    bytes32 internal constant _IMPLEMENTATION_SLOT =
        0x37722d148fb373b961a84120b6c8d209709b45377878a466db32bbc40d95af26;

    function upgrade(address _to) external {
        assembly {
            sstore(_IMPLEMENTATION_SLOT, _to)
        }
    }
}
