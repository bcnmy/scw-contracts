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
        uint48 recoveryThreshold;
        uint48 securityDelay;
    }

    bytes32 constant ADDRESS_ZERO_HASH =
        keccak256(abi.encodePacked(address(0)));

    // guardian (hash of the address) => (smartAccount => timeFrame)
    mapping(bytes32 => mapping(address => timeFrame)) internal _guardians;

    mapping(address => settings) internal _smartAccountSettings;

    /**
     * @dev Initializes the module for a Smart Account.
     * Can only be used at a time of first enabling the module for a Smart Account.
     */
    function initForSmartAccount(
        bytes32[] memory guardians,
        uint48[] memory validUntil,
        uint48[] memory validAfter,
        uint48 recoveryThreshold,
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
            recoveryThreshold,
            securityDelay
        );
        for (uint256 i; i < guardians.length; i++) {
            if (guardians[i] == ADDRESS_ZERO_HASH)
                revert ZeroAddressNotAllowedAsGuardian();
            if (validUntil[i] < validAfter[i])
                revert InvalidTimeFrame(validUntil[i], validAfter[i]);
            if (validUntil[i] < block.timestamp)
                revert ExpiredValidUntil(validUntil[i]);
            if (_guardians[guardians[i]][msg.sender].validUntil != 0)
                revert GuardianAlreadySet(guardians[i], msg.sender);
            _guardians[guardians[i]][msg.sender] = timeFrame(
                validUntil[i] == 0 ? type(uint48).max : validUntil[i],
                validAfter[i]
            );
        }
        return address(this);
    }

    // NOTE - if both validUntil and validAfter provided for setup are 0, guardian is considered active forever
    // Thus we put type(uint48).max as value for validUntil in this case, so the calldata itself doesn't need to contain this big value and thus
    // txn is cheaper
    // @note securityDelay is added to validAfter to get the actual validAfter value, so the validUntil should be bigger than validAfter + securityDelay

    // TODO: Do we need a guardian to agree to be added?

    function addGuardian(
        bytes32 guardian,
        uint48 validUntil,
        uint48 validAfter
    ) external {
        if (guardian == ADDRESS_ZERO_HASH)
            revert ZeroAddressNotAllowedAsGuardian();
        validAfter =
            validAfter +
            _smartAccountSettings[msg.sender].securityDelay;
        if (validUntil < validAfter)
            revert InvalidTimeFrame(validUntil, validAfter);
        if (validUntil < block.timestamp) revert ExpiredValidUntil(validUntil);
        if (_guardians[guardian][msg.sender].validUntil != 0)
            revert GuardianAlreadySet(guardian, msg.sender);
        // make a test case that it fails if validAfter + securityDelay together overflow uint48
        _guardians[guardian][msg.sender] = timeFrame(
            validUntil == 0 ? type(uint48).max : validUntil,
            validAfter
        );
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

    */

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

        return
            VALIDATION_SUCCESS |
            (uint256(earliestValidUntil) << 160) |
            (uint256(latestValidAfter) << (160 + 48));
    }

    function getCurrentSignature(
        bytes memory signatures,
        uint256 pos
    ) internal pure returns (bytes memory) {}

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
