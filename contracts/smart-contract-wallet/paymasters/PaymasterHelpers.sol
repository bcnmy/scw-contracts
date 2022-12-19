// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.12;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@account-abstraction/contracts/interfaces/UserOperation.sol";

struct PaymasterData {
    address paymasterId;
    bytes signature;
    uint256 signatureLength;
}

struct PaymasterContext {
    address paymasterId;
    //@review
}

library PaymasterHelpers {
    using ECDSA for bytes32;

    /**
     * @dev Encodes the paymaster context: sender, token, rate, and fee
     */
    function paymasterContext(
        UserOperation calldata op,
        PaymasterData memory data
    ) internal pure returns (bytes memory context) {
        return abi.encode(data.paymasterId);
    }

    /**
     * @dev Decodes paymaster data assuming it follows PaymasterData
     */
    function decodePaymasterData(UserOperation calldata op) internal pure returns (PaymasterData memory) {
        bytes calldata paymasterAndData = op.paymasterAndData;
        (address paymasterId, bytes memory signature) = abi.decode(paymasterAndData[20:], (address, bytes));
        return PaymasterData(paymasterId, signature, signature.length);
    }

    /**
     * @dev Decodes paymaster context assuming it follows PaymasterContext
     */
    function decodePaymasterContext(bytes memory context) internal pure returns (PaymasterContext memory) {
        (address paymasterId) = abi.decode(context, (address));
        return PaymasterContext(paymasterId);
    }
}
