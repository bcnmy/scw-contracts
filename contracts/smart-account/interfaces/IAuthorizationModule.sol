// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;
import {UserOperation} from "@account-abstraction/contracts/interfaces/UserOperation.sol";

// interface for modules to verify singatures signed over userOpHash
interface IAuthorizationModule {
    function validateUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash
    ) external returns (uint256 validationData);
}
