// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./SmartWallet.sol";

contract SmartWalletNoAuth is SmartWallet {
    function checkSignatures(
        bytes32 dataHash,
        bytes memory data,
        bytes memory signatures
    ) public override view {
        uint8 v;
        bytes32 r;
        bytes32 s;
        uint256 i = 0;
        (v, r, s) = signatureSplit(signatures, i);
      //skipping sig verification
    }
}