// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {Vm} from "forge-std/Test.sol";
import {SATestBase} from "../../base/SATestBase.sol";
import {SmartAccount} from "sa/SmartAccount.sol";
import {SecurityPolicyManagerPlugin, SENTINEL_MODULE_ADDRESS} from "modules/SecurityPolicyManagerPlugin.sol";
import {ISecurityPolicyPlugin} from "interfaces/modules/ISecurityPolicyPlugin.sol";
import {ISecurityPolicyManagerPlugin, ISecurityPolicyManagerPluginEventsErrors} from "interfaces/modules/ISecurityPolicyManagerPlugin.sol";
import {UserOperation} from "aa-core/EntryPoint.sol";
import {MultichainECDSAValidator} from "modules/MultichainECDSAValidator.sol";
import "forge-std/console2.sol";

contract TestSecurityPolicyPlugin is ISecurityPolicyPlugin {
    bool public shouldRevert;
    bool public wasCalled;

    mapping(address => bool) public blacklist;

    constructor() {
        blacklist[address(0x2)] = true;
    }

    error TestSecurityPolicyPluginError(address);

    function validateSecurityPolicy(
        address,
        address _plugin
    ) external override {
        wasCalled = true;
        if (shouldRevert || blacklist[_plugin]) {
            revert TestSecurityPolicyPluginError(address(this));
        }
    }

    function setShouldRevert(bool _shouldRevert) external {
        shouldRevert = _shouldRevert;
    }
}

contract TestSetupContractBlacklistReturn {
    function initForSmartAccount(address) external view returns (address) {
        return address(0x2);
    }
}

contract SecurityPolicyManagerPluginModuleInstallationTest is
    SATestBase,
    ISecurityPolicyManagerPluginEventsErrors
{
    SmartAccount sa;
    SecurityPolicyManagerPlugin spmp;
    TestSecurityPolicyPlugin p1;
    TestSecurityPolicyPlugin p2;
    TestSecurityPolicyPlugin p3;
    TestSecurityPolicyPlugin p4;

    MultichainECDSAValidator validator;

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

        // Deploy SecurityPolicyManagerPlugin
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

        // Enable SecurityPolicy Manager Plugin
        UserOperation memory op = makeEcdsaModuleUserOp(
            getSmartAccountExecuteCalldata(
                address(sa),
                0,
                abi.encodeCall(sa.enableModule, address(spmp))
            ),
            sa,
            0,
            alice
        );
        entryPoint.handleOps(arraifyOps(op), owner.addr);

        // Enable p1, p2, p3, p4
        ISecurityPolicyPlugin[] memory policies = new ISecurityPolicyPlugin[](
            4
        );
        policies[0] = p1;
        policies[1] = p2;
        policies[2] = p3;
        policies[3] = p4;
        op = makeEcdsaModuleUserOp(
            getSmartAccountExecuteCalldata(
                address(spmp),
                0,
                abi.encodeCall(
                    ISecurityPolicyManagerPlugin.enableSecurityPolicies,
                    (policies)
                )
            ),
            sa,
            0,
            alice
        );
        entryPoint.handleOps(arraifyOps(op), owner.addr);

        // Create MultichainValidator
        validator = new MultichainECDSAValidator();
    }

    function testModuleInstallation() external {
        bytes memory setupData = abi.encodeCall(
            validator.initForSmartAccount,
            (alice.addr)
        );

        UserOperation memory op = makeEcdsaModuleUserOp(
            getSmartAccountExecuteCalldata(
                address(spmp),
                0,
                abi.encodeCall(
                    ISecurityPolicyManagerPlugin.checkSetupAndEnableModule,
                    (address(validator), setupData)
                )
            ),
            sa,
            0,
            alice
        );

        vm.expectEmit(true, true, true, true);
        emit ModuleValidated(address(sa), address(validator));

        entryPoint.handleOps(arraifyOps(op), owner.addr);

        assertTrue(p1.wasCalled());
        assertTrue(p2.wasCalled());
        assertTrue(p3.wasCalled());
        assertTrue(p4.wasCalled());
        assertTrue(sa.isModuleEnabled(address(validator)));
    }

    function testShouldRevertModuleInstallationIfSecurityPolicyIsNotSatisifedOnSetupContract()
        external
    {
        TestSetupContractBlacklistReturn blacklistReturn = new TestSetupContractBlacklistReturn();

        bytes memory setupData = abi.encodeCall(
            validator.initForSmartAccount,
            (alice.addr)
        );

        UserOperation memory op = makeEcdsaModuleUserOp(
            getSmartAccountExecuteCalldata(
                address(spmp),
                0,
                abi.encodeCall(
                    ISecurityPolicyManagerPlugin.checkSetupAndEnableModule,
                    (address(blacklistReturn), setupData)
                )
            ),
            sa,
            0,
            alice
        );

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
                    TestSecurityPolicyPlugin
                        .TestSecurityPolicyPluginError
                        .selector,
                    p4
                )
            )
        );

        assertFalse(sa.isModuleEnabled(address(validator)));
    }

    function testShouldRevertModuleInstallationIfSecurityPolicyIsNotSatisifedOnInstalledPlugin()
        external
    {
        bytes memory setupData = abi.encodeCall(
            validator.initForSmartAccount,
            (alice.addr)
        );

        UserOperation memory op = makeEcdsaModuleUserOp(
            getSmartAccountExecuteCalldata(
                address(spmp),
                0,
                abi.encodeCall(
                    ISecurityPolicyManagerPlugin.checkSetupAndEnableModule,
                    (address(validator), setupData)
                )
            ),
            sa,
            0,
            alice
        );

        p4.setShouldRevert(true);

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
                    TestSecurityPolicyPlugin
                        .TestSecurityPolicyPluginError
                        .selector,
                    p4
                )
            )
        );

        assertFalse(sa.isModuleEnabled(address(validator)));
    }
}
