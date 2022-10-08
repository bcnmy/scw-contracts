// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract SessionKeyModule {
    string public constant NAME = "Session Key Module";
    string public constant VERSION = "0.1.0";

    struct TokenApproval {
        bool enable;
        uint256 amount;
    }

    // PermissionParam struct to be used as parameter in createSession method
    struct PermissionParam {
        address whitelistDestination;
        bytes[] whitelistMethods;
        uint256 tokenAmount;
    }

    // SessionParam struct to be used as parameter in createSession method
    struct SessionParam {
        uint256 startTimestamp;
        uint256 endTimestamp;
        bool enable;
    }

    struct PermissionStorage {
        address[] whitelistDestinations;
        mapping(address => bytes[]) whitelistMethods;
        mapping(address => TokenApproval) tokenApprovals;
    }

    struct Session {
        address smartAccount;
        address sessionKey;
        uint256 startTimestamp;
        uint256 endTimestamp;
        bool enable;
        PermissionStorage permission;
    }

    mapping(address => Session) internal sessionMap;

    function createSession(
        address sessionKey,
        PermissionParam[] calldata permissions,
        SessionParam calldata session
    ) external {}
}
