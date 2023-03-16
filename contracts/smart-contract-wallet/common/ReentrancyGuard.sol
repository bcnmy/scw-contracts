// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.17;

/// @title Reentrancy Guard - reentrancy protection
abstract contract ReentrancyGuard {
    error ReentrancyProtectionActivated();

    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;

    uint256 private reentrancyStatus;

    constructor() {
        reentrancyStatus = NOT_ENTERED;
    }

    modifier nonReentrant() {
        if (reentrancyStatus == ENTERED) revert ReentrancyProtectionActivated();
        reentrancyStatus = ENTERED;
        _;
        reentrancyStatus = NOT_ENTERED;
    }

    function _isReentrancyGuardEntered() internal view returns (bool) {
        return reentrancyStatus == ENTERED;
    }
}
