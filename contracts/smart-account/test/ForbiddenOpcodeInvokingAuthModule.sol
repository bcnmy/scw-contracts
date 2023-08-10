// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {EcdsaOwnershipRegistryModule} from "../modules/EcdsaOwnershipRegistryModule.sol";
import {UserOperation} from "../modules/BaseAuthorizationModule.sol";

contract ForbiddenOpcodeInvokingAuthModule is EcdsaOwnershipRegistryModule {
    function validateUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash
    ) external view virtual override returns (uint256) {
        // Acesss the forbidden opcode
        require(block.timestamp > 0);

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
