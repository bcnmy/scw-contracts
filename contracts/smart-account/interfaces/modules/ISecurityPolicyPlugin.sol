// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title Security Policy Plugin
/// @author @ankurdubey521
/// @dev A security policy plugin is a plugin which enforce arbitrary checks and condition during plugin installation on the smart contract wallet
interface ISecurityPolicyPlugin {
    error SaConfigurationNotInitialized(address _sa);

    /// @dev Validates the security policy for the plugin to be installed, based on the parameters
    ///      set in the security policy of the smart contract wallet.
    /// @param _sa  The address of the smart contract wallet
    /// @param _plugin The address of the plugin to be installed
    function validateSecurityPolicy(address _sa, address _plugin) external;
}
