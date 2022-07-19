// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../common/Enum.sol";

contract WalletStorage {
    // Version
    string public constant VERSION = "0.0.1";

    // Domain Seperators
    // keccak256(
    //     "EIP712Domain(uint256 chainId,address verifyingContract)"
    // );
    bytes32 internal constant DOMAIN_SEPARATOR_TYPEHASH = 0x47e79534a245952e8b16893a336b85a3d9ea9fa8c573f3d803afb92a79469218;

    // @review for any modifications
    // keccak256(
    //     "WalletTx(address to,uint256 value,bytes data,uint8 operation,uint256 targetTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)"
    // );
    bytes32 internal constant WALLET_TX_TYPEHASH = 0xeedfef42e81fe8cd0e4185e4320e9f8d52fd97eb890b85fa9bd7ad97c9a18de2;

    // keccak256(
    //     "WalletTxV2(address to,uint256 value,bytes data,uint8 operation,uint256 targetTxGas,uint256 nonce)"
    // );
    bytes32 internal constant WALLET_TX_TYPEHASH_V2 = 0x4eb9ca0c7259005c57c1081da8627a4272a7e0eeac54affd279beb4c8fe983d5;

    // Owner storage
    address public owner;

    struct Transaction {
        address to;
        uint256 value;
        bytes data;
        Enum.Operation operation;
        uint256 targetTxGas;
        // uint256 batchId;
    }

    struct FeeRefund {
        uint256 baseGas;
        uint256 gasPrice; //gasPrice or tokenGasPrice
        address gasToken;
        address payable refundReceiver;
    }

    // @review
    // uint256 public nonce; //changed to 2D nonce
    mapping(uint256 => uint256) public nonces;

    // AA storage
    address public entryPoint;
}