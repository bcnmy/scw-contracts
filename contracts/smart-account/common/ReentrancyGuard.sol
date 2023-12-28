// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.23;

/**
 * @title ReentrancyGuard
 * @notice Provides a contract-level guard against reentrancy attacks.
 * @dev Uses a single contract-wide status flag for efficiency.
 * Use the `nonReentrant` modifier on functions to protect them.
 */
abstract contract ReentrancyGuard {
    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;

    uint256 private _reentrancyStatus;

    /// @notice Custom error to denote that reentrancy protection has been activated.
    error ReentrancyProtectionActivated();

    /**
     * @notice Modifier to prevent a contract from calling itself, directly or indirectly.
     * @dev Checks if the function has been re-entered, and if so, reverts with a custom error.
     */
    modifier nonReentrant() {
        if (_reentrancyStatus == ENTERED)
            revert ReentrancyProtectionActivated();
        _reentrancyStatus = ENTERED;
        _;
        _reentrancyStatus = NOT_ENTERED;
    }

    /// @notice Initializes the `ReentrancyGuard` contract, setting the reentrancy status to `NOT_ENTERED`.
    constructor() {
        _reentrancyStatus = NOT_ENTERED;
    }

    /**
     * @notice Checks if the reentrancy guard is currently activated.
     * @dev Returns true if the guard is activated, false otherwise.
     * @return A boolean indicating whether the reentrancy guard is activated.
     */
    function _isReentrancyGuardEntered() internal view returns (bool) {
        return _reentrancyStatus == ENTERED;
    }
}
