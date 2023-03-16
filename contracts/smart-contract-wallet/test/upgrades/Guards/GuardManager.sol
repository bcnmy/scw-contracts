// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.17;

import {Enum} from "../../../common/Enum.sol";
import {Transaction, FeeRefund} from "../../../BaseSmartAccount.sol";
import {SelfAuthorized} from "../../../common/SelfAuthorized.sol";
import {IERC165} from "../../../interfaces/IERC165.sol";

interface Guard is IERC165 {
    function checkTransaction(
        Transaction memory _tx,
        FeeRefund memory refundInfo,
        bytes memory signatures,
        address msgSender
    ) external;

    function checkAfterExecution(bytes32 txHash, bool success) external;
}

abstract contract BaseGuard is Guard {
    function supportsInterface(
        bytes4 interfaceId
    ) external view virtual override returns (bool) {
        return
            interfaceId == type(Guard).interfaceId || // 0xe6d7a83a
            interfaceId == type(IERC165).interfaceId; // 0x01ffc9a7
    }
}

/// @title Guard Manager - A contract that manages transaction guards which perform pre and post-checks on execution by multisig owners
/// @author Inspired by Richard Meissner's <richard@gnosis.pm> implementation
contract GuardManager is SelfAuthorized {
    event GuardChanged(address guard);
    error InvalidGuard(address guard);
    // keccak256("guard_manager.guard.address")
    bytes32 internal constant GUARD_STORAGE_SLOT =
        0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c7;

    /// @dev Set a guard that checks transactions before execution
    /// @param guard The address of the guard to be used or the 0 address to disable the guard
    function setGuard(address guard) external authorized {
        if (guard != address(0)) {
            if (!Guard(guard).supportsInterface(type(Guard).interfaceId))
                revert InvalidGuard(guard);
        }
        bytes32 slot = GUARD_STORAGE_SLOT;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            sstore(slot, guard)
        }
        emit GuardChanged(guard);
    }

    function getGuard() public view returns (address guard) {
        bytes32 slot = GUARD_STORAGE_SLOT;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            guard := sload(slot)
        }
    }
}
