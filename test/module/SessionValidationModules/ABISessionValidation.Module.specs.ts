import { expect } from "chai";
import {
  makeEcdsaSessionKeySignedUserOp,
  enableNewTreeForSmartAccountViaEcdsa,
  getERC20SessionKeyParams,
  getABISessionKeyParams,
  addLeavesForSmartAccountViaEcdsa,
  makeEcdsaSessionKeySignedBatchUserOp,
} from "../../utils/sessionKey";
import { ethers, deployments, waffle } from "hardhat";
import { makeEcdsaModuleUserOp, fillAndSign } from "../../utils/userOp";
import { encodeTransfer } from "../../utils/testUtils";
import {
  getEntryPoint,
  getSmartAccountImplementation,
  getSmartAccountFactory,
  getMockToken,
  getEcdsaOwnershipRegistryModule,
  getSmartAccountWithModule,
} from "../../utils/setupHelper";
import { BigNumber } from "ethers";
import { UserOperation } from "../../utils/userOperation";

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
      [
        mockToken.address,
        ethers.utils.hexDataSlice(
          ethers.utils.id("transfer(address,uint256)"),
          0,
          4
        ), // transfer function selector
        ethers.utils.parseEther("1"),
        // array of offsets, values, and conditions
        [
          [0, ethers.utils.hexZeroPad(charlie.address, 32), 0], // equal
          [32, ethers.utils.hexZeroPad("0x056bc75e2d63100000", 32), 1], // less than or equal
        ],
      ],
      0,
      0,
      abiSVM.address
    );

    const { sessionKeyData: sessionKeyData2, leafData: leafData2 } =
      await getABISessionKeyParams(
        sessionKey.address,
        [
          mockToken.address,
          ethers.utils.hexDataSlice(
            ethers.utils.id("approve(address,uint256)"),
            0,
            4
          ), // transfer function selector
          ethers.utils.parseEther("0"), // value limit
          // array of offsets, values, and conditions
          [
            [0, ethers.utils.hexZeroPad(mockProtocol.address, 32), 0], // equal
            [32, ethers.utils.hexZeroPad("0x21E19E0C9BAB2400000", 32), 1], // less than or equal; 0x056bc75e2d63100000 = hex(10^22) = 10,000tokens
          ],
        ],
        0,
        0,
        abiSVM.address
      );

    const { sessionKeyData: sessionKeyData3, leafData: leafData3 } =
      await getABISessionKeyParams(
        sessionKey.address,
        [
          mockProtocol.address,
          ethers.utils.hexDataSlice(
            ethers.utils.id("interact(address,uint256)"),
            0,
            4
          ),
          ethers.utils.parseEther("0"), // value limit
          // array of offsets, values, and conditions
          [
            [0, ethers.utils.hexZeroPad(mockToken.address, 32), 0], // equal
            [32, ethers.utils.hexZeroPad("0x21E19E0C9BAB2400000", 32), 1], // less than or equal; 0x056bc75e2d63100000 = hex(10^22) = 10,000tokens
          ],
        ],
        0,
        0,
        abiSVM.address
      );

    const { sessionKeyData: sessionKeyData4, leafData: leafData4 } =
      await getABISessionKeyParams(
        sessionKey.address,
        [
          mockProtocol.address,
          ethers.utils.hexDataSlice(
            ethers.utils.id("changeState(uint256,bytes)"),
            0,
            4
          ), // transfer function selector
          ethers.utils.parseEther("0.5"), // value limit
          // array of offsets, values, and conditions
          [
            [0, ethers.utils.hexZeroPad("0x0400", 32), 1], // less than or equal; 0x400 = 1,024
            [32, ethers.utils.hexZeroPad("0x40", 32), 0], // offset == 0x40 = 64 = first arg(32) + offset_itself(32)
            [64, ethers.utils.hexZeroPad("0x20", 32), 3], // length >= 0x20 (32)
          ],
        ],
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

    const vulnerableErc20SessionModule = await (
      await ethers.getContractFactory("VulnerableERC20SessionValidationModule")
    ).deploy();

    return {
      entryPoint: entryPoint,
      smartAccountImplementation: await getSmartAccountImplementation(),
      smartAccountFactory: await getSmartAccountFactory(),
      ecdsaModule: ecdsaModule,
      userSA: userSA,
      mockToken: mockToken,
      sessionKeyManager: sessionKeyManager,
      merkleTree: merkleTree,
      vulnerableErc20SessionModule: vulnerableErc20SessionModule,
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

  it("Should revert if the selector is wrong", async () => {
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

    const sessionKeyData = sessionKeyDatas[0];
    const leafData = leafDatas[0];

    const approveUserOp = await makeEcdsaSessionKeySignedUserOp(
      "execute_ncC",
      [
        mockToken.address,
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
      sessionKeyData,
      merkleTree.getHexProof(ethers.utils.keccak256(leafData))
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
      .withArgs(0, "AA23 reverted: ABISV: Permission violated");

    expect(await mockToken.balanceOf(charlie.address)).to.equal(
      charlieTokenBalanceBefore
    );
  });

  it("should be able to process Batched userOp via Batched Session Router and ABI SVM", async () => {
    const {
      entryPoint,
      userSA,
      sessionKeyManager,
      abiSVM,
      sessionKeyDatas,
      leafDatas,
      merkleTree,
      mockToken,
      sessionRouter,
      mockProtocol,
    } = await setupTests();

    const tokenAmountToTransfer = ethers.utils.parseEther("3.2432");

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
    const changeStateCallData = MockProtocol.interface.encodeFunctionData(
      "changeState",
      [
        0x123, // some random uint256 that is less than 1,024
        ethers.utils.hexZeroPad("0xdeafbeef", 32), // bytes, 32-length
      ]
    );

    const approveSessionKeyData = sessionKeyDatas[1];
    const approveLeafData = leafDatas[1];
    const interactSessionKeyData = sessionKeyDatas[2];
    const interactLeafData = leafDatas[2];
    const changeStateSessionKeyData = sessionKeyDatas[3];
    const changeStateLeafData = leafDatas[3];

    const userOp = await makeEcdsaSessionKeySignedBatchUserOp(
      "executeBatch_y6U",
      [
        [mockToken.address, mockProtocol.address, mockProtocol.address],
        [0, 0, ethers.utils.parseEther("0.01")],
        [approveCallData, interactCallData, changeStateCallData],
      ],
      userSA.address,
      sessionKey,
      entryPoint,
      sessionKeyManager.address,
      [
        [
          0,
          0,
          abiSVM.address,
          approveSessionKeyData,
          merkleTree.getHexProof(ethers.utils.keccak256(approveLeafData)),
          "0x",
        ],
        [
          0,
          0,
          abiSVM.address,
          interactSessionKeyData,
          merkleTree.getHexProof(ethers.utils.keccak256(interactLeafData)),
          "0x",
        ],
        [
          0,
          0,
          abiSVM.address,
          changeStateSessionKeyData,
          merkleTree.getHexProof(ethers.utils.keccak256(changeStateLeafData)),
          "0x",
        ],
      ],
      sessionRouter.address,
      {
        preVerificationGas: 75000,
      }
    );

    await entryPoint.handleOps([userOp], alice.address, { gasLimit: 10000000 });

    expect(await mockToken.balanceOf(mockProtocol.address)).to.equal(
      tokenAmountToTransfer
    );
  });
});
