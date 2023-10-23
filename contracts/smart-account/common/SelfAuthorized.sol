// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.17;

import {ISelfAuthorized} from "../interfaces/common/ISelfAuthorized.sol";

/**
 * @title SelfAuthorized
 * @notice This contract provides a modifier to ensure that only the contract itself can call certain functions.
 * @dev Functions with the `authorized` modifier can only be called by the contract itself.
 * This can be useful for security purposes or to ensure a specific call flow.
 */
contract SelfAuthorized is ISelfAuthorized {
    /**
     * @notice Modifier to ensure a function is only callable by the contract itself.
     * @dev Checks if the caller is the current contract. If not, reverts.
     */
    modifier authorized() {
        _requireSelfCall();
        _;
    }

    /**
     * @dev Internal function to check if the caller is the current contract.
     * @dev If the caller isn't the contract, it reverts with a specific error.
     */
    function _requireSelfCall() private view {
        if (msg.sender != address(this)) revert CallerIsNotSelf(msg.sender);
    }
}
