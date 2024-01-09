import { expect } from "chai";
import {
  makeEcdsaSessionKeySignedUserOp,
  enableNewTreeForSmartAccountViaEcdsa,
  getABISessionKeyParams,
  makeEcdsaSessionKeySignedBatchUserOp,
  Rule,
  Permission,
} from "../../utils/sessionKey";
import { ethers, deployments, waffle } from "hardhat";
import { makeEcdsaModuleUserOp } from "../../utils/userOp";
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
import { encodeTransfer } from "../../utils/testUtils";

describe("ABI SVM Debug", async () => {
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

    const mockProtocol = await (
      await ethers.getContractFactory("MockProtocol")
    ).deploy();

    const abiSVM = await (
      await ethers.getContractFactory("ABISessionValidationModule")
    ).deploy();

    const { sessionKeyData, leafData } = await getABISessionKeyParams(
      sessionKey.address,
      {
        destContract: mockToken.address,
        functionSelector: ethers.utils.hexDataSlice(
          ethers.utils.id("transfer(address,uint256)"),
          0,
          4
        ), // transfer function selector
        valueLimit: ethers.utils.parseEther("1"),
        // array of offsets, values, and conditions
        rules: [
          {
            offset: 0,
            condition: 0, // equal
            referenceValue: ethers.utils.hexZeroPad(charlie.address, 32),
          },
          {
            offset: 32,
            condition: 1, // less than or equal
            referenceValue: ethers.utils.hexZeroPad("0x056bc75e2d63100000", 32),
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

  const makeErc20TransferUserOpViaABISVM = async function (
    token: string,
    amount: BigNumber,
    recipient: string,
    txnValue: BigNumber,
    testParams: any = {}
  ): Promise<UserOperation> {
    const transferUserOp = await makeEcdsaSessionKeySignedUserOp(
      "execute_ncC",
      [token, txnValue, encodeTransfer(recipient, amount.toString())],
      testParams.userSA.address,
      sessionKey,
      testParams.entryPoint,
      testParams.sessionKeyManager.address,
      0,
      0,
      testParams.abiSVM.address,
      testParams.sessionKeyData,
      testParams.merkleTree.getHexProof(
        ethers.utils.keccak256(testParams.leafData)
      ),
      {
        preVerificationGas: 55000,
      }
    );
    return transferUserOp;
  };

  it("should be able to process Session Key signed userOp with execute method in calldata", async () => {
    const {
      entryPoint,
      userSA,
      sessionKeyManager,
      abiSVM,
      leafDatas,
      sessionKeyDatas,
      merkleTree,
      mockToken,
    } = await setupTests();
    const tokenAmountToTransfer = ethers.utils.parseEther("0.7534");

    const transferSessionKeyData = sessionKeyDatas[0];
    const transferLeafData = leafDatas[0];

    const transferUserOp = await makeErc20TransferUserOpViaABISVM(
      mockToken.address,
      tokenAmountToTransfer,
      charlie.address,
      ethers.utils.parseEther("0"),
      {
        entryPoint,
        userSA,
        sessionKeyManager,
        abiSVM,
        sessionKeyData: transferSessionKeyData,
        leafData: transferLeafData,
        merkleTree,
      }
    );

    const charlieTokenBalanceBefore = await mockToken.balanceOf(
      charlie.address
    );
    await entryPoint.handleOps([transferUserOp], alice.address, {
      gasLimit: 10000000,
    });
    expect(await mockToken.balanceOf(charlie.address)).to.equal(
      charlieTokenBalanceBefore.add(tokenAmountToTransfer)
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

    await entryPoint.handleOps([userOp], alice.address, {
      gasLimit: 10000000,
    });

    expect(await mockToken.balanceOf(mockProtocol.address)).to.equal(
      tokenAmountToTransfer
    );
  });
});
