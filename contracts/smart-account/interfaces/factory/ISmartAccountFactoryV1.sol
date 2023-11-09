// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.20;

interface ISmartAccountFactoryV1 {
    function getAddressForCounterFactualAccount(
        address _owner,
        uint256 _index
    ) external view returns (address _account);
}
