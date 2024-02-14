// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {SATestBase} from "../base/SATestBase.sol";
import {SmartAccount} from "sa/SmartAccount.sol";
import {EcdsaOwnershipRegistryModule} from "modules/EcdsaOwnershipRegistryModule.sol";
import {EntryPoint, IEntryPoint, UserOperation} from "aa-core/EntryPoint.sol";
import {MockEthSender} from "sa/test/mocks/MockEthSender.sol";
import "forge-std/console.sol";

contract Test {
    event Log(string message);

    function emitString(string calldata str) external {
        emit Log(str);
    }
}

contract SABasicsTest is SATestBase {
    event Log(string message);
    Test test = new Test();

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

    function testExecuteBatch() external {
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

        address[] memory dest = new address[](2);
        uint256[] memory values = new uint256[](2);
        bytes[] memory calldatas = new bytes[](2);

        vm.expectEmit(true, true, true, true);
        emit Log("hello");
        vm.expectEmit(true, true, true, true);
        emit Log("world");

        dest[0] = address(test);
        dest[1] = address(test);
        calldatas[0] = abi.encodeCall(test.emitString, ("hello"));
        calldatas[1] = abi.encodeCall(test.emitString, ("world"));

        UserOperation memory op = makeEcdsaModuleUserOp(
            getSmartAccountBatchExecuteCalldata(dest, values, calldatas),
            sa,
            0,
            alice
        );
        vm.breakpoint("a");
        entryPoint.handleOps(arraifyOps(op), owner.addr);
    }

    function testReceiveEtherWithGasLimit() external {
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

        MockEthSender mockEthSender = new MockEthSender();
        vm.deal(address(mockEthSender), 100 ether);

        uint256 userSABalanceBefore = address(sa).balance;
        
        uint256 gasStipend = 0;

        mockEthSender.send(address(sa), 1 ether, gasStipend);
        uint256 userSABalanceAfter = address(sa).balance;

        assertEq(
            userSABalanceAfter - userSABalanceBefore,
            1 ether,
            "smart account should receive 1 ether"
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
