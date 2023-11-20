// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {SATestBase} from "../base/SATestBase.sol";
import {SmartAccount} from "sa/SmartAccount.sol";
import {EcdsaOwnershipRegistryModule} from "modules/EcdsaOwnershipRegistryModule.sol";
import "forge-std/console.sol";

contract SABasicsTest is SATestBase {
    function setUp() public virtual override {
        super.setUp();
    }

    function testDeploySAWithDefaultModule() external {
        // Deploy Smart Account with default module
        uint256 smartAccountDeploymentIndex = 0;
        bytes memory moduleSetupData = getEcdsaOwnershipRegistryModuleSetupData(
            alice.addr
        );
        SmartAccount sa = getSmartAccountWithModule(
            address(ecdsaOwnershipRegistryModule),
            moduleSetupData,
            smartAccountDeploymentIndex,
            "aliceSA"
        );

        vm.prank(owner.addr);
        (bool success, ) = address(sa).call{value: 1 ether}("");
        assertTrue(success, "should be able to send ether to smart account");

        deal(address(token), address(sa), 1 ether);

        assertTrue(
            sa.isModuleEnabled(address(ecdsaOwnershipRegistryModule)),
            "module should be enabled"
        );
        assertEq(
            ecdsaOwnershipRegistryModule.getOwner(address(sa)),
            alice.addr,
            "owner should be alice"
        );
        assertEq(
            address(sa).balance,
            1 ether,
            "smart account should have 1 ether"
        );
        assertEq(
            token.balanceOf(address(sa)),
            1 ether,
            "smart account should have 1 token"
        );
    }

    function testByteString() external {
        bytes memory data = abi.encodePacked(
            uint8(10),
            uint64(1),
            uint64(2),
            bytes32(keccak256(abi.encodePacked(uint256(0x1234)))),
            bytes32(keccak256(abi.encodePacked(uint256(0x4567))))
        );
        uint256 offset;

        vm.breakpoint("a");
        assembly {
            offset := data
        }
        console.log("offset", offset);
    }
}
