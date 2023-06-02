// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import {BaseAuthorizationModule, UserOperation} from "../../modules/BaseAuthorizationModule.sol";

contract MockInvalidInitialAuthModule is BaseAuthorizationModule {
    mapping(address => bytes) internal setupData;

    function init(bytes calldata setupData_) external returns (address) {
        setupData[msg.sender] = setupData_;
        // return address(this);
        // should return an address of a module that has been set up but it doesn't
    }

    function validateUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash
    ) external returns (uint256 validationData) {
        validationData = 0; //means validation success
    }

    function isValidSignature(
        bytes32 _dataHash,
        bytes memory _signature
    ) public view virtual override returns (bytes4) {
        return EIP1271_MAGIC_VALUE; //always valid signature
    }
}
