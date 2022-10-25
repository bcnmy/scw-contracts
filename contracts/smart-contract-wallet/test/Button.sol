// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;
import "@openzeppelin/contracts/access/Ownable.sol";

contract Button is Ownable {

   event ButtonPushed(address pusher, uint256 pushes);
   uint256 public pushes;

    function pushButton() public onlyOwner {
        pushes++;
        emit ButtonPushed(msg.sender, pushes);
     }
}