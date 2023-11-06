// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

interface IAddressResolver {
    function getAddressForCounterFactualAccount(
        address moduleSetupContract,
        bytes calldata moduleSetupData,
        uint256 index
    ) external view returns (address _account);

    function getAddressForCounterFactualAccount(
        address _owner,
        uint256 _index
    ) external view returns (address _account);
}
