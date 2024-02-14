// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

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
    string public constant VERSION = "1.1.0";

    mapping(address => PassKeyId) public smartAccountPasskey;

    /// @inheritdoc IPasskeyRegistryModule
    function initForSmartAccount(
        uint256 _pubKeyX,
        uint256 _pubKeyY,
        string calldata _keyId
    ) external override returns (address) {
        PassKeyId storage passKeyId = smartAccountPasskey[msg.sender];

        if (passKeyId.pubKeyX != 0 && passKeyId.pubKeyY != 0)
            revert AlreadyInitedForSmartAccount(msg.sender);

        smartAccountPasskey[msg.sender] = PassKeyId(_pubKeyX, _pubKeyY, _keyId);

        return address(this);
    }

    /**
     * @dev Returns the owner of the Smart Account.
     * @param smartAccount Smart Account address.
     * @return PassKeyId The owner key of the Smart Account.
     */
    function getOwner(
        address smartAccount
    ) external view returns (PassKeyId memory) {
        return smartAccountPasskey[smartAccount];
    }

    /// @inheritdoc IAuthorizationModule
    function validateUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash
    ) external view virtual returns (uint256) {
        (bytes memory passkeySignature, ) = abi.decode(
            userOp.signature,
            (bytes, address)
        );
        if (_verifySignature(userOpHash, passkeySignature, userOp.sender)) {
            return VALIDATION_SUCCESS;
        }
        return SIG_VALIDATION_FAILED;
    }

    /**
     * @inheritdoc ISignatureValidator
     * @dev Validates a signature for a message.
     * @dev Appends smart account address to the hash to avoid replay attacks
     * To be called from a Smart Account.
     * @param signedDataHash Hash of the message that was signed.
     * @param moduleSignature Signature to be validated.
     * @return EIP1271_MAGIC_VALUE if signature is valid, 0xffffffff otherwise.
     */
    function isValidSignature(
        bytes32 signedDataHash,
        bytes memory moduleSignature
    ) public view virtual override returns (bytes4) {
        return
            isValidSignatureForAddress(
                signedDataHash,
                moduleSignature,
                msg.sender
            );
    }

    /// @inheritdoc IPasskeyRegistryModule
    function isValidSignatureForAddress(
        bytes32 signedDataHash,
        bytes memory moduleSignature,
        address smartAccount
    ) public view virtual returns (bytes4) {
        if (
            _verifySignature(
                keccak256(
                    abi.encodePacked(
                        "\x19Ethereum Signed Message:\n52",
                        signedDataHash,
                        smartAccount
                    )
                ),
                moduleSignature,
                smartAccount
            )
        ) {
            return EIP1271_MAGIC_VALUE;
        }
        return bytes4(0xffffffff);
    }

    /// @inheritdoc ISignatureValidator
    function isValidSignatureUnsafe(
        bytes32 signedDataHash,
        bytes memory moduleSignature
    ) public view virtual returns (bytes4) {
        return
            isValidSignatureForAddress(
                signedDataHash,
                moduleSignature,
                msg.sender
            );
    }

    /**
     * @dev Internal utility function to verify a signature.
     * @param userOpDataHash The hash of the user operation data.
     * @param moduleSignature The signature provided by the module.
     * @param smartAccount The smart account address.
     * @return True if the signature is valid, false otherwise.
     */
    function _verifySignature(
        bytes32 userOpDataHash,
        bytes memory moduleSignature,
        address smartAccount
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

        PassKeyId memory passKey = smartAccountPasskey[smartAccount];
        if (passKey.pubKeyX == 0 && passKey.pubKeyY == 0) {
            revert NoPassKeyRegisteredForSmartAccount(smartAccount);
        }
        return Secp256r1.verify(passKey, sigx, sigy, uint256(sigHash));
    }
}
