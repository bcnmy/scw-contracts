// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../../SmartAccount.sol";
import "hardhat/console.sol";

contract SmartAccount2 is SmartAccount {
    // mock constructor or use deinitializers
    // This constructor ensures that this contract can only be used as a master copy for Proxy accounts
    constructor(IEntryPoint anEntryPoint) SmartAccount(anEntryPoint) {
        // By setting the owner it is not possible to call init anymore,
        // so we create an account with fixed non-zero owner.
        // This is an unusable account, perfect for the singleton
        owner = address(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE);
        require(address(anEntryPoint) != address(0), "Invalid Entrypoint");
    }

    function execTransaction(
        Transaction memory _tx,
        FeeRefund memory refundInfo,
        bytes memory signatures
    ) public payable override returns (bool success) {
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
            console.log("batchId used is 1");
            checkSignatures(txHash, signatures);
        }

        // We require some gas to emit the events (at least 2500) after the execution and some to perform code until the execution (500)
        // We also include the 1/64 in the check that is not send along with a call to counteract potential shortings because of EIP-150
        // Bitshift left 6 bits means multiplying by 64, just more gas efficient
        require(
            gasleft() >=
                Math.max((_tx.targetTxGas << 6) / 63, _tx.targetTxGas + 2500) +
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
            uint256 payment;
            if (refundInfo.gasPrice != 0) {
                payment = handlePaymentV2(
                    startGas - gasleft(),
                    refundInfo.baseGas,
                    refundInfo.gasPrice,
                    refundInfo.tokenGasPriceFactor,
                    refundInfo.gasToken,
                    refundInfo.refundReceiver
                );
                emit AccountHandlePayment(txHash, payment);
            }
            console.log("goes from v2");
        }
    }

    function handlePaymentV2(
        uint256 gasUsed,
        uint256 baseGas,
        uint256 gasPrice,
        uint256 tokenGasPriceFactor,
        address gasToken,
        address payable refundReceiver
    ) private returns (uint256 payment) {
        require(tokenGasPriceFactor != 0, "invalid tokenGasPriceFactor");
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
}
