// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.12;

/* solhint-disable reason-string */

import "../BasePaymaster.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "../PaymasterHelpers.sol";
// import "../samples/Signatures.sol";


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
    // possibly //  using Signatures for UserOperation;
    using UserOperationLib for UserOperation;
    using PaymasterHelpers for UserOperation;
    using PaymasterHelpers for bytes;
    using PaymasterHelpers for PaymasterData;


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

        
        // finally sig
        // get signatureData and make SingatureValue a struct if we use individual signers for paymasterId
        // bytes memory signatureValue = op.decodePaymasterSignature();

       
        bytes calldata paymasterAndData = userOp.paymasterAndData;
        // current sig temp 
        bytes memory currentSig = paymasterAndData[20:];

        uint256 sigLength = paymasterAndData.length - 20;
        //ECDSA library supports both 64 and 65-byte long signatures.
        // we only "require" it here so that the revert reason on invalid signature will be of "VerifyingPaymaster", and not "ECDSA"
        require(sigLength == 64 || sigLength == 65, "VerifyingPaymaster: invalid signature length in paymasterAndData");
        require(verifyingSigner == hash.toEthSignedMessageHash().recover(currentSig), "VerifyingPaymaster: wrong signature");

        // post signature verification we pass on the context!
        // todo : uncomment
        // PaymasterData memory paymasterData = op.decodePaymasterData();

        // final
        // now we pass on above paymasterData so postOp can make use of it
        // return op.paymasterContext(paymasterData);

        // current
        return "";
    }

    /**
   * @dev Executes the paymaster's payment conditions
   * @param mode tells whether the op succeeded, reverted, or if the op succeeded but cause the postOp to revert
   * @param context payment conditions signed by the paymaster in `validatePaymasterUserOp`
   * @param actualGasCost amount to be paid to the entry point in wei
   */
  function _postOp(
    PostOpMode mode,
    bytes calldata context,
    uint256 actualGasCost
  ) internal virtual override {
    (mode);
    // (mode,context,actualGasCost); // unused params
    // PaymasterContext memory data = context.decodePaymasterContext();
    address extractedPaymasterId = address(0); // temp  // should come from data
    dappGasTankBalances[extractedPaymasterId] -= actualGasCost; // review
    // gasTankBalances accounting
  }

}
