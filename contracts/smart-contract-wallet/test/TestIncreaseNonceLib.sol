// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.0;

import "../libs/SmartAccountStorage.sol";
import "../SmartAccount.sol";

/// @title TestIncreaseNonceLib - Test Lib to Increase Nonce
/// @notice used to test delegatecalls from Smart Account
contract TestIncreaseNonceLib is SmartAccountStorage {
    event NonceIncreasedFromLib(uint256 batchId, uint256 newNonce);

    function increaseNonce(uint256 batchId) external {
        emit NonceIncreasedFromLib(batchId, ++nonces[batchId]);
    }
}
