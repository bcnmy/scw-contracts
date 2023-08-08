import { expect } from "chai";
import { ethers, deployments } from "hardhat";
import { encodeTransfer } from "../../utils/testUtils";
import {
  getEntryPoint,
  getSmartAccountImplementation,
  getSmartAccountFactory,
  getMockToken,
  getEcdsaOwnershipRegistryModule,
  getSmartAccountWithModule,
  getVerifyingPaymaster,
} from "../../utils/setupHelper";
import { makeEcdsaModuleUserOp } from "../../utils/userOp";
import {
  BundlerTestEnvironment,
  Snapshot,
} from "../environment/bundlerEnvironment";

describe("UserOps (with Bundler)", async () => {
  const [deployer, smartAccountOwner, charlie, verifiedSigner] =
    await ethers.getSigners();

  let environment: BundlerTestEnvironment;
  let defaultSnapshot: Snapshot;

  before(async function () {
    const chainId = (await ethers.provider.getNetwork()).chainId;
    if (chainId !== BundlerTestEnvironment.BUNDLER_ENVIRONMENT_CHAIN_ID) {
      this.skip();
    }

    environment = await BundlerTestEnvironment.getDefaultInstance();
    defaultSnapshot = await environment.snapshot();
  });

  const setupTests = deployments.createFixture(
    async ({ deployments, getNamedAccounts }) => {
      await deployments.fixture();

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

      await deployer.sendTransaction({
        to: userSA.address,
        value: ethers.utils.parseEther("10"),
      });

      await mockToken.mint(userSA.address, ethers.utils.parseEther("1000000"));

      return {
        entryPoint: await getEntryPoint(),
        smartAccountImplementation: await getSmartAccountImplementation(),
        smartAccountFactory: await getSmartAccountFactory(),
        mockToken: mockToken,
        ecdsaModule: ecdsaModule,
        userSA: userSA,
        verifyingPaymaster: await getVerifyingPaymaster(
          deployer,
          verifiedSigner
        ),
      };
    }
  );

  describe("validateUserOp ", async () => {
    afterEach(async function () {
      const chainId = (await ethers.provider.getNetwork()).chainId;
      if (chainId !== BundlerTestEnvironment.BUNDLER_ENVIRONMENT_CHAIN_ID) {
        this.skip();
      }

      console.log("mempool", await environment.dumpMempool());
      await environment.revert(defaultSnapshot);
      await environment.resetBundler();
      console.log("mempool after", await environment.dumpMempool());
    });

    it("Can validate a userOp via proper Authorization Module", async () => {
      const { entryPoint, mockToken, userSA, ecdsaModule } = await setupTests();

      const charlieTokenBalanceBefore = await mockToken.balanceOf(
        charlie.address
      );
      const tokenAmountToTransfer = ethers.utils.parseEther("0.5345");

      const userOp = await makeEcdsaModuleUserOp(
        "executeCall",
        [
          mockToken.address,
          ethers.utils.parseEther("0"),
          encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
        ],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address,
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
