// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {BaseSmartAccount, IEntryPoint, Transaction, FeeRefund, Enum, UserOperation} from "../BaseSmartAccount.sol";
import {ModuleManager} from "../base/ModuleManager.sol";
import {FallbackManager} from "../base/FallbackManager.sol";
import {SignatureDecoder} from "../common/SignatureDecoder.sol";
import {SecuredTokenTransfer} from "../common/SecuredTokenTransfer.sol";
import {LibAddress} from "../libs/LibAddress.sol";
import {ISignatureValidator} from "../interfaces/ISignatureValidator.sol";
import {Math} from "../libs/Math.sol";
import {IERC165} from "../interfaces/IERC165.sol";
import {ReentrancyGuard} from "../common/ReentrancyGuard.sol";
import {SmartAccountErrors} from "../common/Errors.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IAuthorizationModule} from "../interfaces/IModule.sol";

/**
 * @title SmartAccount - EIP-4337 compatible smart contract wallet.
 * @dev This contract is the base for the Smart Account functionality.
 *         - It provides the functionality to execute both gnosis-style txns and AA (EIP-4337) userOps
 *         - It allows to receive and manage assets.
 *         - It is responsible for managing the modules and fallbacks.
 *         - The Smart Account can be extended with modules, such as Social Recovery, Session Key and others.
 * @author Chirag Titiya - <chirag@biconomy.io>
 */
