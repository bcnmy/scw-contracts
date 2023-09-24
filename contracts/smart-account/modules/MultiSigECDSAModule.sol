// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {BaseAuthorizationModule} from "./BaseAuthorizationModule.sol";
import {UserOperation} from "@account-abstraction/contracts/interfaces/UserOperation.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ISignatureValidator} from "../interfaces/ISignatureValidator.sol";
import {SignatureDecoder} from "../common/SignatureDecoder.sol";
import {SafeMath} from "../external/SafeMath.sol";

/**
 * @title ECDSA ownership Authorization module for Biconomy Smart Accounts.
 * @dev Compatible with Biconomy Modular Interface v 0.1
 *         - It allows to validate user operations signed by EOA private key.
 *         - EIP-1271 compatible (ensures Smart Account can validate signed messages).
 *         - One owner per Smart Account.
 *         - Does not support outdated eth_sign flow for cheaper validations
 *         (see https://support.metamask.io/hc/en-us/articles/14764161421467-What-is-eth-sign-and-why-is-it-a-risk-)
 * !!!!!!! Only EOA owners supported, no Smart Account Owners
 *         For Smart Contract Owners check SmartContractOwnership module instead
 * @author Fil Makarov - <filipp.makarov@biconomy.io>
 */

contract MultiEcdsaOwnershipRegistryModule is
    BaseAuthorizationModule,
    SignatureDecoder
{
    using ECDSA for bytes32;
    using SafeMath for uint256;

    string public constant NAME = "MultiSig ECDSA Ownership Registry Module";
    string public constant VERSION = "0.2.0";
    address internal constant SENTINEL_OWNERS = address(0x1);

    mapping(address => uint256) internal ownerCount;
    mapping(address => uint256) internal threshold;
    mapping(address => mapping(address => address))
        internal _smartAccountOwners;

    event OwnerAdded(address indexed account, address indexed owner);
    event OwnerRemoved(address indexed account, address indexed owner);
    event ChangedThreshold(address indexed account, uint256 indexed threshold);

    error NoOwnerRegisteredForSmartAccount(address smartAccount);
    error AlreadyInitedForSmartAccount(address smartAccount);
    error WrongSignatureLength();
    error NotEOA(address account);
    error ZeroAddressNotAllowedAsOwner();

    function initForSmartAccount(
        address[] memory _owners,
        uint256 _threshold
    ) external returns (address) {
        if (threshold[msg.sender] != 0)
            revert AlreadyInitedForSmartAccount(msg.sender);

        address currentOwner = SENTINEL_OWNERS;
        for (uint256 i = 0; i < _owners.length; i++) {
            // Owner address cannot be null.
            address owner = _owners[i];
            require(
                owner != address(0) &&
                    owner != SENTINEL_OWNERS &&
                    owner != address(this) &&
                    currentOwner != owner,
                "GS203"
            );
            // No duplicate owners allowed.
            require(
                _smartAccountOwners[msg.sender][owner] == address(0),
                "GS204"
            );
            _smartAccountOwners[msg.sender][currentOwner] = owner;
            currentOwner = owner;
        }
        _smartAccountOwners[msg.sender][currentOwner] = SENTINEL_OWNERS;
        ownerCount[msg.sender] = _owners.length;
        threshold[msg.sender] = _threshold;

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
    ) external view virtual returns (uint256) {
        (bytes memory cleanEcdsaSignature, ) = abi.decode(
            userOp.signature,
            (bytes, address)
        );
        if (
            checkSignatures(userOp.sender, userOpHash, "", cleanEcdsaSignature)
        ) {
            return VALIDATION_SUCCESS;
        }
        return SIG_VALIDATION_FAILED;
    }

    /**
     * @notice Checks whether the signature provided is valid for the provided data and hash. Reverts otherwise.
     * @param dataHash Hash of the data (could be either a message hash or transaction hash)
     * @param data That should be signed (this is passed to an external validator contract)
     * @param signatures Signature data that should be verified.
     *                   Can be packed ECDSA signature ({bytes32 r}{bytes32 s}{uint8 v}), contract signature (EIP-1271) or approved hash.
     */
    function checkSignatures(
        address smartAccount,
        bytes32 dataHash,
        bytes memory data,
        bytes memory signatures
    ) public view returns (bool) {
        // Load threshold to avoid multiple storage loads
        uint256 _threshold = threshold[smartAccount];
        // Check that a threshold is set
        require(_threshold > 0, "GS001");
        checkNSignatures(msg.sender, dataHash, data, signatures, _threshold);
    }

    function checkNSignatures(
        address executor,
        bytes32 dataHash,
        bytes memory /* data */,
        bytes memory signatures,
        uint256 requiredSignatures
    ) public view returns (bool) {
        // Check that the provided signature data is not too short
        require(signatures.length >= requiredSignatures.mul(65), "GS020");
        // There cannot be an owner with address 0.
        address lastOwner = address(0);
        address currentOwner;
        uint8 v;
        bytes32 r;
        bytes32 s;
        uint256 i;
        for (i = 0; i < requiredSignatures; i++) {
            (v, r, s) = signatureSplit(signatures, i);
            if (v == 0) {
                // If v is 0 then it is a contract signature
                // When handling contract signatures the address of the contract is encoded into r
                currentOwner = address(uint160(uint256(r)));

                // Check that signature data pointer (s) is not pointing inside the static part of the signatures bytes
                // This check is not completely accurate, since it is possible that more signatures than the threshold are send.
                // Here we only check that the pointer is not pointing inside the part that is being processed
                require(uint256(s) >= requiredSignatures.mul(65), "GS021");

                // Check that signature data pointer (s) is in bounds (points to the length of data -> 32 bytes)
                require(uint256(s).add(32) <= signatures.length, "GS022");

                // Check if the contract signature is in bounds: start of data is s + 32 and end is start + signature length
                uint256 contractSignatureLen;
                /* solhint-disable no-inline-assembly */
                /// @solidity memory-safe-assembly
                assembly {
                    contractSignatureLen := mload(add(add(signatures, s), 0x20))
                }
                /* solhint-enable no-inline-assembly */
                require(
                    uint256(s).add(32).add(contractSignatureLen) <=
                        signatures.length,
                    "GS023"
                );

                // Check signature
                bytes memory contractSignature;
                /* solhint-disable no-inline-assembly */
                /// @solidity memory-safe-assembly
                assembly {
                    // The signature data for contract signatures is appended to the concatenated signatures and the offset is stored in s
                    contractSignature := add(add(signatures, s), 0x20)
                }
                /* solhint-enable no-inline-assembly */
                require(
                    ISignatureValidator(currentOwner).isValidSignature(
                        dataHash,
                        contractSignature
                    ) == EIP1271_MAGIC_VALUE,
                    "GS024"
                );
            } else if (v > 30) {
                // If v > 30 then default va (27,28) has been adjusted for eth_sign flow
                // To support eth_sign and similar we adjust v and hash the messageHash with the Ethereum message prefix before applying ecrecover
                currentOwner = ecrecover(
                    keccak256(
                        abi.encodePacked(
                            "\x19Ethereum Signed Message:\n32",
                            dataHash
                        )
                    ),
                    v - 4,
                    r,
                    s
                );
            } else {
                // Default is the ecrecover flow with the provided data hash
                // Use ecrecover with the messageHash for EOA signatures
                currentOwner = ecrecover(dataHash, v, r, s);
            }
            if (
                !(currentOwner > lastOwner &&
                    _smartAccountOwners[msg.sender][currentOwner] !=
                    address(0) &&
                    currentOwner != SENTINEL_OWNERS)
            ) {
                return false;
            }
            lastOwner = currentOwner;
        }
        return true;
    }

    /**
     * @notice Returns the number of required confirmations for a Safe transaction aka the threshold.
     * @return Threshold number.
     */
    function getThreshold(address smartAccount) public view returns (uint256) {
        return threshold[smartAccount];
    }

    function isOwner(
        address smartAccount,
        address owner
    ) public view returns (bool) {
        return
            owner != SENTINEL_OWNERS &&
            _smartAccountOwners[smartAccount][owner] != address(0);
    }

    function getOwners(
        address smartAccount
    ) public view returns (address[] memory) {
        address[] memory array = new address[](ownerCount[smartAccount]);
        // populate return array
        uint256 index = 0;
        address currentOwner = _smartAccountOwners[smartAccount][
            SENTINEL_OWNERS
        ];
        while (currentOwner != SENTINEL_OWNERS) {
            array[index] = currentOwner;
            currentOwner = _smartAccountOwners[smartAccount][currentOwner];
            index++;
        }
        return array;
    }

    /**
     * @dev Checks if the address provided is a smart contract.
     * @param account Address to be checked.
     */
    function _isSmartContract(address account) internal view returns (bool) {
        uint256 size;
        assembly {
            size := extcodesize(account)
        }
        return size > 0;
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
        (_dataHash, _signature);
        return 0xffffffff; // do not support it here
    }
}
