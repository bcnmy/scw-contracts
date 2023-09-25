// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {UserOperation} from "@account-abstraction/contracts/interfaces/UserOperation.sol";

struct PaymasterData {
    address paymasterId;
    uint48 validUntil;
    uint48 validAfter;
    bytes signature;
    uint256 signatureLength;
}

struct PaymasterContext {
    address paymasterId;
    // could add maxFeePerGas and maxPriorityFeePerGas if needed
    // by making approprate changes in paymaster contract
}

/**
 * @title PaymasterHelpers - helper functions for paymasters
 */
library PaymasterHelpers {
    using ECDSA for bytes32;

    /**
     * @dev Encodes the paymaster context: paymasterId and gasPrice
     * @param data PaymasterData passed
     */
    function paymasterContext(
        PaymasterData memory data
    )
        internal
        pure
        returns (
            // Could add maxFeePerGas and maxPriorityFeePerGas if needed
            bytes memory context
        )
    {
        return abi.encode(data.paymasterId);
    }

    /**
     * @dev Decodes paymaster data assuming it follows PaymasterData
     */
    function decodePaymasterData(
        UserOperation calldata op
    ) internal pure returns (PaymasterData memory) {
        bytes calldata paymasterAndData = op.paymasterAndData;
        (
            address paymasterId,
            uint48 validUntil,
            uint48 validAfter,
            bytes memory signature
        ) = abi.decode(paymasterAndData[20:], (address, uint48, uint48, bytes));
        return
            PaymasterData(
                paymasterId,
                validUntil,
                validAfter,
                signature,
                signature.length
            );
    }

    /**
     * @dev Decodes paymaster context assuming it follows PaymasterContext
     */
    function decodePaymasterContext(
        bytes memory context
    ) internal pure returns (PaymasterContext memory) {
        address paymasterId = abi.decode(context, (address));
        return PaymasterContext(paymasterId);
    }
}
