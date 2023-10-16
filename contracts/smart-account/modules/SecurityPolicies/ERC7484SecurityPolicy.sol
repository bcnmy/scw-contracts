// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

// import {ISecurityPolicyPlugin} from "contracts/smart-account/interfaces/modules/ISecurityPolicyManagerPlugin.sol";

/// @title ERC7484 Security Policy Plugin
/// @author @ankurdubey521
/// @dev Second Order Plugin to the Security Policy Manager Plugin, enforces checks as defined by ERC7484
// https://github.com/ethereum/EIPs/blob/231f3e25889dae1c7d21b4419fa27cee79a4ca42/EIPS/eip-7484.mdcontract

contract ERC7484SecurityPolicyPlugin {
    function foo() external pure returns (uint256) {
        return 1;
    }
}
