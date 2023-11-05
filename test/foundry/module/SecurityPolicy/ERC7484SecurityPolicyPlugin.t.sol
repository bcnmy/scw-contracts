// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import {RhinestoneTestBase, RegistryTestLib, RegistryInstance, AttestationRequestData} from "../../base/RhinestoneTestBase.sol";
import {SmartAccount} from "sa/SmartAccount.sol";
import {UserOperation} from "aa-core/EntryPoint.sol";
import {ERC7484SecurityPolicyPlugin, IERC7484SecurityPolicyPlugin} from "modules/SecurityPolicies/ERC7484SecurityPolicy.sol";
import {IERC7484SecurityPolicyPluginEventsErrors} from "interfaces/modules/IERC7484SecurityPolicyPlugin.sol";
import {ISecurityPolicyManagerPlugin, ISecurityPolicyManagerPluginEventsErrors} from "interfaces/modules/ISecurityPolicyManagerPlugin.sol";
import {ISecurityPolicyPlugin} from "interfaces/modules/ISecurityPolicyManagerPlugin.sol";
import {SecurityPolicyManagerPlugin, SENTINEL_MODULE_ADDRESS} from "modules/SecurityPolicyManagerPlugin.sol";
import {MultichainECDSAValidator} from "modules/MultichainECDSAValidator.sol";
import {IQuery} from "lib/registry/src/interface/IQuery.sol";
import {Vm} from "forge-std/Test.sol";

