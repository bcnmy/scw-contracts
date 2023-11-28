// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

contract MockSubscriptionProvider {
    uint256 public price;
    mapping(address => uint256) public paymentTimes;

    constructor(uint256 _price) {
        price = _price;
    }

    function extendSubscription() external payable {
        require(msg.value == price, "Invalid price");
        paymentTimes[msg.sender] = block.timestamp;
    }
}
