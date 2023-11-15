// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IAddressResolver {
    struct SmartAccountResult {
        address accountAddress;
        address factoryAddress;
        address currentImplementation;
        string currentVersion;
        string factoryVersion;
        uint256 deploymentIndex;
    }
}
