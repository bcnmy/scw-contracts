// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract BTPMTokenFaucet {
    address public owner;
    // Test token contract interface
    IERC20 public token;
    // timestamp of last token send
    uint256 public lastSend;
    // mapping of users and last drip time
    mapping(address => uint256) public lastDrip;

    // constructor sets token contract addresses and lastSend to current time
    constructor(address _tokenAddress) {
        owner = msg.sender;
        token = IERC20(_tokenAddress);
        lastSend = block.timestamp;
    }

    // send tokens to user if 24 hours have elapsed since last drip
    function drip() public {
        require(block.timestamp >= lastDrip[msg.sender] + 1 days, "24 hours have not elapsed since last drip");
        require(token.balanceOf(address(this)) >= 25e6, "Test token balance insufficient");
        require(token.transfer(msg.sender, 25e6), "Test token transfer failed");
        lastDrip[msg.sender] = block.timestamp;
    }

    // allow owner to withdraw all tokens from the contract
    function withdrawAll() public {
        require(msg.sender == owner, "Only the owner can withdraw tokens");
        uint256 tokenBalance = token.balanceOf(address(this));
        token.transfer(msg.sender, tokenBalance);
    }

    // get the balance of Test Token 
    function getBalance() public view returns (uint256 tokenBalance) {
        return (token.balanceOf(address(this)));
    }
}