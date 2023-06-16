// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {BaseAuthorizationModule, UserOperation, ISignatureValidator} from "./BaseAuthorizationModule.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@account-abstraction/contracts/core/Helpers.sol";
import "./SessionValidationModules/ISessionValidationModule.sol";

struct SessionKeyStorage {
    bytes32 merkleRoot;
}

contract SessionKeyManager is BaseAuthorizationModule {
    using ECDSA for bytes32;

    /*
     * @dev mapping of Smart Account to a SessionKeyStorage
     * Session Keys are stored as root of the merkle tree built over the session keys
     */
    mapping(address => SessionKeyStorage) internal sessionKeyMap;

    function getSessionKeys(
        address smartAccount
    ) external view returns (SessionKeyStorage memory) {
        return sessionKeyMap[smartAccount];
    }

    function setMerkleRoot(bytes32 _merkleRoot) external {
        _setSessionData(msg.sender, _merkleRoot);
    }

    /**
     * @dev validates userOperation
     * @param userOp User Operation to be validated.
     * @param userOpHash Hash of the User Operation to be validated.
     * @return sigValidationResult 0 if signature is valid, SIG_VALIDATION_FAILED otherwise.
     */
    function validateUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash
    ) external view virtual returns (uint256) {
        SessionKeyStorage storage sessionKeyStorage = _getSessionData(
            msg.sender
        );
        (bytes memory moduleSignature, ) = abi.decode(
            userOp.signature,
            (bytes, address)
        );
        (
            uint48 validUntil,
            uint48 validAfter,
            address module,
            bytes memory data,
            bytes32[] memory merkleProof,
            bytes memory signature
        ) = abi.decode(
                moduleSignature,
                (uint48, uint48, address, bytes, bytes32[], bytes)
            );

        bytes32 leaf = keccak256(
            abi.encodePacked(validUntil, validAfter, module, data)
        );
        require(
            MerkleProof.verify(merkleProof, sessionKeyStorage.merkleRoot, leaf),
            "invalid merkle root"
        );
        return
            _packValidationData(
                //_packValidationData expects true if sig validation has failed, false otherwise
                !ISessionValidationModule(module).validateSessionUserOp(
                    userOp,
                    userOpHash,
                    data,
                    signature
                ),
                validUntil,
                validAfter
            );
    }

    function isValidSignature(
        bytes32 _dataHash,
        bytes memory _signature
    ) public view override returns (bytes4) {
        return 0xffffffff; // do not support it here
    }

    function _setSessionData(address _account, bytes32 _merkleRoot) internal {
        sessionKeyMap[_account] = SessionKeyStorage({merkleRoot: _merkleRoot});
    }

    function _getSessionData(
        address _account
    ) internal view returns (SessionKeyStorage storage sessionKeyStorage) {
        sessionKeyStorage = sessionKeyMap[_account];
    }
}
