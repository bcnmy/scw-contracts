// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import {Test, Vm} from "forge-std/Test.sol";
import {MockToken} from "test-contracts/mocks/MockToken.sol";
import {EntryPoint, IEntryPoint, UserOperation} from "aa-core/EntryPoint.sol";
import {SmartAccountFactory} from "factory/SmartAccountFactory.sol";
import {SmartAccount} from "sa/SmartAccount.sol";
import {EcdsaOwnershipRegistryModule} from "modules/EcdsaOwnershipRegistryModule.sol";
import {ToArrayUtils} from "./utils/ToArrayUtils.sol";
import {AssertUtils} from "./utils/AssertUtils.sol";
import {EntryPointUtils} from "./utils/EntrypointUtils.sol";

/* solhint-disable ordering*/

abstract contract SATestBase is
    Test,
    ToArrayUtils,
    AssertUtils,
    EntryPointUtils
{
    // Test Accounts
    struct TestAccount {
        address payable addr;
        uint256 privateKey;
    }

    // Test Environment Configuration
    string internal constant MNEMONIC =
        "test test test test test test test test test test test junk";
    uint256 internal constant TEST_ACCOUNT_COUNT = 10;
    uint256 internal constant INITIAL_MAIN_ACCOUNT_FUNDS = 100000 ether;
    uint256 internal constant DEFAULT_PRE_VERIFICATIION_GAS = 21000;

    uint32 internal nextKeyIndex;

    TestAccount[] internal testAccounts;
    mapping(address account => TestAccount) internal testAccountsByAddress;
    TestAccount internal alice;
    TestAccount internal bob;
    TestAccount internal charlie;
    TestAccount internal dan;
    TestAccount internal emma;
    TestAccount internal frank;
    TestAccount internal george;
    TestAccount internal henry;
    TestAccount internal ida;

    TestAccount internal owner;

    // Test Tokens
    MockToken internal token;

    // ERC4337 Contracts
    EntryPoint internal entryPoint;
    SmartAccount internal saImplementation;
    SmartAccountFactory internal factory;

    // Modules
    EcdsaOwnershipRegistryModule internal ecdsaOwnershipRegistryModule;

    function getNextPrivateKey() internal returns (uint256) {
        return vm.deriveKey(MNEMONIC, ++nextKeyIndex);
    }

    function setUp() public virtual {
        // Generate Test Addresses
        for (uint256 i = 0; i < TEST_ACCOUNT_COUNT; i++) {
            uint256 privateKey = getNextPrivateKey();
            testAccounts.push(
                TestAccount(payable(vm.addr(privateKey)), privateKey)
            );
            testAccountsByAddress[testAccounts[i].addr] = testAccounts[i];

            deal(testAccounts[i].addr, INITIAL_MAIN_ACCOUNT_FUNDS);
        }

        // Name Test Addresses
        alice = testAccounts[0];
        vm.label(alice.addr, string.concat("Alice", vm.toString(uint256(0))));

        bob = testAccounts[1];
        vm.label(bob.addr, string.concat("Bob", vm.toString(uint256(1))));

        charlie = testAccounts[2];
        vm.label(
            charlie.addr,
            string.concat("Charlie", vm.toString(uint256(2)))
        );

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

        saImplementation = new SmartAccount(entryPoint);
        vm.label(address(saImplementation), "Smart Account Implementation");

        factory = new SmartAccountFactory(
            address(saImplementation),
            owner.addr
        );
        vm.label(address(factory), "Smart Account Factory");

        // Deploy Modules
        ecdsaOwnershipRegistryModule = new EcdsaOwnershipRegistryModule();
        vm.label(
            address(ecdsaOwnershipRegistryModule),
            "ECDSA Ownership Registry Module"
        );
    }

    // Utility Functions
    function getSmartAccountWithModule(
        address _moduleSetupContract,
        bytes memory _moduleSetupData,
        uint256 _index,
        string memory _label
    ) internal returns (SmartAccount sa) {
        sa = SmartAccount(
            payable(
                factory.deployCounterFactualAccount(
                    _moduleSetupContract,
                    _moduleSetupData,
                    _index
                )
            )
        );
        vm.label(address(sa), _label);
    }

    function getSmartAccountExecuteCalldata(
        address _dest,
        uint256 _value,
        bytes memory _calldata
    ) internal pure returns (bytes memory) {
        return abi.encodeCall(SmartAccount.execute, (_dest, _value, _calldata));
    }

    function getSmartAccountBatchExecuteCalldata(
        address[] memory _dest,
        uint256[] memory _value,
        bytes[] memory _calldata
    ) internal pure returns (bytes memory) {
        return
            abi.encodeCall(
                SmartAccount.executeBatch,
                (_dest, _value, _calldata)
            );
    }

    // Module Setup Data Helpers
    function getEcdsaOwnershipRegistryModuleSetupData(
        address _owner
    ) internal pure returns (bytes memory) {
        return
            abi.encodeCall(
                EcdsaOwnershipRegistryModule.initForSmartAccount,
                (_owner)
            );
    }

    // Validation Module Op Creation Helpers
    function makeEcdsaModuleUserOp(
        bytes memory _calldata,
        SmartAccount _sa,
        uint192 _nonceKey,
        TestAccount memory _signer
    ) internal view returns (UserOperation memory op) {
        op = UserOperation({
            sender: address(_sa),
            nonce: entryPoint.getNonce(address(_sa), _nonceKey),
            initCode: bytes(""),
            callData: _calldata,
            callGasLimit: gasleft() / 100,
            verificationGasLimit: gasleft() / 100,
            preVerificationGas: DEFAULT_PRE_VERIFICATIION_GAS,
            maxFeePerGas: tx.gasprice,
            maxPriorityFeePerGas: tx.gasprice - block.basefee,
            paymasterAndData: bytes(""),
            signature: bytes("")
        });

        // Sign the UserOp
        bytes32 userOpHash = entryPoint.getUserOpHash(op);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(
            _signer.privateKey,
            userOpHash
        );
        op.signature = abi.encode(
            abi.encodePacked(r, s, v),
            ecdsaOwnershipRegistryModule
        );
    }
}
