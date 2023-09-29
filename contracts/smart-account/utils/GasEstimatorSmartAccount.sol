// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {SmartAccountFactory} from "../factory/SmartAccountFactory.sol";

// Contract for estimating gas on undeployed smart account
// Deploys a smart account and then calls the appropriate method
contract GasEstimatorSmartAccount {
    function estimate(
        address _actualWallet,
        address _factory,
        address _moduleSetupContract,
        bytes calldata _moduleSetupData,
        uint256 _index,
        bytes calldata _data // execTransaction data // counterFactual wallet should have assets if required
    ) external returns (bool success, bytes memory result, uint256 gas) {
        uint256 initialGas = gasleft();
        SmartAccountFactory(_factory).deployCounterFactualAccount(
            _moduleSetupContract,
            _moduleSetupData,
            _index
        );
        (success, result) = _actualWallet.call(_data);
        gas = initialGas - gasleft();
    }
}
