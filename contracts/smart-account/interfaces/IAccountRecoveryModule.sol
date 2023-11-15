// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IAccountRecoveryModule {
    /**
     * @dev Struct that represents a guardian's validity time frame
     */
    struct TimeFrame {
        uint48 validUntil;
        uint48 validAfter;
    }

    /**
     * @dev Struct for storing Smart Account settings
     * @param guardiansCount number of guardians currently stored for the account
     * it includes expired guardians as well
     * @param recoveryThreshold number of guardians required to recover the account
     * @param securityDelay delay in seconds that must pass before a recovery request can be executed
     */
    struct SaSettings {
        uint8 guardiansCount;
        uint8 recoveryThreshold;
        uint24 securityDelay;
    }

    /**
     * @dev Struct which describes a recovery request
     * @param callDataHash hash of the calldata that will be executed to recover the account
     * @param requestTimestamp timestamp of the request submission
     */
    struct RecoveryRequest {
        bytes32 callDataHash;
        uint48 requestTimestamp;
    }

    /**
     * @dev Emitted when a recovery request is submitted
     * @param smartAccount address of the Smart Account
     * @param requestCallData calldata that will be executed to recover the account
     */
    event RecoveryRequestSubmitted(
        address indexed smartAccount,
        bytes indexed requestCallData
    );

    /**
     * @dev Emitted when a recovery request is renounced
     * @param smartAccount address of the Smart Account
     */
    event RecoveryRequestRenounced(address indexed smartAccount);

    /**
     * @dev Emitted when a guardian has been added
     * @param smartAccount address of the Smart Account
     * @param guardian guardian address
     * @param timeFrame guardian validity time frame
     */
    event GuardianAdded(
        address indexed smartAccount,
        bytes32 guardian,
        TimeFrame timeFrame
    );

    /**
     * @dev Emitted when a guardian has been removed
     * @param smartAccount address of the Smart Account
     * @param guardian guardian address
     */
    event GuardianRemoved(address indexed smartAccount, bytes32 guardian);

    /**
     * @dev Emitted when a guardian's validity time frame has been changed
     * @param smartAccount address of the Smart Account
     * @param guardian guardian address
     * @param timeFrame new validity time frame
     */
    event GuardianChanged(
        address indexed smartAccount,
        bytes32 guardian,
        TimeFrame timeFrame
    );

    /**
     * @dev Emitted when a recovery threshold has been changed
     * @param smartAccount address of the Smart Account
     * @param threshold new recovery threshold
     */
    event ThresholdChanged(address indexed smartAccount, uint8 threshold);

    /**
     * @dev Emitted when a security delay has been changed
     * @param smartAccount address of the Smart Account
     * @param securityDelay new security delay
     */
    event SecurityDelayChanged(
        address indexed smartAccount,
        uint48 securityDelay
    );

    /**
     * @dev Thrown if trying to init module for the Smart Account
     * but it has already been initialized
     * @param smartAccount address of the Smart Account
     */
    error AlreadyInitedForSmartAccount(address smartAccount);

    /**
     * @dev Thrown if trying to set a zero bytes32 as a guardian
     */
    error ZeroGuardian();

    /**
     * @dev Thrown if invalid time frame has been provided
     * @param validUntil guardian validity end timestamp
     * @param validAfter guardian validity start timestamp
     */
    error InvalidTimeFrame(uint48 validUntil, uint48 validAfter);

    /**
     * @dev Thrown if trying to set a timeframe with validUntil which
     * has already passed
     * @param validUntil guardian validity end timestamp
     */
    error ExpiredValidUntil(uint48 validUntil);

    /**
     * @dev Thrown if trying to set a guardian that has already been set
     * @param guardian guardian address
     * @param smartAccount address of the Smart Account
     */
    error GuardianAlreadySet(bytes32 guardian, address smartAccount);

    /**
     * @dev Thrown if trying to remove or change a guardian that has not been set
     * @param guardian guardian address
     * @param smartAccount address of the Smart Account
     */
    error GuardianNotSet(bytes32 guardian, address smartAccount);

    /**
     * @dev Thrown if trying to set a threshold that is higher than the number of guardians
     * @param threshold new recovery threshold
     * @param guardiansExist number of guardians currently stored for the account
     */
    error ThresholdTooHigh(uint8 threshold, uint256 guardiansExist);

    /**
     * @dev Thrown if trying to set a zero threshold
     */
    error ZeroThreshold();

    /**
     * @dev Thrown if not enough or too many params provided
     */
    error InvalidAmountOfGuardianParams();

    /**
     * @dev Thrown if identical guardians have been provided when trying to replace a guardian
     */
    error GuardiansAreIdentical();

    /**
     * @dev Thrown if trying to remove a not yet expired guardian
     * via removeExpiredGuardian method
     * @param guardian guardian address
     * @param smartAccount address of the Smart Account
     */
    error GuardianNotExpired(bytes32 guardian, address smartAccount);

    /**
     * @dev Thrown if trying to submit a recovery request with empty call data
     */
    error EmptyRecoveryCallData();

    /**
     * @dev Thrown if trying to submit a recovery request with call data that has already been submitted
     * @param smartAccount address of the Smart Account
     * @param requestCallDataHash hash of the calldata that will be executed to recover the account
     */
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
        bytes32[] calldata guardians,
        TimeFrame[] memory timeFrames,
        uint8 recoveryThreshold,
        uint24 securityDelay
    ) external returns (address);

    /**
     * @dev Adds guardian for a Smart Account (msg.sender)
     * Should be called by the Smart Account
     * @param guardian guardian to add
     * @param validUntil guardian validity end timestamp
     * @param validAfter guardian validity start timestamp
     */
    function addGuardian(
        bytes32 guardian,
        uint48 validUntil,
        uint48 validAfter
    ) external;

    /**
     * @dev Removes guardian from a Smart Account (msg.sender)
     * Should be called by the Smart Account
     * @param guardian guardian to remove
     */
    function removeGuardian(bytes32 guardian) external;

    /**
     * @dev Replaces guardian for a Smart Account (msg.sender)
     * Deletes the replaced guardian and adds the new one
     * The new guardian will be valid not earlier than now+securityDelay
     * @param guardian guardian to replace
     * @param newGuardian new guardian to add
     * @param validUntil new guardian validity end timestamp
     * @param validAfter new guardian validity start timestamp
     */
    function replaceGuardian(
        bytes32 guardian,
        bytes32 newGuardian,
        uint48 validUntil,
        uint48 validAfter
    ) external;

    /**
     * @dev Removes the expired guardian for a Smart Account
     * Can be called  by anyone. Allows clearing expired guardians automatically
     * and maintain the list of guardians actual
     * @param guardian guardian to remove
     */
    function removeExpiredGuardian(
        bytes32 guardian,
        address smartAccount
    ) external;

    /**
     * @dev Changes guardian validity timeframes for the Smart Account (msg.sender)
     * @param guardian guardian to change
     * @param validUntil guardian validity end timestamp
     * @param validAfter guardian validity start timestamp
     */
    function changeGuardianParams(
        bytes32 guardian,
        uint48 validUntil,
        uint48 validAfter
    ) external;

    /**
     * @dev Changes recovery threshold for a Smart Account (msg.sender)
     * Should be called by the Smart Account
     * @param newThreshold new recovery threshold
     */
    function setThreshold(uint8 newThreshold) external;

    /**
     * @dev Changes security delay for a Smart Account (msg.sender)
     * Should be called by the Smart Account
     * @param newSecurityDelay new security delay
     */
    function setSecurityDelay(uint24 newSecurityDelay) external;

    /**
     * @dev Submits recovery request for a Smart Account
     * Hash of the callData is stored on-chain along with the timestamp of the request submission
     * @param recoveryCallData callData of the recovery request
     */
    function submitRecoveryRequest(bytes calldata recoveryCallData) external;

    /**
     * @dev renounces existing recovery request for a Smart Account (msg.sender)
     * Should be called by the Smart Account
     * Can be used during the security delay to cancel the request
     */
    function renounceRecoveryRequest() external;

    /**
     * @dev Returns guardian validity timeframes for the Smart Account
     * @param guardian guardian to get params for
     * @param smartAccount smartAccount to get params for
     * @return TimeFrame struct
     */
    function getGuardianParams(
        bytes32 guardian,
        address smartAccount
    ) external view returns (TimeFrame memory);

    /**
     * @dev Returns Smart Account settings
     * @param smartAccount smartAccount to get settings for
     * @return Smart Account Settings struct
     */
    function getSmartAccountSettings(
        address smartAccount
    ) external view returns (SaSettings memory);

    /**
     * @dev Returns recovery request for a Smart Account
     * Only one request per Smart Account is stored at a time
     * @param smartAccount smartAccount to get recovery request for
     * @return RecoveryRequest struct
     */
    function getRecoveryRequest(
        address smartAccount
    ) external view returns (RecoveryRequest memory);
}
