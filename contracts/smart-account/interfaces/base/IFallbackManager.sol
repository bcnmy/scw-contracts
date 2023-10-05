// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.17;

/**
 *   @title Fallback Manager - A contract that manages fallback calls made to the Smart Account
 *   @dev Fallback calls are handled by a `handler` contract that is stored at FALLBACK_HANDLER_STORAGE_SLOT
 *        fallback calls are not delegated to the `handler` so they can not directly change Smart Account storage
 */
interface IFallbackManager {
    // Events
    event ChangedFallbackHandler(
        address indexed previousHandler,
        address indexed handler
    );

    /**
     * @notice Throws if zero address has been provided as Fallback Handler address
     */
    error HandlerCannotBeZero();

    /// @dev Allows to add a contract to handle fallback calls.
    ///      Only fallback calls without value and with data will be forwarded
    /// @param handler contract to handle fallback calls.
    function setFallbackHandler(address handler) external;

    /// @dev Returns the address of the fallback handler
    /// @return _handler address of the fallback handler
    function getFallbackHandler() external view returns (address _handler);
}
