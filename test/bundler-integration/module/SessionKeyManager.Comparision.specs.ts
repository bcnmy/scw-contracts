import { expect } from "chai";
import { ethers, deployments, waffle } from "hardhat";
import { makeEcdsaModuleUserOp, packUserOp } from "../../utils/userOp";
import {
  makeEcdsaSessionKeySignedUserOp,
  enableNewTreeForSmartAccountViaEcdsa,
  makeStatelessEcdsaSessionKeySignedUserOp,
  addLeavesForSmartAccountViaEcdsa,
  makeSessionEnableData,
  makeStatefullEcdsaSessionKeySignedUserOp,
} from "../../utils/sessionKey";
import { callDataCost, encodeTransfer } from "../../utils/testUtils";
import { hexZeroPad, hexConcat, keccak256 } from "ethers/lib/utils";
import {
  getEntryPoint,
  getSmartAccountImplementation,
  getSmartAccountFactory,
  getMockToken,
  getEcdsaOwnershipRegistryModule,
  getSmartAccountWithModule,
} from "../../utils/setupHelper";
import {
  SessionKeyManagerStatefull__factory,
  SessionKeyManagerStateless__factory,
} from "../../../typechain-types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BundlerTestEnvironment } from "../environment/bundlerEnvironment";

describe("SessionKey: Comparision", async () => {
  let [
    deployer,
    smartAccountOwner,
    charlie,
    verifiedSigner,
    sessionKey,
    alice,
  ] = [] as SignerWithAddress[];

  let environment: BundlerTestEnvironment;

  before(async function () {
    const chainId = (await ethers.provider.getNetwork()).chainId;
    if (chainId !== BundlerTestEnvironment.BUNDLER_ENVIRONMENT_CHAIN_ID) {
      this.skip();
    }

    environment = await BundlerTestEnvironment.getDefaultInstance();
  });

  beforeEach(async function () {
    [deployer, smartAccountOwner, charlie, verifiedSigner, sessionKey, alice] =
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
    let userOp = await makeEcdsaModuleUserOp(
      "enableModule",
      [sessionKeyManager.address],
      userSA.address,
      smartAccountOwner,
      entryPoint,
      ecdsaModule.address
    );
    await entryPoint.handleOps([userOp], alice.address);

    const statelessSessionKeyMananger =
      await new SessionKeyManagerStateless__factory(alice).deploy();
    userOp = await makeEcdsaModuleUserOp(
      "enableModule",
      [statelessSessionKeyMananger.address],
      userSA.address,
      smartAccountOwner,
      entryPoint,
      ecdsaModule.address
    );
    await entryPoint.handleOps([userOp], alice.address);

    const statefullSessionKeyMananger =
      await new SessionKeyManagerStatefull__factory(alice).deploy();
    userOp = await makeEcdsaModuleUserOp(
      "enableModule",
      [statefullSessionKeyMananger.address],
      userSA.address,
      smartAccountOwner,
      entryPoint,
      ecdsaModule.address
    );
    await entryPoint.handleOps([userOp], alice.address);

    const mockSessionValidationModule = await (
      await ethers.getContractFactory("MockSessionValidationModule")
    ).deploy();

    const validUntil = 0;
    const validAfter = 0;
    const sessionKeyData = hexZeroPad(sessionKey.address, 20);

    const leafDataRaw = {
      validUntil,
      validAfter,
      sessionValidationModule: mockSessionValidationModule.address,
      sessionKeyData,
    };

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
      sessionKeyManager: sessionKeyManager,
      statelessSessionKeyMananger: statelessSessionKeyMananger,
      statefullSessionKeyMananger: statefullSessionKeyMananger,
      mockSessionValidationModule: mockSessionValidationModule,
      sessionKeyData: sessionKeyData,
      leafData: leafData,
      leafDataRaw,
      merkleTree: merkleTree,
    };
  });

  describe("validateUserOp", async () => {
    it("Merkle Tree Session Key Manager Module: 1 leaf", async () => {
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
          preVerificationGas: 51000,
        }
      );

      const charlieTokenBalanceBefore = await mockToken.balanceOf(
        charlie.address
      );

      const calldataCost = callDataCost(packUserOp(transferUserOp, false));
      console.log("calldataCost", calldataCost);

      await environment.sendUserOperation(transferUserOp, entryPoint.address);

      expect(await mockToken.balanceOf(charlie.address)).to.equal(
        charlieTokenBalanceBefore.add(tokenAmountToTransfer)
      );
    });

    it("Merkle Tree Session Key Manager Module: 100 leafs", async () => {
      const {
        entryPoint,
        userSA,
        sessionKeyManager,
        mockSessionValidationModule,
        mockToken,
        sessionKeyData,
        leafData,
        merkleTree,
        ecdsaModule,
      } = await setupTests();
      const tokenAmountToTransfer = ethers.utils.parseEther("0.834");

      const newMerkleTree = await addLeavesForSmartAccountViaEcdsa(
        merkleTree,
        new Array(99).fill(0).map(() => ethers.utils.keccak256(leafData)),
        sessionKeyManager,
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      );

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
        newMerkleTree.getHexProof(ethers.utils.keccak256(leafData)),
        {
          preVerificationGas: 51000,
        }
      );

      const charlieTokenBalanceBefore = await mockToken.balanceOf(
        charlie.address
      );

      const calldataCost = callDataCost(packUserOp(transferUserOp, false));
      console.log("calldataCost", calldataCost);

      await environment.sendUserOperation(transferUserOp, entryPoint.address);

      expect(await mockToken.balanceOf(charlie.address)).to.equal(
        charlieTokenBalanceBefore.add(tokenAmountToTransfer)
      );
    });

    it("Stateless Session Key Manager Module", async () => {
      const {
        entryPoint,
        userSA,
        statelessSessionKeyMananger,
        mockSessionValidationModule,
        mockToken,
        sessionKeyData,
        leafData,
        ecdsaModule,
      } = await setupTests();
      const tokenAmountToTransfer = ethers.utils.parseEther("0.834");

      const chainId = (await ethers.provider.getNetwork()).chainId;

      const sessionEnableData = makeSessionEnableData([chainId], [leafData]);

      const messageHashAndAddress = ethers.utils.arrayify(
        ethers.utils.hexConcat([keccak256(sessionEnableData), userSA.address])
      );
      const signature = await smartAccountOwner.signMessage(
        messageHashAndAddress
      );

      const signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
        ["bytes", "address"],
        [signature, ecdsaModule.address]
      );

      const sessionKeyIndex = 0;

      const transferUserOp = await makeStatelessEcdsaSessionKeySignedUserOp(
        "execute_ncC",
        [
          mockToken.address,
          ethers.utils.parseEther("0"),
          encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
        ],
        userSA.address,
        sessionKey,
        entryPoint,
        statelessSessionKeyMananger.address,
        0,
        0,
        sessionKeyIndex,
        mockSessionValidationModule.address,
        sessionKeyData,
        sessionEnableData,
        signatureWithModuleAddress,
        {
          preVerificationGas: 51000,
        }
      );

      const charlieTokenBalanceBefore = await mockToken.balanceOf(
        charlie.address
      );

      const calldataCost = callDataCost(packUserOp(transferUserOp, false));
      console.log("calldataCost", calldataCost);

      await environment.sendUserOperation(transferUserOp, entryPoint.address);

      expect(await mockToken.balanceOf(charlie.address)).to.equal(
        charlieTokenBalanceBefore.add(tokenAmountToTransfer)
      );
    });

    it("Stateless Session Key Manager Module", async () => {
      const {
        entryPoint,
        userSA,
        statelessSessionKeyMananger,
        mockSessionValidationModule,
        mockToken,
        sessionKeyData,
        leafData,
        ecdsaModule,
      } = await setupTests();
      const tokenAmountToTransfer = ethers.utils.parseEther("0.834");

      const chainId = (await ethers.provider.getNetwork()).chainId;

      const sessionEnableData = makeSessionEnableData([chainId], [leafData]);

      const messageHashAndAddress = ethers.utils.arrayify(
        ethers.utils.hexConcat([keccak256(sessionEnableData), userSA.address])
      );
      const signature = await smartAccountOwner.signMessage(
        messageHashAndAddress
      );

      const signatureWithModuleAddress = ethers.utils.defaultAbiCoder.encode(
        ["bytes", "address"],
        [signature, ecdsaModule.address]
      );

      const sessionKeyIndex = 0;

      const transferUserOp = await makeStatelessEcdsaSessionKeySignedUserOp(
        "execute_ncC",
        [
          mockToken.address,
          ethers.utils.parseEther("0"),
          encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
        ],
        userSA.address,
        sessionKey,
        entryPoint,
        statelessSessionKeyMananger.address,
        0,
        0,
        sessionKeyIndex,
        mockSessionValidationModule.address,
        sessionKeyData,
        sessionEnableData,
        signatureWithModuleAddress,
        {
          preVerificationGas: 51000,
        }
      );

      const charlieTokenBalanceBefore = await mockToken.balanceOf(
        charlie.address
      );

      const calldataCost = callDataCost(packUserOp(transferUserOp, false));
      console.log("calldataCost", calldataCost);

      await environment.sendUserOperation(transferUserOp, entryPoint.address);

      expect(await mockToken.balanceOf(charlie.address)).to.equal(
        charlieTokenBalanceBefore.add(tokenAmountToTransfer)
      );
    });

    it("Statefull Session Key Manager Module", async () => {
      const {
        entryPoint,
        userSA,
        statefullSessionKeyMananger,
        mockSessionValidationModule,
        mockToken,
        sessionKeyData,
        leafDataRaw: leafData,
        ecdsaModule,
      } = await setupTests();
      const tokenAmountToTransfer = ethers.utils.parseEther("0.834");

      const enableSessionCalldata =
        statefullSessionKeyMananger.interface.encodeFunctionData(
          "enableSessionKey",
          [leafData]
        );

      // Enable session key
      const enableUserOp = await makeEcdsaModuleUserOp(
        "execute_ncC",
        [
          statefullSessionKeyMananger.address,
          ethers.utils.parseEther("0"),
          enableSessionCalldata,
        ],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address
      );
      const { wait } = await entryPoint.handleOps(
        [enableUserOp],
        alice.address
      );
      const { gasUsed } = await wait();
      console.log("enableSessionKey gasUsed", gasUsed.toString());

      const transferUserOp = await makeStatefullEcdsaSessionKeySignedUserOp(
        "execute_ncC",
        [
          mockToken.address,
          ethers.utils.parseEther("0"),
          encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
        ],
        userSA.address,
        sessionKey,
        entryPoint,
        statefullSessionKeyMananger.address,
        0,
        0,
        mockSessionValidationModule.address,
        sessionKeyData,
        {
          preVerificationGas: 51000,
        }
      );

      const charlieTokenBalanceBefore = await mockToken.balanceOf(
        charlie.address
      );

      const calldataCost = callDataCost(packUserOp(transferUserOp, false));
      console.log("calldataCost", calldataCost);

      await environment.sendUserOperation(transferUserOp, entryPoint.address);

      expect(await mockToken.balanceOf(charlie.address)).to.equal(
        charlieTokenBalanceBefore.add(tokenAmountToTransfer)
      );
    });
  });
});
