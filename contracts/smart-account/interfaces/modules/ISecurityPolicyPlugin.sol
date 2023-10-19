// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/// @title Security Policy Plugin
/// @author @ankurdubey521
/// @dev A security policy plugin is a plugin which enforce arbitrary checks and condition during plugin installation on the smart contract wallet
interface ISecurityPolicyPlugin {
    /// @dev Validates the security policy for the plugin to be installed, based on the parameters
    ///      set in the security policy of the smart contract wallet.
    /// @param _scw  The address of the smart contract wallet
    /// @param _plugin The address of the plugin to be installed
    function validateSecurityPolicy(address _scw, address _plugin) external;
}
