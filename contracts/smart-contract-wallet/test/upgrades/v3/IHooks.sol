// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

// interface for modules to verify singatures signed over userOpHash
interface IHooks {
    function preHook(
        address target,
        uint256 value,
        bytes memory data,
        address txnInitiator
    ) external;

    function postHook(
        address target,
        uint256 value,
        bytes memory data,
        address txnInitiator
    ) external;
}
