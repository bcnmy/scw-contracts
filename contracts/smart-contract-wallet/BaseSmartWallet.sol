// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.12;

/* solhint-disable avoid-low-level-calls */
/* solhint-disable no-inline-assembly */
/* solhint-disable reason-string */

import "./aa-4337/interfaces/IWallet.sol";
import "./aa-4337/interfaces/IEntryPoint.sol";
import "./common/Enum.sol";

struct Transaction {
        address to;
        uint256 value;
        bytes data;
        Enum.Operation operation;
        uint256 targetTxGas;
    }

struct FeeRefund {
        uint256 baseGas;
        uint256 gasPrice; //gasPrice or tokenGasPrice
        uint256 tokenGasPriceFactor;
        address gasToken;
        address payable refundReceiver;
    }

/**
 * this contract provides the basic logic for implementing the IWallet interface  - validateUserOp
 * specific wallet implementation should inherit it and provide the wallet-specific logic
 */
abstract contract BaseSmartWallet is IWallet {
    using UserOperationLib for UserOperation;

    /**
     * return the wallet nonce.
     * subclass should return a nonce value that is used both by _validateAndUpdateNonce, and by the external provider (to read the current nonce)
     */
    function nonce() public view virtual returns (uint256);

    /**
     * return the entryPoint used by this wallet.
     * subclass should return the current entryPoint used by this wallet.
     */
    function entryPoint() public view virtual returns (IEntryPoint);

    /**
     * Validate user's signature and nonce.
     */
    function validateUserOp(UserOperation calldata userOp, bytes32 requestId, address aggregator, uint256 missingWalletFunds) external override {
        _requireFromEntryPoint();
        _validateSignature(userOp, requestId, aggregator);
        //during construction, the "nonce" field hold the salt.
        // if we assert it is zero, then we allow only a single wallet per owner.
        if (userOp.initCode.length == 0) {
            _validateAndUpdateNonce(userOp);
        }
        _payPrefund(missingWalletFunds);
    }

    /**
     * ensure the request comes from the known entrypoint.
     */
    function _requireFromEntryPoint() internal virtual view {
        require(msg.sender == address(entryPoint()), "wallet: not from EntryPoint");
    }

    /**
     * validate the signature is valid for this message.
     * @param userOp validate the userOp.signature field
     * @param requestId convenient field: the hash of the request, to check the signature against
     *          (also hashes the entrypoint and chain-id)
     * @param aggregator the current aggregator. can be ignored by wallets that don't use aggregators
     */
    function _validateSignature(UserOperation calldata userOp, bytes32 requestId, address aggregator) internal virtual view;

    /**
     * validate the current nonce matches the UserOperation nonce.
     * then it should update the wallet's state to prevent replay of this UserOperation.
     * called only if initCode is empty (since "nonce" field is used as "salt" on wallet creation)
     * @param userOp the op to validate.
     */
    function _validateAndUpdateNonce(UserOperation calldata userOp) internal virtual;

    /**
     * sends to the entrypoint (msg.sender) the missing funds for this transaction.
     * subclass MAY override this method for better funds management
     * (e.g. send to the entryPoint more than the minimum required, so that in future transactions
     * it will not be required to send again)
     * @param missingWalletFunds the minimum value this method should send the entrypoint.
     *  this value MAY be zero, in case there is enough deposit, or the userOp has a paymaster.
     */
    function _payPrefund(uint256 missingWalletFunds) internal virtual {
        if (missingWalletFunds != 0) {
            (bool success,) = payable(msg.sender).call{value : missingWalletFunds, gas : type(uint256).max}("");
            (success);
            //ignore failure (its EntryPoint's job to verify, not wallet.)
        }
    }
    
    function init(address _owner, address _entryPointAddress, address _handler) external virtual;

    function execTransaction(
        Transaction memory _tx,
        uint256 batchId,
        FeeRefund memory refundInfo,
        bytes memory signatures) public payable virtual returns (bool success);
}