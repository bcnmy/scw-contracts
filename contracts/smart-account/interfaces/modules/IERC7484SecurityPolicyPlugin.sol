// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ISecurityPolicyPlugin} from "contracts/smart-account/interfaces/modules/ISecurityPolicyManagerPlugin.sol";

interface IERC7484SecurityPolicyPluginEventsErrors {
    struct Configuration {
        address[] trustedAttesters;
        uint256 threshold;
    }

    event ConfigurationSet(address _sa, Configuration configuration);
}

/// @title ERC7484 Security Policy Plugin
/// @author @ankurdubey521
/// @dev Second Order Plugin to the Security Policy Manager Plugin, enforces checks as defined by ERC7484
// https://github.com/ethereum/EIPs/blob/231f3e25889dae1c7d21b4419fa27cee79a4ca42/EIPS/eip-7484.mdcontract
interface IERC7484SecurityPolicyPlugin is
    ISecurityPolicyPlugin,
    IERC7484SecurityPolicyPluginEventsErrors
{
    /// @dev Sets the configuration for the plugin for a given account
    /// @param _configuration The configuration to set
    function setConfiguration(Configuration calldata _configuration) external;

    /// @dev Gets the configuration for the plugin for a given account
    /// @param _sa The account to get the configuration for
    function configuration(
        address _sa
    ) external view returns (Configuration memory);
}
