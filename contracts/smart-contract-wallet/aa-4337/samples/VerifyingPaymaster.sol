// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

/* solhint-disable reason-string */
/* solhint-disable no-inline-assembly */

import "../core/BasePaymaster.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * A sample paymaster that uses external service to decide whether to pay for the UserOp.
 * The paymaster trusts an external signer to sign the transaction.
 * The calling user must pass the UserOp to that external signer first, which performs
 * whatever off-chain verification before signing the UserOp.
 * Note that this signature is NOT a replacement for wallet signature:
 * - the paymaster signs to agree to PAY for GAS.
 * - the wallet signs to prove identity and account ownership.
 */
contract VerifyingPaymaster is BasePaymaster {

    using ECDSA for bytes32;
    using UserOperationLib for UserOperation;

    address public immutable verifyingSigner;

    // paymaster nonce for account 
    mapping(address => uint256) private paymasterNonces;

    constructor(IEntryPoint _entryPoint, address _verifyingSigner) BasePaymaster(_entryPoint) {
        verifyingSigner = _verifyingSigner;
    }

    /**
     * return the hash we're going to sign off-chain (and validate on-chain)
     * this method is called by the off-chain service, to sign the request.
     * it is called on-chain from the validatePaymasterUserOp, to validate the signature.
     * note that this signature covers all fields of the UserOperation, except the "paymasterAndData",
     * which will carry the signature itself.
     */
    function getHash(UserOperation calldata userOp)
    public view returns (bytes32) {
        uint256 id;
        assembly {
            id := chainid()
        }
        //can't use userOp.hash(), since it contains also the paymasterAndData itself.
        address sender = userOp.getSender();
        return keccak256(abi.encode(
                sender,
                userOp.nonce,
                keccak256(userOp.initCode),
                keccak256(userOp.callData),
                userOp.callGasLimit,
                userOp.verificationGasLimit,
                userOp.preVerificationGas,
                userOp.maxFeePerGas,
                userOp.maxPriorityFeePerGas,
                id,
                address(this),
                paymasterNonces[sender]
            ));
    }

    function getSenderPaymasterNonce(UserOperation calldata userOp) public view returns (uint256) {
        address account = userOp.getSender();
        return paymasterNonces[account];
    }

    function getSenderPaymasterNonce(address account) public view returns (uint256) {
        return paymasterNonces[account];
    }

    /**
     * verify our external signer signed this request.
     * the "paymasterAndData" is expected to be the paymaster and a signature over the entire request params
     */
    function validatePaymasterUserOp(UserOperation calldata userOp, bytes32 /*userOpHash*/, uint256 requiredPreFund)
    external override returns (bytes memory context, uint256 sigTimeRange) {
        (requiredPreFund);

        bytes32 hash = getHash(userOp);
        bytes calldata paymasterAndData = userOp.paymasterAndData;
        uint256 sigLength = paymasterAndData.length - 20;
        //ECDSA library supports both 64 and 65-byte long signatures.
        // we only "require" it here so that the revert reason on invalid signature will be of "VerifyingPaymaster", and not "ECDSA"
        require(sigLength == 64 || sigLength == 65, "VerifyingPaymaster: invalid signature length in paymasterAndData");

        //don't revert on signature failure: return SIG_VALIDATION_FAILED
        if (verifyingSigner != hash.toEthSignedMessageHash().recover(paymasterAndData[20 :])) {
            return ("",1);
        }
         _updateNonce(userOp);
        //no need for other on-chain validation: entire UserOp should have been checked
        // by the external service prior to signing it.
        return ("", 0);
    }

    function _updateNonce(UserOperation calldata userOp) internal {
        paymasterNonces[userOp.getSender()]++;
    }

}
