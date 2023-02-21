// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.0;

/// @title SmartAccountStorage - Storage layout of the Smart Account contracts to be used in libraries
/// @dev Should reflect the SmartAccount.sol storage structure (order of inheritance matters).
contract SmartAccountStorage {

    // ModuleManager storage
    mapping(address => address) internal modules;

    // Initializable
    // Most probably will be removed in the further branches
    uint8 internal _initialized;
    bool internal _initializing;

    // ReentrancyGuardUpgradeable 
    // Most probably will be removed in the further branches
    uint256 internal _status;
    uint256[49] internal __gap;

    // Smart Account Storage
    address internal owner;
    mapping(uint256 => uint256) internal nonces;
    mapping(bytes32 => uint256) internal signedMessages;
}
