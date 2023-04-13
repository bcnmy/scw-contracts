pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/Ownable.sol";

contract Whitelist is Ownable {
    mapping(address => bool) whitelist;

    event AddedToWhitelist(address indexed account);
    event RemovedFromWhitelist(address indexed account);

    modifier onlyWhitelisted() {
        require(isWhitelisted(msg.sender), "Sender not whitelisted");
        _;
    }

    function add(address _address) public onlyOwner {
        whitelist[_address] = true;
        emit AddedToWhitelist(_address);
    }

    function remove(address _address) public onlyOwner {
        whitelist[_address] = false;
        emit RemovedFromWhitelist(_address);
    }

    function isWhitelisted(address _address) public view returns(bool) {
        return whitelist[_address];
    }
}
