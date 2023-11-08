// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ISecurityPolicyManagerPluginEventsErrors {
    event SecurityPolicyEnabled(address indexed sa, address indexed policy);
    event SecurityPolicyDisabled(address indexed sa, address indexed policy);
    event ModuleValidated(address indexed sa, address indexed module);

    error SecurityPolicyAlreadyEnabled(address policy);
    error SecurityPolicyAlreadyDisabled(address policy);
    error InvalidSecurityPolicyAddress(address policy);
    error InvalidPointerAddress(address pointer);
    error ModuleInstallationFailed();
    error EmptyPolicyList();
    error ModuleIsNotAContract(address module);
}
