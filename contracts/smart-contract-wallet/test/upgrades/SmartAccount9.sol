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
import "hardhat/console.sol";

contract SmartAccount9 is
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
    string public constant VERSION = "1.0.9"; // using AA 0.4.0

    // Domain Seperators
    // keccak256(
    //     "EIP712Domain(uint256 chainId,address verifyingContract)"
    // );
    bytes32 internal constant DOMAIN_SEPARATOR_TYPEHASH =
        0x47e79534a245952e8b16893a336b85a3d9ea9fa8c573f3d803afb92a79469218;

    // keccak256(
    //     "AccountTx(address to,uint256 value,bytes data,uint8 operation,uint256 targetTxGas,uint256 baseGas,uint256 gasPrice,uint256 tokenGasPriceFactor,address gasToken,address refundReceiver,uint256 nonce)"
    // );
    bytes32 internal constant ACCOUNT_TX_TYPEHASH =
        0xda033865d68bf4a40a5a7cb4159a99e33dba8569e65ea3e38222eb12d9e66eee;

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

    // mock constructor or use deinitializers
    // This constructor ensures that this contract can only be used as a master copy for Proxy accounts
    constructor(IEntryPoint anEntryPoint) {
        // By setting the owner it is not possible to call init anymore,
        // so we create an account with fixed non-zero owner.
        // This is an unusable account, perfect for the singleton
        owner = address(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE);
        require(address(anEntryPoint) != address(0), "Invalid Entrypoint");
        _entryPoint = anEntryPoint;
    }

    // Events
    event ImplementationUpdated(
        address indexed oldImplementation,
        address indexed newImplementation
    );
    event EntryPointChanged(address oldEntryPoint, address newEntryPoint);
    event EOAChanged(
        address indexed _scw,
        address indexed _oldEOA,
        address indexed _newEOA
    );
    event AccountHandlePayment(bytes32 txHash, uint256 payment);
    event SmartAccountReceivedNativeToken(
        address indexed sender,
        uint256 value
    );

    // modifiers
    // onlyOwner
    /**
     * @notice Throws if the sender is not an the owner.
     */
    modifier onlyOwner() {
        require(
            msg.sender == owner,
            "Smart Account:: Sender is not authorized"
        );
        _;
    }

    // onlyOwner OR self
    modifier mixedAuth() {
        require(
            msg.sender == owner || msg.sender == address(this),
            "Only owner or self"
        );
        _;
    }

    // @notice authorized modifier (onlySelf) is already inherited

    // Setters

    function setOwner(address _newOwner) public mixedAuth {
        require(
            _newOwner != address(0),
            "Smart Account:: new Signatory address cannot be zero"
        );
        address oldOwner = owner;
        owner = _newOwner;
        emit EOAChanged(address(this), oldOwner, _newOwner);
    }

    /**
     * @notice Updates the implementation of the base wallet
     * @param _implementation New wallet implementation
     */
    // all the new implementations MUST have this method!
    function updateImplementation(address _implementation) public mixedAuth {
        require(_implementation.isContract(), "INVALID_IMPLEMENTATION");
        address oldImplementation;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            oldImplementation := sload(address())
            sstore(address(), _implementation)
        }
        emit ImplementationUpdated(oldImplementation, _implementation);
    }

    // Getters

    function domainSeparator() public view returns (bytes32) {
        return
            keccak256(
                abi.encode(DOMAIN_SEPARATOR_TYPEHASH, getChainId(), this)
            );
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

    /**
     * @dev returns a value from the nonces 2d mapping
     * @param batchId : the key of the user's batch being queried
     * @return nonce : the number of transaction made within said batch
     */
    function getNonce(uint256 batchId) public view returns (uint256) {
        return nonces[batchId];
    }

    function entryPoint() public view virtual override returns (IEntryPoint) {
        return _entryPoint;
    }

    // init
    // Initialize / Setup
    // Used to setup
    function init(address _owner, address _handler) public override {
        require(owner == address(0), "Already initialized");
        require(_owner != address(0), "Invalid owner");
        require(_handler != address(0), "Invalid Fallback Handler");
        owner = _owner;
        _setFallbackHandler(_handler);
        _setupModules(address(0), bytes(""));
    }

    // Gnosis style transaction with optional repay in native tokens OR ERC20
    /// @dev Allows to execute a Safe transaction confirmed by required number of owners and then pays the account that submitted the transaction.
    /// Note: The fees are always transferred, even if the user transaction fails.
    /// @param _tx Wallet transaction
    /// @param refundInfo Required information for gas refunds
    /// @param signatures Packed signature data ({bytes32 r}{bytes32 s}{uint8 v})
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
            // Execute transaction.
            txHash = keccak256(txHashData);
            checkSignatures(txHash, signatures);
        }

        // We require some gas to emit the events (at least 2500) after the execution and some to perform code until the execution (500)
        // We also include the 1/64 in the check that is not send along with a call to counteract potential shortings because of EIP-150
        require(
            gasleft() >=
                Math.max((_tx.targetTxGas * 64) / 63, _tx.targetTxGas + 2500) +
                    500,
            "BSA010"
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
            require(
                success || _tx.targetTxGas != 0 || refundInfo.gasPrice != 0,
                "BSA013"
            );
            // We transfer the calculated tx costs to the tx.origin to avoid sending it to intermediate contracts that have made calls
            uint256 payment = 0;
            // uint256 extraGas;
            if (refundInfo.gasPrice > 0) {
                //console.log("sent %s", startGas - gasleft());
                // extraGas = gasleft();
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
            console.log("goes through 9");
            // extraGas = extraGas - gasleft();
            //console.log("extra gas %s ", extraGas);
        }
    }

    function execTransaction(
        Transaction memory _tx,
        FeeRefund memory refundInfo,
        bytes memory signatures
    ) external payable virtual override returns (bool) {
        return execTransaction_S6W(_tx, refundInfo, signatures);
    }

    function handlePayment(
        uint256 gasUsed,
        uint256 baseGas,
        uint256 gasPrice,
        uint256 tokenGasPriceFactor,
        address gasToken,
        address payable refundReceiver
    ) private returns (uint256 payment) {
        // uint256 startGas = gasleft();
        // solhint-disable-next-line avoid-tx-origin
        address payable receiver = refundReceiver == address(0)
            ? payable(tx.origin)
            : refundReceiver;
        if (gasToken == address(0)) {
            // For ETH we will only adjust the gas price to not be higher than the actual used gas price
            payment =
                (gasUsed + baseGas) *
                (gasPrice < tx.gasprice ? gasPrice : tx.gasprice);
            (bool success, ) = receiver.call{value: payment}("");
            require(success, "BSA011");
        } else {
            payment =
                ((gasUsed + baseGas) * (gasPrice)) /
                (tokenGasPriceFactor);
            require(transferToken(gasToken, receiver, payment), "BSA012");
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
        address payable receiver = refundReceiver == address(0)
            ? payable(tx.origin)
            : refundReceiver;
        if (gasToken == address(0)) {
            // For ETH we will only adjust the gas price to not be higher than the actual used gas price
            payment =
                (gasUsed + baseGas) *
                (gasPrice < tx.gasprice ? gasPrice : tx.gasprice);
            (bool success, ) = receiver.call{value: payment}("");
            require(success, "BSA011");
        } else {
            payment =
                ((gasUsed + baseGas) * (gasPrice)) /
                (tokenGasPriceFactor);
            require(transferToken(gasToken, receiver, payment), "BSA012");
        }
        uint256 requiredGas = startGas - gasleft();
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
        if (v == 0) {
            // If v is 0 then it is a contract signature
            // When handling contract signatures the address of the signer contract is encoded into r
            _signer = address(uint160(uint256(r)));

            // Check that signature data pointer (s) is not pointing inside the static part of the signatures bytes
            // This check is not completely accurate, since it is possible that more signatures than the threshold are send.
            // Here we only check that the pointer is not pointing inside the part that is being processed
            require(uint256(s) >= uint256(1) * 65, "BSA021");

            // Check that signature data pointer (s) is in bounds (points to the length of data -> 32 bytes)
            require(uint256(s) + 32 <= signatures.length, "BSA022");

            // Check if the contract signature is in bounds: start of data is s + 32 and end is start + signature length
            uint256 contractSignatureLen;
            // solhint-disable-next-line no-inline-assembly
            assembly {
                contractSignatureLen := mload(add(add(signatures, s), 0x20))
            }
            require(
                uint256(s) + 32 + contractSignatureLen <= signatures.length,
                "BSA023"
            );

            // Check signature
            bytes memory contractSignature;
            // solhint-disable-next-line no-inline-assembly
            assembly {
                // The signature data for contract signatures is appended to the concatenated signatures and the offset is stored in s
                contractSignature := add(add(signatures, s), 0x20)
            }
            require(
                ISignatureValidator(_signer).isValidSignature(
                    dataHash,
                    contractSignature
                ) == EIP1271_MAGIC_VALUE,
                "BSA024"
            );
        } else if (v > 30) {
            // If v > 30 then default va (27,28) has been adjusted for eth_sign flow
            // To support eth_sign and similar we adjust v and hash the messageHash with the Ethereum message prefix before applying ecrecover
            _signer = ecrecover(
                keccak256(
                    abi.encodePacked(
                        "\x19Ethereum Signed Message:\n32",
                        dataHash
                    )
                ),
                v - 4,
                r,
                s
            );
        } else {
            _signer = ecrecover(dataHash, v, r, s);
        }
        require(_signer == owner, "INVALID_SIGNATURE");
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
        require(execute(to, value, data, operation, gasleft()));
        uint256 requiredGas = startGas - gasleft();
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
        bytes32 safeTxHash = keccak256(
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
            abi.encodePacked(
                bytes1(0x19),
                bytes1(0x01),
                domainSeparator(),
                safeTxHash
            );
    }

    // Extra Utils
    function transfer(address payable dest, uint amount) external onlyOwner {
        require(dest != address(0), "this action will burn your funds");
        (bool success, ) = dest.call{value: amount}("");
        require(success, "transfer failed");
    }

    function pullTokens(
        address token,
        address dest,
        uint256 amount
    ) external onlyOwner {
        if (!transferToken(token, dest, amount))
            revert TokenTransferFailed(token, dest, amount);
    }

    function executeCall(
        address dest,
        uint256 value,
        bytes calldata func
    ) external {
        _requireFromEntryPointOrOwner();
        _call(dest, value, func);
    }

    function executeBatchCall(
        address[] calldata dest,
        uint256[] calldata value,
        bytes[] calldata func
    ) external {
        _requireFromEntryPointOrOwner();
        require(dest.length != 0, "empty array provided");
        require(dest.length == value.length, "wrong array lengths");
        require(value.length == func.length, "wrong array lengths");
        for (uint256 i = 0; i < dest.length; ) {
            _call(dest[i], value[i], func[i]);
            unchecked {
                ++i;
            }
        }
    }

    // AA implementation
    function _call(address target, uint256 value, bytes memory data) internal {
        (bool success, bytes memory result) = target.call{value: value}(data);
        if (!success) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
    }

    function _requireFromEntryPointOrOwner() internal view {
        require(
            msg.sender == address(entryPoint()) || msg.sender == owner,
            "account: not Owner or EntryPoint"
        );
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
    ) public onlyOwner {
        entryPoint().withdrawTo(withdrawAddress, amount);
    }

    /**
     * @notice Query if a contract implements an interface
     * @param interfaceId The interface identifier, as specified in ERC165
     * @return `true` if the contract implements `_interfaceID`
     */
    function supportsInterface(
        bytes4 interfaceId
    ) external view virtual override returns (bool) {
        return interfaceId == type(IERC165).interfaceId; // 0x01ffc9a7
    }

    // solhint-disable-next-line no-empty-blocks
    receive() external payable {
        emit SmartAccountReceivedNativeToken(msg.sender, msg.value);
    }
}
