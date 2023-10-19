// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {ISecurityPolicyPlugin} from "./ISecurityPolicyPlugin.sol";

address constant SENTINEL_MODULE_ADDRESS = address(0x1);

interface ISecurityPolicyManagerPluginEventsErrors {
    event SecurityPolicyEnabled(address indexed scw, address indexed policy);
    event SecurityPolicyDisabled(address indexed scw, address indexed policy);
    event ModuleValidated(address indexed scw, address indexed module);

    error SecurityPolicyAlreadyEnabled(address policy);
    error SecurityPolicyAlreadyDisabled(address policy);
    error InvalidSecurityPolicyAddress(address policy);
    error InvalidPointerAddress(address pointer);
    error ModuleInstallationFailed();
    error EmptyPolicyList();
}

/// @title Security Policy Manager Plugin
/// @author @ankurdubey521
/// @dev Execution Phase Plugin responsible for enforcing security policies during plugin installation on the smart contract wallet
interface ISecurityPolicyManagerPlugin is
    ISecurityPolicyManagerPluginEventsErrors
{
    /// @dev Enables the security policies for the smart contract wallet. Used during the setup process.
    /// @param _policy The security policy to be enabled
    function enableSecurityPolicy(ISecurityPolicyPlugin _policy) external;

    /// @dev Enables the security policies for the smart contract wallet. Used during the setup process.
    /// @param _policies The security policies to be enabled
    function enableSecurityPolicies(
        ISecurityPolicyPlugin[] calldata _policies
    ) external;

    /// @dev Disables the security policy for the smart contract wallet.
    /// @param _policy The security policy to be disabled.
    /// @param _pointer The address of the security policy preceeding _policy in the list of enabled modules.
    function disableSecurityPolicy(
        ISecurityPolicyPlugin _policy,
        ISecurityPolicyPlugin _pointer
    ) external;

    /// @dev Disables the security policies for the smart contract wallet.
    /// @param _start The first iterm in the list to be disabled.
    /// @param _end The last iterm in the list to be disabled.
    /// @param _pointer The address of the security policy preceeding _start in the list of enabled modules.
    function disableSecurityPoliciesRange(
        ISecurityPolicyPlugin _start,
        ISecurityPolicyPlugin _end,
        ISecurityPolicyPlugin _pointer
    ) external;

    /// @dev Queries the registry and checks if the module is valid and enables the module.
    /// @param _setupContract The address of the module contract
    /// @param _setupData The data to be passed to the module contract during setup
    function checkSetupAndEnableModule(
        address _setupContract,
        bytes calldata _setupData
    ) external returns (address module);

    /// @dev Returns the security policy for the smart contract wallet.
    /// @param _scw The address of the smart contract wallet
    /// @param _start The address of the first security policy in the list
    /// @param _pageSize The number of security policies to be returned
    /// @return enabledPolicies The list of enabled security policies
    function securityPoliciesPaginated(
        address _scw,
        address _start,
        uint256 _pageSize
    ) external view returns (ISecurityPolicyPlugin[] memory enabledPolicies);
}
