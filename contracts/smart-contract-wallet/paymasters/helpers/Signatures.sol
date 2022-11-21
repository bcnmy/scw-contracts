// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.12;

import "../../aa-4337/interfaces/UserOperation.sol";
import "../PaymasterHelpers.sol";

/**
 * @dev Signatures helpers library
 */
library Signatures {
  using PaymasterHelpers for UserOperation;

   /**
   * @dev Decodes a paymaster's signature assuming the expected layout defined by the Signatures library
   */
  /* function decodePaymasterSignature(UserOperation calldata op) internal pure returns (bytes memory) {
    PaymasterData memory paymasterData = op.decodePaymasterData();
    return ""; // temp
  }*/ 

}