contract SmartAccountNoAuth is
    BaseSmartAccount,
    ModuleManager,
    FallbackManager,
    SignatureDecoder,
    SecuredTokenTransfer,
    IERC165,
    ReentrancyGuard,
    SmartAccountErrors,
    ISignatureValidator
{
    using ECDSA for bytes32;
    using LibAddress for address;

    // Storage Version
    string public constant VERSION = "1.0.0";

    // Domain Seperators keccak256("EIP712Domain(uint256 chainId,address verifyingContract)");
    bytes32 internal constant DOMAIN_SEPARATOR_TYPEHASH =
        0x47e79534a245952e8b16893a336b85a3d9ea9fa8c573f3d803afb92a79469218;

    // keccak256(
    //     "AccountTx(address to,uint256 value,bytes data,uint8 operation,uint256 targetTxGas,uint256 baseGas,uint256 gasPrice,uint256 tokenGasPriceFactor,address gasToken,address refundReceiver,uint256 nonce)"
    // );
    bytes32 internal constant ACCOUNT_TX_TYPEHASH =
        0xda033865d68bf4a40a5a7cb4159a99e33dba8569e65ea3e38222eb12d9e66eee;

    // Owner storage. Deprecated. Left for storage layout compatibility
    address public owner_deprecated;

    // changed to 2D nonce below
    // @notice there is no _nonce
    mapping(uint256 => uint256) public nonces;

    // AA immutable storage
    IEntryPoint private immutable _entryPoint;
    uint256 private immutable _chainId;
    address private immutable _self;

    // Events

    event ImplementationUpdated(
        address indexed oldImplementation,
        address indexed newImplementation
    );
    event AccountHandlePayment(bytes32 indexed txHash, uint256 indexed payment);
    event SmartAccountReceivedNativeToken(
        address indexed sender,
        uint256 indexed value
    );

    /**
     * @dev Constructor that sets the owner of the contract and the entry point contract.
     *      modules[SENTINEL_MODULES] = SENTINEL_MODULES protects implementation from initialization
     * @param anEntryPoint The address of the entry point contract.
     */
    constructor(IEntryPoint anEntryPoint) {
        modules[SENTINEL_MODULES] = SENTINEL_MODULES;
        _self = address(this);
        if (address(anEntryPoint) == address(0))
            revert EntryPointCannotBeZero();
        _entryPoint = anEntryPoint;
        _chainId = block.chainid;
    }

    /**
     * @dev This function allows the owner or entry point to execute certain actions.
     * If the caller is not authorized, the function will revert with an error message.
     * @notice This modifier is marked as internal and can only be called within the contract itself.
     */
    function _requireFromEntryPointOrSelf() internal view {
        if (msg.sender != address(entryPoint()) && msg.sender != address(this))
            revert CallerIsNotEntryPointOrSelf(msg.sender);
    }

    /**
     * @dev This function allows the owner or entry point to execute certain actions.
     * If the caller is not authorized, the function will revert with an error message.
     * @notice This modifier is marked as internal and can only be called within the contract itself.
     */
    function _requireFromEntryPoint() internal view {
        if (msg.sender != address(entryPoint()))
            revert CallerIsNotEntryPoint(msg.sender);
    }

    /**
     * @notice All the new implementations MUST have this method!
     * @notice Updates the implementation of the base wallet
     * @param _implementation New wallet implementation
     */
    function updateImplementation(address _implementation) public virtual {
        _requireFromEntryPointOrSelf();
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

    /// Getters
    /**
     * @dev Returns the address of the implementation contract associated with this contract.
     * @notice The implementation address is stored in the contract's storage slot with index 0.
     */
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
    function getNonce(uint256 batchId) public view virtual returns (uint256) {
        return nonces[batchId];
    }

    /**
     * @dev Returns the current entry point used by this account.
     * @return EntryPoint as an `IEntryPoint` interface.
     * @dev This function should be implemented by the subclass to return the current entry point used by this account.
     */
    function entryPoint() public view virtual override returns (IEntryPoint) {
        return _entryPoint;
    }

    /**
     * @dev Initialize the Smart Account with required states
     * @param handler Default fallback handler provided in Smart Account
     * @param moduleSetupContract Contract, that setups initial auth module for this smart account. It can be a module factory or
     *                            a registry module that serves several smart accounts
     * @param moduleSetupData modules setup data (a standard calldata for the module setup contract)
     * @notice devs need to make sure it is only callble once by initiazer or state check restrictions
     * @notice any further implementations that introduces a new state must have a reinit method
     * @notice reinit is not possible, as _initialSetupModules reverts if the account is already initialized
     *         which is when there is at least one enabled module
     */
    function init(
        address handler,
        address moduleSetupContract,
        bytes calldata moduleSetupData
    ) external virtual override returns (address) {
        _setFallbackHandler(handler);
        return _initialSetupModules(moduleSetupContract, moduleSetupData);
    }

    /**
     * @dev Gnosis style transaction with optional repay in native tokens OR ERC20
     * @dev Allows to execute a transaction confirmed by required signature/s and then pays the account that submitted the transaction.
     * @dev Function name optimized to have hash started with zeros to make this function calls cheaper
     * @notice The fees are always transferred, even if the user transaction fails.
     * @param _tx Smart Account transaction
     * @param refundInfo Required information for gas refunds
     * @param signatures Packed signature/s data ({bytes32 r}{bytes32 s}{uint8 v})
     */
    function execTransaction_S6W(
        Transaction memory _tx,
        FeeRefund memory refundInfo,
        bytes memory signatures
    ) public payable virtual nonReentrant returns (bool success) {
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
            if (isValidSignature(txHash, signatures) != EIP1271_MAGIC_VALUE) {
                // Do not revert even if the signature is invalid (not magic value returned)
                // For estimation purposes
                // revert InvalidSignature();
            }
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

    /**
     * @dev Interface function with the standard name for execTransaction_S6W
     */
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
        if (tokenGasPriceFactor == 0) revert TokenGasPriceFactorCanNotBeZero();
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
     * @dev Allows to estimate a transaction.
     *      This method is only meant for estimation purpose, therefore the call will always revert and encode the result in the revert data.
     *      Since the `estimateGas` function includes refunds, call this method to get an estimated of the costs that are deducted from the wallet with `execTransaction`
     * @param to Destination address of the transaction.
     * @param value Ether value of transaction.
     * @param data Data payload of transaction.
     * @param operation Operation type of transaction.
     * @return Estimate without refunds and overhead fees (base transaction and payload data gas costs).
     */
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

    /**
     * @dev Returns the bytes that are hashed to be signed by owner.
     * @param _tx The wallet transaction to be signed.
     * @param refundInfo Required information for gas refunds.
     * @param _nonce Transaction nonce.
     * @return transactionHash bytes that are hashed to be signed by the owner.
     */
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
     * @dev Execute a transaction (called directly from owner, or by entryPoint)
     * @notice Name is optimized for this method to be cheaper to be called
     * @param dest Address of the contract to call
     * @param value Amount of native tokens to send along with the transaction
     * @param func Data of the transaction
     */
    function executeCall_s1m(
        address dest,
        uint256 value,
        bytes calldata func
    ) public {
        _requireFromEntryPoint();
        _call(dest, value, func);
    }

    /**
     * @dev Interface function with the standard name for executeCall_s1m
     * @param dest Address of the contract to call
     * @param value Amount of native tokens to send along with the transaction
     * @param func Data of the transaction
     */
    function executeCall(
        address dest,
        uint256 value,
        bytes calldata func
    ) external {
        executeCall_s1m(dest, value, func);
    }

    /**
     * @dev Execute a sequence of transactions
     * @notice Name is optimized for this method to be cheaper to be called
     * @param dest Addresses of the contracts to call
     * @param value Amounts of native tokens to send along with the transactions
     * @param func Data of the transactions
     */
    function executeBatchCall_4by(
        address[] calldata dest,
        uint256[] calldata value,
        bytes[] calldata func
    ) public {
        _requireFromEntryPoint();
        if (
            dest.length == 0 ||
            dest.length != value.length ||
            value.length != func.length
        ) revert WrongBatchProvided(dest.length, value.length, func.length, 0);
        for (uint256 i; i < dest.length; ) {
            _call(dest[i], value[i], func[i]);
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @dev Interface function with the standard name for executeBatchCall_4by
     * @param dest Addresses of the contracts to call
     * @param value Amounts of native tokens to send along with the transactions
     * @param func Data of the transactions
     */
    function executeBatchCall(
        address[] calldata dest,
        uint256[] calldata value,
        bytes[] calldata func
    ) external {
        executeBatchCall_4by(dest, value, func);
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

    function validateUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external virtual override returns (uint256 validationData) {
        if (msg.sender != address(entryPoint()))
            revert CallerIsNotAnEntryPoint(msg.sender);

        (, address validationModule) = abi.decode(
            userOp.signature,
            (bytes, address)
        );
        if (address(modules[validationModule]) != address(0)) {
            validationData = IAuthorizationModule(validationModule)
                .validateUserOp(userOp, userOpHash);
        } else {
            revert WrongValidationModule(validationModule);
        }
        _validateNonce(userOp.nonce);
        _payPrefund(missingAccountFunds);
    }

    /**
     * Implementation of ISignatureValidator (see `interfaces/ISignatureValidator.sol`)
     * @dev If owner is a smart-contract (other smart contract wallet or module, that controls
     *      signature verifications - like multisig), forward isValidSignature request to it.
     *      In case of multisig, _signature can be several concatenated signatures
     *      If owner is EOA, perform a regular ecrecover.
     * @param ethSignedDataHash 32 bytes hash of the data signed on the behalf of address(msg.sender)
     *                          prepended with '\x19Ethereum Signed Message:\n'
     * @param signature Signature byte array associated with ethSignedDataHash
     * @return bytes4 value.
     */
    function isValidSignature(
        bytes32 ethSignedDataHash,
        bytes memory signature
    ) public view override returns (bytes4) {
        (bytes memory moduleSignature, address validationModule) = abi.decode(
            signature,
            (bytes, address)
        );
        if (address(modules[validationModule]) != address(0)) {
            return
                ISignatureValidator(validationModule).isValidSignature(
                    ethSignedDataHash,
                    moduleSignature
                );
        } else {
            revert WrongValidationModule(validationModule);
        }
    }

    /**
     * @dev Check current account deposit in the entryPoint
     */
    function getDeposit() public view returns (uint256) {
        return entryPoint().balanceOf(address(this));
    }

    /**
     * @dev Deposit more funds for this account in the entryPoint
     */
    function addDeposit() public payable {
        entryPoint().depositTo{value: msg.value}(address(this));
    }

    /**
     * @dev Withdraw value from the account's deposit
     * @param withdrawAddress target to send to
     * @param amount to withdraw
     */
    function withdrawDepositTo(
        address payable withdrawAddress,
        uint256 amount
    ) public payable {
        _requireFromEntryPointOrSelf();
        entryPoint().withdrawTo(withdrawAddress, amount);
    }

    /**
     * @dev Adds a module to the allowlist.
     * @notice This can only be done via a userOp or a selfcall.
     * @notice Enables the module `module` for the wallet.
     * @param module Module to be allow-listed.
     */
    function enableModule(address module) external virtual override {
        _requireFromEntryPointOrSelf();
        _enableModule(module);
    }

    /**
     * @dev Setups module for this Smart Account and enables it.
     * @notice This can only be done via userOp or a selfcall.
     * @notice Enables the module `module` for the wallet.
     */
    function setupAndEnableModule(
        address setupContract,
        bytes memory setupData
    ) external virtual override returns (address) {
        _requireFromEntryPointOrSelf();
        return _setupAndEnableModule(setupContract, setupData);
    }

    /**
     * @dev Removes a module from the allowlist.
     * @notice This can only be done via a wallet transaction.
     * @notice Disables the module `module` for the wallet.
     * @param prevModule Module that pointed to the module to be removed in the linked list
     * @param module Module to be removed.
     */
    function disableModule(address prevModule, address module) public virtual {
        _requireFromEntryPointOrSelf();
        _disableModule(prevModule, module);
    }

    function setFallbackHandler(address handler) external virtual override {
        _requireFromEntryPoint();
        _setFallbackHandler(handler);
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

    /**
     * @dev This function is a special fallback function that is triggered when the contract receives Ether.
     * It logs an event indicating the amount of Ether received and the sender's address.
     * @notice This function is marked as external and payable, meaning it can be called from external
     * sources and accepts Ether as payment.
     */
    receive() external payable {
        if (address(this) == _self) revert DelegateCallsOnly();
        emit SmartAccountReceivedNativeToken(msg.sender, msg.value);
    }
}
