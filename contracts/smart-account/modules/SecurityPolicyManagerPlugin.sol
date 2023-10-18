// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {ISecurityPolicyManagerPlugin, ISecurityPolicyPlugin, SENTINEL_MODULE_ADDRESS} from "contracts/smart-account/interfaces/modules/ISecurityPolicyManagerPlugin.sol";
import {ISmartAccount} from "contracts/smart-account/interfaces/ISmartAccount.sol";
import {Enum} from "contracts/smart-account/common/Enum.sol";

/// @title Security Policy Manager Plugin
/// @author @ankurdubey521
/// @dev Execution Phase Plugin responsible for enforcing security policies during plugin installation on the smart contract wallet
contract SecurityPolicyManagerPlugin is ISecurityPolicyManagerPlugin {
    mapping(address => mapping(address => address))
        internal enabledSecurityPoliciesLinkedList;

    ////////////////////////// PLUGIN INSTALLATION FUNCTIONS //////////////////////////

    /// @inheritdoc ISecurityPolicyManagerPlugin
    function checkSetupAndEnableModule(
        address _setupContract,
        bytes calldata _setupData
    ) external override returns (address) {
        // Instruct the SA to install the module and return the address
        ISmartAccount sa = ISmartAccount(msg.sender);
        (bool success, bytes memory returndata) = sa
            .execTransactionFromModuleReturnData(
                msg.sender,
                0,
                abi.encodeCall(
                    sa.setupAndEnableModule,
                    (_setupContract, _setupData)
                ),
                Enum.Operation.Call
            );
        if (!success) {
            revert ModuleInstallationFailed();
        }

        address module = abi.decode(returndata, (address));

        // Validate the module installed
        _validateSecurityPolicies(msg.sender, module);

        return module;
    }

    ////////////////////////// SECURITY POLICY MANAGEMENT FUNCTIONS //////////////////////////

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

        address head = enabledSecurityPolicies[SENTINEL_MODULE_ADDRESS];
        enabledSecurityPolicies[address(_policy)] = head == address(0x0)
            ? SENTINEL_MODULE_ADDRESS
            : head;
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

            enabledSecurityPolicies[policy] = head == address(0x0)
                ? SENTINEL_MODULE_ADDRESS
                : head;
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

    /* solhint-disable code-complexity*/
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
        while (true) {
            address next = enabledSecurityPolicies[current];
            delete enabledSecurityPolicies[current];

            emit SecurityPolicyDisabled(msg.sender, current);

            if (current == address(_end)) {
                endFound = true;
                break;
            }

            if (current == SENTINEL_MODULE_ADDRESS) {
                break;
            }

            current = next;
        }

        if (!endFound) {
            revert InvalidSecurityPolicyAddress(address(_end));
        }
    }

    /// @inheritdoc ISecurityPolicyManagerPlugin
    function securityPoliciesPaginated(
        address _scw,
        address _start,
        uint256 _pageSize
    )
        external
        view
        override
        returns (ISecurityPolicyPlugin[] memory enabledPolicies)
    {
        enabledPolicies = new ISecurityPolicyPlugin[](_pageSize);
        uint256 actualEnabledPoliciesLength;

        mapping(address => address)
            storage enabledSecurityPolicies = enabledSecurityPoliciesLinkedList[
                _scw
            ];

        if (_start == address(0)) {
            _start = SENTINEL_MODULE_ADDRESS;
        }

        ISecurityPolicyPlugin current = ISecurityPolicyPlugin(_start);
        do {
            if (current != ISecurityPolicyPlugin(SENTINEL_MODULE_ADDRESS)) {
                enabledPolicies[actualEnabledPoliciesLength] = current;
                unchecked {
                    ++actualEnabledPoliciesLength;
                }
            }
            current = ISecurityPolicyPlugin(
                enabledSecurityPolicies[address(current)]
            );
        } while (
            actualEnabledPoliciesLength < _pageSize &&
                current != ISecurityPolicyPlugin(SENTINEL_MODULE_ADDRESS) &&
                current != ISecurityPolicyPlugin(address(0))
        );

        assembly {
            mstore(enabledPolicies, actualEnabledPoliciesLength)
        }
    }

    ////////////////////////// PLUGIN INSTALLATION FUNCTIONS HELPERS //////////////////////////

    function _validateSecurityPolicies(address _sa, address _module) internal {
        mapping(address => address)
            storage enabledSecurityPolicies = enabledSecurityPoliciesLinkedList[
                _sa
            ];

        address current = enabledSecurityPolicies[SENTINEL_MODULE_ADDRESS];
        while (current != address(0) && current != SENTINEL_MODULE_ADDRESS) {
            ISecurityPolicyPlugin(current).validateSecurityPolicy(_sa, _module);
            current = enabledSecurityPolicies[current];
        }

        emit ModuleValidated(_sa, _module);
    }
}
