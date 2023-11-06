// SPDX-License-Identifier: MIT
pragma solidity >=0.8.17;

import {BaseAuthorizationModule} from "./BaseAuthorizationModule.sol";
import {UserOperation} from "@account-abstraction/contracts/interfaces/UserOperation.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Secp256r1, PassKeyId} from "./PasskeyValidationModules/Secp256r1.sol";
import {EIP1271_MAGIC_VALUE} from "contracts/smart-account/interfaces/ISignatureValidator.sol";
import {IPasskeyRegistryModule} from "../interfaces/modules/IPasskeyRegistryModule.sol";
import {ISignatureValidator} from "../interfaces/ISignatureValidator.sol";
import {IAuthorizationModule} from "../interfaces/IAuthorizationModule.sol";

/**
 * @title Passkey ownership Authorization module for Biconomy Smart Accounts.
 * @dev Compatible with Biconomy Modular Interface v 0.2
 *         - It allows to validate user operations signed by passkeys.
 *         - One owner per Smart Account.
 *         For Smart Contract Owners check SmartContractOwnership module instead
 * @author Aman Raj - <aman.raj@biconomy.io>
 */
contract PasskeyRegistryModule is
    BaseAuthorizationModule,
    IPasskeyRegistryModule
{
    string public constant NAME = "PassKeys Ownership Registry Module";
    string public constant VERSION = "0.2.0";

    mapping(address => PassKeyId) public smartAccountPassKeys;

    /// @inheritdoc IPasskeyRegistryModule
    function initForSmartAccount(
        uint256 _pubKeyX,
        uint256 _pubKeyY,
        string calldata _keyId
    ) external override returns (address) {
        PassKeyId storage passKeyId = smartAccountPassKeys[msg.sender];

        if (passKeyId.pubKeyX != 0 && passKeyId.pubKeyY != 0)
            revert AlreadyInitedForSmartAccount(msg.sender);

        smartAccountPassKeys[msg.sender] = PassKeyId(
            _pubKeyX,
            _pubKeyY,
            _keyId
        );

        return address(this);
    }

    /// @inheritdoc IAuthorizationModule
    function validateUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash
    ) external view virtual returns (uint256) {
        return _validateSignature(userOp, userOpHash);
    }

    /// @inheritdoc ISignatureValidator
    function isValidSignature(
        bytes32 signedDataHash,
        bytes memory moduleSignature
    ) public view virtual override returns (bytes4) {
        // TODO: @amanraj1608 make it safe
        return isValidSignatureForAddress(signedDataHash, moduleSignature);
    }

    /// @inheritdoc ISignatureValidator
    function isValidSignatureUnsafe(
        bytes32 signedDataHash,
        bytes memory moduleSignature
    ) public view virtual override returns (bytes4) {
        return isValidSignatureForAddress(signedDataHash, moduleSignature);
    }

    /// @inheritdoc IPasskeyRegistryModule
    function isValidSignatureForAddress(
        bytes32 signedDataHash,
        bytes memory moduleSignature
    ) public view virtual override returns (bytes4) {
        if (_verifySignature(signedDataHash, moduleSignature)) {
            return EIP1271_MAGIC_VALUE;
        }
        return bytes4(0xffffffff);
    }

    /**
     * @dev Internal utility function to verify a signature.
     * @param userOpDataHash The hash of the user operation data.
     * @param moduleSignature The signature provided by the module.
     * @return True if the signature is valid, false otherwise.
     */
    function _verifySignature(
        bytes32 userOpDataHash,
        bytes memory moduleSignature
    ) internal view returns (bool) {
        (
            bytes32 keyHash,
            uint256 sigx,
            uint256 sigy,
            bytes memory authenticatorData,
            string memory clientDataJSONPre,
            string memory clientDataJSONPost
        ) = abi.decode(
                moduleSignature,
                (bytes32, uint256, uint256, bytes, string, string)
            );
        (keyHash);
        string memory opHashBase64 = Base64.encode(
            bytes.concat(userOpDataHash)
        );
        string memory clientDataJSON = string.concat(
            clientDataJSONPre,
            opHashBase64,
            clientDataJSONPost
        );
        bytes32 clientHash = sha256(bytes(clientDataJSON));
        bytes32 sigHash = sha256(bytes.concat(authenticatorData, clientHash));

        PassKeyId memory passKey = smartAccountPassKeys[msg.sender];
        if (passKey.pubKeyX == 0 && passKey.pubKeyY == 0) {
            revert NoPassKeyRegisteredForSmartAccount(msg.sender);
        }
        return Secp256r1.verify(passKey, sigx, sigy, uint256(sigHash));
    }

    /**
     * @dev Internal function to validate a user operation signature.
     * @param userOp The user operation to validate.
     * @param userOpHash The hash of the user operation.
     * @return sigValidationResult Returns 0 if the signature is valid, and SIG_VALIDATION_FAILED otherwise.
     */
    function _validateSignature(
        UserOperation calldata userOp,
        bytes32 userOpHash
    ) internal view virtual returns (uint256 sigValidationResult) {
        if (_verifySignature(userOpHash, userOp.signature)) {
            return 0;
        }
        return SIG_VALIDATION_FAILED;
    }
}
