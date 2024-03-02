import { expect } from "chai";
import {
  makeEcdsaSessionKeySignedUserOp,
  enableNewTreeForSmartAccountViaEcdsa,
  getABISessionKeyParams,
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
  const [deployer, smartAccountOwner, alice, bob, charlie, sessionKey] =
    waffle.provider.getWallets();
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
          ), // approve function selector
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
          ), // function selector
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

    const { sessionKeyData: sessionKeyData5, leafData: leafData5 } =
      await getABISessionKeyParams(
        sessionKey.address,
        {
          destContract: mockProtocol.address,
          functionSelector: ethers.utils.hexDataSlice(
            ethers.utils.id("testArgsMethod(uint256,uint256,uint256)"),
            0,
            4
          ), // function selector
          valueLimit: ethers.utils.parseEther("0.5"), // value limit
          // array of offsets, values, and conditions
          rules: [
            {
              offset: 0,
              referenceValue: ethers.utils.hexZeroPad("0x05", 32),
              condition: 2,
            }, // less than 5;
            {
              offset: 32,
              referenceValue: ethers.utils.hexZeroPad("0x05", 32),
              condition: 4,
            }, // more than 5
            {
              offset: 64,
              referenceValue: ethers.utils.hexZeroPad("0x05", 32),
              condition: 5,
            }, // not equal 5
          ],
        },
        0,
        0,
        abiSVM.address
      );

    const { sessionKeyData: sessionKeyData6, leafData: leafData6 } =
      await getABISessionKeyParams(
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
              condition: 6, // NON EXISTING CONDITION
            },
          ],
        },
        0,
        0,
        abiSVM.address
      );

    let sessionKeyData7 = ethers.utils.hexConcat([
      sessionKey.address,
      mockToken.address,
      ethers.utils.hexDataSlice(
        ethers.utils.id("approve(address,uint256)"),
        0,
        4
      ), // approve function selector
      ethers.utils.hexZeroPad(ethers.utils.parseEther("0").toHexString(), 16),
      ethers.utils.hexZeroPad(ethers.utils.hexlify(5), 2), // SET INCORRECT RULES LENGTH
    ]);

    // ADD JUST ONE RULE
    sessionKeyData7 = ethers.utils.hexConcat([
      sessionKeyData7,
      ethers.utils.hexZeroPad(ethers.utils.hexlify(0), 2), // offset is uint16, so there can't be more than 2**16/32 args = 2**11
      ethers.utils.hexZeroPad(ethers.utils.hexlify(0), 1), // condition uint8
      ethers.utils.hexZeroPad(charlie.address, 32),
    ]);

    const leafData7 = ethers.utils.hexConcat([
      ethers.utils.hexZeroPad(ethers.utils.hexlify(0), 6),
      ethers.utils.hexZeroPad(ethers.utils.hexlify(0), 6),
      ethers.utils.hexZeroPad(abiSVM.address, 20),
      sessionKeyData7,
    ]);

    const leaves = [
      leafData,
      leafData2,
      leafData3,
      leafData4,
      leafData5,
      leafData6,
      leafData7,
    ].map((x) => ethers.utils.keccak256(x));

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
      leafDatas: [
        leafData,
        leafData2,
        leafData3,
        leafData4,
        leafData5,
        leafData6,
        leafData7,
      ],
      sessionKeyDatas: [
        sessionKeyData,
        sessionKeyData2,
        sessionKeyData3,
        sessionKeyData4,
        sessionKeyData5,
        sessionKeyData6,
        sessionKeyData7,
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

      // insert the malicious calldata (selector+args) right after the current offset
      // prepare malicious calldata
      const maliciousMethodCalldata = ethers.utils.hexConcat([
        ethers.utils.hexZeroPad("0x4", 32),
        mockProtocol.interface.encodeFunctionData("notAllowedMethod", []),
      ]);

      // prev offset = 96 (3*32) , add 36=32+4 = length of the injected calldata
      const newOffset = ethers.utils.hexZeroPad(
        ethers.utils.hexlify(96 + 36),
        32
      );

      manipulatedCalldata = ethers.utils.hexConcat([
        hexDataSlice(manipulatedCalldata, 0, 68),
        newOffset,
        maliciousMethodCalldata,
        hexDataSlice(manipulatedCalldata, 100),
      ]);

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

    it("Reverts Rule condition == 0 (equal) is violated", async () => {
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
          ethers.utils.parseEther("0"),
          IERC20.interface.encodeFunctionData("approve", [
            bob.address, // should be equal to charlie but it is not
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
      await expect(
        entryPoint.handleOps([approveUserOp], alice.address, {
          gasLimit: 10000000,
        })
      )
        .to.be.revertedWith("FailedOp")
        .withArgs(0, "AA23 reverted: ABISV Arg Rule Violated");
    });

    it("Reverts Rule condition == 1 (less than or equal) is violated", async () => {
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

      const exceedingAmount = ethers.utils.parseEther("10001");
      const interactPermissionSessionKeyData = sessionKeyDatas[2];
      const interactPermissionLeafData = leafDatas[2];

      const userOp = await makeEcdsaSessionKeySignedUserOp(
        "execute_ncC",
        [
          mockProtocol.address,
          ethers.utils.parseEther("0"),
          mockProtocol.interface.encodeFunctionData("interact", [
            mockToken.address,
            exceedingAmount,
          ]),
        ],
        userSA.address,
        sessionKey,
        entryPoint,
        sessionKeyManager.address,
        0,
        0,
        abiSVM.address,
        interactPermissionSessionKeyData,
        merkleTree.getHexProof(
          ethers.utils.keccak256(interactPermissionLeafData)
        )
      );

      await expect(
        entryPoint.handleOps([userOp], alice.address, {
          gasLimit: 10000000,
        })
      )
        .to.be.revertedWith("FailedOp")
        .withArgs(0, "AA23 reverted: ABISV Arg Rule Violated");
    });

    it("Reverts Rule condition == 3 (greater than or equal) is violated", async () => {
      const {
        entryPoint,
        userSA,
        sessionKeyManager,
        abiSVM,
        sessionKeyDatas,
        leafDatas,
        merkleTree,
        mockProtocol,
      } = await setupTests();

      const changeStatePermissionSessionKeyData = sessionKeyDatas[3];
      const changeStatePermissionLeafData = leafDatas[3];

      const userOp = await makeEcdsaSessionKeySignedUserOp(
        "execute_ncC",
        [
          mockProtocol.address,
          ethers.utils.parseEther("0"),
          mockProtocol.interface.encodeFunctionData("changeState", [
            0x123,
            "0xdeafbeef", // length < 32
          ]),
        ],
        userSA.address,
        sessionKey,
        entryPoint,
        sessionKeyManager.address,
        0,
        0,
        abiSVM.address,
        changeStatePermissionSessionKeyData,
        merkleTree.getHexProof(
          ethers.utils.keccak256(changeStatePermissionLeafData)
        )
      );

      await expect(
        entryPoint.handleOps([userOp], alice.address, {
          gasLimit: 10000000,
        })
      )
        .to.be.revertedWith("FailedOp")
        .withArgs(0, "AA23 reverted: ABISV Arg Rule Violated");
    });

    it("Reverts Rule condition == 2 (less than) is violated", async () => {
      const {
        entryPoint,
        userSA,
        sessionKeyManager,
        abiSVM,
        sessionKeyDatas,
        leafDatas,
        merkleTree,
        mockProtocol,
      } = await setupTests();

      const testSessionKeyData = sessionKeyDatas[4];
      const testLeafData = leafDatas[4];

      const userOp = await makeEcdsaSessionKeySignedUserOp(
        "execute_ncC",
        [
          mockProtocol.address,
          ethers.utils.parseEther("0"),
          mockProtocol.interface.encodeFunctionData("testArgsMethod", [
            0x06, // more than 0x05, but should be strictly less
            0x06, // second arg should be > 0x05
            0x06, // third arg should be != 0x05
          ]),
        ],
        userSA.address,
        sessionKey,
        entryPoint,
        sessionKeyManager.address,
        0,
        0,
        abiSVM.address,
        testSessionKeyData,
        merkleTree.getHexProof(ethers.utils.keccak256(testLeafData))
      );

      await expect(
        entryPoint.handleOps([userOp], alice.address, {
          gasLimit: 10000000,
        })
      )
        .to.be.revertedWith("FailedOp")
        .withArgs(0, "AA23 reverted: ABISV Arg Rule Violated");
    });

    it("Reverts Rule condition == 4 (more than) is violated", async () => {
      const {
        entryPoint,
        userSA,
        sessionKeyManager,
        abiSVM,
        sessionKeyDatas,
        leafDatas,
        merkleTree,
        mockProtocol,
      } = await setupTests();

      const testSessionKeyData = sessionKeyDatas[4];
      const testLeafData = leafDatas[4];

      const userOp = await makeEcdsaSessionKeySignedUserOp(
        "execute_ncC",
        [
          mockProtocol.address,
          ethers.utils.parseEther("0"),
          mockProtocol.interface.encodeFunctionData("testArgsMethod", [
            0x04, // first arg should be < 0x05
            0x04, // second arg should be > 0x05 but it is less
            0x04, // third arg should be != 0x05
          ]),
        ],
        userSA.address,
        sessionKey,
        entryPoint,
        sessionKeyManager.address,
        0,
        0,
        abiSVM.address,
        testSessionKeyData,
        merkleTree.getHexProof(ethers.utils.keccak256(testLeafData))
      );

      await expect(
        entryPoint.handleOps([userOp], alice.address, {
          gasLimit: 10000000,
        })
      )
        .to.be.revertedWith("FailedOp")
        .withArgs(0, "AA23 reverted: ABISV Arg Rule Violated");
    });

    it("Reverts Rule condition == 5 (not equal) is violated", async () => {
      const {
        entryPoint,
        userSA,
        sessionKeyManager,
        abiSVM,
        sessionKeyDatas,
        leafDatas,
        merkleTree,
        mockProtocol,
      } = await setupTests();

      const testSessionKeyData = sessionKeyDatas[4];
      const testLeafData = leafDatas[4];

      const userOp = await makeEcdsaSessionKeySignedUserOp(
        "execute_ncC",
        [
          mockProtocol.address,
          ethers.utils.parseEther("0"),
          mockProtocol.interface.encodeFunctionData("testArgsMethod", [
            0x04, // first arg should be < 0x05
            0x06, // second arg should be > 0x05
            0x05, // third arg should be != 0x05 but it is equal
          ]),
        ],
        userSA.address,
        sessionKey,
        entryPoint,
        sessionKeyManager.address,
        0,
        0,
        abiSVM.address,
        testSessionKeyData,
        merkleTree.getHexProof(ethers.utils.keccak256(testLeafData))
      );

      await expect(
        entryPoint.handleOps([userOp], alice.address, {
          gasLimit: 10000000,
        })
      )
        .to.be.revertedWith("FailedOp")
        .withArgs(0, "AA23 reverted: ABISV Arg Rule Violated");
    });

    it("Always reverts if the condition is non-existent", async () => {
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

      const nonExistentConditionSessionKeyData = sessionKeyDatas[5];
      const nonExistentConditionLeafData = leafDatas[5];

      const approveUserOp = await makeEcdsaSessionKeySignedUserOp(
        "execute_ncC",
        [
          mockToken.address,
          0,
          IERC20.interface.encodeFunctionData("transfer", [
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
        nonExistentConditionSessionKeyData,
        merkleTree.getHexProof(
          ethers.utils.keccak256(nonExistentConditionLeafData)
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
        .withArgs(0, "AA23 reverted: ABISV Arg Rule Violated");

      expect(await mockToken.balanceOf(charlie.address)).to.equal(
        charlieTokenBalanceBefore
      );
    });

    it("Reverts if Rules length is incorrect", async () => {
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

      const approvePermissionSessionKeyData = sessionKeyDatas[6]; // session key data with rules.length = 5 but just one rule added
      const approvePermissionLeafData = leafDatas[6];

      const approveUserOp = await makeEcdsaSessionKeySignedUserOp(
        "execute_ncC",
        [
          mockToken.address,
          ethers.utils.parseEther("0"),
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

      await expect(
        entryPoint.handleOps([approveUserOp], alice.address, {
          gasLimit: 10000000,
        })
      )
        .to.be.revertedWith("FailedOp")
        .withArgs(0, "AA23 reverted (or OOG)");
    });
  });
});
