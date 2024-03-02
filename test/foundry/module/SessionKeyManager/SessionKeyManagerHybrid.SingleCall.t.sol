// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import {SATestBase, IEntryPoint} from "../../base/SATestBase.sol";
import {SmartAccount} from "sa/SmartAccount.sol";
import {UserOperation} from "aa-core/EntryPoint.sol";
import {SessionKeyManagerHybrid} from "sa/modules/SessionKeyManagers/SessionKeyManagerHybrid.sol";
import {ISessionKeyManagerModuleHybrid} from "sa/interfaces/modules/SessionKeyManagers/ISessionKeyManagerModuleHybrid.sol";
import {MockSessionValidationModule} from "sa/test/mocks/MockSessionValidationModule.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Vm} from "forge-std/Test.sol";
import "forge-std/console2.sol";

contract SessionKeyManagerHybridSingleCallTest is SATestBase {
    SmartAccount private sa;
    SessionKeyManagerHybrid private sessionKeyManagerHybrid;
    MockSessionValidationModule private mockSessionValidationModule;
    Stub private stub = new Stub();
    SKMParserStub private skmParserStub = new SKMParserStub();

    // Events
    event SessionCreated(
        address indexed sa,
        bytes32 indexed sessionDataDigest,
        ISessionKeyManagerModuleHybrid.SessionData data
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
        sessionKeyManagerHybrid = new SessionKeyManagerHybrid();
        vm.label(address(sessionKeyManagerHybrid), "sessionKeyManagerHybrid");
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
                    address(sessionKeyManagerHybrid)
                )
            ),
            sa,
            0,
            alice
        );
        entryPoint.handleOps(toArray(op), owner.addr);
    }

    function testEnableSession() public {
        SessionKeyManagerHybrid.SessionData
            memory sessionData = ISessionKeyManagerModuleHybrid.SessionData({
                validUntil: 0,
                validAfter: 0,
                sessionValidationModule: address(mockSessionValidationModule),
                sessionKeyData: abi.encodePacked(bob.addr)
            });
        bytes32 sessionDataDigest = sessionKeyManagerHybrid.sessionDataDigest(
            sessionData
        );

        // Enable session
        UserOperation memory op = makeEcdsaModuleUserOp(
            getSmartAccountExecuteCalldata(
                address(sessionKeyManagerHybrid),
                0,
                abi.encodeCall(
                    sessionKeyManagerHybrid.enableSession,
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
        ISessionKeyManagerModuleHybrid.SessionData
            memory enabledSessionData = sessionKeyManagerHybrid
                .enabledSessionsData(sessionDataDigest, address(sa));
        assertEq(enabledSessionData, sessionData);
    }

    function testEnableSessions() public {
        SessionKeyManagerHybrid.SessionData
            memory sessionData1 = ISessionKeyManagerModuleHybrid.SessionData({
                validUntil: 0,
                validAfter: 0,
                sessionValidationModule: address(mockSessionValidationModule),
                sessionKeyData: abi.encodePacked(bob.addr)
            });
        SessionKeyManagerHybrid.SessionData
            memory sessionData2 = ISessionKeyManagerModuleHybrid.SessionData({
                validUntil: 1,
                validAfter: 0,
                sessionValidationModule: address(mockSessionValidationModule),
                sessionKeyData: abi.encodePacked(bob.addr)
            });
        bytes32 sessionDataDigest1 = sessionKeyManagerHybrid.sessionDataDigest(
            sessionData1
        );
        bytes32 sessionDataDigest2 = sessionKeyManagerHybrid.sessionDataDigest(
            sessionData2
        );

        // Enable session
        UserOperation memory op = makeEcdsaModuleUserOp(
            getSmartAccountExecuteCalldata(
                address(sessionKeyManagerHybrid),
                0,
                abi.encodeCall(
                    sessionKeyManagerHybrid.enableSessions,
                    (toArray(sessionData1, sessionData2))
                )
            ),
            sa,
            0,
            alice
        );

        vm.expectEmit();
        emit SessionCreated(address(sa), sessionDataDigest1, sessionData1);
        vm.expectEmit();
        emit SessionCreated(address(sa), sessionDataDigest2, sessionData2);

        entryPoint.handleOps(toArray(op), owner.addr);

        // Check session is enabled
        ISessionKeyManagerModuleHybrid.SessionData
            memory enabledSessionData = sessionKeyManagerHybrid
                .enabledSessionsData(sessionDataDigest1, address(sa));
        assertEq(enabledSessionData, sessionData1);
        enabledSessionData = sessionKeyManagerHybrid.enabledSessionsData(
            sessionDataDigest2,
            address(sa)
        );
        assertEq(enabledSessionData, sessionData2);
    }

    function testEnableAndUseSessionInSameTransaction() public {
        SessionKeyManagerHybrid.SessionData
            memory sessionData = ISessionKeyManagerModuleHybrid.SessionData({
                validUntil: 0,
                validAfter: 0,
                sessionValidationModule: address(mockSessionValidationModule),
                sessionKeyData: abi.encodePacked(bob.addr)
            });
        bytes32 sessionDataDigest = sessionKeyManagerHybrid.sessionDataDigest(
            sessionData
        );

        // Generate Session Data
        uint64[] memory chainIds = new uint64[](1);
        chainIds[0] = uint64(block.chainid);

        SessionKeyManagerHybrid.SessionData[]
            memory sessionDatas = new SessionKeyManagerHybrid.SessionData[](1);
        sessionDatas[0] = sessionData;

        (
            bytes memory sessionEnableData,
            bytes memory sessionEnableSignature
        ) = makeSessionEnableData(chainIds, sessionDatas, sa);

        // Enable and Use session
        UserOperation memory op = makeEnableAndUseSessionUserOp(
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
            sessionKeyManagerHybrid,
            sessionData,
            bob,
            0,
            sessionEnableData,
            sessionEnableSignature
        );

        vm.expectEmit();
        emit SessionCreated(address(sa), sessionDataDigest, sessionData);
        vm.expectEmit();
        emit Log("shouldProcessTransactionFromSessionKey");
        entryPoint.handleOps(toArray(op), owner.addr);

        // Check session is enabled
        ISessionKeyManagerModuleHybrid.SessionData
            memory enabledSessionData = sessionKeyManagerHybrid
                .enabledSessionsData(sessionDataDigest, address(sa));
        assertEq(enabledSessionData, sessionData);
    }

    function testExplicitEnableAndUseSessionDifferentOp() public {
        SessionKeyManagerHybrid.SessionData
            memory sessionData = ISessionKeyManagerModuleHybrid.SessionData({
                validUntil: 0,
                validAfter: 0,
                sessionValidationModule: address(mockSessionValidationModule),
                sessionKeyData: abi.encodePacked(bob.addr)
            });

        // Generate Session Data
        uint64[] memory chainIds = new uint64[](1);
        chainIds[0] = uint64(block.chainid);

        SessionKeyManagerHybrid.SessionData[]
            memory sessionDatas = new SessionKeyManagerHybrid.SessionData[](1);
        sessionDatas[0] = sessionData;

        // Enable session
        UserOperation memory op = makeEcdsaModuleUserOp(
            getSmartAccountExecuteCalldata(
                address(sessionKeyManagerHybrid),
                0,
                abi.encodeCall(
                    sessionKeyManagerHybrid.enableSession,
                    (sessionData)
                )
            ),
            sa,
            0,
            alice
        );
        entryPoint.handleOps(toArray(op), owner.addr);

        // Use session with just digest
        op = makeUseExistingSessionUserOp(
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
            sessionKeyManagerHybrid,
            sessionData,
            bob
        );
        vm.expectEmit();
        emit Log("shouldProcessTransactionFromSessionKey");
        entryPoint.handleOps(toArray(op), owner.addr);
    }

    function testEnableAndUseSessionPostSessionEnable() public {
        SessionKeyManagerHybrid.SessionData
            memory sessionData = ISessionKeyManagerModuleHybrid.SessionData({
                validUntil: 0,
                validAfter: 0,
                sessionValidationModule: address(mockSessionValidationModule),
                sessionKeyData: abi.encodePacked(bob.addr)
            });

        // Generate Session Data
        uint64[] memory chainIds = new uint64[](1);
        chainIds[0] = uint64(block.chainid);

        SessionKeyManagerHybrid.SessionData[]
            memory sessionDatas = new SessionKeyManagerHybrid.SessionData[](1);
        sessionDatas[0] = sessionData;

        (
            bytes memory sessionEnableData,
            bytes memory sessionEnableSignature
        ) = makeSessionEnableData(chainIds, sessionDatas, sa);

        // Enable and Use session for the first time
        UserOperation memory op = makeEnableAndUseSessionUserOp(
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
            sessionKeyManagerHybrid,
            sessionData,
            bob,
            0,
            sessionEnableData,
            sessionEnableSignature
        );
        entryPoint.handleOps(toArray(op), owner.addr);

        // Use session with just digest
        op = makeUseExistingSessionUserOp(
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
            sessionKeyManagerHybrid,
            sessionData,
            bob
        );
        vm.expectEmit();
        emit Log("shouldProcessTransactionFromSessionKey");
        entryPoint.handleOps(toArray(op), owner.addr);
    }

    function testEnableAndUseSessionMultiSessionEnable() public {
        // Generate Session Data
        uint64[] memory chainIds = new uint64[](5);
        SessionKeyManagerHybrid.SessionData[]
            memory sessionDatas = new SessionKeyManagerHybrid.SessionData[](5);

        for (uint256 i = 0; i < chainIds.length; ++i) {
            sessionDatas[i] = ISessionKeyManagerModuleHybrid.SessionData({
                validUntil: uint48(block.timestamp + i),
                validAfter: uint48(block.timestamp),
                sessionValidationModule: address(mockSessionValidationModule),
                sessionKeyData: abi.encodePacked(bob.addr)
            });

            chainIds[i] = uint64(block.chainid);
        }

        (
            bytes memory sessionEnableData,
            bytes memory sessionEnableSignature
        ) = makeSessionEnableData(chainIds, sessionDatas, sa);

        // Enable and Use session
        UserOperation memory op = makeEnableAndUseSessionUserOp(
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
            sessionKeyManagerHybrid,
            sessionDatas[0],
            bob,
            0,
            sessionEnableData,
            sessionEnableSignature
        );

        bytes32 sessionDataDigest = sessionKeyManagerHybrid.sessionDataDigest(
            sessionDatas[0]
        );

        vm.expectEmit();
        emit SessionCreated(address(sa), sessionDataDigest, sessionDatas[0]);
        vm.expectEmit();
        emit Log("shouldProcessTransactionFromSessionKey");
        entryPoint.handleOps(toArray(op), owner.addr);

        // Check session is enabled
        ISessionKeyManagerModuleHybrid.SessionData
            memory enabledSessionData = sessionKeyManagerHybrid
                .enabledSessionsData(sessionDataDigest, address(sa));
        assertEq(enabledSessionData, sessionDatas[0]);

        // Ensure other sessions are not enabled
        for (uint256 i = 1; i < sessionDatas.length; ++i) {
            enabledSessionData = sessionKeyManagerHybrid.enabledSessionsData(
                sessionKeyManagerHybrid.sessionDataDigest(sessionDatas[i]),
                address(sa)
            );
            ISessionKeyManagerModuleHybrid.SessionData memory emptyData;
            assertEq(enabledSessionData, emptyData);
        }
    }

    function testDisableSession() public {
        SessionKeyManagerHybrid.SessionData
            memory sessionData = ISessionKeyManagerModuleHybrid.SessionData({
                validUntil: 0,
                validAfter: 0,
                sessionValidationModule: address(mockSessionValidationModule),
                sessionKeyData: abi.encodePacked(bob.addr)
            });
        bytes32 sessionDataDigest = sessionKeyManagerHybrid.sessionDataDigest(
            sessionData
        );

        // Generate Session Data
        uint64[] memory chainIds = new uint64[](1);
        chainIds[0] = uint64(block.chainid);

        SessionKeyManagerHybrid.SessionData[]
            memory sessionDatas = new SessionKeyManagerHybrid.SessionData[](1);
        sessionDatas[0] = sessionData;

        (
            bytes memory sessionEnableData,
            bytes memory sessionEnableSignature
        ) = makeSessionEnableData(chainIds, sessionDatas, sa);

        // Enable and Use session
        UserOperation memory op = makeEnableAndUseSessionUserOp(
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
            sessionKeyManagerHybrid,
            sessionData,
            bob,
            0,
            sessionEnableData,
            sessionEnableSignature
        );
        entryPoint.handleOps(toArray(op), owner.addr);

        // Disable session
        op = makeEcdsaModuleUserOp(
            getSmartAccountExecuteCalldata(
                address(sessionKeyManagerHybrid),
                0,
                abi.encodeCall(
                    sessionKeyManagerHybrid.disableSession,
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
        ISessionKeyManagerModuleHybrid.SessionData
            memory enabledSessionData = sessionKeyManagerHybrid
                .enabledSessionsData(sessionDataDigest, address(sa));

        ISessionKeyManagerModuleHybrid.SessionData memory emptyData;
        assertEq(enabledSessionData, emptyData);
    }

    function testDisableSessions() public {
        SessionKeyManagerHybrid.SessionData
            memory sessionData = ISessionKeyManagerModuleHybrid.SessionData({
                validUntil: 0,
                validAfter: 0,
                sessionValidationModule: address(mockSessionValidationModule),
                sessionKeyData: abi.encodePacked(bob.addr)
            });
        bytes32 sessionDataDigest = sessionKeyManagerHybrid.sessionDataDigest(
            sessionData
        );

        // Generate Session Data
        uint64[] memory chainIds = new uint64[](1);
        chainIds[0] = uint64(block.chainid);

        SessionKeyManagerHybrid.SessionData[]
            memory sessionDatas = new SessionKeyManagerHybrid.SessionData[](1);
        sessionDatas[0] = sessionData;

        (
            bytes memory sessionEnableData,
            bytes memory sessionEnableSignature
        ) = makeSessionEnableData(chainIds, sessionDatas, sa);

        // Enable and Use session
        UserOperation memory op = makeEnableAndUseSessionUserOp(
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
            sessionKeyManagerHybrid,
            sessionData,
            bob,
            0,
            sessionEnableData,
            sessionEnableSignature
        );
        entryPoint.handleOps(toArray(op), owner.addr);

        // Disable session
        op = makeEcdsaModuleUserOp(
            getSmartAccountExecuteCalldata(
                address(sessionKeyManagerHybrid),
                0,
                abi.encodeCall(
                    sessionKeyManagerHybrid.disableSessions,
                    (toArray(sessionDataDigest))
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
        ISessionKeyManagerModuleHybrid.SessionData
            memory enabledSessionData = sessionKeyManagerHybrid
                .enabledSessionsData(sessionDataDigest, address(sa));

        ISessionKeyManagerModuleHybrid.SessionData memory emptyData;
        assertEq(enabledSessionData, emptyData);
    }

    function testShouldNotValidateTransactionFromNonEnabledSession() public {
        // Generate Session Data
        uint64[] memory chainIds = new uint64[](5);
        SessionKeyManagerHybrid.SessionData[]
            memory sessionDatas = new SessionKeyManagerHybrid.SessionData[](5);

        for (uint256 i = 0; i < chainIds.length; ++i) {
            sessionDatas[i] = ISessionKeyManagerModuleHybrid.SessionData({
                validUntil: uint48(block.timestamp + i),
                validAfter: uint48(block.timestamp),
                sessionValidationModule: address(mockSessionValidationModule),
                sessionKeyData: abi.encodePacked(bob.addr)
            });

            chainIds[i] = uint64(block.chainid);
        }

        (
            bytes memory sessionEnableData,
            bytes memory sessionEnableSignature
        ) = makeSessionEnableData(chainIds, sessionDatas, sa);

        // Use session not in session enable data
        sessionDatas[0].validUntil *= 2;
        UserOperation memory op = makeEnableAndUseSessionUserOp(
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
            sessionKeyManagerHybrid,
            sessionDatas[0],
            bob,
            0,
            sessionEnableData,
            sessionEnableSignature
        );

        try entryPoint.handleOps(toArray(op), owner.addr) {
            fail("should have reverted");
        } catch (bytes memory reason) {
            assertEq(
                reason,
                abi.encodeWithSelector(
                    IEntryPoint.FailedOp.selector,
                    0,
                    "AA23 reverted: SKM: SessionKeyDataHashMismatch"
                )
            );
        }
    }

    function testShouldNotValidateTransactionFromNonEnabledSessionWithPostCacheFlow()
        public
    {
        SessionKeyManagerHybrid.SessionData
            memory sessionData = ISessionKeyManagerModuleHybrid.SessionData({
                validUntil: 0,
                validAfter: 0,
                sessionValidationModule: address(mockSessionValidationModule),
                sessionKeyData: abi.encodePacked(bob.addr)
            });

        // Do not enable session

        // Use session
        UserOperation memory op = makeUseExistingSessionUserOp(
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
            sessionKeyManagerHybrid,
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
                    "AA23 reverted: SKM: Session key is not enabled"
                )
            );
        }
    }

    function testShouldNotValidateTransactionSignedFromInvalidSessionSigner()
        public
    {
        SessionKeyManagerHybrid.SessionData
            memory sessionData = ISessionKeyManagerModuleHybrid.SessionData({
                validUntil: 0,
                validAfter: 0,
                sessionValidationModule: address(mockSessionValidationModule),
                sessionKeyData: abi.encodePacked(bob.addr)
            });

        // Generate Session Data
        uint64[] memory chainIds = new uint64[](1);
        chainIds[0] = uint64(block.chainid);

        SessionKeyManagerHybrid.SessionData[]
            memory sessionDatas = new SessionKeyManagerHybrid.SessionData[](1);
        sessionDatas[0] = sessionData;

        (
            bytes memory sessionEnableData,
            bytes memory sessionEnableSignature
        ) = makeSessionEnableData(chainIds, sessionDatas, sa);

        // Enable and Use session
        UserOperation memory op = makeEnableAndUseSessionUserOp(
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
            sessionKeyManagerHybrid,
            sessionData,
            charlie,
            0,
            sessionEnableData,
            sessionEnableSignature
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

    function testShouldNotValidateTransactionWithInvalidSessionIndex() public {
        SessionKeyManagerHybrid.SessionData
            memory sessionData = ISessionKeyManagerModuleHybrid.SessionData({
                validUntil: 0,
                validAfter: 0,
                sessionValidationModule: address(mockSessionValidationModule),
                sessionKeyData: abi.encodePacked(bob.addr)
            });

        // Generate Session Data
        uint64[] memory chainIds = new uint64[](1);
        chainIds[0] = uint64(block.chainid);

        SessionKeyManagerHybrid.SessionData[]
            memory sessionDatas = new SessionKeyManagerHybrid.SessionData[](1);
        sessionDatas[0] = sessionData;

        (
            bytes memory sessionEnableData,
            bytes memory sessionEnableSignature
        ) = makeSessionEnableData(chainIds, sessionDatas, sa);

        // Enable and Use session
        UserOperation memory op = makeEnableAndUseSessionUserOp(
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
            sessionKeyManagerHybrid,
            sessionData,
            bob,
            chainIds.length,
            sessionEnableData,
            sessionEnableSignature
        );
        try entryPoint.handleOps(toArray(op), owner.addr) {
            fail("should have reverted");
        } catch (bytes memory reason) {
            assertEq(
                reason,
                abi.encodeWithSelector(
                    IEntryPoint.FailedOp.selector,
                    0,
                    "AA23 reverted: SKM: SessionKeyIndexInvalid"
                )
            );
        }
    }

    function testShouldNotValidateTransactionWithInvalidChainId() public {
        SessionKeyManagerHybrid.SessionData
            memory sessionData = ISessionKeyManagerModuleHybrid.SessionData({
                validUntil: 0,
                validAfter: 0,
                sessionValidationModule: address(mockSessionValidationModule),
                sessionKeyData: abi.encodePacked(bob.addr)
            });

        // Generate Session Data
        uint64[] memory chainIds = new uint64[](1);
        chainIds[0] = uint64(block.chainid);
        chainIds[0] += 1;

        SessionKeyManagerHybrid.SessionData[]
            memory sessionDatas = new SessionKeyManagerHybrid.SessionData[](1);
        sessionDatas[0] = sessionData;

        (
            bytes memory sessionEnableData,
            bytes memory sessionEnableSignature
        ) = makeSessionEnableData(chainIds, sessionDatas, sa);

        // Enable and Use session
        UserOperation memory op = makeEnableAndUseSessionUserOp(
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
            sessionKeyManagerHybrid,
            sessionData,
            bob,
            0,
            sessionEnableData,
            sessionEnableSignature
        );
        try entryPoint.handleOps(toArray(op), owner.addr) {
            fail("should have reverted");
        } catch (bytes memory reason) {
            assertEq(
                reason,
                abi.encodeWithSelector(
                    IEntryPoint.FailedOp.selector,
                    0,
                    "AA23 reverted: SKM: SessionChainIdMismatch"
                )
            );
        }
    }

    function testShouldNotValidateTransactionSignedFromInvalidSessionSignerPostSessionEnable()
        public
    {
        SessionKeyManagerHybrid.SessionData
            memory sessionData = ISessionKeyManagerModuleHybrid.SessionData({
                validUntil: 0,
                validAfter: 0,
                sessionValidationModule: address(mockSessionValidationModule),
                sessionKeyData: abi.encodePacked(bob.addr)
            });

        // Generate Session Data
        uint64[] memory chainIds = new uint64[](1);
        chainIds[0] = uint64(block.chainid);

        SessionKeyManagerHybrid.SessionData[]
            memory sessionDatas = new SessionKeyManagerHybrid.SessionData[](1);
        sessionDatas[0] = sessionData;

        (
            bytes memory sessionEnableData,
            bytes memory sessionEnableSignature
        ) = makeSessionEnableData(chainIds, sessionDatas, sa);

        // Enable and Use session
        UserOperation memory op = makeEnableAndUseSessionUserOp(
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
            sessionKeyManagerHybrid,
            sessionData,
            bob,
            0,
            sessionEnableData,
            sessionEnableSignature
        );
        entryPoint.handleOps(toArray(op), owner.addr);

        // Use session with just digest but wrong signer
        op = makeUseExistingSessionUserOp(
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
            sessionKeyManagerHybrid,
            sessionData,
            charlie
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
            sessionKeyManagerHybrid.isValidSignature(userOpHash, signature),
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
            sessionKeyManagerHybrid.isValidSignatureUnsafe(
                userOpHash,
                signature
            ),
            bytes4(0xffffffff)
        );
    }

    function testShouldParseEnableSessionSignatureCorrectly(
        uint8 _isSessionEnableTransaction,
        uint8 _sessionKeyIndex,
        uint48 _validUntil,
        uint48 _validAfter,
        address _sessionValidationModule,
        bytes calldata _sessionKeyData,
        bytes calldata _sessionEnableData,
        bytes calldata _sessionEnableSignature,
        bytes calldata _sessionKeySignature
    ) public {
        bytes memory encoded = abi.encodePacked(
            _isSessionEnableTransaction,
            _sessionKeyIndex,
            _validUntil,
            _validAfter,
            _sessionValidationModule,
            abi.encode(
                _sessionKeyData,
                _sessionEnableData,
                _sessionEnableSignature,
                _sessionKeySignature
            )
        );
        (
            uint256 sessionKeyIndex,
            uint48 validUntil,
            uint48 validAfter,
            address sessionValidationModule,
            bytes memory sessionKeyData,
            bytes memory sessionEnableData,
            bytes memory sessionEnableSignature,
            bytes memory sessionKeySignature
        ) = skmParserStub.parseSessionEnableSignatureSingleCall(encoded);

        assertEq(
            sessionKeyIndex,
            _sessionKeyIndex,
            "mismatched sessionKeyIndex"
        );
        assertEq(validUntil, _validUntil, "mismatched validUntil");
        assertEq(validAfter, _validAfter, "mismatched validAfter");
        assertEq(
            sessionValidationModule,
            _sessionValidationModule,
            "mismatched sessionValidationModule"
        );
        assertEq(sessionKeyData, _sessionKeyData, "mismatched sessionKeyData");
        assertEq(
            sessionEnableData,
            _sessionEnableData,
            "mismatched sessionEnableData"
        );
        assertEq(
            sessionEnableSignature,
            _sessionEnableSignature,
            "mismatched sessionEnableSignature"
        );
        assertEq(
            sessionKeySignature,
            _sessionKeySignature,
            "mismatched sessionKeySignature"
        );
    }

    function testShouldParsePreEnabledSignatureCorrectly(
        uint8 _isSessionEnableTransaction,
        bytes32 _sessionDataDigest,
        bytes calldata _sessionKeySignature
    ) public {
        bytes memory encoded = abi.encodePacked(
            _isSessionEnableTransaction,
            abi.encode(_sessionDataDigest, _sessionKeySignature)
        );
        (
            bytes32 sessionDataDigest,
            bytes memory sessionKeySignature
        ) = skmParserStub.parseSessionDataPreEnabledSignatureSingleCall(
                encoded
            );

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

    function makeSessionEnableData(
        uint64[] memory chainIds,
        SessionKeyManagerHybrid.SessionData[] memory _sessionDatas,
        SmartAccount _signer
    ) internal view returns (bytes memory, bytes memory) {
        bytes32[] memory sessionDigests = new bytes32[](_sessionDatas.length);
        for (uint256 i = 0; i < _sessionDatas.length; i++) {
            sessionDigests[i] = sessionKeyManagerHybrid.sessionDataDigest(
                _sessionDatas[i]
            );
        }
        bytes memory sessionEnableData = abi.encodePacked(
            uint8(_sessionDatas.length)
        );
        for (uint256 i = 0; i < chainIds.length; ++i) {
            sessionEnableData = abi.encodePacked(
                sessionEnableData,
                chainIds[i]
            );
        }
        sessionEnableData = abi.encodePacked(sessionEnableData, sessionDigests);

        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n52",
                keccak256(sessionEnableData),
                _signer
            )
        );
        TestAccount memory owner = testAccountsByAddress[
            ecdsaOwnershipRegistryModule.getOwner(address(_signer))
        ];
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(owner.privateKey, digest);
        bytes memory erc1271Signature = abi.encode(
            abi.encodePacked(r, s, v),
            ecdsaOwnershipRegistryModule
        );
        return (sessionEnableData, erc1271Signature);
    }

    function makeEnableAndUseSessionUserOp(
        bytes memory _calldata,
        SmartAccount _sa,
        uint192 _nonceKey,
        SessionKeyManagerHybrid _skm,
        SessionKeyManagerHybrid.SessionData memory _sessionData,
        TestAccount memory _sessionSigner,
        uint256 _sessionKeyIndex,
        bytes memory _sessionEnableData,
        bytes memory _sessionEnableSignature
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

        bytes memory sessionKeySignature;
        {
            // Sign the UserOp
            bytes32 userOpHash = entryPoint.getUserOpHash(op);
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(
                _sessionSigner.privateKey,
                ECDSA.toEthSignedMessageHash(userOpHash)
            );
            sessionKeySignature = abi.encodePacked(r, s, v);
        }

        // Generate Module Signature
        bytes memory moduleSignature = abi.encodePacked(
            uint8(0x01),
            uint8(_sessionKeyIndex),
            _sessionData.validUntil,
            _sessionData.validAfter,
            _sessionData.sessionValidationModule,
            abi.encode(
                _sessionData.sessionKeyData,
                _sessionEnableData,
                _sessionEnableSignature,
                sessionKeySignature
            )
        );
        op.signature = abi.encode(moduleSignature, _skm);
    }

    function makeUseExistingSessionUserOp(
        bytes memory _calldata,
        SmartAccount _sa,
        uint192 _nonceKey,
        SessionKeyManagerHybrid _skm,
        SessionKeyManagerHybrid.SessionData memory _sessionData,
        TestAccount memory _sessionSigner
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
            _sessionSigner.privateKey,
            ECDSA.toEthSignedMessageHash(userOpHash)
        );
        bytes memory sessionKeySignature = abi.encodePacked(r, s, v);

        // Generate Module Signature
        bytes memory moduleSignature = abi.encodePacked(
            uint8(0x00),
            abi.encode(
                sessionKeyManagerHybrid.sessionDataDigest(_sessionData),
                sessionKeySignature
            )
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

contract SKMParserStub is SessionKeyManagerHybrid {
    function parseSessionEnableSignatureSingleCall(
        bytes calldata _moduleSignature
    )
        public
        pure
        returns (
            uint256 sessionKeyIndex,
            uint48 validUntil,
            uint48 validAfter,
            address sessionValidationModule,
            bytes calldata sessionKeyData,
            bytes calldata sessionEnableData,
            bytes calldata sessionEnableSignature,
            bytes calldata sessionKeySignature
        )
    {
        return _parseSessionEnableSignatureSingleCall(_moduleSignature);
    }

    function parseSessionDataPreEnabledSignatureSingleCall(
        bytes calldata _moduleSignature
    )
        public
        pure
        returns (bytes32 sessionDataDigest, bytes calldata sessionKeySignature)
    {
        return _parseSessionDataPreEnabledSignatureSingleCall(_moduleSignature);
    }
}
