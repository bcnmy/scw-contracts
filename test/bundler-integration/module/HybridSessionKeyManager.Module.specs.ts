import { expect } from "chai";
import { ethers, deployments } from "hardhat";
import { makeEcdsaModuleUserOp } from "../../utils/userOp";
import { encodeTransfer } from "../../utils/testUtils";
import { hexZeroPad } from "ethers/lib/utils";
import {
  getEntryPoint,
  getSmartAccountImplementation,
  getSmartAccountFactory,
  getMockToken,
  getEcdsaOwnershipRegistryModule,
  getSmartAccountWithModule,
} from "../../utils/setupHelper";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BundlerTestEnvironment } from "../environment/bundlerEnvironment";
import {
  SessionKeyManagerHybrid__factory,
  ISessionKeyManagerModuleHybrid,
} from "../../../typechain-types";
import { HybridSKMSingleCallUtils } from "../../utils/hybridSessionKeyManager";

describe("Hybrid Session Key Manager", async () => {
  let [deployer, smartAccountOwner, charlie, sessionKey, alice] =
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
    [deployer, smartAccountOwner, charlie, sessionKey, alice] =
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

    const hybridSessionKeyManager = await new SessionKeyManagerHybrid__factory(
      alice
    ).deploy();
    const userOp = await makeEcdsaModuleUserOp(
      "enableModule",
      [hybridSessionKeyManager.address],
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
    const sessionData: ISessionKeyManagerModuleHybrid.SessionDataStruct = {
      validUntil,
      validAfter,
      sessionKeyData,
      sessionValidationModule: mockSessionValidationModule.address,
    };

    const hybridSKMSingleCallUtils = new HybridSKMSingleCallUtils(
      entryPoint,
      hybridSessionKeyManager,
      ecdsaModule
    );

    return {
      entryPoint: entryPoint,
      smartAccountImplementation: await getSmartAccountImplementation(),
      smartAccountFactory: await getSmartAccountFactory(),
      mockToken: mockToken,
      ecdsaModule: ecdsaModule,
      userSA: userSA,
      hybridSessionKeyManager,
      mockSessionValidationModule: mockSessionValidationModule,
      sessionKeyData: sessionKeyData,
      sessionData,
      hybridSKMSingleCallUtils,
      smartAccountOwner,
    };
  });

  describe("Single Call", async () => {
    it("Should process signed user operation from Session when enabling and use is batched", async () => {
      const {
        entryPoint,
        userSA,
        hybridSKMSingleCallUtils: utils,
        mockToken,
        sessionData,
        smartAccountOwner,
      } = await setupTests();
      const tokenAmountToTransfer = ethers.utils.parseEther("0.834");

      const chainId = (await ethers.provider.getNetwork()).chainId;

      const { sessionEnableData, sessionEnableSignature } =
        await utils.makeSessionEnableData(
          [chainId],
          [sessionData],
          userSA.address,
          smartAccountOwner
        );

      const transferUserOp =
        await utils.makeEcdsaSessionKeySignedUserOpForEnableAndUseSession(
          userSA.address,
          {
            to: mockToken.address,
            value: ethers.utils.parseEther("0"),
            calldata: encodeTransfer(
              charlie.address,
              tokenAmountToTransfer.toString()
            ),
          },
          sessionKey,
          sessionData,
          sessionEnableData,
          sessionEnableSignature,
          0,
          {
            preVerificationGas: 51000,
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

    it("Should process signed user operation from Session when session is pre-enabled", async () => {
      const {
        entryPoint,
        userSA,
        hybridSKMSingleCallUtils: utils,
        mockToken,
        sessionData,
        smartAccountOwner,
      } = await setupTests();
      const tokenAmountToTransfer = ethers.utils.parseEther("0.834");

      const chainId = (await ethers.provider.getNetwork()).chainId;

      const { sessionEnableData, sessionEnableSignature } =
        await utils.makeSessionEnableData(
          [chainId],
          [sessionData],
          userSA.address,
          smartAccountOwner
        );

      const transferUserOp =
        await utils.makeEcdsaSessionKeySignedUserOpForEnableAndUseSession(
          userSA.address,
          {
            to: mockToken.address,
            value: ethers.utils.parseEther("0"),
            calldata: encodeTransfer(
              charlie.address,
              tokenAmountToTransfer.toString()
            ),
          },
          sessionKey,
          sessionData,
          sessionEnableData,
          sessionEnableSignature,
          0,
          {
            preVerificationGas: 51000,
          }
        );

      await environment.sendUserOperation(transferUserOp, entryPoint.address);

      // Use the session again but in pre-enable mode
      const transferUserOp2 =
        await utils.makeEcdsaSessionKeySignedUserOpForPreEnabledSession(
          userSA.address,
          {
            to: mockToken.address,
            value: ethers.utils.parseEther("0"),
            calldata: encodeTransfer(
              charlie.address,
              tokenAmountToTransfer.toString()
            ),
          },
          sessionKey,
          sessionData,
          {
            preVerificationGas: 51000,
          }
        );

      const charlieTokenBalanceBefore = await mockToken.balanceOf(
        charlie.address
      );

      await environment.sendUserOperation(transferUserOp2, entryPoint.address);

      expect(await mockToken.balanceOf(charlie.address)).to.equal(
        charlieTokenBalanceBefore.add(tokenAmountToTransfer)
      );
    });
  });
});
