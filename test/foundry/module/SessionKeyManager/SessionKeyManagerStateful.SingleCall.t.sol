// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import {SATestBase, IEntryPoint} from "../../base/SATestBase.sol";
import {SmartAccount} from "sa/SmartAccount.sol";
import {UserOperation} from "aa-core/EntryPoint.sol";
import {SessionKeyManagerStateful} from "sa/modules/SessionKeyManagers/SessionKeyManagerStateful.sol";
import {IStatefulSessionKeyManagerBase} from "sa/interfaces/modules/SessionKeyManagers/IStatefulSessionKeyManagerBase.sol";
import {MockSessionValidationModule} from "sa/test/mocks/MockSessionValidationModule.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Vm} from "forge-std/Test.sol";

contract SessionKeyManagerStatefulSingleCallTest is SATestBase {
    SmartAccount private sa;
    SessionKeyManagerStateful private sessionKeyManagerStateful;
    MockSessionValidationModule private mockSessionValidationModule;
    Stub private stub = new Stub();
    SKMParserStub private skmParserStub = new SKMParserStub();

    // Events
    event SessionCreated(
        address indexed sa,
        bytes32 indexed sessionDataDigest,
        IStatefulSessionKeyManagerBase.SessionData data
    );
    event SessionDisabled(
        address indexed sa,
        bytes32 indexed sessionDataDigest
    );
    event Log(string message);

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

        // Deploy Session Key Modules
        sessionKeyManagerStateful = new SessionKeyManagerStateful();
        vm.label(
            address(sessionKeyManagerStateful),
            "sessionKeyManagerStateful"
        );
        mockSessionValidationModule = new MockSessionValidationModule();
        vm.label(
            address(mockSessionValidationModule),
            "mockSessionValidationModule"
        );

        // Enable Session Key Manager Module
        UserOperation memory op = makeEcdsaModuleUserOp(
            getSmartAccountExecuteCalldata(
                address(sa),
                0,
                abi.encodeCall(
                    sa.enableModule,
                    address(sessionKeyManagerStateful)
                )
            ),
            sa,
            0,
            alice
        );
        entryPoint.handleOps(toArray(op), owner.addr);
    }

    function testEnableSession() public {
        SessionKeyManagerStateful.SessionData
            memory sessionData = IStatefulSessionKeyManagerBase.SessionData({
                validUntil: 0,
                validAfter: 0,
                sessionValidationModule: address(mockSessionValidationModule),
                sessionKeyData: abi.encodePacked(bob.addr)
            });
        bytes32 sessionDataDigest = sessionKeyManagerStateful.sessionDataDigest(
            sessionData
        );

        // Enable session
        UserOperation memory op = makeEcdsaModuleUserOp(
            getSmartAccountExecuteCalldata(
                address(sessionKeyManagerStateful),
                0,
                abi.encodeCall(
                    sessionKeyManagerStateful.enableSession,
                    (sessionData)
                )
            ),
            sa,
            0,
            alice
        );

        vm.expectEmit();
        emit SessionCreated(address(sa), sessionDataDigest, sessionData);

        entryPoint.handleOps(toArray(op), owner.addr);

        // Check session is enabled
        IStatefulSessionKeyManagerBase.SessionData
            memory enabledSessionData = sessionKeyManagerStateful
                .enabledSessionsData(sessionDataDigest, address(sa));
        assertEq(enabledSessionData, sessionData);
    }

    function testDisableSession() public {
        SessionKeyManagerStateful.SessionData
            memory sessionData = IStatefulSessionKeyManagerBase.SessionData({
                validUntil: 0,
                validAfter: 0,
                sessionValidationModule: address(mockSessionValidationModule),
                sessionKeyData: abi.encodePacked(bob.addr)
            });
        bytes32 sessionDataDigest = sessionKeyManagerStateful.sessionDataDigest(
            sessionData
        );

        // Enable session
        UserOperation memory op = makeEcdsaModuleUserOp(
            getSmartAccountExecuteCalldata(
                address(sessionKeyManagerStateful),
                0,
                abi.encodeCall(
                    sessionKeyManagerStateful.enableSession,
                    (sessionData)
                )
            ),
            sa,
            0,
            alice
        );
        entryPoint.handleOps(toArray(op), owner.addr);

        // Disable session
        op = makeEcdsaModuleUserOp(
            getSmartAccountExecuteCalldata(
                address(sessionKeyManagerStateful),
                0,
                abi.encodeCall(
                    sessionKeyManagerStateful.disableSession,
                    (sessionDataDigest)
                )
            ),
            sa,
            0,
            alice
        );
        vm.expectEmit();
        emit SessionDisabled(address(sa), sessionDataDigest);

        entryPoint.handleOps(toArray(op), owner.addr);

        // Check session is disabled
        IStatefulSessionKeyManagerBase.SessionData
            memory enabledSessionData = sessionKeyManagerStateful
                .enabledSessionsData(sessionDataDigest, address(sa));

        IStatefulSessionKeyManagerBase.SessionData memory emptyData;
        assertEq(enabledSessionData, emptyData);
    }

    function testShouldProcessTransactionFromSessionKey() public {
        SessionKeyManagerStateful.SessionData
            memory sessionData = IStatefulSessionKeyManagerBase.SessionData({
                validUntil: 0,
                validAfter: 0,
                sessionValidationModule: address(mockSessionValidationModule),
                sessionKeyData: abi.encodePacked(bob.addr)
            });

        // Enable session
        UserOperation memory op = makeEcdsaModuleUserOp(
            getSmartAccountExecuteCalldata(
                address(sessionKeyManagerStateful),
                0,
                abi.encodeCall(
                    sessionKeyManagerStateful.enableSession,
                    (sessionData)
                )
            ),
            sa,
            0,
            alice
        );
        entryPoint.handleOps(toArray(op), owner.addr);

        // Use session
        vm.expectEmit();
        emit Log("shouldProcessTransactionFromSessionKey");
        op = makeSessionModuleUserOp(
            getSmartAccountExecuteCalldata(
                address(stub),
                0,
                abi.encodeCall(
                    stub.emitMessage,
                    ("shouldProcessTransactionFromSessionKey")
                )
            ),
            sa,
            0,
            sessionKeyManagerStateful,
            sessionData,
            bob
        );
        entryPoint.handleOps(toArray(op), owner.addr);
    }

    function testShouldNotValidateTransactionFromNonEnabledSession() public {
        SessionKeyManagerStateful.SessionData
            memory sessionData = IStatefulSessionKeyManagerBase.SessionData({
                validUntil: 0,
                validAfter: 0,
                sessionValidationModule: address(mockSessionValidationModule),
                sessionKeyData: abi.encodePacked(bob.addr)
            });

        // Do not enable session

        // Use session
        UserOperation memory op = makeSessionModuleUserOp(
            getSmartAccountExecuteCalldata(
                address(stub),
                0,
                abi.encodeCall(
                    stub.emitMessage,
                    ("shouldProcessTransactionFromSessionKey")
                )
            ),
            sa,
            0,
            sessionKeyManagerStateful,
            sessionData,
            bob
        );

        try entryPoint.handleOps(toArray(op), owner.addr) {
            fail("should have reverted");
        } catch (bytes memory reason) {
            assertEq(
                reason,
                abi.encodeWithSelector(
                    IEntryPoint.FailedOp.selector,
                    0,
                    "AA23 reverted: SKM: Session Key is not enabled"
                )
            );
        }
    }

    function testShouldNotValidateTransactionSignedFromInvalidSessionSigner()
        public
    {
        SessionKeyManagerStateful.SessionData
            memory sessionData = IStatefulSessionKeyManagerBase.SessionData({
                validUntil: 0,
                validAfter: 0,
                sessionValidationModule: address(mockSessionValidationModule),
                sessionKeyData: abi.encodePacked(bob.addr)
            });

        // Enable session
        UserOperation memory op = makeEcdsaModuleUserOp(
            getSmartAccountExecuteCalldata(
                address(sessionKeyManagerStateful),
                0,
                abi.encodeCall(
                    sessionKeyManagerStateful.enableSession,
                    (sessionData)
                )
            ),
            sa,
            0,
            alice
        );
        entryPoint.handleOps(toArray(op), owner.addr);

        // Use session
        op = makeSessionModuleUserOp(
            getSmartAccountExecuteCalldata(
                address(stub),
                0,
                abi.encodeCall(
                    stub.emitMessage,
                    ("shouldProcessTransactionFromSessionKey")
                )
            ),
            sa,
            0,
            sessionKeyManagerStateful,
            sessionData,
            alice
        );

        try entryPoint.handleOps(toArray(op), owner.addr) {
            fail("should have reverted");
        } catch (bytes memory reason) {
            assertEq(
                reason,
                abi.encodeWithSelector(
                    IEntryPoint.FailedOp.selector,
                    0,
                    "AA24 signature error"
                )
            );
        }
    }

    function testShouldNotSupportERC1271SignatureValidation(
        uint256 seed
    ) public {
        bytes32 userOpHash = keccak256(abi.encodePacked(seed));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alice.privateKey, userOpHash);
        bytes memory signature = abi.encodePacked(r, s, v);
        assertEq(
            sessionKeyManagerStateful.isValidSignature(userOpHash, signature),
            bytes4(0xffffffff)
        );
    }

    function testShouldNotSupportERC1271SignatureValidationUnsafe(
        uint256 seed
    ) public {
        bytes32 userOpHash = keccak256(abi.encodePacked(seed));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alice.privateKey, userOpHash);
        bytes memory signature = abi.encodePacked(r, s, v);
        assertEq(
            sessionKeyManagerStateful.isValidSignatureUnsafe(
                userOpHash,
                signature
            ),
            bytes4(0xffffffff)
        );
    }

    function testShouldParseModuleSignatureCorrectly(
        bytes32 _sessionDataDigest,
        bytes calldata _sessionKeySignature
    ) public {
        bytes memory encoded = abi.encode(
            _sessionDataDigest,
            _sessionKeySignature
        );

        (
            bytes32 sessionDataDigest,
            bytes memory sessionKeySignature
        ) = skmParserStub.parseModuleSignature(encoded);

        assertEq(
            sessionDataDigest,
            _sessionDataDigest,
            "mismatched sessionDataDigest"
        );
        assertEq(
            sessionKeySignature,
            _sessionKeySignature,
            "mismatched sessionKeySignature"
        );
    }

    function assertEq(
        SessionKeyManagerStateful.SessionData memory _a,
        SessionKeyManagerStateful.SessionData memory _b
    ) internal {
        assertEq(_a.validUntil, _b.validUntil, "mismatched validUntil");
        assertEq(_a.validAfter, _b.validAfter, "mismatched validAfter");
        assertEq(
            _a.sessionValidationModule,
            _b.sessionValidationModule,
            "mismatched sessionValidationModule"
        );
        assertEq(
            _a.sessionKeyData,
            _b.sessionKeyData,
            "mismatched sessionKeyData"
        );
    }

    function makeSessionModuleUserOp(
        bytes memory _calldata,
        SmartAccount _sa,
        uint192 _nonceKey,
        SessionKeyManagerStateful _skm,
        SessionKeyManagerStateful.SessionData memory _sessionData,
        TestAccount memory _sessionSigner
    ) internal view returns (UserOperation memory op) {
        op = UserOperation({
            sender: address(_sa),
            nonce: entryPoint.getNonce(address(_sa), _nonceKey),
            initCode: bytes(""),
            callData: _calldata,
            callGasLimit: gasleft() / 100,
            verificationGasLimit: gasleft() / 100,
            preVerificationGas: defaultPreVerificationGas,
            maxFeePerGas: tx.gasprice,
            maxPriorityFeePerGas: tx.gasprice - block.basefee,
            paymasterAndData: bytes(""),
            signature: bytes("")
        });

        // Sign the UserOp
        bytes32 userOpHash = entryPoint.getUserOpHash(op);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(
            _sessionSigner.privateKey,
            ECDSA.toEthSignedMessageHash(userOpHash)
        );
        bytes memory moduleSignature = abi.encode(
            _skm.sessionDataDigest(_sessionData),
            abi.encodePacked(r, s, v)
        );
        op.signature = abi.encode(moduleSignature, _skm);
    }
}

contract Stub {
    event Log(string message);

    function emitMessage(string calldata _message) public {
        emit Log(_message);
    }
}

contract SKMParserStub is SessionKeyManagerStateful {
    function parseModuleSignature(
        bytes calldata _moduleSignature
    )
        public
        pure
        returns (bytes32 sessionDataDigest, bytes calldata sessionKeySignature)
    {
        return _parseModuleSignature(_moduleSignature);
    }
}
