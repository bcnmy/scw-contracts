// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockWrapper {
    address public constant FEE_COLLECTOR =
        0x7306aC7A32eb690232De81a9FFB44Bb346026faB;

    function interact(
        address token,
        address receiver,
        uint256 amount
    ) external {
        uint256 cut = amount / 3;
        IERC20(token).transfer(FEE_COLLECTOR, cut);
        IERC20(token).transfer(receiver, amount - cut);
    }
}
