// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IEntryPoint} from "@vechain/account-abstraction-contracts/interfaces/IEntryPoint.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title Stakeable Entity
 * @author Fil Makarov - <filipp.makarov@biconomy.io>
 */
contract Stakeable is Ownable {
    // VTHO Token Information
    address public constant VTHO_TOKEN_ADDRESS = 0x0000000000000000000000000000456E65726779;
    IERC20 public constant VTHO_TOKEN_CONTRACT = IERC20(VTHO_TOKEN_ADDRESS);

    constructor(address _newOwner) {
        _transferOwnership(_newOwner);
    }

    function addStake(
        address epAddress,
        uint32 unstakeDelaySec,
        uint256 amount
    ) external payable onlyOwner {
        require(epAddress != address(0), "Invalid EP address");
        require(VTHO_TOKEN_CONTRACT.approve(epAddress, amount), "Approval to EntryPoint Failed");
        IEntryPoint(epAddress).addStake(unstakeDelaySec);
    }

    function unlockStake(address epAddress) external onlyOwner {
        require(epAddress != address(0), "Invalid EP address");
        IEntryPoint(epAddress).unlockStake();
    }

    function withdrawStake(
        address epAddress,
        address payable withdrawAddress
    ) external onlyOwner {
        require(epAddress != address(0), "Invalid EP address");
        IEntryPoint(epAddress).withdrawStake(withdrawAddress);
    }
}
