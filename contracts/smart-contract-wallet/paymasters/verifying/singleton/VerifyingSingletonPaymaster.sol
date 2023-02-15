// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.12;

/* solhint-disable reason-string */
/* solhint-disable no-inline-assembly */
import "../../BasePaymaster.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
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
contract VerifyingSingletonPaymaster is BasePaymaster, ReentrancyGuard {

    using ECDSA for bytes32;
    using UserOperationLib for UserOperation;
    using PaymasterHelpers for UserOperation;
    using PaymasterHelpers for bytes;
    using PaymasterHelpers for PaymasterData;

    mapping(address => uint256) public paymasterIdBalances;

    address public verifyingSigner;

    // paymaster nonce for account 
    mapping(address => uint256) private paymasterNonces;

    event VerifyingSignerChanged(address indexed _oldSigner, address indexed _newSigner, address indexed _actor);
    event GasDeposited(address indexed _paymasterId, uint256 indexed _value);
    event GasWithdrawn(address indexed _paymasterId, address indexed _to, uint256 indexed _value);
    event GasBalanceDeducted(address indexed _paymasterId, uint256 indexed _charge);


    constructor(address _owner, IEntryPoint _entryPoint, address _verifyingSigner) BasePaymaster(_owner, _entryPoint) {
        require(address(_entryPoint) != address(0), "can not be 0 address");
        require(_verifyingSigner != address(0), "signer of paymaster can not be 0");
        verifyingSigner = _verifyingSigner;
    }

    function getBalance(address paymasterId) external view returns(uint256 balance) {
        balance = paymasterIdBalances[paymasterId];
    } 

    function deposit() public virtual override payable {
        revert("user DepositFor instead");
    }

    /**
     * add a deposit for this paymaster and given paymasterId (Dapp Depositor address), used for paying for transaction fees
     */
    function depositFor(address paymasterId) external payable nonReentrant {
        require(paymasterId != address(0), "Paymaster Id can not be zero");
        require(msg.value != 0, "Zero deposit!");
        paymasterIdBalances[paymasterId] += msg.value;
        entryPoint.depositTo{value : msg.value}(address(this));
        emit GasDeposited(paymasterId, msg.value);
    }

    function withdrawTo(address payable withdrawAddress, uint256 amount) public override nonReentrant {
        require(withdrawAddress != address(0), "withdraw to 0 address");
        uint256 currentBalance = paymasterIdBalances[msg.sender];
        require(amount <= currentBalance, "Insufficient amount to withdraw");
        paymasterIdBalances[msg.sender] -= amount;
        entryPoint.withdrawTo(withdrawAddress, amount);
        emit GasWithdrawn(msg.sender, withdrawAddress, amount);
    }
    
    /**
    this function will let owner change signer
    */
    function setSigner( address _newVerifyingSigner) external payable onlyOwner{
        require(_newVerifyingSigner != address(0), "can't be 0 address");
        address oldSigner = verifyingSigner;
        verifyingSigner = _newVerifyingSigner;
        emit VerifyingSignerChanged(oldSigner, _newVerifyingSigner, msg.sender);
    }

    /**
     * return the hash we're going to sign off-chain (and validate on-chain)
     * this method is called by the off-chain service, to sign the request.
     * it is called on-chain from the validatePaymasterUserOp, to validate the signature.
     * note that this signature covers all fields of the UserOperation, except the "paymasterAndData",
     * which will carry the signature itself.
     */
    function getHash(UserOperation calldata userOp, uint256 senderPaymasterNonce, address paymasterId)
    public view returns (bytes32) {
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
                block.chainid,
                address(this),
                paymasterId,
                senderPaymasterNonce
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
    function _validatePaymasterUserOp(UserOperation calldata userOp, bytes32 /*userOpHash*/, uint256 requiredPreFund)
    internal override returns (bytes memory context, uint256 sigTimeRange) {
        (requiredPreFund);
        PaymasterData memory paymasterData = userOp.decodePaymasterData();
        bytes32 hash = getHash(userOp, paymasterNonces[userOp.getSender()], paymasterData.paymasterId);
        uint256 sigLength = paymasterData.signatureLength;
        // we only "require" it here so that the revert reason on invalid signature will be of "VerifyingPaymaster", and not "ECDSA"
        require(sigLength == 65, "VerifyingPaymaster: invalid signature length in paymasterAndData");
        //don't revert on signature failure: return SIG_VALIDATION_FAILED
        if (verifyingSigner != hash.toEthSignedMessageHash().recover(paymasterData.signature)) {
            return ("",1);
        }
        _updateNonce(userOp);
        require(requiredPreFund <= paymasterIdBalances[paymasterData.paymasterId], "Insufficient balance for paymaster id");
        return (userOp.paymasterContext(paymasterData), 0);
    }

    function _updateNonce(UserOperation calldata userOp) internal {
        ++paymasterNonces[userOp.getSender()];
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
    PaymasterContext memory data = context.decodePaymasterContext();
    address extractedPaymasterId = data.paymasterId;
    paymasterIdBalances[extractedPaymasterId] -= actualGasCost;
    emit GasBalanceDeducted(extractedPaymasterId, actualGasCost);
  }

}