// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {BaseAuthorizationModule} from "./BaseAuthorizationModule.sol";
import {UserOperation} from "@account-abstraction/contracts/interfaces/UserOperation.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import "hardhat/console.sol";

/**
 * @title Account Recovery module for Biconomy Smart Accounts.
 * @dev Compatible with Biconomy Modular Interface v 0.1
 *         - It allows to _______________
 *         - ECDSA guardians only
 *         - For security reasons guardian address is not stored,
 *           instead its signature over CONTROL_HASH is used as
 *
 *
 * @author Fil Makarov - <filipp.makarov@biconomy.io>
 * based on https://vitalik.ca/general/2021/01/11/recovery.html by Vitalik Buterin
 */

contract AccountRecoveryModule is BaseAuthorizationModule {
    using ECDSA for bytes32;

    struct TimeFrame {
        uint48 validUntil;
        uint48 validAfter;
    }

    struct SaSettings {
        uint8 guardiansCount;
        uint8 recoveryThreshold;
        uint48 securityDelay;
    }

    struct RecoveryRequest {
        bytes32 callDataHash;
        uint48 requestTimestamp;
    }

    string public constant NAME = "Account Recovery Module";
    string public constant VERSION = "0.1.0";

    bytes32 public constant CONTROL_HASH =
        keccak256(abi.encodePacked("ACCOUNT RECOVERY GUARDIAN SECURE MESSAGE"));

    // guardianID => (smartAccount => TimeFrame)
    // guardianID = keccak256(signature over CONTROL_HASH)
    // complies with associated storage rules
    // see https://eips.ethereum.org/EIPS/eip-4337#storage-associated-with-an-address
    // see https://docs.soliditylang.org/en/v0.8.15/internals/layout_in_storage.html#mappings-and-dynamic-arrays
    mapping(bytes32 => mapping(address => TimeFrame)) internal _guardians;

    mapping(address => SaSettings) internal _smartAccountSettings;

    mapping(address => RecoveryRequest) internal _smartAccountRequests;

    // TODO
    // EVENTS
    event RecoveryRequestSubmitted(
        address indexed smartAccount,
        bytes indexed requestCallData
    );
    event RecoveryRequestRenounced(address indexed smartAccount);
    event GuardianAdded(
        address indexed smartAccount,
        bytes32 guardian,
        TimeFrame timeFrame
    );
    event GuardianRemoved(address indexed smartAccount, bytes32 guardian);
    event GuardianChanged(
        address indexed smartAccount,
        bytes32 guardian,
        TimeFrame timeFrame
    );
    event ThresholdChanged(address indexed smartAccount, uint8 threshold);

    error AlreadyInitedForSmartAccount(address smartAccount);
    error ThresholdNotSetForSmartAccount(address smartAccount);
    error InvalidSignaturesLength();
    error NotUniqueGuardianOrInvalidOrder(
        address lastGuardian,
        address currentGuardian
    );

    error ZeroGuardian();
    error InvalidTimeFrame(uint48 validUntil, uint48 validAfter);
    error ExpiredValidUntil(uint48 validUntil);
    error GuardianAlreadySet(bytes32 guardian, address smartAccount);

    error ThresholdTooHigh(uint8 threshold, uint256 guardiansExist);
    error ZeroThreshold();
    error InvalidAmountOfGuardianParams();
    error GuardiansAreIdentical();
    error LastGuardianRemovalAttempt(bytes32 lastGuardian);

    error EmptyRecoveryCallData();
    error RecoveryRequestAlreadyExists(
        address smartAccount,
        bytes32 requestCallDataHash
    );

    /**
     * @dev Initializes the module for a Smart Account.
     * Can only be used at a time of first enabling the module for a Smart Account.
     * @param guardians the list of guardians
     * @param timeFrames validity timeframes for guardians
     * @param recoveryThreshold how many guardians' signatures are required to authorize recovery request
     * @param securityDelay amount of time required to pass between the submission of the recovery request
     * and its execution
     * @dev no need for explicit check `length == 0` as it is covered by `recoveryThreshold > length` and
     * `recoveryThreshold == 0` cheks. So length can never be 0 while recoveryThreshold is not 0
     */
    function initForSmartAccount(
        bytes32[] memory guardians,
        TimeFrame[] memory timeFrames,
        uint8 recoveryThreshold,
        uint48 securityDelay
    ) external returns (address) {
        uint256 length = guardians.length;
        if (_smartAccountSettings[msg.sender].guardiansCount > 0)
            revert AlreadyInitedForSmartAccount(msg.sender);
        if (recoveryThreshold > length)
            revert ThresholdTooHigh(recoveryThreshold, length);
        if (recoveryThreshold == 0) revert ZeroThreshold();
        if (length != timeFrames.length) revert InvalidAmountOfGuardianParams();
        _smartAccountSettings[msg.sender] = SaSettings(
            uint8(length),
            recoveryThreshold,
            securityDelay
        );
        for (uint256 i; i < length; ) {
            if (guardians[i] == bytes32(0)) revert ZeroGuardian();
            if (timeFrames[i].validUntil == 0)
                timeFrames[i].validUntil = type(uint48).max;
            if (timeFrames[i].validUntil < timeFrames[i].validAfter)
                revert InvalidTimeFrame(
                    timeFrames[i].validUntil,
                    timeFrames[i].validAfter
                );
            if (
                timeFrames[i].validUntil != 0 &&
                timeFrames[i].validUntil < block.timestamp
            ) revert ExpiredValidUntil(timeFrames[i].validUntil);

            _guardians[guardians[i]][msg.sender] = timeFrames[i];
            emit GuardianAdded(msg.sender, guardians[i], timeFrames[i]);
            unchecked {
                ++i;
            }
        }
        return address(this);
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
    ) external virtual returns (uint256) {
        // if there is already a request added for this userOp.callData, return validation success
        // to procced with executing the request
        // with validAfter set to the timestamp of the request + securityDelay
        // so that the request execution userOp can be validated only after the delay
        if (
            keccak256(userOp.callData) ==
            _smartAccountRequests[msg.sender].callDataHash
        ) {
            uint48 reqValidAfter = _smartAccountRequests[msg.sender]
                .requestTimestamp +
                _smartAccountSettings[msg.sender].securityDelay;
            delete _smartAccountRequests[msg.sender];
            return
                VALIDATION_SUCCESS |
                (0 << 160) | // validUntil = 0 is converted to max uint48 in EntryPoint
                (uint256(reqValidAfter) << (160 + 48));
        }

        // otherwise we need to check all the signatures first
        uint256 requiredSignatures = _smartAccountSettings[userOp.sender]
            .recoveryThreshold;
        if (requiredSignatures == 0)
            revert("AccRecovery: Threshold not set");

        (bytes memory signatures, ) = abi.decode(
            userOp.signature,
            (bytes, address)
        );
        require(signatures.length >= requiredSignatures * 2 * 65, "AccRecovery: Invalid Sigs Length");

        address lastGuardianAddress;
        address currentGuardianAddress;
        bytes memory currentGuardianSig;
        uint48 validAfter;
        uint48 validUntil;
        uint48 latestValidAfter;
        uint48 earliestValidUntil = type(uint48).max;

        for (uint256 i; i < requiredSignatures; ) {
            address currentUserOpSignerAddress = userOpHash
                .toEthSignedMessageHash()
                .recover(
                    userOp.signature[96 + 2 * i * 65:96 + (2 * i + 1) * 65]
                );

            currentGuardianSig = userOp.signature[96 + (2 * i + 1) * 65:96 +
                (2 * i + 2) *
                65];

            currentGuardianAddress = CONTROL_HASH
                .toEthSignedMessageHash()
                .recover(currentGuardianSig);

            if (currentUserOpSignerAddress != currentGuardianAddress) {
                return SIG_VALIDATION_FAILED;
            }

            validAfter = _guardians[keccak256(currentGuardianSig)][
                userOp.sender
            ].validAfter;
            validUntil = _guardians[keccak256(currentGuardianSig)][
                userOp.sender
            ].validUntil;

            // 0,0 means the `currentGuardian` has not been set as guardian for the userOp.sender smartAccount
            if (validUntil == 0 && validAfter == 0) {
                return SIG_VALIDATION_FAILED;
            }

            // gas efficient way to ensure all guardians are unique
            // requires from dapp to sort signatures before packing them into bytes
            if (currentGuardianAddress <= lastGuardianAddress)
                revert NotUniqueGuardianOrInvalidOrder(
                    lastGuardianAddress,
                    currentGuardianAddress
                );

            // detect the common validity window for all the guardians
            // if at least one guardian is not valid yet or expired
            // the whole userOp will be invalidated at the EntryPoint
            if (validUntil < earliestValidUntil) {
                earliestValidUntil = validUntil;
            }
            if (validAfter > latestValidAfter) {
                latestValidAfter = validAfter;
            }
            lastGuardianAddress = currentGuardianAddress;

            unchecked {
                ++i;
            }
        }

        // if all the signatures are ok, we need to check if it is a new recovery request
        // anything except adding a new request to this module is allowed only if securityDelay is 0
        // which means user explicitly allowed to execute an operation immediately
        // userOp.callData expected to be the calldata of the default execution function
        // in this case execute(address dest, uint256 value, bytes calldata data);
        // where `data` is the submitRecoveryRequest() method calldata
        (address dest, uint256 callValue, bytes memory innerCallData) = abi
            .decode(
                userOp.callData[4:], // skip selector
                (address, uint256, bytes)
            );
        bytes4 innerSelector;
        assembly {
            innerSelector := mload(add(innerCallData, 0x20))
        }
        bool isValidAddingRequestUserOp = (innerSelector ==
            this.submitRecoveryRequest.selector) &&
            (dest == address(this)) &&
            callValue == 0;
        if (
            isValidAddingRequestUserOp != //this a userOp to submit Recovery Request
            (_smartAccountSettings[msg.sender].securityDelay == 0) //securityDelay is 0,
        ) {
            return
                VALIDATION_SUCCESS | //consider this userOp valid within the timeframe
                (uint256(earliestValidUntil) << 160) |
                (uint256(latestValidAfter) << (160 + 48));
        } else {
            // a) if both conditions are true, it makes no sense, as with the 0 delay, there's no need to submit a
            // request, as request can be immediately executed in the execution phase of userOp handling
            // b) if non of the conditions are met, this means userOp is not for submitting a new request which is
            // only allowed with when the securityDelay is non 0
            // not using custom error here because of how EntryPoint handles the revert data for the validation failure
            revert("AccRecovery: Wrong userOp");
        }
    }

    // NOTE - if validUntil is 0, guardian is considered active forever
    // Thus we put type(uint48).max as value for validUntil in this case,
    // so the calldata itself doesn't need to contain this big value and thus
    // txn is cheaper
    // we need to explicitly change 0 to type(uint48).max, so the algorithm of intersecting
    // validUntil's and validAfter's for several guardians works correctly
    // @note if validAfter is less then now + securityDelay, it is set to now + securityDelay
    // as for security reasons new guardian is only active after securityDelay

    function addGuardian(
        bytes32 guardian,
        uint48 validUntil,
        uint48 validAfter
    ) external {
        if (guardian == bytes32(0)) revert ZeroGuardian();
        if (_guardians[guardian][msg.sender].validUntil != 0)
            revert GuardianAlreadySet(guardian, msg.sender);

        if (validUntil == 0) validUntil = type(uint48).max;
        uint48 minimalSecureValidAfter = uint48(
            block.timestamp + _smartAccountSettings[msg.sender].securityDelay
        );
        validAfter = validAfter < minimalSecureValidAfter
            ? minimalSecureValidAfter
            : validAfter;
        if (validUntil < validAfter)
            revert InvalidTimeFrame(validUntil, validAfter);
        if (validUntil < block.timestamp) revert ExpiredValidUntil(validUntil);

        // TODO:
        // make a test case that it fails if validAfter + securityDelay together overflow uint48
        _guardians[guardian][msg.sender] = TimeFrame(validUntil, validAfter);
        ++_smartAccountSettings[msg.sender].guardiansCount;
        emit GuardianAdded(
            msg.sender,
            guardian,
            TimeFrame(validUntil, validAfter)
        );
    }

    // natspec
    // same as adding guardian, but also makes the old one active only until the new one is active
    function replaceGuardian(
        bytes32 guardian,
        bytes32 newGuardian,
        uint48 validUntil,
        uint48 validAfter
    ) external {
        if (guardian == newGuardian) revert GuardiansAreIdentical();
        if (guardian == bytes32(0)) revert ZeroGuardian();
        if (newGuardian == bytes32(0)) revert ZeroGuardian();

        if (validUntil == 0) validUntil = type(uint48).max;
        uint48 minimalSecureValidAfter = uint48(
            block.timestamp + _smartAccountSettings[msg.sender].securityDelay
        );
        validAfter = validAfter < minimalSecureValidAfter
            ? minimalSecureValidAfter
            : validAfter;
        if (validUntil < validAfter)
            revert InvalidTimeFrame(validUntil, validAfter);
        if (validUntil < block.timestamp) revert ExpiredValidUntil(validUntil);

        // make the new one valid
        _guardians[newGuardian][msg.sender] = TimeFrame(
            validUntil == 0 ? type(uint48).max : validUntil,
            validAfter
        );
        ++_smartAccountSettings[msg.sender].guardiansCount;
        emit GuardianAdded(
            msg.sender,
            newGuardian,
            TimeFrame(
                validUntil == 0 ? type(uint48).max : validUntil,
                validAfter
            )
        );

        // make the previous stay valid until the new one becomes valid
        // if the new one becomes valid earlier, than old one validUntil, change the validUntil for the old one
        // to the validAfter of the new one. So two are never valid at the same time
        uint48 oldGuardianValidUntil = _guardians[guardian][msg.sender]
            .validUntil;
        _guardians[guardian][msg.sender].validUntil = (oldGuardianValidUntil <
            validAfter)
            ? oldGuardianValidUntil
            : validAfter;
    }

    // natspec
    function removeGuardian(bytes32 guardian) external {
        delete _guardians[guardian][msg.sender];
        --_smartAccountSettings[msg.sender].guardiansCount;
        if (_smartAccountSettings[msg.sender].guardiansCount == 0)
            revert LastGuardianRemovalAttempt(guardian);
        emit GuardianRemoved(msg.sender, guardian);
        // if number of guardians became less than threshold, lower the threshold
        if (
            _smartAccountSettings[msg.sender].guardiansCount <
            _smartAccountSettings[msg.sender].recoveryThreshold
        ) {
            _smartAccountSettings[msg.sender].recoveryThreshold--;
            emit ThresholdChanged(
                msg.sender,
                _smartAccountSettings[msg.sender].recoveryThreshold
            );
        }
    }

    // DISABLE ACCOUNT RECOVERY
    // Requires to explicitly list all the guardians to delete them

    // change timeframe
    function changeGuardianParams(
        bytes32 guardian,
        TimeFrame memory newTimeFrame
    ) external {
        if (newTimeFrame.validUntil == 0)
            newTimeFrame.validUntil = type(uint48).max;
        if (newTimeFrame.validUntil < newTimeFrame.validAfter)
            revert InvalidTimeFrame(
                newTimeFrame.validUntil,
                newTimeFrame.validAfter
            );
        if (
            newTimeFrame.validUntil != 0 &&
            newTimeFrame.validUntil < block.timestamp
        ) revert ExpiredValidUntil(newTimeFrame.validUntil);
        _guardians[guardian][msg.sender] = newTimeFrame;
        emit GuardianChanged(msg.sender, guardian, newTimeFrame);
    }

    // set the threshold
    function setThreshold(uint8 newThreshold) external {
        if (newThreshold == 0) revert ZeroThreshold();
        if (newThreshold > _smartAccountSettings[msg.sender].guardiansCount)
            revert ThresholdTooHigh(
                newThreshold,
                _smartAccountSettings[msg.sender].guardiansCount
            );
        _smartAccountSettings[msg.sender].recoveryThreshold = newThreshold;
    }

    function setSecurityDelay(uint48 newSecurityDelay) external {
        _smartAccountSettings[msg.sender].securityDelay = newSecurityDelay;
    }

    function getGuardianParams(
        bytes32 guardian,
        address smartAccount
    ) external view returns (TimeFrame memory) {
        return _guardians[guardian][smartAccount];
    }

    function getSmartAccountSettings(
        address smartAccount
    ) external view returns (SaSettings memory) {
        return _smartAccountSettings[smartAccount];
    }

    function getRecoveryRequest(
        address smartAccount
    ) external view returns (RecoveryRequest memory) {
        return _smartAccountRequests[smartAccount];
    }

    // recoveryCallData is something like execute(module, 0, encode(transferOwnership(newOwner)))
    function submitRecoveryRequest(bytes calldata recoveryCallData) public {
        if (recoveryCallData.length == 0) revert EmptyRecoveryCallData();
        if (
            _smartAccountRequests[msg.sender].callDataHash ==
            keccak256(recoveryCallData)
        )
            revert RecoveryRequestAlreadyExists(
                msg.sender,
                keccak256(recoveryCallData)
            );

        _smartAccountRequests[msg.sender] = RecoveryRequest(
            keccak256(recoveryCallData),
            uint48(block.timestamp)
        );
        emit RecoveryRequestSubmitted(msg.sender, recoveryCallData);
    }

    /**
     * @dev renounces existing recovery request. Can be used during the security delay
     */
    function renounceRecoveryRequest() public {
        delete _smartAccountRequests[msg.sender];
        emit RecoveryRequestRenounced(msg.sender);
    }

    /**
     * @dev Not supported here
     */
    function isValidSignature(
        bytes32,
        bytes memory
    ) public view virtual override returns (bytes4) {
        return 0xffffffff; // not supported
    }
}
