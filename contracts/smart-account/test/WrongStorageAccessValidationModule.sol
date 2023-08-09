// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {EcdsaOwnershipRegistryModule} from "../modules/EcdsaOwnershipRegistryModule.sol";
import {UserOperation} from "../modules/BaseAuthorizationModule.sol";

contract WrongStorageAccessValidationModule is EcdsaOwnershipRegistryModule {
    uint256 public constant MAX_VALIDATION_COUNT = 10;

    // not associated storage
    uint256 private _usageCounter = 0;

    function validateUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash
    ) external view virtual override returns (uint256) {
        require(
            _usageCounter < MAX_VALIDATION_COUNT,
            "Renew module subscription"
        );

        // Usual Stuff
        (bytes memory cleanEcdsaSignature, ) = abi.decode(
            userOp.signature,
            (bytes, address)
        );
        if (_verifySignature(userOpHash, cleanEcdsaSignature, userOp.sender)) {
            return VALIDATION_SUCCESS;
        }
        return SIG_VALIDATION_FAILED;
    }
}
