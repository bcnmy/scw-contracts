import { expect } from "chai";
import {
  makeEcdsaSessionKeySignedUserOp,
  enableNewTreeForSmartAccountViaEcdsa,
  getERC20SessionKeyParams,
  enableNewSqrtTreeForSmartAccountViaEcdsa,
  makeEcdsaSessionKeySignedUserOpSqrtTree,
  addLeavesForSmartAccountViaEcdsa,
} from "../utils/sessionKey";
import { ethers, deployments } from "hardhat";
import { makeEcdsaModuleUserOp } from "../utils/userOp";
import { encodeTransfer } from "../utils/testUtils";
import {
  getEntryPoint,
  getSmartAccountImplementation,
  getSmartAccountFactory,
  getMockToken,
  getEcdsaOwnershipRegistryModule,
  getSmartAccountWithModule,
} from "../utils/setupHelper";
import { BigNumber, Contract } from "ethers";
import { UserOperation } from "../utils/userOperation";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { SessionKeyManagerModuleSqrtDecomposition__factory } from "../../typechain";
import { EntryPoint } from "@account-abstraction/contracts";
import { keccak256 } from "ethereumjs-util";
import {
  formatBytes32String,
  hexValue,
  solidityKeccak256,
} from "ethers/lib/utils";

describe("Session Key Comparision Tests", async () => {
  let [deployer, smartAccountOwner, alice, charlie, sessionKey] =
    [] as SignerWithAddress[];
  const maxAmount = ethers.utils.parseEther("100");

  const TREE_WIDTH = 10;

  beforeEach(async function () {
    [deployer, smartAccountOwner, alice, charlie, sessionKey] =
      await ethers.getSigners();
  });

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

    // Enable Merkle Tree Session Key Manager Module
    const sessionKeyManager = await (
      await ethers.getContractFactory("SessionKeyManager")
    ).deploy();
    let userOp = await makeEcdsaModuleUserOp(
      "enableModule",
      [sessionKeyManager.address],
      userSA.address,
      smartAccountOwner,
      entryPoint,
      ecdsaModule.address,
      {
        preVerificationGas: 50000,
      }
    );
    await entryPoint.handleOps([userOp], alice.address);

    // Enable Sqrt Decomposition Tree Session Key Manager Module
    const sqrtSessionKeyManager =
      await new SessionKeyManagerModuleSqrtDecomposition__factory(alice).deploy(
        TREE_WIDTH
      );
    userOp = await makeEcdsaModuleUserOp(
      "enableModule",
      [sqrtSessionKeyManager.address],
      userSA.address,
      smartAccountOwner,
      entryPoint,
      ecdsaModule.address,
      {
        preVerificationGas: 50000,
      }
    );
    await entryPoint.handleOps([userOp], alice.address);

    const erc20SessionModule = await (
      await ethers.getContractFactory("ERC20SessionValidationModule")
    ).deploy();

    const { sessionKeyData, leafData } = await getERC20SessionKeyParams(
      sessionKey.address,
      mockToken.address,
      charlie.address,
      maxAmount,
      0,
      0,
      erc20SessionModule.address
    );

    const merkleTree = await enableNewTreeForSmartAccountViaEcdsa(
      [ethers.utils.keccak256(leafData)],
      sessionKeyManager,
      userSA.address,
      smartAccountOwner,
      entryPoint,
      ecdsaModule.address
    );

    const sqrtTreeRoot = await enableNewSqrtTreeForSmartAccountViaEcdsa(
      [ethers.utils.keccak256(leafData)],
      sqrtSessionKeyManager,
      userSA.address,
      smartAccountOwner,
      entryPoint,
      ecdsaModule.address,
      TREE_WIDTH
    );

    return {
      entryPoint: entryPoint,
      smartAccountImplementation: await getSmartAccountImplementation(),
      smartAccountFactory: await getSmartAccountFactory(),
      ecdsaModule: ecdsaModule,
      userSA: userSA,
      mockToken: mockToken,
      sessionKeyManager: sessionKeyManager,
      sqrtSessionKeyManager,
      erc20SessionModule: erc20SessionModule,
      sessionKeyData: sessionKeyData,
      leafData: leafData,
      merkleTree: merkleTree,
      sqrtTreeRoot,
    };
  });

  const makeErc20TransferUserOp = async function (
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
      testParams.erc20SessionModule.address,
      testParams.sessionKeyData,
      testParams.merkleTree.getHexProof(
        ethers.utils.keccak256(testParams.leafData)
      ),
      {
        preVerificationGas: 50000,
      }
    );
    return transferUserOp;
  };

  const makeSqrtTreeErc20TransferUserOp = async function (
    token: string,
    amount: BigNumber,
    recipient: string,
    txnValue: BigNumber,
    testParams: {
      entryPoint: EntryPoint;
      userSA: Contract;
      sqrtSessionKeyManager: Contract;
      erc20SessionModule: Contract;
      sessionKeyData: string;
      leafData: string;
      subTreeRoots: string[];
      neighbors: string[];
      subtreeIndex: number;
      leafIndex: number;
    }
  ): Promise<UserOperation> {
    const transferUserOp = await makeEcdsaSessionKeySignedUserOpSqrtTree(
      "execute_ncC",
      [token, txnValue, encodeTransfer(recipient, amount.toString())],
      testParams.userSA.address,
      sessionKey,
      testParams.entryPoint,
      testParams.sqrtSessionKeyManager.address,
      0,
      0,
      testParams.erc20SessionModule.address,
      testParams.sessionKeyData,
      testParams,
      {
        preVerificationGas: 50000,
      }
    );
    return transferUserOp;
  };

  it("Merkle Tree Session Key Manager Module - Should be able to process Session Key signed userOp", async () => {
    let {
      entryPoint,
      userSA,
      sessionKeyManager,
      erc20SessionModule,
      ecdsaModule,
      sessionKeyData,
      leafData,
      merkleTree,
      mockToken,
    } = await setupTests();
    const tokenAmountToTransfer = ethers.utils.parseEther("0.7534");

    for (let i = 0; i < 10; i++) {
      merkleTree = await addLeavesForSmartAccountViaEcdsa(
        merkleTree,
        [ethers.utils.keccak256(leafData)],
        sessionKeyManager,
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      );
    }

    const transferUserOp = await makeErc20TransferUserOp(
      mockToken.address,
      tokenAmountToTransfer,
      charlie.address,
      ethers.utils.parseEther("0"),
      {
        entryPoint,
        userSA,
        sessionKeyManager,
        erc20SessionModule,
        sessionKeyData,
        leafData,
        merkleTree,
      }
    );

    const charlieTokenBalanceBefore = await mockToken.balanceOf(
      charlie.address
    );
    const { wait } = await entryPoint.handleOps(
      [transferUserOp],
      alice.address
    );
    const { gasUsed } = await wait();
    console.log("Gas used: ", gasUsed.toString());
    expect(await mockToken.balanceOf(charlie.address)).to.equal(
      charlieTokenBalanceBefore.add(tokenAmountToTransfer)
    );
  });

  it("Sqrt Tree Session Key Manager Module - Should be able to process Session Key signed userOp", async () => {
    const {
      entryPoint,
      userSA,
      sqrtSessionKeyManager,
      erc20SessionModule,
      sessionKeyData,
      leafData,
      mockToken,
    } = await setupTests();
    const tokenAmountToTransfer = ethers.utils.parseEther("0.7534");

    const neighbors = new Array(TREE_WIDTH).fill(
      ethers.utils.keccak256(formatBytes32String(""))
    );
    const subTreeRoots = new Array(TREE_WIDTH).fill(
      solidityKeccak256(["bytes32[]"], [neighbors])
    );

    const transferUserOp = await makeSqrtTreeErc20TransferUserOp(
      mockToken.address,
      tokenAmountToTransfer,
      charlie.address,
      ethers.utils.parseEther("0"),
      {
        entryPoint: entryPoint as any,
        userSA,
        sqrtSessionKeyManager,
        erc20SessionModule,
        sessionKeyData,
        leafData,
        subTreeRoots,
        neighbors,
        subtreeIndex: 0,
        leafIndex: 0,
      }
    );

    const charlieTokenBalanceBefore = await mockToken.balanceOf(
      charlie.address
    );
    const { wait } = await entryPoint.handleOps(
      [transferUserOp],
      alice.address
    );
    const { gasUsed } = await wait();
    console.log("Gas used: ", gasUsed.toString());
    expect(await mockToken.balanceOf(charlie.address)).to.equal(
      charlieTokenBalanceBefore.add(tokenAmountToTransfer)
    );
  });
});
