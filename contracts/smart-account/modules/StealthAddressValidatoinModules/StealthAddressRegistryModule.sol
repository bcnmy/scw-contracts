// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {BaseAuthorizationModule} from "../BaseAuthorizationModule.sol";
import {EIP1271_MAGIC_VALUE} from "contracts/smart-account/interfaces/ISignatureValidator.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {UserOperation} from "@account-abstraction/contracts/interfaces/UserOperation.sol";
import {StealthAggreagteSignature} from "./StealthAggreagteSignature.sol";

/**
 * @dev Storage structure for Stealth Address Registry Module.
 * StealthPubkey, dhkey are used in aggregated signature.
 * EphemeralPubkey is used to recover private key of stealth address.
 */
struct StealthStorage {
    uint256 stealthPubkey;
    uint256 dhkey;
    uint256 ephemeralPubkey;
    address stealthAddress;
    uint8 stealthPubkeyPrefix;
    uint8 dhkeyPrefix;
    uint8 ephemeralPrefix;
}

/**
 * @title Stealth Address Registry Module for Biconomy Modular Smart Accounts.
 * @dev Performs verifications for stealth address signed userOps.
 *         - It allows to validate user operations signed by Stealth Address private key,
 *           or by aggregated signature from Stealth Address owner and shared secret.
 *         - EIP-1271 compatible (ensures Smart Account can validate signed messages).
 *         - One stealth address owner per Smart Account.
 * @author Justin Zen - <justin@moonchute.xyz>
 */
