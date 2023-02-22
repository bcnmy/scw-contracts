// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;
import "../SmartAccount.sol";
import "hardhat/console.sol";

contract SocialRecoveryModule {
    string public constant NAME = "Social Recovery Module";
    string public constant VERSION = "0.1.0";

    struct Friends {
        address[] friends; // the list of friends
        uint256 threshold; // minimum number of friends required to recover
    }
    mapping(address => Friends) internal entries;
    mapping(address => mapping(address => bool)) public isFriend;

    // map of [dataHash][SCw][friend] to bool
    mapping(bytes32 => mapping(address => mapping(address => bool)))
        public isConfirmed;
    mapping(bytes32 => bool) public isExecuted;

    /**
     * @dev Setup function sets initial storage of contract. Only by SCW owner.
     */
    function setup(address[] memory _friends, uint256 _threshold) public {
        require(
            _threshold <= _friends.length,
            "Threshold exceeds friends count"
        );
        require(_threshold >= 2, "At least 2 friends required");
        console.log("msg.sender", msg.sender);
        Friends storage entry = entries[msg.sender];
        // check for duplicates in friends list
        for (uint256 i = 0; i < _friends.length; i++) {
            address friend = _friends[i];
            console.log(friend);
            require(friend != address(0), "Invalid friend address provided");
            require(
                !isFriend[msg.sender][friend],
                "Duplicate friends provided"
            );
            isFriend[msg.sender][friend] = true;
        }
        // update friends list and threshold for smart account
        console.log(_friends.length);
        entry.friends = _friends;
        entry.threshold = _threshold;
        console.log(entry.friends.length);
    }

    /**
     * @dev Confirm friend recovery transaction. Only by friends.
     */
    function confirmTransaction(address _smartAccount, bytes32 dataHash)
        public
    {
        console.log(_onlyFriends(_smartAccount, msg.sender));
        require(_onlyFriends(_smartAccount, msg.sender), "sender not a friend");
        require(!isExecuted[dataHash], "Recovery already executed");
        isConfirmed[dataHash][_smartAccount][msg.sender] = true;
    }

    function recoverAccess(address payable _smartAccount, address newOwner)
        public
    {
        require(_onlyFriends(_smartAccount, msg.sender), "sender not a friend");
        // TODO: add nonce, salt, chainId to dataHash to prevent replay attacks
        bytes memory data = abi.encodeWithSignature(
            "setOwner(address)",
            newOwner
        );
        bytes32 dataHash = getDataHash(data);
        require(!isExecuted[dataHash], "Recovery already executed");
        require(
            isConfirmedByRequiredFriends(dataHash, _smartAccount),
            "Not enough confirmations"
        );
        isExecuted[dataHash] = true;
        SmartAccount smartAccount = SmartAccount(payable(_smartAccount));
        require(
            smartAccount.execTransactionFromModule(
                _smartAccount,
                0,
                data,
                Enum.Operation.Call
            ),
            "Could not execute recovery"
        );
    }

    function isConfirmedByRequiredFriends(
        bytes32 dataHash,
        address _smartAccount
    ) public view returns (bool) {
        uint256 confirmationCount;
        Friends storage entry = entries[_smartAccount];
        for (uint256 i = 0; i < entry.friends.length; i++) {
            if (isConfirmed[dataHash][_smartAccount][entry.friends[i]])
                confirmationCount++;
            if (confirmationCount == entry.threshold) return true;
        }
        return false;
    }

    function _onlyFriends(address _smartAccount, address _friend)
        public
        view
        returns (bool)
    {
        Friends storage entry = entries[_smartAccount];
        console.log(entry.friends.length);
        for (uint256 i = 0; i < entry.friends.length; i++) {
            if (entry.friends[i] == _friend) return true;
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
