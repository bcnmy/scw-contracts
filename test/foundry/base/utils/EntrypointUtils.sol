// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {EntryPoint, IEntryPoint, UserOperation} from "aa-core/EntryPoint.sol";
import {Vm, Test} from "forge-std/Test.sol";

abstract contract EntryPointUtils is Test {
    // Event Topics

    // keccak256("UserOperationEvent(bytes32 indexed,address indexed,address indexed,uint256,bool,uint256,uint256))"
    bytes32 private constant userOperationEventTopic =
        0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f;

    // keccak256("UserOperationRevertReason(bytes32 indexed,address indexed,uint256,bytes)")
    bytes32 private constant userOperationRevertReasonTopic =
        0x1c4fada7374c0a9ee8841fc38afe82932dc0f8e69012e927f061a8bae611a201;

    struct UserOperationEventData {
        bytes32 userOpHash;
        address sender;
        address paymaster;
        uint256 nonce;
        bool success;
        uint256 actualGasCost;
        uint256 actualGasUsed;
    }

    struct UserOperationRevertReasonEventData {
        bytes32 userOpHash;
        address sender;
        uint256 nonce;
        bytes revertReason;
    }

    function getUserOperationEventData(
        Vm.Log[] memory _entries
    ) internal returns (UserOperationEventData memory data) {
        for (uint256 i = 0; i < _entries.length; ++i) {
            if (_entries[i].topics[0] != userOperationEventTopic) {
                continue;
            }
            data.userOpHash = _entries[i].topics[1];
            data.sender = address(uint160(uint256(_entries[i].topics[2])));
            data.paymaster = address(uint160(uint256(_entries[i].topics[3])));
            (
                data.nonce,
                data.success,
                data.actualGasCost,
                data.actualGasUsed
            ) = abi.decode(_entries[i].data, (uint256, bool, uint256, uint256));
            return data;
        }
        fail("entries does not contain UserOperationEvent");
    }

    function getUserOperationRevertReasonEventData(
        Vm.Log[] memory _entries
    ) internal returns (UserOperationRevertReasonEventData memory data) {
        for (uint256 i = 0; i < _entries.length; ++i) {
            if (_entries[i].topics[0] != userOperationRevertReasonTopic) {
                continue;
            }
            data.userOpHash = _entries[i].topics[1];
            data.sender = address(uint160(uint256(_entries[i].topics[2])));
            (data.nonce, data.revertReason) = abi.decode(
                _entries[i].data,
                (uint256, bytes)
            );
            return data;
        }
        fail("entries does not contain UserOperationRevertReasonEvent");
    }
}
