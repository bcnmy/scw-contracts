// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {ISecurityPolicyPlugin} from "contracts/smart-account/interfaces/modules/ISecurityPolicyManagerPlugin.sol";

interface IERC7484SecurityPolicyPlugin is ISecurityPolicyPlugin {
    struct PolicyDetails {
        uint256 x;
    }
}
