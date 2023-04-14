// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {BaseAuthorizationModule} from "./BaseAuthorizationModule.sol";
import {Enum} from "../../common/Enum.sol";
import {UserOperation} from "@account-abstraction/contracts/interfaces/UserOperation.sol";
import {ISmartAccount} from "./ISmartAccount.sol";

import "hardhat/console.sol";

contract AuthorizationModule is BaseAuthorizationModule {
    string public constant NAME = "Authorization Module";
    string public constant VERSION = "0.1.0";

    ISmartAccount public smartAccount;

    constructor() {
        smartAccount = ISmartAccount(
            0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE
        );
    }

    function initialize(address _smartAccount) external virtual {
        if (address(smartAccount) != address(0)) {
            revert("Module already initialized");
        }
        smartAccount = ISmartAccount(_smartAccount);
    }

    // to be called through SmartAccount.executeCall
    // @note won't be needed if we will be marking userOps as module related
    function executeCallWithSmartAccount(
        address to,
        uint256 value,
        bytes calldata data
    ) external {
        if (msg.sender != address(smartAccount)) {
            revert("Only SmartAccount can call this function");
        }
        if (
            !smartAccount.execTransactionFromModule(
                to,
                value,
                data,
                Enum.Operation.Call
            )
        ) {
            revert("Failed to execute call with SmartAccount");
        }
    }

    // @note rebuild if execBatchTransactionFromModule will be implemented in ModuleManager
    function executeBatchWithSmartAccount(
        address[] calldata to,
        uint256[] calldata value,
        bytes[] calldata data
    ) public {
        if (msg.sender != address(smartAccount)) {
            revert("Only SmartAccount can call this function");
        }
        if (
            to.length == 0 ||
            to.length != value.length ||
            value.length != data.length
        ) revert("Wrong batch provided");
        for (uint256 i; i < to.length; ) {
            if (
                !smartAccount.execTransactionFromModule(
                    to[i],
                    value[i],
                    data[i],
                    Enum.Operation.Call
                )
            ) {
                revert("Failed to execute call with SmartAccount");
            }
            unchecked {
                ++i;
            }
        }
    }

    function validateSignature(
        UserOperation calldata userOp,
        bytes32 userOpHash
    ) external view virtual returns (uint256 sigValidationResult) {
        //temporary
        console.log("validating signature in the module");
        console.log("userOp Sig length ", userOp.signature.length);
        if (userOp.signature.length == 16) {
            return 0;
        }
        return SIG_VALIDATION_FAILED;
    }

    function isValidSignature(
        bytes32 _hash,
        bytes memory _signature
    ) public view virtual override returns (bytes4) {
        //temporary
        if (_signature.length == 16) {
            return EIP1271_MAGIC_VALUE;
        }
        return bytes4(0xffffffff);
    }
}
