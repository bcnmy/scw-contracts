// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {BaseAuthorizationModule} from "./BaseAuthorizationModule.sol";
import {Enum} from "../../common/Enum.sol";
import {UserOperation} from "@account-abstraction/contracts/interfaces/UserOperation.sol";

contract AuthorizationModule is BaseAuthorizationModule {
    string public constant NAME = "Authorization Module";
    string public constant VERSION = "0.1.0";

    uint256 public SIG_LENGTH_REQUIRED;

    constructor() {
        SIG_LENGTH_REQUIRED = type(uint256).max;
    }

    function initialize(uint256 sigLengthRequired) external virtual {
        if (SIG_LENGTH_REQUIRED != 0) {
            revert("Module already initialized");
        }
        SIG_LENGTH_REQUIRED = sigLengthRequired;
    }

    function validateUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash
    ) external view virtual returns (uint256) {
        (bytes memory moduleSignature, ) = abi.decode(
            userOp.signature,
            (bytes, address)
        );
        return _validateSignature(userOp, userOpHash, moduleSignature);
    }

    function _validateSignature(
        UserOperation calldata userOp,
        bytes32 userOpHash,
        bytes memory moduleSignature
    ) internal view virtual returns (uint256 sigValidationResult) {
        if (moduleSignature.length == SIG_LENGTH_REQUIRED) {
            return 0;
        }
        return SIG_VALIDATION_FAILED;
    }

    function isValidSignature(
        bytes32 _hash,
        bytes memory moduleSignature
    ) public view virtual override returns (bytes4) {
        //temporary
        if (moduleSignature.length == SIG_LENGTH_REQUIRED) {
            return EIP1271_MAGIC_VALUE;
        }
        return bytes4(0xffffffff);
    }
}
