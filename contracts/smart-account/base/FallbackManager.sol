// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.17;

import {SelfAuthorized} from "../common/SelfAuthorized.sol";
import {FallbackManagerErrors} from "../common/Errors.sol";

/**
 *   @title Fallback Manager - A contract that manages fallback calls made to the Smart Account
 *   @dev Fallback calls are handled by a `handler` contract that is stored at FALLBACK_HANDLER_STORAGE_SLOT
 *        fallback calls are not delegated to the `handler` so they can not directly change Smart Account storage
 */
abstract contract FallbackManager is SelfAuthorized, FallbackManagerErrors {
    // keccak-256 hash of "fallback_manager.handler.address" subtracted by 1
    bytes32 internal constant FALLBACK_HANDLER_STORAGE_SLOT =
        0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d4;

    uint256[24] private __gap;

    event ChangedFallbackHandler(
        address indexed previousHandler,
        address indexed handler
    );

    fallback() external {
        bytes32 slot = FALLBACK_HANDLER_STORAGE_SLOT;

        assembly {
            let handler := sload(slot)
            if iszero(handler) {
                return(0, 0)
            }
            calldatacopy(0, 0, calldatasize())
            // The msg.sender address is shifted to the left by 12 bytes to remove the padding
            // Then the address without padding is stored right after the calldata
            mstore(calldatasize(), shl(96, caller()))
            // Add 20 bytes for the address appended add the end
            let success := call(
                gas(),
                handler,
                0,
                0,
                add(calldatasize(), 20),
                0,
                0
            )
            returndatacopy(0, 0, returndatasize())
            if iszero(success) {
                revert(0, returndatasize())
            }
            return(0, returndatasize())
        }
    }

    /// @dev Allows to add a contract to handle fallback calls.
    ///      Only fallback calls without value and with data will be forwarded
    /// @param handler contract to handle fallback calls.
    function setFallbackHandler(address handler) external virtual;

    function getFallbackHandler() public view returns (address _handler) {
        assembly {
            _handler := sload(FALLBACK_HANDLER_STORAGE_SLOT)
        }
    }

    function _setFallbackHandler(address handler) internal {
        if (handler == address(0)) revert HandlerCannotBeZero();
        address previousHandler;

        assembly {
            previousHandler := sload(FALLBACK_HANDLER_STORAGE_SLOT)
            //}
            //bytes32 slot = FALLBACK_HANDLER_STORAGE_SLOT;

            //assembly {
            sstore(FALLBACK_HANDLER_STORAGE_SLOT, handler)
        }
        emit ChangedFallbackHandler(previousHandler, handler);
    }
}
