// Sources flattened with hardhat v2.11.1 https://hardhat.org

// File contracts/smart-contract-wallet/utils/Decoder.sol

// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

contract Decoder {
    function decode(address to, bytes memory data) public returns (bytes memory) {
        (bool success, bytes memory result) = to.call(data);
            require(!success, "Shit happens");
                return result;
        }
 }
