// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {ISignatureValidator, ISignatureValidatorConstants} from "../interfaces/ISignatureValidator.sol";
import {Enum} from "../common/Enum.sol";
import {ReentrancyGuard} from "../common/ReentrancyGuard.sol";
import {Math} from "../libs/Math.sol";

interface IExecFromModule {
    function execTransactionFromModule(
        address to,
        uint256 value,
        bytes memory data,
        Enum.Operation operation,
        uint256 txGas
    ) external returns (bool success);

    function execTransactionFromModule(
        address to,
        uint256 value,
        bytes memory data,
        Enum.Operation operation
    ) external returns (bool success);
}

struct Transaction {
    address to;
    Enum.Operation operation;
    uint256 value;
    bytes data;
    uint256 targetTxGas;
}

struct FeeRefund {
    uint256 baseGas;
    uint256 gasPrice; //gasPrice or tokenGasPrice
    uint256 tokenGasPriceFactor;
    address gasToken;
    address payable refundReceiver;
}

contract ForwardFlowModule is ReentrancyGuard, ISignatureValidatorConstants {
    // Domain Seperators keccak256("EIP712Domain(uint256 chainId,address verifyingContract)");
    bytes32 internal constant DOMAIN_SEPARATOR_TYPEHASH =
        0x47e79534a245952e8b16893a336b85a3d9ea9fa8c573f3d803afb92a79469218;

    // keccak256(
    //     "AccountTx(address to,uint256 value,bytes data,uint8 operation,uint256 targetTxGas,uint256 baseGas,uint256 gasPrice,uint256 tokenGasPriceFactor,address gasToken,address refundReceiver,uint256 nonce)"
    // );
    bytes32 internal constant ACCOUNT_TX_TYPEHASH =
        0xda033865d68bf4a40a5a7cb4159a99e33dba8569e65ea3e38222eb12d9e66eee;

    uint256 private immutable _chainId;

    mapping(uint256 => uint256) public nonces;

    event AccountHandlePayment(bytes32 indexed txHash, uint256 indexed payment);

    constructor() {
        _chainId = block.chainid;
    }

    /**
     * @dev Safe (ex-Gnosis) style transaction with optional repay in native tokens or ERC20
     * @dev Allows to execute a transaction confirmed by required signature/s and then pays the account that submitted the transaction.
     * @dev Function name optimized to have hash started with zeros to make this function calls cheaper
     * @notice The fees are always transferred, even if the user transaction fails.
     * @param _tx Smart Account transaction
     * @param refundInfo Required information for gas refunds
     * @param signatures Packed signature/s data ({bytes32 r}{bytes32 s}{uint8 v})
     *                   Should be a signature over Typed Data Hash
     *                   Use eth_signTypedData, not a personal_sign
     */

    function execTransaction(
        address smartAccount,
        Transaction memory _tx,
        FeeRefund memory refundInfo,
        bytes memory signatures
    ) public payable virtual nonReentrant returns (bool success) {
        uint256 startGas = gasleft();
        bytes32 txHash;
        // Use scope here to limit variable lifetime and prevent `stack too deep` errors
        {
            bytes memory txHashData = encodeTransactionData(
                // Smart Account to execute Transaction
                smartAccount,
                // Transaction info
                _tx,
                // Payment info
                refundInfo,
                // Signature info
                nonces[1]++
            );

            txHash = keccak256(txHashData);
            if (
                ISignatureValidator(smartAccount).isValidSignature(
                    txHash,
                    signatures
                ) != EIP1271_MAGIC_VALUE
            ) {
                revert InvalidSignature();
            }
        }

        // We require some gas to emit the events (at least 2500) after the execution and some to
        // perform code until the execution (7500 = call the external function + checks inside it)
        // We also include the 1/64 in the check that is not send along with a call to counteract
        // potential shortings because of EIP-150
        // Bitshift left 6 bits means multiplying by 64, just more gas efficient
        if (
            gasleft() <
            Math.max((_tx.targetTxGas << 6) / 63, _tx.targetTxGas + 2500) + 7500
        )
            revert NotEnoughGasLeft(
                gasleft(),
                Math.max((_tx.targetTxGas << 6) / 63, _tx.targetTxGas + 2500) +
                    7500
            );
        // Use scope here to limit variable lifetime and prevent `stack too deep` errors
        {
            //we always provide targetTxGas to execution
            success = IExecFromModule(smartAccount).execTransactionFromModule(
                _tx.to,
                _tx.value,
                _tx.data,
                _tx.operation,
                _tx.targetTxGas
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
                    smartAccount,
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
        address smartAccount,
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
            if (
                !IExecFromModule(smartAccount).execTransactionFromModule(
                    receiver,
                    payment,
                    "0x",
                    Enum.Operation.Call,
                    0
                )
            ) {
                revert TokenTransferFailed(address(0), receiver, payment);
            }
        } else {
            payment =
                ((gasUsed + baseGas) * (gasPrice)) /
                (tokenGasPriceFactor);
            if (
                !IExecFromModule(smartAccount).execTransactionFromModule(
                    gasToken,
                    0,
                    abi.encodeWithSignature(
                        "transfer(address,uint256)",
                        receiver,
                        payment
                    ),
                    Enum.Operation.Call,
                    0
                )
            ) {
                revert TokenTransferFailed(gasToken, receiver, payment);
            }
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
        address smartAccount,
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
            if (
                !IExecFromModule(smartAccount).execTransactionFromModule(
                    receiver,
                    payment,
                    "0x",
                    Enum.Operation.Call,
                    0
                )
            ) {
                revert TokenTransferFailed(address(0), receiver, payment);
            }
        } else {
            uint256 payment = ((gasUsed + baseGas) * (gasPrice)) /
                (tokenGasPriceFactor);
            if (
                !IExecFromModule(smartAccount).execTransactionFromModule(
                    gasToken,
                    0,
                    abi.encodeWithSignature(
                        "transfer(address,uint256)",
                        receiver,
                        payment
                    ),
                    Enum.Operation.Call,
                    0
                )
            ) {
                revert TokenTransferFailed(gasToken, receiver, payment);
            }
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
        address smartAccount,
        address to,
        uint256 value,
        bytes calldata data,
        Enum.Operation operation
    ) external returns (uint256) {
        uint256 startGas = gasleft();
        // We don't provide an error message here, as we use it to return the estimate
        if (
            !IExecFromModule(smartAccount).execTransactionFromModule(
                to,
                value,
                data,
                operation
            )
        ) revert ExecutionFailed();
        // Convert response to string and return via error message
        unchecked {
            revert(string(abi.encodePacked(startGas - gasleft())));
        }
    }

    /**
     * @dev Returns hash to be signed by owner.
     * @param _nonce Transaction nonce.
     * @param smartAccount Address of the Smart Account to execute the txn.
     * @return Transaction hash.
     */
    function getTransactionHash(
        Transaction calldata _tx,
        FeeRefund calldata refundInfo,
        uint256 _nonce,
        address smartAccount
    ) public view returns (bytes32) {
        return
            keccak256(
                encodeTransactionData(smartAccount, _tx, refundInfo, _nonce)
            );
    }

    /**
     * @dev Returns the bytes that are hashed to be signed by owner.
     * @param _tx The wallet transaction to be signed.
     * @param refundInfo Required information for gas refunds.
     * @param _nonce Transaction nonce.
     * @return transactionHash bytes that are hashed to be signed by the owner.
     */
    function encodeTransactionData(
        address smartAccount,
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
                domainSeparator(smartAccount),
                accountTxHash
            );
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
     * @dev Returns the domain separator for this contract, as defined in the EIP-712 standard.
     * @return bytes32 The domain separator hash.
     */
    function domainSeparator(
        address smartAccount
    ) public view returns (bytes32) {
        return
            keccak256(
                abi.encode(DOMAIN_SEPARATOR_TYPEHASH, _chainId, smartAccount)
            );
    }

    /**
     * @notice Returns the ID of the chain the contract is currently deployed on.
     * @return _chainId The ID of the current chain as a uint256.
     */
    function getChainId() public view returns (uint256) {
        return _chainId;
    }
}

/**
 * @notice Throws when the address that signed the data (restored from signature)
 * differs from the address we expected to sign the data (i.e. some authorized address)
 */
error InvalidSignature();

/**
 * @notice Throws if not enough gas is left at some point
 * @param gasLeft how much gas left at the moment of a check
 * @param gasRequired how much gas required to proceed
 */
error NotEnoughGasLeft(uint256 gasLeft, uint256 gasRequired);

/**
 * @notice Throws if not able to estimate gas
 * It can be when amount of gas and its price are both zero and at the same time
 * transaction has failed to be executed
 * @param targetTxGas gas required for target transaction
 * @param gasPrice gas price passed in Refund Info
 * @param success whether transaction has been executed successfully or not
 */
error CanNotEstimateGas(uint256 targetTxGas, uint256 gasPrice, bool success);

/**
 * @notice Throws if transfer of tokens failed
 * @param token token contract address
 * @param dest token transfer receiver
 * @param amount the amount of tokens in a failed transfer
 */
error TokenTransferFailed(address token, address dest, uint256 amount);

/**
 * @notice Thrown when trying to use 0 as tokenGasPriceFactor
 */
error TokenGasPriceFactorCanNotBeZero();

/**
 * @notice Throws when the transaction execution fails
 */
error ExecutionFailed();
