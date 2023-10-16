// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {Vm} from "forge-std/Test.sol";
import {SATestBase} from "../../base/SATestBase.sol";
import {SmartAccount} from "sa/SmartAccount.sol";
import {SecurityPolicyManagerPlugin, SENTINEL_MODULE_ADDRESS} from "modules/SecurityPolicyManagerPlugin.sol";
import {ISecurityPolicyPlugin} from "interfaces/modules/ISecurityPolicyPlugin.sol";
import {ISecurityPolicyManagerPlugin, ISecurityPolicyManagerPluginEventsErrors} from "interfaces/modules/ISecurityPolicyManagerPlugin.sol";
import {UserOperation} from "aa-core/EntryPoint.sol";
import "forge-std/console2.sol";

contract TestSecurityPolicyPlugin is ISecurityPolicyPlugin {
    bool public shouldRevert;

    function validateSecurityPolicy(address, address) external view override {
        require(!shouldRevert, "TestSecurityPolicyPlugin: shouldRevert");
    }

    function setShouldRevert(bool _shouldRevert) external {
        shouldRevert = _shouldRevert;
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
    }
}
