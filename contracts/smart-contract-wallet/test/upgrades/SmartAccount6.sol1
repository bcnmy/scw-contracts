// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../SmartAccount.sol";
import "hardhat/console.sol";

contract SmartAccount6 is SmartAccount {
    // AA immutable storage
    IEntryPoint private immutable _entryPoint;

    address public friend;
    bool public isDone;

    modifier onlyFriend() {
        require(msg.sender == friend, "only friend!");
        _;
    }

    // This constructor ensures that this contract can only be used as a master copy for Proxy accounts
    constructor(IEntryPoint anEntryPoint) SmartAccount(anEntryPoint) {
        // By setting the owner it is not possible to call init anymore,
        // so we create an account with fixed non-zero owner.
        // This is an unusable account, perfect for the singleton
        owner = address(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE);
        friend = address(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE);
        require(address(anEntryPoint) != address(0), "Invalid Entrypoint");
        _entryPoint = anEntryPoint;
        // _chainId = block.chainid;
    }

    function reinit(address _friend) public {
        require(friend == address(0), "Already initialized");
        require(_friend != address(0), "Invalid owner");
        friend = _friend;
        isDone = false;
    }

    function transferByFriend(
        address payable dest,
        uint amount
    ) public virtual onlyFriend {
        require(dest != address(0), "this action will burn your funds");
        require(amount <= 1 ether, "can't exceed");
        require(isDone == false, "only once during urgency");
        (bool success, ) = dest.call{value: amount}("");
        require(success, "transfer failed");
        isDone = true;
    }
}
