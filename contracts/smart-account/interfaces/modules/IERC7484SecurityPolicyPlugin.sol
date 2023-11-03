// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ISecurityPolicyPlugin} from "contracts/smart-account/interfaces/modules/ISecurityPolicyManagerPlugin.sol";
import {IERC7484SecurityPolicyPluginEventsErrors} from "contracts/smart-account/interfaces/modules/IERC7484SecurityPolicyPluginEventsErrors.sol";

/// @title ERC7484 Security Policy Plugin
/// @author @ankurdubey521
/// @dev Second Order Plugin to the Security Policy Manager Plugin, enforces checks as defined by ERC7484
// https://eips.ethereum.org/EIPS/eip-7484
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