contract StealthAddressRegistryModule is BaseAuthorizationModule {
    using ECDSA for bytes32;

    string public constant NAME = "Stealth Address Registry Module";
    string public constant VERSION = "0.1.0";
    mapping(address => StealthStorage) internal _smartAccountStealth;

    error AlreadyInitedForSmartAccount(address smartAccount);
    error ZeroAddressNotAllowedAsStealthAddress();

    /**
     * @dev Initializes the module for a Smart Account.
     * Should be used at a time of first enabling the module for a Smart Account.
     * @param stealthAddress The stealth address of the Smart Account.
     * @param stealthPubkey The compressed stealth pubkey of the Smart Account.
     * @param dhkey The compressed shared key of the Smart Account.
     * @param ephemeralPubkey The compressed ephemeral pubkey of the Smart Account.
     * @param stealthPubkeyPrefix The prefix of the stealth pubkey of the Smart Account.
     * @param dhkeyPrefix The prefix of the shared key of the Smart Account.
     * @param ephemeralPrefix The prefix of the ephemeral pubkey of the Smart Account.
     */
    function initForSmartAccount(
        address stealthAddress,
        uint256 stealthPubkey,
        uint256 dhkey,
        uint256 ephemeralPubkey,
        uint8 stealthPubkeyPrefix,
        uint8 dhkeyPrefix,
        uint8 ephemeralPrefix
    ) external returns (address) {
        if (_smartAccountStealth[msg.sender].stealthAddress != address(0)) {
            revert AlreadyInitedForSmartAccount(msg.sender);
        }
        if (stealthAddress == address(0))
            revert ZeroAddressNotAllowedAsStealthAddress();
        _smartAccountStealth[msg.sender] = StealthStorage(
            stealthPubkey,
            dhkey,
            ephemeralPubkey,
            stealthAddress,
            stealthPubkeyPrefix,
            dhkeyPrefix,
            ephemeralPrefix
        );
        return address(this);
    }

    /**
     * @dev Validates userOperation
     * @param userOp User Operation to be validated.
     * @param userOpHash Hash of the User Operation to be validated.
     * @return validationData 0 if signature is valid, SIG_VALIDATION_FAILED otherwise.
     */
    function validateUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash
    ) external view virtual returns (uint256 validationData) {
        (bytes memory cleanSignature, ) = abi.decode(
            userOp.signature,
            (bytes, address)
        );
        bytes1 mode = cleanSignature[0];
        assembly {
            let len := mload(cleanSignature)
            mstore(add(cleanSignature, 0x01), sub(len, 1))
            cleanSignature := add(cleanSignature, 0x01)
        }

        // 0x00: signature from spending key
        // 0x01: aggregated signature from owner and shared secret
        if (mode == 0x00) {
            if (_verifySignature(userOpHash, cleanSignature, userOp.sender)) {
                return 0;
            }
            return SIG_VALIDATION_FAILED;
        } else if (mode == 0x01) {
            if (
                _verifyAggregateSignature(
                    userOpHash,
                    cleanSignature,
                    userOp.sender
                )
            ) return 0;
        }
        return SIG_VALIDATION_FAILED;
    }

    /**
     * @dev Returns the parameter of the Smart Account.
     * @param smartAccount The address of the Smart Account.
     * @return stealthStorage The parameter of the Smart Account.
     */
    function getStealthAddress(
        address smartAccount
    ) external view returns (StealthStorage memory) {
        return _smartAccountStealth[smartAccount];
    }

    /**
     * @dev Returns the the magic value of EIP-1271.
     * @param dataHash The hash of the data signed.
     * @param moduleSignature The signature of the data.
     * @return magicValue The magic value.
     */
    function isValidSignature(
        bytes32 dataHash,
        bytes memory moduleSignature
    ) public view virtual override returns (bytes4) {
        bytes1 mode = moduleSignature[0];
        assembly {
            let len := mload(moduleSignature)
            mstore(add(moduleSignature, 0x01), sub(len, 1))
            moduleSignature := add(moduleSignature, 0x01)
        }

        // 0x00: signature from spending key
        // 0x01: aggregated signature from owner and shared secret
        if (mode == 0x00) {
            if (_verifySignature(dataHash, moduleSignature, msg.sender)) {
                return EIP1271_MAGIC_VALUE;
            }
            return bytes4(0xffffffff);
        } else if (mode == 0x01) {
            if (
                _verifyAggregateSignature(dataHash, moduleSignature, msg.sender)
            ) {
                return EIP1271_MAGIC_VALUE;
            }
            return bytes4(0xffffffff);
        }
        return bytes4(0xffffffff);
    }

    /**
     * @dev Returns the the magic value of EIP-1271.
     * @param dataHash The hash of the data signed.
     * @param moduleSignature The signature of the data.
     * @return magicValue The magic value.
     */
    function isValidSignatureUnsafe(
        bytes32 dataHash,
        bytes memory moduleSignature
    ) public view virtual override returns (bytes4) {
        bytes1 mode = moduleSignature[0];
        assembly {
            let len := mload(moduleSignature)
            mstore(add(moduleSignature, 0x01), sub(len, 1))
            moduleSignature := add(moduleSignature, 0x01)
        }

        // 0x00: signature from spending key
        // 0x01: aggregated signature from owner and shared secret
        if (mode == 0x00) {
            if (_verifySignature(dataHash, moduleSignature, msg.sender)) {
                return EIP1271_MAGIC_VALUE;
            }
            return bytes4(0xffffffff);
        } else if (mode == 0x01) {
            if (
                _verifyAggregateSignature(dataHash, moduleSignature, msg.sender)
            ) {
                return EIP1271_MAGIC_VALUE;
            }
            return bytes4(0xffffffff);
        }
        return bytes4(0xffffffff);
    }

    /**
     * @dev Validates a signature for a message signed by address.
     * @param dataHash Hash of the data.
     * @param signature Signature to be validated.
     * @param smartAccount Smart Account address.
     * @return isValid if signature is valid, false otherwise.
     */
    function _verifySignature(
        bytes32 dataHash,
        bytes memory signature,
        address smartAccount
    ) public view returns (bool) {
        address stealthAddress = _smartAccountStealth[smartAccount]
            .stealthAddress;
        bytes32 hash = ECDSA.toEthSignedMessageHash(dataHash);
        if (stealthAddress == dataHash.recover(signature)) {
            return true;
        }
        if (stealthAddress != hash.recover(signature)) {
            return false;
        }
        return true;
    }

    /**
     * @dev Validates a aggregated signature for a message signed by address.
     * @param dataHash Hash of the data.
     * @param signature Signature to be validated.
     * @param smartAccount Smart Account address.
     * @return isValid if signature is valid, false otherwise.
     */
    function _verifyAggregateSignature(
        bytes32 dataHash,
        bytes memory signature,
        address smartAccount
    ) public view returns (bool) {
        StealthStorage storage stealthData = _smartAccountStealth[smartAccount];
        bytes32 hash = ECDSA.toEthSignedMessageHash(dataHash);
        bool isValidSig = StealthAggreagteSignature.validateAggregatedSignature(
            stealthData.stealthPubkey,
            stealthData.dhkey,
            stealthData.stealthPubkeyPrefix,
            stealthData.dhkeyPrefix,
            dataHash,
            signature
        );
        if (isValidSig) return true;

        return
            StealthAggreagteSignature.validateAggregatedSignature(
                stealthData.stealthPubkey,
                stealthData.dhkey,
                stealthData.stealthPubkeyPrefix,
                stealthData.dhkeyPrefix,
                hash,
                signature
            );
    }
}
