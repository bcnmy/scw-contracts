// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.12;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract StakedTestToken is ERC20 {

    address public STAKED_TOKEN;

    constructor (address _token) 
        ERC20("stTST", "StakedTestToken") {
        STAKED_TOKEN = _token;
    }

    function mint(address sender, uint amount) external {
        _mint(sender, amount);
    }

    function stake(address _for, uint amount) external {
        IERC20(STAKED_TOKEN).transferFrom(msg.sender, address(this), amount);
        _mint(_for, amount);
    }
}
