// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
import "../../smart-contract-wallet/base/ModuleManager.sol";

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
        SessionParam calldata sessionParam
    ) external {
        require(
            !sessionMap[sessionKey].enable,
            "Session for key is already enabled"
        );
        Session storage _session = sessionMap[sessionKey];
        _session.enable = true;
        _session.startTimestamp = sessionParam.startTimestamp;
        _session.endTimestamp = sessionParam.endTimestamp;
        _session.sessionKey = sessionKey;
        _session.smartAccount = msg.sender;

        address[] memory whitelistAddresses = new address[](permissions.length);
        for (uint256 index = 0; index < permissions.length; index++) {
            PermissionParam memory permission = permissions[index];
            whitelistAddresses[index] = permission.whitelistDestination;
            _session.permission.whitelistMethods[
                permission.whitelistDestination
            ] = permission.whitelistMethods;
            if (permission.tokenAmount > 0) {
                _session.permission.tokenApprovals[
                    permission.whitelistDestination
                ] = TokenApproval({
                    enable: true,
                    amount: permission.tokenAmount
                });
            }
        }
        _session.permission.whitelistDestinations = whitelistAddresses;
    }

    function getSessionInfo(address sessionKey)
        public
        view
        returns (SessionParam memory sessionInfo)
    {
        Session storage session = sessionMap[sessionKey];
        sessionInfo = SessionParam({
            startTimestamp: session.startTimestamp,
            endTimestamp: session.endTimestamp,
            enable: session.enable
        });
    }

    function getWhitelistDestinations(address sessionKey)
        public
        view
        returns (address[] memory)
    {
        Session storage session = sessionMap[sessionKey];
        return session.permission.whitelistDestinations;
    }

    function getWhitelistMethods(
        address sessionKey,
        address whitelistDestination
    ) public view returns (bytes[] memory) {
        Session storage session = sessionMap[sessionKey];
        return session.permission.whitelistMethods[whitelistDestination];
    }

    function getTokenPermissions(address sessionKey, address token)
        public
        view
        returns (TokenApproval memory tokenApproval)
    {
        Session storage session = sessionMap[sessionKey];
        return session.permission.tokenApprovals[token];
    }

    function executeTransaction(
        ModuleManager smartAccount,
        address payable _to,
        uint96 _amount,
        bytes memory _data
    ) external {}
}
