// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../libs/LibAddress.sol";
import "../../BaseSmartAccount.sol";
import "../../base/ModuleManager.sol";
import "../../base/FallbackManager.sol";
import "../../common/SignatureDecoder.sol";
import "../../common/SecuredTokenTransfer.sol";
import {ReentrancyGuard} from "../../common/ReentrancyGuard.sol";
import {SmartAccountErrors} from "../../common/Errors.sol";
import "../../interfaces/ISignatureValidator.sol";
import "../../interfaces/IERC165.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract SmartAccount11 is
    BaseSmartAccount,
    ModuleManager,
    FallbackManager,
    SignatureDecoder,
    SecuredTokenTransfer,
    ReentrancyGuard,
    ISignatureValidatorConstants,
    IERC165,
    SmartAccountErrors
{
    using ECDSA for bytes32;
    using LibAddress for address;

    // Storage

    // Version
    string public constant VERSION = "1.0.0"; // using AA 0.4.0

    // Domain Seperators keccak256("EIP712Domain(uint256 chainId,address verifyingContract)");
    bytes32 internal constant DOMAIN_SEPARATOR_TYPEHASH =
        0x47e79534a245952e8b16893a336b85a3d9ea9fa8c573f3d803afb92a79469218;

    // keccak256(
    //     "AccountTx(address to,uint256 value,bytes data,uint8 operation,uint256 targetTxGas,uint256 baseGas,uint256 gasPrice,uint256 tokenGasPriceFactor,address gasToken,address refundReceiver,uint256 nonce)"
    // );
    bytes32 internal constant ACCOUNT_TX_TYPEHASH =
        0xda033865d68bf4a40a5a7cb4159a99e33dba8569e65ea3e38222eb12d9e66eee;

    // Owner storage
    address public owner;

    // changed to 2D nonce below
    // @notice there is no _nonce
    mapping(uint256 => uint256) public nonces;

    // Mapping to keep track of all message hashes that have been approved by the owner
    // by ALL REQUIRED owners in a multisig flow
    mapping(bytes32 => uint256) public signedMessages;

    // AA immutable storage
    IEntryPoint private immutable _entryPoint;

    uint256 private immutable _chainId;

    address private immutable _self;

    // This constructor ensures that this contract can only be used as a master copy for Proxy accounts
    constructor(IEntryPoint anEntryPoint) {
        _self = address(this);
        // By setting the owner it is not possible to call init anymore,
        // so we create an account with fixed non-zero owner.
        // This is an unusable account, perfect for the singleton
        owner = address(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE);
        if (address(anEntryPoint) == address(0))
            revert EntryPointCannotBeZero();
        _entryPoint = anEntryPoint;
        _chainId = block.chainid;
    }

    // Events
    event ImplementationUpdated(
        address indexed oldImplementation,
        address indexed newImplementation
    );

    event EOAChanged(
        address indexed _scw,
        address indexed _oldEOA,
        address indexed _newEOA
    );
    event AccountHandlePayment(bytes32 indexed txHash, uint256 indexed payment);
    event SmartAccountReceivedNativeToken(
        address indexed sender,
        uint256 indexed value
    );

    // modifiers
    // onlyOwner
    /**
     * @notice Throws if the sender is not the owner.
     */
    modifier onlyOwner() {
        if (msg.sender != owner) revert CallerIsNotOwner(msg.sender);
        _;
    }

    // onlyOwner OR self
    modifier mixedAuth() {
        if (msg.sender != owner && msg.sender != address(this))
            revert MixedAuthFail(msg.sender);
        _;
    }

    // @notice authorized modifier (onlySelf) is already inherited

    // Setters

    /**
     * @dev Allows to change the owner of the smart account by current owner or self-call (modules)
     * @param _newOwner Address of the new signatory
     */
    function setOwner(address _newOwner) public mixedAuth {
        if (_newOwner == address(0)) revert OwnerCannotBeZero();
        require(
            _newOwner != address(this),
            "Smart Account:: new Signatory address cannot be self"
        );
        require(
            _newOwner != owner,
            "new Signatory address cannot be same as old one"
        );
        address oldOwner = owner;
        assembly {
            sstore(owner.slot, _newOwner)
        }
        emit EOAChanged(address(this), oldOwner, _newOwner);
    }

    function getImplementation()
        external
        view
        returns (address _implementation)
    {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            _implementation := sload(address())
        }
    }

    /**
     * @notice Updates the implementation of the base wallet
     * @param _implementation New wallet implementation
     */
    // all the new implementations MUST have this method!
    function updateImplementation(address _implementation) public mixedAuth {
        require(_implementation != address(0), "Address cannot be zero");
        if (!_implementation.isContract())
            revert InvalidImplementation(_implementation);
        address oldImplementation;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            oldImplementation := sload(address())
            sstore(address(), _implementation)
        }
        emit ImplementationUpdated(oldImplementation, _implementation);
    }

    // either this and check for specific _data
    // specific methods like updateImplementationAndSetHandler
    // it could be generic reinit of proxy for states introduced in new implementation
    /*function updateImplementationAndCall(address _implementation, bytes memory _data) public mixedAuth {

    }*/

    // Getters
    /**
     * @dev Returns the domain separator for this contract, as defined in the EIP-712 standard.
     * @return bytes32 The domain separator hash.
     */
    function domainSeparator() public view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    DOMAIN_SEPARATOR_TYPEHASH,
                    block.chainid,
                    address(this)
                )
            );
    }

    /**
     * @notice Returns the ID of the chain the contract is currently deployed on.
     * @return _chainId The ID of the current chain as a uint256.
     */
    function getChainId() public view returns (uint256) {
        return _chainId;
    }

    /**
     * @dev returns a value from the nonces 2d mapping
     * @param batchId : the key of the user's batch being queried
     * @return nonce : the number of transactions made within said batch
     */
    function getNonce(uint256 batchId) public view returns (uint256) {
        return nonces[batchId];
    }

    /**
     * return the entryPoint used by this account.
     * subclass should return the current entryPoint used by this account.
     */
    function entryPoint() public view virtual override returns (IEntryPoint) {
        return _entryPoint;
    }

    /**
     * @dev Initialize the Smart Account with required states
     * @param _owner Signatory of the Smart Account
     * @param _handler Default fallback handler provided in Smart Account
     * @notice devs need to make sure it is only callble once by initiazer or state check restrictions
     * @notice any further implementations that introduces a new state must have a reinit method
     * @notice init is prevented here by setting owner in the constructor and checking here for address(0)
     */
    function init(address _owner, address _handler) external virtual override {
        if (owner != address(0)) revert AlreadyInitialized(address(this));
        if (_owner == address(0)) revert OwnerCannotBeZero();
        owner = _owner;
        _setFallbackHandler(_handler);
        _setupModules(address(0), bytes(""));
    }

    /**
     * @dev Gnosis style transaction with optional repay in native tokens OR ERC20
     * @dev Allows to execute a transaction confirmed by required signature/s and then pays the account that submitted the transaction.
     * @notice The fees are always transferred, even if the user transaction fails.
     * @param _tx Smart Account transaction
     * @param refundInfo Required information for gas refunds
     * @param signatures Packed signature/s data ({bytes32 r}{bytes32 s}{uint8 v})
     */
    function execTransaction_S6W(
        Transaction memory _tx,
        FeeRefund memory refundInfo,
        bytes memory signatures
    ) public payable virtual returns (bool success) {
        uint256 startGas = gasleft();
        bytes32 txHash;
        // Use scope here to limit variable lifetime and prevent `stack too deep` errors
        {
            bytes memory txHashData = encodeTransactionData(
                // Transaction info
                _tx,
                // Payment info
                refundInfo,
                // Signature info
                nonces[1]++
            );
            txHash = keccak256(txHashData);
            checkSignatures(txHash, signatures);
        }

        // We require some gas to emit the events (at least 2500) after the execution and some to perform code until the execution (500)
        // We also include the 1/64 in the check that is not send along with a call to counteract potential shortings because of EIP-150
        // Bitshift left 6 bits means multiplying by 64, just more gas efficient
        if (
            gasleft() <
            Math.max((_tx.targetTxGas << 6) / 63, _tx.targetTxGas + 2500) + 500
        )
            revert NotEnoughGasLeft(
                gasleft(),
                Math.max((_tx.targetTxGas << 6) / 63, _tx.targetTxGas + 2500) +
                    500
            );
        // Use scope here to limit variable lifetime and prevent `stack too deep` errors
        {
            // If the gasPrice is 0 we assume that nearly all available gas can be used (it is always more than targetTxGas)
            // We only substract 2500 (compared to the 3000 before) to ensure that the amount passed is still higher than targetTxGas
            success = execute(
                _tx.to,
                _tx.value,
                _tx.data,
                _tx.operation,
                refundInfo.gasPrice == 0 ? (gasleft() - 2500) : _tx.targetTxGas
            );
            // If no targetTxGas and no gasPrice was set (e.g. both are 0), then the internal tx is required to be successful
            // This makes it possible to use `estimateGas` without issues, as it searches for the minimum gas where the tx doesn't revert
            if (!success && _tx.targetTxGas == 0 && refundInfo.gasPrice == 0)
                revert CanNotEstimateGas(
                    _tx.targetTxGas,
                    refundInfo.gasPrice,
                    success
                );
            // We transfer the calculated tx costs to the tx.origin to avoid sending it to intermediate contracts that have made calls
            uint256 payment;
            if (refundInfo.gasPrice != 0) {
                payment = handlePayment(
                    startGas - gasleft(),
                    refundInfo.baseGas,
                    refundInfo.gasPrice,
                    refundInfo.tokenGasPriceFactor,
                    refundInfo.gasToken,
                    refundInfo.refundReceiver
                );
                emit AccountHandlePayment(txHash, payment);
            }
        }
    }

    function execTransaction(
        Transaction memory _tx,
        FeeRefund memory refundInfo,
        bytes memory signatures
    ) external payable virtual override returns (bool) {
        return execTransaction_S6W(_tx, refundInfo, signatures);
    }

    /**
     * @dev Handles the payment for a transaction refund from Smart Account to Relayer.
     * @param gasUsed Gas used by the transaction.
     * @param baseGas Gas costs that are independent of the transaction execution
     * (e.g. base transaction fee, signature check, payment of the refund, emitted events).
     * @param gasPrice Gas price / TokenGasPrice (gas price in the context of token using offchain price feeds)
     * that should be used for the payment calculation.
     * @param tokenGasPriceFactor factor by which calculated token gas price is already multiplied.
     * @param gasToken Token address (or 0 if ETH) that is used for the payment.
     * @return payment The amount of payment made in the specified token.
     */
    function handlePayment(
        uint256 gasUsed,
        uint256 baseGas,
        uint256 gasPrice,
        uint256 tokenGasPriceFactor,
        address gasToken,
        address payable refundReceiver
    ) private returns (uint256 payment) {
        require(tokenGasPriceFactor != 0, "invalid tokenGasPriceFactor");
        // solhint-disable-next-line avoid-tx-origin
        address payable receiver = refundReceiver == address(0)
            ? payable(tx.origin)
            : refundReceiver;
        if (gasToken == address(0)) {
            // For ETH we will only adjust the gas price to not be higher than the actual used gas price
            payment =
                (gasUsed + baseGas) *
                (gasPrice < tx.gasprice ? gasPrice : tx.gasprice);
            bool success;
            assembly {
                success := call(gas(), receiver, payment, 0, 0, 0, 0)
            }
            if (!success)
                revert TokenTransferFailed(address(0), receiver, payment);
        } else {
            payment =
                ((gasUsed + baseGas) * (gasPrice)) /
                (tokenGasPriceFactor);
            if (!transferToken(gasToken, receiver, payment))
                revert TokenTransferFailed(gasToken, receiver, payment);
        }
    }

    /**
     * @dev Allows to estimate a transaction.
     * @notice This method is only meant for estimation purpose, therefore the call will always revert and encode the result in the revert data.
     * @notice Call this method to get an estimate of the handlePayment costs that are deducted with `execTransaction`
     * @param gasUsed Gas used by the transaction.
     * @param baseGas Gas costs that are independent of the transaction execution
     * (e.g. base transaction fee, signature check, payment of the refund, emitted events).
     * @param gasPrice Gas price / TokenGasPrice (gas price in the context of token using offchain price feeds)
     * that should be used for the payment calculation.
     * @param tokenGasPriceFactor factor by which calculated token gas price is already multiplied.
     * @param gasToken Token address (or 0 if ETH) that is used for the payment.
     * @return requiredGas Estimate of refunds
     */
    function handlePaymentRevert(
        uint256 gasUsed,
        uint256 baseGas,
        uint256 gasPrice,
        uint256 tokenGasPriceFactor,
        address gasToken,
        address payable refundReceiver
    ) external returns (uint256 requiredGas) {
        require(tokenGasPriceFactor != 0, "invalid tokenGasPriceFactor");
        uint256 startGas = gasleft();
        // solhint-disable-next-line avoid-tx-origin
        address payable receiver = refundReceiver == address(0)
            ? payable(tx.origin)
            : refundReceiver;
        if (gasToken == address(0)) {
            // For ETH we will only adjust the gas price to not be higher than the actual used gas price
            uint256 payment = (gasUsed + baseGas) *
                (gasPrice < tx.gasprice ? gasPrice : tx.gasprice);
            bool success;
            assembly {
                success := call(gas(), receiver, payment, 0, 0, 0, 0)
            }
            if (!success)
                revert TokenTransferFailed(address(0), receiver, payment);
        } else {
            uint256 payment = ((gasUsed + baseGas) * (gasPrice)) /
                (tokenGasPriceFactor);
            if (!transferToken(gasToken, receiver, payment))
                revert TokenTransferFailed(gasToken, receiver, payment);
        }
        unchecked {
            requiredGas = startGas - gasleft();
        }
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
        require(signatures.length >= 65, "Invalid signatures length");
        uint8 v;
        bytes32 r;
        bytes32 s;
        address _signer;
        (v, r, s) = signatureSplit(signatures);
        if (v == 0) {
            // If v is 0 then it is a contract signature
            // When handling contract signatures the address of the signer contract is encoded into r
            _signer = address(uint160(uint256(r)));

            // Check that signature data pointer (s) is not pointing inside the static part of the signatures bytes
            // Here we check that the pointer is not pointing inside the part that is being processed
            if (uint256(s) < 65)
                revert WrongContractSignatureFormat(uint256(s), 0, 0);

            // Check if the contract signature is in bounds: start of data is s + 32 and end is start + signature length
            uint256 contractSignatureLen;
            // solhint-disable-next-line no-inline-assembly
            assembly {
                contractSignatureLen := mload(add(add(signatures, s), 0x20))
            }
            if (uint256(s) + 32 + contractSignatureLen > signatures.length)
                revert WrongContractSignatureFormat(
                    uint256(s),
                    contractSignatureLen,
                    signatures.length
                );

            // Check signature
            bytes memory contractSignature;
            // solhint-disable-next-line no-inline-assembly
            assembly {
                // The signature data for contract signatures is appended to the concatenated signatures and the offset is stored in s
                contractSignature := add(add(signatures, s), 0x20)
            }
            if (
                ISignatureValidator(_signer).isValidSignature(
                    dataHash,
                    contractSignature
                ) != EIP1271_MAGIC_VALUE
            ) revert WrongContractSignature(contractSignature);
        } else if (v > 30) {
            // If v > 30 then default va (27,28) has been adjusted for eth_sign flow
            // To support eth_sign and similar we adjust v and hash the messageHash with the Ethereum message prefix before applying ecrecover
            (_signer, ) = dataHash.toEthSignedMessageHash().tryRecover(
                v - 4,
                r,
                s
            );
        } else {
            (_signer, ) = dataHash.tryRecover(v, r, s);
        }
        if (_signer != owner) revert InvalidSignature(_signer, owner);
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
        if (!execute(to, value, data, operation, gasleft()))
            revert ExecutionFailed();
        // Convert response to string and return via error message
        unchecked {
            revert(string(abi.encodePacked(startGas - gasleft())));
        }
    }

    /**
     * @dev Returns hash to be signed by owner.
     * @param to Destination address.
     * @param value Ether value.
     * @param data Data payload.
     * @param operation Operation type.
     * @param targetTxGas Fas that should be used for the internal Smart Account transaction.
     * @param baseGas Additional Gas costs for data used to trigger the transaction.
     * @param gasPrice Maximum gas price/ token gas price that should be used for this transaction.
     * @param tokenGasPriceFactor factor by which calculated token gas price is already multiplied.
     * @param gasToken Token address (or 0 if ETH) that is used for the payment.
     * @param refundReceiver Address of receiver of gas payment (or 0 if tx.origin).
     * @param _nonce Transaction nonce.
     * @return Transaction hash.
     */
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
        bytes32 accountTxHash = keccak256(
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
        return
            bytes.concat(
                bytes1(0x19),
                bytes1(0x01),
                domainSeparator(),
                accountTxHash
            );
    }

    /**
     * @dev Utility method to be able to transfer native tokens out of Smart Account
     * @notice only owner/ signatory of Smart Account with enough gas to spend can call this method
     * @notice While enabling multisig module and renouncing ownership this will not work
     * @param dest Destination address
     * @param amount Amount of native tokens
     */
    function transfer(address payable dest, uint256 amount) external onlyOwner {
        if (dest == address(0)) revert TransferToZeroAddressAttempt();
        bool success;
        assembly {
            success := call(gas(), dest, amount, 0, 0, 0, 0)
        }
        if (!success) revert TokenTransferFailed(address(0), dest, amount);
    }

    /**
     * @dev Utility method to be able to transfer ERC20 tokens out of Smart Account
     * @notice only owner/ signatory of Smart Account with enough gas to spend can call this method
     * @notice While enabling multisig module and renouncing ownership this will not work
     * @param token Token address
     * @param dest Destination/ Receiver address
     * @param amount Amount of tokens
     */
    function pullTokens(
        address token,
        address dest,
        uint256 amount
    ) external onlyOwner {
        if (dest == address(0)) revert TransferToZeroAddressAttempt();
        if (!transferToken(token, dest, amount))
            revert TokenTransferFailed(token, dest, amount);
    }

    /**
     * execute a transaction (called directly from owner, or by entryPoint)
     */
    function executeCall(
        address dest,
        uint256 value,
        bytes calldata func
    ) external {
        _requireFromEntryPointOrOwner();
        _call(dest, value, func);
    }

    /**
     * execute a sequence of transactions
     */
    function executeBatchCall(
        address[] calldata dest,
        uint256[] calldata value,
        bytes[] calldata func
    ) external {
        _requireFromEntryPointOrOwner();
        if (
            dest.length == 0 ||
            dest.length != value.length ||
            value.length != func.length
        ) revert WrongBatchProvided(dest.length, value.length, func.length);
        uint256 arraysLength = dest.length;
        for (uint256 i; i < arraysLength; ) {
            _call(dest[i], value[i], func[i]);
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @dev internal method that fecilitates the extenral calls from SmartAccount
     * @dev similar to execute() of Executor.sol
     * @param target destination address contract/non-contract
     * @param value amount of native tokens
     * @param data function singature of destination
     */
    function _call(address target, uint256 value, bytes memory data) internal {
        assembly {
            let success := call(
                gas(),
                target,
                value,
                add(data, 0x20),
                mload(data),
                0,
                0
            )
            let ptr := mload(0x40)
            returndatacopy(ptr, 0, returndatasize())
            if iszero(success) {
                revert(ptr, returndatasize())
            }
        }
    }

    function _requireFromEntryPointOrOwner() internal view {
        if (msg.sender != address(entryPoint()) && msg.sender != owner)
            revert CallerIsNotEntryPointOrOwner(msg.sender);

        // Compatiblity options, should choose one
        //if(msg.sender != address(entryPoint()) && msg.sender != owner) revert ("account: not Owner or EntryPoint");
        //require(msg.sender == address(entryPoint()) || msg.sender == owner, "account: not Owner or EntryPoint");
    }

    /**
     * @dev implement template method of BaseAccount
     */
    function _validateSignature(
        UserOperation calldata userOp,
        bytes32 userOpHash
    ) internal virtual override returns (uint256 validationData) {
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
        entryPoint().depositTo{value: msg.value}(address(this));
    }

    /**
     * withdraw value from the account's deposit
     * @param withdrawAddress target to send to
     * @param amount to withdraw
     */
    function withdrawDepositTo(
        address payable withdrawAddress,
        uint256 amount
    ) public payable onlyOwner {
        entryPoint().withdrawTo(withdrawAddress, amount);
    }

    /**
     * @notice Query if a contract implements an interface
     * @param _interfaceId The interface identifier, as specified in ERC165
     * @return `true` if the contract implements `_interfaceID`
     */
    function supportsInterface(
        bytes4 _interfaceId
    ) external view virtual override returns (bool) {
        return _interfaceId == type(IERC165).interfaceId; // 0x01ffc9a7
    }

    receive() external payable {
        require(address(this) != _self, "only allowed via delegateCall");
        emit SmartAccountReceivedNativeToken(msg.sender, msg.value);
    }
}
