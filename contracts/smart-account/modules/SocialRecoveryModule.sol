// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {BaseAuthorizationModule, UserOperation} from "./BaseAuthorizationModule.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title Social Recovery module for Biconomy Smart Accounts.
 * @dev Compatible with Biconomy Modular Interface v 0.1
 *         - It allows to _______________
 *         - ECDSA guardians only
 *
 * @author Fil Makarov - <filipp.makarov@biconomy.io>
 */

contract SocialRecoveryModule is BaseAuthorizationModule {
    string public constant NAME = "Social Recovery Module";
    string public constant VERSION = "0.1.0";

    // TODO
    // EVENTS

    error ThresholdNotSetForSmartAccount(address smartAccount);
    error InvalidSignaturesLength();
    error NotUniqueGuardianOrInvalidOrder(
        address lastGuardian,
        address currentGuardian
    );
    error ZeroAddressNotAllowedAsGuardian();
    error InvalidTimeFrame(uint48 validUntil, uint48 validAfter);
    error ExpiredValidUntil(uint48 validUntil);
    error GuardianAlreadySet(address guardian, address smartAccount);

    using ECDSA for bytes32;

    struct timeFrame {
        uint48 validUntil;
        uint48 validAfter;
    }

    struct settings {
        uint48 recoveryThreshold;
        uint48 securityDelay;
    }

    // guardian => (smartAccount => timeFrame)
    mapping(address => mapping(address => timeFrame)) internal _guardians;

    mapping(address => settings) internal _smartAccountSettings;

    /**
     * @dev Initializes the module for a Smart Account.
     * Should be used at a time of first enabling the module for a Smart Account.
     */
    function initForSmartAccount() external returns (address) {
        // TODO make initiation of the module for a Smart Account

        // set guardians and set threshold and delay

        return address(this);
    }

    // NOTE - if both validUntil and validAfter provided for setup are 0, guardian is considered active forever
    // Thus we put type(uint48).max as value for validUntil in this case, so the calldata itself doesn't need to contain this big value and thus
    // txn is cheaper
    function addGuardian(
        address guardian,
        uint48 validUntil,
        uint48 validAfter
    ) external {
        if (guardian == address(0)) revert ZeroAddressNotAllowedAsGuardian();
        if (validUntil < validAfter)
            revert InvalidTimeFrame(validUntil, validAfter);
        if (validUntil < block.timestamp) revert ExpiredValidUntil(validUntil);
        if (_guardians[guardian][msg.sender].validUntil != 0)
            revert GuardianAlreadySet(guardian, msg.sender);
        // make a test case that it fails if validAfter + securityDelay together overflow uint48
        _guardians[guardian][msg.sender] = timeFrame(
            validUntil == 0 ? type(uint48).max : validUntil,
            validAfter + _smartAccountSettings[msg.sender].securityDelay
        );
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
        uint256 requiredSignatures = _smartAccountSettings[userOp.sender]
            .recoveryThreshold;
        if (requiredSignatures == 0)
            revert ThresholdNotSetForSmartAccount(userOp.sender);
        (bytes memory signatures, ) = abi.decode(
            userOp.signature,
            (bytes, address)
        );
        if (signatures.length < requiredSignatures * 65)
            revert InvalidSignaturesLength();

        address lastGuardian;
        address currentGuardian;
        uint128 validAfter;
        uint128 validUntil;
        uint128 latestValidAfter;
        uint128 earliestValidUntil = type(uint48).max;

        for (uint256 i; i < requiredSignatures; ) {
            currentGuardian = (userOpHash.toEthSignedMessageHash()).recover(
                // get the current signature
                // getCurrentSignature(userOp.signature, i)
                // or getCurrentSignature(signatures, i)  and use assembly
                userOp.signature[i * 65:(i + 1) * 65]
            );

            validAfter = _guardians[currentGuardian][userOp.sender].validAfter;
            validUntil = _guardians[currentGuardian][userOp.sender].validUntil;

            // 0,0 means the `currentGuardian` has not been set as guardian for the userOp.sender smartAccount
            if (validUntil == 0 && validAfter == 0) {
                return SIG_VALIDATION_FAILED;
            }

            // gas efficient way to ensure all guardians are unique
            // requires from dapp to sort signatures before packing them into bytes
            if (currentGuardian <= lastGuardian)
                revert NotUniqueGuardianOrInvalidOrder(
                    lastGuardian,
                    currentGuardian
                );

            if (validUntil < earliestValidUntil) {
                earliestValidUntil = validUntil;
            }
            if (validAfter > latestValidAfter) {
                latestValidAfter = validAfter;
            }
            lastGuardian = currentGuardian;

            unchecked {
                ++i;
            }
        }

        return
            VALIDATION_SUCCESS |
            (uint256(validUntil) << 160) |
            (uint256(validAfter) << (160 + 48));
    }

    /**
     * @dev Validates a signature for a message.
     * To be called from a Smart Account.
     * @param dataHash Exact hash of the data that was signed.
     * @param moduleSignature Signature to be validated.
     * @return EIP1271_MAGIC_VALUE if signature is valid, 0xffffffff otherwise.
     */
    function isValidSignature(
        bytes32 dataHash,
        bytes memory moduleSignature
    ) public view virtual override returns (bytes4) {
        return 0xffffffff; // not supported
    }
}
