// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC7484SecurityPolicyPlugin, ISecurityPolicyPlugin} from "contracts/smart-account/interfaces/modules/IERC7484SecurityPolicyPlugin.sol";
import {IQuery} from "lib/registry/src/interface/IQuery.sol";

/// @title ERC7484 Security Policy Plugin
/// @author @ankurdubey521
/// @dev Second Order Plugin to the Security Policy Manager Plugin, enforces checks as defined by ERC7484
// https://eips.ethereum.org/EIPS/eip-7484
contract ERC7484SecurityPolicyPlugin is IERC7484SecurityPolicyPlugin {
    IQuery public immutable REGISTRY;

    mapping(address => Configuration) internal _configuration;

    constructor(IQuery _regisry) {
        REGISTRY = _regisry;
    }

    /// @inheritdoc IERC7484SecurityPolicyPlugin
    function setConfiguration(
        Configuration calldata _config
    ) external override {
        _configuration[msg.sender] = _config;
        emit ConfigurationSet(msg.sender, _config);
    }

    /// @inheritdoc ISecurityPolicyPlugin
    function validateSecurityPolicy(
        address _sa,
        address _plugin
    ) external view override {
        Configuration storage saConfiguration = _configuration[_sa];

        if (
            saConfiguration.threshold == 0 ||
            saConfiguration.trustedAttesters.length == 0
        ) {
            revert SaConfigurationNotInitialized(_sa);
        }

        REGISTRY.checkN(
            _plugin,
            saConfiguration.trustedAttesters,
            saConfiguration.threshold
        );
    }

    /// @inheritdoc IERC7484SecurityPolicyPlugin
    function configuration(
        address _sa
    ) external view override returns (Configuration memory) {
        return _configuration[_sa];
    }
}
