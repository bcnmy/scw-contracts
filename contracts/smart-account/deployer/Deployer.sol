//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.23;

import "./Create3.sol";

contract Deployer {
    event ContractDeployed(address indexed contractAddress);

    /**
     * @dev Deploys a new contract using the Create3 library with a specific salt and initialization code.
     * @param _salt The salt used to derive the deployed contract address.
     * @param _creationCode The bytecode used to initialize and deploy the contract.
     */
    function deploy(bytes32 _salt, bytes calldata _creationCode) external {
        address deployedContract = Create3.create3(_salt, _creationCode);
        emit ContractDeployed(deployedContract);
    }

    /**
     * @dev Computes the final deployed address using the Create3 library and a given salt.
     * @param _salt The salt used in the original Create3 deployment.
     * @return Address of the final deployed contract.
     */
    function addressOf(bytes32 _salt) external view returns (address) {
        return Create3.addressOf(_salt);
    }
}
