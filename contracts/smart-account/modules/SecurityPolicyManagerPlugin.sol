// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {ISecurityPolicyManagerPlugin, ISecurityPolicyPlugin, SENTINEL_MODULE_ADDRESS} from "contracts/smart-account/interfaces/modules/ISecurityPolicyManagerPlugin.sol";

contract SecurityPolicyManagerPlugin is ISecurityPolicyManagerPlugin {
    mapping(address => mapping(address => address))
        internal enabledSecurityPoliciesLinkedList;

    /// @inheritdoc ISecurityPolicyManagerPlugin
    function enableSecurityPolicy(
        ISecurityPolicyPlugin _policy
    ) external override {
        if (
            _policy == ISecurityPolicyPlugin(address(0x0)) ||
            _policy == ISecurityPolicyPlugin(SENTINEL_MODULE_ADDRESS)
        ) {
            revert InvalidSecurityPolicyAddress(address(_policy));
        }

        mapping(address => address)
            storage enabledSecurityPolicies = enabledSecurityPoliciesLinkedList[
                msg.sender
            ];

        if (enabledSecurityPolicies[address(_policy)] != address(0x0)) {
            revert SecurityPolicyAlreadyEnabled(address(_policy));
        }

        enabledSecurityPolicies[address(_policy)] = enabledSecurityPolicies[
            SENTINEL_MODULE_ADDRESS
        ];
        enabledSecurityPolicies[SENTINEL_MODULE_ADDRESS] = address(_policy);

        emit SecurityPolicyEnabled(msg.sender, address(_policy));
    }

    /// @inheritdoc ISecurityPolicyManagerPlugin
    function enableSecurityPolicies(
        ISecurityPolicyPlugin[] calldata _policies
    ) external override {
        mapping(address => address)
            storage enabledSecurityPolicies = enabledSecurityPoliciesLinkedList[
                msg.sender
            ];

        // TODO: Verify if this reduces gas
        uint256 length = _policies.length;

        if (length == 0) {
            revert EmptyPolicyList();
        }

        address head = enabledSecurityPolicies[SENTINEL_MODULE_ADDRESS];

        for (uint256 i; i < length; ) {
            address policy = address(_policies[i]);

            if (policy == address(0x0) || policy == SENTINEL_MODULE_ADDRESS) {
                revert InvalidSecurityPolicyAddress(policy);
            }

            if (enabledSecurityPolicies[address(policy)] != address(0x0)) {
                revert SecurityPolicyAlreadyEnabled(address(policy));
            }

            enabledSecurityPolicies[policy] = head;
            head = policy;

            emit SecurityPolicyEnabled(msg.sender, policy);

            unchecked {
                ++i;
            }
        }

        enabledSecurityPolicies[SENTINEL_MODULE_ADDRESS] = head;
    }

    /// @inheritdoc ISecurityPolicyManagerPlugin
    function disableSecurityPolicy(
        ISecurityPolicyPlugin _policy,
        ISecurityPolicyPlugin _pointer
    ) external override {
        if (
            _policy == ISecurityPolicyPlugin(address(0x0)) ||
            _policy == ISecurityPolicyPlugin(SENTINEL_MODULE_ADDRESS)
        ) {
            revert InvalidSecurityPolicyAddress(address(_policy));
        }

        mapping(address => address)
            storage enabledSecurityPolicies = enabledSecurityPoliciesLinkedList[
                msg.sender
            ];

        if (enabledSecurityPolicies[address(_policy)] == address(0x0)) {
            revert SecurityPolicyAlreadyDisabled(address(_policy));
        }

        if (enabledSecurityPolicies[address(_pointer)] != address(_policy)) {
            revert InvalidPointerAddress(address(_pointer));
        }

        enabledSecurityPolicies[address(_pointer)] = enabledSecurityPolicies[
            address(_policy)
        ];
        delete enabledSecurityPolicies[address(_policy)];

        emit SecurityPolicyDisabled(msg.sender, address(_policy));
    }

    /// @inheritdoc ISecurityPolicyManagerPlugin
    function disableSecurityPoliciesRange(
        ISecurityPolicyPlugin _start,
        ISecurityPolicyPlugin _end,
        ISecurityPolicyPlugin _pointer
    ) external override {
        mapping(address => address)
            storage enabledSecurityPolicies = enabledSecurityPoliciesLinkedList[
                msg.sender
            ];

        if (enabledSecurityPolicies[address(_pointer)] != address(_start)) {
            revert InvalidPointerAddress(address(_pointer));
        }

        if (
            _start == ISecurityPolicyPlugin(address(0x0)) ||
            _start == ISecurityPolicyPlugin(SENTINEL_MODULE_ADDRESS)
        ) {
            revert InvalidSecurityPolicyAddress(address(_start));
        }

        if (
            _end == ISecurityPolicyPlugin(address(0x0)) ||
            _end == ISecurityPolicyPlugin(SENTINEL_MODULE_ADDRESS)
        ) {
            revert InvalidSecurityPolicyAddress(address(_end));
        }

        enabledSecurityPolicies[address(_pointer)] = enabledSecurityPolicies[
            address(_end)
        ];

        bool endFound = false;
        address current = address(_start);
        while (current != address(_end) || current != SENTINEL_MODULE_ADDRESS) {
            if (current == address(_end)) {
                endFound = true;
            }

            address next = enabledSecurityPolicies[current];
            delete enabledSecurityPolicies[current];

            emit SecurityPolicyDisabled(msg.sender, current);

            current = next;
        }

        if (!endFound) {
            revert InvalidSecurityPolicyAddress(address(_end));
        }
    }

    /// @inheritdoc ISecurityPolicyManagerPlugin
    function checkSetupAndEnableModule(
        address,
        bytes calldata
    ) external override returns (address) {
        revert("Not implemented");
    }

    /// @inheritdoc ISecurityPolicyManagerPlugin
    function securityPolicies(
        address
    ) external view override returns (ISecurityPolicyPlugin[] memory) {
        revert("Not implemented");
    }
}
