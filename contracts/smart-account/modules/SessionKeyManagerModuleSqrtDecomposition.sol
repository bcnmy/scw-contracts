// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {_packValidationData} from "@account-abstraction/contracts/core/Helpers.sol";
import {UserOperation} from "@account-abstraction/contracts/interfaces/UserOperation.sol";
import {ISessionValidationModule} from "./interfaces/ISessionValidationModule.sol";

contract SessionKeyManagerModuleSqrtDecomposition {
    struct SessionStorage {
        bytes32 treeRoot;
    }

    struct TreeProof {
        bytes32[] subtreeHashes;
        bytes32[] neighborHashes;
        uint128 subtreeIndex;
        uint128 leafIndex;
    }

    uint256 public immutable TREE_WIDTH;

    /**
     * @dev mapping of Smart Account to a SessionStorage
     * Info about session keys is stored as root of the merkle tree built over the session keys
     */
    mapping(address => SessionStorage) internal _userSessions;

    constructor(uint256 _treeWidth) {
        TREE_WIDTH = _treeWidth;
    }

    function setTreeRoot(bytes32 _treeRoot) external {
        _userSessions[msg.sender].treeRoot = _treeRoot;
    }

    function validateUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash
    ) external virtual returns (uint256) {
        (bytes memory moduleSignature, ) = abi.decode(
            userOp.signature,
            (bytes, address)
        );
        (
            uint48 validUntil,
            uint48 validAfter,
            address sessionValidationModule,
            bytes memory sessionKeyData,
            TreeProof memory treeProof,
            bytes memory sessionKeySignature
        ) = abi.decode(
                moduleSignature,
                (uint48, uint48, address, bytes, TreeProof, bytes)
            );

        validateSessionKey(
            userOp.sender,
            validUntil,
            validAfter,
            sessionValidationModule,
            sessionKeyData,
            treeProof
        );

        return
            _packValidationData(
                //_packValidationData expects true if sig validation has failed, false otherwise
                !ISessionValidationModule(sessionValidationModule)
                    .validateSessionUserOp(
                        userOp,
                        userOpHash,
                        sessionKeyData,
                        sessionKeySignature
                    ),
                validUntil,
                validAfter
            );
    }

    function getSessionKeys(
        address smartAccount
    ) external view returns (SessionStorage memory) {
        return _userSessions[smartAccount];
    }

    function validateSessionKey(
        address smartAccount,
        uint48 validUntil,
        uint48 validAfter,
        address sessionValidationModule,
        bytes memory sessionKeyData,
        TreeProof memory treeProof
    ) public virtual {
        require(
            treeProof.subtreeHashes.length == TREE_WIDTH,
            "SKM: invalid proof - 1"
        );
        require(
            treeProof.neighborHashes.length == TREE_WIDTH,
            "SKM: invalid proof - 2"
        );
        require(treeProof.subtreeIndex < TREE_WIDTH, "SKM: invalid proof - 3");
        require(treeProof.leafIndex < TREE_WIDTH, "SKM: invalid proof - 4");

        SessionStorage storage sessionKeyStorage = _getSessionData(
            smartAccount
        );

        bytes32 leaf = keccak256(
            abi.encodePacked(
                validUntil,
                validAfter,
                sessionValidationModule,
                sessionKeyData
            )
        );
        treeProof.neighborHashes[treeProof.leafIndex] = leaf;
        treeProof.subtreeHashes[treeProof.subtreeIndex] = keccak256(
            abi.encodePacked(treeProof.neighborHashes)
        );
        bytes32 computedTreeRoot = keccak256(
            abi.encodePacked(treeProof.subtreeHashes)
        );
        require(
            computedTreeRoot == sessionKeyStorage.treeRoot,
            "SKM: invalid proof - 5"
        );
    }

    function isValidSignature(
        bytes32 _dataHash,
        bytes memory _signature
    ) public pure returns (bytes4) {
        (_dataHash, _signature);
        return 0xffffffff; // do not support it here
    }

    /**
     * @dev returns the SessionStorage object for a given smartAccount
     * @param _account Smart Account address
     * @return sessionKeyStorage SessionStorage object at storage
     */
    function _getSessionData(
        address _account
    ) internal view returns (SessionStorage storage sessionKeyStorage) {
        sessionKeyStorage = _userSessions[_account];
    }
}
