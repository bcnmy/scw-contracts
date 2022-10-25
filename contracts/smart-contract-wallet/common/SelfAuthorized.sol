// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.12;

/// @title SelfAuthorized - authorizes current contract to perform actions
contract SelfAuthorized {
    function requireSelfCall() private view {
        require(msg.sender == address(this), "BSA031");
    }

    modifier authorized() {
        // This is a function call as it minimized the bytecode size
        requireSelfCall();
        _;
    }
}
