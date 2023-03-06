// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

/* solhint-disable reason-string */

import "../interfaces/IAggregator.sol";
import "hardhat/console.sol";
import "./SimpleAccount.sol";

/**
 * test signature aggregator.
 * the aggregated signature is the SUM of the nonce fields..
 */
contract TestSignatureAggregator is IAggregator {

    function validateSignatures(UserOperation[] calldata userOps, bytes calldata signature) external pure override {
        uint256 sum = 0;
        for (uint256 i = 0; i < userOps.length; i++) {
            uint256 nonce = userOps[i].nonce;
            sum += nonce;
        }
        require(signature.length == 32, "TestSignatureValidator: sig must be uint256");
        (uint256 sig) = abi.decode(signature, (uint256));
        require(sig == sum, "TestSignatureValidator: aggregated signature mismatch (nonce sum)");
    }

    function validateUserOpSignature(UserOperation calldata)
    external pure returns (bytes memory) {
        return "";
    }

    /**
     * dummy test aggregator: sum all nonce values of UserOps.
     */
    function aggregateSignatures(UserOperation[] calldata userOps) external pure returns (bytes memory aggregatesSignature) {
        uint256 sum = 0;
        for (uint256 i = 0; i < userOps.length; i++) {
            sum += userOps[i].nonce;
        }
        return abi.encode(sum);
    }

    function addStake(IEntryPoint entryPoint, uint32 delay) external payable {
        entryPoint.addStake{value: msg.value}(delay);
    }
}
