// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IERC7484SecurityPolicyPlugin, ISecurityPolicyPlugin} from "contracts/smart-account/interfaces/modules/IERC7484SecurityPolicyPlugin.sol";
import {IQuery} from "lib/registry/src/interface/IQuery.sol";

/// @title ERC7484 Security Policy Plugin
/// @author @ankurdubey521
/// @dev Second Order Plugin to the Security Policy Manager Plugin, enforces checks as defined by ERC7484
// https://github.com/ethereum/EIPs/blob/231f3e25889dae1c7d21b4419fa27cee79a4ca42/EIPS/eip-7484.mdcontract
contract ERC7484SecurityPolicyPlugin is IERC7484SecurityPolicyPlugin {
    IQuery public immutable registry;

    mapping(address => Configuration) internal _configuration;

    constructor(IQuery _regisry) {
        registry = _regisry;
    }

    /// @inheritdoc ISecurityPolicyPlugin
    function validateSecurityPolicy(
        address _scw,
        address _plugin
    ) external override {
        registry.checkN(
            _plugin,
            _configuration[_scw].trustedAttesters,
            _configuration[_scw].threshold
        );
    }

    /// @inheritdoc IERC7484SecurityPolicyPlugin
    function setConfiguration(
        Configuration calldata _config
    ) external override {
        _configuration[msg.sender] = _config;
        emit ConfigurationSet(msg.sender, _config);
    }

    /// @inheritdoc IERC7484SecurityPolicyPlugin
    function configuration(
        address _sa
    ) external view override returns (Configuration memory) {
        return _configuration[_sa];
    }
}
