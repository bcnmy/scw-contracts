import { expect } from "chai";
import { ethers, deployments } from "hardhat";
import {
  makeEcdsaModuleUserOp,
  fillAndSign,
  makeMultichainEcdsaModuleUserOp,
} from "../../utils/userOp";
import { getERC20SessionKeyParams } from "../../utils/sessionKey";
import { encodeTransfer } from "../../utils/testUtils";
import { defaultAbiCoder, hexZeroPad, hexConcat } from "ethers/lib/utils";
import {
  getEntryPoint,
  getSmartAccountImplementation,
  getMockToken,
  getStakedSmartAccountFactory,
  getVerifyingPaymaster,
} from "../../utils/setupHelper";
import { keccak256 } from "ethereumjs-util";
import { MerkleTree } from "merkletreejs";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BundlerTestEnvironment } from "../environment/bundlerEnvironment";

describe("MultichainValidator Module", async () => {
  const maxAmount = ethers.utils.parseEther("100");

  let [deployer, smartAccountOwner, charlie, verifiedSigner, sessionKey] =
    [] as SignerWithAddress[];

  let environment: BundlerTestEnvironment;

  before(async function () {
    const chainId = (await ethers.provider.getNetwork()).chainId;
    if (chainId !== BundlerTestEnvironment.BUNDLER_ENVIRONMENT_CHAIN_ID) {
      this.skip();
    }

    environment = await BundlerTestEnvironment.getDefaultInstance();
  });

  beforeEach(async function () {
    [deployer, smartAccountOwner, charlie, verifiedSigner, sessionKey] =
      await ethers.getSigners();
  });

  afterEach(async function () {
    const chainId = (await ethers.provider.getNetwork()).chainId;
    if (chainId !== BundlerTestEnvironment.BUNDLER_ENVIRONMENT_CHAIN_ID) {
      this.skip();
    }

    await Promise.all([
      environment.revert(environment.defaultSnapshot!),
      environment.resetBundler(),
    ]);
  });

  const setupTests = deployments.createFixture(async ({ deployments }) => {
    // deploy a smart account with a multichain module and enable the session key manager
    // and a session key all in one userOp
    await deployments.fixture();

    const entryPoint = await getEntryPoint();
    const smartAccountFactory = await getStakedSmartAccountFactory();
    const mockToken = await getMockToken();

    const MultichainECDSAValidator = await ethers.getContractFactory(
      "MultichainECDSAValidator"
    );
    const multichainECDSAValidator = await MultichainECDSAValidator.deploy();
    const sessionKeyManager = await (
      await ethers.getContractFactory("SessionKeyManager")
    ).deploy();
    const erc20SessionModule = await (
      await ethers.getContractFactory("ERC20SessionValidationModule")
    ).deploy();

    const SmartAccountFactory = await ethers.getContractFactory(
      "SmartAccountFactory"
    );
    const SmartAccount = await ethers.getContractFactory("SmartAccount");

    // ============ preparing smart account deployment =============

    const ecdsaOwnershipSetupData =
      MultichainECDSAValidator.interface.encodeFunctionData(
        "initForSmartAccount",
        [smartAccountOwner.address]
      );
    const smartAccountDeploymentIndex = 0;

    const deploymentData = SmartAccountFactory.interface.encodeFunctionData(
      "deployCounterFactualAccount",
      [
        multichainECDSAValidator.address,
        ecdsaOwnershipSetupData,
        smartAccountDeploymentIndex,
      ]
    );

    const expectedSmartAccountAddress =
      await smartAccountFactory.getAddressForCounterFactualAccount(
        multichainECDSAValidator.address,
        ecdsaOwnershipSetupData,
        smartAccountDeploymentIndex
      );

    // funding account
    await deployer.sendTransaction({
      to: expectedSmartAccountAddress,
      value: ethers.utils.parseEther("10"),
    });
    await mockToken.mint(
      expectedSmartAccountAddress,
      ethers.utils.parseEther("1000000")
    );
    await mockToken.mint(charlie.address, ethers.utils.parseEther("10"));

    // ============== session key setup =============

    const { leafData } = await getERC20SessionKeyParams(
      sessionKey.address,
      mockToken.address,
      charlie.address,
      maxAmount,
      0,
      0,
      erc20SessionModule.address
    );

    const sessionKeyMerkleTree = new MerkleTree(
      [ethers.utils.keccak256(leafData)],
      keccak256,
      { sortPairs: true, hashLeaves: false }
    );

    const enableSessionKeyManagerData =
      SmartAccount.interface.encodeFunctionData("enableModule", [
        sessionKeyManager.address,
      ]);

    const enableSessionKeyData = sessionKeyManager.interface.encodeFunctionData(
      "setMerkleRoot",
      [sessionKeyMerkleTree.getHexRoot()]
    );

    // ============== make userOp ===============

    const batchUserOpCallData = SmartAccount.interface.encodeFunctionData(
      "executeBatch_y6U",
      [
        [expectedSmartAccountAddress, sessionKeyManager.address],
        [0, 0],
        [enableSessionKeyManagerData, enableSessionKeyData],
      ]
    );

    const deploymentUserOp = await fillAndSign(
      {
        sender: expectedSmartAccountAddress,
        callGasLimit: 1_000_000,
        initCode: ethers.utils.hexConcat([
          smartAccountFactory.address,
          deploymentData,
        ]),
        callData: batchUserOpCallData,
        preVerificationGas: 55000,
      },
      smartAccountOwner,
      entryPoint,
      "nonce",
      true,
      0,
      0
    );

    // =============== make a multichain signature for a userOp ===============

    const validUntil = 0; // unlimited
    const validAfter = 0;

    const leaf1 = "0xb0bb0b"; // some random hash
    const leaf2 = hexConcat([
      hexZeroPad(ethers.utils.hexlify(validUntil), 6),
      hexZeroPad(ethers.utils.hexlify(validAfter), 6),
      hexZeroPad(await entryPoint.getUserOpHash(deploymentUserOp), 32),
    ]);
    const leaf3 = "0xdecafdecaf";
    const leaf4 = "0xa11cea11ce";

    // prepare the merkle tree containing the leaves with chainId info
    const leaves = [leaf1, leaf2, leaf3, leaf4].map((x) =>
      ethers.utils.keccak256(x)
    );

    const chainMerkleTree = new MerkleTree(leaves, keccak256, {
      sortPairs: true,
    });
    const merkleProof = chainMerkleTree.getHexProof(leaves[1]);

    const multichainSignature = await smartAccountOwner.signMessage(
      ethers.utils.arrayify(chainMerkleTree.getHexRoot())
    );

    const moduleSignature = defaultAbiCoder.encode(
      ["uint48", "uint48", "bytes32", "bytes32[]", "bytes"],
      [
        validUntil,
        validAfter,
        chainMerkleTree.getHexRoot(),
        merkleProof,
        multichainSignature,
      ]
    );

    // add validator module address to the signature
    const signatureWithModuleAddress = defaultAbiCoder.encode(
      ["bytes", "address"],
      [moduleSignature, multichainECDSAValidator.address]
    );

    // =================== put signature into userOp and execute ===================
    deploymentUserOp.signature = signatureWithModuleAddress;
    await environment.sendUserOperation(deploymentUserOp, entryPoint.address);

    // =================== connect SA and return everything ====================
    const userSA = await ethers.getContractAt(
      "SmartAccount",
      expectedSmartAccountAddress
    );

    return {
      entryPoint: entryPoint,
      smartAccountImplementation: await getSmartAccountImplementation(),
      smartAccountFactory: smartAccountFactory,
      mockToken: mockToken,
      userSA: userSA,
      verifyingPaymaster: await getVerifyingPaymaster(deployer, verifiedSigner),
      multichainECDSAValidator: multichainECDSAValidator,
      sessionKeyManager: sessionKeyManager,
      sessionKeyMerkleTree: sessionKeyMerkleTree,
    };
  });

  describe("Multichain userOp validation", async () => {
    it("should process a userOp with a multichain signature", async () => {
      const { userSA, entryPoint, multichainECDSAValidator, mockToken } =
        await setupTests();

      const charlieTokenBalanceBefore = await mockToken.balanceOf(
        charlie.address
      );
      const tokenAmountToTransfer = ethers.utils.parseEther("0.5945");

      const sendTokenMultichainUserOp = await makeMultichainEcdsaModuleUserOp(
        "execute_ncC",
        [
          mockToken.address,
          ethers.utils.parseEther("0"),
          encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
        ],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        multichainECDSAValidator.address,
        ["0xb0bb0b", "0xdecaf0"],
        {
          preVerificationGas: 55000,
        }
      );

      await environment.sendUserOperation(
        sendTokenMultichainUserOp,
        entryPoint.address
      );

      expect(await mockToken.balanceOf(charlie.address)).to.equal(
        charlieTokenBalanceBefore.add(tokenAmountToTransfer)
      );
    });
  });

  describe("Single chain userOp validation", async () => {
    it("should process a userOp with a regular ECDSA single chain signature", async () => {
      const { entryPoint, mockToken, userSA, multichainECDSAValidator } =
        await setupTests();

      const charlieTokenBalanceBefore = await mockToken.balanceOf(
        charlie.address
      );
      const tokenAmountToTransfer = ethers.utils.parseEther("0.5345");

      const userOp = await makeEcdsaModuleUserOp(
        "execute_ncC",
        [
          mockToken.address,
          ethers.utils.parseEther("0"),
          encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
        ],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        multichainECDSAValidator.address,
        {
          preVerificationGas: 50000,
        }
      );

      await environment.sendUserOperation(userOp, entryPoint.address);

      expect(await mockToken.balanceOf(charlie.address)).to.equal(
        charlieTokenBalanceBefore.add(tokenAmountToTransfer)
      );
    });
  });
});
