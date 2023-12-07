// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/* solhint-disable no-unused-import */

import {BaseAuthorizationModule} from "./BaseAuthorizationModule.sol";
import {EIP1271_MAGIC_VALUE} from "contracts/smart-account/interfaces/ISignatureValidator.sol";
import {UserOperation} from "@account-abstraction/contracts/interfaces/UserOperation.sol";
import {IAuthorizationModule} from "../interfaces/IAuthorizationModule.sol";
import {ISignatureValidator} from "../interfaces/ISignatureValidator.sol";

/**
 * @title Mock validation module which allows any user operation.
 * @notice DO NOT USE THIS MODULE IN PRODUCTION
 */

contract MockValidationModule is BaseAuthorizationModule {
    string public constant NAME = "Mock Validation Module";
    string public constant VERSION = "0.1.0";

    function initForSmartAccount() external returns (address) {
        return address(this);
    }

    /// @inheritdoc IAuthorizationModule
    function validateUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash
    ) external view virtual override returns (uint256) {
        (userOp, userOpHash);
        return VALIDATION_SUCCESS;
    }

    /**
     * @inheritdoc ISignatureValidator
     * @dev Validates a signature for a message.
     * @dev Appends smart account address to the hash to avoid replay attacks
     * To be called from a Smart Account.
     * @param dataHash Hash of the message that was signed.
     * @param moduleSignature Signature to be validated.
     * @return EIP1271_MAGIC_VALUE if signature is valid, 0xffffffff otherwise.
     */
    function isValidSignature(
        bytes32 dataHash,
        bytes memory moduleSignature
    ) public view virtual override returns (bytes4) {
        return
            isValidSignatureForAddress(dataHash, moduleSignature, msg.sender);
    }

    function isValidSignatureForAddress(
        bytes32 dataHash,
        bytes memory moduleSignature,
        address smartAccount
    ) public view virtual returns (bytes4) {
        return EIP1271_MAGIC_VALUE;
    }

    /// @inheritdoc ISignatureValidator
    function isValidSignatureUnsafe(
        bytes32 dataHash,
        bytes memory moduleSignature
    ) public view virtual returns (bytes4) {
        return
            isValidSignatureForAddressUnsafe(
                dataHash,
                moduleSignature,
                msg.sender
            );
    }

    function isValidSignatureForAddressUnsafe(
        bytes32 dataHash,
        bytes memory moduleSignature,
        address smartAccount
    ) public view virtual returns (bytes4) {
        return EIP1271_MAGIC_VALUE;
    }
}
