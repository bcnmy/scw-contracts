import { expect } from "chai";
import {
  enableNewTreeForSmartAccountViaEcdsa,
  getERC20SessionKeyParams,
  makeEcdsaSessionKeySignedBatchUserOp,
} from "../utils/sessionKey";
import { ethers, deployments, waffle } from "hardhat";
import { makeEcdsaModuleUserOp, fillAndSign } from "../utils/userOp";
import {
  getEntryPoint,
  getSmartAccountImplementation,
  getSmartAccountFactory,
  getMockToken,
  getEcdsaOwnershipRegistryModule,
  getSmartAccountWithModule,
} from "../utils/setupHelper";
import { computeAddress, defaultAbiCoder } from "ethers/lib/utils";

describe("SessionKey: Batched Session Router", async () => {
  const [deployer, smartAccountOwner, alice, sessionKey, nonAuthSessionKey] =
    waffle.provider.getWallets();
  const maxAmount = ethers.utils.parseEther("100");

  const setupTests = deployments.createFixture(
    async ({ deployments, getNamedAccounts }) => {
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

      // deploy skm and batched session router and enable it in the smart account
      const sessionKeyManager = await (
        await ethers.getContractFactory("SessionKeyManager")
      ).deploy();
      const sessionRouter = await (
        await ethers.getContractFactory("BatchedSessionRouter")
      ).deploy();

      const userOp1 = await makeEcdsaModuleUserOp(
        "enableModule",
        [sessionKeyManager.address],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      );

      await entryPoint.handleOps([userOp1], alice.address);

      const userOp2 = await makeEcdsaModuleUserOp(
        "enableModule",
        [sessionRouter.address],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      );

      await entryPoint.handleOps([userOp2], alice.address);

      const erc20SessionModule = await (
        await ethers.getContractFactory("ERC20SessionValidationModule")
      ).deploy();
      // MockProtocol contract
      const mockProtocol = await (
        await ethers.getContractFactory("MockProtocol")
      ).deploy();
      // MockProtocol SV Module
      const mockProtocolSVModule = await (
        await ethers.getContractFactory("MockProtocolSVM")
      ).deploy();

      const { sessionKeyData, leafData } = await getERC20SessionKeyParams(
        sessionKey.address,
        mockToken.address,
        mockProtocol.address,
        maxAmount,
        0,
        0,
        erc20SessionModule.address
      );

      const currentTimestamp = (await ethers.provider.getBlock("latest"))
        .timestamp;
      const validUntilForMockProtocol = currentTimestamp + 3600;

      // create leaf for the fakeswap sv module
      const { sessionKeyData: sessionKeyData2, leafData: leafData2 } =
        await getERC20SessionKeyParams(
          sessionKey.address,
          mockProtocol.address, // contract to interact with
          mockToken.address, // token to transfer to protocol
          maxAmount,
          validUntilForMockProtocol,
          0,
          mockProtocolSVModule.address
        );

      // build a big tree
      const leaves = [ethers.utils.keccak256(leafData)];
      for (let i = 0; i < 9999; i++) {
        if (i === 4988) {
          leaves.push(ethers.utils.keccak256(leafData2));
        }
        leaves.push(ethers.utils.keccak256(ethers.utils.randomBytes(32)));
      }

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
        erc20SessionModule: erc20SessionModule,
        sessionKeyData: sessionKeyData,
        leafData: leafData,
        sessionKeyData2: sessionKeyData2,
        leafData2: leafData2,
        merkleTree: merkleTree,
        sessionRouter: sessionRouter,
        mockProtocol: mockProtocol,
        mockProtocolSVM: mockProtocolSVModule,
        validUntilForMockProtocol: validUntilForMockProtocol,
      };
    }
  );

  it("MOVED: Should process Session Key signed executeBatch userOp", async () => {
    // moved to test/bundler-integrations/module/BatchedSessionRouter.Module.specs.ts
  });

  it("Should revert for a non executeBatch userOp", async () => {
    const {
      entryPoint,
      userSA,
      sessionKeyManager,
      erc20SessionModule,
      sessionKeyData,
      leafData,
      merkleTree,
      sessionRouter,
      mockProtocol,
      mockProtocolSVM,
      mockToken,
      sessionKeyData2,
      leafData2,
      validUntilForMockProtocol,
    } = await setupTests();
    const tokenAmountToTransfer = ethers.utils.parseEther("1.7534");

    const IERC20 = await ethers.getContractFactory("ERC20");
    const approveCallData = IERC20.interface.encodeFunctionData("approve", [
      mockProtocol.address,
      tokenAmountToTransfer.mul(50),
    ]);

    const userOp = await makeEcdsaSessionKeySignedBatchUserOp(
      "execute", // not executeBatch
      [mockToken.address, 0, approveCallData],
      userSA.address,
      sessionKey,
      entryPoint,
      sessionKeyManager.address,
      [
        [
          0,
          0,
          erc20SessionModule.address,
          sessionKeyData,
          merkleTree.getHexProof(ethers.utils.keccak256(leafData)),
          "0x",
        ],
        [
          validUntilForMockProtocol,
          0,
          mockProtocolSVM.address,
          sessionKeyData2,
          merkleTree.getHexProof(ethers.utils.keccak256(leafData2)),
          "0x",
        ],
      ],
      sessionRouter.address
    );

    await expect(
      entryPoint.handleOps([userOp], alice.address, { gasLimit: 10000000 })
    )
      .to.be.revertedWith("FailedOp")
      .withArgs(0, "AA23 reverted: SR Invalid Selector");
  });

  it("Should revert if padded signature is in wrong format", async () => {
    const {
      entryPoint,
      userSA,
      sessionKeyManager,
      erc20SessionModule,
      sessionKeyData,
      leafData,
      merkleTree,
      sessionRouter,
      mockProtocol,
      mockProtocolSVM,
      mockToken,
      sessionKeyData2,
      leafData2,
      validUntilForMockProtocol,
    } = await setupTests();
    const tokenAmountToTransfer = ethers.utils.parseEther("1.7534");

    const MockProtocol = await ethers.getContractFactory("MockProtocol");
    const IERC20 = await ethers.getContractFactory("ERC20");
    const SmartAccount = await ethers.getContractFactory("SmartAccount");

    const approveCallData = IERC20.interface.encodeFunctionData("approve", [
      mockProtocol.address,
      tokenAmountToTransfer,
    ]);
    const interactCallData = MockProtocol.interface.encodeFunctionData(
      "interact",
      [mockToken.address, tokenAmountToTransfer]
    );
    const executeBatchData = SmartAccount.interface.encodeFunctionData(
      "executeBatch_y6U",
      [
        [mockToken.address, mockProtocol.address],
        [0, 0],
        [approveCallData, interactCallData],
      ]
    );

    const userOp = await fillAndSign(
      {
        sender: userSA.address,
        callData: executeBatchData,
      },
      sessionKey,
      entryPoint,
      "nonce"
    );

    const wrongType = "uint256";
    const randomValueOfWrongType = 111;

    const paddedSig = ethers.utils.defaultAbiCoder.encode(
      [
        "address",
        "tuple(uint48,uint48,address,bytes,bytes32[],bytes)[]",
        wrongType,
      ],
      [
        sessionKeyManager.address,
        [
          [
            0,
            0,
            erc20SessionModule.address,
            sessionKeyData,
            merkleTree.getHexProof(ethers.utils.keccak256(leafData)),
            "0x",
          ],
          [
            validUntilForMockProtocol,
            0,
            mockProtocolSVM.address,
            sessionKeyData2,
            merkleTree.getHexProof(ethers.utils.keccak256(leafData2)),
            "0x",
          ],
        ],
        randomValueOfWrongType,
      ]
    );

    const signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
      ["bytes", "address"],
      [paddedSig, sessionRouter.address]
    );
    userOp.signature = signatureWithModuleAddress;

    await expect(
      entryPoint.handleOps([userOp], alice.address, { gasLimit: 10000000 })
    )
      .to.be.revertedWith("FailedOp")
      .withArgs(0, "AA23 reverted (or OOG)");
  });

  it("Should revert when signed with a session key not matching with session keys enabled for SVMs involved", async () => {
    const {
      entryPoint,
      userSA,
      sessionKeyManager,
      erc20SessionModule,
      sessionKeyData,
      leafData,
      merkleTree,
      sessionRouter,
      mockProtocol,
      mockProtocolSVM,
      mockToken,
      sessionKeyData2,
      leafData2,
      validUntilForMockProtocol,
    } = await setupTests();
    const tokenAmountToTransfer = ethers.utils.parseEther("1.7534");

    const MockProtocol = await ethers.getContractFactory("MockProtocol");
    const IERC20 = await ethers.getContractFactory("ERC20");

    const approveCallData = IERC20.interface.encodeFunctionData("approve", [
      mockProtocol.address,
      tokenAmountToTransfer,
    ]);
    const interactCallData = MockProtocol.interface.encodeFunctionData(
      "interact",
      [mockToken.address, tokenAmountToTransfer]
    );

    const userOp = await makeEcdsaSessionKeySignedBatchUserOp(
      "executeBatch_y6U",
      [
        [mockToken.address, mockProtocol.address],
        [0, 0],
        [approveCallData, interactCallData],
      ],
      userSA.address,
      nonAuthSessionKey, // not authorized session key
      entryPoint,
      sessionKeyManager.address,
      [
        [
          0,
          0,
          erc20SessionModule.address,
          sessionKeyData,
          merkleTree.getHexProof(ethers.utils.keccak256(leafData)),
          "0x",
        ],
        [
          validUntilForMockProtocol,
          0,
          mockProtocolSVM.address,
          sessionKeyData2,
          merkleTree.getHexProof(ethers.utils.keccak256(leafData2)),
          "0x",
        ],
      ],
      sessionRouter.address
    );

    await expect(
      entryPoint.handleOps([userOp], alice.address, { gasLimit: 10000000 })
    )
      .to.be.revertedWith("FailedOp")
      .withArgs(0, "AA24 signature error");
  });

  it("Should revert when sessionData array is empty", async () => {
    const {
      entryPoint,
      userSA,
      sessionKeyManager,
      sessionRouter,
      mockProtocol,
      mockToken,
    } = await setupTests();
    const tokenAmountToTransfer = ethers.utils.parseEther("1.7534");

    const MockProtocol = await ethers.getContractFactory("MockProtocol");
    const IERC20 = await ethers.getContractFactory("ERC20");

    const approveCallData = IERC20.interface.encodeFunctionData("approve", [
      mockProtocol.address,
      tokenAmountToTransfer,
    ]);
    const interactCallData = MockProtocol.interface.encodeFunctionData(
      "interact",
      [mockToken.address, tokenAmountToTransfer]
    );

    const userOp = await makeEcdsaSessionKeySignedBatchUserOp(
      "executeBatch_y6U",
      [
        [mockToken.address, mockProtocol.address],
        [0, 0],
        [approveCallData, interactCallData],
      ],
      userSA.address,
      sessionKey,
      entryPoint,
      sessionKeyManager.address,
      [], // empty session data array
      sessionRouter.address
    );

    await expect(
      entryPoint.handleOps([userOp], alice.address, { gasLimit: 10000000 })
    )
      .to.be.revertedWith("FailedOp")
      .withArgs(0, "AA23 reverted: Lengths mismatch");
  });

  it("Should revert if not enough session datas provided", async () => {
    const {
      entryPoint,
      userSA,
      sessionKeyManager,
      erc20SessionModule,
      sessionKeyData,
      leafData,
      merkleTree,
      sessionRouter,
      mockProtocol,
      mockToken,
    } = await setupTests();
    const tokenAmountToTransfer = ethers.utils.parseEther("1.7534");

    const MockProtocol = await ethers.getContractFactory("MockProtocol");
    const IERC20 = await ethers.getContractFactory("ERC20");

    const approveCallData = IERC20.interface.encodeFunctionData("approve", [
      mockProtocol.address,
      tokenAmountToTransfer,
    ]);
    const interactCallData = MockProtocol.interface.encodeFunctionData(
      "interact",
      [mockToken.address, tokenAmountToTransfer]
    );

    const incompleteSessionDataArray = [
      [
        0,
        0,
        erc20SessionModule.address,
        sessionKeyData,
        merkleTree.getHexProof(ethers.utils.keccak256(leafData)),
        "0x",
      ],
    ];

    const userOp = await makeEcdsaSessionKeySignedBatchUserOp(
      "executeBatch_y6U",
      [
        [mockToken.address, mockProtocol.address],
        [0, 0],
        [approveCallData, interactCallData],
      ],
      userSA.address,
      sessionKey,
      entryPoint,
      sessionKeyManager.address,
      incompleteSessionDataArray, // incomplete session data array
      sessionRouter.address
    );

    await expect(
      entryPoint.handleOps([userOp], alice.address, { gasLimit: 10000000 })
    )
      .to.be.revertedWith("FailedOp")
      .withArgs(0, "AA23 reverted: Lengths mismatch");
  });

  it("Should revert when at least one SVM permission is violated", async () => {
    const {
      entryPoint,
      userSA,
      sessionKeyManager,
      erc20SessionModule,
      sessionKeyData,
      leafData,
      merkleTree,
      sessionRouter,
      mockProtocol,
      mockProtocolSVM,
      mockToken,
      sessionKeyData2,
      leafData2,
      validUntilForMockProtocol,
    } = await setupTests();
    const tokenAmountToTransfer = ethers.utils.parseEther("1.7534");

    const MockProtocol = await ethers.getContractFactory("MockProtocol");
    const IERC20 = await ethers.getContractFactory("ERC20");

    const wrongAMount = maxAmount.add(ethers.utils.parseEther("1"));

    const approveCallData = IERC20.interface.encodeFunctionData("approve", [
      mockProtocol.address,
      wrongAMount,
    ]);
    const interactCallData = MockProtocol.interface.encodeFunctionData(
      "interact",
      [mockToken.address, tokenAmountToTransfer]
    );

    const userOp = await makeEcdsaSessionKeySignedBatchUserOp(
      "executeBatch_y6U",
      [
        [mockToken.address, mockProtocol.address],
        [0, 0],
        [approveCallData, interactCallData],
      ],
      userSA.address,
      sessionKey,
      entryPoint,
      sessionKeyManager.address,
      [
        [
          0,
          0,
          erc20SessionModule.address,
          sessionKeyData,
          merkleTree.getHexProof(ethers.utils.keccak256(leafData)),
          "0x",
        ],
        [
          validUntilForMockProtocol,
          0,
          mockProtocolSVM.address,
          sessionKeyData2,
          merkleTree.getHexProof(ethers.utils.keccak256(leafData2)),
          "0x",
        ],
      ],
      sessionRouter.address
    );

    await expect(
      entryPoint.handleOps([userOp], alice.address, { gasLimit: 10000000 })
    )
      .to.be.revertedWith("FailedOp")
      .withArgs(0, "AA23 reverted: ERC20SV Max Amount Exceeded");
  });

  it("Should revert if at least one session key is expired or not due", async () => {
    const {
      entryPoint,
      userSA,
      sessionKeyManager,
      erc20SessionModule,
      sessionKeyData,
      leafData,
      merkleTree,
      sessionRouter,
      mockProtocol,
      mockProtocolSVM,
      mockToken,
      sessionKeyData2,
      leafData2,
      validUntilForMockProtocol,
    } = await setupTests();
    const tokenAmountToTransfer = ethers.utils.parseEther("1.7534");

    const MockProtocol = await ethers.getContractFactory("MockProtocol");
    const IERC20 = await ethers.getContractFactory("ERC20");

    const approveCallData = IERC20.interface.encodeFunctionData("approve", [
      mockProtocol.address,
      tokenAmountToTransfer,
    ]);
    const interactCallData = MockProtocol.interface.encodeFunctionData(
      "interact",
      [mockToken.address, tokenAmountToTransfer]
    );

    const userOp = await makeEcdsaSessionKeySignedBatchUserOp(
      "executeBatch_y6U",
      [
        [mockToken.address, mockProtocol.address],
        [0, 0],
        [approveCallData, interactCallData],
      ],
      userSA.address,
      sessionKey,
      entryPoint,
      sessionKeyManager.address,
      [
        [
          0,
          0,
          erc20SessionModule.address,
          sessionKeyData,
          merkleTree.getHexProof(ethers.utils.keccak256(leafData)),
          "0x",
        ],
        [
          validUntilForMockProtocol,
          0,
          mockProtocolSVM.address,
          sessionKeyData2,
          merkleTree.getHexProof(ethers.utils.keccak256(leafData2)),
          "0x",
        ],
      ],
      sessionRouter.address
    );

    // second validUntil expires
    await ethers.provider.send("evm_setNextBlockTimestamp", [
      validUntilForMockProtocol + 100,
    ]);

    await expect(
      entryPoint.handleOps([userOp], alice.address, { gasLimit: 10000000 })
    )
      .to.be.revertedWith("FailedOp")
      .withArgs(0, "AA22 expired or not due");
  });

  it("should revert if validUntil provided in the sig is wrong", async () => {
    const {
      entryPoint,
      userSA,
      sessionKeyManager,
      erc20SessionModule,
      sessionKeyData,
      leafData,
      merkleTree,
      sessionRouter,
      mockProtocol,
      mockProtocolSVM,
      mockToken,
      sessionKeyData2,
      leafData2,
      validUntilForMockProtocol,
    } = await setupTests();
    const tokenAmountToTransfer = ethers.utils.parseEther("1.7534");

    const MockProtocol = await ethers.getContractFactory("MockProtocol");
    const IERC20 = await ethers.getContractFactory("ERC20");

    const approveCallData = IERC20.interface.encodeFunctionData("approve", [
      mockProtocol.address,
      tokenAmountToTransfer,
    ]);
    const interactCallData = MockProtocol.interface.encodeFunctionData(
      "interact",
      [mockToken.address, tokenAmountToTransfer]
    );

    const wrongValidUntil = validUntilForMockProtocol + 1000;

    const userOp = await makeEcdsaSessionKeySignedBatchUserOp(
      "executeBatch_y6U",
      [
        [mockToken.address, mockProtocol.address],
        [0, 0],
        [approveCallData, interactCallData],
      ],
      userSA.address,
      sessionKey,
      entryPoint,
      sessionKeyManager.address,
      [
        [
          0,
          0,
          erc20SessionModule.address,
          sessionKeyData,
          merkleTree.getHexProof(ethers.utils.keccak256(leafData)),
          "0x",
        ],
        [
          wrongValidUntil,
          0,
          mockProtocolSVM.address,
          sessionKeyData2,
          merkleTree.getHexProof(ethers.utils.keccak256(leafData2)),
          "0x",
        ],
      ],
      sessionRouter.address
    );

    await expect(
      entryPoint.handleOps([userOp], alice.address, { gasLimit: 10000000 })
    )
      .to.be.revertedWith("FailedOp")
      .withArgs(0, "AA23 reverted: SessionNotApproved");
  });

  it("should revert if validAfter provided in the sig is wrong", async () => {
    const {
      entryPoint,
      userSA,
      sessionKeyManager,
      erc20SessionModule,
      sessionKeyData,
      leafData,
      merkleTree,
      sessionRouter,
      mockProtocol,
      mockProtocolSVM,
      mockToken,
      sessionKeyData2,
      leafData2,
      validUntilForMockProtocol,
    } = await setupTests();
    const tokenAmountToTransfer = ethers.utils.parseEther("1.7534");

    const MockProtocol = await ethers.getContractFactory("MockProtocol");
    const IERC20 = await ethers.getContractFactory("ERC20");

    const approveCallData = IERC20.interface.encodeFunctionData("approve", [
      mockProtocol.address,
      tokenAmountToTransfer,
    ]);
    const interactCallData = MockProtocol.interface.encodeFunctionData(
      "interact",
      [mockToken.address, tokenAmountToTransfer]
    );

    const wrongValidAfter = 1000;

    const userOp = await makeEcdsaSessionKeySignedBatchUserOp(
      "executeBatch_y6U",
      [
        [mockToken.address, mockProtocol.address],
        [0, 0],
        [approveCallData, interactCallData],
      ],
      userSA.address,
      sessionKey,
      entryPoint,
      sessionKeyManager.address,
      [
        [
          0,
          wrongValidAfter,
          erc20SessionModule.address,
          sessionKeyData,
          merkleTree.getHexProof(ethers.utils.keccak256(leafData)),
          "0x",
        ],
        [
          validUntilForMockProtocol,
          0,
          mockProtocolSVM.address,
          sessionKeyData2,
          merkleTree.getHexProof(ethers.utils.keccak256(leafData2)),
          "0x",
        ],
      ],
      sessionRouter.address
    );

    await expect(
      entryPoint.handleOps([userOp], alice.address, { gasLimit: 10000000 })
    )
      .to.be.revertedWith("FailedOp")
      .withArgs(0, "AA23 reverted: SessionNotApproved");
  });

  it("should revert if SVM address provided in the sig is wrong", async () => {
    const {
      entryPoint,
      userSA,
      sessionKeyManager,
      sessionKeyData,
      leafData,
      merkleTree,
      sessionRouter,
      mockProtocol,
      mockProtocolSVM,
      mockToken,
      sessionKeyData2,
      leafData2,
      validUntilForMockProtocol,
    } = await setupTests();
    const tokenAmountToTransfer = ethers.utils.parseEther("1.7534");

    const MockProtocol = await ethers.getContractFactory("MockProtocol");
    const IERC20 = await ethers.getContractFactory("ERC20");

    const approveCallData = IERC20.interface.encodeFunctionData("approve", [
      mockProtocol.address,
      tokenAmountToTransfer,
    ]);
    const interactCallData = MockProtocol.interface.encodeFunctionData(
      "interact",
      [mockToken.address, tokenAmountToTransfer]
    );

    const wrongSessionValidationModuleAddress = computeAddress(
      ethers.utils.randomBytes(32)
    );

    const userOp = await makeEcdsaSessionKeySignedBatchUserOp(
      "executeBatch_y6U",
      [
        [mockToken.address, mockProtocol.address],
        [0, 0],
        [approveCallData, interactCallData],
      ],
      userSA.address,
      sessionKey,
      entryPoint,
      sessionKeyManager.address,
      [
        [
          0,
          0,
          wrongSessionValidationModuleAddress,
          sessionKeyData,
          merkleTree.getHexProof(ethers.utils.keccak256(leafData)),
          "0x",
        ],
        [
          validUntilForMockProtocol,
          0,
          mockProtocolSVM.address,
          sessionKeyData2,
          merkleTree.getHexProof(ethers.utils.keccak256(leafData2)),
          "0x",
        ],
      ],
      sessionRouter.address
    );

    await expect(
      entryPoint.handleOps([userOp], alice.address, { gasLimit: 10000000 })
    )
      .to.be.revertedWith("FailedOp")
      .withArgs(0, "AA23 reverted: SessionNotApproved");
  });

  it("should revert if Session Key Manager address provided in the sig is wrong", async () => {
    const {
      entryPoint,
      userSA,
      sessionKeyManager,
      sessionKeyData,
      leafData,
      merkleTree,
      sessionRouter,
      mockProtocol,
      mockProtocolSVM,
      mockToken,
      sessionKeyData2,
      leafData2,
      validUntilForMockProtocol,
      erc20SessionModule,
    } = await setupTests();
    const tokenAmountToTransfer = ethers.utils.parseEther("1.7534");

    const MockProtocol = await ethers.getContractFactory("MockProtocol");
    const IERC20 = await ethers.getContractFactory("ERC20");

    const approveCallData = IERC20.interface.encodeFunctionData("approve", [
      mockProtocol.address,
      tokenAmountToTransfer,
    ]);
    const interactCallData = MockProtocol.interface.encodeFunctionData(
      "interact",
      [mockToken.address, tokenAmountToTransfer]
    );

    const wrongSessionKeyManagerAddress = computeAddress(
      ethers.utils.randomBytes(32)
    );

    const userOp = await makeEcdsaSessionKeySignedBatchUserOp(
      "executeBatch_y6U",
      [
        [mockToken.address, mockProtocol.address],
        [0, 0],
        [approveCallData, interactCallData],
      ],
      userSA.address,
      sessionKey,
      entryPoint,
      wrongSessionKeyManagerAddress,
      [
        [
          0,
          0,
          erc20SessionModule.address,
          sessionKeyData,
          merkleTree.getHexProof(ethers.utils.keccak256(leafData)),
          "0x",
        ],
        [
          validUntilForMockProtocol,
          0,
          mockProtocolSVM.address,
          sessionKeyData2,
          merkleTree.getHexProof(ethers.utils.keccak256(leafData2)),
          "0x",
        ],
      ],
      sessionRouter.address
    );

    await expect(
      entryPoint.handleOps([userOp], alice.address, { gasLimit: 10000000 })
    )
      .to.be.revertedWith("FailedOp")
      .withArgs(0, "AA23 reverted: SR Invalid SKM");
  });

  it("should revert if session key data provided in the sig is wrong", async () => {
    const {
      entryPoint,
      userSA,
      sessionKeyManager,
      erc20SessionModule,
      leafData,
      merkleTree,
      sessionRouter,
      mockProtocol,
      mockProtocolSVM,
      mockToken,
      sessionKeyData2,
      leafData2,
      validUntilForMockProtocol,
    } = await setupTests();
    const tokenAmountToTransfer = ethers.utils.parseEther("1.7534");

    const MockProtocol = await ethers.getContractFactory("MockProtocol");
    const IERC20 = await ethers.getContractFactory("ERC20");

    const approveCallData = IERC20.interface.encodeFunctionData("approve", [
      mockProtocol.address,
      tokenAmountToTransfer,
    ]);
    const interactCallData = MockProtocol.interface.encodeFunctionData(
      "interact",
      [mockToken.address, tokenAmountToTransfer]
    );

    const { sessionKeyData: wrongSessionKeyData, leafData: wrongLeafData } =
      await getERC20SessionKeyParams(
        sessionKey.address,
        mockToken.address,
        mockProtocol.address,
        maxAmount.add(ethers.utils.parseEther("100")),
        0,
        0,
        erc20SessionModule.address
      );

    const userOp = await makeEcdsaSessionKeySignedBatchUserOp(
      "executeBatch_y6U",
      [
        [mockToken.address, mockProtocol.address],
        [0, 0],
        [approveCallData, interactCallData],
      ],
      userSA.address,
      sessionKey,
      entryPoint,
      sessionKeyManager.address,
      [
        [
          0,
          0,
          erc20SessionModule.address,
          wrongSessionKeyData,
          merkleTree.getHexProof(ethers.utils.keccak256(leafData)),
          "0x",
        ],
        [
          validUntilForMockProtocol,
          0,
          mockProtocolSVM.address,
          sessionKeyData2,
          merkleTree.getHexProof(ethers.utils.keccak256(leafData2)),
          "0x",
        ],
      ],
      sessionRouter.address
    );

    await expect(
      entryPoint.handleOps([userOp], alice.address, { gasLimit: 10000000 })
    )
      .to.be.revertedWith("FailedOp")
      .withArgs(0, "AA23 reverted: SessionNotApproved");
  });

  describe("validateUserOp() :", async () => {
    it("Should return correct validation data for a valid userOp", async () => {
      const {
        entryPoint,
        userSA,
        sessionKeyManager,
        erc20SessionModule,
        sessionKeyData,
        leafData,
        merkleTree,
        sessionRouter,
        mockProtocol,
        mockProtocolSVM,
        mockToken,
        sessionKeyData2,
        leafData2,
        validUntilForMockProtocol,
      } = await setupTests();

      const tokenAmountToTransfer = ethers.utils.parseEther("1.7534");

      const MockProtocol = await ethers.getContractFactory("MockProtocol");
      const IERC20 = await ethers.getContractFactory("ERC20");

      const approveCallData = IERC20.interface.encodeFunctionData("approve", [
        mockProtocol.address,
        tokenAmountToTransfer,
      ]);
      const interactCallData = MockProtocol.interface.encodeFunctionData(
        "interact",
        [mockToken.address, tokenAmountToTransfer]
      );

      const userOp = await makeEcdsaSessionKeySignedBatchUserOp(
        "executeBatch_y6U",
        [
          [mockToken.address, mockProtocol.address],
          [0, 0],
          [approveCallData, interactCallData],
        ],
        userSA.address,
        sessionKey,
        entryPoint,
        sessionKeyManager.address,
        [
          [
            0,
            0,
            erc20SessionModule.address,
            sessionKeyData,
            merkleTree.getHexProof(ethers.utils.keccak256(leafData)),
            "0x",
          ],
          [
            validUntilForMockProtocol,
            0,
            mockProtocolSVM.address,
            sessionKeyData2,
            merkleTree.getHexProof(ethers.utils.keccak256(leafData2)),
            "0x",
          ],
        ],
        sessionRouter.address
      );

      const userOpHash = await entryPoint.getUserOpHash(userOp);
      const validationData = await sessionRouter.callStatic.validateUserOp(
        userOp,
        userOpHash
      );

      const validationDataHexString = ethers.utils.hexZeroPad(
        ethers.utils.hexlify(validationData),
        32
      );
      const returnedValidAfter = ethers.BigNumber.from(
        "0x" + validationDataHexString.slice(2, 14)
      );
      const returnedValidUntil = ethers.BigNumber.from(
        "0x" + validationDataHexString.slice(14, 26)
      );
      const returnedSigValidationFailed = ethers.BigNumber.from(
        "0x" + validationDataHexString.slice(26, 66)
      );

      expect(returnedValidUntil).to.equal(validUntilForMockProtocol);
      expect(returnedValidAfter).to.equal(0);
      expect(returnedSigValidationFailed).to.equal(0);
    });

    it("Should return SIG_VALIDATION_FAILED if the userOp was not signed with the proper session key", async () => {
      const {
        entryPoint,
        userSA,
        sessionKeyManager,
        erc20SessionModule,
        sessionKeyData,
        leafData,
        merkleTree,
        sessionRouter,
        mockProtocol,
        mockProtocolSVM,
        mockToken,
        sessionKeyData2,
        leafData2,
        validUntilForMockProtocol,
      } = await setupTests();

      const SIG_VALIDATION_FAILED = 1;
      const tokenAmountToTransfer = ethers.utils.parseEther("1.7534");

      const MockProtocol = await ethers.getContractFactory("MockProtocol");
      const IERC20 = await ethers.getContractFactory("ERC20");

      const approveCallData = IERC20.interface.encodeFunctionData("approve", [
        mockProtocol.address,
        tokenAmountToTransfer,
      ]);
      const interactCallData = MockProtocol.interface.encodeFunctionData(
        "interact",
        [mockToken.address, tokenAmountToTransfer]
      );

      const userOp = await makeEcdsaSessionKeySignedBatchUserOp(
        "executeBatch_y6U",
        [
          [mockToken.address, mockProtocol.address],
          [0, 0],
          [approveCallData, interactCallData],
        ],
        userSA.address,
        nonAuthSessionKey, // not authorized session key
        entryPoint,
        sessionKeyManager.address,
        [
          [
            0,
            0,
            erc20SessionModule.address,
            sessionKeyData,
            merkleTree.getHexProof(ethers.utils.keccak256(leafData)),
            "0x",
          ],
          [
            validUntilForMockProtocol,
            0,
            mockProtocolSVM.address,
            sessionKeyData2,
            merkleTree.getHexProof(ethers.utils.keccak256(leafData2)),
            "0x",
          ],
        ],
        sessionRouter.address
      );

      const userOpHash = await entryPoint.getUserOpHash(userOp);
      const validationData = await sessionRouter.callStatic.validateUserOp(
        userOp,
        userOpHash
      );
      expect(validationData).to.equal(SIG_VALIDATION_FAILED);
    });

    it("Should revert if the userOp.signature length is less than 65", async () => {
      const {
        entryPoint,
        userSA,
        sessionKeyManager,
        erc20SessionModule,
        sessionKeyData,
        leafData,
        merkleTree,
        sessionRouter,
        mockProtocol,
        mockProtocolSVM,
        mockToken,
        sessionKeyData2,
        leafData2,
        validUntilForMockProtocol,
      } = await setupTests();

      const tokenAmountToTransfer = ethers.utils.parseEther("1.7534");

      const MockProtocol = await ethers.getContractFactory("MockProtocol");
      const IERC20 = await ethers.getContractFactory("ERC20");

      const approveCallData = IERC20.interface.encodeFunctionData("approve", [
        mockProtocol.address,
        tokenAmountToTransfer,
      ]);
      const interactCallData = MockProtocol.interface.encodeFunctionData(
        "interact",
        [mockToken.address, tokenAmountToTransfer]
      );

      const SmartAccount = await ethers.getContractFactory("SmartAccount");

      const txnDataAA1 = SmartAccount.interface.encodeFunctionData(
        "executeBatch_y6U",
        [
          [mockToken.address, mockProtocol.address],
          [0, 0],
          [approveCallData, interactCallData],
        ]
      );

      const userOp = await fillAndSign(
        {
          sender: userSA.address,
          callData: txnDataAA1,
        },
        sessionKey,
        entryPoint,
        "nonce"
      );

      const userOpHash = await entryPoint.getUserOpHash(userOp);
      const signatureOverUserOpHash = (
        await sessionKey.signMessage(ethers.utils.arrayify(userOpHash))
      ).slice(0, -2);

      const sessionData = [
        [
          0,
          0,
          erc20SessionModule.address,
          sessionKeyData,
          merkleTree.getHexProof(ethers.utils.keccak256(leafData)),
          "0x",
        ],
        [
          validUntilForMockProtocol,
          0,
          mockProtocolSVM.address,
          sessionKeyData2,
          merkleTree.getHexProof(ethers.utils.keccak256(leafData2)),
          "0x",
        ],
      ];

      const paddedSig = defaultAbiCoder.encode(
        [
          "address",
          "tuple(uint48,uint48,address,bytes,bytes32[],bytes)[]",
          "bytes",
        ],
        [sessionKeyManager.address, sessionData, signatureOverUserOpHash]
      );

      const signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
        ["bytes", "address"],
        [paddedSig, sessionRouter.address]
      );
      userOp.signature = signatureWithModuleAddress;

      await expect(
        sessionRouter.validateUserOp(userOp, userOpHash)
      ).to.be.revertedWith("ECDSA: invalid signature length");
    });
  });
});
