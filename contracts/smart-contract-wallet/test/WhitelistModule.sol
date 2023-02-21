// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.12;
import "../SmartAccount.sol";

contract WhitelistModule {

    mapping(address => bool) public whitelisted;
    address public moduleOwner;

    constructor(address _owner) {
        moduleOwner = _owner;
    }

    modifier onlyOwner {
        require(msg.sender == moduleOwner, "sender not authorized");
        _;
    }

    function whitelistDestination(address payable _target) external onlyOwner {
        require(_target != address(0),"Destination target can not be zero address");
        whitelisted[_target] = true;
    }
    
    function authCall(SmartAccount _account, address payable _to, uint96 _amount, bytes memory _data) external { // Could have some access control from here like guardians!
       require(_to != address(0),"Target can not be zero address");
       require(whitelisted[_to] == true,"Unauthorized :: Target must be whitelised!");
       require(_account.execTransactionFromModule(_to, _amount, _data, Enum.Operation.Call), "Could not execute ether transfer");
    }
}