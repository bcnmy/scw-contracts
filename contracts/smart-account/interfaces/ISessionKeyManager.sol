// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;
import {UserOperation} from "@account-abstraction/contracts/interfaces/UserOperation.sol";

interface ISessionKeyManager {
    function validateSessionKey(
        address userOpSender,
        uint48 validUntil,
        uint48 validAfter,
        address sessionValidationModule,
        bytes calldata sessionKeyData,
        bytes32[] calldata merkleProof
    ) external;
}
