// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockWrapper {
    // fixed fee collector address for testing
    address public constant FEE_COLLECTOR =
        0x7306aC7A32eb690232De81a9FFB44Bb346026faB;

    /**
     * @dev Intercept erc20 transfer and send 1/3 of the amount to the fee collector
     * @notice This must be called via delegate call as this wrapper just acts as a logic to split payments
     */
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
