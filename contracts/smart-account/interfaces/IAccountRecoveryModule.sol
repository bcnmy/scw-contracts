// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

interface IAccountRecoveryModule {
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
    event SecurityDelayChanged(
        address indexed smartAccount,
        uint48 securityDelay
    );

    error AlreadyInitedForSmartAccount(address smartAccount);
    error ZeroGuardian();
    error InvalidTimeFrame(uint48 validUntil, uint48 validAfter);
    error ExpiredValidUntil(uint48 validUntil);
    error GuardianAlreadySet(bytes32 guardian, address smartAccount);
    error GuardianNotSet(bytes32 guardian, address smartAccount);
    error ThresholdTooHigh(uint8 threshold, uint256 guardiansExist);
    error ZeroThreshold();
    error InvalidAmountOfGuardianParams();
    error GuardiansAreIdentical();
    error GuardianNotExpired(bytes32 guardian, address smartAccount);
    error EmptyRecoveryCallData();
    error RecoveryRequestAlreadyExists(
        address smartAccount,
        bytes32 requestCallDataHash
    );
}
