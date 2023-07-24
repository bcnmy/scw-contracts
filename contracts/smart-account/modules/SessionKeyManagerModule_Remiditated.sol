// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {BaseAuthorizationModule, UserOperation, ISignatureValidator} from "./BaseAuthorizationModule.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@account-abstraction/contracts/core/Helpers.sol";
import "./SessionValidationModules/ISessionValidationModule.sol";

struct SessionStorage {
    bytes32 merkleRoot;
}

contract SessionKeyManager_remidiated is BaseAuthorizationModule {
    /**
     * @dev mapping of Smart Account to a SessionStorage
     * Info about session keys is stored as root of the merkle tree built over the session keys
     */
    mapping(address => SessionStorage) internal userSessions;

    /**
     * @dev returns the SessionStorage object for a given smartAccount
     * @param smartAccount Smart Account address
     */
    function getSessionKeys(
        address smartAccount
    ) external view returns (SessionStorage memory) {
        return userSessions[smartAccount];
    }

    /**
     * @dev sets the merkle root of a tree containing session keys for msg.sender
     * should be called by Smart Account
     * @param _merkleRoot Merkle Root of a tree that contains session keys with their permissions and parameters
     */
    function setMerkleRoot(bytes32 _merkleRoot) external {
        userSessions[msg.sender].merkleRoot = _merkleRoot;
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
        //        SessionStorage storage sessionKeyStorage = _getSessionData(msg.sender);
        (bytes memory moduleSignature, ) = abi.decode(
            userOp.signature,
            (bytes, address)
        );
        (
            uint48 validUntil,
            uint48 validAfter,
            address sessionValidationModule,
            bytes memory sessionKeyData,
            bytes32[] memory merkleProof,
            bytes memory sessionKeySignature
        ) = abi.decode(
                moduleSignature,
                (uint48, uint48, address, bytes, bytes32[], bytes)
            );

        bytes32 leaf = _genLeaf(
            userOp,
            validUntil,
            validAfter,
            sessionValidationModule
        );

        if (
            !MerkleProof.verify(
                merkleProof,
                _getSessionData(msg.sender).merkleRoot,
                leaf
            )
        ) {
            revert("SessionNotApproved");
        }
        return
            _packValidationData(
                //_packValidationData expects true if sig validation has failed, false otherwise
                !(ISessionValidationModule(sessionValidationModule)
                    .validateSessionUserOp(
                        userOp,
                        userOpHash,
                        sessionKeyData,
                        sessionKeySignature
                    ) &&
                    _verifySignature(
                        userOpHash,
                        sessionKeyData,
                        sessionKeySignature
                    )),
                validUntil,
                validAfter
            );
    }

    function _genLeaf(
        UserOperation calldata userOp,
        uint48 validUntil,
        uint48 validAfter,
        address sessionValidationModule
    ) internal view returns (bytes32) {
        (address _caller, bytes4 _selector) = _extract(userOp.callData);

        bytes32 leaf = keccak256(
            abi.encodePacked(
                validUntil,
                validAfter,
                sessionValidationModule,
                _extractSelector(userOp.callData), // Execute Call
                _caller, //
                _selector
            )
        );
        return leaf;
    }

    function _verifySignature(
        bytes32 _userOpHash,
        bytes memory _sessionKeyData,
        bytes memory _sessionKeySignature
    ) internal pure returns (bool) {
        bytes calldata sessionKeyData;
        sessionKeyData = sessionKeyData[0:20];
        address sessionKey = address(bytes20(sessionKeyData[0:20]));
        return
            ECDSA.recover(
                ECDSA.toEthSignedMessageHash(_userOpHash),
                _sessionKeySignature
            ) != sessionKey;
    }

    // Note :- extracting _caller and _selector from userOp.callData this function can be added into userOp library also
    function _extract(
        bytes calldata _calldata
    ) internal pure returns (address, bytes4) {
        bytes4 _selector;
        (address _caller, , bytes memory _data) = abi.decode(
            _calldata[4:], // skip selector
            (address, uint256, bytes)
        );
        _selector = _extractSelector(_data);
        return (_caller, _selector);
    }

    function _extractSelector(
        bytes memory _calldata
    ) internal pure returns (bytes4) {
        bytes4 _selector;
        if (_calldata.length >= 4) {
            assembly {
                // Load the first 4 bytes of 'data' into 'result'
                _selector := mload(add(_calldata, 32))
            }
        }
        return _selector;
    }

    /**
     * @dev isValidSignature according to BaseAuthorizationModule
     * @param _dataHash Hash of the data to be validated.
     * @param _signature Signature over the the _dataHash.
     * @return always returns 0xffffffff as signing messages is not supported by SessionKeys
     */
    function isValidSignature(
        bytes32 _dataHash,
        bytes memory _signature
    ) public view override returns (bytes4) {
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
        sessionKeyStorage = userSessions[_account];
    }
}
