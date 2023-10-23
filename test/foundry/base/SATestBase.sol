// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import {Test} from "forge-std/Test.sol";
import {MockToken} from "test-contracts/mocks/MockToken.sol";
import {EntryPoint, IEntryPoint} from "aa-core/EntryPoint.sol";
import {SmartAccountFactory} from "factory/SmartAccountFactory.sol";
import {SmartAccount} from "sa/SmartAccount.sol";
import {EcdsaOwnershipRegistryModule} from "modules/EcdsaOwnershipRegistryModule.sol";

abstract contract SATestBase is Test {
    // Test Environment Configuration
    string constant mnemonic = "test test test test test test test test test test test junk";
    uint256 testAccountCount = 10;
    uint256 initialMainAccountFunds = 100000 ether;

    uint32 nextKeyIndex;

    // Test Accounts
    struct TestAccount {
        address addr;
        uint256 privateKey;
    }

    TestAccount[] testAccounts;
    TestAccount alice;
    TestAccount bob;
    TestAccount charlie;
    TestAccount dan;
    TestAccount emma;
    TestAccount frank;
    TestAccount george;
    TestAccount henry;
    TestAccount ida;

    TestAccount owner;

    // Test Tokens
    MockToken token;

    // ERC4337 Contracts
    EntryPoint entryPoint;
    SmartAccount saImplementation;
    SmartAccountFactory factory;

    // Modules
    EcdsaOwnershipRegistryModule ecdsaOwnershipRegistryModule;

    function getNextPrivateKey() internal returns (uint256) {
        return vm.deriveKey(mnemonic, ++nextKeyIndex);
    }

    function setUp() public virtual {
        // Generate Test Addresses
        for (uint256 i = 0; i < testAccountCount; i++) {
            uint256 privateKey = getNextPrivateKey();
            testAccounts.push(TestAccount(vm.addr(privateKey), privateKey));

            deal(testAccounts[i].addr, initialMainAccountFunds);
        }

        // Name Test Addresses
        alice = testAccounts[0];
        vm.label(alice.addr, string.concat("Alice", vm.toString(uint256(0))));

        bob = testAccounts[1];
        vm.label(bob.addr, string.concat("Bob", vm.toString(uint256(1))));

        charlie = testAccounts[2];
        vm.label(charlie.addr, string.concat("Charlie", vm.toString(uint256(2))));

        dan = testAccounts[3];
        vm.label(dan.addr, string.concat("Dan", vm.toString(uint256(3))));

        emma = testAccounts[4];
        vm.label(emma.addr, string.concat("Emma", vm.toString(uint256(4))));

        frank = testAccounts[5];
        vm.label(frank.addr, string.concat("Frank", vm.toString(uint256(5))));

        george = testAccounts[6];
        vm.label(george.addr, string.concat("George", vm.toString(uint256(6))));

        henry = testAccounts[7];
        vm.label(henry.addr, string.concat("Henry", vm.toString(uint256(7))));

        ida = testAccounts[7];
        vm.label(ida.addr, string.concat("Ida", vm.toString(uint256(8))));

        // Name Owner
        owner = testAccounts[8];
        vm.label(owner.addr, string.concat("Owner", vm.toString(uint256(9))));

        // Deploy Test Tokens
        token = new MockToken();
        vm.label(address(token), "Test Token");

        // Deploy ERC4337 Contracts
        entryPoint = new EntryPoint();
        vm.label(address(entryPoint), "Entry Point");

        saImplementation = new SmartAccount(IEntryPoint(address(0xDEAD)));
        vm.label(address(saImplementation), "Smart Account Implementation");

        factory = new SmartAccountFactory(address(saImplementation), owner.addr);
        vm.label(address(factory), "Smart Account Factory");

        // Deploy Modules
        ecdsaOwnershipRegistryModule = new EcdsaOwnershipRegistryModule();
        vm.label(address(ecdsaOwnershipRegistryModule), "ECDSA Ownership Registry Module");
    }

    // Utility Functions
    function getSmartAccountWithModule(
        address _moduleSetupContract,
        bytes memory _moduleSetupData,
        uint256 _index,
        string memory _label
    ) internal returns (SmartAccount sa) {
        sa = SmartAccount(payable(factory.deployCounterFactualAccount(_moduleSetupContract, _moduleSetupData, _index)));
        vm.label(address(sa), _label);
    }

    // Module Setup Data Helpers
    function getEcdsaOwnershipRegistryModuleSetupData(address _owner) internal pure returns (bytes memory) {
        return abi.encodeCall(EcdsaOwnershipRegistryModule.initForSmartAccount, (_owner));
    }
}