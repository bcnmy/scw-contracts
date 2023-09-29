// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.17;

/// @title Reentrancy Guard - reentrancy protection
abstract contract ReentrancyGuard {
    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;

    uint256 private _reentrancyStatus;

    error ReentrancyProtectionActivated();

    modifier nonReentrant() {
        if (_reentrancyStatus == ENTERED)
            revert ReentrancyProtectionActivated();
        _reentrancyStatus = ENTERED;
        _;
        _reentrancyStatus = NOT_ENTERED;
    }

    constructor() {
        _reentrancyStatus = NOT_ENTERED;
    }

    function _isReentrancyGuardEntered() internal view returns (bool) {
        return _reentrancyStatus == ENTERED;
    }
}
