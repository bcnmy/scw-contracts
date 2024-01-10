import { expect } from "chai";
import {
  makeEcdsaSessionKeySignedUserOp,
  enableNewTreeForSmartAccountViaEcdsa,
  getABISessionKeyParams,
  makeEcdsaSessionKeySignedBatchUserOp,
} from "../../utils/sessionKey";
import { ethers, deployments, waffle } from "hardhat";
import { makeEcdsaModuleUserOp, fillAndSign } from "../../utils/userOp";
import {
  getEntryPoint,
  getSmartAccountImplementation,
  getSmartAccountFactory,
  getMockToken,
  getEcdsaOwnershipRegistryModule,
  getSmartAccountWithModule,
} from "../../utils/setupHelper";
import { hexDataSlice, defaultAbiCoder } from "ethers/lib/utils";

describe("SessionKey: ABI Session Validation Module", async () => {
  const [
    deployer,
    smartAccountOwner,
    alice,
    bob,
    charlie,
    verifiedSigner,
    sessionKey,
    nonAuthSessionKey,
  ] = waffle.provider.getWallets();
  const maxAmount = ethers.utils.parseEther("100");

  const setupTests = deployments.createFixture(async ({ deployments }) => {
    await deployments.fixture();
    const mockToken = await getMockToken();
    const entryPoint = await getEntryPoint();
    const ecdsaModule = await getEcdsaOwnershipRegistryModule();
    const EcdsaOwnershipRegistryModule = await ethers.getContractFactory(
      "EcdsaOwnershipRegistryModule"
    );
    const ecdsaOwnershipSetupData =
      EcdsaOwnershipRegistryModule.interface.encodeFunctionData(
        "initForSmartAccount",
        [await smartAccountOwner.getAddress()]
      );
    const smartAccountDeploymentIndex = 0;
    const userSA = await getSmartAccountWithModule(
      ecdsaModule.address,
      ecdsaOwnershipSetupData,
      smartAccountDeploymentIndex
    );

    // send funds to userSA and mint tokens
    await deployer.sendTransaction({
      to: userSA.address,
      value: ethers.utils.parseEther("10"),
    });
    await mockToken.mint(userSA.address, ethers.utils.parseEther("1000000"));

    // deploy module and enable it in the smart account
    const sessionKeyManager = await (
      await ethers.getContractFactory("SessionKeyManager")
    ).deploy();
    const userOp = await makeEcdsaModuleUserOp(
      "enableModule",
      [sessionKeyManager.address],
      userSA.address,
      smartAccountOwner,
      entryPoint,
      ecdsaModule.address
    );
    await entryPoint.handleOps([userOp], alice.address);

    const sessionRouter = await (
      await ethers.getContractFactory("BatchedSessionRouter")
    ).deploy();
    const userOp2 = await makeEcdsaModuleUserOp(
      "enableModule",
      [sessionRouter.address],
      userSA.address,
      smartAccountOwner,
      entryPoint,
      ecdsaModule.address,
      {
        preVerificationGas: 50000,
      }
    );
    await entryPoint.handleOps([userOp2], alice.address);

    const abiSVM = await (
      await ethers.getContractFactory("ABISessionValidationModule")
    ).deploy();

    const mockProtocol = await (
      await ethers.getContractFactory("MockProtocol")
    ).deploy();

    const { sessionKeyData, leafData } = await getABISessionKeyParams(
      sessionKey.address,
      {
        destContract: mockToken.address,
        functionSelector: ethers.utils.hexDataSlice(
          ethers.utils.id("transfer(address,uint256)"), // transfer function selector
          0,
          4
        ),
        valueLimit: ethers.utils.parseEther("1"),
        // array of offsets, values, and conditions
        rules: [
          {
            offset: 0,
            referenceValue: ethers.utils.hexZeroPad(charlie.address, 32),
            condition: 0, // equal
          },
          {
            offset: 32,
            referenceValue: ethers.utils.hexZeroPad("0x056bc75e2d63100000", 32),
            condition: 1, // less than or equal
          },
        ],
      },
      0,
      0,
      abiSVM.address
    );

    const { sessionKeyData: sessionKeyData2, leafData: leafData2 } =
      await getABISessionKeyParams(
        sessionKey.address,
        {
          destContract: mockToken.address,
          functionSelector: ethers.utils.hexDataSlice(
            ethers.utils.id("approve(address,uint256)"),
            0,
            4
          ), // transfer function selector
          valueLimit: ethers.utils.parseEther("0"), // value limit
          // array of offsets, values, and conditions
          rules: [
            {
              offset: 0,
              condition: 0,
              referenceValue: ethers.utils.hexZeroPad(mockProtocol.address, 32),
            }, // equal
            {
              offset: 32,
              condition: 1, // less than or equal;
              referenceValue: ethers.utils.hexZeroPad(
                "0x21E19E0C9BAB2400000",
                32
              ), // 0x056bc75e2d63100000 = hex(10^22) = 10,000tokens
            },
          ],
        },
        0,
        0,
        abiSVM.address
      );

    const { sessionKeyData: sessionKeyData3, leafData: leafData3 } =
      await getABISessionKeyParams(
        sessionKey.address,
        {
          destContract: mockProtocol.address,
          functionSelector: ethers.utils.hexDataSlice(
            ethers.utils.id("interact(address,uint256)"),
            0,
            4
          ),
          valueLimit: ethers.utils.parseEther("0"), // value limit
          // array of offsets, values, and conditions
          rules: [
            {
              offset: 0,
              condition: 0, // equal
              referenceValue: ethers.utils.hexZeroPad(mockToken.address, 32),
            },
            {
              offset: 32,
              referenceValue: ethers.utils.hexZeroPad(
                "0x21E19E0C9BAB2400000",
                32
              ), // 0x056bc75e2d63100000 = hex(10^22) = 10,000tokens
              condition: 1, // less than or equal;
            },
          ],
        },
        0,
        0,
        abiSVM.address
      );

    const { sessionKeyData: sessionKeyData4, leafData: leafData4 } =
      await getABISessionKeyParams(
        sessionKey.address,
        {
          destContract: mockProtocol.address,
          functionSelector: ethers.utils.hexDataSlice(
            ethers.utils.id("changeState(uint256,bytes)"),
            0,
            4
          ), // transfer function selector
          valueLimit: ethers.utils.parseEther("0.5"), // value limit
          // array of offsets, values, and conditions
          rules: [
            {
              offset: 0,
              referenceValue: ethers.utils.hexZeroPad("0x0400", 32),
              condition: 1,
            }, // less than or equal; 0x400 = 1,024
            {
              offset: 32,
              referenceValue: ethers.utils.hexZeroPad("0x40", 32),
              condition: 0,
            }, // offset == 0x40 = 64 = first arg(32) + offset_itself(32)
            {
              offset: 64,
              referenceValue: ethers.utils.hexZeroPad("0x20", 32),
              condition: 3,
            }, // length >= 0x20 (32)
          ],
        },
        0,
        0,
        abiSVM.address
      );

    const leaves = [leafData, leafData2, leafData3, leafData4].map((x) =>
      ethers.utils.keccak256(x)
    );

    const merkleTree = await enableNewTreeForSmartAccountViaEcdsa(
      leaves,
      sessionKeyManager,
      userSA.address,
      smartAccountOwner,
      entryPoint,
      ecdsaModule.address
    );

    return {
      entryPoint: entryPoint,
      smartAccountImplementation: await getSmartAccountImplementation(),
      smartAccountFactory: await getSmartAccountFactory(),
      ecdsaModule: ecdsaModule,
      userSA: userSA,
      mockToken: mockToken,
      sessionKeyManager: sessionKeyManager,
      merkleTree: merkleTree,
      sessionKey: sessionKey,
      abiSVM: abiSVM,
      leafDatas: [leafData, leafData2, leafData3, leafData4],
      sessionKeyDatas: [
        sessionKeyData,
        sessionKeyData2,
        sessionKeyData3,
        sessionKeyData4,
      ],
      sessionRouter: sessionRouter,
      mockProtocol: mockProtocol,
    };
  });

  describe("Single Execution Validation Flow:", async () => {
    it("Should revert if not using execute or execute_ncC", async () => {
      const {
        entryPoint,
        userSA,
        sessionKeyManager,
        abiSVM,
        sessionKeyDatas,
        leafDatas,
        merkleTree,
        mockToken,
      } = await setupTests();

      const transferPermissionSessionKeyData = sessionKeyDatas[0];
      const transferPermissionLeafData = leafDatas[0];

      const mockAuthModule = await (
        await ethers.getContractFactory("MockAuthModule")
      ).deploy();

      const userOp = await makeEcdsaSessionKeySignedUserOp(
        "enableModule",
        [mockAuthModule.address],
        userSA.address,
        sessionKey,
        entryPoint,
        sessionKeyManager.address,
        0,
        0,
        abiSVM.address,
        transferPermissionSessionKeyData,
        merkleTree.getHexProof(
          ethers.utils.keccak256(transferPermissionLeafData)
        )
      );

      await expect(
        entryPoint.handleOps([userOp], alice.address, {
          gasLimit: 10000000,
        })
      )
        .to.be.revertedWith("FailedOp")
        .withArgs(0, "AA23 reverted: ABISV Not Execute Selector");

      expect(await userSA.isModuleEnabled(mockAuthModule.address)).to.equal(
        false
      );
    });

    it("Should revert if the external call Selector is not allowed in the Permission", async () => {
      const {
        entryPoint,
        userSA,
        sessionKeyManager,
        abiSVM,
        sessionKeyDatas,
        leafDatas,
        merkleTree,
        mockToken,
      } = await setupTests();
      const IERC20 = await ethers.getContractFactory("ERC20");
      const tokenAmountToApprove = ethers.utils.parseEther("0.7534");

      const transferPermissionSessionKeyData = sessionKeyDatas[0];
      const transferPermissionLeafData = leafDatas[0];

      const approveUserOp = await makeEcdsaSessionKeySignedUserOp(
        "execute_ncC",
        [
          mockToken.address,
          0,
          // only transfer allowed
          IERC20.interface.encodeFunctionData("approve", [
            charlie.address,
            tokenAmountToApprove,
          ]),
        ],
        userSA.address,
        sessionKey,
        entryPoint,
        sessionKeyManager.address,
        0,
        0,
        abiSVM.address,
        transferPermissionSessionKeyData,
        merkleTree.getHexProof(
          ethers.utils.keccak256(transferPermissionLeafData)
        )
      );

      const charlieTokenBalanceBefore = await mockToken.balanceOf(
        charlie.address
      );

      await expect(
        entryPoint.handleOps([approveUserOp], alice.address, {
          gasLimit: 10000000,
        })
      )
        .to.be.revertedWith("FailedOp")
        .withArgs(0, "AA23 reverted: ABISV Selector Forbidden");

      expect(await mockToken.balanceOf(charlie.address)).to.equal(
        charlieTokenBalanceBefore
      );
    });

    it("Should revert if the external call destination is not allowed in the Permission", async () => {
      const {
        entryPoint,
        userSA,
        sessionKeyManager,
        abiSVM,
        sessionKeyDatas,
        leafDatas,
        merkleTree,
        mockToken,
      } = await setupTests();
      const IERC20 = await ethers.getContractFactory("ERC20");
      const tokenAmountToApprove = ethers.utils.parseEther("0.7534");

      const approvePermissionSessionKeyData = sessionKeyDatas[1];
      const approvePermissionLeafData = leafDatas[1];

      const mockToken2 = await (
        await ethers.getContractFactory("MockToken")
      ).deploy();

      const approveUserOp = await makeEcdsaSessionKeySignedUserOp(
        "execute_ncC",
        [
          mockToken2.address, // not permitted address
          0,
          IERC20.interface.encodeFunctionData("approve", [
            charlie.address,
            tokenAmountToApprove,
          ]),
        ],
        userSA.address,
        sessionKey,
        entryPoint,
        sessionKeyManager.address,
        0,
        0,
        abiSVM.address,
        approvePermissionSessionKeyData,
        merkleTree.getHexProof(
          ethers.utils.keccak256(approvePermissionLeafData)
        )
      );

      const charlieTokenBalanceBefore = await mockToken.balanceOf(
        charlie.address
      );

      await expect(
        entryPoint.handleOps([approveUserOp], alice.address, {
          gasLimit: 10000000,
        })
      )
        .to.be.revertedWith("FailedOp")
        .withArgs(0, "AA23 reverted: ABISV Destination Forbidden");

      expect(await mockToken.balanceOf(charlie.address)).to.equal(
        charlieTokenBalanceBefore
      );
    });

    it("Should revert if the external call value is exceeded", async () => {
      const {
        entryPoint,
        userSA,
        sessionKeyManager,
        abiSVM,
        sessionKeyDatas,
        leafDatas,
        merkleTree,
        mockToken,
      } = await setupTests();
      const IERC20 = await ethers.getContractFactory("ERC20");
      const tokenAmountToApprove = ethers.utils.parseEther("0.7534");

      const approvePermissionSessionKeyData = sessionKeyDatas[1];
      const approvePermissionLeafData = leafDatas[1];

      const approveUserOp = await makeEcdsaSessionKeySignedUserOp(
        "execute_ncC",
        [
          mockToken.address,
          ethers.utils.parseEther("0.001"),
          IERC20.interface.encodeFunctionData("approve", [
            charlie.address,
            tokenAmountToApprove,
          ]),
        ],
        userSA.address,
        sessionKey,
        entryPoint,
        sessionKeyManager.address,
        0,
        0,
        abiSVM.address,
        approvePermissionSessionKeyData,
        merkleTree.getHexProof(
          ethers.utils.keccak256(approvePermissionLeafData)
        )
      );

      const charlieTokenBalanceBefore = await mockToken.balanceOf(
        charlie.address
      );

      await expect(
        entryPoint.handleOps([approveUserOp], alice.address, {
          gasLimit: 10000000,
        })
      )
        .to.be.revertedWith("FailedOp")
        .withArgs(0, "AA23 reverted: ABISV Permitted Value Exceeded");

      expect(await mockToken.balanceOf(charlie.address)).to.equal(
        charlieTokenBalanceBefore
      );
    });

    // can not use custom built calldata to trick the module
    it("Can not use custom calldata to trick the module", async () => {
      const {
        entryPoint,
        userSA,
        sessionKeyManager,
        abiSVM,
        sessionKeyDatas,
        leafDatas,
        merkleTree,
        mockToken,
        mockProtocol,
      } = await setupTests();

      const interactSessionKeyData = sessionKeyDatas[2];
      const interactLeafData = leafDatas[2];

      const tokenAmount = ethers.utils.parseEther("10");

      const properCallData = userSA.interface.encodeFunctionData(
        "execute_ncC",
        [
          mockProtocol.address, // dest
          ethers.utils.parseEther("0"), // value
          mockProtocol.interface.encodeFunctionData("interact", [
            mockToken.address,
            tokenAmount,
          ]),
        ]
      );

      let manipulatedCalldata = properCallData;
      // console.log(manipulatedCalldata);

      /*
      0000189a //execute_ncC sleector
      000000000000000000000000e8b7a1a3ec6bc0b2ef1a285a261865b290cc3d36 // dest
      00000000000000000000000000000000000000000000000000038d7ea4c68000 //value
      0000000000000000000000000000000000000000000000000000000000000060 //offset
      0000000000000000000000000000000000000000000000000000000000000044 //length
      b3efe46c // interact selector
      000000000000000000000000e8b7a1a3ec6bc0b2ef1a285a261865b290cc3d36 // token address
      0000000000000000000000000000000000000000000000008ac7230489e80000 // amount
      00000000000000000000000000000000000000000000000000000000 //trailing zeroes
      */

      // insert the malicious calldata (selector+args) right after the current offset
      // prepare malicious calldata
      const maliciousMethodCalldata = ethers.utils.hexConcat([
        ethers.utils.hexZeroPad("0x4", 32),
        mockProtocol.interface.encodeFunctionData("notAllowedMethod", []),
      ]);
      // console.log(maliciousMethodCalldata);

      // prev offset = 96 (3*32) , add 36=32+4 = length of the injected calldata
      const newOffset = ethers.utils.hexZeroPad(
        ethers.utils.hexlify(96 + 36),
        32
      );
      // console.log(newOffset);

      manipulatedCalldata = ethers.utils.hexConcat([
        hexDataSlice(manipulatedCalldata, 0, 68),
        newOffset,
        maliciousMethodCalldata,
        hexDataSlice(manipulatedCalldata, 100),
      ]);

      // console.log(manipulatedCalldata);

      /*
        0x0000189a
        000000000000000000000000e8b7a1a3ec6bc0b2ef1a285a261865b290cc3d36
        00000000000000000000000000000000000000000000000000038d7ea4c68000
        0000000000000000000000000000000000000000000000000000000000000084
        0000000000000000000000000000000000000000000000000000000000000004
        0bb48f21
        0000000000000000000000000000000000000000000000000000000000000044
        b3efe46c
        000000000000000000000000e8b7a1a3ec6bc0b2ef1a285a261865b290cc3d36
        0000000000000000000000000000000000000000000000008ac7230489e80000
        00000000000000000000000000000000000000000000000000000000
      */

      const userOp = await fillAndSign(
        {
          sender: userSA.address,
          callData: manipulatedCalldata,
        },
        sessionKey,
        entryPoint,
        "nonce",
        true
      );

      const paddedSig = defaultAbiCoder.encode(
        ["uint48", "uint48", "address", "bytes", "bytes32[]", "bytes"],
        [
          0,
          0,
          abiSVM.address,
          interactSessionKeyData,
          merkleTree.getHexProof(ethers.utils.keccak256(interactLeafData)),
          userOp.signature,
        ]
      );

      const signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
        ["bytes", "address"],
        [paddedSig, sessionKeyManager.address]
      );
      userOp.signature = signatureWithModuleAddress;

      const unallowedTriggersBefore = await mockProtocol.getUnallowedTriggers(
        userSA.address
      );

      await entryPoint.handleOps([userOp], alice.address, {
        gasLimit: 10000000,
      });

      expect(await mockProtocol.getUnallowedTriggers(userSA.address)).to.equal(
        unallowedTriggersBefore
      );
    });

    // all the 6 conditions work
    /*
    it("__", async () => {});

    it("__", async () => {});

    it("__", async () => {});
    */

    // can apply equal condition to every 32 bytes word of the 'bytes' arg
    // in bundler
  });
});
