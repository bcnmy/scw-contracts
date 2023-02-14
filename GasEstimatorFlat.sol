// Sources flattened with hardhat v2.11.1 https://hardhat.org

// File contracts/smart-contract-wallet/utils/GasEstimator.sol

// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

// Generic contract for estimating gas on any target and data
contract GasEstimator {
  function estimate(
    address _to,
    bytes calldata _data
  ) external returns (bool success, bytes memory result, uint256 gas) {
    // solhint-disable
    uint256 initialGas = gasleft();
    (success, result) = _to.call(_data);
    gas = initialGas - gasleft();
    // solhint-enable
  }
}
