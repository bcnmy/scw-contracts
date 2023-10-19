// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {Vm} from "forge-std/Test.sol";
import {SATestBase} from "../../base/SATestBase.sol";
import {SmartAccount} from "sa/SmartAccount.sol";
import {SecurityPolicyManagerPlugin, SENTINEL_MODULE_ADDRESS} from "modules/SecurityPolicyManagerPlugin.sol";
import {ISecurityPolicyPlugin} from "interfaces/modules/ISecurityPolicyPlugin.sol";
import {ISecurityPolicyManagerPlugin, ISecurityPolicyManagerPluginEventsErrors} from "interfaces/modules/ISecurityPolicyManagerPlugin.sol";
import {UserOperation} from "aa-core/EntryPoint.sol";
import "forge-std/console2.sol";

contract TestSecurityPolicyPlugin is ISecurityPolicyPlugin {
    function validateSecurityPolicy(address, address) external pure override {
        require(true);
    }
}

contract SecurityPolicyManagerPluginPluginManagementTest is
    SATestBase,
    ISecurityPolicyManagerPluginEventsErrors
{
    SmartAccount sa;
    SecurityPolicyManagerPlugin spmp;
    TestSecurityPolicyPlugin p1;
    TestSecurityPolicyPlugin p2;
    TestSecurityPolicyPlugin p3;
    TestSecurityPolicyPlugin p4;

    function setUp() public virtual override {
        super.setUp();

        // Deploy Smart Account with default module
        uint256 smartAccountDeploymentIndex = 0;
        bytes memory moduleSetupData = getEcdsaOwnershipRegistryModuleSetupData(
            alice.addr
        );
        sa = getSmartAccountWithModule(
            address(ecdsaOwnershipRegistryModule),
            moduleSetupData,
            smartAccountDeploymentIndex,
            "aliceSA"
        );
        spmp = new SecurityPolicyManagerPlugin();
        vm.label(address(spmp), "SecurityPolicyManagerPlugin");
        p1 = new TestSecurityPolicyPlugin();
        vm.label(address(p1), "p1");
        p2 = new TestSecurityPolicyPlugin();
        vm.label(address(p2), "p2");
        p3 = new TestSecurityPolicyPlugin();
        vm.label(address(p3), "p3");
        p4 = new TestSecurityPolicyPlugin();
        vm.label(address(p4), "p4");
    }

    function testEnableSingleSecurityPolicyPlugin() external {
        bytes memory data = getSmartAccountExecuteCalldata(
            address(spmp),
            0,
            abi.encodeCall(
                ISecurityPolicyManagerPlugin.enableSecurityPolicy,
                (p1)
            )
        );

        UserOperation memory op = makeEcdsaModuleUserOp(data, sa, 0, alice);

        vm.expectEmit(true, true, true, true);
        emit SecurityPolicyEnabled(address(sa), address(p1));

        entryPoint.handleOps(arraifyOps(op), owner.addr);

        ISecurityPolicyPlugin[] memory enabledSecurityPolicies = spmp
            .securityPoliciesPaginated(address(sa), address(0), 100);
        assertEq(enabledSecurityPolicies.length, 1);
        assertEq(address(enabledSecurityPolicies[0]), address(p1));
    }

    function testDisableSingleSecurityPolicyPlugin() external {
        // Enable p1,p2,p3,p4
        ISecurityPolicyPlugin[] memory policies = new ISecurityPolicyPlugin[](
            4
        );
        policies[0] = p1;
        policies[1] = p2;
        policies[2] = p3;
        policies[3] = p4;

        bytes memory data = getSmartAccountExecuteCalldata(
            address(spmp),
            0,
            abi.encodeCall(
                ISecurityPolicyManagerPlugin.enableSecurityPolicies,
                (policies)
            )
        );
        UserOperation memory op = makeEcdsaModuleUserOp(data, sa, 0, alice);
        entryPoint.handleOps(arraifyOps(op), owner.addr);

        // Disable p1
        data = getSmartAccountExecuteCalldata(
            address(spmp),
            0,
            abi.encodeCall(
                ISecurityPolicyManagerPlugin.disableSecurityPolicy,
                (p1, p2)
            )
        );
        op = makeEcdsaModuleUserOp(data, sa, 0, alice);

        vm.expectEmit(true, true, true, true);
        emit SecurityPolicyDisabled(address(sa), address(p1));

        entryPoint.handleOps(arraifyOps(op), owner.addr);

        ISecurityPolicyPlugin[] memory enabledSecurityPolicies = spmp
            .securityPoliciesPaginated(address(sa), address(0), 100);
        assertEq(enabledSecurityPolicies.length, 3);
        assertEq(address(enabledSecurityPolicies[0]), address(p4));
        assertEq(address(enabledSecurityPolicies[1]), address(p3));
        assertEq(address(enabledSecurityPolicies[2]), address(p2));
    }

    function testSecurityPoliciesQueryPaginated() external {
        // Enable p1, p2, p3, p4
        ISecurityPolicyPlugin[] memory policies = new ISecurityPolicyPlugin[](
            4
        );
        policies[0] = p1;
        policies[1] = p2;
        policies[2] = p3;
        policies[3] = p4;

        bytes memory data = getSmartAccountExecuteCalldata(
            address(spmp),
            0,
            abi.encodeCall(
                ISecurityPolicyManagerPlugin.enableSecurityPolicies,
                (policies)
            )
        );

        UserOperation memory op = makeEcdsaModuleUserOp(data, sa, 0, alice);
        entryPoint.handleOps(arraifyOps(op), owner.addr);

        // Page Size 100
        ISecurityPolicyPlugin[] memory enabledSecurityPolicies = spmp
            .securityPoliciesPaginated(address(sa), address(0), 100);
        assertEq(enabledSecurityPolicies.length, 4);
        assertEq(address(enabledSecurityPolicies[0]), address(p4));
        assertEq(address(enabledSecurityPolicies[1]), address(p3));
        assertEq(address(enabledSecurityPolicies[2]), address(p2));
        assertEq(address(enabledSecurityPolicies[3]), address(p1));

        // Page Size 4
        enabledSecurityPolicies = spmp.securityPoliciesPaginated(
            address(sa),
            address(0),
            4
        );
        assertEq(enabledSecurityPolicies.length, 4);
        assertEq(address(enabledSecurityPolicies[0]), address(p4));
        assertEq(address(enabledSecurityPolicies[1]), address(p3));
        assertEq(address(enabledSecurityPolicies[2]), address(p2));
        assertEq(address(enabledSecurityPolicies[3]), address(p1));

        // Page Size 3
        enabledSecurityPolicies = spmp.securityPoliciesPaginated(
            address(sa),
            address(0),
            3
        );
        assertEq(enabledSecurityPolicies.length, 3);
        assertEq(address(enabledSecurityPolicies[0]), address(p4));
        assertEq(address(enabledSecurityPolicies[1]), address(p3));
        assertEq(address(enabledSecurityPolicies[2]), address(p2));
        enabledSecurityPolicies = spmp.securityPoliciesPaginated(
            address(sa),
            address(enabledSecurityPolicies[2]),
            3
        );
        assertEq(enabledSecurityPolicies.length, 2);
        assertEq(address(enabledSecurityPolicies[0]), address(p2));
        assertEq(address(enabledSecurityPolicies[1]), address(p1));

        // Page Size 2
        enabledSecurityPolicies = spmp.securityPoliciesPaginated(
            address(sa),
            address(0),
            2
        );
        assertEq(enabledSecurityPolicies.length, 2);
        assertEq(address(enabledSecurityPolicies[0]), address(p4));
        assertEq(address(enabledSecurityPolicies[1]), address(p3));
        enabledSecurityPolicies = spmp.securityPoliciesPaginated(
            address(sa),
            address(p2),
            2
        );
        assertEq(enabledSecurityPolicies.length, 2);
        assertEq(address(enabledSecurityPolicies[0]), address(p2));
        assertEq(address(enabledSecurityPolicies[1]), address(p1));

        // Page Size 1
        enabledSecurityPolicies = spmp.securityPoliciesPaginated(
            address(sa),
            address(p4),
            1
        );
        assertEq(enabledSecurityPolicies.length, 1);
        assertEq(address(enabledSecurityPolicies[0]), address(p4));
        enabledSecurityPolicies = spmp.securityPoliciesPaginated(
            address(sa),
            address(p3),
            1
        );
        assertEq(enabledSecurityPolicies.length, 1);
        assertEq(address(enabledSecurityPolicies[0]), address(p3));
        enabledSecurityPolicies = spmp.securityPoliciesPaginated(
            address(sa),
            address(p2),
            1
        );
        assertEq(enabledSecurityPolicies.length, 1);
        assertEq(address(enabledSecurityPolicies[0]), address(p2));
        enabledSecurityPolicies = spmp.securityPoliciesPaginated(
            address(sa),
            address(p1),
            1
        );
        assertEq(enabledSecurityPolicies.length, 1);
        assertEq(address(enabledSecurityPolicies[0]), address(p1));
    }

    function testDisableSingleSecurityPolicyPluginsRange() external {
        // Enable p1,p2,p3,p4
        ISecurityPolicyPlugin[] memory policies = new ISecurityPolicyPlugin[](
            4
        );
        policies[0] = p1;
        policies[1] = p2;
        policies[2] = p3;
        policies[3] = p4;

        bytes memory data = getSmartAccountExecuteCalldata(
            address(spmp),
            0,
            abi.encodeCall(
                ISecurityPolicyManagerPlugin.enableSecurityPolicies,
                (policies)
            )
        );
        UserOperation memory op = makeEcdsaModuleUserOp(data, sa, 0, alice);
        entryPoint.handleOps(arraifyOps(op), owner.addr);

        // Disable p3,p2
        data = getSmartAccountExecuteCalldata(
            address(spmp),
            0,
            abi.encodeCall(
                ISecurityPolicyManagerPlugin.disableSecurityPoliciesRange,
                (p3, p2, p4)
            )
        );
        op = makeEcdsaModuleUserOp(data, sa, 0, alice);

        vm.expectEmit(true, true, true, true);
        emit SecurityPolicyDisabled(address(sa), address(p3));
        emit SecurityPolicyDisabled(address(sa), address(p2));

        entryPoint.handleOps(arraifyOps(op), owner.addr);

        ISecurityPolicyPlugin[] memory enabledSecurityPolicies = spmp
            .securityPoliciesPaginated(address(sa), address(0), 100);
        assertEq(enabledSecurityPolicies.length, 2);
        assertEq(address(enabledSecurityPolicies[0]), address(p4));
        assertEq(address(enabledSecurityPolicies[1]), address(p1));

        // Disable p4,p1
        data = getSmartAccountExecuteCalldata(
            address(spmp),
            0,
            abi.encodeCall(
                ISecurityPolicyManagerPlugin.disableSecurityPoliciesRange,
                (p4, p1, ISecurityPolicyPlugin(SENTINEL_MODULE_ADDRESS))
            )
        );
        op = makeEcdsaModuleUserOp(data, sa, 0, alice);

        vm.expectEmit(true, true, true, true);
        emit SecurityPolicyDisabled(address(sa), address(p4));
        emit SecurityPolicyDisabled(address(sa), address(p1));

        entryPoint.handleOps(arraifyOps(op), owner.addr);

        enabledSecurityPolicies = spmp.securityPoliciesPaginated(
            address(sa),
            address(0),
            100
        );
        assertEq(enabledSecurityPolicies.length, 0);
    }

    function testEnableMultipleSecurityPolicyPlugins() external {
        // Enable p1, p2
        ISecurityPolicyPlugin[] memory policies = new ISecurityPolicyPlugin[](
            2
        );
        policies[0] = p1;
        policies[1] = p2;

        bytes memory data = getSmartAccountExecuteCalldata(
            address(spmp),
            0,
            abi.encodeCall(
                ISecurityPolicyManagerPlugin.enableSecurityPolicies,
                (policies)
            )
        );

        UserOperation memory op = makeEcdsaModuleUserOp(data, sa, 0, alice);

        vm.expectEmit(true, true, true, true);
        emit SecurityPolicyEnabled(address(sa), address(p1));
        vm.expectEmit(true, true, true, true);
        emit SecurityPolicyEnabled(address(sa), address(p2));

        entryPoint.handleOps(arraifyOps(op), owner.addr);

        ISecurityPolicyPlugin[] memory enabledSecurityPolicies = spmp
            .securityPoliciesPaginated(address(sa), address(0), 100);
        assertEq(enabledSecurityPolicies.length, 2);
        assertEq(address(enabledSecurityPolicies[0]), address(p2));
        assertEq(address(enabledSecurityPolicies[1]), address(p1));

        // Enable p3, p4
        policies[0] = p3;
        policies[1] = p4;

        data = getSmartAccountExecuteCalldata(
            address(spmp),
            0,
            abi.encodeCall(
                ISecurityPolicyManagerPlugin.enableSecurityPolicies,
                (policies)
            )
        );

        op = makeEcdsaModuleUserOp(data, sa, 0, alice);

        vm.expectEmit(true, true, true, true);
        emit SecurityPolicyEnabled(address(sa), address(p3));
        vm.expectEmit(true, true, true, true);
        emit SecurityPolicyEnabled(address(sa), address(p4));

        entryPoint.handleOps(arraifyOps(op), owner.addr);

        enabledSecurityPolicies = spmp.securityPoliciesPaginated(
            address(sa),
            address(0),
            100
        );
        assertEq(enabledSecurityPolicies.length, 4);
        assertEq(address(enabledSecurityPolicies[0]), address(p4));
        assertEq(address(enabledSecurityPolicies[1]), address(p3));
        assertEq(address(enabledSecurityPolicies[2]), address(p2));
        assertEq(address(enabledSecurityPolicies[3]), address(p1));
    }

    function testAddAndRemoveAllPolicies() external {
        // Enable p1,p2,p3,p4
        ISecurityPolicyPlugin[] memory policies = new ISecurityPolicyPlugin[](
            4
        );
        policies[0] = p1;
        policies[1] = p2;
        policies[2] = p3;
        policies[3] = p4;

        bytes memory data = getSmartAccountExecuteCalldata(
            address(spmp),
            0,
            abi.encodeCall(
                ISecurityPolicyManagerPlugin.enableSecurityPolicies,
                (policies)
            )
        );
        UserOperation memory op = makeEcdsaModuleUserOp(data, sa, 0, alice);
        entryPoint.handleOps(arraifyOps(op), owner.addr);

        // Disable p1,p2,p3,p4
        data = getSmartAccountExecuteCalldata(
            address(spmp),
            0,
            abi.encodeCall(
                ISecurityPolicyManagerPlugin.disableSecurityPoliciesRange,
                (p4, p1, ISecurityPolicyPlugin(SENTINEL_MODULE_ADDRESS))
            )
        );
        op = makeEcdsaModuleUserOp(data, sa, 0, alice);

        vm.expectEmit(true, true, true, true);
        emit SecurityPolicyDisabled(address(sa), address(p4));
        emit SecurityPolicyDisabled(address(sa), address(p3));
        emit SecurityPolicyDisabled(address(sa), address(p2));
        emit SecurityPolicyDisabled(address(sa), address(p1));

        entryPoint.handleOps(arraifyOps(op), owner.addr);

        ISecurityPolicyPlugin[] memory enabledSecurityPolicies = spmp
            .securityPoliciesPaginated(address(sa), address(0), 100);
        assertEq(enabledSecurityPolicies.length, 0);

        // Enable p1,p2,p3,p4
        policies = new ISecurityPolicyPlugin[](4);
        policies[0] = p1;
        policies[1] = p2;
        policies[2] = p3;
        policies[3] = p4;

        data = getSmartAccountExecuteCalldata(
            address(spmp),
            0,
            abi.encodeCall(
                ISecurityPolicyManagerPlugin.enableSecurityPolicies,
                (policies)
            )
        );
        op = makeEcdsaModuleUserOp(data, sa, 0, alice);
        entryPoint.handleOps(arraifyOps(op), owner.addr);

        // Disable p1,p2,p3,p4
        data = getSmartAccountExecuteCalldata(
            address(spmp),
            0,
            abi.encodeCall(
                ISecurityPolicyManagerPlugin.disableSecurityPoliciesRange,
                (p4, p1, ISecurityPolicyPlugin(SENTINEL_MODULE_ADDRESS))
            )
        );
        op = makeEcdsaModuleUserOp(data, sa, 0, alice);

        vm.expectEmit(true, true, true, true);
        emit SecurityPolicyDisabled(address(sa), address(p4));
        emit SecurityPolicyDisabled(address(sa), address(p3));
        emit SecurityPolicyDisabled(address(sa), address(p2));
        emit SecurityPolicyDisabled(address(sa), address(p1));

        entryPoint.handleOps(arraifyOps(op), owner.addr);

        enabledSecurityPolicies = spmp.securityPoliciesPaginated(
            address(sa),
            address(0),
            100
        );
        assertEq(enabledSecurityPolicies.length, 0);
    }

    function testShouldNotAllowEmptyEnableList() external {
        ISecurityPolicyPlugin[] memory policies = new ISecurityPolicyPlugin[](
            0
        );
        bytes memory data = getSmartAccountExecuteCalldata(
            address(spmp),
            0,
            abi.encodeCall(
                ISecurityPolicyManagerPlugin.enableSecurityPolicies,
                (policies)
            )
        );

        UserOperation memory op = makeEcdsaModuleUserOp(data, sa, 0, alice);

        vm.recordLogs();
        entryPoint.handleOps(arraifyOps(op), owner.addr);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        UserOperationEventData memory eventData = getUserOperationEventData(
            logs
        );
        assertFalse(eventData.success);
        UserOperationRevertReasonEventData
            memory revertReasonEventData = getUserOperationRevertReasonEventData(
                logs
            );
        assertEq(
            keccak256(revertReasonEventData.revertReason),
            keccak256(abi.encodePacked(EmptyPolicyList.selector))
        );

        ISecurityPolicyPlugin[] memory enabledSecurityPolicies = spmp
            .securityPoliciesPaginated(address(sa), address(0), 100);
        assertEq(enabledSecurityPolicies.length, 0);
    }

    function testShouldNotAllowPolicyAdditionWithZeroAddressSingle() external {
        ISecurityPolicyPlugin policy = ISecurityPolicyPlugin(address(0x0));
        bytes memory data = getSmartAccountExecuteCalldata(
            address(spmp),
            0,
            abi.encodeCall(
                ISecurityPolicyManagerPlugin.enableSecurityPolicy,
                (policy)
            )
        );

        UserOperation memory op = makeEcdsaModuleUserOp(data, sa, 0, alice);

        vm.recordLogs();
        entryPoint.handleOps(arraifyOps(op), owner.addr);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        UserOperationEventData memory eventData = getUserOperationEventData(
            logs
        );
        assertFalse(eventData.success);
        UserOperationRevertReasonEventData
            memory revertReasonEventData = getUserOperationRevertReasonEventData(
                logs
            );
        assertEq(
            keccak256(revertReasonEventData.revertReason),
            keccak256(
                abi.encodeWithSelector(
                    InvalidSecurityPolicyAddress.selector,
                    policy
                )
            )
        );

        ISecurityPolicyPlugin[] memory enabledSecurityPolicies = spmp
            .securityPoliciesPaginated(address(sa), address(0), 100);
        assertEq(enabledSecurityPolicies.length, 0);
    }

    function testShouldNotAllowPolicyAdditionWithZeroAddressMulti() external {
        ISecurityPolicyPlugin[] memory policies = new ISecurityPolicyPlugin[](
            1
        );
        policies[0] = ISecurityPolicyPlugin(address(0x0));
        bytes memory data = getSmartAccountExecuteCalldata(
            address(spmp),
            0,
            abi.encodeCall(
                ISecurityPolicyManagerPlugin.enableSecurityPolicies,
                (policies)
            )
        );

        UserOperation memory op = makeEcdsaModuleUserOp(data, sa, 0, alice);

        vm.recordLogs();
        entryPoint.handleOps(arraifyOps(op), owner.addr);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        UserOperationEventData memory eventData = getUserOperationEventData(
            logs
        );
        assertFalse(eventData.success);
        UserOperationRevertReasonEventData
            memory revertReasonEventData = getUserOperationRevertReasonEventData(
                logs
            );
        assertEq(
            keccak256(revertReasonEventData.revertReason),
            keccak256(
                abi.encodeWithSelector(
                    InvalidSecurityPolicyAddress.selector,
                    policies[0]
                )
            )
        );

        ISecurityPolicyPlugin[] memory enabledSecurityPolicies = spmp
            .securityPoliciesPaginated(address(sa), address(0), 100);
        assertEq(enabledSecurityPolicies.length, 0);
    }

    function testShouldNotAllowPolicyAdditionWithSentinelAddressSingle()
        external
    {
        ISecurityPolicyPlugin policy = ISecurityPolicyPlugin(
            SENTINEL_MODULE_ADDRESS
        );
        bytes memory data = getSmartAccountExecuteCalldata(
            address(spmp),
            0,
            abi.encodeCall(
                ISecurityPolicyManagerPlugin.enableSecurityPolicy,
                (policy)
            )
        );

        UserOperation memory op = makeEcdsaModuleUserOp(data, sa, 0, alice);

        vm.recordLogs();
        entryPoint.handleOps(arraifyOps(op), owner.addr);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        UserOperationEventData memory eventData = getUserOperationEventData(
            logs
        );
        assertFalse(eventData.success);
        UserOperationRevertReasonEventData
            memory revertReasonEventData = getUserOperationRevertReasonEventData(
                logs
            );
        assertEq(
            keccak256(revertReasonEventData.revertReason),
            keccak256(
                abi.encodeWithSelector(
                    InvalidSecurityPolicyAddress.selector,
                    policy
                )
            )
        );

        ISecurityPolicyPlugin[] memory enabledSecurityPolicies = spmp
            .securityPoliciesPaginated(address(sa), address(0), 100);
        assertEq(enabledSecurityPolicies.length, 0);
    }

    function testShouldNotAllowPolicyAdditionWithSentinelAddressMulti()
        external
    {
        ISecurityPolicyPlugin[] memory policies = new ISecurityPolicyPlugin[](
            1
        );
        policies[0] = ISecurityPolicyPlugin(SENTINEL_MODULE_ADDRESS);
        bytes memory data = getSmartAccountExecuteCalldata(
            address(spmp),
            0,
            abi.encodeCall(
                ISecurityPolicyManagerPlugin.enableSecurityPolicies,
                (policies)
            )
        );

        UserOperation memory op = makeEcdsaModuleUserOp(data, sa, 0, alice);

        vm.recordLogs();
        entryPoint.handleOps(arraifyOps(op), owner.addr);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        UserOperationEventData memory eventData = getUserOperationEventData(
            logs
        );
        assertFalse(eventData.success);
        UserOperationRevertReasonEventData
            memory revertReasonEventData = getUserOperationRevertReasonEventData(
                logs
            );
        assertEq(
            keccak256(revertReasonEventData.revertReason),
            keccak256(
                abi.encodeWithSelector(
                    InvalidSecurityPolicyAddress.selector,
                    policies[0]
                )
            )
        );

        ISecurityPolicyPlugin[] memory enabledSecurityPolicies = spmp
            .securityPoliciesPaginated(address(sa), address(0), 100);
        assertEq(enabledSecurityPolicies.length, 0);
    }

    function testShouldNotAllowDisablingZeroAddressPolicySingleDisable()
        external
    {
        // Enable p1,p2,p3,p4
        ISecurityPolicyPlugin[] memory policies = new ISecurityPolicyPlugin[](
            4
        );
        policies[0] = p1;
        policies[1] = p2;
        policies[2] = p3;
        policies[3] = p4;

        bytes memory data = getSmartAccountExecuteCalldata(
            address(spmp),
            0,
            abi.encodeCall(
                ISecurityPolicyManagerPlugin.enableSecurityPolicies,
                (policies)
            )
        );
        UserOperation memory op = makeEcdsaModuleUserOp(data, sa, 0, alice);
        entryPoint.handleOps(arraifyOps(op), owner.addr);

        // Disable address(0)
        data = getSmartAccountExecuteCalldata(
            address(spmp),
            0,
            abi.encodeCall(
                ISecurityPolicyManagerPlugin.disableSecurityPolicy,
                (ISecurityPolicyPlugin(address(0)), p4)
            )
        );

        op = makeEcdsaModuleUserOp(data, sa, 0, alice);

        vm.recordLogs();
        entryPoint.handleOps(arraifyOps(op), owner.addr);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        UserOperationEventData memory eventData = getUserOperationEventData(
            logs
        );
        assertFalse(eventData.success);
        UserOperationRevertReasonEventData
            memory revertReasonEventData = getUserOperationRevertReasonEventData(
                logs
            );
        assertEq(
            keccak256(revertReasonEventData.revertReason),
            keccak256(
                abi.encodeWithSelector(
                    InvalidSecurityPolicyAddress.selector,
                    ISecurityPolicyPlugin(address(0))
                )
            )
        );

        ISecurityPolicyPlugin[] memory enabledSecurityPolicies = spmp
            .securityPoliciesPaginated(address(sa), address(0), 100);
        assertEq(enabledSecurityPolicies.length, 4);
        assertEq(address(enabledSecurityPolicies[0]), address(p4));
        assertEq(address(enabledSecurityPolicies[1]), address(p3));
        assertEq(address(enabledSecurityPolicies[2]), address(p2));
        assertEq(address(enabledSecurityPolicies[3]), address(p1));
    }

    function testShouldNotAllowDisablingSentinelAddressPolicySingleDisable()
        external
    {
        // Enable p1,p2,p3,p4
        ISecurityPolicyPlugin[] memory policies = new ISecurityPolicyPlugin[](
            4
        );
        policies[0] = p1;
        policies[1] = p2;
        policies[2] = p3;
        policies[3] = p4;

        bytes memory data = getSmartAccountExecuteCalldata(
            address(spmp),
            0,
            abi.encodeCall(
                ISecurityPolicyManagerPlugin.enableSecurityPolicies,
                (policies)
            )
        );
        UserOperation memory op = makeEcdsaModuleUserOp(data, sa, 0, alice);
        entryPoint.handleOps(arraifyOps(op), owner.addr);

        // Disable SENTINEL_MODULE_ADDRESS
        data = getSmartAccountExecuteCalldata(
            address(spmp),
            0,
            abi.encodeCall(
                ISecurityPolicyManagerPlugin.disableSecurityPolicy,
                (ISecurityPolicyPlugin(SENTINEL_MODULE_ADDRESS), p4)
            )
        );

        op = makeEcdsaModuleUserOp(data, sa, 0, alice);

        vm.recordLogs();
        entryPoint.handleOps(arraifyOps(op), owner.addr);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        UserOperationEventData memory eventData = getUserOperationEventData(
            logs
        );
        assertFalse(eventData.success);
        UserOperationRevertReasonEventData
            memory revertReasonEventData = getUserOperationRevertReasonEventData(
                logs
            );
        assertEq(
            keccak256(revertReasonEventData.revertReason),
            keccak256(
                abi.encodeWithSelector(
                    InvalidSecurityPolicyAddress.selector,
                    ISecurityPolicyPlugin(SENTINEL_MODULE_ADDRESS)
                )
            )
        );

        ISecurityPolicyPlugin[] memory enabledSecurityPolicies = spmp
            .securityPoliciesPaginated(address(sa), address(0), 100);
        assertEq(enabledSecurityPolicies.length, 4);
        assertEq(address(enabledSecurityPolicies[0]), address(p4));
        assertEq(address(enabledSecurityPolicies[1]), address(p3));
        assertEq(address(enabledSecurityPolicies[2]), address(p2));
        assertEq(address(enabledSecurityPolicies[3]), address(p1));
    }

    function testShouldNotAllowDisablingAlreadyDisabledPolicySingleDisable()
        external
    {
        // Enable p1,p2,p3
        ISecurityPolicyPlugin[] memory policies = new ISecurityPolicyPlugin[](
            3
        );
        policies[0] = p1;
        policies[1] = p2;
        policies[2] = p3;

        bytes memory data = getSmartAccountExecuteCalldata(
            address(spmp),
            0,
            abi.encodeCall(
                ISecurityPolicyManagerPlugin.enableSecurityPolicies,
                (policies)
            )
        );
        UserOperation memory op = makeEcdsaModuleUserOp(data, sa, 0, alice);
        entryPoint.handleOps(arraifyOps(op), owner.addr);

        // Disable p4
        data = getSmartAccountExecuteCalldata(
            address(spmp),
            0,
            abi.encodeCall(
                ISecurityPolicyManagerPlugin.disableSecurityPolicy,
                (p4, p4)
            )
        );

        op = makeEcdsaModuleUserOp(data, sa, 0, alice);

        vm.recordLogs();
        entryPoint.handleOps(arraifyOps(op), owner.addr);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        UserOperationEventData memory eventData = getUserOperationEventData(
            logs
        );
        assertFalse(eventData.success);
        UserOperationRevertReasonEventData
            memory revertReasonEventData = getUserOperationRevertReasonEventData(
                logs
            );
        assertEq(
            keccak256(revertReasonEventData.revertReason),
            keccak256(
                abi.encodeWithSelector(
                    SecurityPolicyAlreadyDisabled.selector,
                    ISecurityPolicyPlugin(p4)
                )
            )
        );

        ISecurityPolicyPlugin[] memory enabledSecurityPolicies = spmp
            .securityPoliciesPaginated(address(sa), address(0), 100);
        assertEq(enabledSecurityPolicies.length, 3);
        assertEq(address(enabledSecurityPolicies[0]), address(p3));
        assertEq(address(enabledSecurityPolicies[1]), address(p2));
        assertEq(address(enabledSecurityPolicies[2]), address(p1));
    }

    function testShouldNotAllowDisablingWithInvalidPointerSingleDisable()
        external
    {
        // Enable p1,p2,p3,p4
        ISecurityPolicyPlugin[] memory policies = new ISecurityPolicyPlugin[](
            4
        );
        policies[0] = p1;
        policies[1] = p2;
        policies[2] = p3;
        policies[3] = p4;

        bytes memory data = getSmartAccountExecuteCalldata(
            address(spmp),
            0,
            abi.encodeCall(
                ISecurityPolicyManagerPlugin.enableSecurityPolicies,
                (policies)
            )
        );
        UserOperation memory op = makeEcdsaModuleUserOp(data, sa, 0, alice);
        entryPoint.handleOps(arraifyOps(op), owner.addr);

        // Disable p3
        data = getSmartAccountExecuteCalldata(
            address(spmp),
            0,
            abi.encodeCall(
                ISecurityPolicyManagerPlugin.disableSecurityPolicy,
                (p3, p2)
            )
        );

        op = makeEcdsaModuleUserOp(data, sa, 0, alice);

        vm.recordLogs();
        entryPoint.handleOps(arraifyOps(op), owner.addr);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        UserOperationEventData memory eventData = getUserOperationEventData(
            logs
        );
        assertFalse(eventData.success);
        UserOperationRevertReasonEventData
            memory revertReasonEventData = getUserOperationRevertReasonEventData(
                logs
            );
        assertEq(
            keccak256(revertReasonEventData.revertReason),
            keccak256(
                abi.encodeWithSelector(InvalidPointerAddress.selector, p2)
            )
        );

        ISecurityPolicyPlugin[] memory enabledSecurityPolicies = spmp
            .securityPoliciesPaginated(address(sa), address(0), 100);
        assertEq(enabledSecurityPolicies.length, 4);
        assertEq(address(enabledSecurityPolicies[0]), address(p4));
        assertEq(address(enabledSecurityPolicies[1]), address(p3));
        assertEq(address(enabledSecurityPolicies[2]), address(p2));
        assertEq(address(enabledSecurityPolicies[3]), address(p1));
    }

    function testShouldNotAllowDisablingRangeWithInvalidRange() external {
        // Enable p1,p2,p3,p4
        ISecurityPolicyPlugin[] memory policies = new ISecurityPolicyPlugin[](
            4
        );
        policies[0] = p1;
        policies[1] = p2;
        policies[2] = p3;
        policies[3] = p4;

        bytes memory data = getSmartAccountExecuteCalldata(
            address(spmp),
            0,
            abi.encodeCall(
                ISecurityPolicyManagerPlugin.enableSecurityPolicies,
                (policies)
            )
        );
        UserOperation memory op = makeEcdsaModuleUserOp(data, sa, 0, alice);
        entryPoint.handleOps(arraifyOps(op), owner.addr);

        // Disable p1->p4
        data = getSmartAccountExecuteCalldata(
            address(spmp),
            0,
            abi.encodeCall(
                ISecurityPolicyManagerPlugin.disableSecurityPoliciesRange,
                (p1, p4, p2)
            )
        );
        op = makeEcdsaModuleUserOp(data, sa, 0, alice);

        vm.recordLogs();
        entryPoint.handleOps(arraifyOps(op), owner.addr);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        UserOperationEventData memory eventData = getUserOperationEventData(
            logs
        );
        assertFalse(eventData.success);
        UserOperationRevertReasonEventData
            memory revertReasonEventData = getUserOperationRevertReasonEventData(
                logs
            );
        assertEq(
            keccak256(revertReasonEventData.revertReason),
            keccak256(
                abi.encodeWithSelector(
                    InvalidSecurityPolicyAddress.selector,
                    p4
                )
            )
        );

        ISecurityPolicyPlugin[] memory enabledSecurityPolicies = spmp
            .securityPoliciesPaginated(address(sa), address(0), 100);
        assertEq(enabledSecurityPolicies.length, 4);
        assertEq(address(enabledSecurityPolicies[0]), address(p4));
        assertEq(address(enabledSecurityPolicies[1]), address(p3));
        assertEq(address(enabledSecurityPolicies[2]), address(p2));
        assertEq(address(enabledSecurityPolicies[3]), address(p1));
    }

    function testShouldNotAllowDisablingRangeWithInvalidPointer() external {
        // Enable p1,p2,p3,p4
        ISecurityPolicyPlugin[] memory policies = new ISecurityPolicyPlugin[](
            4
        );
        policies[0] = p1;
        policies[1] = p2;
        policies[2] = p3;
        policies[3] = p4;

        bytes memory data = getSmartAccountExecuteCalldata(
            address(spmp),
            0,
            abi.encodeCall(
                ISecurityPolicyManagerPlugin.enableSecurityPolicies,
                (policies)
            )
        );
        UserOperation memory op = makeEcdsaModuleUserOp(data, sa, 0, alice);
        entryPoint.handleOps(arraifyOps(op), owner.addr);

        // Disable p4->p1
        data = getSmartAccountExecuteCalldata(
            address(spmp),
            0,
            abi.encodeCall(
                ISecurityPolicyManagerPlugin.disableSecurityPoliciesRange,
                (p4, p1, p2)
            )
        );
        op = makeEcdsaModuleUserOp(data, sa, 0, alice);

        vm.recordLogs();
        entryPoint.handleOps(arraifyOps(op), owner.addr);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        UserOperationEventData memory eventData = getUserOperationEventData(
            logs
        );
        assertFalse(eventData.success);
        UserOperationRevertReasonEventData
            memory revertReasonEventData = getUserOperationRevertReasonEventData(
                logs
            );
        assertEq(
            keccak256(revertReasonEventData.revertReason),
            keccak256(
                abi.encodeWithSelector(InvalidPointerAddress.selector, p2)
            )
        );

        ISecurityPolicyPlugin[] memory enabledSecurityPolicies = spmp
            .securityPoliciesPaginated(address(sa), address(0), 100);
        assertEq(enabledSecurityPolicies.length, 4);
        assertEq(address(enabledSecurityPolicies[0]), address(p4));
        assertEq(address(enabledSecurityPolicies[1]), address(p3));
        assertEq(address(enabledSecurityPolicies[2]), address(p2));
        assertEq(address(enabledSecurityPolicies[3]), address(p1));
    }

    function testShouldNotAllowEnablingAlreadyEnabledPolicySingleEnable()
        external
    {
        bytes memory data = getSmartAccountExecuteCalldata(
            address(spmp),
            0,
            abi.encodeCall(
                ISecurityPolicyManagerPlugin.enableSecurityPolicy,
                (p1)
            )
        );

        UserOperation memory op = makeEcdsaModuleUserOp(data, sa, 0, alice);
        entryPoint.handleOps(arraifyOps(op), owner.addr);

        op = makeEcdsaModuleUserOp(data, sa, 0, alice);

        vm.recordLogs();
        entryPoint.handleOps(arraifyOps(op), owner.addr);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        UserOperationEventData memory eventData = getUserOperationEventData(
            logs
        );
        assertFalse(eventData.success);
        UserOperationRevertReasonEventData
            memory revertReasonEventData = getUserOperationRevertReasonEventData(
                logs
            );
        assertEq(
            keccak256(revertReasonEventData.revertReason),
            keccak256(
                abi.encodeWithSelector(
                    SecurityPolicyAlreadyEnabled.selector,
                    p1
                )
            )
        );
    }

    function testShouldNotAllowEnablingAlreadyEnabledPolicySMultiEnable()
        external
    {
        bytes memory data = getSmartAccountExecuteCalldata(
            address(spmp),
            0,
            abi.encodeCall(
                ISecurityPolicyManagerPlugin.enableSecurityPolicy,
                (p1)
            )
        );
        UserOperation memory op = makeEcdsaModuleUserOp(data, sa, 0, alice);
        entryPoint.handleOps(arraifyOps(op), owner.addr);

        ISecurityPolicyPlugin[] memory policies = new ISecurityPolicyPlugin[](
            1
        );
        policies[0] = p1;
        data = getSmartAccountExecuteCalldata(
            address(spmp),
            0,
            abi.encodeCall(
                ISecurityPolicyManagerPlugin.enableSecurityPolicies,
                (policies)
            )
        );
        op = makeEcdsaModuleUserOp(data, sa, 0, alice);

        vm.recordLogs();
        entryPoint.handleOps(arraifyOps(op), owner.addr);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        UserOperationEventData memory eventData = getUserOperationEventData(
            logs
        );
        assertFalse(eventData.success);
        UserOperationRevertReasonEventData
            memory revertReasonEventData = getUserOperationRevertReasonEventData(
                logs
            );
        assertEq(
            keccak256(revertReasonEventData.revertReason),
            keccak256(
                abi.encodeWithSelector(
                    SecurityPolicyAlreadyEnabled.selector,
                    p1
                )
            )
        );
    }

    function testShouldNotAllowDisablingAlreadyEnabledPolicySingleDisable()
        external
    {
        bytes memory data = getSmartAccountExecuteCalldata(
            address(spmp),
            0,
            abi.encodeCall(
                ISecurityPolicyManagerPlugin.disableSecurityPolicy,
                (p1, p2)
            )
        );

        UserOperation memory op = makeEcdsaModuleUserOp(data, sa, 0, alice);

        vm.recordLogs();
        entryPoint.handleOps(arraifyOps(op), owner.addr);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        UserOperationEventData memory eventData = getUserOperationEventData(
            logs
        );
        assertFalse(eventData.success);
        UserOperationRevertReasonEventData
            memory revertReasonEventData = getUserOperationRevertReasonEventData(
                logs
            );
        assertEq(
            keccak256(revertReasonEventData.revertReason),
            keccak256(
                abi.encodeWithSelector(
                    SecurityPolicyAlreadyDisabled.selector,
                    p1
                )
            )
        );
    }
}
