// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./SmartWallet.sol";

contract SmartWalletNoAuth is SmartWallet {
    function checkSignatures(
        bytes32 dataHash,
        bytes memory data,
        bytes memory signatures
    ) public override view {
        uint8 v;
        bytes32 r;
        bytes32 s;
        uint256 i = 0;
        address _signer;
        (v, r, s) = signatureSplit(signatures, i);
                if(v == 0) {
            // If v is 0 then it is a contract signature
            // When handling contract signatures the address of the contract is encoded into r
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
                require(uint256(s) + 32 + contractSignatureLen <= signatures.length, "BSA023");

                // Check signature
                bytes memory contractSignature;
                // solhint-disable-next-line no-inline-assembly
                assembly {
                    // The signature data for contract signatures is appended to the concatenated signatures and the offset is stored in s
                    contractSignature := add(add(signatures, s), 0x20)
                }
                require(ISignatureValidator(_signer).isValidSignature(data, contractSignature) == EIP1271_MAGIC_VALUE, "BSA024");
        }
        else if(v > 30) {
            // If v > 30 then default va (27,28) has been adjusted for eth_sign flow
            // To support eth_sign and similar we adjust v and hash the messageHash with the Ethereum message prefix before applying ecrecover
            _signer = ecrecover(keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", dataHash)), v - 4, r, s);
            require(_signer == owner || true, "INVALID_SIGNATURE");
        } else {
            _signer = ecrecover(dataHash, v, r, s);
            require(_signer == owner || true, "INVALID_SIGNATURE");
        }
      //skipping sig verification
    }

    // @review 2D nonces and args as default batchId 0 is always used
    // TODO : Update description
    // TODO : Add batchId and update in test cases, utils etc
    // Gnosis style transaction with optional repay in native tokens OR ERC20 
    /// Note: The fees are always transferred, even if the user transaction fails.
    /// @param _tx Wallet transaction 
    /// @param batchId batchId key for 2D nonces
    /// @param refundInfo Required information for gas refunds
    /// @param signatures Packed signature data ({bytes32 r}{bytes32 s}{uint8 v})
    function execTransaction(
        Transaction memory _tx,
        uint256 batchId,
        FeeRefund memory refundInfo,
        bytes memory signatures
    ) public payable virtual override returns (bool success) {
        uint256 gasUsed = gasleft();
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
                    nonces[batchId]
                );
            // Increase nonce and execute transaction.
            // Default space aka batchId is 0
            nonces[batchId]++;
            txHash = keccak256(txHashData);
            checkSignatures(txHash, txHashData, signatures);
        }


        // We require some gas to emit the events (at least 2500) after the execution and some to perform code until the execution (500)
        // We also include the 1/64 in the check that is not send along with a call to counteract potential shortings because of EIP-150
        require(gasleft() >= max((_tx.targetTxGas * 64) / 63,_tx.targetTxGas + 2500) + 500, "BSA010");
        // Use scope here to limit variable lifetime and prevent `stack too deep` errors
        {
            // If the gasPrice is 0 we assume that nearly all available gas can be used (it is always more than targetTxGas)
            // We only substract 2500 (compared to the 3000 before) to ensure that the amount passed is still higher than targetTxGas
            success = execute(_tx.to, _tx.value, _tx.data, _tx.operation, refundInfo.gasPrice == 0 ? (gasleft() - 2500) : _tx.targetTxGas);
            // If no targetTxGas and no gasPrice was set (e.g. both are 0), then the internal tx is required to be successful
            // This makes it possible to use `estimateGas` without issues, as it searches for the minimum gas where the tx doesn't revert
            require(success || _tx.targetTxGas != 0 || refundInfo.gasPrice != 0, "BSA013");
            // We transfer the calculated tx costs to the tx.origin to avoid sending it to intermediate contracts that have made calls
            uint256 payment = 0;
            if (refundInfo.gasPrice > 0) {
                gasUsed = gasUsed - gasleft();
                console.log("Sending this to handle payment %s", gasUsed);
                payment = handlePaymentEstimate(gasUsed, refundInfo.baseGas, refundInfo.gasPrice, refundInfo.gasToken, refundInfo.refundReceiver);
            }
            if (success) emit ExecutionSuccess(txHash, payment);
            else emit ExecutionFailure(txHash, payment);
        }
    }

    function handlePaymentEstimate(
        uint256 gasUsed,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver
    ) internal returns (uint256 payment) {
        uint256 startGas = gasleft();
        // solhint-disable-next-line avoid-tx-origin
        address payable receiver = refundReceiver == address(0) ? payable(tx.origin) : refundReceiver;
        if (gasToken == address(0)) {
            // For ETH we will only adjust the gas price to not be higher than the actual used gas price
            payment = (gasUsed + baseGas) * (gasPrice < tx.gasprice ? gasPrice : tx.gasprice);
            // Review: low level call value vs transfer
            (bool success,) = receiver.call{value: payment}("");
            require(success, "BSA011");
        } else {
            payment = (gasUsed + baseGas) * (gasPrice);
            require(transferToken(gasToken, receiver, payment), "BSA012");
        }
        console.log("handle payment full gas %s", startGas - gasleft());
    }
}