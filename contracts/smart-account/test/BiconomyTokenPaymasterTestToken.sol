// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract BTPMTestToken is ERC20, Ownable {
    // ratio for swap
    uint256 public nativeToTokenRatio = 100000; // so: 1 ETH = 100000 token, 0.1 ETH = 10000 token

    // Constructor
    constructor(address owner) ERC20("USDC", "USDC") {
        mint(owner, 10000000 * 1e18);
        mint(msg.sender, 10000000 * 1e18);
        transferOwnership(owner);
    }

    // owner mint
    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }

    // public mint with native token
    function publicMint() public payable {
        require(msg.value > 0, "native amount should be greater than 0");

        uint256 tokensToMint = msg.value * nativeToTokenRatio;
        _mint(msg.sender, tokensToMint);
    }

    // owner withdraw native tokens by owner
    function withdraw() public onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "Insufficient balance");

        payable(owner()).transfer(balance);
    }
}