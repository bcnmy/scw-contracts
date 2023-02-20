// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.0;

/// @title SmartAccountStorage - Storage layout of the Smart Account contracts to be used in libraries
contract SmartAccountStorage {

    // ModuleManager storage
    mapping(address => address) internal modules;

    // Smart Account Storage
    mapping(uint256 => uint256) internal nonces;
    mapping(bytes32 => uint256) internal signedMessages;
}
