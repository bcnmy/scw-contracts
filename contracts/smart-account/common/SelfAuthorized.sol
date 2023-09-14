// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.17;

import {SelfAuthorizedErrors} from "../common/Errors.sol";

/// @title SelfAuthorized - authorizes current contract to perform actions
contract SelfAuthorized is SelfAuthorizedErrors {
    modifier authorized() {
        // This is a function call as it minimized the bytecode size
        _requireSelfCall();
        _;
    }

    function _requireSelfCall() private view {
        if (msg.sender != address(this)) revert CallerIsNotSelf(msg.sender);
    }
}
