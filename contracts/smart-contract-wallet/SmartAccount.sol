// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "./common/Singleton.sol";
import "./BaseSmartAccount.sol";
import "./base/ModuleManager.sol";
import "./base/FallbackManager.sol";
import "./common/SignatureDecoder.sol";
import "./common/SecuredTokenTransfer.sol";
import "./libs/LibAddress.sol";
import "./interfaces/ISignatureValidator.sol";
import "./interfaces/IERC165.sol";
import {SmartAccountErrors} from "./common/Errors.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

contract SmartAccount is 
     Singleton,
     BaseSmartAccount,
     ModuleManager,
     FallbackManager,
     SignatureDecoder,
     SecuredTokenTransfer,
     ISignatureValidatorConstants,
     IERC165,
     SmartAccountErrors,
     Initializable,
     ReentrancyGuardUpgradeable
    {
    using ECDSA for bytes32;
    using LibAddress for address;

    // Storage

    // Version
    string public constant VERSION = "1.0.4"; // using AA 0.4.0

    // Domain Seperators
    // keccak256(
    //     "EIP712Domain(uint256 chainId,address verifyingContract)"
    // );
    bytes32 internal constant DOMAIN_SEPARATOR_TYPEHASH = 0x47e79534a245952e8b16893a336b85a3d9ea9fa8c573f3d803afb92a79469218;

    // review? if rename wallet to account is must
    // keccak256(
    //     "AccountTx(address to,uint256 value,bytes data,uint8 operation,uint256 targetTxGas,uint256 baseGas,uint256 gasPrice,uint256 tokenGasPriceFactor,address gasToken,address refundReceiver,uint256 nonce)"
    // );
    bytes32 internal constant ACCOUNT_TX_TYPEHASH = 0xda033865d68bf4a40a5a7cb4159a99e33dba8569e65ea3e38222eb12d9e66eee;

    // Owner storage
    address public owner;

    // uint96 private _nonce; //changed to 2D nonce below
    // @notice there is no _nonce 
    mapping(uint256 => uint256) public nonces;

    // Mapping to keep track of all message hashes that have been approved by the owner
    // by ALL REQUIRED owners in a multisig flow
    mapping(bytes32 => uint256) public signedMessages;

    // AA immutable storage
    IEntryPoint private immutable _entryPoint;

    // review 
    // mock constructor or use deinitializers
    // This constructor ensures that this contract can only be used as a master copy for Proxy accounts
    constructor(IEntryPoint anEntryPoint) {
        // By setting the owner it is not possible to call init anymore,
        // so we create an account with fixed non-zero owner.
        // This is an unusable account, perfect for the singleton
        owner = address(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE);
        if (address(anEntryPoint) == address(0)) revert EntryPointCannotBeZero();
        _entryPoint = anEntryPoint;
        _disableInitializers();
    }

    
    // Events
    // EOA + Version tracking
    event ImplementationUpdated(address _scw, string version, address newImplementation);
    event EntryPointChanged(address oldEntryPoint, address newEntryPoint);
    event EOAChanged(address indexed _scw, address indexed _oldEOA, address indexed _newEOA);
    event WalletHandlePayment(bytes32 txHash, uint256 payment);
    event SmartAccountReceivedNativeToken(address indexed sender, uint256 value);

    // nice to have
    // event SmartAccountInitialized(IEntryPoint indexed entryPoint, address indexed owner);
    // todo
    // emit events like executedTransactionFromModule
    // emit events with whole information of execTransaction (ref Safe L2)

    // modifiers
    // onlyOwner
    /**
     * @notice Throws if the sender is not an the owner.
     */
    modifier onlyOwner {
        if (msg.sender != owner) revert CallerIsNotOwner(msg.sender);
        _;
    }

    // onlyOwner OR self
    modifier mixedAuth {
        if(msg.sender != owner && msg.sender != address(this)) revert MixedAuthFail(msg.sender);
        _;
   }

    // @notice authorized modifier (onlySelf) is already inherited

    // Setters

    function setOwner(address _newOwner) public mixedAuth {
        if(_newOwner == address(0)) revert OwnerCannotBeZero();
        address oldOwner = owner;
        owner = _newOwner;
        emit EOAChanged(address(this), oldOwner, _newOwner);
    }

    /**
     * @notice Updates the implementation of the base wallet
     * @param _implementation New wallet implementation
     */
    // todo: write test case for updating implementation
    // review for all methods to be invoked by smart account to self
    function updateImplementation(address _implementation) public {
        _requireFromEntryPointOrOwner();
        if(!_implementation.isContract()) revert InvalidImplementation(_implementation);
        _setImplementation(_implementation);
        // EOA + Version tracking
        emit ImplementationUpdated(address(this), VERSION, _implementation);
    }

    // Getters

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_SEPARATOR_TYPEHASH, block.chainid, this));
    }

    /// @dev Returns the chain id used by this contract.
    function getChainId() public view returns (uint256) {
        uint256 id;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            id := chainid()
        }
        return id;
    }

    //@review getNonce specific to EntryPoint requirements
    /**
     * @dev returns a value from the nonces 2d mapping
     * @param batchId : the key of the user's batch being queried
     * @return nonce : the number of transaction made within said batch
     */
    function getNonce(uint256 batchId)
    public view
    returns (uint256) {
        return nonces[batchId];
    }

    // Standard interface for 1d nonces. Use it for Account Abstraction flow.
    function nonce() public view virtual override returns (uint256) {
        return nonces[0];
    }

    // only from EntryPoint
    modifier onlyEntryPoint {
        if(msg.sender != address(entryPoint())) revert CallerIsNotAnEntryPoint(msg.sender);
        _; 
    }

    function entryPoint() public view virtual override returns (IEntryPoint) {
        return _entryPoint;
    }

    // init
    // Initialize / Setup
    // Used to setup
    function init(address _owner, address _handler) public override initializer { 
        if(owner != address(0)) revert AlreadyInitialized(address(this));
        if(_owner == address(0)) revert OwnerCannotBeZero();
        if(_handler == address(0)) revert HandlerCannotBeZero();
        owner = _owner;
        _setFallbackHandler(_handler);
        setupModules(address(0), bytes(""));
    }

    /**
     * @dev Returns the largest of two numbers.
     */
    function max(uint256 a, uint256 b) internal pure returns (uint256) {
        return a >= b ? a : b;
    }

    // review: batchId should be carefully designed or removed all together (including 2D nonces)
    // Gnosis style transaction with optional repay in native tokens OR ERC20 
    /// @dev Allows to execute a Safe transaction confirmed by required number of owners and then pays the account that submitted the transaction.
    /// Note: The fees are always transferred, even if the user transaction fails.
    /// @param _tx Wallet transaction 
    /// @param refundInfo Required information for gas refunds
    /// @param signatures Packed signature data ({bytes32 r}{bytes32 s}{uint8 v})
    function execTransaction(
        Transaction memory _tx,
        FeeRefund memory refundInfo,
        bytes memory signatures
    ) public payable virtual override returns (bool success) {

        uint256 startGas = gasleft();
        bytes32 txHash;
        // Use scope here to limit variable lifetime and prevent `stack too deep` errors
        {
            bytes memory txHashData =
                encodeTransactionData(
                    // Transaction info
                    _tx,
                    // Payment info
                    refundInfo,
                    // Signature info
                    nonces[1]++
                );
            // Execute transaction.
            txHash = keccak256(txHashData);

            checkSignatures(txHash, signatures);
        }


        // We require some gas to emit the events (at least 2500) after the execution and some to perform code until the execution (500)
        // We also include the 1/64 in the check that is not send along with a call to counteract potential shortings because of EIP-150
        // Bitshift left 6 bits means multiplying by 64, just more gas efficient
        if(gasleft() < max((_tx.targetTxGas << 6) / 63,_tx.targetTxGas + 2500) + 500) 
            revert NotEnoughGasLeft(gasleft(), max((_tx.targetTxGas << 6) / 63,_tx.targetTxGas + 2500) + 500);
        // Use scope here to limit variable lifetime and prevent `stack too deep` errors
        {
            // If the gasPrice is 0 we assume that nearly all available gas can be used (it is always more than targetTxGas)
            // We only substract 2500 (compared to the 3000 before) to ensure that the amount passed is still higher than targetTxGas
            success = execute(_tx.to, _tx.value, _tx.data, _tx.operation, refundInfo.gasPrice == 0 ? (gasleft() - 2500) : _tx.targetTxGas);
            // If no targetTxGas and no gasPrice was set (e.g. both are 0), then the internal tx is required to be successful
            // This makes it possible to use `estimateGas` without issues, as it searches for the minimum gas where the tx doesn't revert
            if(!success && _tx.targetTxGas == 0 && refundInfo.gasPrice == 0) revert CanNotEstimateGas(_tx.targetTxGas, refundInfo.gasPrice, success);
            // We transfer the calculated tx costs to the tx.origin to avoid sending it to intermediate contracts that have made calls
            uint256 payment = 0;
            // uint256 extraGas;

            if (refundInfo.gasPrice != 0) {
                //console.log("sent %s", startGas - gasleft());
                // extraGas = gasleft();
                payment = handlePayment(startGas - gasleft(), refundInfo.baseGas, refundInfo.gasPrice, refundInfo.tokenGasPriceFactor, refundInfo.gasToken, refundInfo.refundReceiver);
                emit WalletHandlePayment(txHash, payment);
            }
            // extraGas = extraGas - gasleft();
            //console.log("extra gas %s ", extraGas);
        }
    }

    function handlePayment(
        uint256 gasUsed,
        uint256 baseGas,
        uint256 gasPrice,
        uint256 tokenGasPriceFactor,
        address gasToken,
        address payable refundReceiver
    ) private nonReentrant returns (uint256 payment) {
        // uint256 startGas = gasleft();
        // solhint-disable-next-line avoid-tx-origin
        address payable receiver = refundReceiver == address(0) ? payable(tx.origin) : refundReceiver;
        if (gasToken == address(0)) {
            // For ETH we will only adjust the gas price to not be higher than the actual used gas price
            payment = (gasUsed + baseGas) * (gasPrice < tx.gasprice ? gasPrice : tx.gasprice);
            bool success;                                 
            assembly {                                    
                success := call(gas(), receiver, payment, 0, 0, 0, 0)
            }
            if(!success) revert TokenTransferFailed(address(0), receiver, payment);
        } else {
            payment = (gasUsed + baseGas) * (gasPrice) / (tokenGasPriceFactor);
            if(!transferToken(gasToken, receiver, payment)) revert TokenTransferFailed(gasToken, receiver, payment);
        }
        // uint256 requiredGas = startGas - gasleft();
        //console.log("hp %s", requiredGas);
    }

    function handlePaymentRevert(
        uint256 gasUsed,
        uint256 baseGas,
        uint256 gasPrice,
        uint256 tokenGasPriceFactor,
        address gasToken,
        address payable refundReceiver
    ) external returns (uint256 payment) {
        uint256 startGas = gasleft();
        // solhint-disable-next-line avoid-tx-origin
        address payable receiver = refundReceiver == address(0) ? payable(tx.origin) : refundReceiver;
        if (gasToken == address(0)) {
            // For ETH we will only adjust the gas price to not be higher than the actual used gas price
            payment = (gasUsed + baseGas) * (gasPrice < tx.gasprice ? gasPrice : tx.gasprice);
            bool success;                                 
            assembly {                                    
                success := call(gas(), receiver, payment, 0, 0, 0, 0)
            }
            if(!success) revert TokenTransferFailed(address(0), receiver, payment);
        } else {
            payment = (gasUsed + baseGas) * (gasPrice) / (tokenGasPriceFactor);
            if(!transferToken(gasToken, receiver, payment)) revert TokenTransferFailed(gasToken, receiver, payment);
        }
        uint256 requiredGas;
        unchecked { 
            requiredGas = startGas - gasleft();
        }
        //console.log("hpr %s", requiredGas);
        // Convert response to string and return via error message
        revert(string(abi.encodePacked(requiredGas)));
    }

    /**
     * @dev Checks whether the signature provided is valid for the provided data, hash. Will revert otherwise.
     * @param dataHash Hash of the data (could be either a message hash or transaction hash)
     * @param signatures Signature data that should be verified. Can be ECDSA signature, contract signature (EIP-1271) or approved hash.
     */
    function checkSignatures(
        bytes32 dataHash,
        bytes memory signatures
    ) public view virtual {
        uint8 v;
        bytes32 r;
        bytes32 s;
        address _signer;
        (v, r, s) = signatureSplit(signatures);
        //todo add the test case for contract signature
        if(v == 0) {
            // If v is 0 then it is a contract signature
            // When handling contract signatures the address of the signer contract is encoded into r
            _signer = address(uint160(uint256(r)));

            // Check that signature data pointer (s) is not pointing inside the static part of the signatures bytes
                // Here we check that the pointer is not pointing inside the part that is being processed
                if(uint256(s) < 65) revert WrongContractSignatureFormat(uint256(s), 0, 0);

                // Check if the contract signature is in bounds: start of data is s + 32 and end is start + signature length
                uint256 contractSignatureLen;
                // solhint-disable-next-line no-inline-assembly
                assembly {
                    contractSignatureLen := mload(add(add(signatures, s), 0x20))
                }
                if (uint256(s) + 32 + contractSignatureLen > signatures.length) 
                    revert WrongContractSignatureFormat(uint256(s), contractSignatureLen, signatures.length);

                // Check signature
                bytes memory contractSignature;
                // solhint-disable-next-line no-inline-assembly
                assembly {
                    // The signature data for contract signatures is appended to the concatenated signatures and the offset is stored in s
                    contractSignature := add(add(signatures, s), 0x20)
                }
                if(ISignatureValidator(_signer).isValidSignature(dataHash, contractSignature) != EIP1271_MAGIC_VALUE) revert WrongContractSignature(contractSignature);
        }
        else if(v > 30) {
            // If v > 30 then default va (27,28) has been adjusted for eth_sign flow
            // To support eth_sign and similar we adjust v and hash the messageHash with the Ethereum message prefix before applying ecrecover
            _signer = ecrecover(keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", dataHash)), v - 4, r, s);
        } else {
            _signer = ecrecover(dataHash, v, r, s);
        }
        if(_signer != owner) revert InvalidSignature(_signer, owner);
    }

    /// @dev Allows to estimate a transaction.
    ///      This method is only meant for estimation purpose, therefore the call will always revert and encode the result in the revert data.
    ///      Since the `estimateGas` function includes refunds, call this method to get an estimated of the costs that are deducted from the safe with `execTransaction`
    /// @param to Destination address of Safe transaction.
    /// @param value Ether value of transaction.
    /// @param data Data payload of transaction.
    /// @param operation Operation type of transaction.
    /// @return Estimate without refunds and overhead fees (base transaction and payload data gas costs).
    function requiredTxGas(
        address to,
        uint256 value,
        bytes calldata data,
        Enum.Operation operation
    ) external returns (uint256) {
        uint256 startGas = gasleft();
        // We don't provide an error message here, as we use it to return the estimate
        if(!execute(to, value, data, operation, gasleft())) revert ExecutionFailed();
        uint256 requiredGas;
        unchecked { 
            requiredGas = startGas - gasleft();
        }
        // Convert response to string and return via error message
        revert(string(abi.encodePacked(requiredGas)));
    }

    /// @dev Returns hash to be signed by owner.
    /// @param to Destination address.
    /// @param value Ether value.
    /// @param data Data payload.
    /// @param operation Operation type.
    /// @param targetTxGas Fas that should be used for the safe transaction.
    /// @param baseGas Gas costs for data used to trigger the safe transaction.
    /// @param gasPrice Maximum gas price that should be used for this transaction.
    /// @param gasToken Token address (or 0 if ETH) that is used for the payment.
    /// @param refundReceiver Address of receiver of gas payment (or 0 if tx.origin).
    /// @param _nonce Transaction nonce.
    /// @return Transaction hash.
    function getTransactionHash(
        address to,
        uint256 value,
        bytes calldata data,
        Enum.Operation operation,
        uint256 targetTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        uint256 tokenGasPriceFactor,
        address gasToken,
        address payable refundReceiver,
        uint256 _nonce
    ) public view returns (bytes32) {
        Transaction memory _tx = Transaction({
            to: to,
            value: value,
            data: data,
            operation: operation,
            targetTxGas: targetTxGas
        });
        FeeRefund memory refundInfo = FeeRefund({
            baseGas: baseGas,
            gasPrice: gasPrice,
            tokenGasPriceFactor: tokenGasPriceFactor,
            gasToken: gasToken,
            refundReceiver: refundReceiver
        });
        return keccak256(encodeTransactionData(_tx, refundInfo, _nonce));
    }

    /// @dev Returns the bytes that are hashed to be signed by owner.
    /// @param _tx Wallet transaction 
    /// @param refundInfo Required information for gas refunds
    /// @param _nonce Transaction nonce.
    /// @return Transaction hash bytes.
    function encodeTransactionData(
        Transaction memory _tx,
        FeeRefund memory refundInfo,
        uint256 _nonce
    ) public view returns (bytes memory) {
        bytes32 safeTxHash =
            keccak256(
                abi.encode(
                    ACCOUNT_TX_TYPEHASH,
                    _tx.to,
                    _tx.value,
                    keccak256(_tx.data),
                    _tx.operation,
                    _tx.targetTxGas,
                    refundInfo.baseGas,
                    refundInfo.gasPrice,
                    refundInfo.tokenGasPriceFactor,
                    refundInfo.gasToken,
                    refundInfo.refundReceiver,
                    _nonce
                )
            );
        return abi.encodePacked(bytes1(0x19), bytes1(0x01), domainSeparator(), safeTxHash);
    }

    // Extra Utils 
    function transfer(address payable dest, uint amount) external payable nonReentrant onlyOwner {
        if(dest == address(0)) revert TransferToZeroAddressAttempt();
        bool success;
        assembly {
            success := call(gas(), dest, amount, 0, 0, 0, 0)
        }
        if (!success) revert TokenTransferFailed(address(0), dest, amount);
    }

    function pullTokens(address token, address dest, uint256 amount) external payable onlyOwner {
        if (!transferToken(token, dest, amount)) revert TokenTransferFailed(token, dest, amount);
    }

    function executeCall(
        address dest,
        uint256 value,
        bytes calldata func
    ) external nonReentrant {
        _requireFromEntryPointOrOwner();
        _call(dest, value, func);
    }

    function executeBatchCall(
        address[] calldata dest,
        uint256[] calldata value,
        bytes[] calldata func
    ) external nonReentrant {
        _requireFromEntryPointOrOwner();
        if(dest.length == 0 || dest.length != value.length || value.length != func.length) 
            revert WrongBatchProvided (dest.length, value.length, func.length);
        for (uint256 i; i < dest.length; ) {
            _call(dest[i], value[i], func[i]);
            unchecked {
                ++i;
            }
        }
    }

    // AA implementation
    function _call(address target, uint256 value, bytes memory data) internal {
        assembly {
            let success := call(gas(), target, value, add(data, 0x20), mload(data), 0, 0)
            let ptr := mload(0x40)
            returndatacopy(ptr, 0, returndatasize())
            if iszero(success) {
                revert(ptr, returndatasize())
            }
        }
    }

    //called by entryPoint, only after validateUserOp succeeded.
    //@review
    //Method is updated to instruct delegate call and emit regular events
    function execFromEntryPoint(address dest, uint value, bytes calldata func, Enum.Operation operation, uint256 gasLimit) external onlyEntryPoint returns (bool success) {        
        success = execute(dest, value, func, operation, gasLimit);
        if(!success) revert ExecutionFailed();
    }

    function _requireFromEntryPointOrOwner() internal view {
        if(msg.sender != address(entryPoint()) && msg.sender != owner) revert CallerIsNotEntryPointOrOwner(msg.sender);
    }

    /// implement template method of BaseAccount
    // @notice Nonce space is locked to 0 for AA transactions
    // userOp could have batchId as well
    function _validateAndUpdateNonce(UserOperation calldata userOp) internal override {
        if(nonces[0]++ != userOp.nonce) revert InvalidUserOpNonceProvided(userOp.nonce, nonces[0]);
    }

    /// implement template method of BaseAccount
    function _validateSignature(UserOperation calldata userOp, bytes32 userOpHash, address)
    internal override virtual returns (uint256 sigTimeRange) {
        bytes32 hash = userOpHash.toEthSignedMessageHash();
        if (owner != hash.recover(userOp.signature))
            return SIG_VALIDATION_FAILED;
        return 0;
    }

    /**
     * check current account deposit in the entryPoint
     */
    function getDeposit() public view returns (uint256) {
        return entryPoint().balanceOf(address(this));
    }

    /**
     * deposit more funds for this account in the entryPoint
     */
    function addDeposit() public payable {
        (bool success,) = address(entryPoint()).call{value : msg.value}("");
        if(!success) revert TokenTransferFailed(address(0), address(entryPoint()), msg.value);
    }

    /**
     * withdraw value from the account's deposit
     * @param withdrawAddress target to send to
     * @param amount to withdraw
     */
    function withdrawDepositTo(address payable withdrawAddress, uint256 amount) public payable onlyOwner {
        entryPoint().withdrawTo(withdrawAddress, amount);
    }

    /**
     * @notice Query if a contract implements an interface
     * @param interfaceId The interface identifier, as specified in ERC165
     * @return `true` if the contract implements `_interfaceID`
    */
    function supportsInterface(bytes4 interfaceId) external view virtual override returns (bool) {
        return interfaceId == type(IERC165).interfaceId; // 0x01ffc9a7
    }

    // solhint-disable-next-line no-empty-blocks
    receive() external payable {
        emit SmartAccountReceivedNativeToken(msg.sender, msg.value);
    }
}