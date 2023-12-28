// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.23;

import {SelfAuthorized} from "../common/SelfAuthorized.sol";
import {IFallbackManager} from "../interfaces/base/IFallbackManager.sol";

/**
 *   @title Fallback Manager - A contract that manages fallback calls made to the Smart Account
 *   @dev Fallback calls are handled by a `handler` contract that is stored at FALLBACK_HANDLER_STORAGE_SLOT
 *        fallback calls are not delegated to the `handler` so they can not directly change Smart Account storage
 */
abstract contract FallbackManager is SelfAuthorized, IFallbackManager {
    // keccak-256 hash of "fallback_manager.handler.address" subtracted by 1
    bytes32 internal constant FALLBACK_HANDLER_STORAGE_SLOT =
        0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d4;

    uint256[24] private __gap;

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

    /// @inheritdoc IFallbackManager
    function setFallbackHandler(address handler) external virtual override;

    /// @inheritdoc IFallbackManager
    function getFallbackHandler()
        public
        view
        override
        returns (address _handler)
    {
        assembly {
            _handler := sload(FALLBACK_HANDLER_STORAGE_SLOT)
        }
    }

    /**
     * @notice Sets a new fallback handler. This function will revert if the provided handler address is zero.
     * @dev This function is internal and utilizes assembly for optimized storage operations.
     * @param handler The address of the new fallback handler.
     */
    function _setFallbackHandler(address handler) internal {
        if (handler == address(0)) revert HandlerCannotBeZero();
        address previousHandler;

        assembly {
            previousHandler := sload(FALLBACK_HANDLER_STORAGE_SLOT)
            sstore(FALLBACK_HANDLER_STORAGE_SLOT, handler)
        }
        emit ChangedFallbackHandler(previousHandler, handler);
    }
}
