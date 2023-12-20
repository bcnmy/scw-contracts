// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import {SATestBase, IEntryPoint} from "../../base/SATestBase.sol";
import {SmartAccount} from "sa/SmartAccount.sol";
import {UserOperation} from "aa-core/EntryPoint.sol";
import {SessionKeyManagerHybrid} from "sa/modules/SessionKeyManagers/SessionKeyManagerHybrid.sol";
import {IStatefulSessionKeyManagerBase} from "sa/interfaces/modules/SessionKeyManagers/IStatefulSessionKeyManagerBase.sol";
import {MockSessionValidationModule} from "sa/test/mocks/MockSessionValidationModule.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Vm} from "forge-std/Test.sol";
import "forge-std/console2.sol";

contract SessionKeyManagerHybridBatchCallTest is SATestBase {
    SmartAccount private sa;
    SessionKeyManagerHybrid private sessionKeyManagerHybrid;
    MockSessionValidationModule private mockSessionValidationModule1;
    MockSessionValidationModule private mockSessionValidationModule2;
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
    event ValidateSessionParams(
        address destinationContract,
        uint256 callValue,
        bytes funcCallData,
        bytes sessionKeyData,
        bytes callSpecificData
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
        mockSessionValidationModule1 = new MockSessionValidationModule();
        vm.label(
            address(mockSessionValidationModule1),
            "mockSessionValidationModule1"
        );
        mockSessionValidationModule2 = new MockSessionValidationModule();
        vm.label(
            address(mockSessionValidationModule1),
            "mockSessionValidationModule2"
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

    function testEnableAndUseSessionSingleBatchItem() public {
        SessionKeyManagerHybrid.SessionData
            memory sessionData = IStatefulSessionKeyManagerBase.SessionData({
                validUntil: 0,
                validAfter: 0,
                sessionValidationModule: address(mockSessionValidationModule1),
                sessionKeyData: abi.encodePacked(bob.addr)
            });
        bytes32 sessionDataDigest = sessionKeyManagerHybrid.sessionDataDigest(
            sessionData
        );

        // Generate Session Enable Data
        (
            bytes memory sessionEnableData,
            bytes memory sessionEnableSignature
        ) = makeSessionEnableData(
                toArrayU64(uint64(block.chainid)),
                toArray(sessionData),
                sa
            );

        // Generate Session Info
        bytes memory callSpecificData = abi.encode("hello world");
        bytes memory sessionInfo = makeSessionEnableSessionInfo(
            0,
            0,
            sessionData,
            callSpecificData
        );

        // Enable and Use session
        address to = address(stub);
        uint256 value = 0;
        bytes memory callData = abi.encodeCall(
            stub.emitMessage,
            ("shouldProcessTransactionFromSessionKey")
        );
        UserOperation memory op = makeSessionUserOp(
            getSmartAccountBatchExecuteCalldata(
                toArray(to),
                toArray(value),
                toArray(callData)
            ),
            sa,
            0,
            sessionKeyManagerHybrid,
            bob,
            toArray(sessionEnableData),
            toArray(sessionEnableSignature),
            toArray(sessionInfo)
        );

        vm.expectEmit();
        emit SessionCreated(address(sa), sessionDataDigest, sessionData);
        vm.expectEmit();
        emit ValidateSessionParams(
            to,
            value,
            callData,
            sessionData.sessionKeyData,
            callSpecificData
        );
        vm.expectEmit();
        emit Log("shouldProcessTransactionFromSessionKey");
        entryPoint.handleOps(toArray(op), owner.addr);

        // Check session is enabled
        IStatefulSessionKeyManagerBase.SessionData
            memory enabledSessionData = sessionKeyManagerHybrid
                .enabledSessionsData(sessionDataDigest, address(sa));
        assertEq(enabledSessionData, sessionData);
    }

    function testEnableAndUseSessionTwoBatchItems() public {
        SessionKeyManagerHybrid.SessionData
            memory sessionData1 = IStatefulSessionKeyManagerBase.SessionData({
                validUntil: 0,
                validAfter: 0,
                sessionValidationModule: address(mockSessionValidationModule1),
                sessionKeyData: abi.encodePacked(bob.addr)
            });
        bytes32 sessionDataDigest1 = sessionKeyManagerHybrid.sessionDataDigest(
            sessionData1
        );

        SessionKeyManagerHybrid.SessionData
            memory sessionData2 = IStatefulSessionKeyManagerBase.SessionData({
                validUntil: 0,
                validAfter: 0,
                sessionValidationModule: address(mockSessionValidationModule2),
                sessionKeyData: abi.encodePacked(bob.addr)
            });
        bytes32 sessionDataDigest2 = sessionKeyManagerHybrid.sessionDataDigest(
            sessionData2
        );

        // Generate Session Enable Data
        (
            bytes memory sessionEnableData,
            bytes memory sessionEnableSignature
        ) = makeSessionEnableData(
                toArrayU64(uint64(block.chainid), uint64(block.chainid)),
                toArray(sessionData1, sessionData2),
                sa
            );

        // Generate Session Info
        bytes memory callSpecificData1 = abi.encode("hello world");
        bytes memory sessionInfo1 = makeSessionEnableSessionInfo(
            0, // sessionEnableData[0]
            0, // sessionEnableData[0][0]
            sessionData1,
            callSpecificData1
        );
        bytes memory callSpecificData2 = abi.encode("hello world 2");
        bytes memory sessionInfo2 = makeSessionEnableSessionInfo(
            0, // sessionEnableData[0]
            1, // sessionEnableData[0][1]
            sessionData2,
            callSpecificData2
        );

        // Enable and Use session
        address to = address(stub);
        uint256 value = 0;
        bytes memory callData1 = abi.encodeCall(
            stub.emitMessage,
            ("shouldProcessTransactionFromSessionKey1")
        );
        bytes memory callData2 = abi.encodeCall(
            stub.emitMessage,
            ("shouldProcessTransactionFromSessionKey2")
        );
        UserOperation memory op = makeSessionUserOp(
            getSmartAccountBatchExecuteCalldata(
                toArray(to, to),
                toArray(value, value),
                toArray(callData1, callData2)
            ),
            sa,
            0,
            sessionKeyManagerHybrid,
            bob,
            toArray(sessionEnableData),
            toArray(sessionEnableSignature),
            toArray(sessionInfo1, sessionInfo2)
        );

        vm.expectEmit();
        emit SessionCreated(address(sa), sessionDataDigest1, sessionData1);
        vm.expectEmit();
        emit ValidateSessionParams(
            to,
            value,
            callData1,
            sessionData1.sessionKeyData,
            callSpecificData1
        );

        vm.expectEmit();
        emit SessionCreated(address(sa), sessionDataDigest2, sessionData2);
        vm.expectEmit();
        emit ValidateSessionParams(
            to,
            value,
            callData2,
            sessionData2.sessionKeyData,
            callSpecificData2
        );

        vm.expectEmit();
        emit Log("shouldProcessTransactionFromSessionKey1");
        vm.expectEmit();
        emit Log("shouldProcessTransactionFromSessionKey2");

        entryPoint.handleOps(toArray(op), owner.addr);

        // Check sessions are enabled
        IStatefulSessionKeyManagerBase.SessionData
            memory enabledSessionData = sessionKeyManagerHybrid
                .enabledSessionsData(sessionDataDigest1, address(sa));
        assertEq(enabledSessionData, sessionData1);

        enabledSessionData = sessionKeyManagerHybrid.enabledSessionsData(
            sessionDataDigest2,
            address(sa)
        );
        assertEq(enabledSessionData, sessionData2);
    }

    function testUseSessionTwoBatchItemsPostEnable() public {
        SessionKeyManagerHybrid.SessionData
            memory sessionData1 = IStatefulSessionKeyManagerBase.SessionData({
                validUntil: 0,
                validAfter: 0,
                sessionValidationModule: address(mockSessionValidationModule1),
                sessionKeyData: abi.encodePacked(bob.addr)
            });

        SessionKeyManagerHybrid.SessionData
            memory sessionData2 = IStatefulSessionKeyManagerBase.SessionData({
                validUntil: 0,
                validAfter: 0,
                sessionValidationModule: address(mockSessionValidationModule2),
                sessionKeyData: abi.encodePacked(bob.addr)
            });

        // Generate Session Enable Data
        (
            bytes memory sessionEnableData,
            bytes memory sessionEnableSignature
        ) = makeSessionEnableData(
                toArrayU64(uint64(block.chainid), uint64(block.chainid)),
                toArray(sessionData1, sessionData2),
                sa
            );

        // Generate Session Info
        bytes memory callSpecificData1 = abi.encode("hello world");
        bytes memory sessionInfo1 = makeSessionEnableSessionInfo(
            0, // sessionEnableData[0]
            0, // sessionEnableData[0][0]
            sessionData1,
            callSpecificData1
        );
        bytes memory callSpecificData2 = abi.encode("hello world 2");
        bytes memory sessionInfo2 = makeSessionEnableSessionInfo(
            0, // sessionEnableData[0]
            1, // sessionEnableData[0][1]
            sessionData2,
            callSpecificData2
        );

        // Enable and Use session
        address to = address(stub);
        uint256 value = 0;
        bytes memory callData1 = abi.encodeCall(
            stub.emitMessage,
            ("shouldProcessTransactionFromSessionKey1")
        );
        bytes memory callData2 = abi.encodeCall(
            stub.emitMessage,
            ("shouldProcessTransactionFromSessionKey2")
        );
        UserOperation memory op = makeSessionUserOp(
            getSmartAccountBatchExecuteCalldata(
                toArray(to, to),
                toArray(value, value),
                toArray(callData1, callData2)
            ),
            sa,
            0,
            sessionKeyManagerHybrid,
            bob,
            toArray(sessionEnableData),
            toArray(sessionEnableSignature),
            toArray(sessionInfo1, sessionInfo2)
        );
        entryPoint.handleOps(toArray(op), owner.addr);

        // Use the sessions again, but this time with the session data pre-enabled
        op = makeSessionUserOp(
            getSmartAccountBatchExecuteCalldata(
                toArray(to, to),
                toArray(value, value),
                toArray(callData1, callData2)
            ),
            sa,
            0,
            sessionKeyManagerHybrid,
            bob,
            new bytes[](0), // no need for sessionEnableData
            new bytes[](0), // no need for sessionEnableSignature
            toArray(
                makeSessionPreEnabledSessionInfo(
                    sessionData1,
                    sessionKeyManagerHybrid,
                    callSpecificData1
                ),
                makeSessionPreEnabledSessionInfo(
                    sessionData2,
                    sessionKeyManagerHybrid,
                    callSpecificData2
                )
            )
        );

        vm.expectEmit();
        emit ValidateSessionParams(
            to,
            value,
            callData1,
            sessionData1.sessionKeyData,
            callSpecificData1
        );

        vm.expectEmit();
        emit ValidateSessionParams(
            to,
            value,
            callData2,
            sessionData2.sessionKeyData,
            callSpecificData2
        );

        vm.expectEmit();
        emit Log("shouldProcessTransactionFromSessionKey1");
        vm.expectEmit();
        emit Log("shouldProcessTransactionFromSessionKey2");
        entryPoint.handleOps(toArray(op), owner.addr);
    }

    function testUseSessionTwoBatchItemsOneFreshAndOtherPostEnable() public {
        SessionKeyManagerHybrid.SessionData
            memory sessionData1 = IStatefulSessionKeyManagerBase.SessionData({
                validUntil: 0,
                validAfter: 0,
                sessionValidationModule: address(mockSessionValidationModule1),
                sessionKeyData: abi.encodePacked(bob.addr)
            });

        SessionKeyManagerHybrid.SessionData
            memory sessionData2 = IStatefulSessionKeyManagerBase.SessionData({
                validUntil: 0,
                validAfter: 0,
                sessionValidationModule: address(mockSessionValidationModule2),
                sessionKeyData: abi.encodePacked(bob.addr)
            });

        // Generate Session Enable Data
        (
            bytes memory sessionEnableData,
            bytes memory sessionEnableSignature
        ) = makeSessionEnableData(
                toArrayU64(uint64(block.chainid), uint64(block.chainid)),
                toArray(sessionData1, sessionData2),
                sa
            );

        // Generate Session Info
        bytes memory callSpecificData1 = abi.encode("hello world");
        bytes memory sessionInfo1 = makeSessionEnableSessionInfo(
            0, // sessionEnableData[0]
            0, // sessionEnableData[0][0]
            sessionData1,
            callSpecificData1
        );
        bytes memory callSpecificData2 = abi.encode("hello world 2");
        bytes memory sessionInfo2 = makeSessionEnableSessionInfo(
            0, // sessionEnableData[0]
            1, // sessionEnableData[0][1]
            sessionData2,
            callSpecificData2
        );

        // Enable and Use session
        address to = address(stub);
        uint256 value = 0;
        bytes memory callData1 = abi.encodeCall(
            stub.emitMessage,
            ("shouldProcessTransactionFromSessionKey1")
        );
        bytes memory callData2 = abi.encodeCall(
            stub.emitMessage,
            ("shouldProcessTransactionFromSessionKey2")
        );
        // Use only one session
        UserOperation memory op = makeSessionUserOp(
            getSmartAccountBatchExecuteCalldata(
                toArray(to),
                toArray(value),
                toArray(callData1)
            ),
            sa,
            0,
            sessionKeyManagerHybrid,
            bob,
            toArray(sessionEnableData),
            toArray(sessionEnableSignature),
            toArray(sessionInfo1)
        );
        entryPoint.handleOps(toArray(op), owner.addr);

        // Use the sessions again, but this time the first with the session data pre-enabled
        // and the second with a freshly enabled session
        op = makeSessionUserOp(
            getSmartAccountBatchExecuteCalldata(
                toArray(to, to),
                toArray(value, value),
                toArray(callData1, callData2)
            ),
            sa,
            0,
            sessionKeyManagerHybrid,
            bob,
            toArray(sessionEnableData),
            toArray(sessionEnableSignature),
            toArray(
                makeSessionPreEnabledSessionInfo(
                    sessionData1,
                    sessionKeyManagerHybrid,
                    callSpecificData1
                ),
                sessionInfo2
            )
        );

        vm.expectEmit();
        emit ValidateSessionParams(
            to,
            value,
            callData1,
            sessionData1.sessionKeyData,
            callSpecificData1
        );

        vm.expectEmit();
        emit SessionCreated(
            address(sa),
            sessionKeyManagerHybrid.sessionDataDigest(sessionData2),
            sessionData2
        );
        vm.expectEmit();
        emit ValidateSessionParams(
            to,
            value,
            callData2,
            sessionData2.sessionKeyData,
            callSpecificData2
        );

        vm.expectEmit();
        emit Log("shouldProcessTransactionFromSessionKey1");
        vm.expectEmit();
        emit Log("shouldProcessTransactionFromSessionKey2");
        entryPoint.handleOps(toArray(op), owner.addr);
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

    function testShouldParseValidateUserBatchSignature(
        bytes[] calldata _sessionEnableDataList,
        bytes[] calldata _sessionEnableSignatureList,
        bytes[] calldata _sessionInfos,
        bytes calldata _sessionKeySignature
    ) public {
        bytes memory data = abi.encode(
            _sessionEnableDataList,
            _sessionEnableSignatureList,
            _sessionInfos,
            _sessionKeySignature
        );

        (
            bytes[] memory sessionEnableDataList,
            bytes[] memory sessionEnableSignatureList,
            bytes[] memory sessionInfos,
            bytes memory sessionKeySignature
        ) = skmParserStub.parseValidateUserOpBatchSignature(data);

        assertEq(
            abi.encode(sessionEnableDataList),
            abi.encode(_sessionEnableDataList),
            "mismatched sessionEnableDataList"
        );

        assertEq(
            abi.encode(sessionEnableSignatureList),
            abi.encode(_sessionEnableSignatureList),
            "mismatched sessionEnableSignatureList"
        );

        assertEq(
            abi.encode(sessionInfos),
            abi.encode(_sessionInfos),
            "mismatched sessionInfos"
        );

        assertEq(
            sessionKeySignature,
            _sessionKeySignature,
            "mismatched sessionKeySignature"
        );
    }

    function testShouldParseSessionDataPreEnableSignatureBatchCall(
        uint8 _isSessionEnableFlag,
        bytes32 _sessionDataDigest,
        bytes memory _callSpecificData
    ) public {
        bytes memory data = abi.encodePacked(
            _isSessionEnableFlag,
            _sessionDataDigest,
            abi.encode(_callSpecificData)
        );

        (
            bytes32 sessionDataDigest,
            bytes memory callSpecificData
        ) = skmParserStub.parseSessionDataPreEnabledSignatureBatchCall(data);

        assertEq(
            sessionDataDigest,
            _sessionDataDigest,
            "mismatched sessionDataDigest"
        );
        assertEq(
            callSpecificData,
            _callSpecificData,
            "mismatched callSpecificData"
        );
    }

    function testShouldParseSessionEnableSignatureCorrectly(
        uint8 _isSessionEnableFlag,
        uint8 _sessionEnableDataIndex,
        uint8 _sessionKeyIndex,
        uint48 _validUntil,
        uint48 _validAfter,
        address _sessionValidationModule,
        bytes calldata _sessionKeyData,
        bytes calldata _callSpecificData
    ) public {
        bytes memory data = abi.encodePacked(
            _isSessionEnableFlag,
            _sessionEnableDataIndex,
            _sessionKeyIndex,
            _validUntil,
            _validAfter,
            _sessionValidationModule,
            abi.encode(_sessionKeyData, _callSpecificData)
        );

        (
            uint256 sessionEnableDataIndex,
            uint256 sessionKeyIndex,
            uint48 validUntil,
            uint48 validAfter,
            address sessionValidationModule,
            bytes memory sessionKeyData,
            bytes memory callSpecificData
        ) = skmParserStub.parseSessionEnableSignatureBatchCall(data);

        assertEq(sessionEnableDataIndex, _sessionEnableDataIndex);
        assertEq(sessionKeyIndex, _sessionKeyIndex);
        assertEq(validUntil, _validUntil);
        assertEq(validAfter, _validAfter);
        assertEq(sessionValidationModule, _sessionValidationModule);
        assertEq(sessionKeyData, _sessionKeyData);
        assertEq(callSpecificData, _callSpecificData);
    }

    function testShouldParseBatchCallDataCorrectly(
        address[] calldata _destinations,
        uint256[] calldata _callValues,
        bytes[] calldata _operationCalldatas
    ) public {
        bytes memory data = abi.encodeCall(
            SmartAccount.executeBatch,
            (_destinations, _callValues, _operationCalldatas)
        );

        (
            address[] memory destinations,
            uint256[] memory callValues,
            bytes[] memory operationCalldatas
        ) = skmParserStub.parseBatchCallCalldata(data);

        assertEq(destinations, _destinations, "mismatched destinations");
        assertEq(callValues, _callValues, "mismatched callValues");

        assertEq(
            abi.encode(operationCalldatas),
            abi.encode(_operationCalldatas),
            "mismatched operationCalldatas"
        );
    }

    function assertEq(
        SessionKeyManagerHybrid.SessionData memory _a,
        SessionKeyManagerHybrid.SessionData memory _b
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

    function makeSessionUserOp(
        bytes memory _calldata,
        SmartAccount _sa,
        uint192 _nonceKey,
        SessionKeyManagerHybrid _skm,
        TestAccount memory _sessionSigner,
        bytes[] memory _sessionEnableDataList,
        bytes[] memory _sessionEnableSignatureList,
        bytes[] memory _sessionInfos
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
        bytes memory moduleSignature = abi.encode(
            _sessionEnableDataList,
            _sessionEnableSignatureList,
            _sessionInfos,
            sessionKeySignature
        );
        op.signature = abi.encode(moduleSignature, _skm);
    }

    function makeSessionEnableSessionInfo(
        uint8 _sessionEnableDataIndex,
        uint8 _sessionKeyIndex,
        SessionKeyManagerHybrid.SessionData memory _sessionData,
        bytes memory _callSpecificData
    ) internal pure returns (bytes memory info) {
        info = abi.encodePacked(
            uint8(0x1),
            _sessionEnableDataIndex,
            _sessionKeyIndex,
            _sessionData.validUntil,
            _sessionData.validAfter,
            _sessionData.sessionValidationModule,
            abi.encode(_sessionData.sessionKeyData, _callSpecificData)
        );
    }

    function makeSessionPreEnabledSessionInfo(
        SessionKeyManagerHybrid.SessionData memory _sessionData,
        SessionKeyManagerHybrid _skm,
        bytes memory _callSpecificData
    ) internal pure returns (bytes memory info) {
        info = abi.encodePacked(
            uint8(0x0),
            _skm.sessionDataDigest(_sessionData),
            abi.encode(_callSpecificData)
        );
    }
}

contract Stub {
    event Log(string message);

    function emitMessage(string calldata _message) public {
        emit Log(_message);
    }
}

contract SKMParserStub is SessionKeyManagerHybrid {
    function parseBatchCallCalldata(
        bytes calldata _userOpCalldata
    )
        external
        pure
        returns (
            address[] calldata destinations,
            uint256[] calldata callValues,
            bytes[] calldata operationCalldatas
        )
    {
        return _parseBatchCallCalldata(_userOpCalldata);
    }

    function parseSessionEnableSignatureBatchCall(
        bytes calldata _moduleSignature
    )
        external
        pure
        returns (
            uint256 sessionEnableDataIndex,
            uint256 sessionKeyIndex,
            uint48 validUntil,
            uint48 validAfter,
            address sessionValidationModule,
            bytes calldata sessionKeyData,
            bytes calldata callSpecificData
        )
    {
        return _parseSessionEnableSignatureBatchCall(_moduleSignature);
    }

    function parseSessionDataPreEnabledSignatureBatchCall(
        bytes calldata _moduleSignature
    )
        external
        pure
        returns (bytes32 sessionDataDigest, bytes calldata callSpecificData)
    {
        return _parseSessionDataPreEnabledSignatureBatchCall(_moduleSignature);
    }

    function parseValidateUserOpBatchSignature(
        bytes calldata _moduleSignature
    )
        external
        pure
        returns (
            bytes[] calldata sessionEnableDataList,
            bytes[] calldata sessionEnableSignatureList,
            bytes[] calldata sessionInfos,
            bytes calldata sessionKeySignature
        )
    {
        return _parseValidateUserOpBatchSignature(_moduleSignature);
    }
}
