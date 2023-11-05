// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ISecurityPolicyManagerPlugin, ISecurityPolicyPlugin, SENTINEL_MODULE_ADDRESS} from "contracts/smart-account/interfaces/modules/ISecurityPolicyManagerPlugin.sol";
import {ISmartAccount} from "contracts/smart-account/interfaces/ISmartAccount.sol";
import {Enum} from "contracts/smart-account/common/Enum.sol";
import {LibAddress} from "contracts/smart-account/libs/LibAddress.sol";

/// @title Security Policy Manager Plugin
/// @author @ankurdubey521
/// @dev Execution Phase Plugin responsible for enforcing security policies during plugin installation on the smart account
contract SecurityPolicyManagerPlugin is ISecurityPolicyManagerPlugin {
    using LibAddress for address;

    mapping(address => mapping(address => address))
        internal enabledSecurityPoliciesLinkedList;

    ////////////////////////// PLUGIN INSTALLATION FUNCTIONS //////////////////////////

    /// @inheritdoc ISecurityPolicyManagerPlugin
    // solhint-disable function-max-lines
    function checkSetupAndEnableModule(
        address, //setupContract
        bytes calldata //setupData
    ) external override returns (address) {
        // Instruct the SA to install the module and return the address

        bool moduleInstallationSuccess;
        address module;

        // Optimised Version of the following code:
        // (bool success, bytes memory returndata) = sa
        //     .execTransactionFromModuleReturnData(
        //         msg.sender,
        //         0,
        //         abi.encodeCall(
        //             sa.setupAndEnableModule,
        //             (_setupContract, _setupData)
        //         ),
        //         Enum.Operation.Call
        //     );
        // if (!success) {
        //     revert ModuleInstallationFailed();
        // }
        // address module = abi.decode(returndata, (address));
        //
        // The major gas saving comes from saving on memory expansion gas by re-using the space
        // allocated for creating calldata for the sa.setupAndEnableModule call.
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            let savePtr := ptr

            // Store selector
            mstore(ptr, hex"5229073f") // execTransactionFromModuleReturnData(address,uint256,bytes,uint8)
            ptr := add(ptr, 0x4)

            // Store SA address and 0 for value
            mstore(ptr, caller())
            ptr := add(ptr, 0x40)

            // Store offset for calldata and 0 for Enum.Operation.Call
            mstore(ptr, 0x80)
            ptr := add(ptr, 0x40)

            // Create calldata for abi.encodeCall(sa.setupAndEnableModule, (_setupContract, _setupData))
            // Store length of calldata (notice that it's going to be the same length as checkSetupAndEnableModule calldata)
            let thisCallCalldataSize := calldatasize()
            mstore(ptr, thisCallCalldataSize)
            ptr := add(ptr, 0x20)

            // Store selector for sa.setupAndEnableModule
            mstore(ptr, hex"5305dd27") // setupAndEnableModule(address,bytes)
            ptr := add(ptr, 0x4)

            // Append parameters from checkSetupAndEnableModule calldata
            calldatacopy(ptr, 0x4, sub(thisCallCalldataSize, 0x4))
            ptr := add(ptr, sub(thisCallCalldataSize, 0x4))

            // Call execTransactionFromModuleReturnData
            let success := call(
                gas(),
                caller(),
                0,
                savePtr,
                sub(ptr, savePtr),
                0,
                0
            )

            ptr := savePtr

            // copy the returndata to ptr
            let size := returndatasize()
            returndatacopy(ptr, 0, size)

            switch success
            case 0x1 {
                moduleInstallationSuccess := mload(ptr)
                module := mload(add(ptr, 0x60))
            }
            case 0x0 {
                revert(ptr, size)
            }
        }

        if (!moduleInstallationSuccess) {
            // TODO: Needs to be tested
            revert ModuleInstallationFailed();
        }

        // Reject if the module is not a contract
        if (!module.isContract()) {
            revert ModuleIsNotAContract(module);
        }

        // Validate the module installed
        _validateSecurityPolicies(msg.sender, module);

        return module;
    }

    /// @inheritdoc ISecurityPolicyManagerPlugin
    function checkAndEnableModule(
        address _module
    ) external override returns (address) {
        // Reject if the module is not a contract
        if (!_module.isContract()) {
            revert ModuleIsNotAContract(_module);
        }

        // Validate the module installed
        _validateSecurityPolicies(msg.sender, _module);

        // Instruct the SA to install the module
        ISmartAccount sa = ISmartAccount(msg.sender);
        bool success = sa.execTransactionFromModule(
            msg.sender,
            0,
            abi.encodeCall(sa.enableModule, (_module)),
            Enum.Operation.Call
        );
        if (!success) {
            revert ModuleInstallationFailed();
        }

        return _module;
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
        address _sa,
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
                _sa
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

        // The calldata for each call to validateSecurityPolicy is the same, so we can save on gas by
        // creating it once and re-using it for each call.
        bytes memory validateSecurityPolicyCalldata = abi.encodeCall(
            ISecurityPolicyPlugin.validateSecurityPolicy,
            (_sa, _module)
        );

        while (current != address(0) && current != SENTINEL_MODULE_ADDRESS) {
            assembly ("memory-safe") {
                let success := call(
                    gas(),
                    current,
                    0,
                    add(validateSecurityPolicyCalldata, 0x20),
                    mload(validateSecurityPolicyCalldata),
                    0,
                    0
                )

                if iszero(success) {
                    let ptr := mload(0x40)
                    let size := returndatasize()
                    returndatacopy(ptr, 0, size)
                    revert(ptr, size)
                }
            }
            current = enabledSecurityPolicies[current];
        }

        emit ModuleValidated(_sa, _module);
    }
}
