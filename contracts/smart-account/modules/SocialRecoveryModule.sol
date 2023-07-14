// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {BaseAuthorizationModule, UserOperation} from "./BaseAuthorizationModule.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import "hardhat/console.sol";

/**
 * @title Social Recovery module for Biconomy Smart Accounts.
 * @dev Compatible with Biconomy Modular Interface v 0.1
 *         - It allows to _______________
 *         - ECDSA guardians only
 *         - For security reasons, we store hashes of the addresses of guardians, not the addresses themselves
 *
 *
 * @author Fil Makarov - <filipp.makarov@biconomy.io>
 * based on https://vitalik.ca/general/2021/01/11/recovery.html by Vitalik Buterin
 */

contract SocialRecoveryModule is BaseAuthorizationModule {
    string public constant NAME = "Social Recovery Module";
    string public constant VERSION = "0.1.0";

    // TODO
    // EVENTS
    event RecoveryRequestSubmitted(
        address indexed smartAccount,
        bytes indexed requestCallData
    );
    event RecoveryRequestRenounced(address indexed smartAccount);

    error AlreadyInitedForSmartAccount(address smartAccount);
    error ThresholdNotSetForSmartAccount(address smartAccount);
    error InvalidSignaturesLength();
    error NotUniqueGuardianOrInvalidOrder(
        address lastGuardian,
        address currentGuardian
    );

    error ZeroAddressNotAllowedAsGuardian();
    error InvalidTimeFrame(uint48 validUntil, uint48 validAfter);
    error ExpiredValidUntil(uint48 validUntil);
    error GuardianAlreadySet(bytes32 guardian, address smartAccount);

    error NotEnoughGuardiansProvided(uint256 guardiansProvided);
    error InvalidAmountOfGuardianParams();

    using ECDSA for bytes32;

    struct timeFrame {
        uint48 validUntil;
        uint48 validAfter;
    }

    struct settings {
        uint8 guardiansCount;
        uint8 recoveryThreshold;
        uint48 securityDelay;
    }

    struct recoveryRequest {
        bytes32 callDataHash;
        uint48 requestTimestamp;
    }

    bytes32 constant ADDRESS_ZERO_HASH =
        keccak256(abi.encodePacked(address(0)));

    // guardian (hash of the address) => (smartAccount => timeFrame)
    mapping(bytes32 => mapping(address => timeFrame)) internal _guardians;

    mapping(address => settings) internal _smartAccountSettings;

    mapping(address => recoveryRequest) internal _smartAccountRequests;

    /**
     * @dev Initializes the module for a Smart Account.
     * Can only be used at a time of first enabling the module for a Smart Account.
     */
    function initForSmartAccount(
        bytes32[] memory guardians,
        uint48[] memory validUntil,
        uint48[] memory validAfter,
        uint8 recoveryThreshold,
        uint48 securityDelay
    ) external returns (address) {
        if (_smartAccountSettings[msg.sender].recoveryThreshold > 0)
            revert AlreadyInitedForSmartAccount(msg.sender);
        if (recoveryThreshold > guardians.length)
            revert NotEnoughGuardiansProvided(guardians.length);
        if (
            guardians.length != validUntil.length ||
            validUntil.length != validAfter.length ||
            guardians.length == 0
        ) revert InvalidAmountOfGuardianParams();
        _smartAccountSettings[msg.sender] = settings(
            uint8(guardians.length),
            recoveryThreshold,
            securityDelay
        );
        for (uint256 i; i < guardians.length; i++) {
            if (guardians[i] == ADDRESS_ZERO_HASH)
                revert ZeroAddressNotAllowedAsGuardian();
            if (_guardians[guardians[i]][msg.sender].validUntil != 0)
                revert GuardianAlreadySet(guardians[i], msg.sender);

            if (validUntil[i] == 0) validUntil[i] = type(uint48).max;
            if (validUntil[i] < validAfter[i])
                revert InvalidTimeFrame(validUntil[i], validAfter[i]);
            if (validUntil[i] != 0 && validUntil[i] < block.timestamp)
                revert ExpiredValidUntil(validUntil[i]);

            _guardians[guardians[i]][msg.sender] = timeFrame(
                validUntil[i],
                validAfter[i]
            );
        }
        return address(this);
    }

    /*

     *  How to make a delayed effect of changing the owner?
     *  make it two userOps. 
     *  1) userOp to approve the calldata that changes an owner
     *  user.Op calldata can only be to this module and to the submitChangeRequest function
     *  it records the calldata of the function that will actually change the owner on-chain
     *  along with the timestamp of the submission. 
     *  2) for the next validateUserOp call, if userOp contains this exact calldata, 
     *  it validates userOp with validAfter set as the timestamp of the submission + securityDelay
     *  
     *  This may also require adding another securityDelay to the struct settings
     *  one delay for new guardians, one delay for applying the change of the owner

    */

    /*

    *   If we don't want delay for changing owner , but we want our module to _look_
    *   like it allows only changing owner user ops, we can technically limit which calldatas
    *   should be considered valid to be authorised via this module
    *   However, it's not a good idea, as it's just _look_, because after changing the owner
    *   any userOp will still be available to be validated immediately.
    *   I think, it will be better to make this changing owner delayed. 
    *   just can configure the delay. If the delay is 0, then allow for immediate change of the owner.
    *   if the delay is not 0, we make additional checks:

        if (userOp.calldata == smartAccountRequests[smartAccount].calldata) {
            delete smartAccountRequests[smartAccount];
            return packValidationData(
                false, 
                uint48(max).value, 
                smartAccountRequests[smartAccount].timestamp+_smartAccountSettings[smartAccount].securityDelay
            )
        }

        // signatures and validUntil/After checks

        if (userOp.calldata[0:4] == submitChangeRequest.selector || 
            _smartAccountSettings[smartAccount].securityDelay == 0
            ) 
        {
            return
                VALIDATION_SUCCESS |
                (uint256(validUntil) << 160) |
                (uint256(validAfter) << (160 + 48));
        } else {
            return SIG_VALIDATION_FAILED; // revert WrongOperation();
        }

        + add renounce request function

    */

    // recoveryCallData is something like executeCall(module, 0, encode(transferOwnership(newOwner)))
    function submitRecoveryRequest(bytes calldata recoveryCallData) public {
        _smartAccountRequests[msg.sender] = recoveryRequest(
            keccak256(recoveryCallData),
            uint48(block.timestamp)
        );
        emit RecoveryRequestSubmitted(msg.sender, recoveryCallData);
    }

    function renounceRecoveryRequest() external {
        delete _smartAccountRequests[msg.sender];
        emit RecoveryRequestRenounced(msg.sender);
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
        // if there is a request added, return validation success
        // with validAfter set to the timestamp of the request + securityDelay
        // so that the userOp can be validated only after the delay
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
            revert ThresholdNotSetForSmartAccount(userOp.sender);
        (bytes memory signatures, ) = abi.decode(
            userOp.signature,
            (bytes, address)
        );
        if (signatures.length < requiredSignatures * 65)
            revert InvalidSignaturesLength();

        address lastGuardianAddress;
        address currentGuardianAddress;
        bytes32 currentGuardian;
        uint48 validAfter;
        uint48 validUntil;
        uint48 latestValidAfter;
        uint48 earliestValidUntil = type(uint48).max;

        for (uint256 i; i < requiredSignatures; ) {
            currentGuardianAddress = userOpHash
                .toEthSignedMessageHash()
                .recover(userOp.signature[96 + i * 65:96 + (i + 1) * 65]);

            currentGuardian = keccak256(
                abi.encodePacked(currentGuardianAddress)
            );
            validAfter = _guardians[currentGuardian][userOp.sender].validAfter;
            validUntil = _guardians[currentGuardian][userOp.sender].validUntil;

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
        // in this case executeCall(address dest, uint256 value, bytes calldata data);
        // where `data` is the submitRecoveryRequest calldata
        (address dest, uint256 callValue, bytes memory innerCallData) = abi
            .decode(
                userOp.callData[4:], // skip selector
                (address, uint256, bytes)
            );
        bytes4 innerSelector;
        assembly {
            innerSelector := mload(add(innerCallData, 0x20))
        }
        bool addingRequestUserOp = innerSelector ==
            this.submitRecoveryRequest.selector &&
            dest == address(this) &&
            callValue == 0;
        if (
            addingRequestUserOp ||
            _smartAccountSettings[msg.sender].securityDelay == 0
        ) {
            return
                VALIDATION_SUCCESS |
                (uint256(earliestValidUntil) << 160) |
                (uint256(latestValidAfter) << (160 + 48));
        }

        // otherwise sig validation considered failed
        return SIG_VALIDATION_FAILED;
    }

    // NOTE - if both validUntil is 0, guardian is considered active forever
    // Thus we put type(uint48).max as value for validUntil in this case,
    // so the calldata itself doesn't need to contain this big value and thus
    // txn is cheaper
    // we need to explicitly do it, so the algorithm of intersecting validUntils and validAfters
    // for several guardians works correctly
    // @note if validAfter is less thena now + securityDelay, it is set to now + securityDelay
    // as for security reasons new guardian is only active after securityDelay

    // TODO: Do we need a guardian to agree to be added?

    function addGuardian(
        bytes32 guardian,
        uint48 validUntil,
        uint48 validAfter
    ) external {
        if (guardian == ADDRESS_ZERO_HASH)
            revert ZeroAddressNotAllowedAsGuardian();
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
        _guardians[guardian][msg.sender] = timeFrame(validUntil, validAfter);
        _smartAccountSettings[msg.sender].guardiansCount++;
    }

    function changeGuardian(
        bytes32 guardian,
        bytes32 newGuardian,
        uint48 validUntil,
        uint48 validAfter
    ) external {
        if (guardian == ADDRESS_ZERO_HASH)
            revert ZeroAddressNotAllowedAsGuardian();
        if (newGuardian == ADDRESS_ZERO_HASH)
            revert ZeroAddressNotAllowedAsGuardian();

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
        _guardians[newGuardian][msg.sender] = timeFrame(
            validUntil == 0 ? type(uint48).max : validUntil,
            validAfter
        );

        // make the previous stay valid for period of securityDelay from now only
        _guardians[guardian][msg.sender].validUntil = minimalSecureValidAfter;
    }

    function removeGuardian(bytes32 guardian) external {
        delete _guardians[guardian][msg.sender];
        if (
            _smartAccountSettings[msg.sender].guardiansCount <
            _smartAccountSettings[msg.sender].recoveryThreshold
        ) {
            _smartAccountSettings[msg.sender].recoveryThreshold--;
        }
    }

    function getGuardianDetails(
        bytes32 guardian,
        address smartAccount
    ) external view returns (timeFrame memory) {
        return _guardians[guardian][smartAccount];
    }

    function getSmartAccountSettings(
        address smartAccount
    ) external view returns (settings memory) {
        return _smartAccountSettings[smartAccount];
    }

    function getRecoverRequest(
        address smartAccount
    ) external view returns (recoveryRequest memory) {
        return _smartAccountRequests[smartAccount];
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
