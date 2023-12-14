// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/* deadline can be removed : GSN reference https://github.com/opengsn/gsn/blob/master/contracts/forwarder/IForwarder.sol (Saves 250 more gas)*/
/**
 * @title ForwardRequestTypes
 * @notice specifies structures required by Forwarders to verify structured signatures.
 * @notice This contract defines a struct which both ERC20Forwarder and BiconomyForwarder inherit. ERC20ForwardRequest includes all the fields present in the GSN V2 ForwardRequest struct,
 * but adds the following :
 * address token : address of the token to pay for gas fees. For gasless transactions token address will be 0 address
 * uint256 tokenGasPrice : gas price in the context of fee token
 * uint256 txGas : gas to be supplied for recipient method call
 * uint256 batchNonce : used for 2D nonces
 * uint256 deadline
 * @dev Fields are placed in type order, to minimise storage used when executing transactions.
 */
contract ForwardRequestTypesV2 {
    /*allow the EVM to optimize for this, 
ensure that you try to order your storage variables and struct members such that they can be packed tightly*/

    struct ForwardRequest {
        address from;
        address to;
        uint256 txGas;
        uint256 batchId;
        uint256 batchNonce;
        uint256 deadline;
        bytes data;
    }

    struct ERC20ForwardRequest {
        address from;
        address to;
        address token;
        uint256 txGas;
        uint256 tokenGasPrice;
        uint256 batchId;
        uint256 batchNonce;
        uint256 deadline;
        bytes data;
    }

    //@review
    //should be SandBox Forward Request?
    struct CustomForwardRequest {
        string warning; //optional
        string info;
        string action;
        ERC20ForwardRequest request;
    }

    //For DAI and EIP2612 type Permits
    struct PermitRequest {
        address holder;
        address spender;
        uint256 value;
        uint256 nonce;
        uint256 expiry;
        bool allowed;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }
}
