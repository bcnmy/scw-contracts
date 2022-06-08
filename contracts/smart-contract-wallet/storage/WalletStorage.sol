// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

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
    //     "SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)"
    // );
    bytes32 internal constant SAFE_TX_TYPEHASH = 0xbb8310d486368db6bd6f849402fdd73ad53d316b5a4b2644ad6efe0f941286d8;

    // Owner storage
    address public owner;

    // @review
    // uint256 public nonce; //changed to 2D nonce
    mapping(uint256 => uint256) public nonces;

    // AA storage
    address public entryPoint;
}