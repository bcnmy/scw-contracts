import { expect } from "chai";
import { ethers, deployments } from "hardhat";
import { makeEcdsaModuleUserOp } from "../../utils/userOp";
import { encodeTransfer } from "../../utils/testUtils";
import { defaultAbiCoder, hexZeroPad } from "ethers/lib/utils";
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
import {
  HybridSKMBatchCallUtils,
  HybridSKMSingleCallUtils,
} from "../../utils/hybridSessionKeyManager";

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

    const mockSessionValidationModule1 = await (
      await ethers.getContractFactory("MockSessionValidationModule")
    ).deploy();
    const mockSessionValidationModule2 = await (
      await ethers.getContractFactory("MockSessionValidationModule")
    ).deploy();

    const validUntil = 0;
    const validAfter = 0;
    const sessionKeyData = hexZeroPad(sessionKey.address, 20);
    const sessionData: ISessionKeyManagerModuleHybrid.SessionDataStruct = {
      validUntil,
      validAfter,
      sessionKeyData,
      sessionValidationModule: mockSessionValidationModule1.address,
    };
    const sessionData2: ISessionKeyManagerModuleHybrid.SessionDataStruct = {
      ...sessionData,
      sessionValidationModule: mockSessionValidationModule2.address,
    };

    const hybridSKMSingleCallUtils = new HybridSKMSingleCallUtils(
      entryPoint,
      hybridSessionKeyManager,
      ecdsaModule
    );
    const hybridSKMBatchCallUtils = new HybridSKMBatchCallUtils(
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
      mockSessionValidationModule: mockSessionValidationModule1,
      mockSessionValidationModule2,
      sessionKeyData: sessionKeyData,
      sessionData,
      sessionData2,
      hybridSKMSingleCallUtils,
      hybridSKMBatchCallUtils,
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

  describe("Batch Call", async () => {
    it("Should process signed user operation from Session for 2 batch items when enabling and use is batched", async () => {
      const {
        entryPoint,
        userSA,
        hybridSKMBatchCallUtils: utils,
        mockToken,
        sessionData,
        sessionData2,
        smartAccountOwner,
      } = await setupTests();
      const tokenAmountToTransfer = ethers.utils.parseEther("0.834");

      const chainId = (await ethers.provider.getNetwork()).chainId;

      const { sessionEnableData, sessionEnableSignature } =
        await utils.makeSessionEnableData(
          [chainId, chainId],
          [sessionData, sessionData2],
          userSA.address,
          smartAccountOwner
        );

      const callSpecificData = defaultAbiCoder.encode(
        ["string"],
        ["hello world"]
      );

      const sessionInfo1 = utils.makeSessionEnableSessionInfo(
        0,
        0,
        sessionData,
        callSpecificData
      );
      const sessionInfo2 = utils.makeSessionEnableSessionInfo(
        0,
        1,
        sessionData2,
        callSpecificData
      );

      const transferUserOp = await utils.makeEcdsaSessionKeySignedUserOp(
        userSA.address,
        [
          {
            to: mockToken.address,
            value: ethers.utils.parseEther("0"),
            calldata: encodeTransfer(
              charlie.address,
              tokenAmountToTransfer.toString()
            ),
          },
          {
            to: mockToken.address,
            value: ethers.utils.parseEther("0"),
            calldata: encodeTransfer(
              charlie.address,
              tokenAmountToTransfer.toString()
            ),
          },
        ],
        sessionKey,
        [sessionEnableData],
        [sessionEnableSignature],
        [sessionInfo1, sessionInfo2],
        {
          preVerificationGas: 60000,
        }
      );

      const charlieTokenBalanceBefore = await mockToken.balanceOf(
        charlie.address
      );

      await environment.sendUserOperation(transferUserOp, entryPoint.address);

      expect(await mockToken.balanceOf(charlie.address)).to.equal(
        charlieTokenBalanceBefore.add(tokenAmountToTransfer.mul(2))
      );
    });

    it("Should process signed user operation from Session for 2 batch items when one is fresh and other is pre-enabled", async () => {
      const {
        entryPoint,
        userSA,
        hybridSKMBatchCallUtils: utils,
        mockToken,
        sessionData,
        sessionData2,
        smartAccountOwner,
        ecdsaModule,
        hybridSessionKeyManager,
      } = await setupTests();
      const tokenAmountToTransfer = ethers.utils.parseEther("0.834");

      const chainId = (await ethers.provider.getNetwork()).chainId;

      // Pre-enable the 2nd session
      const enableSessionOp = await makeEcdsaModuleUserOp(
        "execute_ncC",
        [
          hybridSessionKeyManager.address,
          ethers.utils.parseEther("0"),
          hybridSessionKeyManager.interface.encodeFunctionData(
            "enableSession",
            [sessionData2]
          ),
        ],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address,
        {
          preVerificationGas: 50000,
        }
      );
      await environment.sendUserOperation(enableSessionOp, entryPoint.address);

      const { sessionEnableData, sessionEnableSignature } =
        await utils.makeSessionEnableData(
          [chainId],
          [sessionData],
          userSA.address,
          smartAccountOwner
        );

      const callSpecificData = defaultAbiCoder.encode(
        ["string"],
        ["hello world"]
      );

      const sessionInfo1 = utils.makeSessionEnableSessionInfo(
        0,
        0,
        sessionData,
        callSpecificData
      );
      const sessionInfo2 = await utils.makePreEnabledSessionInfo(
        sessionData2,
        callSpecificData
      );

      const transferUserOp = await utils.makeEcdsaSessionKeySignedUserOp(
        userSA.address,
        [
          {
            to: mockToken.address,
            value: ethers.utils.parseEther("0"),
            calldata: encodeTransfer(
              charlie.address,
              tokenAmountToTransfer.toString()
            ),
          },
          {
            to: mockToken.address,
            value: ethers.utils.parseEther("0"),
            calldata: encodeTransfer(
              charlie.address,
              tokenAmountToTransfer.toString()
            ),
          },
        ],
        sessionKey,
        [sessionEnableData],
        [sessionEnableSignature],
        [sessionInfo1, sessionInfo2],
        {
          preVerificationGas: 60000,
        }
      );

      const charlieTokenBalanceBefore = await mockToken.balanceOf(
        charlie.address
      );

      await environment.sendUserOperation(transferUserOp, entryPoint.address);

      expect(await mockToken.balanceOf(charlie.address)).to.equal(
        charlieTokenBalanceBefore.add(tokenAmountToTransfer.mul(2))
      );
    });

    it("Should process signed user operation from Session for 2 batch items when both are pre-enabled", async () => {
      const {
        entryPoint,
        userSA,
        hybridSKMBatchCallUtils: utils,
        mockToken,
        sessionData,
        sessionData2,
        smartAccountOwner,
        ecdsaModule,
        hybridSessionKeyManager,
      } = await setupTests();
      const tokenAmountToTransfer = ethers.utils.parseEther("0.834");

      // Pre-enable both sessions
      const enableSessionOp = await makeEcdsaModuleUserOp(
        "executeBatch",
        [
          [hybridSessionKeyManager.address, hybridSessionKeyManager.address],
          [ethers.utils.parseEther("0"), ethers.utils.parseEther("0")],
          [
            hybridSessionKeyManager.interface.encodeFunctionData(
              "enableSession",
              [sessionData]
            ),
            hybridSessionKeyManager.interface.encodeFunctionData(
              "enableSession",
              [sessionData2]
            ),
          ],
        ],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address,
        {
          preVerificationGas: 60000,
        }
      );
      await environment.sendUserOperation(enableSessionOp, entryPoint.address);

      const callSpecificData = defaultAbiCoder.encode(
        ["string"],
        ["hello world"]
      );

      const sessionInfo1 = await utils.makePreEnabledSessionInfo(
        sessionData,
        callSpecificData
      );
      const sessionInfo2 = await utils.makePreEnabledSessionInfo(
        sessionData2,
        callSpecificData
      );

      const transferUserOp = await utils.makeEcdsaSessionKeySignedUserOp(
        userSA.address,
        [
          {
            to: mockToken.address,
            value: ethers.utils.parseEther("0"),
            calldata: encodeTransfer(
              charlie.address,
              tokenAmountToTransfer.toString()
            ),
          },
          {
            to: mockToken.address,
            value: ethers.utils.parseEther("0"),
            calldata: encodeTransfer(
              charlie.address,
              tokenAmountToTransfer.toString()
            ),
          },
        ],
        sessionKey,
        [],
        [],
        [sessionInfo1, sessionInfo2],
        {
          preVerificationGas: 60000,
        }
      );

      const charlieTokenBalanceBefore = await mockToken.balanceOf(
        charlie.address
      );

      await environment.sendUserOperation(transferUserOp, entryPoint.address);

      expect(await mockToken.balanceOf(charlie.address)).to.equal(
        charlieTokenBalanceBefore.add(tokenAmountToTransfer.mul(2))
      );
    });
  });
});
