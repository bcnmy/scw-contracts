import { expect } from "chai";
import { ethers, deployments } from "hardhat";
import { makeEcdsaModuleUserOp } from "../../utils/userOp";
import {
  makeEcdsaSessionKeySignedUserOp,
  enableNewTreeForSmartAccountViaEcdsa,
} from "../../utils/sessionKey";
import { encodeTransfer } from "../../utils/testUtils";
import { hexZeroPad, hexConcat } from "ethers/lib/utils";
import {
  getEntryPoint,
  getSmartAccountImplementation,
  getSmartAccountFactory,
  getMockToken,
  getEcdsaOwnershipRegistryModule,
  getSmartAccountWithModule,
  getVerifyingPaymaster,
} from "../../utils/setupHelper";
import { keccak256 } from "ethereumjs-util";
import { MerkleTree } from "merkletreejs";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BundlerTestEnvironment } from "../environment/bundlerEnvironment";

describe("SessionKey: SessionKey Manager Module (with Bundler)", async () => {
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
    await deployments.fixture();

    const entryPoint = await getEntryPoint();
    const mockToken = await getMockToken();
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

    const sessionKeyManager = await (
      await ethers.getContractFactory("SessionKeyManager")
    ).deploy();
    const userOp = await makeEcdsaModuleUserOp(
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
    await environment.sendUserOperation(userOp, entryPoint.address);

    const mockSessionValidationModule = await (
      await ethers.getContractFactory("MockSessionValidationModule")
    ).deploy();

    const validUntil = 0;
    const validAfter = 0;
    const sessionKeyData = hexZeroPad(sessionKey.address, 20);
    const leafData = hexConcat([
      hexZeroPad(ethers.utils.hexlify(validUntil), 6),
      hexZeroPad(ethers.utils.hexlify(validAfter), 6),
      hexZeroPad(mockSessionValidationModule.address, 20),
      sessionKeyData,
    ]);

    const merkleTree = await enableNewTreeForSmartAccountViaEcdsa(
      [ethers.utils.keccak256(leafData)],
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
      mockToken: mockToken,
      ecdsaModule: ecdsaModule,
      userSA: userSA,
      verifyingPaymaster: await getVerifyingPaymaster(deployer, verifiedSigner),
      sessionKeyManager: sessionKeyManager,
      mockSessionValidationModule: mockSessionValidationModule,
      sessionKeyData: sessionKeyData,
      leafData: leafData,
      merkleTree: merkleTree,
    };
  });

  describe("setMerkleRoot", async () => {
    it("should add new session key by setting new merkle tree root", async () => {
      const {
        userSA,
        sessionKeyManager,
        mockSessionValidationModule,
        entryPoint,
        ecdsaModule,
      } = await setupTests();

      const data = hexConcat([
        hexZeroPad("0x00", 6),
        hexZeroPad("0x00", 6),
        hexZeroPad(mockSessionValidationModule.address, 20),
        hexZeroPad(sessionKey.address, 20),
      ]);

      const merkleTree = new MerkleTree(
        [ethers.utils.keccak256(data)],
        keccak256,
        { sortPairs: false, hashLeaves: false }
      );
      const addMerkleRootUserOp = await makeEcdsaModuleUserOp(
        "execute_ncC",
        [
          sessionKeyManager.address,
          ethers.utils.parseEther("0"),
          sessionKeyManager.interface.encodeFunctionData("setMerkleRoot", [
            merkleTree.getHexRoot(),
          ]),
        ],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address,
        {
          preVerificationGas: 50000,
        }
      );

      await environment.sendUserOperation(
        addMerkleRootUserOp,
        entryPoint.address
      );

      expect(
        (await sessionKeyManager.getSessionKeys(userSA.address)).merkleRoot
      ).to.equal(merkleTree.getHexRoot());
    });
  });

  describe("validateUserOp", async () => {
    it("should be able to process Session Key signed userOp via Mock session validation module", async () => {
      const {
        entryPoint,
        userSA,
        sessionKeyManager,
        mockSessionValidationModule,
        mockToken,
        sessionKeyData,
        leafData,
        merkleTree,
      } = await setupTests();
      const tokenAmountToTransfer = ethers.utils.parseEther("0.834");

      const transferUserOp = await makeEcdsaSessionKeySignedUserOp(
        "execute_ncC",
        [
          mockToken.address,
          ethers.utils.parseEther("0"),
          encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
        ],
        userSA.address,
        sessionKey,
        entryPoint,
        sessionKeyManager.address,
        0,
        0,
        mockSessionValidationModule.address,
        sessionKeyData,
        merkleTree.getHexProof(ethers.utils.keccak256(leafData)),
        {
          preVerificationGas: 50000,
        }
      );

      const charlieTokenBalanceBefore = await mockToken.balanceOf(
        charlie.address
      );

      await environment.sendUserOperation(transferUserOp, entryPoint.address);

      expect(await mockToken.balanceOf(charlie.address)).to.equal(
        charlieTokenBalanceBefore.add(tokenAmountToTransfer)
      );
    });
  });
});