contract ERC7484SecurityPolicyPluginTest is
    RhinestoneTestBase,
    ISecurityPolicyManagerPluginEventsErrors,
    IERC7484SecurityPolicyPluginEventsErrors
{
    using RegistryTestLib for RegistryInstance;

    SmartAccount sa;
    SecurityPolicyManagerPlugin spmp;
    ERC7484SecurityPolicyPlugin erc7484SecurityPolicyPlugin;

    IERC7484SecurityPolicyPlugin.Configuration defaultConfig;
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

        // Deploy ERC7484SecurityPolicyPlugin
        erc7484SecurityPolicyPlugin = new ERC7484SecurityPolicyPlugin(
            instancel1.registry
        );

        // Enable the Security Policy
        op = makeEcdsaModuleUserOp(
            getSmartAccountExecuteCalldata(
                address(spmp),
                0,
                abi.encodeCall(
                    SecurityPolicyManagerPlugin.enableSecurityPolicy,
                    (erc7484SecurityPolicyPlugin)
                )
            ),
            sa,
            0,
            alice
        );
        entryPoint.handleOps(arraifyOps(op), owner.addr);

        // Prepare and set the default configuration
        defaultConfig.threshold = 3;
        defaultConfig.trustedAttesters = new address[](5);
        defaultConfig.trustedAttesters[0] = bob.addr;
        defaultConfig.trustedAttesters[1] = charlie.addr;
        defaultConfig.trustedAttesters[2] = dan.addr;
        defaultConfig.trustedAttesters[3] = emma.addr;
        defaultConfig.trustedAttesters[4] = frank.addr;

        op = makeEcdsaModuleUserOp(
            getSmartAccountExecuteCalldata(
                address(erc7484SecurityPolicyPlugin),
                0,
                abi.encodeCall(
                    ERC7484SecurityPolicyPlugin.setConfiguration,
                    (defaultConfig)
                )
            ),
            sa,
            0,
            alice
        );
        entryPoint.handleOps(arraifyOps(op), owner.addr);

        // Deploy and register MultichainValidator with registry
        validator = MultichainECDSAValidator(
            instancel1.deployAndRegister(
                defaultResolver,
                type(MultichainECDSAValidator).creationCode,
                abi.encode(0)
            )
        );
    }

    function testShouldSetConfiguration() external {
        vm.startPrank(alice.addr);
        assertEq(
            erc7484SecurityPolicyPlugin.configuration(alice.addr).threshold,
            0
        );
        assertEq(
            erc7484SecurityPolicyPlugin
                .configuration(alice.addr)
                .trustedAttesters
                .length,
            0
        );

        vm.expectEmit(true, true, true, true);
        emit ConfigurationSet(alice.addr, defaultConfig);

        erc7484SecurityPolicyPlugin.setConfiguration(defaultConfig);

        assertEq(
            erc7484SecurityPolicyPlugin.configuration(alice.addr).threshold,
            defaultConfig.threshold
        );
        assertEq(
            erc7484SecurityPolicyPlugin
                .configuration(alice.addr)
                .trustedAttesters
                .length,
            defaultConfig.trustedAttesters.length
        );

        for (uint256 i = 0; i < defaultConfig.trustedAttesters.length; i++) {
            assertEq(
                erc7484SecurityPolicyPlugin
                    .configuration(alice.addr)
                    .trustedAttesters[i],
                defaultConfig.trustedAttesters[i]
            );
        }

        vm.stopPrank();
    }

    function testShouldAllowModuleInstallationIfEnoughAttestationsExists()
        external
    {
        // Create 3 attestations for the multichain validator module
        instancel1.newAttestation(
            defaultSchema1,
            bob.privateKey,
            AttestationRequestData({
                subject: address(validator),
                expirationTime: uint48(0),
                data: abi.encode(true),
                value: 0
            })
        );
        instancel1.newAttestation(
            defaultSchema1,
            charlie.privateKey,
            AttestationRequestData({
                subject: address(validator),
                expirationTime: uint48(0),
                data: abi.encode(true),
                value: 0
            })
        );
        instancel1.newAttestation(
            defaultSchema1,
            dan.privateKey,
            AttestationRequestData({
                subject: address(validator),
                expirationTime: uint48(0),
                data: abi.encode(true),
                value: 0
            })
        );

        // Attempt to install the multichain validator module
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

        vm.breakpoint("a");
        entryPoint.handleOps(arraifyOps(op), owner.addr);

        assertTrue(sa.isModuleEnabled(address(validator)));
    }

    function testShouldNotAllowModuleInstallationIfNotConfigured() external {
        // Erase the default configuration
        vm.prank(address(sa));
        erc7484SecurityPolicyPlugin.setConfiguration(
            IERC7484SecurityPolicyPluginEventsErrors.Configuration({
                trustedAttesters: new address[](0),
                threshold: 0
            })
        );
        vm.stopPrank();

        // Create 3 attestations for the multichain validator module
        instancel1.newAttestation(
            defaultSchema1,
            bob.privateKey,
            AttestationRequestData({
                subject: address(validator),
                expirationTime: uint48(0),
                data: abi.encode(true),
                value: 0
            })
        );
        instancel1.newAttestation(
            defaultSchema1,
            charlie.privateKey,
            AttestationRequestData({
                subject: address(validator),
                expirationTime: uint48(0),
                data: abi.encode(true),
                value: 0
            })
        );
        instancel1.newAttestation(
            defaultSchema1,
            dan.privateKey,
            AttestationRequestData({
                subject: address(validator),
                expirationTime: uint48(0),
                data: abi.encode(true),
                value: 0
            })
        );

        // Attempt to install the multichain validator module
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
                    ISecurityPolicyPlugin
                        .SaConfigurationNotInitialized
                        .selector,
                    address(sa)
                )
            )
        );

        assertFalse(sa.isModuleEnabled(address(validator)));
    }

    function testShouldNotAllowModuleInstallationIfInsufficientAttestationsExists()
        external
    {
        // Create 2 attestations for the multichain validator module
        instancel1.newAttestation(
            defaultSchema1,
            bob.privateKey,
            AttestationRequestData({
                subject: address(validator),
                expirationTime: uint48(0),
                data: abi.encode(true),
                value: 0
            })
        );
        instancel1.newAttestation(
            defaultSchema1,
            charlie.privateKey,
            AttestationRequestData({
                subject: address(validator),
                expirationTime: uint48(0),
                data: abi.encode(true),
                value: 0
            })
        );

        // Attempt to install the multichain validator module
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
                abi.encodeWithSelector(IQuery.InsufficientAttestations.selector)
            )
        );

        assertFalse(sa.isModuleEnabled(address(validator)));
    }

    function testShouldNotAllowModuleInstallationIfAttestationsAreRevoked()
        external
    {
        // Create 3 attestations for the multichain validator module
        instancel1.newAttestation(
            defaultSchema1,
            bob.privateKey,
            AttestationRequestData({
                subject: address(validator),
                expirationTime: uint48(0),
                data: abi.encode(true),
                value: 0
            })
        );
        instancel1.newAttestation(
            defaultSchema1,
            charlie.privateKey,
            AttestationRequestData({
                subject: address(validator),
                expirationTime: uint48(0),
                data: abi.encode(true),
                value: 0
            })
        );
        instancel1.newAttestation(
            defaultSchema1,
            dan.privateKey,
            AttestationRequestData({
                subject: address(validator),
                expirationTime: uint48(0),
                data: abi.encode(true),
                value: 0
            })
        );

        // Revoke one of the attestations
        instancel1.revokeAttestation(
            address(validator),
            defaultSchema1,
            bob.privateKey
        );

        // Attempt to install the multichain validator module
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
                    IQuery.RevokedAttestation.selector,
                    bob.addr
                )
            )
        );

        assertFalse(sa.isModuleEnabled(address(validator)));
    }
}
