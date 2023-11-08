// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC7484SecurityPolicyPluginEventsErrors {
    struct Configuration {
        address[] trustedAttesters;
        uint256 threshold;
    }

    event ConfigurationSet(address _sa, Configuration configuration);
}
