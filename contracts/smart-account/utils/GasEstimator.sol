// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Generic contract for estimating gas on any target and data
contract GasEstimator {
    /**
     * @notice Estimates the gas consumption of a call to a given address with specific data.
     * @dev This function does not revert if the call fails but instead returns the success status.
     * @param _to The address to call.
     * @param _data The calldata to send with the call.
     * @return success A boolean indicating if the call was successful.
     * @return result The bytes data returned from the called function.
     * @return gas The amount of gas consumed by the call.
     */
    function estimate(
        address _to,
        bytes calldata _data
    ) external returns (bool success, bytes memory result, uint256 gas) {
        uint256 initialGas = gasleft();
        (success, result) = _to.call(_data);
        gas = initialGas - gasleft();
    }
}
