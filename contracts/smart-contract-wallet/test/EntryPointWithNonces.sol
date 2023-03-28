// SPDX-License-Identifier: GPL-3.0
/**
 ** EntryPoint with semi-abstracted nonces support.
 ** Only one instance required on each chain.
 **/
pragma solidity 0.8.17;

import "../aa-4337/core/EntryPoint.sol";

contract EntryPointWithNonces is EntryPoint {
    mapping(address => mapping(uint192 => uint256)) public nonces;

    function getNonce(address sender, uint192 key) public view returns (uint256) {
        return (uint256(key) << 64) + nonces[sender][key];
    }

    /**
    * validate nonce uniqueness for this account.
    * called just after validateUserOp()
    */
    function _validateAndUpdateNonce(address sender, uint256 nonce) internal {
        uint192 key = uint192(nonce >> 64);
        uint64 seq = uint64(nonce);
        require(nonces[sender][key]++ == seq, "Wrong Nonce Provided");
    }

    /**
     * call account.validateUserOp.
     * revert (with FailedOp) in case validateUserOp reverts, or account didn't send required prefund.
     * decrement account's deposit if needed
     */
    function _validateAccountPrepayment(
        uint256 opIndex,
        UserOperation calldata op,
        UserOpInfo memory opInfo,
        uint256 requiredPrefund
    )
        internal
        virtual
        override
        returns (
            uint256 gasUsedByValidateAccountPrepayment,
            uint256 validationData
        )
    {
        unchecked {
            uint256 preGas = gasleft();
            MemoryUserOp memory mUserOp = opInfo.mUserOp;
            address sender = mUserOp.sender;
            _createSenderIfNeeded(opIndex, opInfo, op.initCode);
            address paymaster = mUserOp.paymaster;
            numberMarker();
            uint256 missingAccountFunds = 0;
            if (paymaster == address(0)) {
                uint256 bal = balanceOf(sender);
                missingAccountFunds = bal > requiredPrefund
                    ? 0
                    : requiredPrefund - bal;
            }
            try
                IAccount(sender).validateUserOp{
                    gas: mUserOp.verificationGasLimit
                }(op, opInfo.userOpHash, missingAccountFunds)
            returns (uint256 _validationData) {
                validationData = _validationData;
            } catch Error(string memory revertReason) {
                revert FailedOp(
                    opIndex,
                    string.concat("AA23 reverted: ", revertReason)
                );
            } catch {
                revert FailedOp(opIndex, "AA23 reverted (or OOG)");
            }

            _validateAndUpdateNonce(sender, mUserOp.nonce);

            if (paymaster == address(0)) {
                DepositInfo storage senderInfo = deposits[sender];
                uint256 deposit = senderInfo.deposit;
                if (requiredPrefund > deposit) {
                    revert FailedOp(opIndex, "AA21 didn't pay prefund");
                }
                senderInfo.deposit = uint112(deposit - requiredPrefund);
            }
            gasUsedByValidateAccountPrepayment = preGas - gasleft();
        }
    }

}
