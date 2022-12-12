// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.12;

/* solhint-disable reason-string */
import "../../BasePaymaster.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "../../PaymasterHelpers.sol";


/**
 * A sample paymaster that uses external service to decide whether to pay for the UserOp.
 * The paymaster trusts an external signer to sign the transaction.
 * The calling user must pass the UserOp to that external signer first, which performs
 * whatever off-chain verification before signing the UserOp.
 * Note that this signature is NOT a replacement for wallet signature:
 * - the paymaster signs to agree to PAY for GAS.
 * - the wallet signs to prove identity and wallet ownership.
 */
contract VerifyingSingletonPaymaster is BasePaymaster {

    using ECDSA for bytes32;
    // possibly //  using Signatures for UserOperation;
    using UserOperationLib for UserOperation;
    using PaymasterHelpers for UserOperation;
    using PaymasterHelpers for bytes;
    using PaymasterHelpers for PaymasterData;

    mapping(address => uint256) public paymasterIdBalances;

    address public verifyingSigner;

    constructor(IEntryPoint _entryPoint, address _owner, address _verifyingSigner) {
        require(_owner != address(0), "VerifyingPaymaster: owner of paymaster can not be zero address");
        require(_verifyingSigner != address(0), "VerifyingPaymaster: signer of paymaster can not be zero address");
        verifyingSigner = _verifyingSigner;
        entryPoint = _entryPoint;
        owner = _owner;
    }

    /**
     * add a deposit for this paymaster and given paymasterId (Dapp Depositor address), used for paying for transaction fees
     */
    function deposit(address paymasterId) public payable {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            let size := extcodesize(paymasterId)
            if gt(size, 0) { revert(0, 0) }
        }
        require(paymasterId != address(0), "Paymaster Id can not be zero address");
        paymasterIdBalances[paymasterId] += msg.value;
        entryPoint.depositTo{value : msg.value}(address(this));
    }

    function withdrawTo(address payable withdrawAddress, uint256 amount) public {
        uint256 currentBalance = paymasterIdBalances[msg.sender];
        require(amount <= currentBalance, "Insufficient amount to withdraw");
        paymasterIdBalances[msg.sender] -= amount;
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

        PaymasterData memory paymasterData = userOp.decodePaymasterData();
        uint256 sigLength = paymasterData.signatureLength;

        //ECDSA library supports both 64 and 65-byte long signatures.
        // we only "require" it here so that the revert reason on invalid signature will be of "VerifyingPaymaster", and not "ECDSA"
        require(sigLength == 64 || sigLength == 65, "VerifyingPaymaster: invalid signature length in paymasterAndData");
        require(verifyingSigner == hash.toEthSignedMessageHash().recover(paymasterData.signature), "VerifyingPaymaster: wrong signature");
        require(requiredPreFund <= paymasterIdBalances[paymasterData.paymasterId], "Insufficient balance for paymaster id");
        return userOp.paymasterContext(paymasterData);
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
    PaymasterContext memory data = context.decodePaymasterContext();
    address extractedPaymasterId = data.paymasterId;
    paymasterIdBalances[extractedPaymasterId] -= actualGasCost;
  }

}