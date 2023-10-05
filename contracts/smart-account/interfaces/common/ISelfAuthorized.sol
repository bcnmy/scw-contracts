// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.17;

/// @title SelfAuthorized - authorizes current contract to perform actions
interface ISelfAuthorized {
    /**
     * @notice Throws when the caller is not address(this)
     * @param caller Caller address
     */
    error CallerIsNotSelf(address caller);
}
