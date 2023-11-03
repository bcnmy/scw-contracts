// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title Security Policy Plugin
/// @author @ankurdubey521
/// @dev A security policy plugin enforces checks during plugin installation on the smart contract wallet.
interface ISecurityPolicyPlugin {
    error SaConfigurationNotInitialized(address _sa);

    /// @dev Validates the security policy for plugin installation based on the wallet's security policy settings.
    ///      set in the security policy of the smart account.
    /// @param _sa  The address of the smart account
    /// @param _plugin The address of the plugin to be installed
    function validateSecurityPolicy(address _sa, address _plugin) external;
}
