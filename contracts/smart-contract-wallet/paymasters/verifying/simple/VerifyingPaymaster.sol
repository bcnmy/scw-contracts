// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.12;

/* solhint-disable reason-string */

import "../../BasePaymaster.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";


/**
 * A sample paymaster that uses external service to decide whether to pay for the UserOp.
 * The paymaster trusts an external signer to sign the transaction.
 * The calling user must pass the UserOp to that external signer first, which performs
 * whatever off-chain verification before signing the UserOp.
 * Note that this signature is NOT a replacement for wallet signature:
 * - the paymaster signs to agree to PAY for GAS.
 * - the wallet signs to prove identity and wallet ownership.
 */
contract VerifyingPaymaster is BasePaymaster, Initializable {

    using ECDSA for bytes32;
    using UserOperationLib for UserOperation;

    address public verifyingSigner;

    /**
    This is the first function get fired when we this contract from factory contract
    */
    function init(IEntryPoint _entryPoint, address _owner, address _verifyingSigner) public initializer {
        require(owner == address(0), "Already initialized");
        require(_owner != address(0), "VerifyingPaymaster: owner of paymaster can not be zero address");
        require(_verifyingSigner != address(0), "VerifyingPaymaster: signer of paymaster can not be zero address");
        require(verifyingSigner == address(0), "Already initialized");
        require(address(entryPoint) == address(0), "Already initialized");
        verifyingSigner = _verifyingSigner;
        entryPoint = _entryPoint;
        owner = _owner;
    }

    /**
     * add a deposit for this paymaster, used for paying for transaction fees
     */
    function deposit() public payable {
        entryPoint.depositTo{value : msg.value}(address(this));
    }

    /**
     * withdraw value from the deposit
     * @param withdrawAddress target to send to
     * @param amount to withdraw
     */
    function withdrawTo(address payable withdrawAddress, uint256 amount) public onlyOwner {
        entryPoint.withdrawTo(withdrawAddress, amount);
    }
    
    /**
    this function will let owner change signer
    */
    function setSigner( address _newVerifyingSigner) external onlyOwner{
        require(_newVerifyingSigner != address(0), "VerifyingPaymaster: new signer can not be zero address");
        verifyingSigner = _newVerifyingSigner;
    }

    /**
     * return the hash we're going to sign off-chain (and validate on-chain)
     * this method is called by the off-chain service, to sign the request.
     * it is called on-chain from the validatePaymasterUserOp, to validate the signature.
     * note that this signature covers all fields of the UserOperation, except the "paymasterAndData",
     * which will carry the signature itself.
     */
    function getHash(UserOperation calldata userOp)
    public pure returns (bytes32) {
        //can't use userOp.hash(), since it contains also the paymasterAndData itself.
        return keccak256(abi.encode(
                userOp.getSender(),
                userOp.nonce,
                keccak256(userOp.initCode),
                keccak256(userOp.callData),
                userOp.callGasLimit,
                userOp.verificationGasLimit,
                userOp.preVerificationGas,
                userOp.maxFeePerGas,
                userOp.maxPriorityFeePerGas
            ));
    }

    /**
     * verify our external signer signed this request.
     * the "paymasterAndData" is expected to be the paymaster and a signature over the entire request params
     */
    function validatePaymasterUserOp(UserOperation calldata userOp, bytes32 /*requestId*/, uint256 requiredPreFund)
    external view override returns (bytes memory context) {
        (requiredPreFund);

        bytes32 hash = getHash(userOp);
        bytes calldata paymasterAndData = userOp.paymasterAndData;
        uint256 sigLength = paymasterAndData.length - 20;
        //ECDSA library supports both 64 and 65-byte long signatures.
        // we only "require" it here so that the revert reason on invalid signature will be of "VerifyingPaymaster", and not "ECDSA"
        require(sigLength == 64 || sigLength == 65, "VerifyingPaymaster: invalid signature length in paymasterAndData");
        require(verifyingSigner == hash.toEthSignedMessageHash().recover(paymasterAndData[20:]), "VerifyingPaymaster: wrong signature");

        //no need for other on-chain validation: entire UserOp should have been checked
        // by the external service prior to signing it.
        return "";
    }

}