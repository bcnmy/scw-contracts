// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;
import "../SmartAccount.sol";

contract SocialRecoveryModule {
    string public constant NAME = "Social Recovery Module";
    string public constant VERSION = "0.1.0";
    address public moduleOwner;

    uint256 public threshold;
    address[] public friends;

    // isFriend mapping maps friend's address to friend status.
    mapping(address => bool) public isFriend;
    // isExecuted mapping maps data hash to execution status.
    mapping(bytes32 => bool) public isExecuted;
    // isConfirmed mapping maps data hash to friend's address to confirmation status.
    mapping(bytes32 => mapping(address => bool)) public isConfirmed;

    modifier onlyFriend() {
        require(isFriend[msg.sender], "Method can only be called by a friend");
        _;
    }

    function setup(
        address[] memory _friends,
        uint256 _threshold,
        address _owner
    ) public {
        require(
            _threshold <= _friends.length,
            "Threshold cannot exceed friends count"
        );
        require(_threshold >= 2, "At least 2 friends required");
        require(moduleOwner == address(0), "Module already initialized");
        // Set allowed friends.
        for (uint256 i = 0; i < _friends.length; i++) {
            address friend = _friends[i];
            require(friend != address(0), "Invalid friend address provided");
            require(!isFriend[friend], "Duplicate friend address provided");
            isFriend[friend] = true;
        }
        moduleOwner = _owner;
        friends = _friends;
        threshold = _threshold;
    }

    function confirmTransaction(bytes32 dataHash) public onlyFriend {
        require(!isExecuted[dataHash], "Recovery already executed");
        isConfirmed[dataHash][msg.sender] = true;
    }

    function recoverAccess(SmartAccount owner, address newOwner)
        public
        onlyFriend
    {
        bytes memory data = abi.encodeWithSignature(
            "setOwner(address)",
            newOwner
        );
        bytes32 dataHash = getDataHash(data);
        require(!isExecuted[dataHash], "Recovery already executed");
        require(
            isConfirmedByRequiredFriends(dataHash),
            "Recovery has not enough confirmations"
        );
        isExecuted[dataHash] = true;
        require(
            owner.execTransactionFromModule(
                moduleOwner,
                0,
                data,
                Enum.Operation.Call
            ),
            "Could not execute recovery"
        );
    }

    function authCall(SmartAccount _account, bytes memory _data) public {
        require(
            _account.execTransactionFromModule(
                moduleOwner,
                0,
                _data,
                Enum.Operation.Call
            ),
            "Failed to execute auth call"
        );
    }

    function isConfirmedByRequiredFriends(bytes32 dataHash)
        public
        view
        returns (bool)
    {
        uint256 confirmationCount;
        for (uint256 i = 0; i < friends.length; i++) {
            if (isConfirmed[dataHash][friends[i]]) confirmationCount++;
            if (confirmationCount == threshold) return true;
        }
        return false;
    }

    /// @dev Returns hash of data encoding owner replacement.
    /// @param data Data payload.
    /// @return Data hash.
    function getDataHash(bytes memory data) public pure returns (bytes32) {
        return keccak256(data);
    }
}
