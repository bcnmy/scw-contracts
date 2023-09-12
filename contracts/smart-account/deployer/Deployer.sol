//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.17;

import "./Create3.sol";

contract Deployer {
    event ContractDeployed(address indexed contractAddress);

    function deploy(bytes32 _salt, bytes calldata _creationCode) external {
        address deployedContract = Create3.create3(_salt, _creationCode);
        emit ContractDeployed(deployedContract);
    }

    function addressOf(bytes32 _salt) external view returns (address) {
        return Create3.addressOf(_salt);
    }
}
