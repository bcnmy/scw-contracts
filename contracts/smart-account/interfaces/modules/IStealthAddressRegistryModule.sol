// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title Stealth Address Registry Module for Biconomy Modular Smart Accounts.
 * @dev Performs verifications for stealth address signed userOps.
 *         - It allows to validate user operations signed by Stealth Address private key,
 *           or by aggregated signature from Stealth Address owner and shared secret.
 *         - EIP-1271 compatible (ensures Smart Account can validate signed messages).
 *         - One stealth address owner per Smart Account.
 * @author Justin Zen - <justin@moonchute.xyz>
 */
interface IStealthAddressRegistryModule {
    struct StealthStorage {
        uint256 stealthPubkey;
        uint256 dhkey;
        uint256 ephemeralPubkey;
        address stealthAddress;
        uint8 stealthPubkeyPrefix;
        uint8 dhkeyPrefix;
        uint8 ephemeralPrefix;
    }
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
    ) external returns (address);

    /**
     * @dev Returns the parameter of the Smart Account.
     * @param smartAccount The address of the Smart Account.
     * @return stealthStorage The parameter of the Smart Account.
     */
    function getStealthAddress(
        address smartAccount
    ) external view returns (StealthStorage memory);
}
