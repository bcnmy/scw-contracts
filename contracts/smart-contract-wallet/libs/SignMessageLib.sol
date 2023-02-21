// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.0;

import "./SmartAccountStorage.sol";
import "../SmartAccount.sol";

/// @title SignMessageLib - Allows to set an entry in the signedMessages
/// @notice Inspired by Richard Meissner's (richard@gnosis.io) implementation
contract SignMessageLib is SmartAccountStorage {
    //keccak256(
    //    "SmartAccount(bytes message)"
    //);
    bytes32 private constant SMART_ACCOUNT_MSG_TYPEHASH = 0x28d088124dbd960bc410a6cf97d22994fb361d6b1da504b4751d1589f87720e5;

    event MessageSigned(bytes32 indexed messageHash);

    /// @dev Marks a message as signed, so that it can be used with EIP-1271
    /// @notice Marks a message (`_data`) as signed.
    /// @param _data Arbitrary length data that should be marked as signed on the behalf of address(this) smart account
    function signMessage(bytes calldata _data) external {
        bytes32 msgHash = getMessageHash(_data);
        signedMessages[msgHash] = 1;
        emit MessageSigned(msgHash);
    }

    /// @dev Returns hash of a message that can be signed by owners.
    /// @param message Message that should be hashed
    /// @return Message hash.
    function getMessageHash(bytes memory message) public view returns (bytes32) {
        bytes32 smartAccountMessageHash = keccak256(abi.encode(SMART_ACCOUNT_MSG_TYPEHASH, keccak256(message)));
        return keccak256(abi.encodePacked(bytes1(0x19), bytes1(0x01), SmartAccount(payable(address(this))).domainSeparator(), smartAccountMessageHash));
    }
}
